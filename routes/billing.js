const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const auth = require('../middleware/auth');
const User = require('../models/User');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://geosolver.bg';
const PRICE_ID_PRO = process.env.STRIPE_PRICE_ID_PRO;

// POST /api/billing/create-checkout-session (AUTH REQUIRED)
router.post('/create-checkout-session', auth, async (req, res) => {
  if (!stripe || !PRICE_ID_PRO) {
    return res.status(503).json({ error: 'Billing is not configured' });
  }
  try {
    const userId = req.userId;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { userId: userId.toString() }
      });
      customerId = customer.id;
      await User.findByIdAndUpdate(userId, { stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: PRICE_ID_PRO, quantity: 1 }],
      success_url: `${FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/billing/cancel`,
      customer: customerId,
      client_reference_id: userId.toString(),
      metadata: { userId: userId.toString() }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create checkout session error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create checkout session' });
  }
});

// POST /api/billing/create-portal-session (AUTH REQUIRED)
router.post('/create-portal-session', auth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Billing is not configured' });
  }
  try {
    const user = await User.findById(req.userId).select('stripeCustomerId');
    if (!user?.stripeCustomerId) {
      return res.status(400).json({ error: 'No billing customer found. Subscribe first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${FRONTEND_URL}/account`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Create portal session error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to create portal session' });
  }
});

module.exports = router;
