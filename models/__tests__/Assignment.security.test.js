// Verifies the OTHER execution trigger identified in the audit: an
// assignment referencing an untrusted TaskTemplate by ID must not be able
// to execute it via Assignment.generateVariants(), even though
// POST/PUT /api/teacher/tasks are now admin-only. Route authorization is
// not the security boundary — the execution-time guard inside
// TaskTemplate.generateTestData/generateSolution is. This test exercises
// that guard through the real assignment-creation/publish code path.
jest.mock('../User');

const User = require('../User');
const TaskTemplate = require('../TaskTemplate'); // registers the model
const Assignment = require('../Assignment');

function buildAssignment(overrides = {}) {
  const assignment = new Assignment({
    title: 'Test assignment',
    taskTemplate: '507f1f77bcf86cd799439099',
    course: '507f1f77bcf86cd799439088',
    variantsCount: 1,
    dueDate: new Date(Date.now() + 86400000),
    createdBy: '507f1f77bcf86cd799439011',
    ...overrides,
  });
  // Avoid touching a real database — generateVariants() calls this.save()
  // only after successfully building all variants.
  assignment.save = jest.fn().mockResolvedValue(assignment);
  return assignment;
}

function buildTemplate(overrides = {}) {
  return new TaskTemplate({
    name: 'Referenced template',
    type: 'custom',
    description: 'desc',
    generatorScript: 'return { a: 1 };',
    solutionScript: 'return { b: 2 };',
    createdBy: '507f1f77bcf86cd799439011',
    ...overrides,
  });
}

describe('Assignment.generateVariants(): cannot execute an untrusted template by referencing its ID', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('rejects when the referenced template is a forged "builtin" authored by a self-registered teacher', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });

    const forgedTemplate = buildTemplate({
      tags: ['tool:first-basic-task', 'builtin', 'mvp'],
      isSystemTemplate: false,
      createdBy: 'malicious-self-registered-teacher-id',
      generatorScript: 'throw new Error("SCRIPT_EXECUTED");',
    });
    jest.spyOn(TaskTemplate, 'findById').mockResolvedValue(forgedTemplate);

    const assignment = buildAssignment();

    await expect(assignment.generateVariants()).rejects.toThrow(/untrusted/i);
    // The attacker's script must never have run, and no variant/save happened.
    expect(assignment.variants).toHaveLength(0);
    expect(assignment.save).not.toHaveBeenCalled();
  });

  it('rejects when the referenced template exists in the DB but was authored by an ordinary (non-admin) teacher, regardless of tags', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });

    const preExistingTeacherTemplate = buildTemplate({
      tags: ['custom'],
      isSystemTemplate: false,
      createdBy: 'some-teacher-id',
    });
    jest.spyOn(TaskTemplate, 'findById').mockResolvedValue(preExistingTeacherTemplate);

    const assignment = buildAssignment();

    await expect(assignment.generateVariants()).rejects.toThrow(/untrusted/i);
    expect(assignment.save).not.toHaveBeenCalled();
  });

  it('still succeeds for a genuine system-seeded template referenced by ID', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'admin' }) });

    const genuineTemplate = buildTemplate({
      tags: ['tool:first-basic-task', 'builtin', 'mvp'],
      isSystemTemplate: true,
    });
    jest.spyOn(TaskTemplate, 'findById').mockResolvedValue(genuineTemplate);

    const assignment = buildAssignment();
    await assignment.generateVariants();

    expect(assignment.variants).toHaveLength(1);
    expect(assignment.variants[0].inputData).toEqual({ a: 1 });
    expect(assignment.variants[0].solution).toEqual({ b: 2 });
    expect(assignment.save).toHaveBeenCalledTimes(1);
  });
});
