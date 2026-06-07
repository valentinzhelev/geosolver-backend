const nodemailer = require('nodemailer');

function isConfigured() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function createTransporter() {
  if (!isConfigured()) return null;
  const port = Number(process.env.SMTP_PORT);
  const secure = process.env.SMTP_SECURE === 'true';
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    // Port 587 STARTTLS
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
    // Self-signed certs on some shared hosts
    tls: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false'
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

const transporter = createTransporter();

async function verifyConnection() {
  if (!transporter) throw new Error('SMTP not configured');
  return transporter.verify();
}

function sendMail({ to, subject, html, replyTo }) {
  if (!transporter) {
    return Promise.reject(new Error('SMTP not configured'));
  }
  return transporter.sendMail({
    from: process.env.MAIL_FROM || 'GeoSolver <team@geosolver.bg>',
    to,
    subject,
    html,
    replyTo: replyTo || process.env.MAIL_REPLY_TO || process.env.MAIL_FROM || 'team@geosolver.bg',
  });
}

module.exports = { sendMail, isConfigured, verifyConnection };
