const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const crypto = require('crypto');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Всички полета са задължителни.' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(409).json({ message: 'Имейлът вече е регистриран.' });
    const hashed = await bcrypt.hash(password, 10);
    const refreshToken = crypto.randomBytes(40).toString('hex');
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const user = await User.create({ name, email, password: hashed, role: 'free', refreshTokens: [refreshToken], isVerified: false, verificationToken });
    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    // TODO: изпрати verificationToken по email
    res.status(201).json({
      user: { id: user._id, name: user.name, email: user.email, role: user.role, isVerified: user.isVerified },
      token,
      refreshToken,
      verificationLink: `${process.env.BASE_URL || 'http://localhost:3000'}/api/auth/verify?token=${verificationToken}`
    });
  } catch (err) {
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
    res.status(500).json({ message: 'Грешка при вход.' });
  }
});

// GET /api/auth/account
router.get('/account', auth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ message: 'Потребителят не е намерен.' });
    res.json({ id: user._id, name: user.name, email: user.email, role: user.role });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при зареждане на акаунта.' });
  }
});

// GET /api/auth/admin-only (примерен защитен endpoint)
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
    // Генерирай нови токени
    const newAccessToken = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const newRefreshToken = crypto.randomBytes(40).toString('hex');
    // Замени стария refresh token с новия
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
    if (!user) return res.status(200).json({ message: 'Успешно излизане.' }); // вече е изтрит
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

// GET /api/auth/verify?token=...
router.get('/verify', async (req, res) => {
  try {
    const { token } = req.query;
    if (!token) return res.status(400).json({ message: 'Липсва verification token.' });
    const user = await User.findOne({ verificationToken: token });
    if (!user) return res.status(400).json({ message: 'Невалиден verification token.' });
    user.isVerified = true;
    user.verificationToken = undefined;
    await user.save();
    res.json({ message: 'Имейлът е успешно верифициран.' });
  } catch (err) {
    res.status(500).json({ message: 'Грешка при верификация.' });
  }
});

module.exports = router; 