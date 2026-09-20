process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/Course');
jest.mock('../../models/User');
jest.mock('../../models/TaskTemplate');
jest.mock('../../models/Audit', () => ({ logOperation: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/notifications', () => ({
  createNotification: jest.fn().mockResolvedValue(undefined),
  notifyCourseStudents: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const Assignment = require('../../models/Assignment');
const Course = require('../../models/Course');
const Submission = require('../../models/Submission');
const TaskTemplate = require('../../models/TaskTemplate');

/**
 * Milestone 2.1 - ground truth must never reach a student. Every student-facing path that returns
 * variant data (student GET, shared GET student branch, submit response, resume/reopen = the same GET)
 * is exercised with a stored variant deliberately "poisoned" with reserved "__" keys, the worst case of
 * an unexpected generator/legacy row. Teacher/admin behaviour is documented at the end.
 */

const STUDENT = 'student-1';
const token = (role, id = STUDENT) => jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '15m' });
const SECRET = 31337.125;
const CLEAN_INPUT = { xA: 1, yA: 2, beta1: 50, beta2: 60, nested: { ok: 1 }, list: [{ a: 1 }] };

function poisonedAssignment() {
  return new Assignment({
    title: 'Resection',
    course: '507f1f77bcf86cd799439011',
    taskTemplate: '507f1f77bcf86cd799439012',
    createdBy: '507f1f77bcf86cd799439013',
    dueDate: new Date(Date.now() + 86400000),
    status: 'active',
    variantsCount: 1,
    options: { autoGrade: true, maxAttempts: 3 },
    variants: [{
      variantIndex: 0,
      inputData: {
        xA: 1, yA: 2, beta1: 50, beta2: 60,
        __groundTruth: { xP: SECRET, yP: SECRET },
        __weird: 'hidden',
        nested: { ok: 1, __deep: SECRET },
        list: [{ a: 1, __inArray: SECRET }],
      },
      solution: { xP: 10.5, yP: 20.25 },
      solutionHash: 'hash-hash-hash',
    }],
  });
}

const chain = (value) => {
  const p = Promise.resolve(value);
  p.populate = () => p;
  p.sort = () => p;
  p.select = () => p;
  return p;
};

function mockStudent(assignment) {
  Assignment.findById = jest.fn(() => chain(assignment));
  Course.findById = jest.fn().mockResolvedValue({ students: [STUDENT] });
  Submission.find = jest.fn(() => chain([]));
  TaskTemplate.findById = jest.fn().mockResolvedValue({
    gradingSettings: { tolerance: 0.01, toleranceType: 'absolute' },
    tags: ['tool:resection'],
  });
}

// Shape of the shared GET after populate(): a plain view over the real stored variants
function populated(students) {
  const doc = poisonedAssignment();
  return {
    createdBy: { _id: { toString: () => 'teacher-1' } },
    course: { students },
    variants: doc.variants,
    toObject: () => ({ title: doc.title, variants: doc.toObject().variants }),
  };
}

const assertClean = (body) => {
  const text = JSON.stringify(body);
  for (const forbidden of ['__groundTruth', '__weird', '__deep', '__inArray', String(SECRET), 'solutionHash', 'hash-hash-hash', '"solution"']) {
    expect(text).not.toContain(forbidden);
  }
};

beforeEach(() => { jest.spyOn(Assignment.prototype, 'save').mockImplementation(async function save() { return this; }); });
afterEach(() => jest.restoreAllMocks());

describe('student-facing variant data is stripped of every reserved key (fail closed)', () => {
  it('GET /api/student/assignments/assignments/:id (also the resume/reopen path) returns only measurements', async () => {
    mockStudent(poisonedAssignment());
    const res = await request(app)
      .get('/api/student/assignments/assignments/507f1f77bcf86cd799439014')
      .set('Authorization', `Bearer ${token('student')}`);
    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    assertClean(res.body);
    expect(res.body.data.variants).toEqual([{ variantIndex: 0, inputData: CLEAN_INPUT }]);
  });

  it('GET /api/assignments/:id student branch returns only measurements', async () => {
    const a = populated([STUDENT]);
    Assignment.findById = jest.fn(() => chain(a));
    const res = await request(app)
      .get('/api/assignments/507f1f77bcf86cd799439014')
      .set('Authorization', `Bearer ${token('student')}`);
    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    assertClean(res.body);
    expect(res.body.data.variants[0].inputData).toEqual(CLEAN_INPUT);
  });

  it('the submit response never carries variant data, solution or reserved keys; grading uses the SERVER solution', async () => {
    mockStudent(poisonedAssignment());
    let stored;
    jest.spyOn(Submission.prototype, 'save').mockImplementation(async function save() { stored = this; return this; }); // (pre-save hook skipped: assert computedScore)
    const res = await request(app)
      .post('/api/student/assignments/assignments/507f1f77bcf86cd799439014/submit')
      .set('Authorization', `Bearer ${token('student')}`)
      .send({ variantIndex: 0, answers: { xP: 10.5, yP: 20.25 } });
    if (res.status !== 201) console.log(res.body);
    expect(res.status).toBe(201);
    expect(stored.computedScore).toBe(100);
    assertClean(res.body);
  });

  it('forged "__" answers are dropped before storage and can never be graded as the answer', async () => {
    mockStudent(poisonedAssignment());
    let stored;
    jest.spyOn(Submission.prototype, 'save').mockImplementation(async function save() { stored = this; return this; });
    const res = await request(app)
      .post('/api/student/assignments/assignments/507f1f77bcf86cd799439014/submit')
      .set('Authorization', `Bearer ${token('student')}`)
      .send({ variantIndex: 0, answers: { xP: 999, yP: 999, __groundTruth: { xP: 10.5, yP: 20.25 }, __solution: { xP: 10.5, yP: 20.25 } } });
    if (res.status !== 201) console.log(res.body);
    expect(res.status).toBe(201);
    expect(stored.computedScore).toBe(0); // the forged truth did not help
    expect(stored.answers).toEqual({ xP: 999, yP: 999 });
    expect(JSON.stringify(stored.answers)).not.toContain('__');
  });
});

describe('the shared helper', () => {
  const { stripReservedKeys, toStudentVariants, sanitizeStudentAnswers } = require('../../utils/studentVariantView');

  it('removes every "__"-prefixed key at any depth, keeps everything else, never copies solution fields', () => {
    expect(stripReservedKeys({ a: 1, __x: 2, b: { __y: 3, c: [{ __z: 4, d: 5 }] } })).toEqual({ a: 1, b: { c: [{ d: 5 }] } });
    expect(stripReservedKeys(5)).toBe(5);
    expect(stripReservedKeys(null)).toBe(null);
    expect(toStudentVariants([{ variantIndex: 2, inputData: { a: 1, __g: 1 }, solution: { x: 1 }, solutionHash: 'h' }]))
      .toEqual([{ variantIndex: 2, inputData: { a: 1 } }]);
    expect(toStudentVariants(undefined)).toEqual([]);
    expect(sanitizeStudentAnswers({ x: 1, __y: 2 })).toEqual({ x: 1 });
    expect(sanitizeStudentAnswers(7)).toBe(7);
  });
});

describe('teacher / admin behaviour (documented, intentionally different)', () => {
  it('the teacher branch of GET /api/assignments/:id returns the full assignment INCLUDING solutions; a stored variant holds no reserved key because generateVariants splits it off', async () => {
    const a = populated([]);
    a.variants[0].inputData = { xA: 1 }; // what generateVariants actually stores
    Assignment.findById = jest.fn(() => chain(a));
    const res = await request(app)
      .get('/api/assignments/507f1f77bcf86cd799439014')
      .set('Authorization', `Bearer ${token('teacher', 'teacher-1')}`);
    if (res.status !== 200) console.log(res.body);
    expect(res.status).toBe(200);
    expect(res.body.data.variants[0].solution).toEqual({ xP: 10.5, yP: 20.25 });
    expect(JSON.stringify(res.body)).not.toContain('__groundTruth');
  });
});
