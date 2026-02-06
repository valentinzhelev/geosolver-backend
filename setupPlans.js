require('dotenv').config();
const mongoose = require('mongoose');
const Plan = require('./models/Plan');

const plans = [
  {
    name: 'free',
    displayName: {
      bg: 'Безплатен план',
      en: 'Free Plan'
    },
    price: {
      monthly: 0,
      yearly: 0
    },
    features: [
      { bg: 'Основен достъп до всички инструменти', en: 'Basic access to all tools' },
      { bg: '5 изчисления с всеки инструмент на месец', en: '5 calculations with each tool per month' }
    ],
    limits: {
      calculationsPerMonth: 5,
      calculationsPerTool: 5,
      unlimited: false
    },
    isActive: true,
    isRecommended: false
  },
  {
    name: 'professional',
    displayName: {
      bg: 'Професионален план',
      en: 'Professional Plan'
    },
    price: {
      monthly: 19.99,
      yearly: 191.90
    },
    features: [
      { bg: 'Неограничени изчисления', en: 'Unlimited calculations' },
      { bg: 'Приоритетна поддръжка', en: 'Priority support' },
      { bg: 'Допълнителни функции', en: 'Additional features' }
    ],
    limits: {
      calculationsPerMonth: -1,
      calculationsPerTool: -1,
      unlimited: true
    },
    isActive: true,
    isRecommended: true
  },
  {
    name: 'custom',
    displayName: {
      bg: 'Персонализиран план',
      en: 'Custom Plan'
    },
    price: {
      monthly: 0,
      yearly: 0
    },
    features: [
      { bg: 'Персонализирани решения', en: 'Custom solutions' },
      { bg: 'API достъп', en: 'API access' }
    ],
    limits: {
      calculationsPerMonth: -1,
      calculationsPerTool: -1,
      unlimited: true
    },
    isActive: true,
    isRecommended: false
  }
];

async function setupPlans() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    
    console.log('Connected to MongoDB');
    
    // Clear existing plans
    await Plan.deleteMany({});
    console.log('Cleared existing plans');
    
    // Insert new plans
    for (const planData of plans) {
      const plan = new Plan(planData);
      await plan.save();
      console.log(`Created plan: ${planData.displayName.en}`);
    }
    
    console.log('All plans created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error setting up plans:', error);
    process.exit(1);
  }
}

setupPlans();
