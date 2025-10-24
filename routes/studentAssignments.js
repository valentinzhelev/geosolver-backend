const express = require('express');
const router = express.Router();
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Course = require('../models/Course');
const TaskTemplate = require('../models/TaskTemplate');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const Audit = require('../models/Audit');

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
      .populate('taskTemplate', 'name type difficulty description')
      .sort({ dueDate: 1 });

    // Add submission status for each assignment
    const assignmentsWithStatus = await Promise.all(
      assignments.map(async (assignment) => {
        const submission = await Submission.findOne({
          assignment: assignment._id,
          student: req.userId
        }).sort({ submittedAt: -1 });

        return {
          ...assignment.toObject(),
          submissionStatus: submission ? submission.status : 'not_submitted',
          submissionScore: submission ? submission.finalScore : null,
          submissionCount: submission ? submission.attemptNumber : 0,
          canSubmit: assignment.isActive() || assignment.isLateSubmissionAllowed(),
          isLate: submission ? submission.isLate : false
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
      .populate('taskTemplate', 'name type difficulty description');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Заданието не е намерено'
      });
    }

    // Check if student is enrolled in the course
    const course = await Course.findById(assignment.course);
    if (!course.students.includes(req.userId)) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до това задание'
      });
    }

    // Get student's submission if exists
    const submission = await Submission.findOne({
      assignment: assignment._id,
      student: req.userId
    }).sort({ submittedAt: -1 });

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
        isLate: submission.isLate
      } : null,
      canSubmit: assignment.isActive() || assignment.isLateSubmissionAllowed(),
      timeRemaining: assignment.dueDate - new Date()
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
    if (!course.students.includes(req.userId)) {
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
    const latePenalty = isLate ? assignment.calculateLatePenalty(assignment) : 0;

    // Create submission
    const submission = new Submission({
      assignment: assignment._id,
      student: req.userId,
      variantIndex,
      answers,
      timeSpent: timeSpent || 0,
      isLate,
      latePenalty,
      attemptNumber: existingSubmissions.length + 1
    });

    // Auto-grade if enabled
    if (assignment.options.autoGrade) {
      try {
        const taskTemplate = await TaskTemplate.findById(assignment.taskTemplate);
        await submission.autoGrade(assignment, taskTemplate);
      } catch (error) {
        console.error('Auto-grading failed:', error);
        submission.status = 'needs_review';
      }
    }

    await submission.save();

    // Update assignment statistics
    assignment.statistics.totalSubmissions += 1;
    await assignment.save();

    // Log audit
    await Audit.logOperation({
      operation: 'submit_assignment',
      performedBy: req.userId,
      targetEntity: {
        type: 'submission',
        id: submission._id
      },
      description: `Изпратен submission за задание: ${assignment.title}`,
      newValues: {
        assignment: assignment.title,
        variantIndex,
        score: submission.finalScore,
        isLate
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'Submission е изпратен успешно',
      data: {
        submissionId: submission._id,
        score: submission.finalScore,
        status: submission.status,
        isLate,
        feedback: submission.feedback
      }
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
