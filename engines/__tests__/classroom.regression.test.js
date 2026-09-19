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
 *   3. the KNOWN DEFECT is pinned: the built-in Resection template's answer key agrees with the
 *      engine for none of its own generated inputs. That is a DEPLOYMENT BLOCKER for the later
 *      release train (see the report); it is NOT fixed here and must not be fixed inside the engine.
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
    'forward-intersection': { gen: '17b9e90ccf9a40abedecdf0bec528816a3b725da33576f328773da5eeda02539', sol: 'c04908ba3e69751e2df736feae1712790d231d8b0d6d899046d4409e26a6e4ad' },
    resection: { gen: '6ae4e9d6ce618f839b924eae30d8af95db1640dfa3af793b863fcd70a9706229', sol: 'adb946cd63459ea54b8d9422d4d763562b6ff9c46944f5c545e83dc2900e7a1e' },
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

  it('forward-intersection: identical formula, BUT the generator can produce angle pairs the calculator rejects (sum >= 200 gon)', () => {
    const engine = registry.getCurrentEngine('forward-intersection');
    let accepted = 0;
    let rejected = 0;
    for (const { input, key } of sample('forward-intersection', 400)) {
      let r;
      try {
        r = engine.run(input).resultData;
      } catch (e) {
        expect(e.code).toBe('ANGLE_SUM_TOO_LARGE');
        rejected += 1;
        continue;
      }
      accepted += 1;
      expect(Math.abs(r.xP - key.xP)).toBeLessThanOrEqual(0.0011);
      expect(Math.abs(r.yP - key.yP)).toBeLessThanOrEqual(0.0011);
    }
    expect(accepted).toBeGreaterThan(200);
    expect(rejected).toBeGreaterThan(0); // pre-existing: the frontend domain already rejected these; the engine simply matches it
  });

  it('KNOWN DEFECT (pinned, deployment blocker): the built-in Resection key agrees with the v2 engine for NONE of its own generated inputs', () => {
    const engine = registry.getCurrentEngine('resection');
    let accepted = 0;
    let rejected = 0;
    let agree = 0;
    for (const { input, key } of sample('resection', 500)) {
      let r;
      try {
        r = engine.run(input).resultData;
      } catch (e) {
        expect(e.code).toBe('INCONSISTENT_ANGLES');
        rejected += 1;
        continue;
      }
      accepted += 1;
      if (Math.hypot(r.xP - key.xP, r.yP - key.yP) < 0.01) agree += 1;
    }
    expect(accepted).toBeGreaterThan(400); // v2 accepts most generated inputs...
    expect(rejected).toBeGreaterThan(0); // ...and rejects a share of them as INCONSISTENT_ANGLES...
    expect(agree).toBe(0); // ...but the answer key never matches. If this fails, the template OR the engine changed on purpose: review grading.
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
