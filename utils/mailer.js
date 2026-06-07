const nodemailer = require('nodemailer');

const SMTP_TIMEOUT_MS = Number(process.env.SMTP_TIMEOUT_MS || 12000);
const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email';

function hasBrevoApi() {
  return !!(process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim());
}

function hasSmtp() {
  return !!(
    process.env.SMTP_HOST &&
    process.env.SMTP_PORT &&
    process.env.SMTP_USER &&
    process.env.SMTP_PASS
  );
}

function isConfigured() {
  return hasBrevoApi() || hasSmtp();
}

function parseFromAddress(fromStr) {
  const raw = fromStr || 'GeoSolver <team@geosolver.bg>';
  const match = raw.match(/<([^>]+)>/);
  if (match) {
    const email = match[1].trim();
    const name = raw.replace(/<[^>]+>/, '').trim() || 'GeoSolver';
    return { name, email };
  }
  return { name: 'GeoSolver', email: raw.trim() };
}

/** Brevo requires a verified sender. Use BREVO_SENDER_EMAIL until geosolver.bg domain is verified. */
function getBrevoSender() {
  const verified = process.env.BREVO_SENDER_EMAIL?.trim();
  if (verified) {
    return {
      name: process.env.BREVO_SENDER_NAME?.trim() || 'GeoSolver',
      email: verified,
    };
  }
  return parseFromAddress(process.env.MAIL_FROM);
}

function createTransporter() {
  if (!hasSmtp()) return null;
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

function isEmailDeliveryError(err) {
  return isSmtpConnectionError(err) || err?.code === 'BREVO_API_ERROR';
}

function htmlToPlainText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function sendViaBrevoApi({ to, subject, html, replyTo, tags = ['transactional'] }) {
  const sender = getBrevoSender();
  const body = {
    sender,
    to: [{ email: to }],
    subject,
    htmlContent: html,
    textContent: htmlToPlainText(html),
    tags,
  };
  const reply = replyTo || process.env.MAIL_REPLY_TO;
  if (reply) body.replyTo = { email: reply };

  const res = await fetch(BREVO_API_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': process.env.BREVO_API_KEY.trim(),
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.error('Brevo API error:', res.status, text.slice(0, 300));
    const err = new Error(`Brevo API ${res.status}: ${text.slice(0, 200)}`);
    err.code = 'BREVO_API_ERROR';
    throw err;
  }

  let messageId = `brevo-${Date.now()}`;
  try {
    const data = JSON.parse(text);
    if (data.messageId) messageId = data.messageId;
  } catch {
    // 204 empty body is ok
  }
  console.log('Brevo email queued:', { to, from: sender.email, messageId });
  return { messageId };
}

async function sendViaSmtp({ to, subject, html, replyTo }) {
  if (!transporter) {
    throw new Error('SMTP not configured');
  }
  return transporter.sendMail({
    from: process.env.MAIL_FROM || 'GeoSolver <team@geosolver.bg>',
    to,
    subject,
    html,
    replyTo: replyTo || process.env.MAIL_REPLY_TO || 'team@geosolver.bg',
  });
}

async function verifyConnection() {
  if (hasBrevoApi()) return true;
  if (!transporter) throw new Error('Email not configured');
  return transporter.verify();
}

async function sendMail({ to, subject, html, replyTo, tags }) {
  if (!isConfigured()) {
    throw new Error('Email not configured');
  }
  // Prefer Brevo HTTP API on cloud hosts (Railway blocks outbound SMTP ports).
  if (hasBrevoApi()) {
    return sendViaBrevoApi({ to, subject, html, replyTo, tags });
  }
  return sendViaSmtp({ to, subject, html, replyTo });
}

module.exports = {
  sendMail,
  isConfigured,
  verifyConnection,
  isSmtpConnectionError,
  isEmailDeliveryError,
};
