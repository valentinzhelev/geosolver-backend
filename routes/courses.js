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
    const courses = await Course.find({ owner: req.userId })
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

    // Check if code already exists
    const existingCourse = await Course.findOne({ code: code.toUpperCase() });
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
