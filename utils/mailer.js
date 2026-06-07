const nodemailer = require('nodemailer');

const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 12000);

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
    connectionTimeout: SMTP_TIMEOUT_MS,
    greetingTimeout: SMTP_TIMEOUT_MS,
    socketTimeout: SMTP_TIMEOUT_MS,
    ...(port === 587 && !secure ? { requireTLS: true } : {}),
    tls: process.env.SMTP_TLS_REJECT_UNAUTHORIZED === 'false'
      ? { rejectUnauthorized: false }
      : undefined,
  });
}

const transporter = createTransporter();

function isSmtpConnectionError(err) {
  const code = err?.code || '';
  return ['ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND'].includes(code)
    || /timeout|timed out/i.test(err?.message || '');
}

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
    replyTo: replyTo || process.env.MAIL_REPLY_TO || 'team@geosolver.bg',
  });
}

module.exports = { sendMail, isConfigured, verifyConnection, isSmtpConnectionError };
