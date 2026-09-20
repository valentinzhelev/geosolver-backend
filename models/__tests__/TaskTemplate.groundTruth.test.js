// Milestone 2.1: ground truth is carried server-side ONLY, and the Milestone 0 trust gate is intact.
jest.mock('../User');

const crypto = require('crypto');
const User = require('../User');
const TaskTemplate = require('../TaskTemplate');
const Assignment = require('../Assignment');
const registry = require('../../engines/registry');
const { MVP_EDU_TEMPLATES } = require('../../data/mvpEduTemplates');

const OWNER = '507f1f77bcf86cd799439011';

function build(overrides = {}) {
  return new TaskTemplate({
    name: 'T',
    type: 'custom',
    description: 'd',
    generatorScript: 'return { a: 1, __groundTruth: { xP: 5.5, yP: -2 } };',
    solutionScript: 'throw new Error("SOLUTION_SCRIPT_EXECUTED");',
    createdBy: OWNER,
    ...overrides,
  });
}

afterEach(() => jest.clearAllMocks());

describe('TaskTemplate.generateVariantData', () => {
  it('a TRUSTED template: inputData has no ground truth, the solution IS the ground truth, and the solutionScript never runs', async () => {
    const t = build({ isSystemTemplate: true });
    const { inputData, solution } = await t.generateVariantData(0, 1);
    expect(inputData).toEqual({ a: 1 });
    expect(solution).toEqual({ xP: 5.5, yP: -2 });
    // (the solutionScript throws when executed — reaching here proves it was not)
  });

  it('a trusted template WITHOUT ground truth still uses its solutionScript exactly as before', async () => {
    const t = build({ isSystemTemplate: true, generatorScript: 'return { a: 2 };', solutionScript: 'return { b: inputData.a * 10 };' });
    const { inputData, solution } = await t.generateVariantData(0, 1);
    expect(inputData).toEqual({ a: 2 });
    expect(solution).toEqual({ b: 20 });
  });

  it('a generator that smuggles hidden data under ANOTHER reserved key fails closed', async () => {
    const t = build({ isSystemTemplate: true, generatorScript: 'return { a: 1, __answer: { xP: 1 } };' });
    await expect(t.generateVariantData(0, 1)).rejects.toThrow(/reserved key/);
  });

  it('a malformed ground truth fails closed', async () => {
    const t = build({ isSystemTemplate: true, generatorScript: 'return { a: 1, __groundTruth: "nope" };' });
    await expect(t.generateVariantData(0, 1)).rejects.toThrow(/finite numbers/);
  });
});

describe('SECURITY: the Milestone 0 trust gate still guards the new path', () => {
  it('a teacher-authored template with a forged "builtin" tag is NEVER executed, even one that returns a ground truth', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });
    const forged = build({
      tags: ['tool:resection', 'builtin', 'mvp'],
      isSystemTemplate: false,
      generatorScript: 'throw new Error("GENERATOR_EXECUTED");',
    });
    await expect(forged.generateVariantData(0, 1)).rejects.toThrow(/untrusted/i);
  });

  it('isSystemTemplate is not settable through the request-body allow-lists of the template routes', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'routes', 'taskTemplates.js'), 'utf8');
    expect(src).not.toMatch(/req\.body[^;]*isSystemTemplate/);
    expect(src).not.toMatch(/isSystemTemplate\s*[:=]/);
  });
});

describe('the REAL built-in templates through the REAL model methods', () => {
  const real = (toolKey) => {
    const def = MVP_EDU_TEMPLATES.find((d) => d.toolKey === toolKey);
    return new TaskTemplate({
      name: def.name, type: def.type, description: def.description, generatorScript: def.generatorScript.trim(),
      solutionScript: def.solutionScript.trim(), gradingSettings: def.gradingSettings, tags: def.tags,
      createdBy: OWNER, isPublic: true, isSystemTemplate: true,
    });
  };

  it.each(['forward-intersection', 'resection'])('%s: student data carries no answer and the stored solution is the station the canonical engine reproduces', async (toolKey) => {
    const template = real(toolKey);
    for (let i = 0; i < 25; i++) {
      const { inputData, solution } = await template.generateVariantData(i, 1000 + i);
      expect(Object.keys(inputData)).not.toContain('__groundTruth');
      expect(inputData).not.toHaveProperty('xP');
      expect(Object.keys(solution).sort()).toEqual(['xP', 'yP']);
      const engineResult = registry.getCurrentEngine(toolKey).run(inputData).resultData;
      expect(Math.abs(engineResult.xP - solution.xP)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(engineResult.yP - solution.yP)).toBeLessThanOrEqual(0.005);
    }
  });

  it('the Resection solutionScript fails closed if anything calls it directly', async () => {
    const template = real('resection');
    await expect(template.generateSolution({ xA: 1 })).rejects.toThrow(/ground truth/);
  });
});

describe('Assignment.generateVariants stores the split result', () => {
  it('variants keep only measurements in inputData; solution + solutionHash are server-side; the student projection has no answer', async () => {
    const template = new TaskTemplate({
      name: 'Resection', type: 'resection', description: 'd', createdBy: OWNER, isSystemTemplate: true,
      generatorScript: MVP_EDU_TEMPLATES.find((d) => d.toolKey === 'resection').generatorScript.trim(),
      solutionScript: MVP_EDU_TEMPLATES.find((d) => d.toolKey === 'resection').solutionScript.trim(),
    });
    jest.spyOn(TaskTemplate, 'findById').mockResolvedValue(template);
    const fake = { taskTemplate: 'tpl', variantsCount: 4, variants: [], save: jest.fn(async function save() { return this; }) };

    await Assignment.schema.methods.generateVariants.call(fake);

    expect(fake.variants).toHaveLength(4);
    for (const v of fake.variants) {
      expect(Object.keys(v.inputData).sort()).toEqual(['beta1', 'beta2', 'xA', 'xB', 'xC', 'yA', 'yB', 'yC']);
      expect(Object.keys(v.solution).sort()).toEqual(['xP', 'yP']);
      expect(v.solutionHash).toBe(crypto.createHash('sha256').update(JSON.stringify(v.solution)).digest('hex'));
      const engineResult = registry.getCurrentEngine('resection').run(v.inputData).resultData;
      expect(Math.abs(engineResult.xP - v.solution.xP)).toBeLessThanOrEqual(0.005);
    }
    // exactly what the student routes forward: variantIndex + inputData
    const studentView = JSON.stringify(fake.variants.map((v) => ({ variantIndex: v.variantIndex, inputData: v.inputData })));
    expect(studentView).not.toContain('__groundTruth');
    expect(studentView).not.toContain('"xP"');
    expect(studentView).not.toContain('"yP"');
    expect(fake.save).toHaveBeenCalledTimes(1);
    TaskTemplate.findById.mockRestore();
  });

  it('an untrusted template still cannot generate variants', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });
    const untrusted = build({ isSystemTemplate: false, generatorScript: 'return { a: 1, __groundTruth: { xP: 1 } };' });
    jest.spyOn(TaskTemplate, 'findById').mockResolvedValue(untrusted);
    const fake = { taskTemplate: 'tpl', variantsCount: 1, variants: [], save: jest.fn() };
    await expect(Assignment.schema.methods.generateVariants.call(fake)).rejects.toThrow(/untrusted/i);
    expect(fake.save).not.toHaveBeenCalled();
    TaskTemplate.findById.mockRestore();
  });
});
