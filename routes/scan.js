const express = require('express');
const multer = require('multer');
const { extractTaskInputFromImage } = require('../services/extractionService');

const router = express.Router();
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

router.post('/extract-input', upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        error: 'No image provided'
      });
    }

    const result = await extractTaskInputFromImage(req.file.buffer);
    res.json(result);
  } catch (err) {
    console.error('Scan extract error:', err);
    res.status(500).json({
      success: false,
      error: err.message || 'Failed to extract data from image'
    });
  }
});

module.exports = router;
