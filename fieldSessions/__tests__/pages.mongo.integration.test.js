/**
 * Real-MongoDB integration test for MULTI-PAGE Field Sessions. It validates what in-memory fakes cannot: the unique partial
 * MULTIKEY index that makes "a capture is a page of at most one session" a database guarantee, and the compare-and-set page
 * operations / claims under genuine concurrency (real routes, real Mongoose models, real MongoDB).
 * Runs only when CAPTURE_TEST_MONGO_URI is set to a THROWAWAY LOCAL database (it refuses anything that is not localhost):
 *   CAPTURE_TEST_MONGO_URI=mongodb://127.0.0.1:27017/geosolver_pages_it npx jest pages.mongo.integration
 */
process.env.JWT_SECRET = 'test-secret-for-jest';
const mongoose = require('mongoose');

const URI = process.env.CAPTURE_TEST_MONGO_URI;
const suite = URI && /localhost|127\.0\.0\.1/.test(URI) ? describe : describe.skip;

jest.setTimeout(180000);

suite('Multi-page Field Sessions on a real MongoDB', () => {
  let app; let request; let jwt;
  let FieldSession; let CaptureJob; let FieldObservationSet; let FieldProcessingRun; let SurveyPoint; let User; let FieldBookProject;
  let P; let migration;
  const OWNER = new mongoose.Types.ObjectId();
  const PROJECT = new mongoose.Types.ObjectId();
  const sid = (v) => String(v);

  beforeAll(async () => {
    await mongoose.connect(URI, { serverSelectionTimeoutMS: 8000 });
    await mongoose.connection.dropDatabase(); // the URI is local and throwaway by contract
    FieldSession = require('../../models/FieldSession');
    CaptureJob = require('../../models/CaptureJob');
    FieldObservationSet = require('../../models/FieldObservationSet');
    FieldProcessingRun = require('../../models/FieldProcessingRun');
    SurveyPoint = require('../../models/SurveyPoint');
    User = require('../../models/User');
    FieldBookProject = require('../../models/FieldBookProject');
    await Promise.all([FieldSession.init(), CaptureJob.init(), FieldObservationSet.init(), FieldProcessingRun.init(), SurveyPoint.init()]);
    P = require('../../tests/support/pageFixtures');
    migration = require('../../scripts/migrate-field-session-pages');
    request = require('supertest');
    jwt = require('jsonwebtoken');
    app = require('../../app');
    await User.collection.insertOne({ _id: OWNER, name: 'Owner', email: 'owner@pages-it.test', password: 'x', plan: 'pro', subscriptionStatus: 'active', role: 'teacher' });
    await FieldBookProject.collection.insertOne({ _id: PROJECT, user: OWNER, name: 'Pages IT', crs: 'EPSG:7801' });
  });
  afterAll(async () => { await mongoose.disconnect(); });

  const token = () => jwt.sign({ id: String(OWNER), role: 'teacher' }, process.env.JWT_SECRET, { expiresIn: '10m' });
  const call = (method, url, body) => {
    const r = request(app)[method](url).set('Authorization', `Bearer ${token()}`);
    return body === undefined ? r : r.send(body);
  };
  const sessions = (method, path, body) => call(method, `/api/field-sessions${path}`, body);
  const makeJob = (setups, opts = {}) => CaptureJob.create(P.pageJobFields(setups, { user: OWNER, project: PROJECT, ...opts }));
  const pageSetups = (n) => [P.station(`S${n}`, [P.obs(`${n}01`), P.obs(`${n}02`, '20.0000g')])];
  const makePages = async (count, base = 1) => { const jobs = []; for (let i = 0; i < count; i += 1) jobs.push(await makeJob(pageSetups(base + i))); return jobs; };
  const newSession = async () => (await sessions('post', '/', { projectId: String(PROJECT) })).body.data;
  const attach = (id, job, extra = {}) => sessions('post', `/${id}/pages`, { captureJobId: sid(job._id), ...extra });
  const sessionWith = async (jobs) => { const s = await newSession(); for (const j of jobs) await attach(s.id, j); return s; };
  const stored = (id) => FieldSession.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
  const codes = (rs) => rs.map((r) => r.status).sort().join(',');
  // Races are swept, not hoped for: round r starts one request at once and the other r*step ms later, alternating which one is
  // late, so both orders (and the interleavings between) really happen instead of the same request always winning.
  const later = (ms, fn) => new Promise((resolve) => { setTimeout(() => resolve(fn()), ms); });
  const sweep = (round, step = 3) => (round % 2 ? [0, Math.floor(round / 2) * step] : [Math.floor(round / 2) * step, 0]);
  const fosOf = (sessionId) => FieldObservationSet.find({ 'source.fieldSessionId': new mongoose.Types.ObjectId(sessionId) }).lean();

  describe('the indexes MongoDB actually built', () => {
    it('has the unique PARTIAL multikey index on sources.captureJobId beside the legacy one', async () => {
      const idx = await FieldSession.collection.indexes();
      expect(idx.find((i) => i.name === 'sources_captureJobId_unique_partial')).toMatchObject({ unique: true, key: { 'sources.captureJobId': 1 }, partialFilterExpression: { 'sources.captureJobId': { $type: 'objectId' } } });
      expect(idx.find((i) => i.name === 'source_captureJobId_unique_partial')).toMatchObject({ unique: true });
    });

    it('a capture can be in the sources of only ONE session (E11000 across documents)', async () => {
      const [job] = await makePages(1);
      const col = FieldSession.collection;
      const base = { user: OWNER, projectId: PROJECT, status: 'draft', source: { kind: 'capture' }, createdAt: new Date(), updatedAt: new Date() };
      const one = await col.insertOne({ ...base, sources: [{ kind: 'capture', captureJobId: job._id, order: 0 }] });
      await expect(col.insertOne({ ...base, sources: [{ kind: 'capture', captureJobId: job._id, order: 0 }] })).rejects.toMatchObject({ code: 11000 });
      await col.deleteOne({ _id: one.insertedId });
    });

    it('manual sessions and sessions with no pages do not collide with each other (partial index: no shared null)', async () => {
      const col = FieldSession.collection;
      const base = { user: OWNER, projectId: PROJECT, status: 'draft', createdAt: new Date(), updatedAt: new Date() };
      const ids = [];
      for (let i = 0; i < 4; i += 1) ids.push((await col.insertOne({ ...base, source: { kind: 'manual' }, setups: [] })).insertedId);
      for (let i = 0; i < 3; i += 1) ids.push((await col.insertOne({ ...base, source: { kind: null }, sources: [] })).insertedId);
      await col.deleteMany({ _id: { $in: ids } });
    });

    it('a unique index does NOT stop the same capture twice inside ONE document - which is why the page operations check it themselves', async () => {
      const [job] = await makePages(1);
      const col = FieldSession.collection;
      const doc = await col.insertOne({ user: OWNER, projectId: PROJECT, status: 'draft', source: { kind: 'capture' }, sources: [{ kind: 'capture', captureJobId: job._id, order: 0 }, { kind: 'capture', captureJobId: job._id, order: 1 }], createdAt: new Date(), updatedAt: new Date() });
      expect(doc.acknowledged).toBe(true); // documented MongoDB behaviour
      await col.deleteOne({ _id: doc.insertedId });
      const s = await sessionWith([job]);
      expect((await attach(s.id, job)).body.code).toBe('PAGE_DUPLICATE'); // the application's own guard
      expect((await stored(s.id)).sources).toHaveLength(1);
    });
  });

  describe('ownership races', () => {
    it('the SAME capture attached to 8 sessions at once: exactly one wins, the rest are a clean CAPTURE_ALREADY_ATTACHED', async () => {
      const [job] = await makePages(1);
      const targets = [];
      for (let i = 0; i < 8; i += 1) targets.push(await newSession());
      const results = await Promise.all(targets.map((s) => attach(s.id, job)));
      expect(codes(results)).toBe('201,409,409,409,409,409,409,409');
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'CAPTURE_ALREADY_ATTACHED')).toBe(true);
      expect(await FieldSession.collection.countDocuments({ 'sources.captureJobId': job._id })).toBe(1);
    });

    it('creating sessions with the same capture at once: one session, the rest refused', async () => {
      const [job] = await makePages(1);
      const results = await Promise.all(Array.from({ length: 8 }, () => sessions('post', '/', { projectId: String(PROJECT), captureJobId: sid(job._id) })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'CAPTURE_ALREADY_ATTACHED')).toBe(true);
      expect(await FieldSession.collection.countDocuments({ 'sources.captureJobId': job._id })).toBe(1);
    });

    it('different captures attached to ONE session at once: every success is really there, order dense, nothing duplicated', async () => {
      const jobs = await makePages(6);
      const s = await newSession();
      const results = await Promise.all(jobs.map((j) => attach(s.id, j)));
      expect(results.every((r) => [201, 409].includes(r.status))).toBe(true);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'REVISION_CONFLICT')).toBe(true);
      const row = await stored(s.id);
      const wins = results.filter((r) => r.status === 201).length;
      expect(wins).toBeGreaterThanOrEqual(1);
      expect(row.sources).toHaveLength(wins); // no lost update: exactly the attaches that reported success
      expect(row.sources.map((p) => p.order)).toEqual(row.sources.map((_, i) => i));
      expect(new Set(row.sources.map((p) => String(p.captureJobId))).size).toBe(wins);
      expect(String(row.source.captureJobId)).toBe(String(row.sources[0].captureJobId)); // the legacy mirror
    });

    it('a capture detached from one session is immediately free for another', async () => {
      const [job] = await makePages(1);
      const a = await sessionWith([job]);
      const b = await newSession();
      expect((await attach(b.id, job)).body.code).toBe('CAPTURE_ALREADY_ATTACHED');
      await sessions('delete', `/${a.id}/pages/${job._id}`);
      expect((await attach(b.id, job)).status).toBe(201);
    });
  });

  describe('reorder races', () => {
    it('concurrent reorders: the result is exactly one of the requested orders, dense, with the same set of pages', async () => {
      const jobs = await makePages(4);
      const s = await sessionWith(jobs);
      const ids = jobs.map((j) => sid(j._id));
      const perms = [[3, 2, 1, 0], [1, 0, 3, 2], [2, 3, 0, 1], [0, 2, 1, 3], [3, 0, 2, 1], [1, 2, 3, 0]].map((p) => p.map((i) => ids[i]));
      const results = await Promise.all(perms.map((p) => sessions('patch', `/${s.id}/pages/reorder`, { pageIds: p })));
      expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
      const row = await stored(s.id);
      const finalOrder = [...row.sources].sort((a, b) => a.order - b.order).map((p) => String(p.captureJobId));
      expect(row.sources.map((p) => p.order).sort()).toEqual([0, 1, 2, 3]);
      expect([...finalOrder].sort()).toEqual([...ids].sort());
      const winners = results.map((r, i) => (r.status === 200 ? perms[i] : null)).filter(Boolean);
      expect(winners.some((p) => JSON.stringify(p) === JSON.stringify(finalOrder))).toBe(true);
    });

    it('reordering never touches a capture: the capture documents are byte-identical afterwards', async () => {
      const jobs = await makePages(3);
      const s = await sessionWith(jobs);
      const before = JSON.stringify(await CaptureJob.find({ _id: { $in: jobs.map((j) => j._id) } }).sort({ _id: 1 }).lean());
      await sessions('patch', `/${s.id}/pages/reorder`, { pageIds: jobs.map((j) => sid(j._id)).reverse() });
      expect(JSON.stringify(await CaptureJob.find({ _id: { $in: jobs.map((j) => j._id) } }).sort({ _id: 1 }).lean())).toBe(before);
    });
  });

  describe('confirm races', () => {
    it('12 concurrent confirms of a three-page session: exactly ONE evidence set (the real unique index), every page frozen', async () => {
      const jobs = await makePages(3);
      const s = await sessionWith(jobs);
      const burst = await Promise.all(Array.from({ length: 12 }, () => sessions('post', `/${s.id}/confirm`)));
      expect(burst.some((r) => r.status >= 500)).toBe(false);
      const ok = burst.filter((r) => r.status === 200);
      expect(ok.length).toBeGreaterThanOrEqual(1);
      expect(new Set(ok.map((r) => r.body.data.observationSetId)).size).toBe(1);
      expect(await fosOf(s.id)).toHaveLength(1);
      expect(burst.filter((r) => r.status === 200 && r.body.alreadyConfirmed === false)).toHaveLength(1);
      const frozen = await CaptureJob.find({ _id: { $in: jobs.map((j) => j._id) } }).lean();
      expect(frozen.every((j) => j.status === 'confirmed' && String(j.importedFieldObservationSetId) === ok[0].body.data.observationSetId)).toBe(true);
    });

    it('confirm vs DETACH, 40 swept rounds: the evidence always matches the pages the session finally has (never a detached page, never a missing one)', async () => {
      const tally = {};
      for (let round = 0; round < 40; round += 1) {
        const jobs = await makePages(3, 10 + round * 3);
        const s = await sessionWith(jobs);
        const [d1, d2] = sweep(round);
        const [det, conf] = await Promise.all([later(d1, () => sessions('delete', `/${s.id}/pages/${jobs[1]._id}`)), later(d2, () => sessions('post', `/${s.id}/confirm`))]);
        const row = await stored(s.id);
        const sets = await fosOf(s.id);
        const key = `detach ${det.status}${det.body.code ? `/${det.body.code}` : ''} | confirm ${conf.status}${conf.body.code ? `/${conf.body.code}` : ''}`;
        tally[key] = (tally[key] || 0) + 1;
        expect([200, 409]).toContain(det.status);
        if (row.status === 'confirmed') {
          expect(sets).toHaveLength(1);
          expect(sets[0].pages.map((p) => String(p.captureJobId)).sort()).toEqual(row.sources.map((p) => String(p.captureJobId)).sort());
          if (det.status === 200) expect(row.sources).toHaveLength(2); else expect(row.sources).toHaveLength(3);
        } else {
          expect(sets).toHaveLength(0);
          expect(det.status).toBe(200); // the confirm lost nothing but also created nothing
        }
        // a detached capture is untouched and free
        if (det.status === 200) {
          const free = await CaptureJob.findById(jobs[1]._id).lean();
          expect(free.status).toBe('needs_review');
        }
      }
      // eslint-disable-next-line no-console
      console.log('confirm vs detach outcomes:', JSON.stringify(tally));
      expect(Object.keys(tally).length).toBeGreaterThan(1); // both orders really happened
    });

    it('confirm vs ATTACH, 40 swept rounds: the evidence contains exactly the pages the session finally has', async () => {
      const tally = {};
      for (let round = 0; round < 40; round += 1) {
        const jobs = await makePages(2, 100 + round * 3);
        const extra = await makeJob(pageSetups(500 + round));
        const s = await sessionWith(jobs);
        const [d1, d2] = sweep(round);
        const [att, conf] = await Promise.all([later(d1, () => attach(s.id, extra)), later(d2, () => sessions('post', `/${s.id}/confirm`))]);
        tally[`attach ${att.status} | confirm ${conf.status}`] = (tally[`attach ${att.status} | confirm ${conf.status}`] || 0) + 1;
        const row = await stored(s.id);
        const sets = await fosOf(s.id);
        if (row.status === 'confirmed') {
          expect(sets).toHaveLength(1);
          expect(sets[0].pages.map((p) => String(p.captureJobId)).sort()).toEqual(row.sources.map((p) => String(p.captureJobId)).sort());
          if (att.status === 201) expect(row.sources).toHaveLength(3); else expect(row.sources).toHaveLength(2);
        } else {
          expect(sets).toHaveLength(0);
        }
        expect([201, 409]).toContain(att.status);
        expect(conf.status).toBeLessThan(500);
      }
      // eslint-disable-next-line no-console
      console.log('confirm vs attach outcomes:', JSON.stringify(tally));
      expect(Object.keys(tally).length).toBeGreaterThan(1);
    });

    it('a FRESH claim (a confirm in flight) refuses another confirm; a STALE one (a crashed confirm) never locks the session forever', async () => {
      const jobs = await makePages(2, 600);
      const s = await sessionWith(jobs);
      const oid = new mongoose.Types.ObjectId(s.id);
      await FieldSession.collection.updateOne({ _id: oid }, { $set: { confirmClaimedAt: new Date() } });
      const fresh = await sessions('post', `/${s.id}/confirm`);
      expect(fresh.status).toBe(409);
      expect(fresh.body.code).toBe('CONFIRM_IN_PROGRESS');
      expect(await fosOf(s.id)).toHaveLength(0);
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await FieldSession.collection.updateOne({ _id: oid }, { $set: { confirmClaimedAt: old } });
      await CaptureJob.collection.updateMany({ _id: { $in: jobs.map((j) => j._id) } }, { $set: { confirmClaimedAt: old } });
      const recovered = await sessions('post', `/${s.id}/confirm`);
      expect(recovered.status).toBe(200);
      expect(await fosOf(s.id)).toHaveLength(1);
    });

    it('a confirm interrupted AFTER the evidence was created is completed by a retry - never a second set', async () => {
      const jobs = await makePages(2, 610);
      const s = await sessionWith(jobs);
      const first = await sessions('post', `/${s.id}/confirm`);
      expect(first.status).toBe(200);
      // simulate the crash: the set exists, but the session never became confirmed and its pages were never frozen
      const setId = first.body.data.observationSetId;
      const old = new Date(Date.now() - 10 * 60 * 1000);
      await FieldSession.collection.updateOne({ _id: new mongoose.Types.ObjectId(s.id) }, { $set: { status: 'review', confirmClaimedAt: old }, $unset: { fieldObservationSetId: '', confirmedAt: '' } });
      await CaptureJob.collection.updateMany({ _id: { $in: jobs.map((j) => j._id) } }, { $set: { status: 'needs_review' }, $unset: { importedFieldObservationSetId: '' } });
      const retry = await sessions('post', `/${s.id}/confirm`);
      expect(retry.status).toBe(200);
      expect(retry.body.data.observationSetId).toBe(setId);
      expect(await fosOf(s.id)).toHaveLength(1);
      for (const j of await CaptureJob.find({ _id: { $in: jobs.map((j) => j._id) } }).lean()) expect(j).toMatchObject({ status: 'confirmed', importedFieldObservationSetId: expect.anything() });
    });

    it('a blocking issue leaves NO claim behind - on the session or on any page - and the session stays editable', async () => {
      const jobs = [await makeJob([P.station('101', [P.obs('201'), P.obs('202', '20.0000g')])]), await makeJob([P.continuation([P.obs('202', '20.0000g')])])];
      const s = await sessionWith(jobs);
      const res = await sessions('post', `/${s.id}/confirm`);
      expect(res.status).toBe(422);
      expect(res.body.errors.map((e) => e.code)).toContain('DUPLICATE_OBSERVATION_ACROSS_PAGES');
      expect((await stored(s.id)).confirmClaimedAt).toBeNull();
      for (const j of await CaptureJob.find({ _id: { $in: jobs.map((j) => j._id) } }).lean()) expect(j).toMatchObject({ status: 'needs_review', confirmClaimedAt: null });
      expect((await sessions('delete', `/${s.id}/pages/${jobs[1]._id}`)).status).toBe(200);
      expect((await sessions('post', `/${s.id}/confirm`)).status).toBe(200);
    });
  });

  describe('the capture flow vs the session (never two pieces of evidence)', () => {
    const captureConfirm = (job) => call('post', `/api/capture/jobs/${job._id}/confirm`, {});

    it('SINGLE-page session, capture-confirm vs session-confirm, 40 swept rounds: exactly ONE evidence set in total', async () => {
      const tally = {};
      for (let round = 0; round < 40; round += 1) {
        const [job] = await makePages(1, 200 + round);
        const s = await sessionWith([job]);
        const [d1, d2] = sweep(round);
        const [cap, ses] = await Promise.all([later(d1, () => captureConfirm(job)), later(d2, () => sessions('post', `/${s.id}/confirm`))]);
        const bySession = await fosOf(s.id);
        const byCapture = await FieldObservationSet.find({ 'source.captureJobId': job._id }).lean();
        tally[`capture ${cap.status} | session ${ses.status}`] = (tally[`capture ${cap.status} | session ${ses.status}`] || 0) + 1;
        expect(bySession.length + byCapture.length).toBe(1);
        const reread = (await sessions('get', `/${s.id}`)).body.data;
        expect(reread.confirmed).toBe(true);
        expect(cap.status).toBeLessThan(500);
        expect(ses.status).toBeLessThan(500);
      }
      // eslint-disable-next-line no-console
      console.log('capture-confirm vs session-confirm outcomes:', JSON.stringify(tally));
      expect(Object.keys(tally).length).toBeGreaterThan(1);
    });

    it('capture-confirm vs ATTACH of a second page, 40 swept rounds: never two pages AND a capture-origin set', async () => {
      const tally = {};
      for (let round = 0; round < 40; round += 1) {
        const [job] = await makePages(1, 300 + round);
        const second = await makeJob(pageSetups(700 + round));
        const s = await sessionWith([job]);
        const [d1, d2] = sweep(round);
        const [cap, att] = await Promise.all([later(d1, () => captureConfirm(job)), later(d2, () => attach(s.id, second))]);
        tally[`capture ${cap.status} | attach ${att.status}`] = (tally[`capture ${cap.status} | attach ${att.status}`] || 0) + 1;
        const row = await stored(s.id);
        const byCapture = await FieldObservationSet.find({ 'source.captureJobId': job._id }).lean();
        const pages = (row.sources || []).length;
        expect(!(pages >= 2 && byCapture.length > 0)).toBe(true);
        expect(cap.status).toBeLessThan(500);
        expect([201, 409]).toContain(att.status);
      }
      // eslint-disable-next-line no-console
      console.log('capture-confirm vs attach outcomes:', JSON.stringify(tally));
      expect(Object.keys(tally).length).toBeGreaterThan(1);
    });

    it('a page of a TWO-page session cannot be confirmed through the capture route (BELONGS_TO_SESSION) and nothing is created', async () => {
      const jobs = await makePages(2);
      const s = await sessionWith(jobs);
      const res = await captureConfirm(jobs[0]);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BELONGS_TO_SESSION');
      expect(await FieldObservationSet.countDocuments({ 'source.captureJobId': jobs[0]._id })).toBe(0);
      expect((await CaptureJob.findById(jobs[0]._id).lean()).confirmClaimedAt).toBeNull();
      expect((await stored(s.id)).status).toBe('draft');
    });
  });

  describe('legacy single-capture records (the live schema) and the additive migration', () => {
    const legacyDoc = (job, over = {}) => ({ user: OWNER, projectId: PROJECT, status: 'draft', source: { kind: 'capture', captureJobId: job._id }, setups: [], revision: 0, createdAt: new Date(), updatedAt: new Date(), ...over });

    it('opens, takes a second page (upgrading the structure), and confirms - through the real routes', async () => {
      const [j1, j2] = await makePages(2, 400);
      const ins = await FieldSession.collection.insertOne(legacyDoc(j1));
      const id = sid(ins.insertedId);
      const opened = (await sessions('get', `/${id}`)).body.data;
      expect(opened).toMatchObject({ source: 'capture', pageCount: 1, setupCount: 1, observationCount: 2 });
      expect((await stored(id)).sources).toBeUndefined();
      expect((await attach(id, j2)).status).toBe(201);
      const row = await stored(id);
      expect(row.sources.map((p) => String(p.captureJobId))).toEqual([sid(j1._id), sid(j2._id)]);
      expect(String(row.source.captureJobId)).toBe(sid(j1._id));
      const conf = await sessions('post', `/${id}/confirm`);
      expect(conf.status).toBe(200);
      expect(await fosOf(id)).toHaveLength(1);
    });

    it('a legacy draft confirms through the session exactly like a new one (one set, page frozen)', async () => {
      const [j1] = await makePages(1, 410);
      const id = sid((await FieldSession.collection.insertOne(legacyDoc(j1))).insertedId);
      expect((await sessions('post', `/${id}/confirm`)).status).toBe(200);
      expect(await fosOf(id)).toHaveLength(1);
      expect((await CaptureJob.findById(j1._id).lean()).status).toBe('confirmed');
    });

    it('BEFORE the backfill the two structures do not see each other at the database level - the application guard covers it', async () => {
      const [job] = await makePages(1, 420);
      await FieldSession.collection.insertOne(legacyDoc(job));
      const other = await newSession();
      const res = await attach(other.id, job); // ownerOfJob() finds the legacy owner
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('CAPTURE_ALREADY_ATTACHED');
      // ...whereas raw writes straight into the collection would NOT be stopped (hence the migration)
      const raw = await FieldSession.collection.insertOne({ user: OWNER, projectId: PROJECT, status: 'draft', source: { kind: 'capture' }, sources: [{ kind: 'capture', captureJobId: job._id, order: 0 }], createdAt: new Date(), updatedAt: new Date() });
      expect(raw.acknowledged).toBe(true);
      await FieldSession.collection.deleteOne({ _id: raw.insertedId });
      await FieldSession.collection.deleteMany({ 'source.captureJobId': job._id });
    });

    it('migration: dry run reports SAFE + the backfill, --apply backfills ADDITIVELY (nothing removed), is idempotent, and closes the cross-structure gap', async () => {
      await FieldSession.collection.deleteMany({});
      const jobs = await makePages(3, 430);
      for (const j of jobs) await FieldSession.collection.insertOne(legacyDoc(j));
      const logs = [];
      const col = FieldSession.collection;
      const dry = await migration.runMigration(col, { apply: false, log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) });
      expect(dry).toBe(0);
      expect(logs.join('\n')).toMatch(/Result: SAFE/);
      expect(logs.join('\n')).toMatch(/backfillSessions":3/);
      expect(await col.countDocuments({ sources: { $exists: false }, 'source.kind': 'capture' })).toBe(3); // dry run changed nothing

      expect(await migration.runMigration(col, { apply: true, log: () => {}, error: () => {} })).toBe(0);
      const rows = await col.find({}).toArray();
      expect(rows).toHaveLength(3);
      for (const r of rows) {
        expect(r.sources).toHaveLength(1);
        expect(String(r.sources[0].captureJobId)).toBe(String(r.source.captureJobId)); // the legacy field is still there, untouched
        expect(r.sources[0]).toMatchObject({ kind: 'capture', order: 0 });
        expect(r.status).toBe('draft');
      }
      const again = [];
      expect(await migration.runMigration(col, { apply: true, log: (...a) => again.push(a.join(' ')), error: () => {} })).toBe(0);
      expect(again).toContain('Nothing to do.');
      // after the backfill the DATABASE itself refuses a second owner of a legacy capture
      await expect(col.insertOne({ user: OWNER, projectId: PROJECT, status: 'draft', source: { kind: 'capture' }, sources: [{ kind: 'capture', captureJobId: jobs[0]._id, order: 0 }], createdAt: new Date(), updatedAt: new Date() })).rejects.toMatchObject({ code: 11000 });
    });

    it('migration: real duplicate data is UNSAFE - the dry run says so and --apply refuses to change anything', async () => {
      const col = FieldSession.collection;
      await col.deleteMany({});
      const [job] = await makePages(1, 440);
      await col.dropIndex('sources_captureJobId_unique_partial'); // simulate a database whose uniqueness was lost
      await col.insertMany([
        { user: OWNER, projectId: PROJECT, status: 'draft', source: { kind: 'capture' }, sources: [{ kind: 'capture', captureJobId: job._id, order: 0 }], createdAt: new Date(), updatedAt: new Date() },
        { user: OWNER, projectId: PROJECT, status: 'draft', source: { kind: 'capture' }, sources: [{ kind: 'capture', captureJobId: job._id, order: 0 }], createdAt: new Date(), updatedAt: new Date() },
        legacyDoc(await makeJob(pageSetups(441))),
      ]);
      const before = JSON.stringify(await col.find({}).sort({ _id: 1 }).toArray());
      const out = [];
      for (const apply of [false, true]) {
        expect(await migration.runMigration(col, { apply, log: (...a) => out.push(a.join(' ')), error: (...a) => out.push(a.join(' ')) })).toBe(1);
      }
      expect(out.join('\n')).toMatch(/Result: UNSAFE/);
      expect(out.join('\n')).toMatch(/Refusing to --apply/);
      expect(JSON.stringify(await col.find({}).sort({ _id: 1 }).toArray())).toBe(before); // not one document changed
      expect((await col.indexes()).some((i) => i.name === 'sources_captureJobId_unique_partial')).toBe(false); // and no index was built
      // restore the index for any later test
      await col.deleteMany({});
      await col.createIndex({ 'sources.captureJobId': 1 }, { unique: true, name: 'sources_captureJobId_unique_partial', partialFilterExpression: { 'sources.captureJobId': { $type: 'objectId' } } });
    });
  });

  describe('end to end on real Mongo: three pages -> one evidence set -> processing -> points', () => {
    it('merges, confirms once, processes with the ordinary engines and records page provenance', async () => {
      await SurveyPoint.collection.insertMany([
        { user: OWNER, projectId: PROJECT, name: 'S1', x: 1000, y: 2000, h: 500 },
        { user: OWNER, projectId: PROJECT, name: 'S2', x: 1000, y: 2100, h: 500 },
      ]);
      const j1 = await makeJob([P.station('S1', [P.obs('A1', '0.0000g', { distance: '50.000' }), P.obs('A2', '100.0000g', { distance: '30.000' })], { orientationTarget: 'S2' })]);
      const j2 = await makeJob([P.continuation([P.obs('A3', '300.0000g', { distance: '20.000' })])]);
      const j3 = await makeJob([P.station('S2', [P.obs('B1', '0.0000g', { distance: '40.000' })], { orientationTarget: 'S1' })]);
      const s = await sessionWith([j1, j2, j3]);
      const view = (await sessions('get', `/${s.id}`)).body.data;
      expect(view).toMatchObject({ pageCount: 3, setupCount: 2, observationCount: 4, issues: { errors: 0, warnings: 0 } });
      const conf = await sessions('post', `/${s.id}/confirm`);
      expect(conf.status).toBe(200);
      const setId = conf.body.data.observationSetId;
      const fos = await FieldObservationSet.findById(setId).lean();
      expect(fos.setups.map((x) => [x.station.point, x.observations.map((o) => o.target)])).toEqual([['S1', ['A1', 'A2', 'A3']], ['S2', ['B1']]]);
      expect(fos.setups[0].observations[2].source).toMatchObject({ page: 1, setup: 0, row: 0 });
      expect(String(fos.setups[0].observations[2].source.captureJobId)).toBe(sid(j2._id));
      expect(fos.pages.map((p) => p.page)).toEqual([0, 1, 2]);
      const run = await call('post', '/api/field-processing', { fieldObservationSetId: setId, verticalAngleConvention: 'zenith' });
      expect(run.status).toBe(201);
      expect(run.body.data.source.fieldSessionId).toBe(s.id);
      const obs = Object.fromEntries(run.body.data.setups.flatMap((x) => x.observations).map((o) => [o.target, o]));
      expect([obs.A1.x, obs.A1.y]).toEqual([expect.closeTo(1000, 3), expect.closeTo(2050, 3)]);
      expect([obs.A3.x, obs.A3.y]).toEqual([expect.closeTo(1020, 3), expect.closeTo(2000, 3)]);
      const pts = await call('post', `/api/field-processing/${run.body.data.id}/create-points`);
      expect(pts.body.created).toHaveLength(4);
      const done = (await sessions('get', `/${s.id}`)).body.data;
      expect(done).toMatchObject({ status: 'processed', processing: { runCount: 1, pointCount: 4 } });
    });
  });
});
