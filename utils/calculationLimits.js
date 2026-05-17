const Plan = require('../models/Plan');
const Calculation = require('../models/Calculation');
const User = require('../models/User');

const DEFAULT_FREE_LIMIT = 5;

async function getFreePlanLimit() {
  const plan = await Plan.findOne({ name: 'free' });
  if (!plan) return DEFAULT_FREE_LIMIT;
  return plan.limits?.calculationsPerMonth ?? DEFAULT_FREE_LIMIT;
}

async function isUserUnlimited(userId) {
  const user = await User.findById(userId).select('plan subscriptionStatus role');
  if (!user) return false;
  if (user.role === 'admin') return true;
  return user.plan === 'pro' || ['active', 'trialing'].includes(user.subscriptionStatus);
}

/**
 * Shared limit: total calculations across all tools (free plan).
 */
async function getLimitsForUser(userId) {
  const freeLimit = await getFreePlanLimit();

  if (!userId) {
    return {
      canCalculate: false,
      used: 0,
      limit: freeLimit,
      unlimited: false,
      requiresAuth: true,
    };
  }

  const unlimited = await isUserUnlimited(userId);
  const used = await Calculation.countDocuments({
    userId,
    $or: [{ context: { $exists: false } }, { context: null }, { context: 'consumer' }],
  });

  if (unlimited) {
    return {
      canCalculate: true,
      used,
      limit: -1,
      unlimited: true,
      requiresAuth: false,
    };
  }

  return {
    canCalculate: used < freeLimit,
    used,
    limit: freeLimit,
    unlimited: false,
    requiresAuth: false,
  };
}

module.exports = {
  getLimitsForUser,
  getFreePlanLimit,
};
