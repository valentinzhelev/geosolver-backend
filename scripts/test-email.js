#!/usr/bin/env node
/**
 * Test SMTP configuration.
 * Usage: node scripts/test-email.js [recipient@email.com]
 */
require('dotenv').config();
const { sendMail, isConfigured } = require('../utils/mailer');
const { resetPasswordEmail } = require('../utils/emailTemplates');

const to = process.argv[2] || process.env.SMTP_USER;

if (!isConfigured()) {
  console.error('Email not configured. Set BREVO_API_KEY or SMTP_* in .env');
  process.exit(1);
}

const mail = resetPasswordEmail({
  name: 'Тест',
  resetUrl: `${(process.env.FRONTEND_URL || 'https://www.geosolver.bg').replace(/\/$/, '')}/reset-password?token=preview`,
});

sendMail({
  to,
  subject: mail.subject,
  html: mail.html,
  tags: ['test'],
})
  .then((info) => {
    console.log('Email sent to', to);
    console.log('Message ID:', info.messageId);
  })
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  });
