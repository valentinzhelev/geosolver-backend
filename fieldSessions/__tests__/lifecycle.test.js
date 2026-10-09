const { deriveStatus } = require('../status');
const { processingOptions } = require('../options');
const { setupsToRaw } = require('../revise');
const { evaluateSession } = require('../evaluate');
const { normalizeSetups } = require('../entry');
const { planIndexMigration, OLD_NAME } = require('../../scripts/migrate-field-observation-set-indexes');

describe('deriveStatus: Чернова -> За проверка -> Потвърдена -> Обработена', () => {
  const manual = (status) => ({ source: { kind: 'manual' }, status });
  it('manual sessions use the persisted state, and confirmed + a run is Обработена', () => {
    expect(deriveStatus({ session: manual('draft') })).toEqual({ status: 'draft', label: 'Чернова', confirmed: false });
    expect(deriveStatus({ session: manual('review') }).label).toBe('За проверка');
    expect(deriveStatus({ session: manual('confirmed') })).toEqual({ status: 'confirmed', label: 'Потвърдена', confirmed: true });
    expect(deriveStatus({ session: manual('confirmed'), runCount: 2 })).toEqual({ status: 'processed', label: 'Обработена', confirmed: true });
  });

  it('a run never makes an unconfirmed session processed', () => {
    expect(deriveStatus({ session: manual('draft'), runCount: 3 }).status).toBe('draft');
  });

  it('capture-backed sessions follow the attached job, not a copy of its state', () => {
    const s = { source: { kind: 'capture' }, status: 'draft' };
    expect(deriveStatus({ session: s, job: null }).status).toBe('draft');
    expect(deriveStatus({ session: s, job: { status: 'processing' } }).status).toBe('draft');
    expect(deriveStatus({ session: s, job: { status: 'failed' } }).status).toBe('draft');
    expect(deriveStatus({ session: s, job: { status: 'needs_review' } }).status).toBe('review');
    expect(deriveStatus({ session: s, job: { status: 'confirmed' } }).status).toBe('confirmed');
    expect(deriveStatus({ session: s, job: { status: 'confirmed' }, runCount: 1 }).status).toBe('processed');
  });

  it('an unknown persisted status degrades to draft, never to confirmed', () => {
    expect(deriveStatus({ session: manual('weird') }).status).toBe('draft');
    expect(deriveStatus({ session: { source: { kind: null } } }).status).toBe('draft');
  });
});

describe('processingOptions: only valid processing is offered', () => {
  const o = (target) => ({ row: 0, target, hz: { value: 1, unit: 'gon' }, distance: { value: 10, unit: 'm' } });
  const st = (index, point, backsight, targets) => ({ index, station: { point }, orientation: backsight ? { target: backsight } : null, observations: targets.map((t, i) => ({ ...o(t), row: i })) });

  it('no setups / no observations -> nothing is available, with a reason', () => {
    expect(processingOptions([]).polar).toMatchObject({ available: false, reason: 'NO_OBSERVATIONS' });
    expect(processingOptions([st(0, '101', '102', [])]).polar.available).toBe(false);
    expect(processingOptions(undefined).traverse.available).toBe(false);
  });

  it('one station with observations -> polar yes, traverse no (needs two stations)', () => {
    const r = processingOptions([st(0, '101', '102', ['201', '202'])]);
    expect(r.polar).toEqual({ available: true, reason: null, setupCount: 1, observationCount: 2 });
    expect(r.traverse).toMatchObject({ available: false, reason: 'NEEDS_TWO_STATIONS' });
  });

  it('two stations that confirm each other as backsight/foresight -> traverse chain with a suggested start', () => {
    const r = processingOptions([st(0, '101', '100', ['102', '300']), st(1, '102', '101', ['103'])]);
    expect(r.traverse.available).toBe(true);
    expect(r.traverse.suggestedStart).toBe('101');
    expect(r.traverse.chain).toEqual(['101', '102']);
    expect(r.traverse.endCandidates).toEqual(['103']);
    expect(r.traverse.closesOnStart).toBe(false);
  });

  it('a loop that returns to the start is detected', () => {
    const r = processingOptions([st(0, 'A', 'Z', ['B']), st(1, 'B', 'A', ['C']), st(2, 'C', 'B', ['A'])]);
    expect(r.traverse.available).toBe(true);
    expect(r.traverse.chain).toEqual(['A', 'B', 'C']);
    expect(r.traverse.closesOnStart).toBe(true);
  });

  it('two stations that do not reference each other -> no traverse; duplicate station names -> no traverse', () => {
    expect(processingOptions([st(0, 'A', 'Z', ['X']), st(1, 'B', 'Y', ['W'])]).traverse).toMatchObject({ available: false, reason: 'NO_STATION_CHAIN' });
    expect(processingOptions([st(0, 'A', 'Z', ['B']), st(1, 'A', 'Z', ['B'])]).traverse).toMatchObject({ available: false, reason: 'DUPLICATE_STATION' });
  });
});

describe('revision copy is lossless', () => {
  it('raw -> evaluate -> typed -> raw -> evaluate gives the identical typed evidence', () => {
    const first = evaluateSession({
      angleUnit: 'gon',
      setups: normalizeSetups([{
        index: 3, station: { point: '101', instrumentHeight: '152 cm', notes: 'ст.' }, orientation: { target: '102', direction: "0°30'0\"" },
        observations: [
          { row: 4, target: '201', hz: '123.4567', vz: '98,5', distance: '50.123', horizontalDistance: '', prismHeight: '1,8', code: 'К1', notes: 'а' },
          { row: 9, target: '202', hz: "94°30'15\"", vz: '', distance: '', horizontalDistance: '30 m', prismHeight: '', code: '', notes: '' },
        ],
      }]),
    });
    expect(first.summary.canConfirm).toBe(true);

    const raw = setupsToRaw(first.setups);
    const second = evaluateSession({ angleUnit: 'gon', setups: normalizeSetups(raw) });
    expect(second.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(second.setups).toEqual(first.setups); // DMS components included - bit-for-bit the same evidence

    // a different declared session unit may only add a warning; it can never change a typed value
    const other = evaluateSession({ angleUnit: 'deg', setups: normalizeSetups(raw) });
    expect(other.setups).toEqual(first.setups);
    expect(second.setups[0].index).toBe(3);
    expect(second.setups[0].observations.map((x) => x.row)).toEqual([4, 9]); // row ids (provenance) survive
  });
});

describe('FieldObservationSet index migration plan', () => {
  const idx = (name, extra = {}) => ({ name, key: {}, ...extra });
  it('old plain index present -> drop it and create both partial indexes', () => {
    const plan = planIndexMigration([idx('_id_'), idx(OLD_NAME, { unique: true })]);
    expect(plan.drop).toEqual([OLD_NAME]);
    expect(plan.create.map((c) => c.name)).toEqual(['source_captureJobId_unique_partial', 'source_fieldSessionId_unique_partial']);
  });
  it('already migrated -> nothing to do (idempotent)', () => {
    const plan = planIndexMigration([idx('_id_'), idx('source_captureJobId_unique_partial'), idx('source_fieldSessionId_unique_partial')]);
    expect(plan).toEqual({ drop: [], create: [] });
  });
  it('fresh database (no indexes yet) -> only creates; never drops what is not there', () => {
    expect(planIndexMigration([]).drop).toEqual([]);
  });
});

describe('model/index contract', () => {
  it('FieldObservationSet declares partial unique indexes for both source ids', () => {
    const FOS = require('../../models/FieldObservationSet');
    const indexes = FOS.schema.indexes();
    const cap = indexes.find(([k]) => k['source.captureJobId'] === 1);
    const ses = indexes.find(([k]) => k['source.fieldSessionId'] === 1);
    expect(cap[1]).toMatchObject({ unique: true, partialFilterExpression: { 'source.captureJobId': { $type: 'objectId' } } });
    expect(ses[1]).toMatchObject({ unique: true, partialFilterExpression: { 'source.fieldSessionId': { $type: 'objectId' } } });
  });

  it('a session-origin set validates without a captureJobId; a capture-origin set still requires one', () => {
    const FOS = require('../../models/FieldObservationSet');
    const mongoose = require('mongoose');
    const id = () => new mongoose.Types.ObjectId();
    expect(new FOS({ user: id(), projectId: id(), source: { kind: 'session', fieldSessionId: id() }, setups: [] }).validateSync()).toBeUndefined();
    const bad = new FOS({ user: id(), projectId: id(), source: { kind: 'capture' }, setups: [] }).validateSync();
    expect(bad.errors['source.captureJobId']).toBeDefined();
  });

  it('FieldProcessingRun accepts a session-origin source and still requires a captureJobId otherwise', () => {
    const FPR = require('../../models/FieldProcessingRun');
    const mongoose = require('mongoose');
    const id = () => new mongoose.Types.ObjectId();
    const base = { user: id(), projectId: id(), processingVersion: 'v', engineVersions: {} };
    expect(new FPR({ ...base, source: { fieldObservationSetId: id(), fieldSessionId: id() } }).validateSync()).toBeUndefined();
    expect(new FPR({ ...base, source: { fieldObservationSetId: id() } }).validateSync().errors['source.captureJobId']).toBeDefined();
  });

  it('FieldSession allows exactly the persisted statuses and one capture job per session (partial unique)', () => {
    const FS = require('../../models/FieldSession');
    const idx = FS.schema.indexes().find(([k]) => k['source.captureJobId'] === 1);
    expect(idx[1]).toMatchObject({ unique: true, partialFilterExpression: { 'source.captureJobId': { $type: 'objectId' } } });
    const mongoose = require('mongoose');
    const bad = new FS({ user: new mongoose.Types.ObjectId(), projectId: new mongoose.Types.ObjectId(), status: 'processed' }).validateSync();
    expect(bad.errors.status).toBeDefined(); // 'processed' is derived, never stored
  });
});
