const User = require('../models/User');

/**
 * Milestone 0 security gate: TaskTemplate generatorScript/solutionScript run
 * through Node's `vm` module (utils/sandbox.js), which is NOT a security
 * boundary. Until that sandbox is replaced, execution must be restricted to
 * templates authored (or currently owned) by a trusted party.
 *
 * A template is trusted if either:
 *  - `isSystemTemplate === true` (set exclusively, server-side, by
 *    utils/ensureMvpTemplates.js — this field is never present in any
 *    request-body allow-list in routes/taskTemplates.js, so no HTTP caller,
 *    including an admin, can set it), or
 *  - its `createdBy` user currently holds the `admin` role.
 *
 * IMPORTANT: `tags` (and `isPublic`, `paramsSchema`) are ordinary
 * client-writable fields — a self-registered teacher could set
 * `tags: ["builtin"]` on their own template before this trust model
 * existed (routes/taskTemplates.js destructures `tags` straight from
 * req.body with no allow-list). Do NOT reintroduce a tag-based (or any
 * other client-suppliable field-based) trust check here — it is
 * forgeable and was never a security boundary.
 *
 * Anything else (in particular: any template authored by a self-registered
 * `teacher` account, regardless of what tags it carries) is untrusted and
 * must not be executed.
 */
async function isTaskTemplateTrusted(template) {
  if (!template) return false;

  if (template.isSystemTemplate === true) {
    return true;
  }

  if (!template.createdBy) return false;

  const author = await User.findById(template.createdBy).select('role');
  return Boolean(author && author.role === 'admin');
}

module.exports = { isTaskTemplateTrusted };
