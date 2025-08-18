const express = require('express');
const router = express.Router();
const User = require('../models/User');
const auth = require('../middleware/auth');

// Get user preferences
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('userPreferences');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      userPreferences: user.userPreferences || { showToolsInDevelopment: false }
    });
  } catch (error) {
    console.error('Error fetching user preferences:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

// Update user preferences
router.put('/', auth, async (req, res) => {
  try {
    const { showToolsInDevelopment } = req.body;
    
    const updateData = {};
    if (typeof showToolsInDevelopment === 'boolean') {
      updateData['userPreferences.showToolsInDevelopment'] = showToolsInDevelopment;
    }
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).select('userPreferences');
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({
      userPreferences: user.userPreferences || { showToolsInDevelopment: false }
    });
  } catch (error) {
    console.error('Error updating user preferences:', error);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;
