jest.mock('../../models/User');
jest.mock('../../models/TaskTemplate', () => {
  const mockCtor = jest.fn().mockImplementation((data) => ({
    ...data,
    _id: `new-${(data.tags && data.tags[0]) || 'id'}`,
    save: jest.fn().mockResolvedValue(undefined),
  }));
  mockCtor.findOne = jest.fn();
  return mockCtor;
});

const User = require('../../models/User');
const TaskTemplate = require('../../models/TaskTemplate');
const { ensureMvpTemplates, MVP_EDU_TEMPLATES } = require('../ensureMvpTemplates');

function defFor(toolKey) {
  return MVP_EDU_TEMPLATES.find((d) => d.toolKey === toolKey);
}

describe('ensureMvpTemplates() backfill: per-tool canonical script matching', () => {
  let warnSpy;

  beforeEach(() => {
    User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'admin-id' }) });
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllMocks();
    warnSpy.mockRestore();
  });

  it('creates a genuine isSystemTemplate: true row for every tool when none exist yet', async () => {
    TaskTemplate.findOne.mockResolvedValue(null);

    const { created } = await ensureMvpTemplates();

    expect(created).toBe(MVP_EDU_TEMPLATES.length);
    for (const call of TaskTemplate.mock.calls) {
      expect(call[0].isSystemTemplate).toBe(true);
    }
  });

  it('does NOT promote an existing row whose scripts belong to a DIFFERENT tool (cross-tool mismatch)', async () => {
    const firstTaskTag = `tool:${defFor('first-basic-task').toolKey}`;
    const wrongContentTemplate = {
      _id: 'impostor-id',
      // Tagged as first-basic-task, but carries second-basic-task's scripts —
      // proves the check is per-tool, not "any known-good GeoSolver script".
      generatorScript: defFor('second-basic-task').generatorScript.trim(),
      solutionScript: defFor('second-basic-task').solutionScript.trim(),
      isSystemTemplate: false,
      save: jest.fn().mockResolvedValue(undefined),
    };

    TaskTemplate.findOne.mockImplementation((query) => {
      if (query.tags === firstTaskTag) return Promise.resolve(wrongContentTemplate);
      return Promise.resolve(null);
    });

    await ensureMvpTemplates();

    expect(wrongContentTemplate.isSystemTemplate).toBe(false);
    expect(wrongContentTemplate.save).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(firstTaskTag));
  });

  it('promotes an existing legacy row for the SAME tool whose scripts exactly match canonical', async () => {
    const resectionTag = `tool:${defFor('resection').toolKey}`;
    const legacyGenuineTemplate = {
      _id: 'legacy-id',
      generatorScript: defFor('resection').generatorScript.trim(),
      solutionScript: defFor('resection').solutionScript.trim(),
      isSystemTemplate: false,
      save: jest.fn().mockResolvedValue(undefined),
    };

    TaskTemplate.findOne.mockImplementation((query) => {
      if (query.tags === resectionTag) return Promise.resolve(legacyGenuineTemplate);
      return Promise.resolve(null);
    });

    await ensureMvpTemplates();

    expect(legacyGenuineTemplate.isSystemTemplate).toBe(true);
    expect(legacyGenuineTemplate.save).toHaveBeenCalledTimes(1);
  });
});
