const TaskTemplate = require('../models/TaskTemplate');
const User = require('../models/User');
const { MVP_EDU_TEMPLATES } = require('../data/mvpEduTemplates');

async function getSystemOwnerId() {
  const admin = await User.findOne({ role: 'admin' }).select('_id');
  if (admin) return admin._id;
  const teacher = await User.findOne({ role: 'teacher' }).select('_id');
  if (teacher) return teacher._id;
  return null;
}

async function ensureMvpTemplates() {
  const ownerId = await getSystemOwnerId();
  if (!ownerId) {
    return { created: 0, templates: [] };
  }

  const results = [];
  let created = 0;

  for (const def of MVP_EDU_TEMPLATES) {
    const tag = `tool:${def.toolKey}`;
    // NOTE: this lookup is by `tags`, which is plain client-writable input
    // (see utils/templateTrust.js) — it is used ONLY to avoid seeding a
    // duplicate row, never as evidence of trust. A record found here is
    // granted `isSystemTemplate` below only after its script content is
    // verified byte-for-byte against the known-good definition.
    let template = await TaskTemplate.findOne({ tags: tag, isPublic: true });
    const expectedGenerator = def.generatorScript.trim();
    const expectedSolution = def.solutionScript.trim();

    if (!template) {
      template = new TaskTemplate({
        name: def.name,
        type: def.type,
        description: def.description,
        difficulty: def.difficulty,
        generatorScript: expectedGenerator,
        solutionScript: expectedSolution,
        gradingSettings: def.gradingSettings,
        tags: def.tags,
        createdBy: ownerId,
        isPublic: true,
        isSystemTemplate: true,
        paramsSchema: {
          toolKey: def.toolKey,
          toolRoute: def.toolRoute,
          answerKeys: def.answerKeys,
        },
      });
      await template.save();
      created += 1;
    } else if (!template.isSystemTemplate) {
      // Legacy row seeded before `isSystemTemplate` existed, OR a
      // tag/isPublic collision from an untrusted source. Only backfill
      // trust if the stored scripts are an exact match for the real,
      // in-repo definition — matching the tag alone proves nothing.
      const scriptsMatch =
        (template.generatorScript || '').trim() === expectedGenerator &&
        (template.solutionScript || '').trim() === expectedSolution;

      if (scriptsMatch) {
        template.isSystemTemplate = true;
        await template.save();
      } else {
        console.warn(
          `Edu: template tagged "${tag}" (id ${template._id}) does not match the known ` +
          `MVP script content — leaving untrusted. Investigate: this may be a stale/legacy ` +
          `row or a forged "builtin" tag from before the script-trust fix.`
        );
      }
    }

    results.push({
      toolKey: def.toolKey,
      templateId: template._id,
      name: template.name,
      toolRoute: def.toolRoute,
      answerKeys: def.answerKeys,
    });
  }

  return { created, templates: results };
}

async function getTemplateByToolKey(toolKey) {
  await ensureMvpTemplates();
  const tag = `tool:${toolKey}`;
  return TaskTemplate.findOne({ tags: tag, isPublic: true });
}

module.exports = { ensureMvpTemplates, getTemplateByToolKey, MVP_EDU_TEMPLATES };
