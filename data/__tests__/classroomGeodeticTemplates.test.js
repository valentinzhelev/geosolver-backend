const { SandboxExecutor } = require('../../utils/sandbox');
const { splitGroundTruth } = require('../../utils/taskGroundTruth');
const { MVP_EDU_TEMPLATES } = require('../mvpEduTemplates');
const { ASSIGNMENT_PRESETS } = require('../../utils/assignmentPresets');
const registry = require('../../engines/registry');
const { conditionNumber } = require('../../engines/tools/resection');
const Submission = require('../../models/Submission');

/**
 * MILESTONE 2.1 — built-in Forward Intersection and Resection classroom tasks.
 *
 * 10,000 deterministic seeds per tool run the generator scripts through a fast runner that is proven
 * byte-identical to the REAL SandboxExecutor (see the first describe), the reserved ground truth is split
 * off exactly as the server does, and the results are checked
 * against (1) the canonical engine, (2) independent geometry computed here with plain atan2 — NOT the
 * generator's own formula — and (3) the real Submission.compareAnswers grading code.
 *
 * Frame: X north, Y east, bearings clockwise from +X, angles in gon.
 */

jest.setTimeout(180000);

const N = 10000;
const TOLERANCE = 0.01; // absolute, metres — the assignment presets and the template gradingSettings

const template = (toolKey) => MVP_EDU_TEMPLATES.find((t) => t.toolKey === toolKey);
const executor = new SandboxExecutor();

// Fast runner for the 10,000-seed sweeps. It reproduces the SandboxExecutor's seeded Math exactly (same
// LCG, same bound Math functions) so the sequence for a seed is identical; one test below proves that
// on a sample against the REAL executor. (Creating a vm context per call would make 30,000 runs take minutes.)
function seededMath(seed) {
  let state = Number(seed) || 1;
  const math = Object.create(null);
  for (const key of Object.getOwnPropertyNames(Math)) {
    const val = Math[key];
    math[key] = typeof val === 'function' ? val.bind(Math) : val;
  }
  math.random = function () {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
  return math;
}
const compiled = {};
function fastGenerate(toolKey, seed) {
  compiled[toolKey] = compiled[toolKey] || new Function('Math', 'variantIndex', 'seed', template(toolKey).generatorScript);
  return compiled[toolKey](seededMath(seed), 0, seed);
}
const fastSolutions = {};
function fastSolve(toolKey, inputData) {
  fastSolutions[toolKey] = fastSolutions[toolKey] || new Function('inputData', template(toolKey).solutionScript);
  return fastSolutions[toolKey](inputData);
}

function generateAll(toolKey, count = N) {
  const cases = [];
  for (let seed = 1; seed <= count; seed++) {
    try {
      const raw = fastGenerate(toolKey, seed);
      cases.push({ seed, raw, ...splitGroundTruth(raw) });
    } catch (error) {
      cases.push({ seed, failed: error.message });
    }
  }
  return cases;
}

describe('the fast runner is identical to the real SandboxExecutor (so the 10,000-seed sweeps prove the production path)', () => {
  it.each(['forward-intersection', 'resection'])('%s: 300 seeds produce byte-identical generator output', (toolKey) => {
    for (let seed = 1; seed <= 300; seed++) {
      const real = executor.executeGenerator(template(toolKey).generatorScript, 0, seed);
      expect(real.success).toBe(true);
      expect(fastGenerate(toolKey, seed)).toEqual(real.data);
    }
  });
});

// ---- independent geometry (test-local; deliberately not the generator's or the engine's code)
const GON = Math.PI / 200;
const wrap = (g) => ((g % 400) + 400) % 400;
const bearing = (fromX, fromY, toX, toY) => wrap(Math.atan2(toY - fromY, toX - fromX) / GON);
const circDiff = (a, b) => {
  const d = Math.abs(a - b) % 400;
  return Math.min(d, 400 - d);
};

const grader = new Submission();
const grade = (answers, solution) => grader.compareAnswers(answers, solution, TOLERANCE, 'absolute');

describe('grading configuration is unchanged (no global loosening)', () => {
  it('the two corrected templates keep their 0.01 m absolute tolerance; First Task keeps its own 0.001; every preset stays 0.01', () => {
    expect(template('forward-intersection').gradingSettings).toMatchObject({ tolerance: 0.01, toleranceType: 'absolute' });
    expect(template('resection').gradingSettings).toMatchObject({ tolerance: 0.01, toleranceType: 'absolute' });
    expect(template('second-basic-task').gradingSettings).toMatchObject({ tolerance: 0.01, toleranceType: 'absolute' });
    expect(template('first-basic-task').gradingSettings).toMatchObject({ tolerance: 0.001, toleranceType: 'absolute' }); // untouched
    for (const key of ['first-basic-task', 'second-basic-task', 'forward-intersection', 'resection']) {
      const preset = ASSIGNMENT_PRESETS.find((p) => p.toolKey === key);
      expect(preset).toMatchObject({ customTolerance: 0.01, customToleranceType: 'absolute' });
    }
  });

  it('the real grader accepts a value within tolerance and rejects one just outside it', () => {
    expect(grade({ xP: 100.009, yP: 5 }, { xP: 100, yP: 5 }).score).toBe(100);
    expect(grade({ xP: 100.011, yP: 5 }, { xP: 100, yP: 5 }).score).toBe(50);
  });
});

describe('FORWARD INTERSECTION — 10,000 generated tasks', () => {
  const cases = generateAll('forward-intersection');
  const engine = registry.getCurrentEngine('forward-intersection');

  it('the generator succeeds for every seed and hands back the reserved ground truth', () => {
    expect(cases.filter((c) => c.failed)).toEqual([]);
    for (const c of cases) {
      expect(Object.keys(c.raw)).toContain('__groundTruth');
      expect(Object.keys(c.groundTruth).sort()).toEqual(['xP', 'yP']);
    }
  });

  it('the student-visible inputData is exactly the six measurements — no ground truth, no answer', () => {
    for (const c of cases) {
      expect(Object.keys(c.inputData).sort()).toEqual(['beta1', 'beta2', 'xA', 'xB', 'yA', 'yB']);
      expect(c.inputData).not.toHaveProperty('__groundTruth');
      expect(c.inputData).not.toHaveProperty('xP');
      expect(c.inputData).not.toHaveProperty('yP');
    }
  });

  it('valid by construction: beta1 > 0, beta2 > 0, beta1 + beta2 < 200 gon, A != B, well-conditioned intersection', () => {
    for (const { inputData: d } of cases) {
      expect(d.beta1).toBeGreaterThan(0);
      expect(d.beta2).toBeGreaterThan(0);
      expect(d.beta1 + d.beta2).toBeLessThan(200);
      const baseline = Math.hypot(d.xB - d.xA, d.yB - d.yA);
      expect(baseline).toBeGreaterThan(99);
      const intersectionAngle = 200 - d.beta1 - d.beta2;
      expect(intersectionAngle).toBeGreaterThanOrEqual(59.99);
      expect(intersectionAngle).toBeLessThanOrEqual(140.01);
    }
  });

  it('the angles are DERIVED from the known point, not independent: recomputed from A, B and P they equal the displayed values', () => {
    for (const { inputData: d, groundTruth: p } of cases) {
      const aAB = bearing(d.xA, d.yA, d.xB, d.yB);
      const beta1 = wrap(aAB - bearing(d.xA, d.yA, p.xP, p.yP));
      const beta2 = wrap(bearing(d.xB, d.yB, p.xP, p.yP) - wrap(aAB + 200));
      expect(circDiff(beta1, d.beta1)).toBeLessThanOrEqual(0.0006); // 3-decimal display rounding only
      expect(circDiff(beta2, d.beta2)).toBeLessThanOrEqual(0.0006);
    }
  });

  it('P lies on the LEFT of A->B (the GeoSolver forward-intersection convention)', () => {
    for (const { inputData: d, groundTruth: p } of cases) {
      const cross = (d.xB - d.xA) * (p.yP - d.yA) - (d.yB - d.yA) * (p.xP - d.xA);
      expect(cross).toBeLessThan(0);
    }
  });

  it('100% acceptance by the canonical engine, and it reproduces the known point within the grading tolerance', () => {
    let maxError = 0;
    for (const { inputData, groundTruth: p } of cases) {
      const result = engine.run(inputData).resultData; // throws (fails the test) on any rejection
      maxError = Math.max(maxError, Math.abs(result.xP - p.xP), Math.abs(result.yP - p.yP));
    }
    // Evidence: the only difference is the 3-decimal rounding of the displayed angles. It is well below
    // the 0.01 m grading tolerance, so tolerance does NOT need to be loosened.
    expect(maxError).toBeLessThanOrEqual(0.005);
    expect(maxError).toBeLessThan(TOLERANCE / 2);
  });

  it('the answer key (ground truth) accepts the canonical result for every task', () => {
    for (const { inputData, groundTruth } of cases) {
      const answers = engine.run(inputData).resultData;
      const g = grade({ xP: answers.xP, yP: answers.yP }, groundTruth);
      expect(g.score).toBe(100);
      expect(g.correctAnswers).toBe(2);
    }
  });

  it('meaningfully wrong answers are rejected: shifted, swapped axes, and the mirror point on the wrong side of AB', () => {
    for (const { inputData: d, groundTruth: p } of cases) {
      expect(grade({ xP: p.xP + 0.05, yP: p.yP + 0.05 }, p).score).toBe(0);
      if (Math.abs(p.xP - p.yP) > 1) expect(grade({ xP: p.yP, yP: p.xP }, p).score).toBe(0);
      // reflect P across the line AB (the classic wrong-side mistake)
      const ux = (d.xB - d.xA) / Math.hypot(d.xB - d.xA, d.yB - d.yA);
      const uy = (d.yB - d.yA) / Math.hypot(d.xB - d.xA, d.yB - d.yA);
      const t = (p.xP - d.xA) * ux + (p.yP - d.yA) * uy;
      const footX = d.xA + t * ux;
      const footY = d.yA + t * uy;
      const mirror = { xP: 2 * footX - p.xP, yP: 2 * footY - p.yP };
      expect(grade(mirror, p).score).toBeLessThan(100);
      expect(Math.hypot(mirror.xP - p.xP, mirror.yP - p.yP)).toBeGreaterThan(50);
    }
  });

  it('the unchanged formula in the solutionScript still agrees with both the ground truth and the engine for all 10,000 (drift detector)', () => {
    for (const { inputData, groundTruth } of cases) {
      const key = fastSolve('forward-intersection', inputData);
      expect(Math.abs(key.xP - groundTruth.xP)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(key.yP - groundTruth.yP)).toBeLessThanOrEqual(0.005);
      const engineResult = engine.run(inputData).resultData;
      expect(Math.abs(key.xP - engineResult.xP)).toBeLessThanOrEqual(0.0011);
      expect(Math.abs(key.yP - engineResult.yP)).toBeLessThanOrEqual(0.0011);
    }
    // ...and the real sandbox path gives the same key on a sample
    for (const { inputData } of cases.slice(0, 200)) {
      const real = executor.executeSolution(template('forward-intersection').solutionScript, inputData);
      expect(real.success).toBe(true);
      expect(real.data).toEqual(fastSolve('forward-intersection', inputData));
    }
  });

  it('keeps sensible variation: thousands of distinct tasks, every heading of AB, reproducible per seed', () => {
    expect(new Set(cases.map((c) => JSON.stringify(c.inputData))).size).toBeGreaterThanOrEqual(N - 50);
    const quadrants = new Set(cases.map((c) => Math.floor(bearing(c.inputData.xA, c.inputData.yA, c.inputData.xB, c.inputData.yB) / 100)));
    expect([...quadrants].sort()).toEqual([0, 1, 2, 3]);
    const again = executor.executeGenerator(template('forward-intersection').generatorScript, 0, 4242).data;
    const first = executor.executeGenerator(template('forward-intersection').generatorScript, 0, 4242).data;
    expect(again).toEqual(first);
  });
});

describe('RESECTION — 10,000 generated tasks (official v2 contract: directed clockwise angles)', () => {
  const cases = generateAll('resection');
  const engine = registry.getCurrentEngine('resection');

  it('the generator succeeds for every seed and hands back the reserved ground truth', () => {
    expect(cases.filter((c) => c.failed)).toEqual([]);
    for (const c of cases) expect(Object.keys(c.groundTruth).sort()).toEqual(['xP', 'yP']);
  });

  it('the student-visible inputData is exactly the eight given values — no ground truth, no answer', () => {
    for (const c of cases) {
      expect(Object.keys(c.inputData).sort()).toEqual(['beta1', 'beta2', 'xA', 'xB', 'xC', 'yA', 'yB', 'yC']);
      expect(c.inputData).not.toHaveProperty('__groundTruth');
      expect(c.inputData).not.toHaveProperty('xP');
    }
  });

  it('control points are distinct and clearly non-collinear', () => {
    for (const { inputData: d } of cases) {
      const A = { x: d.xA, y: d.yA };
      const B = { x: d.xB, y: d.yB };
      const C = { x: d.xC, y: d.yC };
      const ab = Math.hypot(B.x - A.x, B.y - A.y);
      const bc = Math.hypot(C.x - B.x, C.y - B.y);
      const ca = Math.hypot(A.x - C.x, A.y - C.y);
      expect(Math.min(ab, bc, ca)).toBeGreaterThan(20);
      const sinB = Math.abs((B.x - A.x) * (C.y - B.y) - (B.y - A.y) * (C.x - B.x)) / (ab * bc);
      expect(sinB).toBeGreaterThanOrEqual(0.1);
    }
  });

  it('the station is far from the danger circle and far below the canonical condition-number limit', () => {
    let minMargin = Infinity;
    let maxKappa = 0;
    for (const { inputData: d, groundTruth: p } of cases) {
      const A = { x: d.xA, y: d.yA };
      const B = { x: d.xB, y: d.yB };
      const C = { x: d.xC, y: d.yC };
      const P = { x: p.xP, y: p.yP };
      const k = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
      const ux = ((A.x ** 2 + A.y ** 2) * (B.y - C.y) + (B.x ** 2 + B.y ** 2) * (C.y - A.y) + (C.x ** 2 + C.y ** 2) * (A.y - B.y)) / k;
      const uy = ((A.x ** 2 + A.y ** 2) * (C.x - B.x) + (B.x ** 2 + B.y ** 2) * (A.x - C.x) + (C.x ** 2 + C.y ** 2) * (B.x - A.x)) / k;
      const radius = Math.hypot(A.x - ux, A.y - uy);
      minMargin = Math.min(minMargin, Math.abs(Math.hypot(P.x - ux, P.y - uy) - radius));
      maxKappa = Math.max(maxKappa, conditionNumber(A, B, C, P));
    }
    expect(minMargin).toBeGreaterThan(10); // metres from the circumscribed circle (measured minimum ~19.8 m)
    expect(maxKappa).toBeLessThanOrEqual(6.0001); // canonical limit is 1e4
  });

  it('beta1/beta2 follow the OFFICIAL semantics: directed CLOCKWISE P->A to P->B and P->B to P->C, recomputed here with plain atan2', () => {
    for (const { inputData: d, groundTruth: p } of cases) {
      const toA = bearing(p.xP, p.yP, d.xA, d.yA);
      const toB = bearing(p.xP, p.yP, d.xB, d.yB);
      const toC = bearing(p.xP, p.yP, d.xC, d.yC);
      expect(circDiff(wrap(toB - toA), d.beta1)).toBeLessThanOrEqual(0.0006);
      expect(circDiff(wrap(toC - toB), d.beta2)).toBeLessThanOrEqual(0.0006);
      expect(d.beta1).toBeGreaterThan(50); // A -> B -> C is a genuine clockwise sweep as seen from P
      expect(d.beta2).toBeGreaterThan(50);
      expect(d.beta1).toBeLessThan(120);
      expect(d.beta2).toBeLessThan(120);
    }
  });

  it('there is no 400-beta ambiguity: the complementary angles do NOT reproduce the station', () => {
    for (const { inputData: d, groundTruth: p } of cases.slice(0, 1000)) {
      let result = null;
      try {
        result = engine.run({ ...d, beta1: 400 - d.beta1, beta2: 400 - d.beta2 }).resultData;
      } catch (e) {
        expect(e.code).toBeDefined(); // a structured rejection is fine
      }
      if (result) expect(Math.hypot(result.xP - p.xP, result.yP - p.yP)).toBeGreaterThan(1);
    }
  });

  it('100% acceptance by canonical Resection v2, and it reproduces the known station within the grading tolerance', () => {
    let maxError = 0;
    for (const { inputData, groundTruth: p } of cases) {
      const result = engine.run(inputData).resultData; // throws (fails the test) on ANY rejection
      maxError = Math.max(maxError, Math.abs(result.xP - p.xP), Math.abs(result.yP - p.yP));
    }
    expect(maxError).toBeLessThanOrEqual(0.005);
    expect(maxError).toBeLessThan(TOLERANCE / 2);
  });

  it('the answer key (ground truth) accepts the canonical result for every task', () => {
    for (const { inputData, groundTruth } of cases) {
      const answers = engine.run(inputData).resultData;
      const g = grade({ xP: answers.xP, yP: answers.yP }, groundTruth);
      expect(g.score).toBe(100);
      expect(g.correctAnswers).toBe(2);
    }
  });

  it('meaningfully wrong answers are rejected: shifted, swapped axes, and a control point mistaken for the station (never fully correct)', () => {
    for (const { inputData: d, groundTruth: p } of cases) {
      expect(grade({ xP: p.xP + 0.05, yP: p.yP - 0.05 }, p).score).toBe(0);
      if (Math.abs(p.xP - p.yP) > 1) expect(grade({ xP: p.yP, yP: p.xP }, p).score).toBe(0);
      expect(grade({ xP: d.xB, yP: d.yB }, p).correctAnswers).toBeLessThan(2); // one coordinate can coincide by chance; never both
    }
  });

  it('the solutionScript deliberately FAILS CLOSED: there is no second Resection solver that could disagree', () => {
    const t = template('resection');
    const attempt = executor.executeSolution(t.solutionScript, cases[0].inputData);
    expect(attempt.success).toBe(false);
    expect(attempt.error).toMatch(/ground truth/);
    expect(t.solutionScript).not.toMatch(/atan2|acos|Tienstra|circle/i);
  });

  it('keeps sensible variation: thousands of distinct tasks, reproducible per seed', () => {
    expect(new Set(cases.map((c) => JSON.stringify(c.inputData))).size).toBeGreaterThanOrEqual(N - 50);
    const g = template('resection').generatorScript;
    expect(executor.executeGenerator(g, 0, 777).data).toEqual(executor.executeGenerator(g, 0, 777).data);
  });
});

describe('student-facing wording of the built-in Resection task (official semantics)', () => {
  const { description } = template('resection');

  it('states directed CLOCKWISE angles with the exact P->A / P->B / P->C meaning, in Bulgarian', () => {
    expect(description).toMatch(/насочени ъгъла/);
    expect(description).toMatch(/по часовниковата стрелка/);
    expect(description).toMatch(/β₁ \(от P→A към P→B\)/);
    expect(description).toMatch(/β₂ \(от P→B към P→C\)/);
  });

  it('no longer uses the unsigned "angle between"/"two angles" wording', () => {
    expect(description).not.toMatch(/ъгъла между|два ъгъла\./);
    expect(description).not.toMatch(/Позиция на точка P по три известни точки и два ъгъла/);
  });
});

describe('First and Second Basic Task remain aligned (unchanged scripts)', () => {
  it('their generators and answer keys still agree with the canonical engine', () => {
    const first = template('first-basic-task');
    const second = template('second-basic-task');
    for (let seed = 1; seed <= 500; seed++) {
      const f = executor.executeGenerator(first.generatorScript, 0, seed).data;
      const fKey = executor.executeSolution(first.solutionScript, f).data;
      const fr = registry.getCurrentEngine('first-basic-task').run(f).resultData;
      expect(Math.abs(fr.x2 - fKey.x2)).toBeLessThanOrEqual(0.0011);
      expect(Math.abs(fr.y2 - fKey.y2)).toBeLessThanOrEqual(0.0011);

      const s = executor.executeGenerator(second.generatorScript, 0, seed).data;
      const sKey = executor.executeSolution(second.solutionScript, s).data;
      const sr = registry.getCurrentEngine('second-basic-task').run(s).resultData;
      expect(Math.abs(sr.distance - sKey.distance)).toBeLessThanOrEqual(0.0011);
      expect(Math.abs(sr.alpha - sKey.alpha)).toBeLessThanOrEqual(0.0011);
    }
  });
});

// ---------------------------------------------------------------------------------------------------
// END-TO-END CLASSROOM CHAIN (Milestone 2.1 integrity item 4), 10,000 cases per tool:
// generator -> student-visible input (through the real student view) -> canonical engine accepts ->
// canonical result mapped onto the template's answer keys -> REAL Submission.autoGrade against the
// stored server-side solution accepts it; a deliberately wrong result is rejected.
// ---------------------------------------------------------------------------------------------------
describe.each(['forward-intersection', 'resection'])('END-TO-END classroom chain: %s (10,000 cases)', (toolKey) => {
  const { toStudentVariants } = require('../../utils/studentVariantView');
  const def = template(toolKey);
  const engine = registry.getCurrentEngine(toolKey);
  const cases = generateAll(toolKey);

  const submissionFor = (variantIndex, answers, variant) => {
    const sub = new Submission({ assignment: '507f1f77bcf86cd799439011', student: '507f1f77bcf86cd799439012', variantIndex, answers, timeSpent: 1, attemptNumber: 1 });
    const assignment = { getVariant: (i) => (i === variant.variantIndex ? variant : undefined), settings: {} };
    sub.autoGrade(assignment, { gradingSettings: def.gradingSettings });
    return sub;
  };

  it('every one of 10,000 cases survives the whole chain; wrong answers never pass', () => {
    expect(cases.filter((c) => c.failed)).toEqual([]);
    let accepted = 0;
    let wrongRejected = 0;
    let roundedAccepted = 0;

    for (const c of cases) {
      // stored snapshot exactly as Assignment.generateVariants stores it
      const stored = { variantIndex: 0, inputData: c.inputData, solution: c.groundTruth, solutionHash: 'x' };

      // student-visible view: no reserved key, no answer
      const [visible] = toStudentVariants([stored]);
      expect(JSON.stringify(visible)).not.toContain('__');
      for (const key of def.answerKeys) expect(visible.inputData).not.toHaveProperty(key);

      // geometry contract
      const d = visible.inputData;
      if (toolKey === 'forward-intersection') {
        if (!(d.beta1 > 0 && d.beta2 > 0 && d.beta1 + d.beta2 < 200)) throw new Error(`seed ${c.seed}: forward inequalities violated`);
      } else {
        const toA = bearing(c.groundTruth.xP, c.groundTruth.yP, d.xA, d.yA);
        const toB = bearing(c.groundTruth.xP, c.groundTruth.yP, d.xB, d.yB);
        const toC = bearing(c.groundTruth.xP, c.groundTruth.yP, d.xC, d.yC);
        // directed clockwise angles; no complement: the values are used exactly as generated
        if (circDiff(wrap(toB - toA), d.beta1) > 0.0006 || circDiff(wrap(toC - toB), d.beta2) > 0.0006) throw new Error(`seed ${c.seed}: resection semantics violated`);
        if (!(d.beta1 > 0 && d.beta1 < 400 && d.beta2 > 0 && d.beta2 < 400)) throw new Error(`seed ${c.seed}: beta range`);
      }

      // canonical engine accepts the student-visible input (throws on rejection) and computes the result
      const result = engine.run(visible.inputData).resultData;
      const answers = {};
      for (const key of def.answerKeys) answers[key] = result[key];

      // real autoGrade accepts the canonical result (full precision AND as a student would type it, 3 dp)
      const ok = submissionFor(0, answers, stored);
      if (ok.computedScore !== 100 || ok.status !== 'graded') throw new Error(`seed ${c.seed}: canonical result rejected`);
      accepted += 1;
      const typed = {};
      for (const key of def.answerKeys) typed[key] = Math.round(result[key] * 1000) / 1000;
      if (submissionFor(0, typed, stored).computedScore !== 100) throw new Error(`seed ${c.seed}: 3dp answer rejected`);
      roundedAccepted += 1;

      // deliberately wrong results are rejected (shifted 1 m; swapped axes when they differ by > 1 m)
      const shifted = { xP: result.xP + 1, yP: result.yP + 1 };
      if (submissionFor(0, shifted, stored).computedScore !== 0) throw new Error(`seed ${c.seed}: shifted answer accepted`);
      const swapped = { xP: result.yP, yP: result.xP };
      if (Math.abs(result.xP - result.yP) > 1 && submissionFor(0, swapped, stored).computedScore === 100) throw new Error(`seed ${c.seed}: swapped answer accepted`);
      wrongRejected += 1;
    }
    expect(accepted).toBe(N);
    expect(roundedAccepted).toBe(N);
    expect(wrongRejected).toBe(N);
  });
});
