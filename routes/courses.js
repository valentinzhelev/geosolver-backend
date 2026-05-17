const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const User = require('../models/User');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const Audit = require('../models/Audit');

// Get all courses for teacher
router.get('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const { archived } = req.query;
    const courseFilter = req.userRole === 'admin' ? {} : { owner: req.userId };
    if (archived === 'true') {
      courseFilter.isActive = false;
    } else {
      courseFilter.isActive = { $ne: false };
    }
    const courses = await Course.find(courseFilter)
      .populate('students', 'name email')
      .sort({ createdAt: -1 });

    res.json({
      success: true,
      data: courses,
      count: courses.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на курсовете',
      error: error.message
    });
  }
});

// Get single course
router.get('/:id', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('owner', 'name email')
      .populate('students', 'name email role');

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен'
      });
    }

    // Check access permissions
    const isOwner = course.owner._id.toString() === req.userId;
    const isStudent = course.students.some(student => student._id.toString() === req.userId);
    const isAdmin = req.userRole === 'admin';

    if (!isOwner && !isStudent && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до този курс'
      });
    }

    res.json({
      success: true,
      data: course
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на курса',
      error: error.message
    });
  }
});

// Create new course
router.post('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const { name, code, description, settings } = req.body;

    // Validate required fields
    if (!name || !code) {
      return res.status(400).json({
        success: false,
        message: 'Името и кодът на курса са задължителни'
      });
    }

    // Check if code already exists among active groups (archived codes can be reused)
    const existingCourse = await Course.findOne({
      code: code.toUpperCase(),
      isActive: { $ne: false },
    });
    if (existingCourse) {
      return res.status(400).json({
        success: false,
        message: 'Курс с този код вече съществува'
      });
    }

    const course = new Course({
      name,
      code: code.toUpperCase(),
      description: description || '',
      owner: req.userId,
      students: [],
      assignments: [],
      settings: {
        allowLateSubmissions: settings?.allowLateSubmissions ?? true,
        lateSubmissionPenalty: settings?.lateSubmissionPenalty ?? 0.1,
        autoGrade: settings?.autoGrade ?? true
      }
    });

    await course.save();

    // Log audit
    await Audit.logOperation({
      operation: 'create_course',
      performedBy: req.userId,
      targetEntity: {
        type: 'course',
        id: course._id
      },
      description: `Създаден нов курс: ${course.name} (${course.code})`,
      newValues: {
        name: course.name,
        code: course.code,
        description: course.description
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'Курсът е създаден успешно',
      data: course
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при създаване на курса',
      error: error.message
    });
  }
});

// Update course
router.put('/:id', auth, requireRole('teacher'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен'
      });
    }

    // Check ownership
    if (course.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да редактирате този курс'
      });
    }

    const oldValues = {
      name: course.name,
      code: course.code,
      description: course.description
    };

    // Update fields
    const updateFields = ['name', 'code', 'description', 'settings'];
    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        course[field] = req.body[field];
      }
    });

    // If code is being changed, check for uniqueness
    if (req.body.code && req.body.code !== oldValues.code) {
      const existingCourse = await Course.findOne({ 
        code: req.body.code.toUpperCase(),
        _id: { $ne: course._id }
      });
      if (existingCourse) {
        return res.status(400).json({
          success: false,
          message: 'Курс с този код вече съществува'
        });
      }
      course.code = req.body.code.toUpperCase();
    }

    await course.save();

    // Log audit
    await Audit.logOperation({
      operation: 'update_course',
      performedBy: req.userId,
      targetEntity: {
        type: 'course',
        id: course._id
      },
      description: `Обновен курс: ${course.name} (${course.code})`,
      oldValues,
      newValues: {
        name: course.name,
        code: course.code,
        description: course.description
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Курсът е обновен успешно',
      data: course
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при обновяване на курса',
      error: error.message
    });
  }
});

// Add students to course
router.post('/:id/add-students', auth, requireRole('teacher'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен'
      });
    }

    // Check ownership
    if (course.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да добавяте студенти към този курс'
      });
    }

    const { studentEmails, studentIds } = req.body;
    const studentsToAdd = [];

    // Add by email
    if (studentEmails && studentEmails.length > 0) {
      for (const email of studentEmails) {
        const student = await User.findOne({ email, role: 'student' });
        if (student && !course.students.includes(student._id)) {
          studentsToAdd.push(student._id);
        }
      }
    }

    // Add by ID
    if (studentIds && studentIds.length > 0) {
      for (const studentId of studentIds) {
        const student = await User.findOne({ _id: studentId, role: 'student' });
        if (student && !course.students.includes(student._id)) {
          studentsToAdd.push(student._id);
        }
      }
    }

    // Add students to course
    course.students.push(...studentsToAdd);
    await course.save();

    // Log audit
    await Audit.logOperation({
      operation: 'add_student',
      performedBy: req.userId,
      targetEntity: {
        type: 'course',
        id: course._id
      },
      description: `Добавени ${studentsToAdd.length} студенти към курс: ${course.name}`,
      newValues: {
        addedStudents: studentsToAdd.length
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: `Добавени ${studentsToAdd.length} студенти към курса`,
      data: {
        addedCount: studentsToAdd.length,
        totalStudents: course.students.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при добавяне на студенти',
      error: error.message
    });
  }
});

// Remove student from course
router.delete('/:id/students/:studentId', auth, requireRole('teacher'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен'
      });
    }

    // Check ownership
    if (course.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да премахвате студенти от този курс'
      });
    }

    const studentId = req.params.studentId;
    const initialLength = course.students.length;
    
    course.students = course.students.filter(id => !id.equals(studentId));
    
    if (course.students.length === initialLength) {
      return res.status(404).json({
        success: false,
        message: 'Студентът не е намерен в курса'
      });
    }

    await course.save();

    // Log audit
    await Audit.logOperation({
      operation: 'remove_student',
      performedBy: req.userId,
      targetEntity: {
        type: 'course',
        id: course._id
      },
      description: `Премахнат студент от курс: ${course.name}`,
      oldValues: {
        studentId: studentId
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Студентът е премахнат от курса',
      data: {
        totalStudents: course.students.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при премахване на студента',
      error: error.message
    });
  }
});

// Archive / restore course (soft remove — isActive: false)
router.patch('/:id/status', auth, requireRole('teacher'), async (req, res) => {
  try {
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'Подайте isActive: true или false',
      });
    }

    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен',
      });
    }

    if (course.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права',
      });
    }

    course.isActive = isActive;
    await course.save();

    try {
      await Audit.logOperation({
        operation: isActive ? 'restore_course' : 'archive_course',
        performedBy: req.userId,
        targetEntity: { type: 'course', id: course._id },
        description: isActive
          ? `Възстановена група: ${course.name} (${course.code})`
          : `Архивирана група: ${course.name} (${course.code})`,
        newValues: { isActive },
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      });
    } catch (auditErr) {
      console.warn('Audit log failed (course status):', auditErr.message);
    }

    res.json({
      success: true,
      message: isActive ? 'Групата е възстановена' : 'Групата е архивирана',
      data: course,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при промяна на статуса на групата',
      error: error.message,
    });
  }
});

// Delete course
router.delete('/:id', auth, requireRole('teacher'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен'
      });
    }

    // Check ownership
    if (course.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да изтриете този курс'
      });
    }

    await Course.findByIdAndDelete(req.params.id);

    // Log audit
    await Audit.logOperation({
      operation: 'delete_course',
      performedBy: req.userId,
      targetEntity: {
        type: 'course',
        id: req.params.id
      },
      description: `Изтрит курс: ${course.name} (${course.code})`,
      oldValues: {
        name: course.name,
        code: course.code,
        studentCount: course.students.length
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Курсът е изтрит успешно'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при изтриване на курса',
      error: error.message
    });
  }
});

// Export all grades for a course (CSV)
router.get('/:id/export-grades', auth, requireRole('teacher'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course) {
      return res.status(404).json({ success: false, message: 'Курсът не е намерен' });
    }
    if (course.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Нямате права' });
    }

    const Assignment = require('../models/Assignment');
    const Submission = require('../models/Submission');
    const User = require('../models/User');

    const assignments = await Assignment.find({ course: course._id, status: { $ne: 'archived' } });
    const students = await User.find({ _id: { $in: course.students } }).select('name email');

    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = [
      ['Група', 'Ученик', 'Имейл', 'Задание', 'Статус', 'Точки', 'Късно', 'Предадено'].join(','),
    ];

    for (const student of students) {
      for (const a of assignments) {
        const sub = await Submission.findOne({ assignment: a._id, student: student._id }).sort({
          submittedAt: -1,
        });
        rows.push(
          [
            escape(course.name),
            escape(student.name),
            escape(student.email),
            escape(a.title),
            escape(sub?.status || 'not_submitted'),
            sub?.finalScore != null ? sub.finalScore : '',
            sub?.isLate ? 'да' : 'не',
            sub?.submittedAt ? new Date(sub.submittedAt).toISOString() : '',
          ].join(',')
        );
      }
    }

    const csv = '\uFEFF' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="group-${course.code}-grades.csv"`);
    res.send(csv);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// Group analytics (per assignment + student summary)
router.get('/:id/analytics', auth, requireRole('teacher'), async (req, res) => {
  try {
    const course = await Course.findById(req.params.id).populate('students', 'name email');
    if (!course) {
      return res.status(404).json({ success: false, message: 'Курсът не е намерен' });
    }
    if (course.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Нямате достъп' });
    }

    const Assignment = require('../models/Assignment');
    const Submission = require('../models/Submission');

    const assignments = await Assignment.find({
      course: course._id,
      status: { $in: ['active', 'completed'] },
    }).select('title dueDate status statistics');

    const assignmentIds = assignments.map((a) => a._id);
    const submissions = await Submission.find({ assignment: { $in: assignmentIds } })
      .populate('student', 'name email')
      .select('student assignment finalScore status isLate submittedAt');

    const byAssignment = assignments.map((a) => {
      const subs = submissions.filter((s) => s.assignment.toString() === a._id.toString());
      const graded = subs.filter((s) => s.status === 'graded' || s.finalScore != null);
      const avg =
        graded.length > 0
          ? graded.reduce((sum, s) => sum + (s.finalScore || 0), 0) / graded.length
          : 0;
      const studentCount = course.students.length;
      const submittedStudents = new Set(subs.map((s) => s.student._id.toString())).size;
      return {
        assignmentId: a._id,
        title: a.title,
        dueDate: a.dueDate,
        status: a.status,
        submissionCount: subs.length,
        submittedStudents,
        completionRate: studentCount > 0 ? (submittedStudents / studentCount) * 100 : 0,
        averageScore: Math.round(avg * 10) / 10,
        lateCount: subs.filter((s) => s.isLate).length,
        needsReview: subs.filter((s) => s.status === 'needs_review').length,
      };
    });

    const studentSummaries = (course.students || []).map((student) => {
      const sid = student._id.toString();
      const studentSubs = submissions.filter((s) => s.student._id.toString() === sid);
      const scores = studentSubs.filter((s) => s.finalScore != null).map((s) => s.finalScore);
      const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
      return {
        studentId: student._id,
        name: student.name,
        email: student.email,
        submissions: studentSubs.length,
        averageScore: avg != null ? Math.round(avg * 10) / 10 : null,
      };
    });

    res.json({
      success: true,
      data: {
        course: { id: course._id, name: course.name, code: course.code, studentCount: course.students.length },
        assignments: byAssignment,
        students: studentSummaries,
        totals: {
          assignments: assignments.length,
          submissions: submissions.length,
          averageScore:
            submissions.length > 0
              ? Math.round(
                  (submissions.reduce((s, x) => s + (x.finalScore || 0), 0) / submissions.length) * 10
                ) / 10
              : 0,
        },
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при аналитиката',
      error: error.message,
    });
  }
});

// Get course statistics
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Курсът не е намерен'
      });
    }

    // Check access permissions
    const isOwner = course.owner.toString() === req.userId;
    const isAdmin = req.userRole === 'admin';

    if (!isOwner && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до статистиките на този курс'
      });
    }

    // Get course statistics
    const Assignment = require('../models/Assignment');
    const Submission = require('../models/Submission');

    const assignments = await Assignment.find({ course: course._id });
    const submissions = await Submission.find({ 
      assignment: { $in: assignments.map(a => a._id) }
    });

    const stats = {
      totalStudents: course.students.length,
      totalAssignments: assignments.length,
      totalSubmissions: submissions.length,
      averageScore: submissions.length > 0 
        ? submissions.reduce((sum, s) => sum + s.finalScore, 0) / submissions.length 
        : 0,
      completionRate: course.students.length > 0 
        ? (submissions.length / (course.students.length * assignments.length)) * 100 
        : 0
    };

    res.json({
      success: true,
      data: stats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на статистиките',
      error: error.message
    });
  }
});

module.exports = router;
