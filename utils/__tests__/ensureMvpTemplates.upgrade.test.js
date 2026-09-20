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

const crypto = require('crypto');
const User = require('../../models/User');
const TaskTemplate = require('../../models/TaskTemplate');
const { ensureMvpTemplates, MVP_EDU_TEMPLATES } = require('../ensureMvpTemplates');
const { SUPERSEDED_DEFINITIONS } = require('../../data/mvpEduTemplates');
const legacy = require('./fixtures/legacyMvpScripts.json');

/**
 * Milestone 2.1 controlled update: ensureMvpTemplates used to NEVER touch an existing system template,
 * so a corrected built-in would not reach a database that already held the old one. It now upgrades a
 * stored template ONLY when both scripts are byte-for-byte a KNOWN superseded built-in definition.
 * Already-created Assignments are unaffected (their variants are snapshots) — see the last describe.
 */

const sha = (s) => crypto.createHash('sha256').update(s.trim().replace(/\r\n/g, '\n')).digest('hex');
const def = (toolKey) => MVP_EDU_TEMPLATES.find((d) => d.toolKey === toolKey);

function stored(toolKey, overrides = {}) {
  return {
    _id: `stored-${toolKey}`,
    name: def(toolKey).name,
    tags: def(toolKey).tags,
    isPublic: true,
    isSystemTemplate: true,
    usageCount: 7,
    description: 'previous description',
    generatorScript: def(toolKey).generatorScript.trim(),
    solutionScript: def(toolKey).solutionScript.trim(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
const oldRow = (toolKey, overrides = {}) => stored(toolKey, {
  description: legacy[toolKey].description,
  generatorScript: legacy[toolKey].generatorScript,
  solutionScript: legacy[toolKey].solutionScript,
  gradingSettings: legacy[toolKey].gradingSettings,
  ...overrides,
});

// findOne answers per tool tag
function mockDatabase(rows) {
  TaskTemplate.findOne.mockImplementation(async ({ tags }) => rows[tags.replace('tool:', '')] || null);
}

let warn;
beforeEach(() => {
  User.findOne.mockReturnValue({ select: jest.fn().mockResolvedValue({ _id: 'admin-id' }) });
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  jest.clearAllMocks();
  warn.mockRestore();
});

describe('the superseded definitions are exactly the previous built-ins', () => {
  it.each(['forward-intersection', 'resection'])('%s: the recorded hashes match the previous scripts (fixture from the pre-2.1 commit)', (toolKey) => {
    const entry = SUPERSEDED_DEFINITIONS[toolKey];
    expect(entry).toHaveLength(1);
    expect(sha(legacy[toolKey].generatorScript)).toBe(entry[0].generatorSha256);
    expect(sha(legacy[toolKey].solutionScript)).toBe(entry[0].solutionSha256);
  });

  it('only the two corrected tools have superseded entries; the current definitions are never listed as superseded', () => {
    expect(Object.keys(SUPERSEDED_DEFINITIONS).sort()).toEqual(['forward-intersection', 'resection']);
    for (const [toolKey, entries] of Object.entries(SUPERSEDED_DEFINITIONS)) {
      for (const e of entries) {
        expect(e.generatorSha256).not.toBe(sha(def(toolKey).generatorScript));
      }
    }
  });
});

describe('upgrading an existing SYSTEM template that holds a known superseded definition', () => {
  it('Resection: scripts, description, grading and params are replaced by the current built-in; trust stays; other fields untouched', async () => {
    const row = oldRow('resection');
    mockDatabase({ resection: row });
    const { upgraded, created } = await ensureMvpTemplates();

    expect(upgraded).toBe(1);
    expect(created).toBe(MVP_EDU_TEMPLATES.length - 1); // every other tool is created fresh in this mocked empty database
    expect(row.generatorScript).toBe(def('resection').generatorScript.trim());
    expect(row.solutionScript).toBe(def('resection').solutionScript.trim());
    expect(row.description).toBe(def('resection').description);
    expect(row.paramsSchema).toEqual({ toolKey: 'resection', toolRoute: def('resection').toolRoute, answerKeys: ['xP', 'yP'] });
    expect(row.isSystemTemplate).toBe(true);
    expect(row.usageCount).toBe(7); // unrelated fields are not touched
    expect(row.name).toBe(def('resection').name);
    expect(row.save).toHaveBeenCalledTimes(1);
  });

  it('Forward Intersection: the generator is replaced; the unchanged answer formula stays identical', async () => {
    const row = oldRow('forward-intersection');
    mockDatabase({ 'forward-intersection': row });
    const { upgraded } = await ensureMvpTemplates();
    expect(upgraded).toBe(1);
    expect(row.generatorScript).toBe(def('forward-intersection').generatorScript.trim());
    expect(row.generatorScript).toContain('__groundTruth');
    expect(row.solutionScript).toBe(legacy['forward-intersection'].solutionScript); // byte-identical to before
  });

  it('a template that is ALREADY current is not saved again (idempotent)', async () => {
    const rows = { resection: stored('resection'), 'forward-intersection': stored('forward-intersection') };
    mockDatabase(rows);
    const { upgraded } = await ensureMvpTemplates();
    expect(upgraded).toBe(0);
    expect(rows.resection.save).not.toHaveBeenCalled();
    expect(rows['forward-intersection'].save).not.toHaveBeenCalled();
  });

  it('running it twice upgrades once (the second run sees the current definition)', async () => {
    const row = oldRow('resection');
    mockDatabase({ resection: row });
    await ensureMvpTemplates();
    row.save.mockClear();
    const second = await ensureMvpTemplates();
    expect(second.upgraded).toBe(0);
    expect(row.save).not.toHaveBeenCalled();
  });

});

describe('provenance: the upgrade needs ALL of (trusted system flag) + (exact superseded scripts)', () => {
  it.each([false, undefined, null, 'true', 1])('a row whose isSystemTemplate is %p is NOT upgraded and NOT trusted (old scripts are no longer the current definition, so no backfill either)', async (flag) => {
    const row = oldRow('resection', { isSystemTemplate: flag });
    mockDatabase({ resection: row });
    const { upgraded } = await ensureMvpTemplates();
    expect(upgraded).toBe(0);
    expect(row.save).not.toHaveBeenCalled();
    expect(row.generatorScript).toBe(legacy.resection.generatorScript);
    expect(row.isSystemTemplate).toBe(flag);
  });

  it('a teacher/custom template with exact old scripts but a forged builtin tag and no trust flag is left completely alone', async () => {
    const forged = oldRow('forward-intersection', { isSystemTemplate: false, tags: ['tool:forward-intersection', 'builtin', 'mvp'], createdBy: 'some-teacher' });
    mockDatabase({ 'forward-intersection': forged });
    expect((await ensureMvpTemplates()).upgraded).toBe(0);
    expect(forged.save).not.toHaveBeenCalled();
    expect(forged.isSystemTemplate).toBe(false);
  });

  it('tags / name / owner are irrelevant: a TRUSTED row with edited scripts is not upgraded whatever its tags say', async () => {
    const edited = oldRow('forward-intersection', { tags: ['builtin', 'mvp', 'tool:forward-intersection'], generatorScript: legacy['forward-intersection'].generatorScript + '\n' });
    // trailing whitespace is normalised (same script), so change a real character
    edited.generatorScript = edited.generatorScript.replace('return', 'return /* x */');
    mockDatabase({ 'forward-intersection': edited });
    expect((await ensureMvpTemplates()).upgraded).toBe(0);
    expect(edited.save).not.toHaveBeenCalled();
  });

  it('upgrading one tool leaves every unrelated built-in byte-identical and un-saved', async () => {
    const rows = {
      resection: oldRow('resection'),
      'first-basic-task': stored('first-basic-task'),
      'second-basic-task': stored('second-basic-task'),
      'forward-intersection': stored('forward-intersection'),
    };
    const before = JSON.stringify({ a: rows['first-basic-task'], b: rows['second-basic-task'], c: rows['forward-intersection'] });
    mockDatabase(rows);
    const { upgraded } = await ensureMvpTemplates();
    expect(upgraded).toBe(1);
    expect(JSON.stringify({ a: rows['first-basic-task'], b: rows['second-basic-task'], c: rows['forward-intersection'] })).toBe(before);
    for (const k of ['first-basic-task', 'second-basic-task', 'forward-intersection']) expect(rows[k].save).not.toHaveBeenCalled();
  });

  it('the client can never manufacture isSystemTemplate (route allow-lists + model trust gate are covered by taskTemplates.security / TaskTemplate.groundTruth tests; the upgrade branch reads it, never writes it)', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'ensureMvpTemplates.js'), 'utf8');
    const upgradeBranch = src.slice(src.indexOf('} else if (template.isSystemTemplate === true'), src.indexOf('} else if (!template.isSystemTemplate)'));
    expect(upgradeBranch).toContain('template.isSystemTemplate === true');
    expect(upgradeBranch).not.toMatch(/isSystemTemplate\s*=[^=]/);
  });
});

describe('NEVER overwrites anything that is not an exact known built-in (Milestone 0 trust model intact)', () => {
  it('a system template whose scripts were EDITED is left alone', async () => {
    const edited = oldRow('resection', { generatorScript: legacy.resection.generatorScript + '\n// edited by an admin' });
    mockDatabase({ resection: edited });
    const { upgraded } = await ensureMvpTemplates();
    expect(upgraded).toBe(0);
    expect(edited.save).not.toHaveBeenCalled();
    expect(edited.generatorScript).toContain('edited by an admin');
  });

  it('a matching generator with a DIFFERENT solution script is not an exact match (both scripts must match)', async () => {
    const half = oldRow('resection', { solutionScript: 'return { xP: 0, yP: 0 };' });
    mockDatabase({ resection: half });
    expect((await ensureMvpTemplates()).upgraded).toBe(0);
    expect(half.save).not.toHaveBeenCalled();
  });

  it('a forged untrusted row (teacher tag collision, foreign scripts) stays untrusted and unmodified', async () => {
    const forged = stored('resection', { isSystemTemplate: false, generatorScript: 'return { forged: true };', solutionScript: 'return {};' });
    mockDatabase({ resection: forged });
    const { upgraded } = await ensureMvpTemplates();
    expect(upgraded).toBe(0);
    expect(forged.isSystemTemplate).toBe(false);
    expect(forged.generatorScript).toBe('return { forged: true };');
    expect(forged.save).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('the first and second task templates are never upgraded (they have no superseded definitions)', async () => {
    const rows = { 'first-basic-task': stored('first-basic-task'), 'second-basic-task': stored('second-basic-task') };
    mockDatabase(rows);
    expect((await ensureMvpTemplates()).upgraded).toBe(0);
    expect(rows['first-basic-task'].save).not.toHaveBeenCalled();
  });

  it('a fresh database still creates genuine system templates with the CURRENT definitions', async () => {
    mockDatabase({});
    const { created, upgraded } = await ensureMvpTemplates();
    expect(created).toBe(MVP_EDU_TEMPLATES.length);
    expect(upgraded).toBe(0);
    for (const call of TaskTemplate.mock.calls) expect(call[0].isSystemTemplate).toBe(true);
    const resectionCreate = TaskTemplate.mock.calls.map((c) => c[0]).find((d) => d.tags.includes('tool:resection'));
    expect(resectionCreate.generatorScript).toContain('__groundTruth');
  });
});

describe('what the upgrade does NOT touch', () => {
  it('the upgrade code only assigns template fields — it has no access to Assignments or Submissions', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'ensureMvpTemplates.js'), 'utf8');
    expect(src).not.toMatch(/require\([^)]*(Assignment|Submission|Course)/);
  });
});
