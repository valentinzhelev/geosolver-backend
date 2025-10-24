const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Import models
const User = require('../models/User');
const Course = require('../models/Course');
const TaskTemplate = require('../models/TaskTemplate');
const Assignment = require('../models/Assignment');
const Submission = require('../models/Submission');
const Audit = require('../models/Audit');

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  // Clean up database before each test
  await User.deleteMany({});
  await Course.deleteMany({});
  await TaskTemplate.deleteMany({});
  await Assignment.deleteMany({});
  await Submission.deleteMany({});
  await Audit.deleteMany({});
});

describe('User Model', () => {
  test('should create a user with valid data', async () => {
    const userData = {
      name: 'Test Teacher',
      email: 'teacher@test.com',
      password: 'hashedpassword',
      role: 'teacher'
    };

    const user = new User(userData);
    const savedUser = await user.save();

    expect(savedUser._id).toBeDefined();
    expect(savedUser.name).toBe(userData.name);
    expect(savedUser.email).toBe(userData.email);
    expect(savedUser.role).toBe(userData.role);
  });

  test('should require email and password', async () => {
    const user = new User({ name: 'Test User' });
    
    await expect(user.save()).rejects.toThrow();
  });

  test('should enforce unique email', async () => {
    const userData = {
      name: 'Test User',
      email: 'test@test.com',
      password: 'hashedpassword'
    };

    await new User(userData).save();
    
    const duplicateUser = new User(userData);
    await expect(duplicateUser.save()).rejects.toThrow();
  });
});

describe('Course Model', () => {
  let teacher;

  beforeEach(async () => {
    teacher = new User({
      name: 'Test Teacher',
      email: 'teacher@test.com',
      password: 'hashedpassword',
      role: 'teacher'
    });
    await teacher.save();
  });

  test('should create a course with valid data', async () => {
    const courseData = {
      name: 'Test Course',
      code: 'TEST101',
      description: 'Test course description',
      owner: teacher._id
    };

    const course = new Course(courseData);
    const savedCourse = await course.save();

    expect(savedCourse._id).toBeDefined();
    expect(savedCourse.name).toBe(courseData.name);
    expect(savedCourse.code).toBe(courseData.code);
    expect(savedCourse.owner.toString()).toBe(teacher._id.toString());
  });

  test('should enforce unique course code', async () => {
    const courseData = {
      name: 'Test Course',
      code: 'TEST101',
      owner: teacher._id
    };

    await new Course(courseData).save();
    
    const duplicateCourse = new Course(courseData);
    await expect(duplicateCourse.save()).rejects.toThrow();
  });

  test('should add student to course', async () => {
    const course = new Course({
      name: 'Test Course',
      code: 'TEST101',
      owner: teacher._id
    });
    await course.save();

    const student = new User({
      name: 'Test Student',
      email: 'student@test.com',
      password: 'hashedpassword',
      role: 'student'
    });
    await student.save();

    await course.addStudent(student._id);
    
    expect(course.students).toContainEqual(student._id);
  });
});

describe('TaskTemplate Model', () => {
  let teacher;

  beforeEach(async () => {
    teacher = new User({
      name: 'Test Teacher',
      email: 'teacher@test.com',
      password: 'hashedpassword',
      role: 'teacher'
    });
    await teacher.save();
  });

  test('should create a task template with valid data', async () => {
    const templateData = {
      name: 'Test Template',
      type: 'coordinate-transformation',
      description: 'Test template description',
      difficulty: 'medium',
      level: 5,
      generatorScript: 'return { x: Math.random() * 100 };',
      solutionScript: 'return { result: inputData.x * 2 };',
      createdBy: teacher._id
    };

    const template = new TaskTemplate(templateData);
    const savedTemplate = await template.save();

    expect(savedTemplate._id).toBeDefined();
    expect(savedTemplate.name).toBe(templateData.name);
    expect(savedTemplate.type).toBe(templateData.type);
    expect(savedTemplate.createdBy.toString()).toBe(teacher._id.toString());
  });

  test('should validate generator script', () => {
    const template = new TaskTemplate({
      name: 'Test Template',
      type: 'coordinate-transformation',
      generatorScript: 'return { x: Math.random() * 100 };',
      solutionScript: 'return { result: inputData.x * 2 };',
      createdBy: new mongoose.Types.ObjectId()
    });

    const validation = template.validateGenerator();
    expect(validation.valid).toBe(true);
  });

  test('should validate solution script', () => {
    const template = new TaskTemplate({
      name: 'Test Template',
      type: 'coordinate-transformation',
      generatorScript: 'return { x: Math.random() * 100 };',
      solutionScript: 'return { result: inputData.x * 2 };',
      createdBy: new mongoose.Types.ObjectId()
    });

    const validation = template.validateSolution();
    expect(validation.valid).toBe(true);
  });
});

describe('Assignment Model', () => {
  let teacher, course, template;

  beforeEach(async () => {
    teacher = new User({
      name: 'Test Teacher',
      email: 'teacher@test.com',
      password: 'hashedpassword',
      role: 'teacher'
    });
    await teacher.save();

    course = new Course({
      name: 'Test Course',
      code: 'TEST101',
      owner: teacher._id
    });
    await course.save();

    template = new TaskTemplate({
      name: 'Test Template',
      type: 'coordinate-transformation',
      generatorScript: 'return { x: Math.random() * 100 };',
      solutionScript: 'return { result: inputData.x * 2 };',
      createdBy: teacher._id
    });
    await template.save();
  });

  test('should create an assignment with valid data', async () => {
    const assignmentData = {
      title: 'Test Assignment',
      description: 'Test assignment description',
      taskTemplate: template._id,
      course: course._id,
      variantsCount: 5,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
      createdBy: teacher._id
    };

    const assignment = new Assignment(assignmentData);
    const savedAssignment = await assignment.save();

    expect(savedAssignment._id).toBeDefined();
    expect(savedAssignment.title).toBe(assignmentData.title);
    expect(savedAssignment.variantsCount).toBe(assignmentData.variantsCount);
    expect(savedAssignment.taskTemplate.toString()).toBe(template._id.toString());
    expect(savedAssignment.course.toString()).toBe(course._id.toString());
  });

  test('should check if assignment is active', () => {
    const futureDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const assignment = new Assignment({
      title: 'Test Assignment',
      taskTemplate: template._id,
      course: course._id,
      variantsCount: 1,
      dueDate: futureDate,
      createdBy: teacher._id,
      status: 'active'
    });

    expect(assignment.isActive()).toBe(true);
  });

  test('should check if assignment is not active', () => {
    const pastDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const assignment = new Assignment({
      title: 'Test Assignment',
      taskTemplate: template._id,
      course: course._id,
      variantsCount: 1,
      dueDate: pastDate,
      createdBy: teacher._id,
      status: 'active'
    });

    expect(assignment.isActive()).toBe(false);
  });
});

describe('Submission Model', () => {
  let teacher, student, assignment;

  beforeEach(async () => {
    teacher = new User({
      name: 'Test Teacher',
      email: 'teacher@test.com',
      password: 'hashedpassword',
      role: 'teacher'
    });
    await teacher.save();

    student = new User({
      name: 'Test Student',
      email: 'student@test.com',
      password: 'hashedpassword',
      role: 'student'
    });
    await student.save();

    const course = new Course({
      name: 'Test Course',
      code: 'TEST101',
      owner: teacher._id
    });
    await course.save();

    const template = new TaskTemplate({
      name: 'Test Template',
      type: 'coordinate-transformation',
      generatorScript: 'return { x: Math.random() * 100 };',
      solutionScript: 'return { result: inputData.x * 2 };',
      createdBy: teacher._id
    });
    await template.save();

    assignment = new Assignment({
      title: 'Test Assignment',
      taskTemplate: template._id,
      course: course._id,
      variantsCount: 1,
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdBy: teacher._id
    });
    await assignment.save();
  });

  test('should create a submission with valid data', async () => {
    const submissionData = {
      assignment: assignment._id,
      student: student._id,
      variantIndex: 0,
      answers: { x: 50, y: 100 },
      timeSpent: 30
    };

    const submission = new Submission(submissionData);
    const savedSubmission = await submission.save();

    expect(savedSubmission._id).toBeDefined();
    expect(savedSubmission.assignment.toString()).toBe(assignment._id.toString());
    expect(savedSubmission.student.toString()).toBe(student._id.toString());
    expect(savedSubmission.variantIndex).toBe(submissionData.variantIndex);
    expect(savedSubmission.answers).toEqual(submissionData.answers);
  });

  test('should calculate late penalty', () => {
    const pastDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    const assignment = new Assignment({
      title: 'Test Assignment',
      taskTemplate: new mongoose.Types.ObjectId(),
      course: new mongoose.Types.ObjectId(),
      variantsCount: 1,
      dueDate: pastDate,
      createdBy: new mongoose.Types.ObjectId(),
      options: {
        allowLateSubmissions: true,
        lateSubmissionPenalty: 0.1
      }
    });

    const submission = new Submission({
      assignment: assignment._id,
      student: student._id,
      variantIndex: 0,
      answers: { x: 50 },
      isLate: true
    });

    const penalty = submission.calculateLatePenalty(assignment);
    expect(penalty).toBeGreaterThan(0);
  });
});

describe('Audit Model', () => {
  let teacher;

  beforeEach(async () => {
    teacher = new User({
      name: 'Test Teacher',
      email: 'teacher@test.com',
      password: 'hashedpassword',
      role: 'teacher'
    });
    await teacher.save();
  });

  test('should create an audit entry', async () => {
    const auditData = {
      operation: 'create_assignment',
      performedBy: teacher._id,
      targetEntity: {
        type: 'assignment',
        id: new mongoose.Types.ObjectId()
      },
      details: {
        description: 'Created new assignment'
      }
    };

    const audit = new Audit(auditData);
    const savedAudit = await audit.save();

    expect(savedAudit._id).toBeDefined();
    expect(savedAudit.operation).toBe(auditData.operation);
    expect(savedAudit.performedBy.toString()).toBe(teacher._id.toString());
  });

  test('should log operation using static method', async () => {
    const operationData = {
      operation: 'create_course',
      performedBy: teacher._id,
      targetEntity: {
        type: 'course',
        id: new mongoose.Types.ObjectId()
      },
      description: 'Created new course',
      newValues: { name: 'Test Course' }
    };

    const audit = await Audit.logOperation(operationData);

    expect(audit._id).toBeDefined();
    expect(audit.operation).toBe(operationData.operation);
    expect(audit.details.description).toBe(operationData.description);
  });
});
