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
      existing.archived = false;
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
    const { status, archived } = req.query;
    let filter = {};
    if (archived === 'true') {
      filter.archived = true;
    } else {
      filter.archived = { $ne: true };
      if (status) filter.status = status;
    }
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
    const { status, adminNote, archived } = req.body;

    const requestDoc = await TeacherAccessRequest.findById(req.params.id).populate('user', 'name email');
    if (!requestDoc) {
      return res.status(404).json({ success: false, message: 'Заявката не е намерена' });
    }

    if (archived === true) {
      requestDoc.archived = true;
      await requestDoc.save();
      return res.json({
        success: true,
        message: 'Заявката е архивирана',
        data: requestDoc,
      });
    }

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Невалиден статус' });
    }

    if (status === 'rejected') {
      const note = String(adminNote || '').trim();
      if (note.length < 3) {
        return res.status(400).json({
          success: false,
          message: 'Посочете причина за отказ (минимум 3 символа)',
        });
      }
      requestDoc.adminNote = note;
    } else if (adminNote !== undefined) {
      requestDoc.adminNote = String(adminNote).trim();
    }

    requestDoc.status = status;
    requestDoc.archived = false;
    requestDoc.reviewedBy = req.userId;
    requestDoc.reviewedAt = new Date();
    await requestDoc.save();

    if (status === 'approved') {
      await User.findByIdAndUpdate(requestDoc.user._id, { role: 'teacher' });
    }

    const title =
      status === 'approved'
        ? 'Достъп като преподавател одобрен'
        : 'Заявката за преподавател е отхвърлена';

    const notifyBody =
      status === 'rejected'
        ? requestDoc.adminNote
        : requestDoc.adminNote || '';

    await createNotification({
      userId: requestDoc.user._id,
      type: 'teacher_request_update',
      title,
      body: notifyBody,
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

router.delete('/admin/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const requestDoc = await TeacherAccessRequest.findById(req.params.id);
    if (!requestDoc) {
      return res.status(404).json({ success: false, message: 'Заявката не е намерена' });
    }
    if (requestDoc.status === 'approved') {
      return res.status(400).json({
        success: false,
        message:
          'Одобрените заявки не се изтриват. Променете ролята на потребителя от админ панела, ако трябва.',
      });
    }
    await TeacherAccessRequest.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Заявката е изтрита. Потребителят може да подаде нова.' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
