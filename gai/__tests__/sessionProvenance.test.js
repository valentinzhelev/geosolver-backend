/**
 * Field Sessions in GAI provenance: a point created from a session explains itself in product language
 * ("Теренна сесия"), for both manual sessions and OCR-notebook sessions, without any new GAI capability (still a
 * read-only lookup) and without leaking ids or internal names.
 */
jest.mock('../../models/SurveyPoint', () => require('../../tests/support/fakeCaptureModels').SurveyPoint);
jest.mock('../../models/CaptureJob', () => require('../../tests/support/fakeCaptureModels').CaptureJob);
jest.mock('../../models/FieldObservationSet', () => require('../../tests/support/fakeCaptureModels').FieldObservationSet);
jest.mock('../../models/FieldProcessingRun', () => require('../../tests/support/fakeCaptureModels').FieldProcessingRun);
jest.mock('../../models/Report', () => require('../../tests/support/fakeCaptureModels').Report);
jest.mock('../../models/Calculation', () => require('../../tests/support/fakeCaptureModels').Calculation);
jest.mock('../../models/FieldBook', () => require('../../tests/support/fakeCaptureModels').FieldBook);
jest.mock('../../models/FieldSession', () => require('../../tests/support/fakeCaptureModels').FieldSession);
jest.mock('../../models/FieldBookProject');

const FieldBookProject = require('../../models/FieldBookProject');
const F = require('../../tests/support/fakeCaptureModels');
const fx = require('../../tests/support/gaiFixtures');
const { buildContext, formatContextForPrompt } = require('../context/buildContext');
const { tracePointProvenance } = require('../tools/provenance');
const { FORBIDDEN_PROVIDER_TERMS } = require('../terminology');

const PROJECT = F.newId();
const USER = F.newId();
const OBJECT_ID = /\b[0-9a-f]{24}\b/i;

beforeEach(() => {
  fx.resetAll();
  FieldBookProject.findById.mockImplementation(async (id) => (String(id) === PROJECT ? { _id: PROJECT, name: 'Обект', crs: 'EPSG:7801' } : null));
});

const leak = (text) => FORBIDDEN_PROVIDER_TERMS.filter((t) => new RegExp(`(^|[^A-Za-z_])${t.replace(/[-]/g, '\\-')}([^A-Za-z_]|$)`).test(text));

async function manualSessionPoint() {
  const session = await F.FieldSession.create({ user: USER, projectId: PROJECT, date: '2026-10-09', source: { kind: 'manual' }, status: 'confirmed' });
  const fos = await F.FieldObservationSet.create({
    user: USER, projectId: PROJECT, source: { kind: 'session', fieldSessionId: session._id }, confirmedAt: new Date('2026-10-09T09:00:00Z'),
    setups: [{ index: 0, station: { point: '101', instrumentHeight: { value: 1.5, unit: 'm' }, notes: '' }, orientation: { target: '102', direction: { value: 0, unit: 'gon' } },
      observations: [{ row: 0, target: '301', hz: { value: 10, unit: 'gon' }, vz: null, distance: { value: 40, unit: 'm' }, horizontalDistance: null, prismHeight: null, code: '', notes: '', cells: {} }] }],
  });
  const run = await F.FieldProcessingRun.create({
    user: USER, projectId: PROJECT, source: { fieldObservationSetId: fos._id, fieldSessionId: session._id }, processingVersion: 'v', engineVersions: {}, processingType: 'polar',
    setups: [{ index: 0, station: { identifier: '101', point: { x: 1000, y: 2000, h: 500 } }, orientation: { identifier: '102' }, orientationConstantGon: 100, setupError: null,
      observations: [{ index: 0, target: '301', status: 'XY_ONLY', x: 1000, y: 2040, h: null, direction: 110, horizontalDistance: 40, heightReason: 'PRISM_HEIGHT_MISSING', errors: [], warnings: [] }] }],
  });
  const point = await F.SurveyPoint.create({ user: USER, projectId: PROJECT, name: '301', x: 1000, y: 2040, h: null, source: { kind: 'field-processing', processingType: 'polar', processingRunId: run._id, fieldObservationSetId: fos._id, setup: 0, observation: 0 } });
  return { session, fos, run, point };
}

describe('a point created from a MANUAL Field Session', () => {
  it('resolves point -> processing -> confirmed observations -> Теренна сесия (and there is no capture step)', async () => {
    const { point, session } = await manualSessionPoint();
    const prov = await tracePointProvenance(PROJECT, point._id);
    expect(prov.chain.map((s) => s.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'fieldSession']);
    expect(prov.chain[3]).toMatchObject({ id: String(session._id), label: 'Теренна сесия · 09.10.2026' });
    expect(prov.fieldMeasurement).toMatchObject({ station: '101', target: '301' });
  });

  it('the provider sees the session as a plain step, with the persisted reason, and no ids or internal names', async () => {
    await manualSessionPoint();
    const ctx = await buildContext({ projectId: PROJECT, userId: USER, question: 'Как е получена точка 301?' });
    const sem = JSON.parse(formatContextForPrompt(ctx));
    const p = sem['Запитани точки'][0];
    expect(p['Произход'].map((s) => s['Стъпка'])).toEqual(['Създадена от обработка', 'Входни данни на обработката', 'Теренна сесия']);
    expect(p['Произход'][2]['Източник']).toBe('Теренна сесия · 09.10.2026');
    expect(p['Изходен резултат от обработката']['Причина за липса на кота']).toBe('Липсва височина на призмата.');
    const rendered = formatContextForPrompt(ctx);
    expect(OBJECT_ID.test(rendered)).toBe(false);
    expect(leak(rendered)).toEqual([]);
    expect(ctx.evidence.map((e) => e.kind)).toEqual(['project', 'surveyPoint', 'processingRun', 'fieldObservationSet', 'fieldSession']);
    expect(ctx.evidence.at(-1).label).toBe('Теренна сесия · 09.10.2026');
  });

  it('a session from ANOTHER project is never followed', async () => {
    const { point, session } = await manualSessionPoint();
    F.FieldSession.__mutate(session._id, (r) => { r.projectId = F.newId(); });
    const prov = await tracePointProvenance(PROJECT, point._id);
    expect(prov.chain.map((s) => s.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet']);
  });
});

describe('an OCR-notebook point whose capture sits inside a Field Session', () => {
  it('the session appears between the confirmed observations and the capture', async () => {
    const { polarRun } = await fx.seedRichProject({ projectId: PROJECT, userId: USER });
    const p201 = F.SurveyPoint.__all().find((p) => p.name === '201');
    await F.FieldSession.create({ user: USER, projectId: PROJECT, date: '2026-09-22', source: { kind: 'capture', captureJobId: String(polarRun.source.captureJobId) } });
    const prov = await tracePointProvenance(PROJECT, p201._id);
    expect(prov.chain.map((s) => s.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'fieldSession', 'captureJob']);
    expect(prov.chain[3].label).toBe('Теренна сесия · 22.09.2026');
  });

  it('without a session the chain is exactly what it was before Field Sessions existed', async () => {
    await fx.seedRichProject({ projectId: PROJECT, userId: USER });
    const p201 = F.SurveyPoint.__all().find((p) => p.name === '201');
    const prov = await tracePointProvenance(PROJECT, p201._id);
    expect(prov.chain.map((s) => s.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'captureJob']);
  });
});
