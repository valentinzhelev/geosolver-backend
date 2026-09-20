const sharp = require('sharp');
const { inspectImage, preprocessImage, estimateSkewDegrees, reviewToOriginal } = require('../preprocess');
const { getConfig } = require('../config');
const { CaptureError } = require('../errors');
const { normalizeVisionResponse, createGoogleVisionProvider } = require('../providers/googleVision');
const { getProvider, setProviderForTests } = require('../providers');
const { createMongoStorage } = require('../storage');
const { layoutTable, renderTableImage, toVisionResponse, stripPrivate } = require('../../tests/support/captureFixtures');

jest.setTimeout(60000);

const cfg = (over = {}) => ({ ...getConfig(), ...over });
const HEADERS = ['Point', 'X', 'Y', 'H'];
const ROWS = [['P1', '4700000.25', '500000.50', '100.1'], ['P2', '4700100.50', '500050.75', '101.5'], ['P3', '4700200.00', '500100.25', '99.9'], ['P4', '4700300.75', '500150.00', '98.7']];
const tableImage = (opts) => renderTableImage(layoutTable({ headers: HEADERS, rows: ROWS }), opts);

// centroid of dark pixels (a lone marker) in an image buffer
async function centroid(buffer) {
  const { data, info } = await sharp(buffer).grayscale().raw().toBuffer({ resolveWithObject: true });
  let sx = 0; let sy = 0; let n = 0;
  for (let y = 0; y < info.height; y += 1) for (let x = 0; x < info.width; x += 1) if (data[y * info.width + x] < 100) { sx += x; sy += y; n += 1; }
  return { x: sx / n, y: sy / n };
}
const marker = (w, h, mx, my) => sharp({ create: { width: w, height: h, channels: 3, background: '#ffffff' } })
  .composite([{ input: { create: { width: 20, height: 20, channels: 3, background: '#000000' } }, left: mx, top: my }]);

describe('image validation (format from content, size, pixel bomb)', () => {
  it.each(['jpeg', 'png', 'webp'])('accepts %s', async (format) => {
    const buf = await sharp(await tableImage())[format]().toBuffer();
    const meta = await inspectImage(buf, cfg());
    expect(meta.format).toBe(format);
    expect(meta.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['gif', (s) => s.gif()],
    ['tiff', (s) => s.tiff()],
  ])('rejects %s even if the filename/declared type claimed otherwise (415)', async (_, conv) => {
    const buf = await conv(sharp(await tableImage())).toBuffer();
    await expect(inspectImage(buf, cfg())).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 });
  });

  it('rejects SVG and PDF-like bytes and random garbage (malformed file)', async () => {
    await expect(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"></svg>'), cfg())).rejects.toBeInstanceOf(CaptureError);
    await expect(inspectImage(Buffer.from('%PDF-1.4 fake'), cfg())).rejects.toMatchObject({ code: 'INVALID_IMAGE', status: 400 });
    await expect(inspectImage(Buffer.from('not an image at all'), cfg())).rejects.toMatchObject({ code: 'INVALID_IMAGE' });
    await expect(inspectImage(Buffer.alloc(0), cfg())).rejects.toMatchObject({ code: 'NO_FILE' });
  });

  it('rejects an oversized file before decoding it (413)', async () => {
    const buf = await sharp(await tableImage()).png().toBuffer();
    await expect(inspectImage(buf, cfg({ maxBytes: 1000 }))).rejects.toMatchObject({ code: 'IMAGE_TOO_LARGE', status: 413 });
  });

  it('pixel bomb: a tiny file with huge dimensions is rejected from its header, never decoded (413)', async () => {
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(500 * 1024); // small on disk ...
    await expect(inspectImage(bomb, cfg({ maxPixels: 10 * 1000 * 1000 }))).rejects.toMatchObject({ code: 'IMAGE_TOO_MANY_PIXELS', status: 413 }); // ... 36 MP decoded
    await expect(preprocessImage(bomb, cfg({ maxPixels: 10 * 1000 * 1000 }))).rejects.toMatchObject({ code: 'IMAGE_TOO_MANY_PIXELS' });
  });

  it('rejects an image that is too small to read', async () => {
    const tiny = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#fff' } }).png().toBuffer();
    await expect(inspectImage(tiny, cfg())).rejects.toMatchObject({ code: 'IMAGE_TOO_SMALL' });
  });

  it('error messages are fixed Bulgarian text (nothing from the file or the library)', async () => {
    const e = await inspectImage(Buffer.from('secret-token-123 not an image'), cfg()).catch((x) => x);
    expect(e.message).toBe('Файлът не е валидно изображение.');
    expect(JSON.stringify(e)).not.toContain('secret-token');
  });
});

describe('preprocessing (orientation, scaling, contrast variant, quality, deskew)', () => {
  it('an upright image is not rotated; the OCR image has the same geometry as the review image', async () => {
    const buf = await tableImage();
    const out = await preprocessImage(buf, cfg());
    expect(out.transform.deskewDegrees).toBe(0);
    expect(out.transform.exifOrientation).toBe(1);
    const r = await sharp(out.review.buffer).metadata();
    const o = await sharp(out.ocr.buffer).metadata();
    expect([r.width, r.height]).toEqual([out.review.width, out.review.height]);
    expect([o.width, o.height]).toEqual([out.review.width, out.review.height]);
    expect(o.channels).toBe(1); // grayscale contrast variant
    expect(out.thumbnail.width).toBeLessThanOrEqual(cfg().thumbnailSide);
  });

  it('EXIF orientation 6 is applied (dimensions swap) and recorded in the transform', async () => {
    const buf = await sharp(await marker(800, 500, 100, 50).png().toBuffer()).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const meta = await inspectImage(buf, cfg());
    expect(meta.orientation).toBe(6);
    const out = await preprocessImage(buf, cfg(), meta);
    expect([out.review.width, out.review.height]).toEqual([500, 800]);
    expect(out.transform).toMatchObject({ exifOrientation: 6, original: { width: 800, height: 500 } });
  });

  it('large images are downscaled uniformly to the review size; the scale is recorded', async () => {
    const big = await sharp({ create: { width: 3200, height: 2000, channels: 3, background: '#fff' } }).composite([{ input: { create: { width: 400, height: 40, channels: 3, background: '#000' } }, left: 200, top: 300 }]).png().toBuffer();
    const out = await preprocessImage(big, cfg());
    expect(Math.max(out.review.width, out.review.height)).toBe(2200);
    expect(out.transform.scale).toBeCloseTo(2200 / 3200, 5);
  });

  it('reports quality measurements and warnings', async () => {
    const small = await sharp({ create: { width: 500, height: 300, channels: 3, background: '#808080' } }).png().toBuffer();
    const out = await preprocessImage(small, cfg({ minSide: 100 }));
    expect(out.quality).toMatchObject({ megapixels: expect.any(Number), sharpness: expect.any(Number), brightness: expect.any(Number), contrast: expect.any(Number) });
    expect(out.quality.warnings).toEqual(expect.arrayContaining(['LOW_RESOLUTION', 'LOW_CONTRAST']));
  });

  it('deskew: a table photographed 3 degrees crooked is straightened (correction ~ -3 degrees)', async () => {
    const crooked = await tableImage({ skewDeg: 3 });
    const est = await estimateSkewDegrees(crooked);
    expect(Math.abs(est.degrees + 3)).toBeLessThanOrEqual(0.7);
    expect(est.gain).toBeGreaterThan(1.03);
    const out = await preprocessImage(crooked, cfg());
    expect(Math.abs(out.transform.deskewDegrees + 3)).toBeLessThanOrEqual(0.7);
    const after = await estimateSkewDegrees(out.review.buffer);
    expect(Math.abs(after.degrees)).toBeLessThanOrEqual(0.5);
    expect(out.quality.skewDegrees).toBe(out.transform.deskewDegrees);
  });

  it('deskew is deterministic', async () => {
    const crooked = await tableImage({ skewDeg: -2 });
    const a = await preprocessImage(crooked, cfg());
    const b = await preprocessImage(crooked, cfg());
    expect(a.transform).toEqual(b.transform);
    expect(a.review.buffer.equals(b.review.buffer)).toBe(true);
  });
});

describe('geometric transform bookkeeping (review pixels -> original pixels)', () => {
  it('deskew rotation is inverted correctly', async () => {
    const base = await marker(1000, 700, 600, 150).png().toBuffer();
    const p0 = await centroid(base);
    const angle = 3.5;
    const { data, info } = await sharp(base).rotate(angle, { background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
    const p1 = await centroid(data);
    const back = reviewToOriginal(p1, { scale: 1, scaled: { width: 1000, height: 700 }, deskewDegrees: angle, review: { width: info.width, height: info.height }, exifOrientation: 1, original: { width: 1000, height: 700 } });
    expect(Math.abs(back.x - p0.x)).toBeLessThan(2);
    expect(Math.abs(back.y - p0.y)).toBeLessThan(2);
  });

  it.each([3, 6, 8])('EXIF orientation %i is inverted correctly', async (orientation) => {
    const markerPng = await marker(800, 500, 100, 50).png().toBuffer();
    const raw = await sharp(markerPng).jpeg({ quality: 100 }).withMetadata({ orientation }).toBuffer();
    const p0 = await centroid(markerPng);
    const oriented = await sharp(raw).rotate().png().toBuffer({ resolveWithObject: true });
    const p1 = await centroid(oriented.data);
    const back = reviewToOriginal(p1, { scale: 1, scaled: { width: oriented.info.width, height: oriented.info.height }, deskewDegrees: 0, review: { width: oriented.info.width, height: oriented.info.height }, exifOrientation: orientation, original: { width: 800, height: 500 } });
    expect(Math.abs(back.x - p0.x)).toBeLessThan(3);
    expect(Math.abs(back.y - p0.y)).toBeLessThan(3);
  });

  it('uniform scaling is inverted', () => {
    const back = reviewToOriginal({ x: 550, y: 275 }, { scale: 0.5, scaled: { width: 1000, height: 500 }, deskewDegrees: 0, review: { width: 1000, height: 500 }, exifOrientation: 1, original: { width: 2000, height: 1000 } });
    expect(back).toEqual({ x: 1100, y: 550 });
  });
});

describe('Google Vision adapter (recorded-shape response, no live calls)', () => {
  const layout = layoutTable({ headers: HEADERS, rows: ROWS });
  const response = toVisionResponse(layout.words, layout);
  const dims = { width: layout.width, height: layout.height };

  it('translates the vendor structure into the internal shape: text, confidence, boxes, symbols', () => {
    const { provider, page } = normalizeVisionResponse(response, dims);
    expect(provider).toEqual({ name: 'google-vision', version: 'documentTextDetection' });
    expect(page.words).toHaveLength(layout.words.length);
    const w = page.words.find((x) => x.text === '4700000.25');
    const src = layout.words.find((x) => x.text === '4700000.25');
    expect(w.bbox).toEqual(src.bbox);
    expect(w.confidence).toBe(0.98);
    expect(w.symbols).toHaveLength('4700000.25'.length);
    expect(w.symbols[0]).toEqual({ text: '4', confidence: 0.98 });
    expect(Object.keys(w).sort()).toEqual(['bbox', 'confidence', 'symbols', 'text']); // no vendor fields leak
  });

  it('missing/empty responses give an empty page, never a crash', () => {
    expect(normalizeVisionResponse({}, dims).page.words).toEqual([]);
    expect(normalizeVisionResponse(null, dims).page.words).toEqual([]);
  });

  it('recognize() uses the client and returns the normalized shape', async () => {
    const client = { documentTextDetection: jest.fn().mockResolvedValue([response]) };
    const provider = createGoogleVisionProvider({ clientFactory: () => client });
    const out = await provider.recognize(Buffer.from('img'), dims);
    expect(out.page.words.length).toBe(layout.words.length);
    const arg = client.documentTextDetection.mock.calls[0][0];
    expect(arg.image.content).toBe(Buffer.from('img').toString('base64'));
    expect(arg.imageContext.languageHints).toEqual(['bg', 'en']);
  });

  it('provider failure is sanitized: no vendor message, request detail or credentials reach the error', async () => {
    const client = { documentTextDetection: jest.fn().mockRejectedValue(new Error('PERMISSION_DENIED: key=SECRET-KEY-123 project=geosolver-469408')) };
    const err = await createGoogleVisionProvider({ clientFactory: () => client }).recognize(Buffer.from('x'), dims).catch((e) => e);
    expect(err).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', status: 502 });
    expect(err.message).toBe('Разпознаването временно не е възможно. Опитайте отново по-късно.');
    expect(JSON.stringify({ m: err.message, e: err.extra, c: err.code })).not.toMatch(/SECRET|PERMISSION|geosolver-469408/);
  });

  it('a hanging provider times out with the same sanitized error', async () => {
    const client = { documentTextDetection: () => new Promise(() => {}) };
    const err = await createGoogleVisionProvider({ clientFactory: () => client, timeoutMs: 50 }).recognize(Buffer.from('x'), dims).catch((e) => e);
    expect(err.code).toBe('PROVIDER_UNAVAILABLE');
  });

  it('missing or invalid credentials -> PROVIDER_NOT_CONFIGURED (503), without leaking the value', async () => {
    const saved = process.env.GCP_SA_JSON;
    try {
      delete process.env.GCP_SA_JSON;
      expect(await createGoogleVisionProvider().recognize(Buffer.from('x'), dims).catch((e) => e)).toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED', status: 503 });
      process.env.GCP_SA_JSON = '{not json secret-material';
      const err = await createGoogleVisionProvider().recognize(Buffer.from('x'), dims).catch((e) => e);
      expect(err.code).toBe('PROVIDER_NOT_CONFIGURED');
      expect(err.message).not.toContain('secret-material');
    } finally {
      if (saved === undefined) delete process.env.GCP_SA_JSON; else process.env.GCP_SA_JSON = saved;
    }
  });

  it('the registry resolves google-vision, lets tests substitute a provider, and refuses unknown names', () => {
    expect(getProvider('google-vision').name).toBe('google-vision');
    const fake = { name: 'fixture', recognize: async () => null };
    setProviderForTests('google-vision', fake);
    expect(getProvider('google-vision')).toBe(fake);
    setProviderForTests('google-vision', null);
    expect(getProvider('google-vision')).not.toBe(fake);
    expect(() => getProvider('unknown')).toThrow(CaptureError);
  });

  it('the fixture words feed the reconstruction unchanged (adapter -> reconstruct contract)', () => {
    const { page } = normalizeVisionResponse(response, dims);
    expect(page.words.map((w) => w.text)).toEqual(stripPrivate(layout.words).map((w) => w.text));
  });
});

describe('storage abstraction (Mongo implementation over a model)', () => {
  it('put / get / deleteForJob go through the model; image bytes are stored, hashed and returned', async () => {
    const rows = new Map();
    let n = 0;
    const Model = {
      create: async (d) => { const _id = `asset${++n}`; rows.set(_id, { _id, ...d }); return { _id }; },
      findById: (id) => ({ select: async () => rows.get(id) || null }),
      deleteMany: async ({ job }) => { for (const [k, v] of rows) if (v.job === job) rows.delete(k); },
    };
    const storage = createMongoStorage(Model);
    const id = await storage.put({ jobId: 'j1', userId: 'u1', kind: 'review', buffer: Buffer.from('bytes'), mime: 'image/jpeg', width: 5, height: 6, expiresAt: new Date() });
    expect(rows.get(id)).toMatchObject({ job: 'j1', kind: 'review', bytes: 5, mime: 'image/jpeg', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect((await storage.get(id)).buffer.toString()).toBe('bytes');
    expect(await storage.get('missing')).toBeNull();
    await storage.deleteForJob('j1');
    expect(await storage.get(id)).toBeNull();
  });
});
