jest.mock('../../utils/templateTrust');

const { isTaskTemplateTrusted } = require('../../utils/templateTrust');
const TaskTemplate = require('../TaskTemplate');

function buildTemplate(overrides = {}) {
  return new TaskTemplate({
    name: 'Test template',
    type: 'custom',
    description: 'desc',
    generatorScript: 'return { a: 1 };',
    solutionScript: 'return { b: inputData.a + 1 };',
    createdBy: '507f1f77bcf86cd799439011',
    ...overrides,
  });
}

describe('TaskTemplate script execution trust gate', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('runs the generator/solution scripts when the template is trusted', async () => {
    isTaskTemplateTrusted.mockResolvedValue(true);

    const template = buildTemplate();
    const inputData = await template.generateTestData(0, 1);
    expect(inputData).toEqual({ a: 1 });

    const solution = await template.generateSolution(inputData);
    expect(solution).toEqual({ b: 2 });
  });

  it('refuses to run the generator script when the template is untrusted', async () => {
    isTaskTemplateTrusted.mockResolvedValue(false);

    const template = buildTemplate({
      // A script that would prove it ran if the gate were bypassed.
      generatorScript: 'throw new Error("SCRIPT_EXECUTED");',
    });

    await expect(template.generateTestData(0, 1)).rejects.toThrow(/untrusted/i);
  });

  it('refuses to run the solution script when the template is untrusted', async () => {
    isTaskTemplateTrusted.mockResolvedValue(false);

    const template = buildTemplate({
      solutionScript: 'throw new Error("SCRIPT_EXECUTED");',
    });

    await expect(template.generateSolution({ a: 1 })).rejects.toThrow(/untrusted/i);
  });
});
