/**
 * Deterministic Field Notebook layout interpretation from OCR word geometry (pure, no I/O).
 *
 * A field notebook page does not have one grid the way a coordinate table does: it interleaves short "label:
 * value" lines (station id, instrument height, orientation/backsight) with an observation TABLE (target / Hz / V /
 * distance / prism height...) and may repeat this whole pattern for more than one station/setup on the same page.
 *
 * Algorithm (line by line, top to bottom):
 *   1. cluster words into text lines (reused from capture/reconstruct.js - same technique as coordinate tables);
 *   2. classify each line: STATION (names a station), ORIENTATION (names a backsight), OBSERVATION HEADER (names
 *      >= 2 observation fields, one of them a key one), or DATA (an observation row, only once a header exists);
 *   3. a STATION line always starts a new setup - everything until the next STATION line belongs to it;
 *   4. every non-data line before the header is parsed as "label: value" segments (capture/notebook/headers.js)
 *      and merged into the setup's station/orientation fields - this supports both "Ст. T1  i 1.450" on one line
 *      and split across several lines, without guessing which layout a given photo used;
 *   5. once a header is found, observation rows use the SAME column-interval cell assignment as coordinate tables
 *      (capture/reconstruct.js's columnIntervals/nearestColumn), reused as-is;
 *   6. multi-page notebooks: an observation table header that appears BEFORE any station line (a page that continues
 *      the previous page's station) opens a LEADING CONTINUATION setup (`continuation: true`, empty station fields).
 *      Whether it really continues a station is decided at session level (fieldSessions/pageMerge.js), never here -
 *      a single page cannot know. Data-looking rows before any station AND without a header cannot be assigned to a
 *      column layout: they are counted in `notebook.unassignedRows` (a review warning), never silently dropped.
 *
 * Every field is built with capture/reconstruct.js#buildCandidateCell - the exact same "candidate cell" shape
 * coordinate-table cells use, so bounded re-recognition and arbitration (capture/rerecognition.js,
 * capture/arbitration.js) work unchanged on notebook fields. Nothing here interprets angles or distances: that is
 * capture/notebook/validation.js's job, exactly like capture/validation.js does for coordinate tables.
 */
const { clusterLines, columnIntervals, nearestColumn, buildCandidateCell, median, union } = require('../reconstruct');
const { mapLabel, labelHits } = require('./headers');

const cx = (b) => b.x + b.w / 2;

const KEY_OBSERVATION_FIELDS = ['target', 'hz', 'vz', 'distance'];

// a token that reads as a measurement value (an angle/distance/height), used only to tell a stray observation ROW from
// a title line when no column layout exists for it
const NUMERIC_TOKEN = /^[+-]?\d+(?:[.,]\d+)?(?:g|gon|°|º|m|cm|mm)?$/i;
const looksLikeObservationRow = (line) => line.words.length >= 3 && line.words.filter((w) => NUMERIC_TOKEN.test(String(w.text).trim())).length >= 2;

function classifyLine(line) {
  const { fields } = labelHits(line.words.map((w) => w.text));
  if (fields.includes('station')) return 'station';
  if (fields.includes('orientation')) return 'orientation';
  if (fields.length >= 2 && fields.some((f) => KEY_OBSERVATION_FIELDS.includes(f))) return 'header';
  return 'data';
}

/** Splits a line's words into label-anchored "field: value..." segments (capture/notebook/headers.js#mapLabel). */
function splitLabelledLine(lineWords) {
  const sorted = [...lineWords].sort((a, b) => a.bbox.x - b.bbox.x);
  const segments = [];
  let current = null;
  for (const w of sorted) {
    const hit = mapLabel(w.text);
    if (hit.field) {
      current = { field: hit.field, valueWords: [] };
      segments.push(current);
    } else if (current) {
      current.valueWords.push(w);
    }
  }
  return segments;
}

/** A field built from a label segment's value words (or an empty/absent field when there is nothing there). */
function fieldFromSegment(segment, { page, providerName, bboxFallback }) {
  const words = segment ? segment.valueWords : [];
  return buildCandidateCell(words, { col: 0, page, providerName, emptyBbox: bboxFallback });
}

function mergeStationOrientation(segments, target, { page, providerName }) {
  for (const seg of segments) {
    const bboxFallback = { x: seg.valueWords[0] ? seg.valueWords[0].bbox.x : 0, y: seg.valueWords[0] ? seg.valueWords[0].bbox.y : 0, w: 1, h: 1 };
    if (seg.field === 'station') target.station.point = fieldFromSegment(seg, { page, providerName, bboxFallback });
    else if (seg.field === 'instrumentHeight') target.station.instrumentHeight = fieldFromSegment(seg, { page, providerName, bboxFallback });
    else if (seg.field === 'notes' && !target.orientation) target.station.notes = fieldFromSegment(seg, { page, providerName, bboxFallback });
    else if (seg.field === 'orientation') {
      const [firstWord, ...rest] = seg.valueWords;
      target.orientation = target.orientation || { target: null, direction: null };
      target.orientation.target = buildCandidateCell(firstWord ? [firstWord] : [], { col: 0, page, providerName, emptyBbox: bboxFallback });
      target.orientation.direction = rest.length ? buildCandidateCell(rest, { col: 0, page, providerName, emptyBbox: bboxFallback }) : null;
    }
  }
}

/**
 * @param {{index:number,width:number,height:number,words:object[]}} page
 * @param {{provider?: string}} options
 * @returns {{notebook: object|null, reason?: string}}
 */
function reconstructNotebook(page, options = {}) {
  const providerName = options.provider || null;
  const words = (page.words || []).filter((w) => w && typeof w.text === 'string' && w.text.trim() !== '' && w.bbox);
  if (!words.length) return { notebook: null, reason: 'NO_TEXT' };

  const medianH = median(words.map((w) => w.bbox.h)) || 1;
  const lines = clusterLines(words, medianH);
  const classified = lines.map((line) => ({ line, kind: classifyLine(line) }));

  const setups = [];
  let current = null;
  let pendingSegments = []; // label segments collected before the header is found for the current setup
  let headerCols = null; // column intervals + field mapping, once found for the current setup

  const flushPending = () => {
    if (current && pendingSegments.length) mergeStationOrientation(pendingSegments, current, { page: page.index, providerName });
    pendingSegments = [];
  };
  const emptyField = (line) => buildCandidateCell([], { col: 0, page: page.index, providerName, emptyBbox: { x: line.bbox.x, y: line.bbox.y, w: 1, h: line.bbox.h } });
  let unassignedRows = 0;
  const startSetup = (line, extra = {}) => {
    flushPending();
    current = { index: setups.length, station: { point: emptyField(line), instrumentHeight: emptyField(line), notes: emptyField(line), bbox: line.bbox }, orientation: null, observations: [], issues: [], ...extra };
    setups.push(current);
    headerCols = null;
  };

  for (let i = 0; i < classified.length; i += 1) {
    const { line, kind } = classified[i];
    if (kind === 'station') {
      startSetup(line);
      pendingSegments.push(...splitLabelledLine(line.words));
      continue;
    }
    if (!current) {
      if (kind === 'header') {
        // a table with no station line above it: see the module doc, point 6. Only when it actually has rows - a lone
        // header line is not a recognisable notebook (NO_STATION_DETECTED, exactly as before multi-page support).
        let hasRows = false;
        for (let j = i + 1; j < classified.length && classified[j].kind !== 'station'; j += 1) {
          if (classified[j].kind === 'data' && classified[j].line.words.length >= 2) { hasRows = true; break; }
        }
        if (!hasRows) continue;
        startSetup(line, { continuation: true });
      } else {
        if (kind === 'data' && looksLikeObservationRow(line)) unassignedRows += 1; // observation-looking, but no layout to read it with
        continue; // otherwise a title / label line before the first station: not part of any setup
      }
    }

    if (kind === 'orientation') {
      pendingSegments.push(...splitLabelledLine(line.words));
      continue;
    }
    if (kind === 'header') {
      flushPending();
      // column intervals from the DATA lines that follow this header, up to the next station line
      const followingData = [];
      for (let j = i + 1; j < classified.length && classified[j].kind !== 'station'; j += 1) {
        if (classified[j].kind === 'data' && classified[j].line.words.length >= 2) followingData.push(classified[j].line);
      }
      const basis = followingData.length ? followingData : [line];
      const columns = columnIntervals(basis, medianH);
      // a header word for a column that has NO data in any row (e.g. prism height, left blank throughout this
      // setup) must not be glued onto the nearest data column: it becomes a column of its own, exactly like
      // capture/reconstruct.js does for coordinate tables.
      const pad = 0.7 * medianH;
      const extras = [];
      for (const w of line.words) {
        const wx0 = w.bbox.x;
        const wx1 = w.bbox.x + w.bbox.w;
        if (!columns.some((col) => wx0 <= col.x1 + pad && wx1 >= col.x0 - pad)) extras.push([wx0, wx1]);
      }
      extras.sort((p, q) => p[0] - q[0]);
      const mergedExtras = [];
      for (const [ex0, ex1] of extras) {
        const last = mergedExtras[mergedExtras.length - 1];
        if (last && ex0 - last[1] <= pad) last[1] = Math.max(last[1], ex1);
        else mergedExtras.push([ex0, ex1]);
      }
      for (const [ex0, ex1] of mergedExtras) columns.push({ index: -1, x0: ex0, x1: ex1 });
      columns.sort((p, q) => p.x0 - q.x0);
      columns.forEach((col, i) => { col.index = i; });
      const headerWords = new Map();
      for (const w of line.words) {
        const col = nearestColumn(columns, cx(w.bbox));
        (headerWords.get(col) || headerWords.set(col, []).get(col)).push(w);
      }
      const cols = columns.map((c) => {
        const hw = (headerWords.get(c.index) || []).sort((a, b) => a.bbox.x - b.bbox.x);
        const headerText = hw.map((w) => w.text).join(' ').trim();
        const m = headerText ? mapLabel(headerText) : { field: null, ambiguous: false };
        return { index: c.index, x0: c.x0, x1: c.x1, headerText, field: m.field, mapping: m.field ? 'ok' : m.ambiguous ? 'ambiguous' : 'unmapped' };
      });
      headerCols = { columns, cols };
      continue;
    }
    // kind === 'data'
    if (!headerCols) {
      pendingSegments.push(...splitLabelledLine(line.words)); // a stray label line before any header was found yet
      continue;
    }
    const { columns, cols } = headerCols;
    const cellWords = new Map(cols.map((c) => [c.index, []]));
    for (const w of line.words) cellWords.get(nearestColumn(columns, cx(w.bbox))).push(w);
    const nonEmpty = [...cellWords.values()].filter((ws) => ws.length).length;
    if (nonEmpty < 1) continue;
    const cells = cols.map((c) => {
      const ws = (cellWords.get(c.index) || []).sort((a, b) => a.bbox.x - b.bbox.x);
      return buildCandidateCell(ws, { col: c.index, page: page.index, providerName, emptyBbox: { x: c.x0, y: line.bbox.y, w: c.x1 - c.x0, h: line.bbox.h } });
    });
    current.observations.push({ index: current.observations.length, bbox: line.bbox, excluded: false, status: 'ok', cols, cells });
  }
  flushPending();

  if (!setups.length) return { notebook: null, reason: 'NO_STATION_DETECTED' };

  return {
    notebook: { pageIndex: page.index, setups, issues: [], ...(unassignedRows ? { unassignedRows } : {}) },
    diagnostics: { lines: lines.length, setups: setups.length },
  };
}

module.exports = { reconstructNotebook, classifyLine, splitLabelledLine };
