const { buildSubmissionGaiInsights, resolveToolKey } = require('./gaiInsights');
const { generateGaiLlmNarratives, generateGaiLlmStudyHint, isLlmEnabled } = require('./gaiLlm');

const TOOL_NAMES = {
  'first-basic-task': { bg: 'Първа основна задача', en: 'First Basic Task' },
  'second-basic-task': { bg: 'Втора основна задача', en: 'Second Basic Task' },
  'forward-intersection': { bg: 'Права засечка', en: 'Forward Intersection' },
  resection: { bg: 'Обратна засечка', en: 'Resection' },
};

const studyHintCache = new Map();
const STUDY_HINT_TTL_MS = 60 * 60 * 1000;

function enrichStudentFeedback(feedback, submission) {
  if (!feedback) return feedback;
  const llm = submission?.gaiLlm?.student;
  if (!llm?.bg && !llm?.en) return feedback;
  return { ...feedback, llmNarrative: llm };
}

async function ensureSubmissionGaiLlm(submission, { assignment, taskTemplate, classContext }) {
  if (!isLlmEnabled() || !submission?.rawComparison) return submission.gaiLlm || null;
  if (submission.gaiLlm?.student?.bg && submission.gaiLlm?.teacher?.bg) {
    return submission.gaiLlm;
  }

  const toolKey = resolveToolKey(taskTemplate);
  const gaiInsights = buildSubmissionGaiInsights({
    submission,
    toolKey,
    tolerance:
      assignment.settings?.customTolerance ?? taskTemplate?.gradingSettings?.tolerance,
    toleranceType:
      assignment.settings?.customToleranceType ?? taskTemplate?.gradingSettings?.toleranceType,
  });

  const narratives = await generateGaiLlmNarratives({
    toolKey,
    toolName: TOOL_NAMES[toolKey] || { bg: toolKey, en: toolKey },
    gaiInsights,
    classContext,
    assignmentTitle: assignment.title,
  });

  if (narratives) {
    submission.gaiLlm = narratives;
    await submission.save();
  }
  return submission.gaiLlm || null;
}

async function getStudyHintForAssignment(assignmentId, studentId, { assignment, taskTemplate, inputData }) {
  if (!isLlmEnabled()) return null;
  const cacheKey = `${assignmentId}:${studentId}`;
  const cached = studyHintCache.get(cacheKey);
  if (cached && Date.now() - cached.at < STUDY_HINT_TTL_MS) return cached.hint;

  const toolKey = resolveToolKey(taskTemplate);
  const hint = await generateGaiLlmStudyHint({
    toolKey,
    toolName: TOOL_NAMES[toolKey] || { bg: toolKey, en: toolKey },
    assignmentTitle: assignment.title,
    inputSummary: inputData,
  });
  if (hint) studyHintCache.set(cacheKey, { hint, at: Date.now() });
  return hint;
}

module.exports = {
  enrichStudentFeedback,
  ensureSubmissionGaiLlm,
  getStudyHintForAssignment,
  isLlmEnabled,
};
