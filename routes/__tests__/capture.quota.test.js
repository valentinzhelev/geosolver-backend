process.env.JWT_SECRET = 'test-secret-for-jest';
process.env.CAPTURE_MONTHLY_QUOTA = '2'; // configuration, not business logic: read once by the route module

jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/User');
jest.mock('../../models/FieldBookProject');
jest.mock('../../models/Workspace');
jest.mock('../../utils/ensureMvpTemplates', () => ({
  ensureMvpTemplates: jest.fn().mockResolvedValue({ created: 0, upgraded: 0, templates: [] }),
  getTemplateByToolKey: jest.fn(),
}));

const app = require('../../app');
const User = require('../../models/User');
const FieldBookProject = require('../../models/FieldBookProject');
const Workspace = require('../../models/Workspace');
const CaptureJob = require('../../models/CaptureJob');
const { setStorage } = require('../../capture/storage');
const { setProviderForTests } = require('../../capture/providers');
const { assertWithinQuota, monthStart } = require('../../capture/quota');
const { getConfig } = require('../../capture/config');
const { createMemoryStorage } = require('../../tests/support/fakeCaptureModels');
const H = require('../../tests/support/captureApiHarness');

jest.setTimeout(60000);

let capture;
beforeAll(async () => { capture = await H.makeCapture(['Point', 'X', 'Y'], [['1', '4700000', '500000'], ['2', '4700001', '500001'], ['3', '4700002', '500002'], ['4', '4700003', '500003']]); });
beforeEach(() => {
  CaptureJob.__reset();
  setStorage(createMemoryStorage());
  H.configureAccess({ User, FieldBookProject, Workspace });
  setProviderForTests('google-vision', H.fixtureProvider(capture.layout));
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { jest.restoreAllMocks(); setProviderForTests('google-vision', null); });

describe('monthly quota (configuration only)', () => {
  it('the limit comes from CAPTURE_MONTHLY_QUOTA and is unset by default', () => {
    expect(getConfig().monthlyQuota).toBe(2);
    delete process.env.CAPTURE_MONTHLY_QUOTA;
    expect(getConfig().monthlyQuota).toBeNull(); // no approved business number is hard-wired
    process.env.CAPTURE_MONTHLY_QUOTA = '2';
  });

  it('jobs that reached the OCR provider count; the third upload is refused with 429 and nothing is created', async () => {
    expect((await H.upload(app, capture.image)).status).toBe(201);
    expect((await H.upload(app, capture.image)).status).toBe(201);
    const third = await H.upload(app, capture.image);
    expect(third.status).toBe(429);
    expect(third.body).toMatchObject({ success: false, code: 'QUOTA_EXCEEDED', used: 2, limit: 2 });
    expect(CaptureJob.__all()).toHaveLength(2);
  });

  it('the quota is per user', async () => {
    await H.upload(app, capture.image);
    await H.upload(app, capture.image);
    // the other user has their own project and their own allowance
    const res = await H.upload(app, capture.image, { id: H.OTHER, projectId: H.OTHER_PROJECT });
    expect(res.status).toBe(201);
  });

  it('a job that never reached the provider (rejected image) does not consume quota', async () => {
    const r = await require('supertest')(app).post('/api/capture/jobs').set('Authorization', `Bearer ${H.token()}`).field('projectId', H.PROJECT).attach('image', Buffer.from('garbage'), 'x.png');
    expect(r.status).toBe(400);
    expect((await H.upload(app, capture.image)).status).toBe(201);
    expect((await H.upload(app, capture.image)).status).toBe(201);
  });

  it('helper: a null limit always passes; the month starts on the 1st (UTC); last month does not count', async () => {
    await expect(assertWithinQuota(H.OWNER, null)).resolves.toEqual({ used: null, limit: null });
    expect(monthStart(new Date('2026-09-20T10:00:00Z')).toISOString()).toBe('2026-09-01T00:00:00.000Z');
    await H.upload(app, capture.image);
    await H.upload(app, capture.image);
    await expect(assertWithinQuota(H.OWNER, 2)).rejects.toMatchObject({ code: 'QUOTA_EXCEEDED' });
    await expect(assertWithinQuota(H.OWNER, 2, new Date(Date.now() + 40 * 24 * 3600 * 1000))).resolves.toBeTruthy(); // next month
  });
});
