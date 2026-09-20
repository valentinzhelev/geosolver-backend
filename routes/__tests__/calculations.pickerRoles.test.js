process.env.JWT_SECRET = 'test-secret-for-jest';

jest.mock('../../models/Calculation', () => {
  const mockCtor = jest.fn().mockImplementation((data) => ({
    ...data,
    _id: 'mock-calc-id',
    save: jest.fn().mockResolvedValue(undefined),
  }));
  mockCtor.find = jest.fn();
  mockCtor.findById = jest.fn();
  mockCtor.findOne = jest.fn();
  mockCtor.countDocuments = jest.fn().mockResolvedValue(0);
  return mockCtor;
});
jest.mock('../../models/SurveyPoint');
jest.mock('../../models/Workspace');
jest.mock('../../models/FieldBookProject');
jest.mock('../../utils/calculationLimits', () => ({
  getLimitsForUser: jest.fn().mockResolvedValue({ canCalculate: true, used: 0, limit: 5, unlimited: false }),
}));

const jwt = require('jsonwebtoken');
const request = require('supertest');
const app = require('../../app');
const Calculation = require('../../models/Calculation');
const SurveyPoint = require('../../models/SurveyPoint');
const FieldBookProject = require('../../models/FieldBookProject');
const { VALID_INPUTS, CURRENT_CLIENT_CONTRACT } = require('../../tests/support/canonicalInputs');

/**
 * QA-05: the PointPicker roles that the responsive fix exposes in EVERY layout (Forward Intersection pointA/pointB,
 * Resection pointA/pointB/pointC) are accepted by the backend provenance check, which stores server-derived
 * snapshots; a forged claim is still rejected. (First Basic Task 'station' is covered in calculations.project.test.js.)
 */

const OWNER = 'owner-id';
const PROJECT_ID = '507f1f77bcf86cd799439011';
const token = jwt.sign({ id: OWNER, role: 'student' }, process.env.JWT_SECRET, { expiresIn: '15m' });
const post = (body) => request(app).post('/api/calculations').set('Authorization', `Bearer ${token}`).send(body);

const CASES = [
  ['forward-intersection', { pointA: ['xA', 'yA'], pointB: ['xB', 'yB'] }],
  ['resection', { pointA: ['xA', 'yA'], pointB: ['xB', 'yB'], pointC: ['xC', 'yC'] }],
];

function mockPointsFor(tool, roles) {
  const input = VALID_INPUTS[tool];
  const byId = {};
  for (const [role, [xf, yf]] of Object.entries(roles)) {
    byId[`id-${role}`] = { _id: `id-${role}`, user: OWNER, projectId: PROJECT_ID, name: `N-${role}`, code: '', x: input[xf], y: input[yf], h: null };
  }
  SurveyPoint.findById.mockImplementation(async (id) => byId[id] || null);
  return byId;
}

beforeEach(() => {
  FieldBookProject.findById.mockResolvedValue({ _id: PROJECT_ID, user: OWNER, workspace: null, crs: 'EPSG:7801' });
});
afterEach(() => jest.clearAllMocks());

describe.each(CASES)('%s: point provenance for every picker role', (tool, roles) => {
  const body = (refs) => ({
    toolName: tool,
    inputData: VALID_INPUTS[tool],
    clientContractVersion: CURRENT_CLIENT_CONTRACT,
    projectId: PROJECT_ID,
    pointReferences: refs,
  });

  it('accepts a reference for each role and stores the server-side snapshot (pointId + role + real coordinates)', async () => {
    const points = mockPointsFor(tool, roles);
    const refs = Object.keys(roles).map((role) => ({ pointId: `id-${role}`, role, x: -1, y: -1, name: 'FORGED' }));
    const res = await post(body(refs));
    expect(res.status).toBe(201);
    const saved = Calculation.mock.calls[0][0];
    expect(saved.referencedPoints.map((r) => r.role).sort()).toEqual(Object.keys(roles).sort());
    for (const r of saved.referencedPoints) {
      const p = points[r.pointId];
      expect(r).toMatchObject({ pointId: p._id, role: r.role, name: p.name, x: p.x, y: p.y });
    }
  });

  it('a reference whose coordinates do not match the submitted inputData is rejected (provenance cannot be forged)', async () => {
    const points = mockPointsFor(tool, roles);
    const [firstRole] = Object.keys(roles);
    points[`id-${firstRole}`].x += 5; // the library point is NOT what the inputData claims
    const res = await post(body([{ pointId: `id-${firstRole}`, role: firstRole }]));
    expect(res.status).toBe(400);
    expect(Calculation).not.toHaveBeenCalled();
  });

  it('a role that belongs to another tool is refused', async () => {
    mockPointsFor(tool, roles);
    const res = await post(body([{ pointId: 'id-pointA', role: 'station' }]));
    expect(res.status).toBe(400);
  });
});
