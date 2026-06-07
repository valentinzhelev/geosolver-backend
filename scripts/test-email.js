#!/usr/bin/env node
/**
 * Test SMTP configuration.
 * Usage: node scripts/test-email.js [recipient@email.com]
 */
require('dotenv').config();
const { sendMail, isConfigured } = require('../utils/mailer');

const to = process.argv[2] || process.env.SMTP_USER;

if (!isConfigured()) {
  console.error('Email not configured. Set BREVO_API_KEY or SMTP_* in .env');
  process.exit(1);
}

sendMail({
  to,
  subject: 'GeoSolver — SMTP test',
  html: '<p>Ако виждате този имейл, SMTP конфигурацията работи.</p>',
})
  .then((info) => {
    console.log('Email sent to', to);
    console.log('Message ID:', info.messageId);
  })
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
