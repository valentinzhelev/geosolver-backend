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
      payment_method_types: ['card', 'paypal'],
      allow_promotion_codes: true,
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

// GET /api/billing/summary (AUTH REQUIRED)
router.get('/summary', auth, async (req, res) => {
  if (!stripe) {
    return res.status(503).json({ error: 'Billing is not configured' });
  }
  try {
    const user = await User.findById(req.userId).select('email stripeCustomerId stripeSubscriptionId plan subscriptionStatus currentPeriodEnd');
    if (!user?.stripeCustomerId) {
      return res.json({
        user: {
          plan: user?.plan || 'free',
          subscriptionStatus: user?.subscriptionStatus || 'free',
          currentPeriodEnd: user?.currentPeriodEnd || null
        },
        customer: null,
        subscription: null,
        paymentMethod: null,
        invoices: []
      });
    }

    const customer = await stripe.customers.retrieve(user.stripeCustomerId, {
      expand: ['invoice_settings.default_payment_method']
    });

    let subscription = null;
    if (user.stripeSubscriptionId) {
      subscription = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
        expand: ['default_payment_method']
      });
    } else {
      const list = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: 'all',
        limit: 1,
        expand: ['data.default_payment_method']
      });
      subscription = list.data?.[0] || null;
    }

    const paymentMethod =
      subscription?.default_payment_method ||
      customer?.invoice_settings?.default_payment_method ||
      null;

    const invoices = await stripe.invoices.list({
      customer: user.stripeCustomerId,
      limit: 10
    });

    res.json({
      user: {
        plan: user.plan,
        subscriptionStatus: user.subscriptionStatus,
        currentPeriodEnd: user.currentPeriodEnd
      },
      customer: customer ? { id: customer.id, email: customer.email } : null,
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            cancelAtPeriodEnd: subscription.cancel_at_period_end,
            currentPeriodStart: subscription.current_period_start ? new Date(subscription.current_period_start * 1000) : null,
            currentPeriodEnd: subscription.current_period_end ? new Date(subscription.current_period_end * 1000) : null
          }
        : null,
      paymentMethod: paymentMethod
        ? {
            brand: paymentMethod.card?.brand || null,
            last4: paymentMethod.card?.last4 || null,
            expMonth: paymentMethod.card?.exp_month || null,
            expYear: paymentMethod.card?.exp_year || null
          }
        : null,
      invoices: (invoices.data || []).map(inv => ({
        id: inv.id,
        status: inv.status,
        amountPaid: inv.amount_paid,
        amountDue: inv.amount_due,
        currency: inv.currency,
        created: inv.created,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf: inv.invoice_pdf,
        description: inv.description,
        periodStart: inv.period_start,
        periodEnd: inv.period_end
      }))
    });
  } catch (err) {
    console.error('Billing summary error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch billing summary' });
  }
});

module.exports = router;
