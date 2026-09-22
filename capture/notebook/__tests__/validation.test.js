const { reconstructNotebook } = require('../reconstruct');
const { evaluateNotebook, fieldReviewState } = require('../validation');
const { layoutNotebook, stripPrivate } = require('../../../tests/support/notebookFixtures');

const page = (layout) => ({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) });
const build = (spec) => {
  const layout = layoutNotebook(spec);
  const { notebook } = reconstructNotebook(page(layout), { provider: 'fixture' });
  return notebook;
};
const evaluate = (spec) => evaluateNotebook(build(spec));
const issuesOf = (nb, setupIdx, rowIdx, field) => {
  const row = nb.setups[setupIdx].observations[rowIdx];
  const cell = row.cells[row.cols.findIndex((c) => c.field === field)];
  return cell.validation.issues.map((i) => i.code);
};

const CLEAN = { setups: [{
  station: 'T1', hi: '1.450', orientationTarget: 'T0', orientationDirection: '0.0000g',
  observations: [
    { target: 'A1', hz: '94.5000g', vz: '100.2500g', distance: '123.456', prism: '1.500' },
    { target: 'A2', hz: '188.7750g', vz: '99.5000g', distance: '87.320', prism: '1.500' },
  ],
}] };

describe('a clean setup: everything ready, canConfirm true', () => {
  it('parses the station, orientation and every observation field', () => {
    const { notebook, summary, setups } = evaluate(CLEAN);
    expect(summary).toMatchObject({ setups: 1, observations: 2, ready: 2, review: 0, invalid: 0, canConfirm: true });
    const setup = setups[0];
    expect(setup.station).toEqual({ point: 'T1', instrumentHeight: { value: 1.45, unit: 'm', explicit: false }, notes: '' });
    expect(setup.orientation).toEqual({ target: 'T0', direction: { value: 0, unit: 'gon', components: null } });
    expect(setup.observations[0]).toMatchObject({ target: 'A1', hz: { value: 94.5, unit: 'gon' }, vz: { value: 100.25, unit: 'gon' }, distance: { value: 123.456, unit: 'm' }, prismHeight: { value: 1.5, unit: 'm' } });
    expect(notebook.setups[0].observations[0].status).toBe('ok');
  });

  it('an implicit (assumed meters) unit is NOT flagged as a review issue - it is the documented, expected default', () => {
    const { notebook, summary, setups } = evaluate(CLEAN);
    expect(issuesOf(notebook, 0, 0, 'distance')).toEqual([]);
    expect(notebook.setups[0].station.instrumentHeight.validation.issues).toEqual([]);
    expect(notebook.setups[0].station.instrumentHeight.validation.status).toBe('ok');
    expect(setups[0].station.instrumentHeight.explicit).toBe(false); // still traceable on the value itself
    expect(summary.canConfirm).toBe(true);
  });
});

describe('station / target required', () => {
  it('a missing station id blocks confirmation', () => {
    const layout = layoutNotebook(CLEAN);
    const words = stripPrivate(layout.words).filter((w) => w.text !== 'T1');
    const { notebook: raw } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words }, { provider: 'fixture' });
    const { notebook, summary } = evaluateNotebook(raw);
    expect(notebook.setups[0].station.point.validation.issues.map((i) => i.code)).toContain('STATION_REQUIRED');
    expect(summary.canConfirm).toBe(false);
  });

  it('a missing target id on a row blocks confirmation', () => {
    const layout = layoutNotebook(CLEAN);
    const words = stripPrivate(layout.words).filter((w) => w.text !== 'A1');
    const { notebook: raw } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words }, { provider: 'fixture' });
    const { summary } = evaluateNotebook(raw);
    expect(summary.canConfirm).toBe(false);
  });
});

describe('gon / degree / DMS all flow through validation into normalizedValue', () => {
  it('gon', () => {
    const { setups } = evaluate(CLEAN);
    expect(setups[0].observations[0].hz).toEqual({ value: 94.5, unit: 'gon', components: null });
  });
  it('decimal degrees', () => {
    const deg = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '94.5°', vz: '100.2°', distance: '10.000' }] }] };
    const { setups } = evaluate(deg);
    expect(setups[0].observations[0].hz).toMatchObject({ value: 94.5, unit: 'deg' });
  });
  it('DMS', () => {
    const dms = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '94°30\'15"', vz: '100°15\'00"', distance: '10.000' }] }] };
    const { setups } = evaluate(dms);
    expect(setups[0].observations[0].hz.value).toBeCloseTo(94 + 30 / 60 + 15 / 3600, 6);
    expect(setups[0].observations[0].hz.components).toEqual({ deg: 94, min: 30, sec: 15 });
  });
});

describe('ambiguous angle unit blocks confirmation (never guessed)', () => {
  it('a bare Hz number with no unit and no header hint is an error, review required', () => {
    const ambiguous = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '94.5000', vz: '100.2500g', distance: '10.000' }] }] };
    const { notebook, summary } = evaluate(ambiguous);
    expect(issuesOf(notebook, 0, 0, 'hz')).toContain('AMBIGUOUS_ANGLE_UNIT');
    expect(summary.canConfirm).toBe(false);
  });
});

describe('malformed angle is rejected, not normalized', () => {
  it('minutes/seconds out of range block confirmation', () => {
    const bad = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '94°70\'00"', vz: '100.0000g', distance: '10.000' }] }] };
    const { notebook, summary } = evaluate(bad);
    expect(issuesOf(notebook, 0, 0, 'hz')).toContain('MINUTES_OUT_OF_RANGE');
    expect(summary.canConfirm).toBe(false);
  });
});

describe('duplicate observations (same target twice in one setup)', () => {
  it('both occurrences are flagged; confirmation is blocked', () => {
    const dup = { setups: [{ station: 'T1', observations: [
      { target: 'A1', hz: '10.0000g', vz: '100.0000g', distance: '10.000' },
      { target: 'a1', hz: '20.0000g', vz: '100.0000g', distance: '20.000' }, // case-insensitive duplicate
    ] }] };
    const { notebook, summary } = evaluate(dup);
    expect(issuesOf(notebook, 0, 0, 'target')).toContain('DUPLICATE_OBSERVATION');
    expect(issuesOf(notebook, 0, 1, 'target')).toContain('DUPLICATE_OBSERVATION');
    expect(summary.canConfirm).toBe(false);
  });
});

describe('excluded observations', () => {
  it('an excluded row is skipped entirely: no issues, not counted, never blocks', () => {
    const layout = layoutNotebook(CLEAN);
    const { notebook: raw } = reconstructNotebook(page(layout), { provider: 'fixture' });
    // make row 0 unparseable, then exclude it
    raw.setups[0].observations[0].cells[1].rawText = 'garbage';
    raw.setups[0].observations[0].cells[1].candidates[0].text = 'garbage';
    raw.setups[0].observations[0].excluded = true;
    const { notebook, summary } = evaluateNotebook(raw);
    expect(notebook.setups[0].observations[0].status).toBe('excluded');
    expect(summary).toMatchObject({ observations: 1, excluded: 1, canConfirm: true }); // only row 1 counts
  });
});

describe('missing prism height (optional) does not block', () => {
  it('a blank prism height is simply absent, no error', () => {
    const noPrism = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '10.0000g', vz: '100.0000g', distance: '10.000' }] }] };
    const { summary, setups } = evaluate(noPrism);
    expect(summary.canConfirm).toBe(true);
    expect(setups[0].observations[0].prismHeight).toBeNull();
  });
});

describe('missing orientation is a warning, not an error', () => {
  it('a setup with observations but no orientation line still confirms', () => {
    const noOrientation = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '10.0000g', vz: '100.0000g', distance: '10.000' }] }] };
    const { notebook, summary } = evaluate(noOrientation);
    expect(notebook.setups[0].issues.map((i) => i.code)).toContain('MISSING_ORIENTATION');
    expect(notebook.setups[0].issues[0].severity).toBe('warning');
    expect(summary.canConfirm).toBe(true);
  });
});

describe('inconsistent angle units inside one setup', () => {
  it('mixing gon and degree readings in the same Hz column is a warning', () => {
    const mixed = { setups: [{ station: 'T1', observations: [
      { target: 'A1', hz: '10.0000g', vz: '100.0000g', distance: '10.000' },
      { target: 'A2', hz: '20.0°', vz: '100.0000g', distance: '20.000' },
    ] }] };
    const { notebook, summary } = evaluate(mixed);
    expect(notebook.setups[0].issues.map((i) => i.code)).toContain('INCONSISTENT_ANGLE_UNIT');
    expect(summary.canConfirm).toBe(true); // a warning, not blocking
  });
});

describe('suspicious mixed distance units', () => {
  it('mixing explicit m and cm within one setup is flagged', () => {
    const mixed = { setups: [{ station: 'T1', observations: [
      { target: 'A1', hz: '10.0000g', vz: '100.0000g', distance: '10.000 m' },
      { target: 'A2', hz: '20.0000g', vz: '100.0000g', distance: '2000 cm' },
    ] }] };
    const { notebook } = evaluate(mixed);
    expect(notebook.setups[0].issues.map((i) => i.code)).toContain('MIXED_DISTANCE_UNIT');
  });
});

describe('multiple setups: independent validation and summary aggregation', () => {
  it('a bad row in setup 2 does not affect setup 1s readiness, but still blocks the whole confirm', () => {
    const two = { setups: [
      { station: 'T1', observations: [{ target: 'A1', hz: '10.0000g', vz: '100.0000g', distance: '10.000' }] },
      { station: 'T2', observations: [{ target: 'B1', hz: 'garbage', vz: '100.0000g', distance: '5.000' }] },
    ] };
    const { notebook, summary } = evaluate(two);
    expect(notebook.setups[0].observations[0].status).toBe('ok');
    expect(notebook.setups[1].observations[0].status).toBe('error');
    expect(summary).toMatchObject({ setups: 2, observations: 2, ready: 1, invalid: 1, canConfirm: false });
  });
});

describe('manual correction resolves a blocking issue exactly like coordinate tables', () => {
  it('correcting an ambiguous Hz cell (userValue) removes the block', () => {
    const ambiguous = { setups: [{ station: 'T1', observations: [{ target: 'A1', hz: '94.5000', vz: '100.2500g', distance: '10.000' }] }] };
    const raw = build(ambiguous);
    raw.setups[0].observations[0].cells[1].userValue = '94.5000g';
    const { notebook, summary } = evaluateNotebook(raw);
    expect(issuesOf(notebook, 0, 0, 'hz')).toEqual([]);
    expect(fieldReviewState(notebook.setups[0].observations[0].cells[1])).toBe('edited');
    expect(summary.canConfirm).toBe(true);
  });
});

describe('missing required observation column blocks the whole setup', () => {
  it('no distance column at all is MISSING_COLUMN', () => {
    // build a notebook by hand with a distance-less header/row (the fixture always includes S, so mutate directly)
    const raw = build(CLEAN);
    raw.setups[0].observations.forEach((o) => { o.cols = o.cols.filter((c) => c.field !== 'distance'); o.cells.splice(3, 1); });
    const { notebook, summary } = evaluateNotebook(raw);
    expect(notebook.setups[0].issues.map((i) => i.code)).toContain('MISSING_COLUMN');
    expect(summary.canConfirm).toBe(false);
  });
});
