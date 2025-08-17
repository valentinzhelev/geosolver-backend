const express = require('express');
const router = express.Router();
const { sendMail } = require('../utils/mailer');

router.post('/', async (req, res) => {
  const { email, title, content } = req.body;
  if (!email || !title || !content) {
    return res.status(400).json({ message: 'Всички полета са задължителни.' });
  }

  try {
    const htmlContent = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #333; border-bottom: 2px solid #000; padding-bottom: 10px;">
          Ново съобщение от GeoSolver
        </h2>
        
        <div style="background: #f9f9f9; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <h3 style="color: #000; margin-top: 0;">${title}</h3>
          <p style="color: #666; line-height: 1.6;">${content}</p>
        </div>
        
        <div style="background: #000; color: #fff; padding: 15px; border-radius: 8px;">
          <strong>От:</strong> ${email}
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: #f0f0f0; border-radius: 8px;">
          <small style="color: #666;">
            Това съобщение е изпратено от контактната форма на GeoSolver.
          </small>
        </div>
      </div>
    `;

    await sendMail({
      to: 'team@geosolver.bg',
      subject: `[GeoSolver] Контактна форма: ${title}`,
      html: htmlContent,
      replyTo: email
    });

    res.json({ message: 'Съобщението е изпратено успешно!' });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ message: 'Грешка при изпращане на съобщението.' });
  }
});

module.exports = router;
