const express = require('express');
const router = express.Router();
const TeacherAccessRequest = require('../models/TeacherAccessRequest');
const User = require('../models/User');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { createNotification } = require('../utils/notifications');
const { notifyAdminsTeacherRequest } = require('../utils/notificationDelivery');

router.post('/request', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Потребителят не е намерен' });
    }
    if (user.role === 'teacher' || user.role === 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Вече имате достъп като преподавател',
      });
    }

    const existing = await TeacherAccessRequest.findOne({ user: req.userId });
    if (existing) {
      if (existing.status === 'pending') {
        return res.json({
          success: true,
          message: 'Заявката вече е изпратена и чака одобрение',
          data: existing,
        });
      }
      existing.message = req.body.message || existing.message;
      existing.status = 'pending';
      existing.reviewedBy = undefined;
      existing.reviewedAt = undefined;
      existing.adminNote = '';
      await existing.save();
      return res.json({
        success: true,
        message: 'Заявката е изпратена отново',
        data: existing,
      });
    }

    const requestDoc = await TeacherAccessRequest.create({
      user: req.userId,
      message: req.body.message || '',
    });

    await notifyAdminsTeacherRequest({
      title: 'Нова заявка за преподавател',
      body: `${user.name || user.email}: ${req.body.message || '(без съобщение)'}`,
    });

    res.status(201).json({
      success: true,
      message: 'Заявката е изпратена. Ще получите известие след преглед.',
      data: requestDoc,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    const requestDoc = await TeacherAccessRequest.findOne({ user: req.userId });
    res.json({ success: true, data: requestDoc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/list', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const items = await TeacherAccessRequest.find(filter)
      .populate('user', 'name email role')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: items, count: items.length });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/admin/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Невалиден статус' });
    }

    const requestDoc = await TeacherAccessRequest.findById(req.params.id).populate('user', 'name email');
    if (!requestDoc) {
      return res.status(404).json({ success: false, message: 'Заявката не е намерена' });
    }

    requestDoc.status = status;
    requestDoc.reviewedBy = req.userId;
    requestDoc.reviewedAt = new Date();
    if (adminNote !== undefined) requestDoc.adminNote = adminNote;
    await requestDoc.save();

    if (status === 'approved') {
      await User.findByIdAndUpdate(requestDoc.user._id, { role: 'teacher' });
    }

    const title =
      status === 'approved'
        ? 'Достъп като преподавател одобрен'
        : 'Заявката за преподавател е отхвърлена';

    await createNotification({
      userId: requestDoc.user._id,
      type: 'teacher_request_update',
      title,
      body: adminNote || '',
      link: '/for-teachers',
    });

    res.json({
      success: true,
      message: status === 'approved' ? 'Потребителят е преподавател' : 'Заявката е отхвърлена',
      data: requestDoc,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
