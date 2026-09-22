/**
 * Deterministic Field Notebook fixtures (test support, not a test) - the geometry half. Image rendering and the
 * Google-Vision-shaped response are GENERIC in tests/support/captureFixtures.js (they only need {width,height,words})
 * and are reused here as-is: this file only lays out realistic word positions for a notebook page.
 */
const { renderTableImage, toVisionResponse, stripPrivate } = require('./captureFixtures');

const CHAR_W = 14;
const ROW_H = 40;
const WORD_H = 26;
const PAD_X = 30;
const PAD_Y = 30;
const COL_GAP = 60;
const OBS_HEADERS = ['Точка', 'Hz', 'V', 'S', 'p'];

function placeTokens(tokens, y, confidence) {
  const words = [];
  let x = PAD_X;
  for (const raw of tokens) {
    const text = raw === undefined || raw === null ? '' : String(raw);
    if (text === '') {
      x += CHAR_W * 3;
      continue;
    }
    for (const part of text.split(' ')) {
      if (part === '') {
        x += CHAR_W;
        continue;
      }
      const w = part.length * CHAR_W;
      words.push({ text: part, confidence: confidence ?? 0.98, bbox: { x, y, w, h: WORD_H } });
      x += w + CHAR_W;
    }
  }
  return { words, endX: x };
}

/**
 * @param {{setups: {
 *   station: string, hi?: string, orientationTarget?: string, orientationDirection?: string,
 *   observations: {target: string, hz: string, vz: string, distance: string, prism?: string}[],
 *   confidence?: (rowIndex:number, field:string) => number,
 * }[]}} spec
 * @returns {{words: object[], width: number, height: number}}
 */
function layoutNotebook(spec) {
  const words = [];
  let y = PAD_Y;
  let maxX = 0;
  const advance = (n = 1) => { y += ROW_H * n; };

  for (const setup of spec.setups) {
    const stationTokens = ['Ст.', setup.station];
    if (setup.hi !== undefined) stationTokens.push('i', setup.hi);
    const st = placeTokens(stationTokens, y, setup.confidence && setup.confidence(-1, 'station'));
    words.push(...st.words);
    maxX = Math.max(maxX, st.endX);
    advance();

    if (setup.orientationTarget !== undefined) {
      const oTokens = ['Ориентир', setup.orientationTarget];
      if (setup.orientationDirection !== undefined) oTokens.push(setup.orientationDirection);
      const ot = placeTokens(oTokens, y, setup.confidence && setup.confidence(-1, 'orientation'));
      words.push(...ot.words);
      maxX = Math.max(maxX, ot.endX);
      advance();
    }

    const rows = setup.observations.map((o) => [o.target, o.hz, o.vz, o.distance, o.prism ?? '']);
    const colChars = OBS_HEADERS.map((h, c) => Math.max(String(h).length, ...rows.map((r) => String(r[c] ?? '').length), 3));
    const colX = [];
    let x = PAD_X;
    for (let c = 0; c < OBS_HEADERS.length; c += 1) {
      colX.push(x);
      x += colChars[c] * CHAR_W + COL_GAP;
    }
    maxX = Math.max(maxX, x);

    OBS_HEADERS.forEach((h, c) => words.push({ text: h, confidence: 0.98, bbox: { x: colX[c], y, w: h.length * CHAR_W, h: WORD_H } }));
    advance();

    rows.forEach((row, r) => {
      row.forEach((cellText, c) => {
        const text = String(cellText ?? '');
        if (text === '') return;
        let cursor = colX[c];
        for (const part of text.split(' ')) {
          if (part === '') { cursor += CHAR_W; continue; }
          const w = part.length * CHAR_W;
          const conf = setup.confidence ? setup.confidence(r, OBS_HEADERS[c]) : 0.98;
          words.push({ text: part, confidence: conf ?? 0.98, bbox: { x: cursor, y, w, h: WORD_H } });
          cursor += w + CHAR_W;
        }
      });
      advance();
    });
  }

  return { words, width: Math.round(maxX + PAD_X), height: Math.round(y + 40) };
}

/** Ground truth used by the notebook E2E test: one station, an orientation, three observations. */
const TRUTH = {
  setups: [
    {
      station: 'T1',
      instrumentHeight: 1.45,
      orientation: { target: 'T0', direction: { value: 0, unit: 'gon' } },
      observations: [
        { target: 'A1', hz: { value: 94.5, unit: 'gon' }, vz: { value: 100.25, unit: 'gon' }, distance: 123.456, prism: 1.5 },
        { target: 'A2', hz: { value: 188.775, unit: 'gon' }, vz: { value: 99.5, unit: 'gon' }, distance: 87.32, prism: 1.5 },
        { target: 'A3', hz: { value: 302.1, unit: 'gon' }, vz: { value: 101.05, unit: 'gon' }, distance: 210.0, prism: 2.0 },
      ],
    },
  ],
};

module.exports = { layoutNotebook, renderTableImage, toVisionResponse, stripPrivate, TRUTH, OBS_HEADERS };
