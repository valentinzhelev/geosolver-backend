process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/TaskTemplate', () => {
  const mockCtor = jest.fn().mockImplementation((data) => ({
    ...data,
    _id: 'mock-template-id',
    validateGenerator: () => ({ valid: true, error: null }),
    validateSolution: () => ({ valid: true, error: null }),
    save: jest.fn().mockResolvedValue(undefined),
  }));
  mockCtor.findById = jest.fn();
  return mockCtor;
});

jest.mock('../../models/Audit', () => ({
  logOperation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, templates: [] }),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const TaskTemplate = require('../../models/TaskTemplate');

function tokenFor(role) {
  return jwt.sign({ id: 'test-user-id', role }, process.env.JWT_SECRET, { expiresIn: '15m' });
}

const validScriptBody = {
  name: 'Malicious template',
  type: 'custom',
  description: 'test',
  generatorScript: 'return { a: 1 };',
  solutionScript: 'return { b: 2 };',
};

describe('TaskTemplate script endpoints reject self-registered teacher accounts', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/teacher/tasks: 403 for a teacher, and the template is never constructed/saved', async () => {
    const res = await request(app)
      .post('/api/teacher/tasks')
      .set('Authorization', `Bearer ${tokenFor('teacher')}`)
      .send(validScriptBody);

    expect(res.status).toBe(403);
    expect(TaskTemplate).not.toHaveBeenCalled();
  });

  it('PUT /api/teacher/tasks/:id: 403 for a teacher', async () => {
    const res = await request(app)
      .put('/api/teacher/tasks/000000000000000000000000')
      .set('Authorization', `Bearer ${tokenFor('teacher')}`)
      .send({ generatorScript: 'return {};' });

    expect(res.status).toBe(403);
  });

  it('POST /api/teacher/tasks/:id/test: 403 for a teacher', async () => {
    const res = await request(app)
      .post('/api/teacher/tasks/000000000000000000000000/test')
      .set('Authorization', `Bearer ${tokenFor('teacher')}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('POST /api/teacher/tasks: 403 with no token at all (unauthenticated)', async () => {
    const res = await request(app).post('/api/teacher/tasks').send(validScriptBody);
    expect([401, 403]).toContain(res.status);
  });
});

describe('TaskTemplate script endpoints still work for the trusted (admin) role', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/teacher/tasks: an admin passes the gate and the template is created', async () => {
    const res = await request(app)
      .post('/api/teacher/tasks')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send(validScriptBody);

    expect(res.status).toBe(201);
    expect(TaskTemplate).toHaveBeenCalledTimes(1);
  });
});

describe('isSystemTemplate provenance cannot be set via request payload, even by admin', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // Requirement 1.A: POST with isSystemTemplate: true in the body must not
  // produce a system template. isSystemTemplate must only ever be set by
  // utils/ensureMvpTemplates.js.
  it('POST /api/teacher/tasks: isSystemTemplate: true in the request body is not forwarded to the created template', async () => {
    const res = await request(app)
      .post('/api/teacher/tasks')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ ...validScriptBody, isSystemTemplate: true });

    expect(res.status).toBe(201);
    expect(TaskTemplate).toHaveBeenCalledTimes(1);
    const constructedWith = TaskTemplate.mock.calls[0][0];
    // The route handler destructures only named fields from req.body — it
    // must never read/forward isSystemTemplate at all.
    expect(constructedWith.isSystemTemplate).toBeUndefined();
  });

  // Requirement 1.B: PUT with isSystemTemplate: true in the body must not
  // change an existing template's provenance.
  it('PUT /api/teacher/tasks/:id: isSystemTemplate: true in the request body is ignored', async () => {
    const existingTemplate = {
      _id: '000000000000000000000000',
      createdBy: { toString: () => 'test-user-id' },
      isSystemTemplate: false,
      validateGenerator: () => ({ valid: true, error: null }),
      validateSolution: () => ({ valid: true, error: null }),
      save: jest.fn().mockResolvedValue(undefined),
    };
    TaskTemplate.findById.mockResolvedValue(existingTemplate);

    const res = await request(app)
      .put('/api/teacher/tasks/000000000000000000000000')
      .set('Authorization', `Bearer ${tokenFor('admin')}`)
      .send({ isSystemTemplate: true });

    expect(res.status).toBe(200);
    // The updateFields allow-list must never include 'isSystemTemplate'.
    expect(existingTemplate.isSystemTemplate).toBe(false);
    expect(existingTemplate.save).toHaveBeenCalledTimes(1);
  });
});

describe('Ordinary (non-script) teacher classroom operations are unaffected', () => {
  it('GET /api/teacher/tasks/builtin/list: still reachable for a teacher (not blocked by the new gate)', async () => {
    const res = await request(app)
      .get('/api/teacher/tasks/builtin/list')
      .set('Authorization', `Bearer ${tokenFor('teacher')}`);

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });
});
