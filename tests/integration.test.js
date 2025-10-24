const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const jwt = require('jsonwebtoken');

// Import the app
const app = require('../index');

// Import models
const User = require('../models/User');
const Course = require('../models/Course');
const TaskTemplate = require('../models/TaskTemplate');
const Assignment = require('../models/Assignment');

let mongoServer;
let teacherToken;
let studentToken;
let teacherId;
let studentId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);

  // Create test users
  const teacher = new User({
    name: 'Test Teacher',
    email: 'teacher@test.com',
    password: 'hashedpassword',
    role: 'teacher'
  });
  await teacher.save();
  teacherId = teacher._id;
  teacherToken = jwt.sign({ id: teacherId, role: 'teacher' }, process.env.JWT_SECRET || 'test-secret');

  const student = new User({
    name: 'Test Student',
    email: 'student@test.com',
    password: 'hashedpassword',
    role: 'student'
  });
  await student.save();
  studentId = student._id;
  studentToken = jwt.sign({ id: studentId, role: 'student' }, process.env.JWT_SECRET || 'test-secret');
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Clean up database before each test
  await Course.deleteMany({});
  await TaskTemplate.deleteMany({});
  await Assignment.deleteMany({});
});

describe('Teacher API Endpoints', () => {
  describe('POST /api/teacher/tasks', () => {
    test('should create a task template', async () => {
      const templateData = {
        name: 'Test Template',
        type: 'coordinate-transformation',
        description: 'Test template description',
        difficulty: 'medium',
        level: 5,
        generatorScript: 'return { x: Math.random() * 100, y: Math.random() * 100 };',
        solutionScript: 'const { x, y } = inputData; return { distance: Math.sqrt(x*x + y*y) };',
        gradingSettings: {
          tolerance: 0.001,
          toleranceType: 'absolute',
          maxScore: 100
        }
      };

      const response = await request(app)
        .post('/api/teacher/tasks')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(templateData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(templateData.name);
      expect(response.body.data.type).toBe(templateData.type);
    });

    test('should reject invalid task template', async () => {
      const invalidData = {
        name: 'Test Template',
        // Missing required fields
      };

      const response = await request(app)
        .post('/api/teacher/tasks')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    test('should require teacher role', async () => {
      const templateData = {
        name: 'Test Template',
        type: 'coordinate-transformation',
        generatorScript: 'return { x: 1 };',
        solutionScript: 'return { result: inputData.x };'
      };

      const response = await request(app)
        .post('/api/teacher/tasks')
        .set('Authorization', `Bearer ${studentToken}`)
        .send(templateData);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /api/teacher/tasks', () => {
    beforeEach(async () => {
      // Create test templates
      const template1 = new TaskTemplate({
        name: 'Template 1',
        type: 'coordinate-transformation',
        generatorScript: 'return { x: 1 };',
        solutionScript: 'return { result: inputData.x };',
        createdBy: teacherId
      });
      await template1.save();

      const template2 = new TaskTemplate({
        name: 'Template 2',
        type: 'forward-intersection',
        generatorScript: 'return { x: 2 };',
        solutionScript: 'return { result: inputData.x };',
        createdBy: teacherId,
        isPublic: true
      });
      await template2.save();
    });

    test('should get teacher templates', async () => {
      const response = await request(app)
        .get('/api/teacher/tasks')
        .set('Authorization', `Bearer ${teacherToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(2);
    });

    test('should filter by type', async () => {
      const response = await request(app)
        .get('/api/teacher/tasks?type=coordinate-transformation')
        .set('Authorization', `Bearer ${teacherToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].type).toBe('coordinate-transformation');
    });
  });

  describe('POST /api/teacher/courses', () => {
    test('should create a course', async () => {
      const courseData = {
        name: 'Test Course',
        code: 'TEST101',
        description: 'Test course description'
      };

      const response = await request(app)
        .post('/api/teacher/courses')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(courseData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe(courseData.name);
      expect(response.body.data.code).toBe(courseData.code);
    });

    test('should reject duplicate course code', async () => {
      const courseData = {
        name: 'Test Course',
        code: 'TEST101'
      };

      // Create first course
      await request(app)
        .post('/api/teacher/courses')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(courseData);

      // Try to create duplicate
      const response = await request(app)
        .post('/api/teacher/courses')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(courseData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/teacher/assignments', () => {
    let course, template;

    beforeEach(async () => {
      course = new Course({
        name: 'Test Course',
        code: 'TEST101',
        owner: teacherId
      });
      await course.save();

      template = new TaskTemplate({
        name: 'Test Template',
        type: 'coordinate-transformation',
        generatorScript: 'return { x: Math.random() * 100, y: Math.random() * 100 };',
        solutionScript: 'const { x, y } = inputData; return { distance: Math.sqrt(x*x + y*y) };',
        createdBy: teacherId
      });
      await template.save();
    });

    test('should create an assignment', async () => {
      const assignmentData = {
        title: 'Test Assignment',
        description: 'Test assignment description',
        taskTemplate: template._id.toString(),
        course: course._id.toString(),
        variantsCount: 3,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        options: {
          allowLateSubmissions: true,
          autoGrade: true
        }
      };

      const response = await request(app)
        .post('/api/teacher/assignments')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(assignmentData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe(assignmentData.title);
      expect(response.body.data.variantsCount).toBe(assignmentData.variantsCount);
    });

    test('should reject assignment with invalid course', async () => {
      const assignmentData = {
        title: 'Test Assignment',
        taskTemplate: template._id.toString(),
        course: new mongoose.Types.ObjectId().toString(),
        variantsCount: 3,
        dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      };

      const response = await request(app)
        .post('/api/teacher/assignments')
        .set('Authorization', `Bearer ${teacherToken}`)
        .send(assignmentData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});

describe('Student API Endpoints', () => {
  let course, assignment;

  beforeEach(async () => {
    course = new Course({
      name: 'Test Course',
      code: 'TEST101',
      owner: teacherId,
      students: [studentId]
    });
    await course.save();

    const template = new TaskTemplate({
      name: 'Test Template',
      type: 'coordinate-transformation',
      generatorScript: 'return { x: Math.random() * 100, y: Math.random() * 100 };',
      solutionScript: 'const { x, y } = inputData; return { distance: Math.sqrt(x*x + y*y) };',
      createdBy: teacherId
    });
    await template.save();

    assignment = new Assignment({
      title: 'Test Assignment',
      taskTemplate: template._id,
      course: course._id,
      variantsCount: 1,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdBy: teacherId,
      status: 'active',
      variants: [{
        variantIndex: 0,
        inputData: { x: 3, y: 4 },
        solution: { distance: 5 },
        solutionHash: 'test-hash'
      }]
    });
    await assignment.save();
  });

  describe('GET /api/student/assignments', () => {
    test('should get student assignments', async () => {
      const response = await request(app)
        .get('/api/student/assignments')
        .set('Authorization', `Bearer ${studentToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.length).toBe(1);
      expect(response.body.data[0].title).toBe('Test Assignment');
    });
  });

  describe('POST /api/student/assignments/:id/submit', () => {
    test('should submit assignment', async () => {
      const submissionData = {
        answers: { distance: 5.1 },
        variantIndex: 0,
        timeSpent: 30
      };

      const response = await request(app)
        .post(`/api/student/assignments/${assignment._id}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(submissionData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.submissionId).toBeDefined();
    });

    test('should reject submission with invalid assignment', async () => {
      const submissionData = {
        answers: { distance: 5.1 },
        variantIndex: 0
      };

      const invalidId = new mongoose.Types.ObjectId();
      const response = await request(app)
        .post(`/api/student/assignments/${invalidId}/submit`)
        .set('Authorization', `Bearer ${studentToken}`)
        .send(submissionData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
    });
  });
});

describe('Authentication', () => {
  test('should require authentication for protected routes', async () => {
    const response = await request(app)
      .get('/api/teacher/tasks');

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Липсва токен');
  });

  test('should reject invalid token', async () => {
    const response = await request(app)
      .get('/api/teacher/tasks')
      .set('Authorization', 'Bearer invalid-token');

    expect(response.status).toBe(401);
    expect(response.body.message).toContain('Невалиден токен');
  });
});
