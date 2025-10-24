const express = require('express');
const router = express.Router();
const TaskTemplate = require('../models/TaskTemplate');
const auth = require('../middleware/auth');
const requireRole = require('../middleware/role');
const Audit = require('../models/Audit');

// Get all task templates (with filters)
router.get('/', auth, async (req, res) => {
  try {
    const { teacherId, course, type, difficulty, isPublic } = req.query;
    const filter = {};

    // Apply filters
    if (teacherId) {
      filter.createdBy = teacherId;
    }
    if (type) {
      filter.type = type;
    }
    if (difficulty) {
      filter.difficulty = difficulty;
    }
    if (isPublic !== undefined) {
      filter.isPublic = isPublic === 'true';
    }

    // If user is not admin, only show their templates or public ones
    if (req.userRole !== 'admin') {
      filter.$or = [
        { createdBy: req.userId },
        { isPublic: true }
      ];
    }

    const templates = await TaskTemplate.find(filter)
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 })
      .limit(parseInt(req.query.limit) || 50);

    res.json({
      success: true,
      data: templates,
      count: templates.length
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на шаблоните за задачи',
      error: error.message
    });
  }
});

// Get single task template
router.get('/:id', auth, async (req, res) => {
  try {
    const template = await TaskTemplate.findById(req.params.id)
      .populate('createdBy', 'name email');

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Шаблонът за задача не е намерен'
      });
    }

    // Check access permissions
    if (req.userRole !== 'admin' && 
        template.createdBy._id.toString() !== req.userId && 
        !template.isPublic) {
      return res.status(403).json({
        success: false,
        message: 'Нямате достъп до този шаблон'
      });
    }

    res.json({
      success: true,
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при зареждане на шаблона',
      error: error.message
    });
  }
});

// Create new task template
router.post('/', auth, requireRole('teacher'), async (req, res) => {
  try {
    const {
      name,
      type,
      description,
      difficulty,
      level,
      paramsSchema,
      generatorScript,
      solutionScript,
      testCases,
      gradingSettings,
      tags,
      isPublic
    } = req.body;

    // Validate required fields
    if (!name || !type || !generatorScript || !solutionScript) {
      return res.status(400).json({
        success: false,
        message: 'Липсват задължителни полета'
      });
    }

    // Validate generator and solution scripts
    const template = new TaskTemplate({
      name,
      type,
      description: description || '',
      difficulty: difficulty || 'medium',
      level: level || 5,
      paramsSchema: paramsSchema || {},
      generatorScript,
      solutionScript,
      testCases: testCases || [],
      gradingSettings: gradingSettings || {
        tolerance: 0.001,
        toleranceType: 'absolute',
        maxScore: 100
      },
      tags: tags || [],
      isPublic: isPublic || false,
      createdBy: req.userId
    });

    // Validate scripts
    const generatorValidation = template.validateGenerator();
    if (!generatorValidation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Грешка в генераторния скрипт',
        error: generatorValidation.error
      });
    }

    const solutionValidation = template.validateSolution();
    if (!solutionValidation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Грешка в решението скрипт',
        error: solutionValidation.error
      });
    }

    await template.save();

    // Log audit
    await Audit.logOperation({
      operation: 'create_task_template',
      performedBy: req.userId,
      targetEntity: {
        type: 'task_template',
        id: template._id
      },
      description: `Създаден нов шаблон за задача: ${template.name}`,
      newValues: {
        name: template.name,
        type: template.type,
        difficulty: template.difficulty
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.status(201).json({
      success: true,
      message: 'Шаблонът за задача е създаден успешно',
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при създаване на шаблона',
      error: error.message
    });
  }
});

// Update task template
router.put('/:id', auth, requireRole('teacher'), async (req, res) => {
  try {
    const template = await TaskTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Шаблонът не е намерен'
      });
    }

    // Check ownership
    if (template.createdBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да редактирате този шаблон'
      });
    }

    const oldValues = {
      name: template.name,
      type: template.type,
      difficulty: template.difficulty
    };

    // Update fields
    const updateFields = [
      'name', 'type', 'description', 'difficulty', 'level',
      'paramsSchema', 'generatorScript', 'solutionScript',
      'testCases', 'gradingSettings', 'tags', 'isPublic'
    ];

    updateFields.forEach(field => {
      if (req.body[field] !== undefined) {
        template[field] = req.body[field];
      }
    });

    // Validate updated scripts
    if (req.body.generatorScript) {
      const generatorValidation = template.validateGenerator();
      if (!generatorValidation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Грешка в генераторния скрипт',
          error: generatorValidation.error
        });
      }
    }

    if (req.body.solutionScript) {
      const solutionValidation = template.validateSolution();
      if (!solutionValidation.valid) {
        return res.status(400).json({
          success: false,
          message: 'Грешка в решението скрипт',
          error: solutionValidation.error
        });
      }
    }

    await template.save();

    // Log audit
    await Audit.logOperation({
      operation: 'update_task_template',
      performedBy: req.userId,
      targetEntity: {
        type: 'task_template',
        id: template._id
      },
      description: `Обновен шаблон за задача: ${template.name}`,
      oldValues,
      newValues: {
        name: template.name,
        type: template.type,
        difficulty: template.difficulty
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Шаблонът е обновен успешно',
      data: template
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при обновяване на шаблона',
      error: error.message
    });
  }
});

// Delete task template
router.delete('/:id', auth, requireRole('teacher'), async (req, res) => {
  try {
    const template = await TaskTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Шаблонът не е намерен'
      });
    }

    // Check ownership
    if (template.createdBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да изтриете този шаблон'
      });
    }

    await TaskTemplate.findByIdAndDelete(req.params.id);

    // Log audit
    await Audit.logOperation({
      operation: 'delete_task_template',
      performedBy: req.userId,
      targetEntity: {
        type: 'task_template',
        id: req.params.id
      },
      description: `Изтрит шаблон за задача: ${template.name}`,
      oldValues: {
        name: template.name,
        type: template.type,
        difficulty: template.difficulty
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });

    res.json({
      success: true,
      message: 'Шаблонът е изтрит успешно'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при изтриване на шаблона',
      error: error.message
    });
  }
});

// Test task template (generate sample data)
router.post('/:id/test', auth, requireRole('teacher'), async (req, res) => {
  try {
    const template = await TaskTemplate.findById(req.params.id);

    if (!template) {
      return res.status(404).json({
        success: false,
        message: 'Шаблонът не е намерен'
      });
    }

    // Check access
    if (template.createdBy.toString() !== req.userId && req.userRole !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Нямате права да тествате този шаблон'
      });
    }

    const { variantIndex = 0, seed = null } = req.body;

    try {
      const inputData = template.generateTestData(variantIndex, seed);
      const solution = template.generateSolution(inputData);

      res.json({
        success: true,
        data: {
          inputData,
          solution,
          variantIndex,
          seed
        }
      });
    } catch (error) {
      res.status(400).json({
        success: false,
        message: 'Грешка при тестване на шаблона',
        error: error.message
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Грешка при тестване на шаблона',
      error: error.message
    });
  }
});

module.exports = router;
