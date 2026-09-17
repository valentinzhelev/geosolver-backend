// Integration-style test: uses the REAL utils/templateTrust.js (not mocked)
// together with the real TaskTemplate model methods, to prove the full
// execution path — not just the model's plumbing around a mocked trust
// decision (see TaskTemplate.security.test.js for that).
jest.mock('../User');

const User = require('../User');
const TaskTemplate = require('../TaskTemplate');

function buildTemplate(overrides = {}) {
  return new TaskTemplate({
    name: 'Test template',
    type: 'custom',
    description: 'desc',
    generatorScript: 'return { a: 1 };',
    solutionScript: 'return { b: 2 };',
    createdBy: '507f1f77bcf86cd799439011',
    ...overrides,
  });
}

describe('TaskTemplate execution: forged "builtin" tag from a non-admin teacher', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('CANNOT execute a template that has tags: ["builtin"] but was authored by a teacher and lacks isSystemTemplate', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });

    const forgedTemplate = buildTemplate({
      tags: ['tool:first-basic-task', 'builtin', 'mvp'],
      isSystemTemplate: false, // cannot be set via any HTTP request — see models/TaskTemplate.js
      // Scripts that would prove they ran if the guard were bypassed.
      generatorScript: 'throw new Error("SCRIPT_EXECUTED");',
      solutionScript: 'throw new Error("SCRIPT_EXECUTED");',
    });

    await expect(forgedTemplate.generateTestData(0, 1)).rejects.toThrow(/untrusted/i);
    await expect(forgedTemplate.generateSolution({})).rejects.toThrow(/untrusted/i);
  });

  it('DOES execute a genuine system-seeded template (isSystemTemplate: true), even if its owner is a teacher', async () => {
    // Mirrors ensureMvpTemplates.js's getSystemOwnerId() fallback: if no
    // admin exists yet, the seeded owner can legitimately be a teacher.
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });

    const genuineTemplate = buildTemplate({
      tags: ['tool:first-basic-task', 'builtin', 'mvp'],
      isSystemTemplate: true,
    });

    const inputData = await genuineTemplate.generateTestData(0, 1);
    expect(inputData).toEqual({ a: 1 });
    const solution = await genuineTemplate.generateSolution(inputData);
    expect(solution).toEqual({ b: 2 });
  });

  it('DOES execute a non-builtin template whose author currently holds the admin role', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'admin' }) });

    const adminTemplate = buildTemplate({ tags: ['custom'], isSystemTemplate: false });

    const inputData = await adminTemplate.generateTestData(0, 1);
    expect(inputData).toEqual({ a: 1 });
  });
});
