const express = require('express');
const router = express.Router();
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const TaskTemplate = require('../models/TaskTemplate');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const Audit = require('../models/Audit');
const { includesId } = require('../utils/objectId');
const { getStudentAssignmentStatus } = require('../utils/studentAssignmentStatus');
const { createNotification } = require('../utils/notifications');
const {
  buildSubmissionGaiInsights,
  buildStudentGaiFeedback,
  buildAnonymousClassContext,
  resolveToolKey,
} = require('../utils/gaiInsights');
const {
  enrichStudentFeedback,
  ensureSubmissionGaiLlm,
  getStudyHintForAssignment,
  isLlmEnabled,
} = require('../utils/gaiLlmService');
const User = require('../models/User');

// Get assignments for student
router.get('/assignments', auth, requireRole('student'), async (req, res) => {
  try {
    const { course, status } = req.query;
    
    // Find courses where student is enrolled
    const courses = await Course.find({ students: req.userId });
    const courseIds = courses.map(c => c._id);
    
    const filter = { 
      course: { $in: courseIds },
      status: { $in: ['active', 'completed'] }
    };

    if (course) {
      filter.course = course;
    }

    const assignments = await Assignment.find(filter)
      .populate('course', 'name code')
      .populate('taskTemplate', 'name type difficulty description tags paramsSchema')
      .sort({ dueDate: 1 });

    // Add submission status for each assignment
    const assignmentsWithStatus = await Promise.all(
      assignments.map(async (assignment) => {
        const submissions = await Submission.find({
          assignment: assignment._id,
          student: req.userId,
        }).sort({ submittedAt: -1 });
        const latest = submissions[0] || null;
        const studentStatus = getStudentAssignmentStatus(assignment, submissions);

        return {
          ...assignment.toObject(),
          submissionStatus: latest ? latest.status : 'not_submitted',
          studentStatus,
          submissionScore: latest ? latest.finalScore : null,
          submissionCount: submissions.length,
          maxAttempts: assignment.options?.maxAttempts ?? 3,
          canSubmit:
            (assignment.isActive() || assignment.isLateSubmissionAllowed()) &&
            submissions.length < (assignment.options?.maxAttempts ?? 3),
          isLate: latest ? latest.isLate : false,
        };
      })
    );

    res.json({
      success: true,
      data: assignmentsWithStatus,
      count: assignmentsWithStatus.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на заданията',
      error: error.message
    });
  }
});

// Get single assignment for student
router.get('/assignments/:id', auth, requireRole('student'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate('course', 'name code')
      .populate('taskTemplate', 'name type difficulty description tags paramsSchema');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Заданието не е намерено'
      });
    }

    // Check if student is enrolled in the course
    const course = await Course.findById(assignment.course);
    if (!includesId(course.students, req.userId)) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до това задание'
      });
    }

    const submissions = await Submission.find({
      assignment: assignment._id,
      student: req.userId,
    }).sort({ submittedAt: -1 });
    const submission = submissions[0] || null;
    const studentStatus = getStudentAssignmentStatus(assignment, submissions);
    const toolKey = resolveToolKey(assignment.taskTemplate);
    const allSubs = await Submission.find({ assignment: assignment._id }).select(
      'answers rawComparison finalScore variantIndex'
    );
    const classContext = buildAnonymousClassContext({ submissions: allSubs, toolKey });
    let gaiFeedback = null;
    if (submission?.rawComparison) {
      const gai = buildSubmissionGaiInsights({
        submission,
        toolKey,
        tolerance:
          assignment.settings?.customTolerance ??
          assignment.taskTemplate?.gradingSettings?.tolerance,
        toleranceType:
          assignment.settings?.customToleranceType ??
          assignment.taskTemplate?.gradingSettings?.toleranceType,
      });
      gaiFeedback = buildStudentGaiFeedback(gai, classContext);
      if (submission) {
        await ensureSubmissionGaiLlm(submission, {
          assignment,
          taskTemplate: assignment.taskTemplate,
          classContext,
        });
        gaiFeedback = enrichStudentFeedback(gaiFeedback, submission);
      }
    }

    const variantCount = assignment.variants?.length || 1;
    let variantHash = 0;
    const uidStr = String(req.userId || '0');
    for (let i = 0; i < uidStr.length; i += 1) {
      variantHash = (variantHash + uidStr.charCodeAt(i)) % 10000;
    }
    const studentVariantIdx = variantCount > 1 ? variantHash % variantCount : 0;
    const studentVariant = assignment.variants?.[studentVariantIdx];
    const rawHintInput = studentVariant?.inputData;
    const variantForHint =
      rawHintInput?.input && typeof rawHintInput.input === 'object'
        ? rawHintInput.input
        : rawHintInput || {};
    const gaiStudyHint =
      !submission && isLlmEnabled()
        ? await getStudyHintForAssignment(assignment._id, req.userId, {
            assignment,
            taskTemplate: assignment.taskTemplate,
            inputData: variantForHint,
          })
        : null;

    // Prepare assignment data for student (without solutions)
    const studentAssignment = {
      ...assignment.toObject(),
      variants: assignment.variants.map(variant => ({
        variantIndex: variant.variantIndex,
        inputData: variant.inputData
        // Don't include solution and solutionHash for students
      })),
      submission: submission ? {
        id: submission._id,
        status: submission.status,
        score: submission.finalScore,
        feedback: submission.feedback,
        submittedAt: submission.submittedAt,
        attemptNumber: submission.attemptNumber,
        isLate: submission.isLate,
        gaiFeedback,
      } : null,
      gaiFeedback,
      gaiContext: classContext,
      gaiStudyHint,
      gaiLlmEnabled: isLlmEnabled(),
      studentStatus,
      submissionCount: submissions.length,
      maxAttempts: assignment.options?.maxAttempts ?? 3,
      canSubmit:
        (assignment.isActive() || assignment.isLateSubmissionAllowed()) &&
        submissions.length < (assignment.options?.maxAttempts ?? 3),
      timeRemaining: assignment.dueDate - new Date(),
    };

    res.json({
      success: true,
      data: studentAssignment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на заданието',
      error: error.message
    });
  }
});

// Submit assignment
router.post('/assignments/:id/submit', auth, requireRole('student'), async (req, res) => {
  try {
    const { answers, variantIndex, timeSpent } = req.body;

    if (!answers || variantIndex === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Липсват задължителни полета'
      });
    }

    const assignment = await Assignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Заданието не е намерено'
      });
    }

    // Check if student is enrolled in the course
    const course = await Course.findById(assignment.course);
    if (!includesId(course.students, req.userId)) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до това задание'
      });
    }

    // Check if assignment is still active
    if (!assignment.isActive() && !assignment.isLateSubmissionAllowed()) {
      return res.status(400).json({
        success: false,
        message: 'Заданието вече не е активно'
      });
    }

    // Check if variant exists
    const variant = assignment.getVariant(variantIndex);
    if (!variant) {
      return res.status(400).json({
        success: false,
        message: 'Невалиден вариант'
      });
    }

    // Check attempt limits
    const existingSubmissions = await Submission.find({
      assignment: assignment._id,
      student: req.userId
    });

    if (existingSubmissions.length >= assignment.options.maxAttempts) {
      return res.status(400).json({
        success: false,
        message: 'Достигнат максималният брой опити'
      });
    }

    // Check if late submission
    const isLate = new Date() > assignment.dueDate;

    // Create submission
    const submission = new Submission({
      assignment: assignment._id,
      student: req.userId,
      variantIndex,
      answers,
      timeSpent: timeSpent || 0,
      isLate,
      latePenalty: 0,
      attemptNumber: existingSubmissions.length + 1
    });

    if (isLate) {
      submission.latePenalty = submission.calculateLatePenalty(assignment);
    }

    const taskTemplate = await TaskTemplate.findById(assignment.taskTemplate);

    // Auto-grade if enabled
    if (assignment.options.autoGrade) {
      try {
        await submission.autoGrade(assignment, taskTemplate);
      } catch (error) {
        console.error('Auto-grading failed:', error);
        submission.status = 'needs_review';
      }
    }

    await submission.save();

    try {
      const studentUser = await User.findById(req.userId).select('name email');
      await createNotification({
        userId: assignment.createdBy,
        type: 'submission_received',
        title: `Ново предаване: ${assignment.title}`,
        body: `От ${studentUser?.name || studentUser?.email || 'ученик'}`,
        link: `/classroom/review?assignment=${assignment._id}`,
        meta: { submissionId: submission._id, assignmentId: assignment._id },
      });
    } catch (sideErr) {
      console.error('Post-submit notification failed:', sideErr);
    }

    try {
      if (!assignment.statistics) {
        assignment.statistics = { totalSubmissions: 0, averageScore: 0, completionRate: 0 };
      }
      assignment.statistics.totalSubmissions += 1;
      await assignment.save();
    } catch (sideErr) {
      console.error('Post-submit statistics failed:', sideErr);
    }

    try {
      await Audit.logOperation({
        operation: 'submit_assignment',
        performedBy: req.userId,
        targetEntity: {
          type: 'submission',
          id: submission._id,
        },
        description: `Изпратен submission за задание: ${assignment.title}`,
        newValues: {
          assignment: assignment.title,
          variantIndex,
          score: submission.finalScore,
          isLate,
        },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });
    } catch (sideErr) {
      console.error('Post-submit audit failed:', sideErr);
    }

    const toolKey = resolveToolKey(taskTemplate);
    const gaiInsights = buildSubmissionGaiInsights({
      submission,
      toolKey,
      tolerance:
        assignment.settings?.customTolerance ?? taskTemplate?.gradingSettings?.tolerance,
      toleranceType:
        assignment.settings?.customToleranceType ?? taskTemplate?.gradingSettings?.toleranceType,
    });
    const allSubs = await Submission.find({ assignment: assignment._id }).select(
      'answers rawComparison finalScore variantIndex'
    );
    const classContext = buildAnonymousClassContext({ submissions: allSubs, toolKey });
    let gaiFeedback = buildStudentGaiFeedback(gaiInsights, classContext);
    await ensureSubmissionGaiLlm(submission, {
      assignment,
      taskTemplate,
      classContext,
    });
    gaiFeedback = enrichStudentFeedback(gaiFeedback, submission);

    res.status(201).json({
      success: true,
      message: 'Submission е изпратен успешно',
      data: {
        submissionId: submission._id,
        score: submission.finalScore,
        status: submission.status,
        isLate,
        feedback: submission.feedback,
        gaiFeedback,
        gaiContext: classContext,
        gaiLlmEnabled: isLlmEnabled(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при изпращане на submission',
      error: error.message
    });
  }
});

// Get student's submission history
router.get('/submissions', auth, requireRole('student'), async (req, res) => {
  try {
    const { assignment, limit = 50 } = req.query;
    
    const filter = { student: req.userId };
    if (assignment) {
      filter.assignment = assignment;
    }

    const submissions = await Submission.find(filter)
      .populate('assignment', 'title dueDate')
      .populate('student', 'name email')
      .sort({ submittedAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: submissions,
      count: submissions.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на submissions',
      error: error.message
    });
  }
});

// Get single submission
router.get('/submissions/:id', auth, requireRole('student'), async (req, res) => {
  try {
    const submission = await Submission.findById(req.params.id)
      .populate('assignment', 'title dueDate options')
      .populate('student', 'name email');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission не е намерен'
      });
    }

    // Check ownership
    if (submission.student._id.toString() !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до този submission'
      });
    }

    res.json({
      success: true,
      data: submission
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на submission',
      error: error.message
    });
  }
});

module.exports = router;
