/**
 * Leica GSI normalization (pure, deterministic): parsed RECORDS + the user's explicit DECISIONS -> the GeoSolver field-session
 * setups (the very same typed shape manual and photographed sessions confirm into), every issue located on its record, and a
 * per-record view for the review. Nothing is inferred and nothing disappears:
 *
 *   SETUPS     a `station` record (explicit evidence: station words, no measurement) opens a setup; the measurements that follow
 *              belong to it until the next station record. A repeated station record is a new occupation. Measurements BEFORE
 *              any station record have no station: they form a setup whose station must be given explicitly by the user
 *              (decision `orphanStation`) - otherwise MISSING_STATION blocks confirmation.
 *   BACKSIGHT  never inferred. The user picks which measurement of a setup is its orientation (decision `orientation`); its Hz
 *              becomes the orientation direction. Without one the setup has a MISSING_ORIENTATION warning, as everywhere else.
 *   EXCLUSION  a record is left out only by an explicit decision (`excluded`), and stays listed as excluded. Excluding a station
 *              record excludes its whole setup (its measurements are never re-assigned to another station).
 *   AXES       target / station coordinates are adapted by WORD, not by name: X = Northing (82 / 85), Y = Easting (81 / 84),
 *              H = 83 / 86. A record with only one of the two horizontal words gets AXIS_MAPPING_UNRESOLVED and no coordinates.
 *              Instrument-computed coordinates are SHOWN for comparison; processing never uses them (the engines compute from
 *              the observations against the project's points).
 *   DISTANCES  31 is the SLOPE distance, 32 an explicit HORIZONTAL distance - each lands in its own field; neither is ever the
 *              other. 33 (height difference) is kept but not used.
 *
 * @param {object[]} records from gsiParser.parseGsi
 * @param {{excluded?: number[], orientation?: Object<string, number|null>, orphanStation?: {point: string, instrumentHeight?: string}|null}} decisions
 */
const { ISSUES } = require('../errors');
const { wordOf } = require('./gsiParser');
const { parseMeasurement } = require('../../capture/notebook/measurements');

const issue = (code, severity, loc = {}) => ({ code, severity, message: ISSUES[code], record: null, line: null, setup: null, setupKey: null, word: null, ...loc });
const norm = (s) => String(s || '').trim().toLowerCase();
const val = (rec, key) => { const w = wordOf(rec, key); return w && !w.issue ? w.value : null; };

function coordinates(rec, eKey, nKey, hKey) {
  const e = val(rec, eKey);
  const n = val(rec, nKey);
  const h = val(rec, hKey);
  if (!e && !n && !h) return { coords: null, partial: false };
  if (!e !== !n) return { coords: null, partial: true };
  return { coords: { x: n ? n.value : null, y: e ? e.value : null, h: h ? h.value : null }, partial: false };
}

function recordStatus(rec, excluded) {
  if (excluded) return 'excluded';
  if (rec.issues.some((i) => i.severity === 'error')) return 'error';
  if (rec.issues.some((i) => i.severity === 'warning')) return 'warning';
  return 'ok';
}

function normalizeGsi(records, decisions = {}) {
  const excluded = new Set((decisions.excluded || []).map(Number));
  const orientationOf = decisions.orientation || {};
  const issues = [];
  const setups = [];
  const recordSetup = new Map(); // seq -> setup key
  let current = null;
  let orphan = null;

  const newSetup = (key, stationRec) => ({ key, stationRec, measurements: [], excluded: stationRec ? excluded.has(stationRec.seq) : false });

  for (const rec of records) {
    if (rec.kind === 'station') {
      current = newSetup(`s${rec.seq}`, rec);
      setups.push(current);
      recordSetup.set(rec.seq, current.key);
    } else if (rec.kind === 'measurement') {
      let target = current;
      if (!target) {
        if (!orphan) { orphan = newSetup('orphan', null); setups.unshift(orphan); }
        target = orphan;
      }
      target.measurements.push(rec);
      recordSetup.set(rec.seq, target.key);
    }
  }
  for (const seq of excluded) if (!records.some((r) => r.seq === seq)) issues.push(issue('INVALID_DECISION', 'error', { record: seq }));

  // every record's own issues (unless it is excluded, or belongs to an excluded setup)
  const recordExcluded = (rec) => excluded.has(rec.seq) || setups.some((s) => s.excluded && (s.stationRec === rec || s.measurements.includes(rec)));
  for (const rec of records) {
    if (recordExcluded(rec)) continue;
    for (const is of rec.issues) issues.push(issue(is.code, is.severity, { record: rec.seq, line: rec.line, word: is.word || null, setupKey: recordSetup.get(rec.seq) || null }));
  }

  const out = [];
  for (const s of setups) {
    if (s.excluded) continue;
    const index = out.length;
    const loc = { setup: index, setupKey: s.key };
    let station;
    if (s.stationRec) {
      const point = val(s.stationRec, 'pointId');
      station = { point: point || null, instrumentHeight: val(s.stationRec, 'instrumentHeight'), notes: '' };
      if (!point) issues.push(issue('MISSING_STATION', 'error', { ...loc, record: s.stationRec.seq, line: s.stationRec.line }));
      if (station.instrumentHeight && station.instrumentHeight.value < 0) issues.push(issue('NEGATIVE_HEIGHT', 'error', { ...loc, record: s.stationRec.seq, line: s.stationRec.line }));
      const { partial } = coordinates(s.stationRec, 'stationEasting', 'stationNorthing', 'stationHeight');
      if (partial) issues.push(issue('AXIS_MAPPING_UNRESOLVED', 'warning', { ...loc, record: s.stationRec.seq, line: s.stationRec.line }));
    } else {
      const d = decisions.orphanStation || null;
      const point = d && String(d.point || '').trim();
      let hi = null;
      if (d && d.instrumentHeight !== undefined && d.instrumentHeight !== null && String(d.instrumentHeight).trim() !== '') {
        const p = parseMeasurement(`${String(d.instrumentHeight).trim()} m`);
        if (p.status === 'ok') hi = { value: p.value, unit: p.unit, explicit: true };
        else issues.push(issue('INVALID_DECISION', 'error', loc));
      }
      station = { point: point || null, instrumentHeight: hi, notes: '' };
      const live = s.measurements.filter((m) => !excluded.has(m.seq));
      if (!point && live.length) issues.push(issue('MISSING_STATION', 'error', loc));
    }

    const live = s.measurements.filter((m) => !excluded.has(m.seq));
    const chosen = orientationOf[s.key];
    let orientation = null;
    if (chosen !== undefined && chosen !== null) {
      const rec = live.find((m) => m.seq === Number(chosen));
      if (!rec) issues.push(issue('INVALID_DECISION', 'error', loc));
      else {
        orientation = { target: val(rec, 'pointId'), direction: val(rec, 'hz'), record: rec.seq };
        const at = { ...loc, record: rec.seq, line: rec.line };
        if (!wordOf(rec, 'pointId')) issues.push(issue('MISSING_TARGET', 'error', at));
        else if (station.point && norm(orientation.target) === norm(station.point)) issues.push(issue('COINCIDENT_ORIENTATION', 'error', at));
        if (!wordOf(rec, 'hz')) issues.push(issue('MISSING_DIRECTION', 'error', at));
      }
    }

    const observations = [];
    for (const rec of live) {
      if (orientation && rec.seq === orientation.record) continue;
      const at = { ...loc, record: rec.seq, line: rec.line };
      const before = issues.length;
      const target = val(rec, 'pointId');
      if (!wordOf(rec, 'pointId')) issues.push(issue('MISSING_TARGET', 'error', at));
      else if (station.point && norm(target) === norm(station.point)) issues.push(issue('TARGET_IS_STATION', 'error', at));
      if (!wordOf(rec, 'hz')) issues.push(issue('MISSING_DIRECTION', 'error', at));
      const slope = val(rec, 'slopeDistance');
      const horizontal = val(rec, 'horizontalDistance');
      if (!wordOf(rec, 'slopeDistance') && !wordOf(rec, 'horizontalDistance')) issues.push(issue('MISSING_DISTANCE', 'error', at));
      if ((slope && !(slope.value > 0)) || (horizontal && !(horizontal.value > 0))) issues.push(issue('NON_POSITIVE_DISTANCE', 'error', at));
      const prism = val(rec, 'reflectorHeight');
      if (prism && prism.value < 0) issues.push(issue('NEGATIVE_HEIGHT', 'error', at));
      const { coords, partial } = coordinates(rec, 'targetEasting', 'targetNorthing', 'targetHeight');
      if (partial) issues.push(issue('AXIS_MAPPING_UNRESOLVED', 'warning', at));
      // a record with an error is shown as an error record, never put in the evidence
      if (rec.issues.some((i) => i.severity === 'error') || issues.slice(before).some((i) => i.severity === 'error')) continue;
      const notes = rec.words.filter((w) => /^(info|remark)\d$/.test(w.key || '') && w.value).map((w) => w.value).join(' · ');
      observations.push({
        row: observations.length,
        target: val(rec, 'pointId'),
        hz: val(rec, 'hz'),
        vz: val(rec, 'v'),
        distance: val(rec, 'slopeDistance'),
        horizontalDistance: val(rec, 'horizontalDistance'),
        prismHeight: val(rec, 'reflectorHeight'),
        code: val(rec, 'code') || '',
        notes,
        cells: {},
        instrumentCoordinates: coords,
        source: { record: rec.seq, line: rec.line },
      });
    }
    if (observations.length && !orientation) issues.push(issue('MISSING_ORIENTATION', 'warning', loc));
    const byTarget = new Map();
    for (const o of observations) if (o.target) byTarget.set(norm(o.target), [...(byTarget.get(norm(o.target)) || []), o]);
    for (const group of byTarget.values()) {
      if (group.length > 1) for (const o of group) issues.push(issue('DUPLICATE_OBSERVATION', 'error', { ...loc, record: o.source.record, line: o.source.line }));
    }

    out.push({
      index,
      key: s.key,
      station,
      stationCoordinates: s.stationRec ? coordinates(s.stationRec, 'stationEasting', 'stationNorthing', 'stationHeight').coords : null,
      orientation: orientation ? { target: orientation.target, direction: orientation.direction } : null,
      orientationRecord: orientation ? orientation.record : null,
      observations,
      source: { record: s.stationRec ? s.stationRec.seq : null },
    });
  }

  // as for manual sessions: "no observations" means no observation ROWS at all (rows with errors already block on their own)
  const observationCount = out.reduce((n, s) => n + s.observations.length, 0);
  const observationRows = setups.filter((s) => !s.excluded).reduce((n, s) => {
    const o = out.find((x) => x.key === s.key);
    return n + s.measurements.filter((r) => !excluded.has(r.seq) && r.seq !== (o && o.orientationRecord)).length;
  }, 0);
  if (!observationRows) issues.push(issue('NO_OBSERVATIONS', 'error'));

  const statusBy = new Map(records.map((r) => [r.seq, recordStatus(r, recordExcluded(r))]));
  const recordViews = records.map((r) => ({
    seq: r.seq,
    line: r.line,
    kind: r.kind,
    setupKey: recordSetup.get(r.seq) || null,
    status: statusBy.get(r.seq),
    raw: r.raw,
    words: r.words.map((w) => ({ code: w.code, label: w.label, category: w.category, raw: w.raw, display: w.display, unitLabel: w.unitLabel, inputModeLabel: w.inputModeLabel, issue: w.issue ? w.issue.code : null })),
  }));

  const errors = issues.filter((i) => i.severity === 'error').length;
  const allWords = records.flatMap((r) => r.words);
  const summary = {
    records: records.length,
    stations: records.filter((r) => r.kind === 'station').length,
    setups: out.length,
    observations: observationCount,
    excluded: records.filter((r) => statusBy.get(r.seq) === 'excluded').length,
    errors,
    warnings: issues.length - errors,
    unknownWords: allWords.filter((w) => w.category === 'unknown').length,
    unusedWords: allWords.filter((w) => w.category === 'unused').length,
    canConfirm: errors === 0 && observationCount > 0,
  };
  return { setups: out, issues, records: recordViews, summary };
}

module.exports = { normalizeGsi };
