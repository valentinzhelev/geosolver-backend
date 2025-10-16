const express = require('express');
const router = express.Router();
const Submission = require('../models/Submission');
const Assignment = require('../models/Assignment');
const Student = require('../models/Student');
const auth = require('../middleware/auth');
// const multer = require('multer'); // Temporarily disabled due to network issues
const path = require('path');

// File upload configuration (temporarily disabled)
// const storage = multer.diskStorage({
//   destination: (req, file, cb) => {
//     cb(null, 'uploads/submissions/');
//   },
//   filename: (req, file, cb) => {
//     const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
//     cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
//   }
// });

// const upload = multer({ 
//   storage: storage,
//   limits: {
//     fileSize: 10 * 1024 * 1024 // 10MB limit
//   },
//   fileFilter: (req, file, cb) => {
//     if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
//       cb(null, true);
//     } else {
//       cb(new Error('Only image and PDF files are allowed'), false);
//     }
//   }
// });

// Get all submissions for a teacher
router.get('/', auth, async (req, res) => {
  try {
    const submissions = await Submission.find({ teacherId: req.user.id })
      .populate('studentId', 'name email classId')
      .populate('assignmentId', 'title taskType dueDate')
      .sort({ submittedAt: -1 });
    
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submissions', error: error.message });
  }
});

// Get submissions for specific assignment
router.get('/assignment/:assignmentId', auth, async (req, res) => {
  try {
    const assignment = await Assignment.findOne({
      _id: req.params.assignmentId,
      teacherId: req.user.id
    });
    
    if (!assignment) {
      return res.status(404).json({ message: 'Assignment not found' });
    }
    
    const submissions = await Submission.find({ assignmentId: req.params.assignmentId })
      .populate('studentId', 'name email')
      .sort({ submittedAt: -1 });
    
    res.json(submissions);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching assignment submissions', error: error.message });
  }
});

// Get single submission
router.get('/:id', auth, async (req, res) => {
  try {
    const submission = await Submission.findOne({ 
      _id: req.params.id, 
      teacherId: req.user.id 
    })
    .populate('studentId', 'name email classId')
    .populate('assignmentId', 'title taskType parameters');
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    res.json(submission);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submission', error: error.message });
  }
});

// Submit solution (for students - will be used when student interface is built)
// Temporarily disabled file upload due to multer dependency
router.post('/', async (req, res) => {
  try {
    const { studentId, assignmentId, teacherId } = req.body;
    
    // Mock file data for now
    const files = [{
      filename: 'mock-file.jpg',
      originalName: 'solution.jpg',
      mimetype: 'image/jpeg',
      size: 1024,
      path: 'uploads/submissions/mock-file.jpg'
    }];
    
    const submission = new Submission({
      studentId,
      assignmentId,
      teacherId,
      files,
      status: 'submitted'
    });
    
    await submission.save();
    res.status(201).json(submission);
  } catch (error) {
    res.status(500).json({ message: 'Error submitting solution', error: error.message });
  }
});

// AI Analysis endpoint (simulated)
router.post('/:id/analyze', auth, async (req, res) => {
  try {
    const submission = await Submission.findOne({
      _id: req.params.id,
      teacherId: req.user.id
    });
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // Simulate AI analysis (replace with actual AI service)
    const mockAnalysis = {
      overallScore: Math.random() * 4 + 6, // Score between 6-10
      totalErrors: Math.floor(Math.random() * 5),
      errors: [
        {
          type: 'calculation',
          description: 'Error in angle calculation',
          location: { x: 120, y: 80 },
          severity: 'medium',
          suggestion: 'Check the sin(α) formula'
        }
      ],
      correctSteps: [
        'Correct data input',
        'Proper formula application'
      ],
      feedback: 'Good understanding of basic principles, but needs attention to detail.'
    };
    
    submission.aiAnalysis = {
      ...mockAnalysis,
      analyzedAt: new Date()
    };
    
    await submission.save();
    res.json(submission.aiAnalysis);
  } catch (error) {
    res.status(500).json({ message: 'Error analyzing submission', error: error.message });
  }
});

// Grade submission
router.put('/:id/grade', auth, async (req, res) => {
  try {
    const { score, feedback } = req.body;
    
    const submission = await Submission.findOneAndUpdate(
      { _id: req.params.id, teacherId: req.user.id },
      {
        teacherGrade: {
          score,
          feedback,
          gradedAt: new Date(),
          gradedBy: req.user.id
        },
        status: 'graded'
      },
      { new: true }
    );
    
    if (!submission) {
      return res.status(404).json({ message: 'Submission not found' });
    }
    
    // Update student statistics
    await Student.findByIdAndUpdate(submission.studentId, {
      $inc: { 
        'statistics.assignmentsCompleted': 1,
        'statistics.totalSubmissions': 1
      }
    });
    
    res.json(submission);
  } catch (error) {
    res.status(500).json({ message: 'Error grading submission', error: error.message });
  }
});

// Get submission statistics
router.get('/stats/overview', auth, async (req, res) => {
  try {
    const stats = await Submission.aggregate([
      { $match: { teacherId: req.user.id } },
      {
        $group: {
          _id: null,
          totalSubmissions: { $sum: 1 },
          gradedSubmissions: {
            $sum: { $cond: [{ $ne: ['$teacherGrade.score', null] }, 1, 0] }
          },
          averageScore: { $avg: '$finalScore' },
          pendingSubmissions: {
            $sum: { $cond: [{ $eq: ['$status', 'submitted'] }, 1, 0] }
          }
        }
      }
    ]);
    
    res.json(stats[0] || { 
      totalSubmissions: 0, 
      gradedSubmissions: 0, 
      averageScore: 0, 
      pendingSubmissions: 0 
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching submission stats', error: error.message });
  }
});

module.exports = router;
