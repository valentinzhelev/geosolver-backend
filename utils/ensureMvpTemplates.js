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
    let template = await TaskTemplate.findOne({ tags: tag, isPublic: true });

    if (!template) {
      template = new TaskTemplate({
        name: def.name,
        type: def.type,
        description: def.description,
        difficulty: def.difficulty,
        generatorScript: def.generatorScript.trim(),
        solutionScript: def.solutionScript.trim(),
        gradingSettings: def.gradingSettings,
        tags: def.tags,
        createdBy: ownerId,
        isPublic: true,
        paramsSchema: {
          toolKey: def.toolKey,
          toolRoute: def.toolRoute,
          answerKeys: def.answerKeys,
        },
      });
      await template.save();
      created += 1;
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
