const User = require('../models/User');
const { sendMail, isConfigured } = require('./mailer');

const EMAIL_ENABLED_TYPES = new Set([
  'assignment_created',
  'assignment_due_soon',
  'submission_received',
  'submission_graded',
  'teacher_request_update',
]);

async function sendNotificationEmail({ userId, type, title, body, link }) {
  if (!isConfigured() || !EMAIL_ENABLED_TYPES.has(type)) return;

  try {
    const user = await User.findById(userId).select('email name');
    if (!user?.email) return;

    const appUrl = process.env.APP_URL || 'https://geosolver.bg';
    const fullLink = link?.startsWith('http') ? link : `${appUrl}${link || ''}`;

    await sendMail({
      to: user.email,
      subject: `GeoSolver Edu — ${title}`,
      html: `
        <p>Здравейте${user.name ? `, ${user.name}` : ''},</p>
        <p>${body || title}</p>
        ${fullLink ? `<p><a href="${fullLink}">Отвори в GeoSolver</a></p>` : ''}
        <p style="color:#888;font-size:12px;">GeoSolver Edu</p>
      `,
    });
  } catch (err) {
    console.warn('Notification email failed:', err.message);
  }
}

async function notifyAdminsTeacherRequest({ title, body }) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !isConfigured()) return;
  try {
    await sendMail({
      to: adminEmail,
      subject: `GeoSolver — ${title}`,
      html: `<p>${body}</p><p>Прегледайте в Account → Admin.</p>`,
    });
  } catch (err) {
    console.warn('Admin email failed:', err.message);
  }
}

module.exports = { sendNotificationEmail, notifyAdminsTeacherRequest };
