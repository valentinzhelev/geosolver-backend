const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const router = express.Router();

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Google OAuth login
router.post('/login', async (req, res) => {
  try {
    const { token } = req.body;
    
    if (!token) {
      return res.status(400).json({ message: 'Google token is required' });
    }

    // Verify the Google token
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    // Check if user exists
    let user = await User.findOne({ email });

    if (!user) {
      // Create new user
      user = new User({
        name,
        email,
        password: `google_${googleId}`, // Placeholder password for Google users
        isVerified: true, // Google users are pre-verified
        googleId: googleId,
        profilePicture: picture
      });
      await user.save();
    } else {
      // Update existing user's Google info if needed
      if (!user.googleId) {
        user.googleId = googleId;
        user.isVerified = true;
        if (picture) user.profilePicture = picture;
        await user.save();
      }
    }

    // Generate JWT tokens
    const accessToken = jwt.sign(
      { id: user._id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      { id: user._id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    // Save refresh token
    user.refreshTokens.push(refreshToken);
    await user.save();

    res.json({
      message: 'Google login successful',
      token: accessToken,
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        profilePicture: user.profilePicture
      }
    });

  } catch (error) {
    console.error('Google login error:', error);
    res.status(500).json({ message: 'Google authentication failed' });
  }
});

// Get Google OAuth URL (for server-side flow if needed)
router.get('/url', (req, res) => {
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
    `redirect_uri=${process.env.GOOGLE_REDIRECT_URI}&` +
    `response_type=code&` +
    `scope=openid email profile&` +
    `access_type=offline&` +
    `prompt=consent`;

  res.json({ authUrl });
});

module.exports = router;
