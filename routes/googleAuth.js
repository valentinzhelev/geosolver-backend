const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const User = require('../models/User');
const jwt = require('jsonwebtoken');
const router = express.Router();

// Initialize OAuth2Client with both client ID and secret
const client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

// Google OAuth login
router.post('/login', async (req, res) => {
  try {
    const { token } = req.body;
    
    console.log('Google login attempt received');
    console.log('GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Missing');
    console.log('GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Missing');
    
    if (!token) {
      console.log('No token provided');
      return res.status(400).json({ message: 'Google token is required' });
    }

    if (!process.env.GOOGLE_CLIENT_ID) {
      console.log('GOOGLE_CLIENT_ID not configured');
      return res.status(500).json({ message: 'Google OAuth not configured' });
    }

    // Verify the Google token
    console.log('Verifying Google token...');
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });

    console.log('Google token verified successfully');
    const payload = ticket.getPayload();
    const { email, name, picture, sub: googleId } = payload;

    console.log('User payload:', { email, name, googleId });

    // Check if user exists
    let user = await User.findOne({ email });

    if (!user) {
      console.log('Creating new user for:', email);
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
      console.log('New user created successfully');
    } else {
      console.log('Existing user found:', email);
      // Update existing user's Google info if needed
      if (!user.googleId) {
        user.googleId = googleId;
        user.isVerified = true;
        if (picture) user.profilePicture = picture;
        await user.save();
        console.log('Updated existing user with Google info');
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

    console.log('Login successful for:', email);
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
    console.error('Google login error details:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    
    if (error.message.includes('Invalid token')) {
      res.status(401).json({ message: 'Invalid Google token' });
    } else if (error.message.includes('Token used too late')) {
      res.status(401).json({ message: 'Token expired' });
    } else {
      res.status(500).json({ message: 'Google authentication failed', error: error.message });
    }
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
