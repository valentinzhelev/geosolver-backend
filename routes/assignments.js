const express = require('express');
const router = express.Router();
const Assignment = require('../models/Assignment');
const Class = require('../models/Class');
const auth = require('../middleware/auth');

// Get all assignments for a teacher
router.get('/', auth, async (req, res) => {
  try {
    const assignments = await Assignment.find({ teacherId: req.user.id })
      .populate('classId', 'name')
      .sort({ createdAt: -1 });
    
    res.json(assignments);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching assignments', error: error.message });
  }
});

// Get single assignment
router.get('/:id', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findOne({ 
      _id: req.params.id, 
      teacherId: req.user.id 
    }).populate('classId', 'name');
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    res.json(assignment);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching assignment', error: error.message });
  }
});

// Create new assignment
router.post('/', auth, async (req, res) => {
  try {
    const { title, description, instructions, taskType, difficulty, classId, dueDate, parameters } = req.body;
    
    const assignment = new Assignment({
      title,
      description,
      instructions,
      taskType,
      difficulty,
      teacherId: req.user.id,
      classId,
      dueDate,
      parameters,
      status: 'active'
    });
    
    await assignment.save();
    
    // Add assignment to class
    await Class.findByIdAndUpdate(classId, {
      $push: { assignments: assignment._id }
    });
    
    res.status(201).json(assignment);
  } catch (error) {
    res.status(500).json({ message: 'Error creating assignment', error: error.message });
  }
});

// Update assignment
router.put('/:id', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findOneAndUpdate(
      { _id: req.params.id, teacherId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    res.json(assignment);
  } catch (error) {
    res.status(500).json({ message: 'Error updating assignment', error: error.message });
  }
});

// Delete assignment
router.delete('/:id', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findOneAndDelete({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    // Remove assignment from class
    await Class.findByIdAndUpdate(assignment.classId, {
      $pull: { assignments: assignment._id }
    });
    
    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting assignment', error: error.message });
  }
});

// Get assignment statistics
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    const Submission = require('../models/Submission');
    const stats = await Submission.aggregate([
      { $match: { assignmentId: assignment._id } },
      {
        $group: {
          _id: null,
          totalSubmissions: { $sum: 1 },
          averageScore: { $avg: '$finalScore' },
          gradedSubmissions: {
            $sum: { $cond: [{ $ne: ['$teacherGrade.score', null] }, 1, 0] }
          }
        }
      }
    ]);
    
    res.json(stats[0] || { totalSubmissions: 0, averageScore: 0, gradedSubmissions: 0 });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching assignment stats', error: error.message });
  }
});

module.exports = router;
