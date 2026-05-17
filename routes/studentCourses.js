const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const User = require('../models/User');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const Audit = require('../models/Audit');
const { includesId } = require('../utils/objectId');

// List courses the student is enrolled in
router.get('/', auth, async (req, res) => {
  try {
    const courses = await Course.find({ students: req.userId, isActive: { $ne: false } })
      .populate('owner', 'name email')
      .sort({ updatedAt: -1 });

    res.json({ success: true, data: courses, count: courses.length });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на групите',
      error: error.message,
    });
  }
});

// Join course by code (e.g. GEO101)
router.post('/join', auth, async (req, res) => {
  try {
    const { code } = req.body;
    if (!code || !String(code).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Въведете код на групата',
      });
    }

    const course = await Course.findOne({ code: String(code).trim().toUpperCase() });
    if (!course) {
      return res.status(404).json({
        success: false,
        message: 'Група с този код не е намерена',
      });
    }

    if (course.isActive === false) {
      return res.status(400).json({
        success: false,
        message: 'Тази група е архивирана и не приема нови ученици',
      });
    }

    if (includesId(course.students, req.userId)) {
      return res.json({
        success: true,
        message: 'Вече сте член на тази група',
        data: course,
      });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Потребителят не е намерен' });
    }

    if (user.role !== 'student' && user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Само ученически акаунти могат да се присъединяват към група',
      });
    }

    course.students.push(req.userId);
    await course.save();

    await Audit.logOperation({
      operation: 'join_course',
      performedBy: req.userId,
      targetEntity: { type: 'course', id: course._id },
      description: `Присъединяване към група ${course.name} (${course.code})`,
      newValues: { courseCode: course.code },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    res.json({
      success: true,
      message: `Успешно се присъединихте към „${course.name}"`,
      data: course,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при присъединяване',
      error: error.message,
    });
  }
});

module.exports = router;
