const express = require('express');
const router = express.Router();
const Calculation = require('../models/Calculation');
const User = require('../models/User');
const auth = require('../middleware/auth');

// POST /api/calculations - Save calculation
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
    
    // Save calculation
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

// GET /api/calculations - Calculation history
router.get('/', auth, async (req, res) => {
  try {
    const { page = 1, limit = 10, toolName, month, year } = req.query;
    const skip = (page - 1) * limit;
    
    const filter = { userId: req.user.id };
    if (toolName) filter.toolName = toolName;
    
    // Filter by month only when requested
    if (month != null || year != null) {
      const now = new Date();
      const targetMonth = month != null ? parseInt(month) : now.getMonth();
      const targetYear = year != null ? parseInt(year) : now.getFullYear();
      
      const startOfMonth = new Date(targetYear, targetMonth, 1);
      startOfMonth.setHours(0, 0, 0, 0);
      const endOfMonth = new Date(targetYear, targetMonth + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);
      
      filter.createdAt = {
        $gte: startOfMonth,
        $lte: endOfMonth
      };
    }
    
    const calculations = await Calculation.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .select('-inputData -resultData');
    
    const total = await Calculation.countDocuments(filter);
    
    res.json({
      calculations,
      pagination: {
        current: parseInt(page),
        total: Math.ceil(total / limit), // Total pages
        totalItems: total, // Total number of calculations
        hasNext: skip + calculations.length < total,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/calculations/stats - Calculation statistics
router.get('/stats', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Total calculations count
    const totalCalculations = await Calculation.countDocuments({ userId: req.user.id });
    
    // Calculations for this month
    const startOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const monthlyCalculations = await Calculation.countDocuments({
      userId: req.user.id,
      createdAt: { $gte: startOfMonth }
    });
    
    // Calculations by tool
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

// GET /api/calculations/limits - Check limits
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

    let totalCalculations = 0;
    
    if (userId) {
      // For logged users, count all-time calculations
      totalCalculations = await Calculation.countDocuments({
        userId: userId
      });
    } else {
      // For anonymous users, count all-time by IP
      totalCalculations = await Calculation.countDocuments({
        userId: null,
        ipAddress: req.ip
      });
    }

    // Check if user has Pro (Stripe subscription)
    let unlimited = plan.limits.unlimited;
    if (userId) {
      const user = await User.findById(userId).select('plan subscriptionStatus');
      if (user?.plan === 'pro' || ['active', 'trialing'].includes(user?.subscriptionStatus)) {
        unlimited = true;
      }
    }
    const limit = unlimited ? -1 : (plan.limits.calculationsPerMonth || plan.limits.calculationsPerDay || 5);
    const canCalculate = unlimited || totalCalculations < limit;

    res.json({
      canCalculate,
      used: totalCalculations,
      limit: unlimited ? -1 : limit,
      unlimited,
      planName: plan.name
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
