/**
 * Creates Stripe products/prices and updates Plan in MongoDB.
 * Run: STRIPE_SECRET_KEY=sk_xxx node scripts/setupStripePrices.js
 */
require('dotenv').config();
const Stripe = require('stripe');
const mongoose = require('mongoose');
const Plan = require('../models/Plan');

async function setup() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    console.error('Set STRIPE_SECRET_KEY in .env');
    process.exit(1);
  }

  const stripe = new Stripe(key);

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const plan = await Plan.findOne({ name: 'professional' });
  if (!plan) {
    console.error('Professional plan not found. Run npm run setup first.');
    process.exit(1);
  }

  if (plan.stripePriceIdMonthly && plan.stripePriceIdYearly) {
    console.log('Plan already has Stripe prices. Skipping.');
    process.exit(0);
  }

  const product = await stripe.products.create({
    name: 'GeoSolver Professional',
    description: plan.displayName.en
  });
  console.log('Created product:', product.id);

  const priceMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(plan.price.monthly * 100),
    currency: 'eur',
    recurring: { interval: 'month' }
  });
  console.log('Created monthly price:', priceMonthly.id);

  const priceYearly = await stripe.prices.create({
    product: product.id,
    unit_amount: Math.round(plan.price.yearly * 100),
    currency: 'eur',
    recurring: { interval: 'year' }
  });
  console.log('Created yearly price:', priceYearly.id);

  plan.stripePriceIdMonthly = priceMonthly.id;
  plan.stripePriceIdYearly = priceYearly.id;
  await plan.save();
  console.log('Updated Plan with Stripe price IDs');
  process.exit(0);
}

setup().catch((err) => {
  console.error(err);
  process.exit(1);
});
