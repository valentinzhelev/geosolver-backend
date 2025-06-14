const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

router.post('/', async (req, res) => {
  const { email, title, content } = req.body;
  if (!email || !title || !content) {
    return res.status(400).json({ message: 'Всички полета са задължителни.' });
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  try {
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `"GeoSolver Contact" <${process.env.SMTP_USER}>`,
      replyTo: email,
      to: process.env.SMTP_USER,
      subject: `[GeoSolver] Контактна форма: ${title}`,
      text: `От: ${email}\n\n${content}`
    });
    res.json({ message: 'Съобщението е изпратено успешно!' });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при изпращане на съобщението.' });
  }
});

module.exports = router;
