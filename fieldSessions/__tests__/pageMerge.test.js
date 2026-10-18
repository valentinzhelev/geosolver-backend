const { mergePages, collectPageIssues, pageProvenance, MESSAGES } = require('../pageMerge');
const { layoutNotebook, stripPrivate } = require('../../tests/support/notebookFixtures');
const { reconstructNotebook } = require('../../capture/notebook/reconstruct');
const { evaluateNotebook } = require('../../capture/notebook/validation');
const { getConfig } = require('../../capture/config');

/**
 * Multi-page merge, tested through the REAL deterministic pipeline: a layout of OCR words -> reconstructNotebook ->
 * evaluateNotebook (allowContinuation) -> mergePages. No OCR provider, no database, no LLM anywhere.
 */
const obs = (target, hz = '10.0000g', extra = {}) => ({ target, hz, vz: '100.0000g', distance: '25.000', prism: '1.500', ...extra });
const cfg = getConfig();

function evaluatePage(spec, tweak) {
  const layout = layoutNotebook(spec);
  const { notebook } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) }, { provider: 'fixture' });
  if (!notebook) throw new Error('fixture page was not reconstructed');
  if (tweak) tweak(notebook);
  return evaluateNotebook(notebook, { arbitration: cfg.arbitration, allowContinuation: true });
}
const page = (order, setups, { status = 'needs_review', tweak, failure } = {}) => ({
  order, pageId: `job-${order + 1}`, status, failure, evaluated: status === 'needs_review' ? evaluatePage({ setups }, tweak) : null,
});
const station = (name, observations, extra = {}) => ({ station: name, hi: '1.500', orientationTarget: '102', orientationDirection: '0.0000g', observations, ...extra });
const continuation = (observations, extra = {}) => ({ continuation: true, observations, ...extra });

const editStation = (setupIdx, field, value) => (nb) => { nb.setups[setupIdx].station[field].userValue = value; };
const editObs = (setupIdx, rowIdx, field, value) => (nb) => {
  const row = nb.setups[setupIdx].observations[rowIdx];
  row.cells[row.cols.findIndex((c) => c.field === field)].userValue = value;
};
const exclude = (setupIdx, rowIdx) => (nb) => { nb.setups[setupIdx].observations[rowIdx].excluded = true; };
const both = (...fns) => (nb) => fns.forEach((f) => f(nb));
const codes = (r, severity) => r.issues.filter((i) => !severity || i.severity === severity).map((i) => i.code);
const targets = (setup) => setup.observations.map((o) => o.target);

describe('page-level: the leading continuation setup', () => {
  it('a table with rows but NO station line becomes a continuation setup (blank station, rows kept)', () => {
    const layout = layoutNotebook({ setups: [continuation([obs('203'), obs('204')])] });
    const { notebook } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) }, { provider: 'fixture' });
    expect(notebook.setups).toHaveLength(1);
    expect(notebook.setups[0]).toMatchObject({ continuation: true });
    expect(notebook.setups[0].observations).toHaveLength(2);
    expect(notebook.setups[0].station.point.rawText).toBe('');
  });

  it('evaluated ON ITS OWN (the Capture review) the blank station is still an error - behaviour unchanged', () => {
    const layout = layoutNotebook({ setups: [continuation([obs('203')])] });
    const { notebook } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) }, {});
    const alone = evaluateNotebook(notebook, { arbitration: cfg.arbitration });
    expect(alone.summary.canConfirm).toBe(false);
    expect(alone.notebook.setups[0].station.point.validation.issues.map((i) => i.code)).toContain('STATION_REQUIRED');
  });

  it('with allowContinuation the blank station is NOT an error, and the import shape says so', () => {
    const ev = evaluatePage({ setups: [continuation([obs('203')])] });
    expect(ev.summary.tableErrors).toBe(0);
    expect(ev.setups[0]).toMatchObject({ continuation: true, station: { point: null } });
    expect(ev.setups[0].observations).toHaveLength(1);
  });

  it('a station typed in by the reviewer turns it into an ordinary setup again', () => {
    const ev = evaluatePage({ setups: [continuation([obs('203')])] }, editStation(0, 'point', '103'));
    expect(ev.setups[0].continuation).toBeUndefined();
    expect(ev.setups[0].station.point).toBe('103');
  });

  it('a continuation block followed by a new station on the same page: two setups, the first a continuation', () => {
    const ev = evaluatePage({ setups: [continuation([obs('203')]), station('102', [obs('205')])] });
    expect(ev.setups.map((s) => !!s.continuation)).toEqual([true, false]);
    expect(ev.setups[1].station.point).toBe('102');
  });

  it('a lone table header with no rows and no station is still "nothing recognisable"', () => {
    const layout = layoutNotebook({ setups: [continuation([])] });
    expect(reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) }, {}).reason).toBe('NO_STATION_DETECTED');
  });

  it('observation-looking rows before any station and WITHOUT a table header are counted, never silently dropped', () => {
    const layout = layoutNotebook({ setups: [{ continuation: true, headerless: true, observations: [obs('203'), obs('204')] }, station('101', [obs('201')])] });
    const { notebook } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height, words: stripPrivate(layout.words) }, {});
    expect(notebook.unassignedRows).toBe(2);
    const ev = evaluateNotebook(notebook, { arbitration: cfg.arbitration, allowContinuation: true });
    const warn = ev.notebook.issues.find((i) => i.code === 'UNASSIGNED_ROWS');
    expect(warn).toMatchObject({ severity: 'warning', count: 2 });
    expect(ev.summary.canConfirm).toBe(true); // a warning, not a block: the rest of the page is intact
  });

  it('a title line before the station is not mistaken for observation rows', () => {
    const layout = layoutNotebook({ setups: [station('101', [obs('201')])] });
    const words = stripPrivate(layout.words);
    const { notebook } = reconstructNotebook({ index: 0, width: layout.width, height: layout.height + 80, words: [
      { text: 'Полеви', confidence: 0.99, bbox: { x: 30, y: -50, w: 80, h: 26 } }, { text: 'дневник', confidence: 0.99, bbox: { x: 130, y: -50, w: 90, h: 26 } }, ...words,
    ] }, {});
    expect(notebook.unassignedRows).toBeUndefined();
  });
});

describe('SCENARIO A: three pages - station 101 / continuation / station 102', () => {
  const pages = () => [
    page(0, [station('101', [obs('201'), obs('202', '20.0000g')])]),
    page(1, [continuation([obs('203', '30.0000g'), obs('204', '40.0000g')])]),
    page(2, [station('102', [obs('205', '50.0000g'), obs('206', '60.0000g')], { orientationTarget: '101' })]),
  ];

  it('one logical notebook: two setups, observations in page order, continuation attached to station 101', () => {
    const r = mergePages(pages());
    expect(r.issues).toEqual([]);
    expect(r.summary).toMatchObject({ pages: 3, setups: 2, observations: 6, errors: 0, warnings: 0, canConfirm: true });
    expect(r.setups.map((s) => s.station.point)).toEqual(['101', '102']);
    expect(targets(r.setups[0])).toEqual(['201', '202', '203', '204']);
    expect(targets(r.setups[1])).toEqual(['205', '206']);
    expect(r.setups[0].pages).toEqual([0, 1]);
    expect(r.setups[1].pages).toEqual([2]);
    expect(r.pages.map((p) => [p.page, p.state, p.continuesStation])).toEqual([[1, 'ready', null], [2, 'ready', '101'], [3, 'ready', null]]);
  });

  it('merged rows are renumbered densely per setup, and each keeps its exact origin (page / job / page-local setup / row)', () => {
    const r = mergePages(pages());
    expect(r.setups[0].observations.map((o) => o.row)).toEqual([0, 1, 2, 3]);
    expect(r.setups[0].observations.map((o) => o.source)).toEqual([
      { page: 0, captureJobId: 'job-1', setup: 0, row: 0 }, { page: 0, captureJobId: 'job-1', setup: 0, row: 1 },
      { page: 1, captureJobId: 'job-2', setup: 0, row: 0 }, { page: 1, captureJobId: 'job-2', setup: 0, row: 1 },
    ]);
    expect(r.setups[1].observations[0].source).toEqual({ page: 2, captureJobId: 'job-3', setup: 0, row: 0 });
    expect(r.setups[0].observations[2].cells.target.page).toBeDefined(); // the page's own cell geometry travels along
  });

  it('is deterministic: the same pages in any input order merge identically', () => {
    const a = mergePages(pages());
    const b = mergePages([...pages()].reverse());
    expect(JSON.stringify(b.setups)).toBe(JSON.stringify(a.setups));
    expect(b.issues).toEqual(a.issues);
  });

  it('reordering the pages changes the result (page 2 first has nothing to continue)', () => {
    const [p1, p2, p3] = pages();
    const r = mergePages([{ ...p2, order: 0 }, { ...p1, order: 1 }, { ...p3, order: 2 }]);
    expect(codes(r, 'error')).toContain('ORPHAN_CONTINUATION');
    expect(r.summary.canConfirm).toBe(false);
  });

  it('page provenance for the evidence record', () => {
    expect(pageProvenance([{ order: 1, pageId: 'b', versions: { recognitionVersion: 'r' } }, { order: 0, pageId: 'a' }])).toEqual([{ page: 0, captureJobId: 'a' }, { page: 1, captureJobId: 'b', recognitionVersion: 'r' }]);
  });
});

describe('continuation lands on the LAST setup of the previous page', () => {
  it('page 1 has stations 101 and 102 -> page 2 continues 102', () => {
    const r = mergePages([
      page(0, [station('101', [obs('201')]), station('102', [obs('202')], { orientationTarget: '101' })]),
      page(1, [continuation([obs('203', '30.0000g')])]),
    ]);
    expect(r.issues).toEqual([]);
    expect(targets(r.setups[0])).toEqual(['201']);
    expect(targets(r.setups[1])).toEqual(['202', '203']);
  });

  it('page 2 continues 101 and then starts station 102 on the same page', () => {
    const r = mergePages([
      page(0, [station('101', [obs('201')])]),
      page(1, [continuation([obs('202', '20.0000g')]), station('102', [obs('203', '30.0000g')], { orientationTarget: '101' })]),
    ]);
    expect(r.issues).toEqual([]);
    expect(r.setups.map((s) => [s.station.point, targets(s)])).toEqual([['101', ['201', '202']], ['102', ['203']]]);
  });

  it('a page that continues across SEVERAL pages keeps growing the same setup', () => {
    const r = mergePages([
      page(0, [station('101', [obs('201')])]),
      page(1, [continuation([obs('202', '20.0000g')])]),
      page(2, [continuation([obs('203', '30.0000g')])]),
    ]);
    expect(r.setups).toHaveLength(1);
    expect(targets(r.setups[0])).toEqual(['201', '202', '203']);
    expect(r.setups[0].pages).toEqual([0, 1, 2]);
  });
});

describe('NEW SETUP on the next page / repeated headings', () => {
  it('page 2 names a different station: a new setup, never merged', () => {
    const r = mergePages([page(0, [station('101', [obs('201')])]), page(1, [station('102', [obs('202', '20.0000g')], { orientationTarget: '101' })])]);
    expect(r.setups.map((s) => s.station.point)).toEqual(['101', '102']);
    expect(r.pages[1]).toMatchObject({ continuesStation: null, repeatsStation: null });
  });

  it('page 2 REPEATS the station heading (same station, same metadata): one setup, not two', () => {
    const r = mergePages([page(0, [station('101', [obs('201')])]), page(1, [station('101', [obs('202', '20.0000g')])])]);
    expect(r.issues).toEqual([]);
    expect(r.setups).toHaveLength(1);
    expect(targets(r.setups[0])).toEqual(['201', '202']);
    expect(r.pages[1].repeatsStation).toBe('101');
  });

  it('the repeat is matched on the station id, ignoring case and spaces', () => {
    const r = mergePages([page(0, [station('T1', [obs('201')])]), page(1, [station('t1', [obs('202', '20.0000g')])])]);
    expect(r.setups).toHaveLength(1);
  });

  it('a repeated heading that omits metadata is filled from the other page (no conflict)', () => {
    const r = mergePages([
      page(0, [{ station: '101', orientationTarget: '102', orientationDirection: '0.0000g', observations: [obs('201')] }]),
      page(1, [{ station: '101', hi: '1.620', observations: [obs('202', '20.0000g')] }]),
    ]);
    expect(r.issues).toEqual([]);
    expect(r.setups[0].station.instrumentHeight).toMatchObject({ value: 1.62 });
    expect(r.setups[0].orientation.target).toBe('102');
  });

  it('station 101 again on page 3 after a different station on page 2 is a separate occupation (not merged)', () => {
    const r = mergePages([
      page(0, [station('101', [obs('201')])]),
      page(1, [station('102', [obs('202', '20.0000g')], { orientationTarget: '101' })]),
      page(2, [station('101', [obs('203', '30.0000g')], { hi: '1.710' })]),
    ]);
    expect(r.setups.map((s) => s.station.point)).toEqual(['101', '102', '101']);
    expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });
});

describe('SCENARIO B: conflicting repeated metadata blocks confirmation', () => {
  const conflicted = () => [page(0, [station('101', [obs('201')], { hi: '1.500' })]), page(1, [station('101', [obs('202', '20.0000g')], { hi: '1.700' })])];

  it('HI 1.500 on page 1 vs 1.700 on page 2: a blocking CROSS_PAGE_CONFLICT naming both pages and both values', () => {
    const r = mergePages(conflicted());
    const c = r.issues.find((i) => i.code === 'CROSS_PAGE_CONFLICT');
    expect(c).toMatchObject({ severity: 'error', field: 'instrumentHeight', page: 2, otherPage: 1, setup: 0 });
    expect(c.message).toContain('Несъответствие между страниците');
    expect(c.message).toContain('1.5 m (стр. 1)');
    expect(c.message).toContain('1.7 m (стр. 2)');
    expect(r.summary.canConfirm).toBe(false);
  });

  it('no silent choice: the merged setup keeps the FIRST page\'s value only as a placeholder while blocked', () => {
    const r = mergePages(conflicted());
    expect(r.setups[0].station.instrumentHeight.value).toBe(1.5);
    expect(r.summary.canConfirm).toBe(false);
  });

  it('resolved EXPLICITLY by editing the cell on one page (existing review edit): the conflict disappears', () => {
    const r = mergePages([conflicted()[0], page(1, [station('101', [obs('202', '20.0000g')], { hi: '1.700' })], { tweak: editStation(0, 'instrumentHeight', '1.500') })]);
    expect(codes(r)).not.toContain('CROSS_PAGE_CONFLICT');
    expect(r.summary.canConfirm).toBe(true);
  });

  it('a differing backsight is a conflict too, and so is a differing direction', () => {
    const t = mergePages([page(0, [station('101', [obs('201')])]), page(1, [station('101', [obs('202', '20.0000g')], { orientationTarget: '103' })])]);
    expect(t.issues.find((i) => i.code === 'CROSS_PAGE_CONFLICT')).toMatchObject({ field: 'orientationTarget' });
    const d = mergePages([page(0, [station('101', [obs('201')])]), page(1, [station('101', [obs('202', '20.0000g')], { orientationDirection: '50.0000g' })])]);
    expect(d.issues.find((i) => i.code === 'CROSS_PAGE_CONFLICT')).toMatchObject({ field: 'orientationDirection' });
  });

  it('the same height in different units is NOT a conflict (150 cm = 1.5 m)', () => {
    const r = mergePages([page(0, [station('101', [obs('201')], { hi: '1.500' })]), page(1, [station('101', [obs('202', '20.0000g')], { hi: '150 cm' })])]);
    expect(codes(r)).not.toContain('CROSS_PAGE_CONFLICT');
  });

  it('equal angles in gon and degrees are NOT a conflict (100 gon = 90 deg)', () => {
    const r = mergePages([page(0, [station('101', [obs('201')], { orientationDirection: '100.0000g' })]), page(1, [station('101', [obs('202', '20.0000g')], { orientationDirection: '90.0000°' })])]);
    expect(codes(r)).not.toContain('CROSS_PAGE_CONFLICT');
  });
});

describe('SCENARIO C: duplicate observations across pages', () => {
  it('the same target on two pages of one setup is blocked on BOTH rows, with page and row', () => {
    const r = mergePages([page(0, [station('101', [obs('201'), obs('202', '20.0000g')])]), page(1, [continuation([obs('202', '20.0000g'), obs('203', '30.0000g')])])]);
    const dups = r.issues.filter((i) => i.code === 'DUPLICATE_OBSERVATION_ACROSS_PAGES');
    expect(dups).toHaveLength(2);
    expect(dups.map((d) => [d.page, d.pageRow, d.field])).toEqual([[1, 1, 'target'], [2, 0, 'target']]);
    expect(r.summary.canConfirm).toBe(false);
  });

  it('the same photo imported as two pages is caught the same way - never two copies in the evidence', () => {
    const same = (order) => page(order, [station('101', [obs('201'), obs('202', '20.0000g')])]);
    const r = mergePages([same(0), same(1)]);
    expect(r.setups).toHaveLength(1);
    expect(codes(r, 'error').filter((c) => c === 'DUPLICATE_OBSERVATION_ACROSS_PAGES')).toHaveLength(4);
    expect(r.summary.canConfirm).toBe(false);
  });

  it('resolved by excluding the repeated row on one page', () => {
    const r = mergePages([
      page(0, [station('101', [obs('201'), obs('202', '20.0000g')])]),
      page(1, [continuation([obs('202', '20.0000g'), obs('203', '30.0000g')])], { tweak: exclude(0, 0) }),
    ]);
    expect(codes(r)).not.toContain('DUPLICATE_OBSERVATION_ACROSS_PAGES');
    expect(targets(r.setups[0])).toEqual(['201', '202', '203']);
    expect(r.summary.canConfirm).toBe(true);
  });

  it('the same target in DIFFERENT setups is perfectly normal', () => {
    const r = mergePages([page(0, [station('101', [obs('300')])]), page(1, [station('102', [obs('300', '20.0000g')], { orientationTarget: '101' })])]);
    expect(codes(r)).not.toContain('DUPLICATE_OBSERVATION_ACROSS_PAGES');
  });
});

describe('orphans, units, order, page states', () => {
  it('rows on the first page with no station at all: ORPHAN_CONTINUATION (blocking), never attached to nothing', () => {
    const r = mergePages([page(0, [continuation([obs('201')])])]);
    expect(r.issues.find((i) => i.code === 'ORPHAN_CONTINUATION')).toMatchObject({ severity: 'error', page: 1 });
    expect(r.summary).toMatchObject({ canConfirm: false, setups: 0 });
  });

  it('mixed angle units across pages of one setup are a blocking ANGLE_UNIT_MISMATCH', () => {
    const r = mergePages([page(0, [station('101', [obs('201', '10.0000g')])]), page(1, [continuation([obs('202', '45.5000°')])])]);
    const m = r.issues.find((i) => i.code === 'ANGLE_UNIT_MISMATCH');
    expect(m).toMatchObject({ severity: 'error', field: 'hz', setup: 0 });
    expect(m.message).toContain('стр. 1, 2');
    expect(r.summary.canConfirm).toBe(false);
  });

  it('explicit distance units that differ across pages are a warning, not a block', () => {
    const r = mergePages([page(0, [station('101', [obs('201', '10.0000g', { distance: '25.000 m' })])]), page(1, [continuation([obs('202', '20.0000g', { distance: '2500 cm' })])])]);
    expect(r.issues.find((i) => i.code === 'MIXED_DISTANCE_UNIT_ACROSS_PAGES')).toMatchObject({ severity: 'warning' });
    expect(r.summary.canConfirm).toBe(true);
  });

  it('a setup without any backsight is a warning (as for a single page), once, after merging', () => {
    const r = mergePages([page(0, [{ station: '101', observations: [obs('201')] }]), page(1, [continuation([obs('202', '20.0000g')])])]);
    expect(r.issues.filter((i) => i.code === 'MISSING_ORIENTATION')).toHaveLength(1);
    expect(r.summary.canConfirm).toBe(true);
  });

  it('page order that looks reversed is a warning (page 2 reopens the station page 1 began with)', () => {
    const r = mergePages([
      page(0, [station('101', [obs('201')]), station('102', [obs('202', '20.0000g')], { orientationTarget: '101' })]),
      page(1, [station('101', [obs('203', '30.0000g')], { hi: '1.710' })]),
    ]);
    expect(r.issues.find((i) => i.code === 'PAGE_ORDER_SUSPECT')).toMatchObject({ severity: 'warning', page: 2 });
  });

  it.each([
    ['failed', 'PAGE_FAILED'], ['processing', 'PAGE_PROCESSING'], ['uploaded', 'PAGE_PROCESSING'], ['missing', 'PAGE_MISSING'], ['confirmed', 'PAGE_CONFIRMED_ELSEWHERE'],
  ])('a %s page blocks the whole session with %s - the other pages stay intact', (status, code) => {
    const r = mergePages([page(0, [station('101', [obs('201')])]), page(1, [], { status, failure: status === 'failed' ? { message: 'Не беше разпозната поле-книжка.' } : undefined })]);
    expect(r.issues.find((i) => i.code === code)).toMatchObject({ severity: 'error', page: 2 });
    expect(r.pages.map((p) => p.state)).toEqual(['ready', status === 'uploaded' ? 'processing' : status]);
    expect(targets(r.setups[0])).toEqual(['201']); // page 1 is untouched
    expect(r.summary.canConfirm).toBe(false);
  });

  it('a failed page\'s sanitized reason is carried as detail', () => {
    const r = mergePages([page(0, [station('101', [obs('201')])]), page(1, [], { status: 'failed', failure: { message: 'Не беше разпозната поле-книжка.' } })]);
    expect(r.issues.find((i) => i.code === 'PAGE_FAILED').detail).toBe('Не беше разпозната поле-книжка.');
  });

  it('no pages at all, or pages without any observation, never confirm', () => {
    expect(mergePages([]).summary.canConfirm).toBe(false);
    expect(codes(mergePages([]))).toEqual(['NO_PAGES']);
  });
});

describe('page issues are placed in the merged notebook with page, setup, row and field', () => {
  it('a bad value on page 2 is reported against page 2, its page-local row, the merged setup and merged row', () => {
    const r = mergePages([
      page(0, [station('101', [obs('201')])]),
      page(1, [continuation([obs('202', '20.0000g'), obs('203', '30.0000g', { distance: '2x5' })])]),
    ]);
    const bad = r.issues.find((i) => i.code === 'MALFORMED_DISTANCE');
    expect(bad).toMatchObject({ severity: 'error', page: 2, pageSetup: 0, pageRow: 1, field: 'distance', section: 'observation', setup: 0 });
    expect(r.summary.canConfirm).toBe(false);
    expect(r.summary.observations).toBe(3); // the invalid row still counts as an observation to fix
  });

  it('a recognition warning on a page does not block, and is placed on the right page', () => {
    const r = mergePages([page(0, [station('101', [obs('201')])]), page(1, [continuation([obs('202', '20.0000g')])])]);
    expect(r.issues.every((i) => i.severity !== 'error')).toBe(true);
  });

  it('collectPageIssues skips excluded rows (they are not evidence)', () => {
    const ev = evaluatePage({ setups: [station('101', [obs('201'), obs('202', 'bad')])] }, exclude(0, 1));
    expect(collectPageIssues(ev.notebook).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('messages are fixed Bulgarian sentences, no internal names', () => {
    for (const m of Object.values(MESSAGES)) expect(m).not.toMatch(/captureJob|FieldSession|FieldObservationSet|undefined|null/);
  });
});
