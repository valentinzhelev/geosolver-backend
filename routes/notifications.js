const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res) => {
  try {
    const { limit = 30, unreadOnly } = req.query;
    const filter = { user: req.userId };
    if (unreadOnly === 'true') filter.read = false;

    const notifications = await Notification.find(filter)
      .sort({ createdAt: -1 })
      .limit(Math.min(parseInt(limit, 10) || 30, 100));

    const unreadCount = await Notification.countDocuments({ user: req.userId, read: false });

    res.json({ success: true, data: notifications, unreadCount });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/read-all', auth, async (req, res) => {
  try {
    await Notification.updateMany({ user: req.userId, read: false }, { read: true });
    res.json({ success: true, message: 'Всички известия са прочетени' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/:id/read', auth, async (req, res) => {
  try {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.userId },
      { read: true },
      { new: true }
    );
    if (!n) {
      return res.status(404).json({ success: false, message: 'Известието не е намерено' });
    }
    res.json({ success: true, data: n });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
