const express = require('express');
const router = express.Router();
const Payment = require('../models/Payment');
const User = require('../models/User');
const auth = require('../middleware/auth');

// GET /api/payments - История на плащанията
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;
    
    const payments = await Payment.find({ userId: req.user.id })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const total = await Payment.countDocuments({ userId: req.user.id });
    
    res.json({
      payments,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + payments.length < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/payments/stats - Статистики за плащания
router.get('/stats', auth, async (req, res) => {
  try {
    const totalSpent = await Payment.aggregate([
      { $match: { userId: req.user._id, status: 'completed' } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    const monthlySpent = await Payment.aggregate([
      { 
        $match: { 
          userId: req.user._id, 
          status: 'completed',
          createdAt: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
        } 
      },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    
    res.json({
      totalSpent: totalSpent[0]?.total || 0,
      monthlySpent: monthlySpent[0]?.total || 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/payments - Създаване на плащане
router.post('/', auth, async (req, res) => {
  try {
    const { amount, currency, paymentMethod, subscriptionId, description } = req.body;
    
    const payment = new Payment({
      userId: req.user.id,
      subscriptionId,
      amount,
      currency,
      paymentMethod,
      description,
      status: 'pending'
    });
    
    await payment.save();
    res.status(201).json(payment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/payments/:id/status - Обновяване на статус на плащане
router.put('/:id/status', auth, async (req, res) => {
  try {
    const { status, failureReason } = req.body;
    
    const payment = await Payment.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }
    
    payment.status = status;
    if (failureReason) payment.failureReason = failureReason;
    
    await payment.save();
    res.json(payment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
