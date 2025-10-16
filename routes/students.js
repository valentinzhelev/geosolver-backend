const express = require('express');
const router = express.Router();
const Student = require('../models/Student');
const Class = require('../models/Class');
const auth = require('../middleware/auth');

// Get all students for a teacher
router.get('/', auth, async (req, res) => {
  try {
    const students = await Student.find({ teacherId: req.user.id })
      .populate('classId', 'name')
      .sort({ name: 1 });
    
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching students', error: error.message });
  }
});

// Get students by class
router.get('/class/:classId', auth, async (req, res) => {
  try {
    const students = await Student.find({ 
      classId: req.params.classId,
      teacherId: req.user.id 
    }).sort({ name: 1 });
    
    res.json(students);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching class students', error: error.message });
  }
});

// Get single student
router.get('/:id', auth, async (req, res) => {
  try {
    const student = await Student.findOne({ 
      _id: req.params.id, 
      teacherId: req.user.id 
    }).populate('classId', 'name');
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    res.json(student);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching student', error: error.message });
  }
});

// Add new student
router.post('/', auth, async (req, res) => {
  try {
    const { name, email, classId } = req.body;
    
    // Check if student already exists
    const existingStudent = await Student.findOne({ email });
    if (existingStudent) {
      return res.status(400).json({ message: 'Student with this email already exists' });
    }
    
    // Verify class belongs to teacher
    const classExists = await Class.findOne({ 
      _id: classId, 
      teacherId: req.user.id 
    });
    if (!classExists) {
      return res.status(404).json({ message: 'Class not found' });
    }
    
    const student = new Student({
      name,
      email,
      classId,
      teacherId: req.user.id
    });
    
    await student.save();
    
    // Add student to class
    await Class.findByIdAndUpdate(classId, {
      $push: { students: student._id }
    });
    
    res.status(201).json(student);
  } catch (error) {
    res.status(500).json({ message: 'Error adding student', error: error.message });
  }
});

// Update student
router.put('/:id', auth, async (req, res) => {
  try {
    const student = await Student.findOneAndUpdate(
      { _id: req.params.id, teacherId: req.user.id },
      req.body,
      { new: true, runValidators: true }
    );
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    res.json(student);
  } catch (error) {
    res.status(500).json({ message: 'Error updating student', error: error.message });
  }
});

// Delete student
router.delete('/:id', auth, async (req, res) => {
  try {
    const student = await Student.findOneAndDelete({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    // Remove student from class
    await Class.findByIdAndUpdate(student.classId, {
      $pull: { students: student._id }
    });
    
    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Error deleting student', error: error.message });
  }
});

// Get student statistics
router.get('/:id/stats', auth, async (req, res) => {
  try {
    const student = await Student.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!student) {
      return res.status(404).json({ message: 'Student not found' });
    }
    
    const Submission = require('../models/Submission');
    const stats = await Submission.aggregate([
      { $match: { studentId: student._id } },
      {
        $group: {
          _id: null,
          totalSubmissions: { $sum: 1 },
          averageScore: { $avg: '$finalScore' },
          completedAssignments: {
            $sum: { $cond: [{ $ne: ['$finalScore', null] }, 1, 0] }
          }
        }
      }
    ]);
    
    res.json(stats[0] || { totalSubmissions: 0, averageScore: 0, completedAssignments: 0 });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching student stats', error: error.message });
  }
});

module.exports = router;
