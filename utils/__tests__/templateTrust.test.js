jest.mock('../../models/User');

const User = require('../../models/User');
const { isTaskTemplateTrusted } = require('../templateTrust');

describe('isTaskTemplateTrusted', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('trusts a genuine system-seeded template (isSystemTemplate === true) regardless of author role', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });

    // Mirrors utils/ensureMvpTemplates.js's fallback: the "system owner" can
    // legitimately be an ordinary teacher account if no admin exists yet.
    const template = { isSystemTemplate: true, tags: ['tool:first-basic-task', 'builtin', 'mvp'], createdBy: 'u1' };
    await expect(isTaskTemplateTrusted(template)).resolves.toBe(true);
    // Trust is decided from the server-only flag alone; no need to look up the author.
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('trusts a template whose author currently holds the admin role', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'admin' }) });

    const template = { isSystemTemplate: false, tags: ['custom'], createdBy: 'admin-user-id' };
    await expect(isTaskTemplateTrusted(template)).resolves.toBe(true);
    expect(User.findById).toHaveBeenCalledWith('admin-user-id');
  });

  it('does not trust a non-system template authored by a teacher', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });

    const template = { isSystemTemplate: false, tags: ['custom'], createdBy: 'self-registered-teacher-id' };
    await expect(isTaskTemplateTrusted(template)).resolves.toBe(false);
  });

  // Regression test for the forgeable-tag design flaw: `tags` is plain
  // client-writable input (routes/taskTemplates.js destructures it straight
  // from req.body with no allow-list). Before this fix, a self-registered
  // teacher could have set tags: ["builtin"] on their own malicious
  // template. That must NOT grant trust.
  it('does NOT trust a forged "builtin" tag on a teacher-authored template', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue({ role: 'teacher' }) });

    const forgedTemplate = {
      // isSystemTemplate intentionally absent/false — this field cannot be
      // set via any HTTP request, so a forged row from before this fix
      // (or any row not created by utils/ensureMvpTemplates.js) will never
      // have it.
      tags: ['tool:first-basic-task', 'builtin', 'mvp'],
      createdBy: 'malicious-self-registered-teacher-id',
      generatorScript: 'throw new Error("SCRIPT_EXECUTED");',
      solutionScript: 'throw new Error("SCRIPT_EXECUTED");',
    };

    await expect(isTaskTemplateTrusted(forgedTemplate)).resolves.toBe(false);
  });

  it('does not trust a template whose author no longer exists', async () => {
    User.findById.mockReturnValue({ select: jest.fn().mockResolvedValue(null) });

    const template = { isSystemTemplate: false, tags: [], createdBy: 'deleted-user-id' };
    await expect(isTaskTemplateTrusted(template)).resolves.toBe(false);
  });

  it('does not trust a template with no createdBy and no system flag', async () => {
    const template = { isSystemTemplate: false, tags: [], createdBy: null };
    await expect(isTaskTemplateTrusted(template)).resolves.toBe(false);
    expect(User.findById).not.toHaveBeenCalled();
  });

  it('returns false for a missing template', async () => {
    await expect(isTaskTemplateTrusted(null)).resolves.toBe(false);
  });
});
