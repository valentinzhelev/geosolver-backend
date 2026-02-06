const User = require('../models/User');

module.exports = async function requireActiveSubscription(req, res, next) {
  try {
    const user = await User.findById(req.userId).select('plan subscriptionStatus');
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    const isPro = user.plan === 'pro' || ['active', 'trialing'].includes(user.subscriptionStatus);
    if (isPro) {
      return next();
    }
    return res.status(402).json({
      error: 'Active subscription required',
      message: 'Please subscribe to GeoSolver Pro to access this feature.'
    });
  } catch (err) {
    return res.status(500).json({ error: 'Subscription check failed' });
  }
};
