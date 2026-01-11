const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

// GET /api/users - Списък на всички потребители (admin only)
router.get('/', auth, requireRole('admin'), async (req, res) => {
  try {
    const { page = 1, limit = 50, search = '', role = '' } = req.query;
    const skip = (page - 1) * limit;
    
    // Build filter
    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role) {
      filter.role = role;
    }
    
    const users = await User.find(filter)
      .select('-password -refreshTokens -verificationToken -resetPasswordToken')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await User.countDocuments(filter);
    
    res.json({
      users,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        totalPages: Math.ceil(total / limit),
        hasNext: skip + users.length < total,
        hasPrev: page > 1,
        totalUsers: total
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/users/:id - Детайли за конкретен потребител (admin only)
router.get('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('-password -refreshTokens -verificationToken -resetPasswordToken');
    
    if (!user) {
      return res.status(404).json({ error: 'Потребителят не е намерен.' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/users/:id/role - Промяна на роля на потребител (admin only)
router.put('/:id/role', auth, requireRole('admin'), async (req, res) => {
  try {
    const { role } = req.body;
    
    if (!role || !['student', 'teacher', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Невалидна роля. Възможни стойности: student, teacher, admin' });
    }
    
    // Prevent admin from removing their own admin role
    if (req.params.id === req.userId && role !== 'admin') {
      return res.status(400).json({ error: 'Не можете да премахнете собствената си администраторска роля.' });
    }
    
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { role },
      { new: true, runValidators: true }
    ).select('-password -refreshTokens -verificationToken -resetPasswordToken');
    
    if (!user) {
      return res.status(404).json({ error: 'Потребителят не е намерен.' });
    }
    
    res.json({
      message: `Ролята на потребителя е променена на ${role}.`,
      user
    });
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/users/:id - Изтриване на потребител (admin only)
router.delete('/:id', auth, requireRole('admin'), async (req, res) => {
  try {
    // Prevent admin from deleting themselves
    if (req.params.id === req.userId) {
      return res.status(400).json({ error: 'Не можете да изтриете собствения си акаунт.' });
    }
    
    const user = await User.findByIdAndDelete(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'Потребителят не е намерен.' });
    }
    
    res.json({ message: 'Потребителят е изтрит успешно.' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
