// sourceCalculationId is system-controlled provenance: only
// POST /api/calculations/:id/create-point may assign it. These tests drive the
// REAL /api/points handlers (create, import, update) and prove a normal
// client can neither set, change, nor remove it.
process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/SurveyPoint', () => {
  const mockModel = jest.fn();
  mockModel.create = jest.fn();
  mockModel.insertMany = jest.fn();
  mockModel.findById = jest.fn();
  mockModel.find = jest.fn();
  mockModel.deleteOne = jest.fn();
  return mockModel;
});
jest.mock('../../models/Workspace');
jest.mock('../../models/FieldBookProject');

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const SurveyPoint = require('../../models/SurveyPoint');

const USER = 'user-1';
const auth = () => ({ Authorization: `Bearer ${jwt.sign({ id: USER, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '15m' })}` });

beforeEach(() => {
  SurveyPoint.create.mockImplementation(async (doc) => ({ _id: 'p-new', ...doc }));
  SurveyPoint.insertMany.mockImplementation(async (docs) => docs.map((d, i) => ({ _id: `p-${i}`, ...d })));
});
afterEach(() => jest.resetAllMocks());

function existingPoint(extra = {}) {
  return {
    _id: 'p-existing',
    user: USER, // owner of the point, so the update is authorized
    projectId: null,
    name: 'old',
    code: '',
    x: 1,
    y: 2,
    h: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...extra,
  };
}

describe('POST /api/points cannot assign sourceCalculationId', () => {
  it('ignores sourceCalculationId in the body of a manual create', async () => {
    const res = await request(app)
      .post('/api/points')
      .set(auth())
      .send({ name: 'Manual', x: 1, y: 2, sourceCalculationId: '507f1f77bcf86cd799439099' });

    expect(res.status).toBe(201);
    const doc = SurveyPoint.create.mock.calls[0][0];
    expect(doc).not.toHaveProperty('sourceCalculationId');
    expect(doc.name).toBe('Manual');
  });
});

describe('POST /api/points/import cannot assign sourceCalculationId', () => {
  it('ignores sourceCalculationId on every imported row (and at the request level)', async () => {
    const res = await request(app)
      .post('/api/points/import')
      .set(auth())
      .send({
        sourceCalculationId: 'top-level-forgery',
        points: [
          { name: 'A', x: 1, y: 2, sourceCalculationId: 'row-forgery-1' },
          { name: 'B', x: 3, y: 4, sourceCalculationId: 'row-forgery-2' },
        ],
      });

    expect(res.status).toBe(201);
    const docs = SurveyPoint.insertMany.mock.calls[0][0];
    expect(docs).toHaveLength(2);
    docs.forEach((d) => expect(d).not.toHaveProperty('sourceCalculationId'));
  });
});

describe('PUT /api/points/:id cannot touch sourceCalculationId', () => {
  it('cannot ADD provenance to an ordinary point', async () => {
    const point = existingPoint(); // no sourceCalculationId
    SurveyPoint.findById.mockResolvedValue(point);

    const res = await request(app)
      .put('/api/points/p-existing')
      .set(auth())
      .send({ name: 'renamed', sourceCalculationId: '507f1f77bcf86cd799439099' });

    expect(res.status).toBe(200);
    expect(point.name).toBe('renamed'); // the legitimate edit still applied
    expect(point.sourceCalculationId).toBeUndefined();
  });

  it('cannot CHANGE the provenance of a generated point', async () => {
    const point = existingPoint({ sourceCalculationId: 'calc-original' });
    SurveyPoint.findById.mockResolvedValue(point);

    const res = await request(app)
      .put('/api/points/p-existing')
      .set(auth())
      .send({ name: 'edited', x: 999, sourceCalculationId: 'calc-attacker' });

    expect(res.status).toBe(200);
    expect(point.x).toBe(999); // editing coordinates is an existing, allowed operation
    expect(point.sourceCalculationId).toBe('calc-original');
  });

  it.each([null, '', undefined])('cannot REMOVE the provenance of a generated point (body value %p)', async (value) => {
    const point = existingPoint({ sourceCalculationId: 'calc-original' });
    SurveyPoint.findById.mockResolvedValue(point);

    const res = await request(app)
      .put('/api/points/p-existing')
      .set(auth())
      .send({ name: 'edited', sourceCalculationId: value });

    expect(res.status).toBe(200);
    expect(point.sourceCalculationId).toBe('calc-original');
  });
});
