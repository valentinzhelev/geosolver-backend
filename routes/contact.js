const express = require('express');
const router = express.Router();
const { sendMail, isConfigured, isEmailDeliveryError } = require('../utils/mailer');
const { contactFormEmail } = require('../utils/emailTemplates');

router.post('/', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ message: 'Контактната форма временно не е налична. Моля, пишете на team@geosolver.bg.' });
  }

  const { email, title, content } = req.body;
  if (!email || !title || !content) {
    return res.status(400).json({ message: 'Всички полета са задължителни.' });
  }

  try {
    const mail = contactFormEmail({
      senderEmail: email.trim(),
      title: title.trim(),
      content: content.trim(),
    });

    await sendMail({
      to: process.env.CONTACT_EMAIL_TO || 'team@geosolver.bg',
      subject: mail.subject,
      html: mail.html,
      replyTo: email.trim(),
      tags: ['contact-form'],
    });

    res.json({ message: 'Съобщението е изпратено успешно!' });
  } catch (err) {
    console.error('Email error:', err.message || err);
    if (isEmailDeliveryError(err)) {
      return res.status(503).json({
        message: 'Имейл услугата не отговаря. Моля, пишете директно на team@geosolver.bg.',
      });
    }
    res.status(500).json({ message: 'Грешка при изпращане на съобщението.' });
  }
});

module.exports = router;
