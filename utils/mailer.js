const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

function sendMail({ to, subject, html, replyTo }) {
  return transporter.sendMail({
    from: process.env.MAIL_FROM || 'team@geosolver.bg',
    to,
    subject,
    html,
    replyTo: replyTo || process.env.MAIL_FROM || 'team@geosolver.bg',
  });
}

module.exports = { sendMail }; 