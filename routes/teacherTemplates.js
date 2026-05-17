const express = require('express');
const router = express.Router();
const TeacherAssignmentTemplate = require('../models/TeacherAssignmentTemplate');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');

router.get('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const filter = req.userRole === 'admin' ? {} : { owner: req.userId };
    const items = await TeacherAssignmentTemplate.find(filter).sort({ updatedAt: -1 });
    res.json({ success: true, data: items });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const {
      title,
      toolKey,
      description,
      variantsCount,
      maxAttempts,
      daysUntilDue,
      customTolerance,
      customToleranceType,
      calculatorPolicy,
    } = req.body;
    if (!title || !toolKey) {
      return res.status(400).json({ success: false, message: 'Заглавие и инструмент са задължителни' });
    }
    const doc = await TeacherAssignmentTemplate.create({
      owner: req.userId,
      title,
      toolKey,
      description: description || '',
      variantsCount: variantsCount ?? 1,
      maxAttempts: maxAttempts ?? 3,
      daysUntilDue: daysUntilDue ?? 7,
      customTolerance: customTolerance ?? 0.01,
      customToleranceType: customToleranceType || 'absolute',
      calculatorPolicy: calculatorPolicy || 'guided',
    });
    res.status(201).json({ success: true, data: doc });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/:id', auth, requireRole('teacher'), async (req, res) => {
  try {
    const doc = await TeacherAssignmentTemplate.findById(req.params.id);
    if (!doc) {
      return res.status(404).json({ success: false, message: 'Шаблонът не е намерен' });
    }
    if (doc.owner.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({ success: false, message: 'Нямате права' });
    }
    await doc.deleteOne();
    res.json({ success: true, message: 'Изтрит' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
