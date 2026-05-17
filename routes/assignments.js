const express = require('express');
const router = express.Router();
const Assignment = require('../models/Assignment');
const Course = require('../models/Course');
const TaskTemplate = require('../models/TaskTemplate');
const Submission = require('../models/Submission');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const Audit = require('../models/Audit');
const { getTemplateByToolKey } = require('../utils/ensureMvpTemplates');
const { includesId } = require('../utils/objectId');

// Get all assignments for teacher
router.get('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const { course, status, limit = 50 } = req.query;
    const filter = req.userRole === 'admin' ? {} : { createdBy: req.userId };

    if (course) {
      filter.course = course;
    }
    if (status) {
      filter.status = status;
    } else {
      // By default hide archived (soft-deleted) assignments
      filter.status = { $ne: 'archived' };
    }

    const assignments = await Assignment.find(filter)
      .populate('course', 'name code')
      .populate('taskTemplate', 'name type difficulty')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    res.json({
      success: true,
      data: assignments,
      count: assignments.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на заданията',
      error: error.message
    });
  }
});

// Pending submissions across all teacher assignments
router.get('/review-queue/list', auth, requireRole('teacher'), async (req, res) => {
  try {
    const assignmentQuery = req.userRole === 'admin' ? {} : { createdBy: req.userId };
    const assignments = await Assignment.find(assignmentQuery).select('_id');
    const assignmentIds = assignments.map((a) => a._id);

    const submissions = await Submission.find({
      assignment: { $in: assignmentIds },
      status: { $in: ['submitted', 'needs_review'] },
    })
      .populate('student', 'name email')
      .populate('assignment', 'title dueDate course')
      .sort({ submittedAt: -1 })
      .limit(100);

    res.json({ success: true, data: submissions, count: submissions.length });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на опашката',
      error: error.message,
    });
  }
});

// Update assignment status (draft / active / archived)
router.patch('/:id/status', auth, requireRole('teacher'), async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['draft', 'active', 'completed', 'archived'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Невалиден статус' });
    }

    const assignment = await Assignment.findById(req.params.id);
    if (!assignment) {
      return res.status(404).json({ success: false, message: 'Заданието не е намерено' });
    }

    const course = await Course.findById(assignment.course);
    const isCourseOwner = course && course.owner.toString() === req.userId;
    const isCreator = assignment.createdBy.toString() === req.userId;

    if (!isCreator && !isCourseOwner && req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Нямате права' });
    }

    assignment.status = status;
    await assignment.save();

    const statusMessages = {
      archived: 'Заданието е архивирано',
      active: 'Заданието е възстановено',
      draft: 'Заданието е в чернова',
      completed: 'Заданието е приключено',
    };

    res.json({
      success: true,
      data: assignment,
      message: statusMessages[status] || 'Статусът е обновен',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при промяна на статуса',
      error: error.message,
    });
  }
});

// Get single assignment
router.get('/:id', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id)
      .populate('course', 'name code students')
      .populate('taskTemplate', 'name type difficulty description')
      .populate('createdBy', 'name email');

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Заданието не е намерено'
      });
    }

    // Check access permissions
    const isCreator = assignment.createdBy._id.toString() === req.userId;
    const isStudent = includesId(
      assignment.course.students.map((s) => s._id || s),
      req.userId
    );
    const isAdmin = req.userRole === 'admin';

    if (!isCreator && !isStudent && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до това задание'
      });
    }

    // If student, don't show solutions
    if (isStudent && !isCreator && !isAdmin) {
      const studentAssignment = {
        ...assignment.toObject(),
        variants: assignment.variants.map(variant => ({
          variantIndex: variant.variantIndex,
          inputData: variant.inputData,
          // Don't include solution and solutionHash for students
        }))
      };
      return res.json({
        success: true,
        data: studentAssignment
      });
    }

    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на заданието',
      error: error.message
    });
  }
});

// Create new assignment
router.post('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const {
      title,
      description,
      taskTemplate,
      toolKey,
      course,
      variantsCount,
      dueDate,
      options,
      status: requestedStatus,
    } = req.body;

    let templateId = taskTemplate;
    if (!templateId && toolKey) {
      const builtin = await getTemplateByToolKey(toolKey);
      if (!builtin) {
        return res.status(400).json({
          success: false,
          message: 'Невалиден инструмент за задание',
        });
      }
      templateId = builtin._id;
    }

    // Validate required fields
    if (!title || !templateId || !course || !variantsCount || !dueDate) {
      return res.status(400).json({
        success: false,
        message: 'Липсват задължителни полета'
      });
    }

    // Check if course exists and user owns it
    const courseDoc = await Course.findById(course);
    if (!courseDoc) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен'
      });
    }

    if (courseDoc.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да създавате задания за този курс'
      });
    }

    // Check if task template exists
    const template = await TaskTemplate.findById(templateId);
    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Шаблонът за задача не е намерен'
      });
    }

    const assignment = new Assignment({
      title,
      description: description || '',
      taskTemplate: templateId,
      course,
      variantsCount,
      dueDate: new Date(dueDate),
      createdBy: req.userId,
      status: requestedStatus === 'draft' ? 'draft' : 'active',
      options: {
        allowLateSubmissions: options?.allowLateSubmissions ?? true,
        lateSubmissionPenalty: options?.lateSubmissionPenalty ?? 0.1,
        autoGrade: options?.autoGrade ?? true,
        maxAttempts: options?.maxAttempts ?? 3,
        timeLimit: options?.timeLimit,
        showCorrectAnswers: options?.showCorrectAnswers ?? false,
        showFeedback: options?.showFeedback ?? true
      },
      settings: {
        customTolerance: options?.customTolerance,
        customToleranceType: options?.customToleranceType || 'absolute'
      }
    });

    await assignment.save();

    // Generate variants
    try {
      await assignment.generateVariants();
    } catch (error) {
      return res.status(400).json({
        success: false,
        message: 'Грешка при генериране на вариантите',
        error: error.message,
        detail: error.message,
      });
    }

    // Log audit
    await Audit.logOperation({
      operation: 'create_assignment',
      performedBy: req.userId,
      targetEntity: {
        type: 'assignment',
        id: assignment._id
      },
      description: `Създадено ново задание: ${assignment.title}`,
      newValues: {
        title: assignment.title,
        course: courseDoc.name,
        variantsCount: assignment.variantsCount,
        dueDate: assignment.dueDate
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'Заданието е създадено успешно',
      data: assignment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при създаване на заданието',
      error: error.message
    });
  }
});

// Update assignment
router.put('/:id', auth, requireRole('teacher'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Заданието не е намерено'
      });
    }

    // Check ownership
    if (assignment.createdBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да редактирате това задание'
      });
    }

    const oldValues = {
      title: assignment.title,
      status: assignment.status,
      dueDate: assignment.dueDate
    };

    // Update fields
    const updateFields = ['title', 'description', 'dueDate', 'options', 'settings'];
    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        assignment[field] = req.body[field];
      }
    });

    await assignment.save();

    // Log audit
    await Audit.logOperation({
      operation: 'update_assignment',
      performedBy: req.userId,
      targetEntity: {
        type: 'assignment',
        id: assignment._id
      },
      description: `Обновено задание: ${assignment.title}`,
      oldValues,
      newValues: {
        title: assignment.title,
        status: assignment.status,
        dueDate: assignment.dueDate
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Заданието е обновено успешно',
      data: assignment
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при обновяване на заданието',
      error: error.message
    });
  }
});

// Get submissions for assignment
router.get('/:id/submissions', auth, requireRole('teacher'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Заданието не е намерено'
      });
    }

    // Check ownership
    if (assignment.createdBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да видите submissions за това задание'
      });
    }

    const submissions = await Submission.find({ assignment: assignment._id })
      .populate('student', 'name email')
      .sort({ submittedAt: -1 });

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

// Grade submission manually
router.post('/:id/grade/:submissionId', auth, requireRole('teacher'), async (req, res) => {
  try {
    const { score, feedback } = req.body;

    if (score === undefined || score < 0 || score > 100) {
      return res.status(400).json({
        success: false,
        message: 'Оценката трябва да бъде между 0 и 100'
      });
    }

    const submission = await Submission.findById(req.params.submissionId)
      .populate('assignment')
      .populate('student', 'name email');

    if (!submission) {
      return res.status(404).json({
        success: false,
        message: 'Submission не е намерен'
      });
    }

    // Check if user can grade this submission
    if (submission.assignment.createdBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да оценявате този submission'
      });
    }

    const oldScore = submission.manualScore || submission.computedScore;

    submission.manualScore = score;
    submission.feedback = feedback || '';
    submission.gradingDetails.gradedBy = req.userId;
    submission.gradingDetails.gradedAt = new Date();
    submission.gradingDetails.gradingComments = feedback || '';
    submission.status = 'graded';

    await submission.save();

    // Log audit
    await Audit.logOperation({
      operation: 'grade_submission',
      performedBy: req.userId,
      targetEntity: {
        type: 'submission',
        id: submission._id
      },
      description: `Ръчно оценен submission на ${submission.student.name}`,
      oldValues: { score: oldScore },
      newValues: { score, feedback },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Submission е оценен успешно',
      data: submission
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при оценяване на submission',
      error: error.message
    });
  }
});

// Delete assignment
router.delete('/:id', auth, requireRole('teacher'), async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id);

    if (!assignment) {
      return res.status(404).json({
        success: false,
        message: 'Заданието не е намерено'
      });
    }

    // Check ownership
    if (assignment.createdBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да изтриете това задание'
      });
    }

    // Delete related submissions
    await Submission.deleteMany({ assignment: assignment._id });

    await Assignment.findByIdAndDelete(req.params.id);

    // Log audit
    await Audit.logOperation({
      operation: 'delete_assignment',
      performedBy: req.userId,
      targetEntity: {
        type: 'assignment',
        id: req.params.id
      },
      description: `Изтрито задание: ${assignment.title}`,
      oldValues: {
        title: assignment.title,
        course: assignment.course,
        variantsCount: assignment.variantsCount
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Заданието е изтрито успешно'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при изтриване на заданието',
      error: error.message
    });
  }
});

module.exports = router;