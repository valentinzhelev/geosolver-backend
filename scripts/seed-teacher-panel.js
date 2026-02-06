require('dotenv').config();
const mongoose = require('mongoose');

// Import models
const User = require('../models/User');
const Course = require('../models/Course');
const TaskTemplate = require('../models/TaskTemplate');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Audit = require('../models/Audit');

const seedTeacherPanel = async () => {
  try {
    console.log('Starting teacher panel seed...');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');

    // Clear existing data
    await User.deleteMany({ email: { $in: ['teacher@example.com', 'student1@example.com', 'student2@example.com', 'student3@example.com'] } });
    await Course.deleteMany({ code: { $in: ['GEO101', 'CAR201'] } });
    await TaskTemplate.deleteMany({ name: { $regex: /^Test/ } });
    await Assignment.deleteMany({ title: { $regex: /^Test/ } });
    await Submission.deleteMany({});
    await Audit.deleteMany({});
    console.log('Cleared existing data');

    // Create teacher user
    const teacher = new User({
      name: 'Проф. д-р Иван Петров',
      email: 'teacher@example.com',
      password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
      role: 'teacher',
      isVerified: true
    });
    await teacher.save();
    console.log('Created teacher user');

    // Create student users
    const students = [];
    const studentData = [
      { name: 'Анна Георгиева', email: 'student1@example.com' },
      { name: 'Петър Стоянов', email: 'student2@example.com' },
      { name: 'Мария Димитрова', email: 'student3@example.com' }
    ];

    for (const data of studentData) {
      const student = new User({
        name: data.name,
        email: data.email,
        password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
        role: 'student',
        isVerified: true
      });
      await student.save();
      students.push(student);
    }
    console.log('Created student users');

    // Create courses
    const course1 = new Course({
      name: 'Геодезия - 1 курс',
      code: 'GEO101',
      description: 'Основен курс по геодезия за първи курс',
      owner: teacher._id,
      students: students.map(s => s._id),
      settings: {
        allowLateSubmissions: true,
        lateSubmissionPenalty: 0.1,
        autoGrade: true
      }
    });
    await course1.save();

    const course2 = new Course({
      name: 'Картография',
      code: 'CAR201',
      description: 'Курс по картография и геоинформационни системи',
      owner: teacher._id,
      students: students.slice(0, 2).map(s => s._id),
      settings: {
        allowLateSubmissions: true,
        lateSubmissionPenalty: 0.15,
        autoGrade: true
      }
    });
    await course2.save();
    console.log('Created courses');

    // Create task templates
    const template1 = new TaskTemplate({
      name: 'Координатна трансформация - Основи',
      type: 'coordinate-transformation',
      description: 'Трансформация на координати с ротация, мащабиране и транслация',
      difficulty: 'medium',
      level: 5,
      generatorScript: `
        // Generate coordinate transformation task
        const x1 = Math.random() * 1000 - 500;
        const y1 = Math.random() * 1000 - 500;
        const angle = Math.random() * 2 * Math.PI;
        const scale = 0.8 + Math.random() * 0.4;
        const dx = Math.random() * 100 - 50;
        const dy = Math.random() * 100 - 50;
        
        return {
          input: {
            x1: Math.round(x1 * 100) / 100,
            y1: Math.round(y1 * 100) / 100,
            angle: Math.round(angle * 1000) / 1000,
            scale: Math.round(scale * 1000) / 1000,
            dx: Math.round(dx * 100) / 100,
            dy: Math.round(dy * 100) / 100
          },
          description: "Transform the given coordinates using the transformation parameters"
        };
      `,
      solutionScript: `
        // Solution for coordinate transformation
        const { x1, y1, angle, scale, dx, dy } = inputData;
        
        // Apply transformation
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        
        const x2 = x1 * scale * cos - y1 * scale * sin + dx;
        const y2 = x1 * scale * sin + y1 * scale * cos + dy;
        
        return {
          x2: Math.round(x2 * 100) / 100,
          y2: Math.round(y2 * 100) / 100
        };
      `,
      gradingSettings: {
        tolerance: 0.001,
        toleranceType: 'absolute',
        maxScore: 100
      },
      tags: ['coordinate-transformation', 'geometry', 'basics'],
      createdBy: teacher._id,
      isPublic: true
    });
    await template1.save();

    const template2 = new TaskTemplate({
      name: 'Засечка напред - Практика',
      type: 'forward-intersection',
      description: 'Изчисляване на координати чрез засечка напред',
      difficulty: 'hard',
      level: 7,
      generatorScript: `
        // Generate forward intersection task
        const x1 = Math.random() * 1000 - 500;
        const y1 = Math.random() * 1000 - 500;
        const x2 = Math.random() * 1000 - 500;
        const y2 = Math.random() * 1000 - 500;
        const angle1 = Math.random() * Math.PI;
        const angle2 = Math.random() * Math.PI;
        
        return {
          input: {
            x1: Math.round(x1 * 100) / 100,
            y1: Math.round(y1 * 100) / 100,
            x2: Math.round(x2 * 100) / 100,
            y2: Math.round(y2 * 100) / 100,
            angle1: Math.round(angle1 * 1000) / 1000,
            angle2: Math.round(angle2 * 1000) / 1000
          },
          description: "Calculate the intersection point using forward intersection"
        };
      `,
      solutionScript: `
        // Solution for forward intersection
        const { x1, y1, x2, y2, angle1, angle2 } = inputData;
        
        // Calculate intersection point
        const tan1 = Math.tan(angle1);
        const tan2 = Math.tan(angle2);
        
        const x = (y2 - y1 + x1 * tan1 - x2 * tan2) / (tan1 - tan2);
        const y = y1 + tan1 * (x - x1);
        
        return {
          x: Math.round(x * 100) / 100,
          y: Math.round(y * 100) / 100
        };
      `,
      gradingSettings: {
        tolerance: 0.01,
        toleranceType: 'absolute',
        maxScore: 100
      },
      tags: ['forward-intersection', 'surveying', 'advanced'],
      createdBy: teacher._id,
      isPublic: false
    });
    await template2.save();
    console.log('Created task templates');

    // Create assignments
    const assignment1 = new Assignment({
      title: 'Координатни трансформации - Тест 1',
      description: 'Първи тест по координатни трансформации',
      taskTemplate: template1._id,
      course: course1._id,
      variantsCount: 5,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      createdBy: teacher._id,
      options: {
        allowLateSubmissions: true,
        lateSubmissionPenalty: 0.1,
        autoGrade: true,
        maxAttempts: 3,
        showCorrectAnswers: false,
        showFeedback: true
      },
      settings: {
        customTolerance: 0.001,
        customToleranceType: 'absolute'
      },
      status: 'active'
    });

    // Generate variants for assignment1
    await assignment1.save();
    await assignment1.generateVariants();
    await assignment1.save();

    const assignment2 = new Assignment({
      title: 'Засечка напред - Практика',
      description: 'Практическо упражнение по засечка напред',
      taskTemplate: template2._id,
      course: course1._id,
      variantsCount: 3,
      dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
      createdBy: teacher._id,
      options: {
        allowLateSubmissions: true,
        lateSubmissionPenalty: 0.15,
        autoGrade: true,
        maxAttempts: 2,
        showCorrectAnswers: true,
        showFeedback: true
      },
      status: 'active'
    });

    await assignment2.save();
    await assignment2.generateVariants();
    await assignment2.save();
    console.log('Created assignments');

    // Create sample submissions
    const submissions = [];
    
    // Student 1 submissions
    for (let i = 0; i < 3; i++) {
      const submission = new Submission({
        assignment: assignment1._id,
        student: students[0]._id,
        variantIndex: i,
        answers: {
          x2: 100 + Math.random() * 50,
          y2: 200 + Math.random() * 50
        },
        computedScore: 85 + Math.random() * 15,
        status: 'graded',
        submittedAt: new Date(Date.now() - Math.random() * 3 * 24 * 60 * 60 * 1000),
        attemptNumber: 1,
        timeSpent: 25 + Math.random() * 15,
        isLate: false,
        latePenalty: 0,
        finalScore: 85 + Math.random() * 15
      });
      await submission.save();
      submissions.push(submission);
    }

    // Student 2 submissions
    for (let i = 0; i < 2; i++) {
      const submission = new Submission({
        assignment: assignment1._id,
        student: students[1]._id,
        variantIndex: i,
        answers: {
          x2: 100 + Math.random() * 50,
          y2: 200 + Math.random() * 50
        },
        computedScore: 70 + Math.random() * 20,
        status: 'graded',
        submittedAt: new Date(Date.now() - Math.random() * 2 * 24 * 60 * 60 * 1000),
        attemptNumber: 1,
        timeSpent: 30 + Math.random() * 20,
        isLate: false,
        latePenalty: 0,
        finalScore: 70 + Math.random() * 20
      });
      await submission.save();
      submissions.push(submission);
    }

    // Student 3 submissions (late)
    const lateSubmission = new Submission({
      assignment: assignment1._id,
      student: students[2]._id,
      variantIndex: 0,
      answers: {
        x2: 100 + Math.random() * 50,
        y2: 200 + Math.random() * 50
      },
      computedScore: 60,
      status: 'graded',
      submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day late
      attemptNumber: 1,
      timeSpent: 45,
      isLate: true,
      latePenalty: 0.1,
      finalScore: 54 // 60 * (1 - 0.1)
    });
    await lateSubmission.save();
    submissions.push(lateSubmission);
    console.log('Created sample submissions');

    // Create audit entries
    const auditEntries = [
      {
        operation: 'create_course',
        performedBy: teacher._id,
        targetEntity: { type: 'course', id: course1._id },
        description: `Създаден курс: ${course1.name}`,
        newValues: { name: course1.name, code: course1.code }
      },
      {
        operation: 'create_task_template',
        performedBy: teacher._id,
        targetEntity: { type: 'task_template', id: template1._id },
        description: `Създаден шаблон: ${template1.name}`,
        newValues: { name: template1.name, type: template1.type }
      },
      {
        operation: 'create_assignment',
        performedBy: teacher._id,
        targetEntity: { type: 'assignment', id: assignment1._id },
        description: `Създадено задание: ${assignment1.title}`,
        newValues: { title: assignment1.title, course: course1.name }
      }
    ];

    for (const auditData of auditEntries) {
      await Audit.logOperation(auditData);
    }
    console.log('Created audit entries');

    // Update assignment statistics
    assignment1.statistics.totalSubmissions = submissions.filter(s => s.assignment.equals(assignment1._id)).length;
    assignment1.statistics.averageScore = submissions
      .filter(s => s.assignment.equals(assignment1._id))
      .reduce((sum, s) => sum + s.finalScore, 0) / submissions.filter(s => s.assignment.equals(assignment1._id)).length;
    await assignment1.save();

    console.log('Teacher panel seed completed successfully!');
    console.log('\nSummary:');
    console.log(`Teacher: ${teacher.name} (${teacher.email})`);
    console.log(`Students: ${students.length}`);
    console.log(`Courses: 2`);
    console.log(`Templates: 2`);
    console.log(`Assignments: 2`);
    console.log(`Submissions: ${submissions.length}`);
    console.log(`Audit entries: ${auditEntries.length}`);
    console.log('\nTest credentials:');
    console.log('Teacher: teacher@example.com / password');
    console.log('Students: student1@example.com, student2@example.com, student3@example.com / password');

  } catch (error) {
    console.error('Error seeding teacher panel:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
};

// Run seed if called directly
if (require.main === module) {
  seedTeacherPanel()
    .then(() => {
      console.log('Seed completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed failed:', error);
      process.exit(1);
    });
}

module.exports = seedTeacherPanel;
