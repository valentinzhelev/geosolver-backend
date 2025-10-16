const express = require('express');
const router = express.Router();
const Class = require('../models/Class');
const Student = require('../models/Student');
const Assignment = require('../models/Assignment');
const auth = require('../middleware/auth');

// Get all classes for a teacher
router.get('/', auth, async (req, res) => {
  try {
    const classes = await Class.find({ teacherId: req.user.id })
      .populate('students', 'name email statistics')
      .populate('assignments', 'title status dueDate')
      .sort({ createdAt: -1 });
    
    res.json(classes);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching classes', error: error.message });
  }
});

// Get single class
router.get('/:id', auth, async (req, res) => {
  try {
    const classData = await Class.findOne({ 
      _id: req.params.id, 
      teacherId: req.user.id 
    })
    .populate('students', 'name email statistics lastActive')
    .populate('assignments', 'title status dueDate');
    
    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    res.json(classData);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching class', error: error.message });
  }
});

// Create new class
router.post('/', auth, async (req, res) => {
  try {
    const { name, description } = req.body;
    
    const classData = new Class({
      name,
      description,
      teacherId: req.user.id
    });
    
    await classData.save();
    res.status(201).json(classData);
  } catch (error) {
    res.status(500).json({ message: 'Error creating class', error: error.message });
  }
});

// Update class
router.put('/:id', auth, async (req, res) => {
  try {
    const classData = await Class.findOneAndUpdate(
      { _id: req.params.id, teacherId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    res.json(classData);
  } catch (error) {
    res.status(500).json({ message: 'Error updating class', error: error.message });
  }
});

// Delete class
router.delete('/:id', auth, async (req, res) => {
  try {
    const classData = await Class.findOneAndDelete({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    // Delete all students in this class
    await Student.deleteMany({ classId: classData._id });
    
    // Delete all assignments in this class
    await Assignment.deleteMany({ classId: classData._id });
    
    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting class', error: error.message });
  }
});

// Generate new invite code
router.post('/:id/invite-code', auth, async (req, res) => {
  try {
    const classData = await Class.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    // Generate new invite code
    let code;
    let isUnique = false;
    
    while (!isUnique) {
      code = Math.random().toString(36).substring(2, 8).toUpperCase();
      const existingClass = await Class.findOne({ inviteCode: code });
      if (!existingClass) {
        isUnique = true;
      }
    }
    
    classData.inviteCode = code;
    await classData.save();
    
    res.json({ inviteCode: code });
  } catch (error) {
    res.status(500).json({ message: 'Error generating invite code', error: error.message });
  }
});

// Get class statistics
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const classData = await Class.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!classData) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    const stats = await Student.aggregate([
      { $match: { classId: classData._id } },
      {
        $group: {
          _id: null,
          totalStudents: { $sum: 1 },
          activeStudents: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          },
          averageScore: { $avg: '$statistics.averageScore' }
        }
      }
    ]);
    
    const assignmentStats = await Assignment.aggregate([
      { $match: { classId: classData._id } },
      {
        $group: {
          _id: null,
          totalAssignments: { $sum: 1 },
          activeAssignments: {
            $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] }
          }
        }
      }
    ]);
    
    res.json({
      ...stats[0] || { totalStudents: 0, activeStudents: 0, averageScore: 0 },
      ...assignmentStats[0] || { totalAssignments: 0, activeAssignments: 0 }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching class stats', error: error.message });
  }
});

module.exports = router;
