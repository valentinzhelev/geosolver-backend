const express = require('express');
const router = express.Router();
const { sendMail, isConfigured } = require('../utils/mailer');

function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

router.post('/', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ message: 'Контактната форма временно не е налична. Моля, пишете на help@geosolver.bg.' });
  }

  const { email, title, content } = req.body;
  if (!email || !title || !content) {
    return res.status(400).json({ message: 'Всички полета са задължителни.' });
  }

  const safeEmail = escapeHtml(email.trim());
  const safeTitle = escapeHtml(title.trim());
  const safeContent = escapeHtml(content.trim()).replace(/\n/g, '<br>');

  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #000; padding-bottom: 10px;">
          Ново съобщение от GeoSolver
        </h2>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #000; margin-top: 0;">${safeTitle}</h3>
          <p style="color: #666; line-height: 1.6;">${safeContent}</p>
        </div>
        
        <div style="background: #000; color: #fff; padding: 15px; border-radius: 8px;">
          <strong>От:</strong> ${safeEmail}
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 8px;">
          <small style="color: #666;">
            Това съобщение е изпратено от контактната форма на GeoSolver.
          </small>
        </div>
      </div>
    `;

    await sendMail({
      to: process.env.CONTACT_EMAIL_TO || 'team@geosolver.bg',
      subject: `[GeoSolver] Контактна форма: ${title.trim().slice(0, 100)}`,
      html: htmlContent,
      replyTo: email.trim()
    });

    res.json({ message: 'Съобщението е изпратено успешно!' });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ message: 'Грешка при изпращане на съобщението.' });
  }
});

module.exports = router;
