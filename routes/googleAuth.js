const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sanitizeLegacyUser } = require('../utils/sanitizeLegacyUser');

const router = express.Router();

function getGoogleClientIds() {
  const ids = [
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_ID_ALT,
  ].filter(Boolean);
  return [...new Set(ids)];
}

const client = new OAuth2Client();

async function verifyGoogleIdToken(idToken) {
  const audiences = getGoogleClientIds();
  if (!audiences.length) {
    const err = new Error('Google OAuth not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const ticket = await client.verifyIdToken({
    idToken,
    audience: audiences.length === 1 ? audiences[0] : audiences,
  });
  return ticket.getPayload();
}

// POST /api/google-auth/login
router.post('/login', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'Липсва Google токен.' });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: 'Сървърът не е конфигуриран за вход.' });
    }

    const payload = await verifyGoogleIdToken(token);
    const { email, name, picture, sub: googleId } = payload;

    if (!email || !googleId) {
      return res.status(401).json({ message: 'Невалиден Google профил.' });
    }

    const linkedGoogleUser = await User.findOne({ googleId });
    if (linkedGoogleUser && linkedGoogleUser.email !== email) {
      return res.status(409).json({ message: 'Този Google профил е свързан с друг GeoSolver акаунт.' });
    }

    let user = await User.findOne({ email });

    if (!user) {
      const hashed = await bcrypt.hash(`google_${googleId}`, 10);
      user = await User.create({
        name: name || email.split('@')[0],
        email,
        password: hashed,
        role: 'student',
        isVerified: true,
        googleId,
        profilePicture: picture || undefined,
        refreshTokens: [],
      });
    } else {
      sanitizeLegacyUser(user);

      if (!user.googleId) {
        user.googleId = googleId;
      }
      user.isVerified = true;

      if (picture && !user.profilePicture) {
        user.profilePicture = picture;
      }
      if (name && user.name !== name) {
        user.name = name;
      }
    }

    const refreshToken = crypto.randomBytes(40).toString('hex');
    user.refreshTokens.push(refreshToken);
    await user.save();

    const accessToken = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      message: 'Успешен вход с Google.',
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isVerified: user.isVerified,
        profilePicture: user.profilePicture,
      },
    });
  } catch (error) {
    console.error('Google login error:', error.message);

    if (error.code === 'NOT_CONFIGURED') {
      return res.status(500).json({ message: 'Google входът не е конфигуриран на сървъра.' });
    }

    const msg = error.message || '';
    if (
      msg.includes('Invalid token')
      || msg.includes('Wrong number of segments')
      || msg.includes('Token used too late')
      || msg.includes('audience')
    ) {
      return res.status(401).json({ message: 'Невалиден или изтекъл Google токен.' });
    }

    if (error.name === 'ValidationError') {
      console.error('Google login validation:', error.errors);
      return res.status(400).json({ message: 'Данните от Google профила не могат да бъдат записани.' });
    }

    res.status(500).json({ message: 'Грешка при Google вход.' });
  }
});

module.exports = router;
