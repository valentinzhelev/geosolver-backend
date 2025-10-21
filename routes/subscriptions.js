const express = require('express');
const router = express.Router();
const Subscription = require('../models/Subscription');
const User = require('../models/User');
const Plan = require('../models/Plan');
const auth = require('../middleware/auth');

// GET /api/subscriptions - Моите абонаменти
router.get('/', auth, async (req, res) => {
  try {
    const subscriptions = await Subscription.find({ userId: req.user.id })
      .populate('planId')
      .sort({ createdAt: -1 });
    res.json(subscriptions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/subscriptions/current - Текущ абонамент
router.get('/current', auth, async (req, res) => {
  try {
    const subscription = await Subscription.findOne({ 
      userId: req.user.id, 
      status: 'active' 
    }).populate('planId');
    
    if (!subscription) {
      return res.json({ plan: null, subscription: null });
    }
    
    res.json(subscription);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/subscriptions - Създаване на абонамент
router.post('/', auth, async (req, res) => {
  try {
    const { planId, billingCycle } = req.body;
    
    // Проверка дали планът съществува
    const plan = await Plan.findById(planId);
    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }
    
    // Деактивиране на стари абонаменти
    await Subscription.updateMany(
      { userId: req.user.id, status: 'active' },
      { status: 'cancelled' }
    );
    
    // Изчисляване на дати
    const startDate = new Date();
    const endDate = new Date();
    if (billingCycle === 'yearly') {
      endDate.setFullYear(endDate.getFullYear() + 1);
    } else {
      endDate.setMonth(endDate.getMonth() + 1);
    }
    
    // Създаване на нов абонамент
    const subscription = new Subscription({
      userId: req.user.id,
      planId,
      billingCycle,
      startDate,
      endDate,
      status: 'pending'
    });
    
    await subscription.save();
    
    // Обновяване на потребителя
    await User.findByIdAndUpdate(req.user.id, {
      currentPlan: planId,
      subscriptionStatus: 'active',
      calculationsLimit: plan.limits.unlimited ? -1 : plan.limits.calculationsPerMonth
    });
    
    res.status(201).json(subscription);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/subscriptions/:id/cancel - Отмяна на абонамент
router.put('/:id/cancel', auth, async (req, res) => {
  try {
    const subscription = await Subscription.findOne({
      _id: req.params.id,
      userId: req.user.id
    });
    
    if (!subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }
    
    subscription.status = 'cancelled';
    subscription.autoRenew = false;
    await subscription.save();
    
    // Обновяване на потребителя
    await User.findByIdAndUpdate(req.user.id, {
      subscriptionStatus: 'cancelled'
    });
    
    res.json(subscription);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
