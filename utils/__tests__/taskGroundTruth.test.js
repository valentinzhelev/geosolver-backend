const fs = require('fs');
const path = require('path');
const { GROUND_TRUTH_KEY, splitGroundTruth } = require('../taskGroundTruth');

/**
 * The student receives each variant's FULL inputData, so ground truth may only travel under the one
 * reserved key and must be removed server-side before anything is stored or sent.
 */

describe('splitGroundTruth', () => {
  it('the reserved key is __groundTruth', () => {
    expect(GROUND_TRUTH_KEY).toBe('__groundTruth');
  });

  it('a generator result without ground truth is returned untouched (the solutionScript path, as before)', () => {
    const generated = { a: 1, b: 2 };
    expect(splitGroundTruth(generated)).toEqual({ inputData: generated, groundTruth: undefined });
    expect(splitGroundTruth(generated).inputData).toBe(generated);
  });

  it('removes __groundTruth from the student-visible inputData and returns it separately', () => {
    const generated = { xA: 1, yA: 2, __groundTruth: { xP: 10.5, yP: -3 } };
    const { inputData, groundTruth } = splitGroundTruth(generated);
    expect(inputData).toEqual({ xA: 1, yA: 2 });
    expect(Object.keys(inputData)).not.toContain('__groundTruth');
    expect(groundTruth).toEqual({ xP: 10.5, yP: -3 });
    expect(generated).toHaveProperty('__groundTruth'); // the generator object itself is not mutated
  });

  it('returns COPIES: mutating the split result cannot reach back into the generator output', () => {
    const generated = { k: 1, __groundTruth: { xP: 1 } };
    const { inputData, groundTruth } = splitGroundTruth(generated);
    groundTruth.xP = 999;
    inputData.k = 999;
    expect(generated.__groundTruth.xP).toBe(1);
    expect(generated.k).toBe(1);
  });

  it('FAILS CLOSED on any other reserved "__" key — hidden data cannot be smuggled under a different name', () => {
    expect(() => splitGroundTruth({ a: 1, __secret: 5 })).toThrow(/unsupported reserved key: __secret/);
    expect(() => splitGroundTruth({ a: 1, __groundTruth: { xP: 1 }, __answer: { xP: 1 } })).toThrow(/unsupported reserved key: __answer/);
    expect(() => splitGroundTruth({ __proto_leak: 1 })).toThrow(/reserved key/);
  });

  it('rejects a malformed ground truth', () => {
    for (const bad of [null, undefined, 5, 'x', [], [1, 2], {}, { xP: 'a' }, { xP: NaN }, { xP: Infinity }, { xP: 1, yP: null }]) {
      expect(() => splitGroundTruth({ a: 1, __groundTruth: bad })).toThrow(/ground truth must be a non-empty object of finite numbers/);
    }
  });

  it('non-object generator results are passed through (nothing to split)', () => {
    for (const v of [null, undefined, 5, 'x', [1, 2]]) {
      expect(splitGroundTruth(v)).toEqual({ inputData: v, groundTruth: undefined });
    }
  });
});

describe('no caller can bypass the split (a hidden key can never be stored or sent by accident)', () => {
  const ROOT = path.join(__dirname, '..', '..');
  const walk = (dir, out = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', '__tests__', 'uploads', 'fixtures'].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else if (e.name.endsWith('.js')) out.push(full);
    }
    return out;
  };

  it('only models/TaskTemplate.js calls generateTestData / generateSolution; everything else uses generateVariantData', () => {
    const offenders = [];
    for (const file of walk(ROOT)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      if (rel === 'models/TaskTemplate.js') continue;
      const src = fs.readFileSync(file, 'utf8');
      if (/\.generateTestData\(|\.generateSolution\(/.test(src)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('the two variant producers (Assignment.generateVariants and the admin preview route) use generateVariantData', () => {
    expect(fs.readFileSync(path.join(ROOT, 'models/Assignment.js'), 'utf8')).toContain('template.generateVariantData(i, null)');
    expect(fs.readFileSync(path.join(ROOT, 'routes/taskTemplates.js'), 'utf8')).toContain('template.generateVariantData(variantIndex, seed)');
  });

  it('the student-facing routes build variants ONLY through the shared reserved-key-stripping view (never solution / solutionHash)', () => {
    for (const rel of ['routes/studentAssignments.js', 'routes/assignments.js']) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      expect(src).toContain('variants: toStudentVariants(assignment.variants)');
      expect(src).not.toMatch(/variants: assignment.variants.map/);
    }
    const view = fs.readFileSync(path.join(ROOT, 'utils/studentVariantView.js'), 'utf8').replace(new RegExp('//.*', 'g'), '');
    expect(view).not.toMatch(/variant.solution/);
  });
});
