const express = require('express');
const multer = require('multer');
const auth = require('../middleware/auth');
const requireActiveSubscription = require('../middleware/requireActiveSubscription');
const { extractTaskInputFromImage } = require('../services/extractionService');

const router = express.Router();
const storage = multer.memoryStorage();
const MAX_SIZE = 8 * 1024 * 1024;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg', 'image/heic', 'image/heif'];

const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Allow JPG, PNG, WebP, HEIC'));
    }
  }
});

const uploadFields = upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'file', maxCount: 1 }
]);

router.post('/extract-input', auth, requireActiveSubscription, (req, res, next) => {
  uploadFields(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ success: false, error: 'Image must be under 8MB' });
      }
      if (err.message && err.message.includes('Allow')) {
        return res.status(400).json({ success: false, error: err.message });
      }
      return res.status(500).json({ success: false, error: 'Upload failed' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const f = req.files?.image?.[0] || req.files?.file?.[0];
    const buffer = f?.buffer;

    if (!buffer || !Buffer.isBuffer(buffer)) {
      return res.status(400).json({
        success: false,
        error: 'No image provided'
      });
    }

    const result = await extractTaskInputFromImage(buffer);
    res.json(result);
  } catch (err) {
    if (err.message && err.message.includes('GCP_SA_JSON')) {
      return res.status(503).json({
        success: false,
        error: 'Scan service not configured'
      });
    }
    console.error('Scan extract error:', err.message);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to extract data from image'
    });
  }
});

module.exports = router;
