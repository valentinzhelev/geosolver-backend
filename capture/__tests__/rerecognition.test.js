const sharp = require('sharp');
const { needsRerecognition, cropRect, buildVariants, rerecognizeUncertainCells } = require('../rerecognition');
const { getConfig } = require('../config');

const cfg = getConfig().rerecognition;

const cell = (over = {}) => ({
  col: 0, rawText: '4700000', confidence: 0.97, bbox: { x: 100, y: 50, w: 80, h: 26 },
  symbolConfidence: { min: null, suspicious: [] }, candidates: [{ text: '4700000', source: 'primary', recognitionPass: 0, confidence: 0.97, symbolConfidence: { min: null, suspicious: [] } }],
  ...over,
});

describe('needsRerecognition: only spend the budget on cells that look uncertain', () => {
  const t = (semantic, over) => needsRerecognition(cell(over), semantic, { confidenceThreshold: 0.85 });
  it('a clean, high-confidence numeric/identifier cell needs nothing', () => {
    expect(t('x')).toBe(false);
    expect(t('point')).toBe(false);
  });
  it('an untracked semantic (notes) is never re-recognized, however low its confidence', () => {
    expect(t('notes', { confidence: 0.1 })).toBe(false);
  });
  it('low confidence triggers it', () => {
    expect(t('x', { confidence: 0.5 })).toBe(true);
  });
  it('a missing confidence triggers it', () => {
    expect(t('h', { confidence: null })).toBe(true);
  });
  it('a suspicious symbol triggers it even at high word confidence', () => {
    expect(t('y', { confidence: 0.99, symbolConfidence: { min: 0.2, suspicious: [{ word: 0, index: 0, text: '4', confidence: 0.2 }] } })).toBe(true);
  });
  it('an empty cell is never re-recognized (nothing to re-read)', () => {
    expect(t('x', { rawText: '' })).toBe(false);
  });
});

describe('cropRect: padded and clamped to the image bounds', () => {
  const bounds = { width: 500, height: 300 };
  it('adds padding on every side', () => {
    expect(cropRect({ x: 100, y: 50, w: 80, h: 26 }, 10, bounds)).toEqual({ x: 90, y: 40, w: 100, h: 46 });
  });
  it('clamps to the image bounds near an edge', () => {
    expect(cropRect({ x: 0, y: 0, w: 20, h: 20 }, 10, bounds)).toEqual({ x: 0, y: 0, w: 30, h: 30 });
    expect(cropRect({ x: 490, y: 290, w: 10, h: 10 }, 10, bounds)).toEqual({ x: 480, y: 280, w: 20, h: 20 });
  });
});

describe('buildVariants: bounded, real image crops', () => {
  const makeImage = async (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
    .composite([{ input: { create: { width: 20, height: 10, channels: 3, background: '#000000' } }, left: 5, top: 5 }])
    .png().toBuffer();

  it('produces original / enhanced / threshold variants for an ordinarily-sized crop, never more than maxPassesPerCell', async () => {
    const image = await makeImage(400, 200);
    const variants = await buildVariants(image, { x: 50, y: 50, w: 200, h: 100 }, cfg);
    expect(variants.map((v) => v.kind)).toEqual(['original', 'enhanced', 'threshold']);
    expect(variants.length).toBeLessThanOrEqual(cfg.maxPassesPerCell);
    for (const v of variants) {
      const meta = await sharp(v.buffer).metadata();
      expect(meta.width).toBe(200);
      expect(meta.height).toBe(100);
    }
  });

  it('adds an enlarged variant for a small crop, still bounded by maxPassesPerCell', async () => {
    const image = await makeImage(400, 200);
    const variants = await buildVariants(image, { x: 10, y: 10, w: 15, h: 15 }, { ...cfg, minCropSide: 20, maxPassesPerCell: 4 });
    expect(variants.map((v) => v.kind)).toContain('enlarged');
    expect(variants.length).toBeLessThanOrEqual(4);
  });

  it('respects a smaller maxPassesPerCell cap', async () => {
    const image = await makeImage(400, 200);
    const variants = await buildVariants(image, { x: 50, y: 50, w: 200, h: 100 }, { ...cfg, maxPassesPerCell: 1 });
    expect(variants).toHaveLength(1);
    expect(variants[0].kind).toBe('original');
  });
});

describe('rerecognizeUncertainCells: bounded orchestration with a fake provider', () => {
  const fakeProvider = (impl) => ({ name: 'fake', version: '1', recognize: jest.fn(impl) });
  const reviewBuffer = async () => sharp({ create: { width: 600, height: 400, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const table = (cells) => ({ columns: [{ index: 0, semantic: 'x' }], rows: [{ index: 0, excluded: false, cells }] });

  it('re-recognizes only uncertain cells, appending candidates from each pass', async () => {
    const uncertain = cell({ confidence: 0.3 });
    const clean = cell({ confidence: 0.99, bbox: { x: 300, y: 50, w: 80, h: 26 } });
    const t = table([uncertain, clean]);
    const provider = fakeProvider(async () => ({ provider: { name: 'fake', version: '1' }, page: { index: 0, width: 10, height: 10, words: [{ text: '4700000', confidence: 0.8, bbox: { x: 0, y: 0, w: 5, h: 5 } }] } }));
    const buf = await reviewBuffer();
    const stats = await rerecognizeUncertainCells(t, buf, { width: 600, height: 400 }, provider, cfg);
    expect(stats.cellsProcessed).toBe(1); // only the uncertain one
    expect(stats.passesRun).toBe(3); // 3 bounded variants
    expect(uncertain.candidates).toHaveLength(1 + 3);
    expect(clean.candidates).toHaveLength(1); // untouched
    uncertain.candidates.slice(1).forEach((c, i) => expect(c).toMatchObject({ source: 're-recognition', recognitionPass: i + 1, text: '4700000' }));
  });

  it('is bounded by maxCellsPerJob across the whole table', async () => {
    const cells = Array.from({ length: 5 }, (_, i) => cell({ confidence: 0.2, bbox: { x: i * 30, y: 50, w: 20, h: 26 } }));
    const t = table(cells);
    const provider = fakeProvider(async () => ({ provider: { name: 'fake', version: '1' }, page: { index: 0, width: 5, height: 5, words: [] } }));
    const buf = await reviewBuffer();
    const stats = await rerecognizeUncertainCells(t, buf, { width: 600, height: 400 }, provider, { ...cfg, maxCellsPerJob: 2 });
    expect(stats.cellsProcessed).toBe(2);
  });

  it('excluded rows are never re-recognized', async () => {
    const t = { columns: [{ index: 0, semantic: 'x' }], rows: [{ index: 0, excluded: true, cells: [cell({ confidence: 0.1 })] }] };
    const provider = fakeProvider(async () => ({ provider: { name: 'fake', version: '1' }, page: { index: 0, width: 1, height: 1, words: [] } }));
    const buf = await reviewBuffer();
    const stats = await rerecognizeUncertainCells(t, buf, { width: 600, height: 400 }, provider, cfg);
    expect(stats.cellsProcessed).toBe(0);
    expect(provider.recognize).not.toHaveBeenCalled();
  });

  it('a sanitized provider failure on one crop pass does not fail the job: remaining candidates are kept', async () => {
    const { CaptureError } = require('../errors');
    let n = 0;
    const provider = fakeProvider(async () => {
      n += 1;
      if (n === 2) throw new CaptureError('PROVIDER_UNAVAILABLE');
      return { provider: { name: 'fake', version: '1' }, page: { index: 0, width: 1, height: 1, words: [{ text: 'X', confidence: 0.9, bbox: { x: 0, y: 0, w: 1, h: 1 } }] } };
    });
    const t = table([cell({ confidence: 0.2 })]);
    const buf = await reviewBuffer();
    const stats = await rerecognizeUncertainCells(t, buf, { width: 600, height: 400 }, provider, cfg);
    expect(stats.passesRun).toBe(2); // 3 attempted, 1 failed and was skipped
    expect(t.rows[0].cells[0].candidates).toHaveLength(1 + 2);
  });

  it('disabled via config: does nothing, calls the provider zero times', async () => {
    const provider = fakeProvider(async () => { throw new Error('should not be called'); });
    const t = table([cell({ confidence: 0.1 })]);
    const buf = await reviewBuffer();
    const stats = await rerecognizeUncertainCells(t, buf, { width: 600, height: 400 }, provider, { ...cfg, enabled: false });
    expect(stats).toEqual({ cellsProcessed: 0, passesRun: 0 });
    expect(provider.recognize).not.toHaveBeenCalled();
  });
});
