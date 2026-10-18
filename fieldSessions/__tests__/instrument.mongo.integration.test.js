/**
 * Real-MongoDB integration test for INSTRUMENT IMPORT V1 (Leica GSI). It validates what in-memory fakes cannot: the new
 * collection's indexes as MongoDB builds them, ObjectId casting of every reference, the compare-and-set upload / decision / confirm
 * writes under genuine concurrency, the rollback of a lost upload race, a confirm that fails half-way, and provenance across the
 * real models (real routes, real Mongoose models, real MongoDB).
 * Runs only when CAPTURE_TEST_MONGO_URI is set to a THROWAWAY LOCAL database (it refuses anything that is not localhost):
 *   CAPTURE_TEST_MONGO_URI=mongodb://127.0.0.1:27017/geosolver_instrument_it npx jest instrument.mongo.integration
 */
process.env.JWT_SECRET = 'test-secret-for-jest';
const mongoose = require('mongoose');

const URI = process.env.CAPTURE_TEST_MONGO_URI;
const suite = URI && /localhost|127\.0\.0\.1/.test(URI) ? describe : describe.skip;

jest.setTimeout(180000);

suite('Instrument import (Leica GSI) on a real MongoDB', () => {
  let app; let request; let jwt; let GSI;
  let FieldSession; let FieldObservationSet; let FieldProcessingRun; let SurveyPoint; let User; let FieldBookProject; let InstrumentImport;
  let tracePointProvenance;
  const OWNER = new mongoose.Types.ObjectId();
  const PROJECT = new mongoose.Types.ObjectId();
  const OID = (v) => new mongoose.Types.ObjectId(String(v));

  beforeAll(async () => {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
    await mongoose.connection.dropDatabase(); // the URI is local and throwaway by contract
    FieldSession = require('../../models/FieldSession');
    FieldObservationSet = require('../../models/FieldObservationSet');
    FieldProcessingRun = require('../../models/FieldProcessingRun');
    SurveyPoint = require('../../models/SurveyPoint');
    User = require('../../models/User');
    FieldBookProject = require('../../models/FieldBookProject');
    InstrumentImport = require('../../models/InstrumentImport');
    await Promise.all([FieldSession.init(), FieldObservationSet.init(), FieldProcessingRun.init(), SurveyPoint.init(), InstrumentImport.init()]);
    ({ tracePointProvenance } = require('../../gai/tools/provenance'));
    GSI = require('../../tests/support/gsiFixtures');
    request = require('supertest');
    jwt = require('jsonwebtoken');
    app = require('../../app');
    await User.collection.insertOne({ _id: OWNER, name: 'Owner', email: 'owner@instrument-it.test', password: 'x', plan: 'pro', subscriptionStatus: 'active', role: 'teacher' });
    await FieldBookProject.collection.insertOne({ _id: PROJECT, user: OWNER, name: 'Instrument IT', crs: 'EPSG:7801' });
  });
  afterAll(async () => { await mongoose.disconnect(); });

  const token = () => jwt.sign({ id: String(OWNER), role: 'teacher' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const call = (method, url, body) => {
    const r = request(app)[method](url).set('Authorization', `Bearer ${token()}`);
    return body === undefined ? r : r.send(body);
  };
  const sessions = (method, path, body) => call(method, `/api/field-sessions${path}`, body);
  const upload = (id, text, name = 'st.gsi') => request(app).post(`/api/field-sessions/${id}/instrument-import`).set('Authorization', `Bearer ${token()}`).attach('file', Buffer.from(text, 'utf8'), name);
  const decide = (id, decisions, baseRevision) => sessions('patch', `/${id}/instrument-import`, { decisions, baseRevision });
  const newSession = async () => (await sessions('post', '/', { projectId: String(PROJECT) })).body.data;
  const stored = (id) => FieldSession.collection.findOne({ _id: OID(id) });
  const importsOf = (id) => InstrumentImport.collection.find({ fieldSessionId: OID(id) }).toArray();
  const fosOf = (id) => FieldObservationSet.find({ 'source.fieldSessionId': OID(id) }).lean();
  const later = (ms, fn) => new Promise((resolve) => { setTimeout(() => resolve(fn()), ms); });
  const sweep = (round, step = 3) => (round % 2 ? [0, Math.floor(round / 2) * step] : [Math.floor(round / 2) * step, 0]);

  it('builds the InstrumentImport indexes (duplicate lookup, per-session lookup)', async () => {
    const idx = await InstrumentImport.collection.indexes();
    expect(idx.map((i) => i.key)).toEqual(expect.arrayContaining([{ projectId: 1, sha256: 1 }, { fieldSessionId: 1 }]));
  });

  it('persists the audit record with real ObjectId references and links the session to it', async () => {
    const s = await newSession();
    const res = await upload(s.id, GSI.A_GSI8_SINGLE, 'ST101.GSI');
    expect(res.status).toBe(201);
    const [imp] = await importsOf(s.id);
    expect(imp.user).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(imp.projectId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(imp.lineage).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(imp).toMatchObject({ vendor: 'leica', format: 'GSI-8', originalName: 'ST101.GSI', status: 'draft', parserVersion: 'leica-gsi-parser/v1' });
    expect(imp.lines).toHaveLength(3);
    const ses = await stored(s.id);
    expect(ses.source.kind).toBe('instrument');
    expect(ses.source.instrumentImportId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(String(ses.source.instrumentImportId)).toBe(String(imp._id));
    expect(ses.instrumentDecisions).toEqual({ excluded: [], orientation: {}, orphanStation: null });
  });

  it('duplicate uploads: the same content elsewhere in the project is flagged, a detached one is not', async () => {
    const a = await newSession();
    await upload(a.id, GSI.E_HORIZONTAL);
    const b = await newSession();
    expect((await upload(b.id, GSI.E_HORIZONTAL)).body.data.instrumentImport.duplicate).toBe(true);
    await sessions('delete', `/${a.id}/instrument-import`);
    expect((await importsOf(a.id))[0].status).toBe('detached');
    expect((await sessions('get', `/${b.id}`)).body.data.instrumentImport.duplicate).toBe(false);
  });

  it('upload races on one session: exactly one import survives and the session points to it (swept orders)', async () => {
    for (let round = 0; round < 8; round += 1) {
      const s = await newSession();
      const [d1, d2] = sweep(round);
      // eslint-disable-next-line no-await-in-loop
      const rs = await Promise.all([later(d1, () => upload(s.id, GSI.A_GSI8_SINGLE)), later(d2, () => upload(s.id, GSI.C_MULTI_STATION))]);
      expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
      // eslint-disable-next-line no-await-in-loop
      const [imps, ses] = await Promise.all([importsOf(s.id), stored(s.id)]);
      expect(imps).toHaveLength(1);
      expect(String(ses.source.instrumentImportId)).toBe(String(imps[0]._id));
    }
  });

  it('confirm races: concurrent confirms create exactly ONE evidence set (swept orders)', async () => {
    for (let round = 0; round < 6; round += 1) {
      const s = await newSession();
      await upload(s.id, GSI.A_GSI8_SINGLE);
      const [d1, d2] = sweep(round);
      // eslint-disable-next-line no-await-in-loop
      const rs = await Promise.all([later(d1, () => sessions('post', `/${s.id}/confirm`)), later(d2, () => sessions('post', `/${s.id}/confirm`))]);
      expect(rs.every((r) => r.status === 200 || r.body.code === 'CONFIRM_IN_PROGRESS')).toBe(true);
      // eslint-disable-next-line no-await-in-loop
      expect(await fosOf(s.id)).toHaveLength(1);
    }
  });

  it('a decision racing a confirm never changes what was confirmed: the evidence matches the decisions stored at the claim', async () => {
    for (let round = 0; round < 6; round += 1) {
      const s = await newSession();
      const v = (await upload(s.id, GSI.A_GSI8_SINGLE)).body.data;
      const [d1, d2] = sweep(round);
      // eslint-disable-next-line no-await-in-loop
      const [c, d] = await Promise.all([later(d1, () => sessions('post', `/${s.id}/confirm`)), later(d2, () => decide(s.id, { orientation: { s1: 2 } }, v.revision))]);
      // eslint-disable-next-line no-await-in-loop
      const [fos] = await fosOf(s.id);
      expect(c.status).toBe(200);
      const decisionWon = d.status === 200;
      // either the decision landed BEFORE the claim (orientation 102 in the evidence) or it was refused (none) - never in between
      expect(fos.setups[0].orientation ? fos.setups[0].orientation.target : null).toBe(decisionWon ? '102' : null);
      if (!decisionWon) expect(['SESSION_CONFIRMED', 'REVISION_CONFLICT']).toContain(d.body.code);
      // eslint-disable-next-line no-await-in-loop
      const [imp] = await importsOf(s.id);
      expect(imp.status).toBe('confirmed');
      expect(imp.confirmed.decisions.orientation).toEqual(decisionWon ? { s1: 2 } : {});
    }
  });

  it('a confirm that fails while writing the evidence releases its claim; nothing half-confirmed remains; a retry succeeds', async () => {
    const s = await newSession();
    await upload(s.id, GSI.A_GSI8_SINGLE);
    const spy = jest.spyOn(FieldObservationSet, 'create').mockRejectedValueOnce(new Error('simulated write failure'));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await sessions('post', `/${s.id}/confirm`);
    expect([res.status, res.body.code]).toEqual([500, 'CONFIRM_FAILED']);
    expect(JSON.stringify(res.body)).not.toContain('simulated');
    const ses = await stored(s.id);
    expect(ses.confirmClaimedAt).toBeNull();
    expect(ses.status).toBe('draft');
    expect((await importsOf(s.id))[0].status).toBe('draft');
    expect(await fosOf(s.id)).toHaveLength(0);
    spy.mockRestore();
    expect((await sessions('post', `/${s.id}/confirm`)).status).toBe(200);
    expect(await fosOf(s.id)).toHaveLength(1);
    console.error.mockRestore();
  });

  it('confirmed import -> polar processing -> points -> provenance across the real models', async () => {
    await SurveyPoint.create({ user: OWNER, projectId: PROJECT, name: '101', x: 1000, y: 2000, h: 500 });
    await SurveyPoint.create({ user: OWNER, projectId: PROJECT, name: '102', x: 1000, y: 2100, h: 500 });
    const W = GSI.gsi16;
    const file = [
      GSI.line('GSI-16', [W.point('101', 1), W.metres('88', 1.5, 1)]),
      GSI.line('GSI-16', [W.point('102', 2), W.gon('21', 0), W.gon('22', 100), W.metres('31', 100)]),
      GSI.line('GSI-16', [W.point('201', 3), W.gon('21', 0), W.gon('22', 100), W.metres('31', 50), W.metres('87', 1.5, 1)]),
    ].join('\r\n');
    const s = await newSession();
    const v = (await upload(s.id, file, 'IT.GSI')).body.data;
    await decide(s.id, { orientation: { s1: 2 } }, v.revision);
    const confirmed = (await sessions('post', `/${s.id}/confirm`)).body.data;
    const run = (await call('post', '/api/field-processing', { fieldObservationSetId: confirmed.observationSetId, verticalAngleConvention: 'zenith' })).body.data;
    const o = run.setups[0].observations[0];
    expect(o.x).toBeCloseTo(1000, 9);
    expect(o.y).toBeCloseTo(2050, 9);
    expect(o.h).toBeCloseTo(500, 9);
    expect((await call('post', `/api/field-processing/${run.id}/create-points`)).status).toBe(200);
    const p201 = await SurveyPoint.findOne({ projectId: PROJECT, name: '201' }).lean();
    const prov = await tracePointProvenance(String(PROJECT), String(p201._id));
    expect(prov.chain.map((x) => x.kind)).toEqual(['point', 'processingRun', 'fieldObservationSet', 'fieldSession', 'instrumentImport']);
    expect(prov.chain[4]).toMatchObject({ label: 'Импорт от Leica GSI-16', fileName: 'IT.GSI', observationCount: 1 });
    const fos = await FieldObservationSet.findById(confirmed.observationSetId).lean();
    expect(fos.instrumentImport.importId).toBeInstanceOf(mongoose.Types.ObjectId);
    expect(fos.setups[0].observations[0].source).toEqual({ kind: 'instrument', record: 3, line: 3 });
  });

  it('a revision copies the import under the same lineage; the original stays confirmed and untouched', async () => {
    const s = await newSession();
    const v = (await upload(s.id, GSI.B_GSI16_SINGLE)).body.data;
    await decide(s.id, { orientation: { s1: 2 } }, v.revision);
    await sessions('post', `/${s.id}/confirm`);
    const before = (await importsOf(s.id))[0];
    const r = (await sessions('post', `/${s.id}/revise`)).body.data;
    const [copy] = await importsOf(r.id);
    expect(String(copy.derivedFrom)).toBe(String(before._id));
    expect(String(copy.lineage)).toBe(String(before.lineage));
    expect(r.instrumentImport.duplicate).toBe(false);
    expect((await importsOf(s.id))[0]).toEqual(before);
  });
});
