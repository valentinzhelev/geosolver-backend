process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/TaskTemplate', () => {
  const mockCtor = jest.fn();
  mockCtor.findById = jest.fn();
  return mockCtor;
});
jest.mock('../../models/Audit', () => ({ logOperation: jest.fn().mockResolvedValue(undefined) }));
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const TaskTemplate = require('../../models/TaskTemplate');

const token = (role) => jwt.sign({ id: 'admin-id', role }, process.env.JWT_SECRET, { expiresIn: '15m' });

describe('POST /api/teacher/tasks/:id/test (admin preview) goes through generateVariantData', () => {
  afterEach(() => jest.clearAllMocks());

  it('returns the student-visible inputData and the solution from the split — the ground-truth key is never in the response', async () => {
    const generateVariantData = jest.fn().mockResolvedValue({ inputData: { xA: 1, yA: 2 }, solution: { xP: 3, yP: 4 } });
    TaskTemplate.findById.mockResolvedValue({ createdBy: { toString: () => 'someone-else' }, generateVariantData });

    const res = await request(app)
      .post('/api/teacher/tasks/000000000000000000000000/test')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({ variantIndex: 2, seed: 99 });

    expect(res.status).toBe(200);
    expect(generateVariantData).toHaveBeenCalledWith(2, 99);
    expect(res.body.data.inputData).toEqual({ xA: 1, yA: 2 });
    expect(res.body.data.solution).toEqual({ xP: 3, yP: 4 });
    expect(JSON.stringify(res.body)).not.toContain('__groundTruth');
  });

  it('an untrusted template surfaces as a 400 (the trust gate rejected it), not a crash', async () => {
    const generateVariantData = jest.fn().mockRejectedValue(new Error('Untrusted template: script execution is not permitted for this template.'));
    TaskTemplate.findById.mockResolvedValue({ createdBy: { toString: () => 'x' }, generateVariantData });

    const res = await request(app)
      .post('/api/teacher/tasks/000000000000000000000000/test')
      .set('Authorization', `Bearer ${token('admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Untrusted template/);
  });

  it('a teacher is still forbidden from the preview endpoint', async () => {
    const res = await request(app)
      .post('/api/teacher/tasks/000000000000000000000000/test')
      .set('Authorization', `Bearer ${token('teacher')}`)
      .send({});
    expect(res.status).toBe(403);
    expect(TaskTemplate.findById).not.toHaveBeenCalled();
  });
});
