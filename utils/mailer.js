const nodemailer = require('nodemailer');

function isConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

const transporter = isConfigured()
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    })
  : null;

function sendMail({ to, subject, html, replyTo }) {
  if (!transporter) {
    return Promise.reject(new Error('SMTP not configured'));
  }
  return transporter.sendMail({
    from: process.env.MAIL_FROM || 'team@geosolver.bg',
    to,
    subject,
    html,
    replyTo: replyTo || process.env.MAIL_FROM || 'team@geosolver.bg',
  });
}

module.exports = { sendMail, isConfigured }; 