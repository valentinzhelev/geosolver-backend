const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const registry = require('../registry');
const { MVP_EDU_TEMPLATES } = require('../../data/mvpEduTemplates');

/**
 * CLASSROOM REGRESSION EVIDENCE (Milestone 2). The canonical engine must not silently change or
 * "fix" grading:
 *   1. grading never reads the canonical engine (it uses TaskTemplate scripts + Submission);
 *   2. the built-in template scripts are pinned by hash — any change is a deliberate, reviewed one;
 *   3. Milestone 2.1 RESOLVED the two known defects (the Resection generator/answer key and the
 *      Forward Intersection generator): both templates are now generated from real geometry and
 *      aligned with the engine. The full 10,000-case proof lives in
 *      data/__tests__/classroomGeodeticTemplates.test.js; this file keeps the pins and a smaller
 *      cross-check so a silent change to any built-in script or to grading is caught.
 */

const ROOT = path.join(__dirname, '..', '..');
const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex');

describe('grading and classroom code do not depend on the canonical engine', () => {
  const GRADING_FILES = [
    'models/Submission.js', 'models/Assignment.js', 'models/TaskTemplate.js', 'models/Course.js',
    'routes/studentAssignments.js', 'routes/assignments.js', 'routes/taskTemplates.js', 'routes/teacherTemplates.js',
    'utils/sandbox.js', 'utils/ensureMvpTemplates.js', 'utils/gaiInsights.js', 'utils/gaiLlmService.js', 'data/mvpEduTemplates.js',
  ];

  it.each(GRADING_FILES)('%s never requires the engines layer', (file) => {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    expect(src).not.toMatch(/require\([^)]*engines/);
    expect(src).not.toMatch(/require\([^)]*engineVersions/);
  });

  it('the engines layer is pure: no Express, Mongoose, model or route imports', () => {
    const dir = path.join(ROOT, 'engines');
    const files = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      if (e.isDirectory()) { if (!['__tests__', 'fixtures'].includes(e.name)) walk(path.join(d, e.name)); } else if (e.name.endsWith('.js')) files.push(path.join(d, e.name));
    });
    walk(dir);
    expect(files.length).toBeGreaterThan(15);
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/require\(['"](express|mongoose|jsonwebtoken)['"]\)/);
      expect(src).not.toMatch(/require\(['"]\.\.\/(\.\.\/)?(models|routes|middleware)\//);
    }
  });
});

describe('built-in template scripts are pinned (a change must be deliberate)', () => {
  const PINNED = {
    'first-basic-task': { gen: 'f98dc1c8885ffbd4b4758a26f92e213583b8f404203456b839d83490f03b5549', sol: '8b3429a625ca6344a9b92ab8b248d3a9ba763405c58ae4f4d2de5b400e0932b6' },
    'second-basic-task': { gen: 'd0ad1cf803937178f1ee65914a376ce963494f2c83727c245391837d8a55f846', sol: 'd80b1de618a3b9344d75acd5d770b764c2bc46fb8cae22f3e55eb9c7828c4ed2' },
    'forward-intersection': { gen: '7a9c4ca28e968e39689ca06536f82658a8c0b18826b722f67385285b937ce9bc', sol: 'c04908ba3e69751e2df736feae1712790d231d8b0d6d899046d4409e26a6e4ad' }, // generator corrected in Milestone 2.1; the answer formula is unchanged
    resection: { gen: '49fb08acf81da072477bcc3fcd14d2e35e3bfc5e0121540191e305d02825a79b', sol: '7f04268a1fbe6b5e4251781f009b86d1b4905e850856d228f3f0337cd9777e35' }, // rebuilt in Milestone 2.1 (ground-truth answer, fail-closed solution script)
  };

  it('the four MVP calculator templates and their pinned generator/solution hashes', () => {
    const byTool = Object.fromEntries(MVP_EDU_TEMPLATES.map((t) => [t.toolKey, t]));
    expect(Object.keys(PINNED).sort()).toEqual(Object.keys(byTool).sort());
    for (const [tool, h] of Object.entries(PINNED)) {
      expect(sha(byTool[tool].generatorScript)).toBe(h.gen);
      expect(sha(byTool[tool].solutionScript)).toBe(h.sol);
    }
  });
});

// Deterministic evaluation of the template scripts (test-only; production runs them in the sandbox).
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
}
function sample(tool, n, seed = 20240519) {
  const t = MVP_EDU_TEMPLATES.find((x) => x.toolKey === tool);
  const M = Object.create(Math);
  M.random = seeded(seed);
  const generate = new Function('Math', t.generatorScript);
  const solve = new Function('inputData', t.solutionScript);
  return Array.from({ length: n }, () => {
    const input = generate(M);
    return { input, key: solve(input) };
  });
}

describe('template answer keys vs the canonical engine (characterization)', () => {
  it('first-basic-task: the key equals the engine for every generated input', () => {
    const engine = registry.getCurrentEngine('first-basic-task');
    for (const { input, key } of sample('first-basic-task', 300)) {
      const r = engine.run(input).resultData;
      expect(Math.abs(r.x2 - key.x2)).toBeLessThanOrEqual(0.0011);
      expect(Math.abs(r.y2 - key.y2)).toBeLessThanOrEqual(0.0011);
    }
  });

  it('second-basic-task: the key equals the engine (distance and alpha) for every generated input', () => {
    const engine = registry.getCurrentEngine('second-basic-task');
    for (const { input, key } of sample('second-basic-task', 300)) {
      const r = engine.run(input).resultData;
      expect(Math.abs(r.distance - key.distance)).toBeLessThanOrEqual(0.0011);
      expect(Math.abs(r.alpha - key.alpha)).toBeLessThanOrEqual(0.0011);
    }
  });

  it('forward-intersection (Milestone 2.1): the generator is aligned — every generated task is accepted by the calculator and matches the key', () => {
    const { SandboxExecutor } = require('../../utils/sandbox');
    const { splitGroundTruth } = require('../../utils/taskGroundTruth');
    const t = MVP_EDU_TEMPLATES.find((x) => x.toolKey === 'forward-intersection');
    const executor = new SandboxExecutor();
    const engine = registry.getCurrentEngine('forward-intersection');
    for (let seed = 1; seed <= 300; seed++) {
      const generated = executor.executeGenerator(t.generatorScript, 0, seed);
      expect(generated.success).toBe(true);
      const { inputData, groundTruth } = splitGroundTruth(generated.data);
      const r = engine.run(inputData).resultData; // never rejected any more
      expect(Math.abs(r.xP - groundTruth.xP)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(r.yP - groundTruth.yP)).toBeLessThanOrEqual(0.005);
      const key = executor.executeSolution(t.solutionScript, inputData).data; // the (unchanged) formula still agrees
      expect(Math.abs(r.xP - key.xP)).toBeLessThanOrEqual(0.0011);
      expect(Math.abs(r.yP - key.yP)).toBeLessThanOrEqual(0.0011);
      expect(inputData.beta1 + inputData.beta2).toBeLessThan(200);
    }
  });

  it('resection (Milestone 2.1): the previously pinned defect is gone — generated tasks are accepted by the v2 engine and reproduce the known station', () => {
    const { SandboxExecutor } = require('../../utils/sandbox');
    const { splitGroundTruth } = require('../../utils/taskGroundTruth');
    const t = MVP_EDU_TEMPLATES.find((x) => x.toolKey === 'resection');
    const executor = new SandboxExecutor();
    const engine = registry.getCurrentEngine('resection');
    for (let seed = 1; seed <= 300; seed++) {
      const generated = executor.executeGenerator(t.generatorScript, 0, seed);
      expect(generated.success).toBe(true);
      const { inputData, groundTruth } = splitGroundTruth(generated.data);
      const r = engine.run(inputData).resultData; // INCONSISTENT_ANGLES is no longer possible
      expect(Math.abs(r.xP - groundTruth.xP)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(r.yP - groundTruth.yP)).toBeLessThanOrEqual(0.005);
    }
  });

  it('the canonical engine did not silently change grading: the template key scripts are executed unchanged by the sandbox path', () => {
    const t = MVP_EDU_TEMPLATES.find((x) => x.toolKey === 'first-basic-task');
    const { input, key } = sample('first-basic-task', 1)[0];
    const { SandboxExecutor } = require('../../utils/sandbox');
    const executor = new SandboxExecutor();
    expect(typeof executor.executeSolution).toBe('function');
    const out = executor.executeSolution(t.solutionScript, input);
    expect(out.success).toBe(true);
    expect(out.data.x2).toBe(key.x2);
    expect(out.data.y2).toBe(key.y2);
  });
});
