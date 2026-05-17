const Notification = require('../models/Notification');
const { sendNotificationEmail } = require('./notificationDelivery');

async function createNotification({ userId, type, title, body, link, meta }) {
  if (!userId) return null;

  const dedupeKey = meta?.dedupeKey;
  if (dedupeKey) {
    const existing = await Notification.findOne({
      user: userId,
      type,
      'meta.dedupeKey': dedupeKey,
    });
    if (existing) return existing;
  }

  const doc = await Notification.create({
    user: userId,
    type,
    title,
    body: body || '',
    link: link || '',
    meta: meta || {},
  });

  sendNotificationEmail({ userId, type, title, body, link }).catch(() => {});

  return doc;
}

async function notifyCourseStudents(course, payload) {
  const ids = course.students || [];
  await Promise.all(
    ids.map((sid) =>
      createNotification({
        userId: sid._id || sid,
        ...payload,
      })
    )
  );
}

module.exports = { createNotification, notifyCourseStudents };
