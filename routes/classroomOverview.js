const express = require('express');
const router = express.Router();
const Course = require('../models/Course');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

router.get('/overview', auth, requireRole('teacher'), async (req, res) => {
  try {
    const isAdmin = req.userRole === 'admin';
    const courseFilter = isAdmin ? {} : { owner: req.userId };
    courseFilter.isActive = { $ne: false };
    const courses = await Course.find(courseFilter).select('_id name code students');
    const courseIds = courses.map((c) => c._id);

    const totalStudents = courses.reduce((sum, c) => sum + (c.students?.length || 0), 0);

    const assignmentFilter = { course: { $in: courseIds } };
    if (!isAdmin) {
      assignmentFilter.createdBy = req.userId;
    }
    const assignments = await Assignment.find(assignmentFilter).select(
      '_id title status dueDate course statistics'
    );

    const activeAssignments = assignments.filter((a) => a.status === 'active').length;

    const assignmentIds = assignments.map((a) => a._id);
    const pendingSubmissions = await Submission.countDocuments({
      assignment: { $in: assignmentIds },
      status: { $in: ['submitted', 'needs_review'] },
    });

    const now = new Date();
    const dueSoon = assignments.filter(
      (a) => a.status === 'active' && a.dueDate && a.dueDate > now && a.dueDate - now < 48 * 60 * 60 * 1000
    ).length;

    const recentSubmissions = await Submission.find({
      assignment: { $in: assignmentIds },
    })
      .populate('student', 'name email')
      .populate('assignment', 'title')
      .sort({ submittedAt: -1 })
      .limit(8);

    res.json({
      success: true,
      data: {
        totalGroups: courses.length,
        totalStudents,
        totalAssignments: assignments.length,
        activeAssignments,
        pendingReviews: pendingSubmissions,
        dueSoon,
        recentActivity: recentSubmissions.map((s) => ({
          id: s._id,
          studentName: s.student?.name || '—',
          assignmentTitle: s.assignment?.title || '—',
          score: s.finalScore,
          status: s.status,
          submittedAt: s.submittedAt,
        })),
        groups: courses.map((c) => ({
          id: c._id.toString(),
          _id: c._id,
          name: c.name,
          code: c.code,
          studentCount: c.students?.length || 0,
        })),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на обзора',
      error: error.message,
    });
  }
});

module.exports = router;
