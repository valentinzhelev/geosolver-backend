const TaskTemplate = require('../models/TaskTemplate');
const User = require('../models/User');
const crypto = require('crypto');
const { MVP_EDU_TEMPLATES, SUPERSEDED_DEFINITIONS } = require('../data/mvpEduTemplates');

const scriptSha256 = (script) =>
  crypto.createHash('sha256').update(String(script || '').trim().replace(/\r\n/g, '\n')).digest('hex');

/**
 * True only when BOTH stored scripts are byte-for-byte a PREVIOUS built-in definition that has since
 * been corrected (data/mvpEduTemplates.js SUPERSEDED_DEFINITIONS). Like the trust backfill below it is
 * a content match against known repo code — never a tag, an owner or any client-writable field.
 */
function matchesSupersededDefinition(toolKey, template) {
  const generatorSha = scriptSha256(template.generatorScript);
  const solutionSha = scriptSha256(template.solutionScript);
  return (SUPERSEDED_DEFINITIONS[toolKey] || []).some(
    (old) => old.generatorSha256 === generatorSha && old.solutionSha256 === solutionSha
  );
}

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
    return { created: 0, upgraded: 0, templates: [] };
  }

  const results = [];
  let created = 0;
  let upgraded = 0;

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
    } else if (template.isSystemTemplate === true && matchesSupersededDefinition(def.toolKey, template)) {
      // Controlled update (Milestone 2.1). ALL provenance conditions must hold: the row is already a TRUSTED
      // system template (isSystemTemplate is server-only, never client-writable) AND both scripts are EXACTLY
      // a previous, corrected built-in. Only scripts/description/grading/params change; an untrusted, edited
      // or foreign template never reaches this branch (an untrusted legacy row falls to the backfill below).
      // Already-created Assignments are unaffected: their variants are snapshots (inputData + solution).
      template.generatorScript = expectedGenerator;
      template.solutionScript = expectedSolution;
      template.description = def.description;
      template.difficulty = def.difficulty;
      template.gradingSettings = def.gradingSettings;
      template.paramsSchema = {
        toolKey: def.toolKey,
        toolRoute: def.toolRoute,
        answerKeys: def.answerKeys,
      };
      await template.save();
      upgraded += 1;
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

  return { created, upgraded, templates: results };
}

async function getTemplateByToolKey(toolKey) {
  await ensureMvpTemplates();
  const tag = `tool:${toolKey}`;
  return TaskTemplate.findOne({ tags: tag, isPublic: true });
}

module.exports = { ensureMvpTemplates, getTemplateByToolKey, MVP_EDU_TEMPLATES };
