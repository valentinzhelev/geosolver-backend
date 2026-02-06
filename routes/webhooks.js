const express = require('express');
const router = express.Router();
const Stripe = require('stripe');
const User = require('../models/User');
const StripeEvent = require('../models/StripeEvent');

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

// POST /api/webhooks/stripe - NO AUTH, raw body, signature verified
async function stripeWebhookHandler(req, res) {
  if (!stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).send('Stripe webhook not configured');
  }

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: skip if already processed
  try {
    const existing = await StripeEvent.findOne({ stripeEventId: event.id });
    if (existing) {
      return res.status(200).json({ received: true });
    }
    await StripeEvent.create({ stripeEventId: event.id });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(200).json({ received: true });
    }
    console.error('StripeEvent idempotency error:', err);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.userId || session.client_reference_id;
        if (!userId) break;

        const updates = {
          stripeCustomerId: session.customer,
          stripeSubscriptionId: session.subscription,
          plan: 'pro',
          subscriptionStatus: 'active'
        };

        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          updates.currentPeriodEnd = new Date(sub.current_period_end * 1000);
        }

        await User.findByIdAndUpdate(userId, updates);
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const status = sub.status;
        const periodEnd = new Date(sub.current_period_end * 1000);
        const plan = ['active', 'trialing'].includes(status) ? 'pro' : 'free';

        await User.updateMany(
          { $or: [{ stripeCustomerId: sub.customer }, { stripeSubscriptionId: sub.id }] },
          {
            stripeSubscriptionId: sub.id,
            subscriptionStatus: status,
            currentPeriodEnd: periodEnd,
            plan
          }
        );
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await User.updateMany(
          { stripeSubscriptionId: sub.id },
          {
            subscriptionStatus: 'canceled',
            plan: 'free',
            stripeSubscriptionId: null,
            currentPeriodEnd: null
          }
        );
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await User.updateMany(
          { stripeCustomerId: invoice.customer },
          { subscriptionStatus: 'past_due' }
        );
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription);
          if (['active', 'trialing'].includes(sub.status)) {
            await User.updateMany(
              { stripeSubscriptionId: invoice.subscription },
              {
                subscriptionStatus: sub.status,
                plan: 'pro',
                currentPeriodEnd: new Date(sub.current_period_end * 1000)
              }
            );
          }
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }

  res.status(200).json({ received: true });
}

router.post('/stripe', stripeWebhookHandler);
module.exports = { stripeWebhookHandler, router };
