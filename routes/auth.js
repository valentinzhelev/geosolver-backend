const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const crypto = require('crypto');
const { sendMail, isConfigured, isEmailDeliveryError } = require('../utils/mailer');
const { getFrontendUrl, getApiPublicUrl } = require('../utils/appUrls');
const { verificationEmail, resetPasswordEmail } = require('../utils/emailTemplates');
const { sanitizeLegacyUser } = require('../utils/sanitizeLegacyUser');

const router = express.Router();

function purposeToRole(purpose) {
  if (purpose === 'teacher') return 'teacher';
  return 'student';
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, purpose } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Всички полета са задължителни.' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Имейлът вече е регистриран.' });
    const hashed = await bcrypt.hash(password, 10);
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const role = purposeToRole(purpose);
    const user = await User.create({ name, email, password: hashed, role, refreshTokens: [refreshToken], isVerified: false, verificationToken });
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });

    const verificationLink = `${getApiPublicUrl()}/api/auth/verify?token=${verificationToken}`;
    if (isConfigured()) {
      try {
        const mail = verificationEmail({ name: user.name, verifyUrl: verificationLink });
        await sendMail({ to: user.email, subject: mail.subject, html: mail.html, tags: ['verification'] });
      } catch (emailErr) {
        console.error('Verification email failed:', emailErr.message);
      }
    }

    res.status(201).json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role, isVerified: user.isVerified },
      token,
      refreshToken,
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Грешка при регистрация.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ message: 'Всички полета са задължителни.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: 'Грешен имейл или парола.' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).json({ message: 'Грешен имейл или парола.' });
    sanitizeLegacyUser(user);
    const refreshToken = crypto.randomBytes(40).toString('hex');
    user.refreshTokens.push(refreshToken);
    await user.save();
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    res.json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role },
      token,
      refreshToken
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Грешка при вход.' });
  }
});

// GET /api/auth/account
router.get('/account', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId).select('name email role plan subscriptionStatus currentPeriodEnd stripeCustomerId');
    if (!user) return res.status(404).json({ message: 'Потребителят не е намерен.' });
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      plan: user.plan || 'free',
      subscriptionStatus: user.subscriptionStatus || 'free',
      currentPeriodEnd: user.currentPeriodEnd,
      hasBillingCustomer: !!user.stripeCustomerId
    });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при зареждане на акаунта.' });
  }
});

// GET /api/auth/admin-only (sample protected endpoint)
router.get('/admin-only', auth, requireRole('admin'), (req, res) => {
  res.json({ message: 'Това е достъпно само за администратори.' });
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'Липсва refresh token.' });
    const user = await User.findOne({ refreshTokens: refreshToken });
    if (!user) return res.status(401).json({ message: 'Невалиден refresh token.' });
    const newAccessToken = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
    user.refreshTokens.push(newRefreshToken);
    await user.save();
    res.json({
      token: newAccessToken,
      refreshToken: newRefreshToken
    });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при опресняване на токена.' });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'Липсва refresh token.' });
    const user = await User.findOne({ refreshTokens: refreshToken });
    if (!user) return res.status(200).json({ message: 'Успешно излизане.' });
    user.refreshTokens = user.refreshTokens.filter(t => t !== refreshToken);
    await user.save();
    res.json({ message: 'Успешно излизане.' });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при излизане.' });
  }
});

// POST /api/auth/change-password
router.post('/change-password', auth, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (!oldPassword || !newPassword) return res.status(400).json({ message: 'Всички полета са задължителни.' });
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Потребителят не е намерен.' });
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) return res.status(401).json({ message: 'Грешна стара парола.' });
    user.password = await bcrypt.hash(newPassword, 10);
    user.refreshTokens = [];
    await user.save();
    res.json({ message: 'Паролата е сменена успешно. Моля, влезте отново.' });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при смяна на паролата.' });
  }
});

// GET /api/auth/verify?token=... — redirects to frontend after verification
router.get('/verify', async (req, res) => {
  const frontend = getFrontendUrl();
  try {
    const { token } = req.query;
    if (!token) return res.redirect(`${frontend}/login?verified=missing`);
    const user = await User.findOne({ verificationToken: token });
    if (!user) return res.redirect(`${frontend}/login?verified=invalid`);
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    return res.redirect(`${frontend}/login?verified=1`);
  } catch (err) {
    console.error('Verify error:', err);
    return res.redirect(`${frontend}/login?verified=error`);
  }
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ message: 'Имейл услугата не е конфигурирана. Моля, свържете се с нас на team@geosolver.bg.' });
  }
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ message: 'Липсва имейл.' });
    const user = await User.findOne({ email });
    if (!user) return res.status(200).json({ message: 'Ако имейлът съществува, ще получите инструкции.' });
    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = resetToken;
    user.resetPasswordExpires = Date.now() + 1000 * 60 * 30;
    await user.save();

    const resetUrl = `${getFrontendUrl()}/reset-password?token=${resetToken}`;
    const mail = resetPasswordEmail({ name: user.name, resetUrl });
    await sendMail({ to: user.email, subject: mail.subject, html: mail.html, tags: ['password-reset'] });

    res.json({ message: 'Ако имейлът съществува, ще получите инструкции за възстановяване.' });
  } catch (err) {
    console.error('Forgot password error:', err.message || err);
    if (isEmailDeliveryError(err)) {
      return res.status(503).json({
        message: 'Имейл услугата не отговаря в момента. Моля, пишете на team@geosolver.bg.',
      });
    }
    res.status(500).json({ message: 'Грешка при заявка за нова парола.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ message: 'Липсва токен или нова парола.' });
    const user = await User.findOne({ resetPasswordToken: token, resetPasswordExpires: { $gt: Date.now() } });
    if (!user) return res.status(400).json({ message: 'Невалиден или изтекъл токен.' });
    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    user.refreshTokens = [];
    await user.save();
    res.json({ message: 'Паролата е сменена успешно. Моля, влезте с новата парола.' });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при смяна на паролата.' });
  }
});

module.exports = router;
