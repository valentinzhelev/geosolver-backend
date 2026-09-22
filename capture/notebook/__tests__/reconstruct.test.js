const { reconstructNotebook, classifyLine, splitLabelledLine } = require('../reconstruct');
const { layoutNotebook, stripPrivate } = require('../../../tests/support/notebookFixtures');

const page = (layout) => ({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) });
const build = (spec) => {
  const layout = layoutNotebook(spec);
  const { notebook, reason } = reconstructNotebook(page(layout), { provider: 'fixture' });
  expect(reason).toBeUndefined();
  return { layout, notebook };
};

const A = { station: 'T1', hi: '1.450', orientationTarget: 'T0', orientationDirection: '0.0000g', observations: [
  { target: 'A1', hz: '94.5000g', vz: '100.2500g', distance: '123.456', prism: '1.500' },
  { target: 'A2', hz: '188.7750g', vz: '99.5000g', distance: '87.320', prism: '1.500' },
  { target: 'A3', hz: '302.1000g', vz: '101.0500g', distance: '210.000', prism: '2.000' },
] };

describe('one station + orientation + 3 targets (the baseline shape)', () => {
  it('detects one setup with a station, an orientation and three observation rows', () => {
    const { notebook } = build({ setups: [A] });
    expect(notebook.setups).toHaveLength(1);
    const setup = notebook.setups[0];
    expect(setup.station.point.rawText).toBe('T1');
    expect(setup.station.instrumentHeight.rawText).toBe('1.450');
    expect(setup.orientation.target.rawText).toBe('T0');
    expect(setup.orientation.direction.rawText).toBe('0.0000g');
    expect(setup.observations).toHaveLength(3);
    const targetOf = (o) => o.cells[o.cols.findIndex((c) => c.field === 'target')].rawText;
    expect(setup.observations.map(targetOf)).toEqual(['A1', 'A2', 'A3']);
  });

  it('every observation field is a full candidate cell (bbox, candidates[0], symbolConfidence) - identical shape to coordinate-table cells', () => {
    const { notebook } = build({ setups: [A] });
    const cell = notebook.setups[0].observations[0].cells[1]; // Hz column
    expect(cell.rawText).toBe('94.5000g');
    expect(cell.candidates[0]).toMatchObject({ text: '94.5000g', source: 'primary', recognitionPass: 0 });
    expect(cell.bbox.w).toBeGreaterThan(0);
    expect(cell.symbolConfidence).toEqual({ min: null, suspicious: [] });
    expect(cell.userValue).toBeNull();
  });

  it('observation column headers are mapped to fields (Точка/Hz/V/S/p)', () => {
    const { notebook } = build({ setups: [A] });
    expect(notebook.setups[0].observations[0].cols.map((c) => c.field)).toEqual(['target', 'hz', 'vz', 'distance', 'prismHeight']);
  });
});

describe('multiple stations / setups on one page', () => {
  it('a second station line starts a new setup; each keeps its own observations', () => {
    const B = { station: 'T2', hi: '1.520', observations: [{ target: 'B1', hz: '10.0000g', vz: '99.0000g', distance: '50.000', prism: '1.500' }] };
    const { notebook } = build({ setups: [A, B] });
    expect(notebook.setups).toHaveLength(2);
    expect(notebook.setups[0].station.point.rawText).toBe('T1');
    expect(notebook.setups[0].observations).toHaveLength(3);
    expect(notebook.setups[1].station.point.rawText).toBe('T2');
    expect(notebook.setups[1].observations).toHaveLength(1);
    expect(notebook.setups[1].orientation).toBeNull(); // this setup never had one - not invented
  });
});

describe('reordered columns and missing optional fields', () => {
  it('a station with NO instrument height and NO orientation still reconstructs (both are optional)', () => {
    const bare = { station: 'T9', observations: [{ target: 'Z1', hz: '1.0000g', vz: '99.0000g', distance: '5.000' }] };
    const { notebook } = build({ setups: [bare] });
    expect(notebook.setups[0].station.instrumentHeight.rawText).toBe('');
    expect(notebook.setups[0].orientation).toBeNull();
    // the prism height HEADER is still printed (it names its own column) even though this setup never fills it in
    const prismCol = notebook.setups[0].observations[0].cols.find((c) => c.field === 'prismHeight');
    expect(prismCol).toBeDefined();
    const prismCell = notebook.setups[0].observations[0].cells[notebook.setups[0].observations[0].cols.indexOf(prismCol)];
    expect(prismCell.rawText).toBe('');
  });
});

describe('classifyLine / splitLabelledLine (unit building blocks)', () => {
  it('classifies station/orientation/header/data lines correctly', () => {
    const w = (text, x) => ({ text, confidence: 0.98, bbox: { x, y: 0, w: text.length * 10, h: 20 } });
    expect(classifyLine({ words: [w('Ст.', 0), w('T1', 20)] })).toBe('station');
    expect(classifyLine({ words: [w('Ориентир', 0), w('T0', 60)] })).toBe('orientation');
    expect(classifyLine({ words: [w('Точка', 0), w('Hz', 40), w('V', 60)] })).toBe('header');
    expect(classifyLine({ words: [w('A1', 0), w('94.5', 20)] })).toBe('data');
  });

  it('splits a "label value label value" line into segments by x-order', () => {
    const w = (text, x) => ({ text, confidence: 0.98, bbox: { x, y: 0, w: text.length * 10, h: 20 } });
    const segments = splitLabelledLine([w('Ст.', 0), w('T1', 20), w('i', 60), w('1.450', 80)]);
    expect(segments).toEqual([
      { field: 'station', valueWords: [w('T1', 20)] },
      { field: 'instrumentHeight', valueWords: [w('1.450', 80)] },
    ]);
  });
});

describe('no recognisable content', () => {
  it('no station line anywhere -> NO_STATION_DETECTED, never a crash', () => {
    const layout = layoutNotebook({ setups: [{ station: 'T1', observations: [] }] });
    // strip the station line's words entirely to simulate "nothing recognisable"
    const words = stripPrivate(layout.words).filter((w) => w.text !== 'Ст.' && w.text !== 'T1');
    const { notebook, reason } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words }, { provider: 'fixture' });
    expect(notebook).toBeNull();
    expect(reason).toBe('NO_STATION_DETECTED');
  });

  it('an empty page -> NO_TEXT', () => {
    expect(reconstructNotebook({ index: 0, width: 10, height: 10, words: [] })).toEqual({ notebook: null, reason: 'NO_TEXT' });
  });
});
