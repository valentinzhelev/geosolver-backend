const express = require('express');
const router = express.Router();
const FieldBookPilotRequest = require('../models/FieldBookPilotRequest');
const User = require('../models/User');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

router.post('/request', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'Потребителят не е намерен' });
    }

    if (req.userRole === 'admin') {
      return res.json({
        success: true,
        message: 'Администраторите имат пълен достъп до карнетите.',
        data: { status: 'approved' },
        access: { approved: true, status: 'approved' },
      });
    }

    const existing = await FieldBookPilotRequest.findOne({ user: req.userId });
    if (existing) {
      if (existing.status === 'pending') {
        return res.json({
          success: true,
          message: 'Заявката вече е изпратена и чака одобрение.',
          data: existing,
          access: { approved: false, status: 'pending' },
        });
      }
      if (existing.status === 'approved') {
        return res.json({
          success: true,
          message: 'Вече имате достъп до пилотната версия.',
          data: existing,
          access: { approved: true, status: 'approved' },
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
        message: 'Заявката е изпратена отново.',
        data: existing,
        access: { approved: false, status: 'pending' },
      });
    }

    const requestDoc = await FieldBookPilotRequest.create({
      user: req.userId,
      message: req.body.message || '',
    });

    res.status(201).json({
      success: true,
      message: 'Заявката за пилот е изпратена. Ще получите достъп след одобрение.',
      data: requestDoc,
      access: { approved: false, status: 'pending' },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/me', auth, async (req, res) => {
  try {
    if (req.userRole === 'admin') {
      return res.json({
        success: true,
        data: null,
        access: { approved: true, status: 'approved', isAdmin: true },
      });
    }
    const requestDoc = await FieldBookPilotRequest.findOne({ user: req.userId });
    const approved = requestDoc?.status === 'approved';
    res.json({
      success: true,
      data: requestDoc,
      access: {
        approved,
        status: requestDoc?.status || null,
        adminNote: requestDoc?.adminNote || '',
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/admin/list', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status, archived } = req.query;
    const filter = {};
    if (archived === 'true') filter.archived = true;
    else if (status) filter.status = status;
    const list = await FieldBookPilotRequest.find(filter)
      .populate('user', 'name email')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: list });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/admin/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const { status, adminNote } = req.body;
    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Невалиден статус.' });
    }
    const requestDoc = await FieldBookPilotRequest.findById(req.params.id);
    if (!requestDoc) {
      return res.status(404).json({ success: false, message: 'Заявката не е намерена.' });
    }
    requestDoc.status = status;
    requestDoc.adminNote = adminNote || '';
    requestDoc.reviewedBy = req.userId;
    requestDoc.reviewedAt = new Date();
    await requestDoc.save();
    res.json({ success: true, data: requestDoc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/admin/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    await FieldBookPilotRequest.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/admin/:id/archive', auth, requireRole('admin'), async (req, res) => {
  try {
    const requestDoc = await FieldBookPilotRequest.findByIdAndUpdate(
      req.params.id,
      { archived: true },
      { new: true }
    );
    if (!requestDoc) {
      return res.status(404).json({ success: false, message: 'Заявката не е намерена.' });
    }
    res.json({ success: true, data: requestDoc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
