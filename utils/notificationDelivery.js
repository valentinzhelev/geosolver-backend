const User = require('../models/User');
const { sendMail, isConfigured } = require('./mailer');
const { notificationEmail, adminNotificationEmail } = require('./emailTemplates');

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

    const mail = notificationEmail({
      name: user.name,
      title,
      body: body || title,
      link,
    });

    await sendMail({
      to: user.email,
      subject: mail.subject,
      html: mail.html,
      tags: ['notification', type],
    });
  } catch (err) {
    console.warn('Notification email failed:', err.message);
  }
}

async function notifyAdminsTeacherRequest({ title, body }) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail || !isConfigured()) return;
  try {
    const mail = adminNotificationEmail({ title, body });
    await sendMail({
      to: adminEmail,
      subject: mail.subject,
      html: mail.html,
      tags: ['admin-notification'],
    });
  } catch (err) {
    console.warn('Admin email failed:', err.message);
  }
}

module.exports = { sendNotificationEmail, notifyAdminsTeacherRequest };
