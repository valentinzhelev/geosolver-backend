// Milestone 2.1 - Assignment variants are SNAPSHOTS. Upgrading a built-in template must never rewrite,
// regrade or regenerate anything that already exists; only assignments created afterwards use the
// corrected generator.
jest.mock('../User');

const fs = require('fs');
const path = require('path');
const User = require('../User');
const TaskTemplate = require('../TaskTemplate');
const Assignment = require('../Assignment');
const Submission = require('../Submission');
const registry = require('../../engines/registry');
const { ensureMvpTemplates } = require('../../utils/ensureMvpTemplates');
const legacy = require('../../utils/__tests__/fixtures/legacyMvpScripts.json');

const OWNER = '507f1f77bcf86cd799439011';

function storedOldTemplate(toolKey) {
  return new TaskTemplate({
    name: toolKey, type: toolKey === 'resection' ? 'resection' : 'forward-intersection', description: legacy[toolKey].description,
    generatorScript: legacy[toolKey].generatorScript, solutionScript: legacy[toolKey].solutionScript,
    gradingSettings: legacy[toolKey].gradingSettings, tags: [`tool:${toolKey}`, 'builtin', 'mvp'],
    createdBy: OWNER, isPublic: true, isSystemTemplate: true,
  });
}

const generate = async (template, count) => {
  jest.spyOn(TaskTemplate, 'findById').mockResolvedValue(template);
  const fake = { taskTemplate: 'tpl', variantsCount: count, variants: [], save: jest.fn(async function save() { return this; }) };
  await Assignment.schema.methods.generateVariants.call(fake);
  TaskTemplate.findById.mockRestore();
  return fake;
};

afterEach(() => jest.restoreAllMocks());

describe.each(['forward-intersection', 'resection'])('%s: existing Assignment snapshots survive a template upgrade', (toolKey) => {
  async function upgradeTemplate(template) {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: OWNER }) });
    jest.spyOn(TaskTemplate, 'findOne').mockImplementation(async ({ tags }) => (tags === `tool:${toolKey}` ? template : null));
    jest.spyOn(TaskTemplate.prototype, 'save').mockResolvedValue(undefined);
    return ensureMvpTemplates();
  }

  it('old variants are byte-identical after the upgrade, still graded against their STORED solution; a new assignment uses the corrected generator', async () => {
    const template = storedOldTemplate(toolKey);
    const oldAssignment = await generate(template, 5);
    const snapshotBefore = JSON.stringify(oldAssignment.variants);
    expect(snapshotBefore).not.toContain('__groundTruth'); // the old generator never had one

    const { upgraded } = await upgradeTemplate(template);
    expect(upgraded).toBe(1);
    expect(template.generatorScript).toContain('__groundTruth'); // the template itself DID change

    // (a) nothing about the existing assignment moved
    expect(JSON.stringify(oldAssignment.variants)).toBe(snapshotBefore);
    expect(oldAssignment.save).toHaveBeenCalledTimes(1); // only the original generation

    // (b) a submission for an existing variant is graded against the STORED solution (autoGrade reads it from the assignment)
    const stored = oldAssignment.variants[2];
    const grader = new Submission({ assignment: OWNER, student: OWNER, variantIndex: 2, answers: { ...stored.solution }, timeSpent: 1, attemptNumber: 1 });
    const gradingAssignment = { getVariant: (i) => oldAssignment.variants.find((v) => v.variantIndex === i), settings: {} };
    grader.autoGrade(gradingAssignment, { gradingSettings: { tolerance: 0.01, toleranceType: 'absolute' } });
    expect(grader.computedScore).toBe(100);

    // (c) a NEW assignment after the upgrade uses the corrected generator and its ground-truth solutions
    const fresh = await generate(template, 5);
    expect(fresh.variants).toHaveLength(5);
    for (const v of fresh.variants) {
      expect(JSON.stringify(v.inputData)).not.toContain('__');
      const engineResult = registry.getCurrentEngine(toolKey).run(v.inputData).resultData;
      expect(Math.abs(engineResult.xP - v.solution.xP)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(engineResult.yP - v.solution.yP)).toBeLessThanOrEqual(0.005);
    }
    // ... and generating the new assignment did not touch the old one
    expect(JSON.stringify(oldAssignment.variants)).toBe(snapshotBefore);
  });
});

describe('no code path regenerates variants that already exist', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'assignments.js'), 'utf8');

  it('generateVariants() (which resets the array) is only called for a brand-new non-draft assignment or when the assignment has NO variants', () => {
    const calls = [...src.matchAll(/assignment\.generateVariants\(\)/g)].map((m) => m.index);
    expect(calls).toHaveLength(3);
    const contexts = calls.map((i) => src.slice(Math.max(0, i - 160), i));
    expect(contexts.filter((c) => /variants\.length === 0/.test(c))).toHaveLength(2);
    expect(contexts.filter((c) => /new Assignment\(|const isDraft/.test(c))).toHaveLength(1);
  });

  it('nothing outside routes/assignments.js and a manual seed script calls generateVariants (so a template upgrade cannot trigger it)', () => {
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
    const callers = walk(ROOT).filter((f) => /\.generateVariants\(/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.relative(ROOT, f).replace(/\\/g, '/'));
    // scripts/seed-teacher-panel.js is a manual dev-seed script (never required by the server) that builds fresh assignments
    expect(callers).toEqual(['routes/assignments.js', 'scripts/seed-teacher-panel.js']);
  });
});
