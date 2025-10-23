const express = require('express');
const router = express.Router();
const Calculation = require('../models/Calculation');
const User = require('../models/User');
const auth = require('../middleware/auth');

// POST /api/calculations - Записване на изчисление
router.post('/', async (req, res) => {
  try {
    const { toolName, toolDisplayName, inputData, resultData, calculationTime } = req.body;
    
    // Check if user is authenticated
    const token = req.header('Authorization')?.replace('Bearer ', '');
    let userId = null;
    
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        userId = decoded.id;
      } catch (jwtError) {
        console.log('Invalid token, saving as anonymous calculation');
      }
    }
    
    // Записване на изчислението
    const calculation = new Calculation({
      userId: userId, // Can be null for anonymous users
      toolName,
      toolDisplayName,
      inputData,
      resultData,
      calculationTime,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    await calculation.save();
    
    res.status(201).json(calculation);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations - История на изчисленията
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, toolName } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = { userId: req.user.id };
    if (toolName) filter.toolName = toolName;
    
    const calculations = await Calculation.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-inputData -resultData'); // Не включваме големите данни
    
    const total = await Calculation.countDocuments(filter);
    
    res.json({
      calculations,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit),
        hasNext: skip + calculations.length < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations/stats - Статистики за изчисления
router.get('/stats', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Общ брой изчисления
    const totalCalculations = await Calculation.countDocuments({ userId: req.user.id });
    
    // Изчисления за този месец
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthlyCalculations = await Calculation.countDocuments({
      userId: req.user.id,
      createdAt: { $gte: startOfMonth }
    });
    
    // Изчисления по инструменти
    const calculationsByTool = await Calculation.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { _id: '$toolName', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    res.json({
      totalCalculations,
      monthlyCalculations,
      calculationsByTool,
      userLimits: {
        used: user.calculationsUsed,
        limit: user.calculationsLimit,
        unlimited: user.subscriptionStatus === 'active'
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations/limits - Проверка на лимити
router.get('/limits', async (req, res) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');
    let userId = null;
    
    if (token) {
      try {
        const jwt = require('jsonwebtoken');
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
        userId = decoded.id;
      } catch (jwtError) {
        console.log('Invalid token, using anonymous limits');
      }
    }

    // Get free plan limits
    const Plan = require('../models/Plan');
    const plan = await Plan.findOne({ name: 'free' });
    
    if (!plan) {
      return res.status(500).json({ error: 'Free plan not found' });
    }

    // Count today's calculations
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    let todayCalculations = 0;
    
    if (userId) {
      // For logged users, count by userId
      todayCalculations = await Calculation.countDocuments({
        userId: userId,
        createdAt: {
          $gte: today,
          $lt: tomorrow
        }
      });
    } else {
      // For anonymous users, count by IP
      todayCalculations = await Calculation.countDocuments({
        userId: null,
        ipAddress: req.ip,
        createdAt: {
          $gte: today,
          $lt: tomorrow
        }
      });
    }

    const canCalculate = plan.limits.unlimited || todayCalculations < plan.limits.calculationsPerDay;

    res.json({
      canCalculate,
      used: todayCalculations,
      limit: plan.limits.calculationsPerDay,
      unlimited: plan.limits.unlimited,
      planName: plan.name
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
