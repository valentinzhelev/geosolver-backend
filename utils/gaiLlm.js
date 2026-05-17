/**
 * GAI LLM layer — optional OpenAI narratives on top of rule-based insights.
 * Set OPENAI_API_KEY and GAI_LLM_ENABLED=true in Railway/env.
 */

const DEFAULT_MODEL = process.env.GAI_LLM_MODEL || 'gpt-4o-mini';
const TIMEOUT_MS = Number(process.env.GAI_LLM_TIMEOUT_MS || 12000);

function isLlmEnabled() {
  return process.env.GAI_LLM_ENABLED === 'true' && Boolean(process.env.OPENAI_API_KEY);
}

function buildPromptPayload({ toolKey, toolName, gaiInsights, classContext, assignmentTitle, forTeacher }) {
  const fieldSummary = (gaiInsights?.fieldInsights || []).map((f) => ({
    field: f.key,
    label: f.label,
    studentValue: f.studentValue,
    correctValue: forTeacher ? f.correctValue : undefined,
    isCorrect: f.isCorrect,
    diagnosis: f.diagnosis,
    relativeErrorPct: f.relativeErrorPct,
  }));

  return {
    assignmentTitle,
    toolKey,
    toolName,
    score: gaiInsights?.summary?.score,
    level: gaiInsights?.summary?.level,
    fields: fieldSummary,
    recommendations: forTeacher ? gaiInsights?.recommendations : undefined,
    classContext: classContext
      ? {
          peerCount: classContext.peerCount,
          avgScore: classContext.avgScore,
          fieldComparisons: classContext.fieldComparisons,
        }
      : null,
  };
}

async function callOpenAi(systemPrompt, userPayload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.4,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: JSON.stringify(userPayload, null, 2) },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');
    return JSON.parse(content);
  } finally {
    clearTimeout(timer);
  }
}

const STUDENT_SYSTEM = `You are GAI (GeoSolver Artificial Intelligence), a geodesy tutor for Bulgarian high-school/university students.
Reply ONLY with valid JSON:
{"student_bg":"2-4 sentences in Bulgarian","student_en":"2-4 sentences in English"}
Rules:
- Be encouraging and concrete about the METHOD (units: metres, angles in gon/grad).
- Do NOT state the exact correct numeric answers.
- Mention which fields were wrong or close and what to recheck (sign, rounding, calculator steps).
- If class comparison data exists, mention it anonymously ("many classmates also struggled with...").`;

const TEACHER_SYSTEM = `You are GAI (GeoSolver Artificial Intelligence) assisting a geodesy teacher.
Reply ONLY with valid JSON:
{"teacher_bg":"3-5 sentences in Bulgarian","teacher_en":"3-5 sentences in English"}
Rules:
- Summarize the submission quality, error patterns, and one concrete classroom action.
- You may reference correct vs student values from the data.
- Mention class-wide patterns if provided.`;

/**
 * Generate bilingual LLM narratives. Returns null if disabled or on error.
 */
async function generateGaiLlmNarratives(ctx) {
  if (!isLlmEnabled()) return null;

  try {
    const [studentJson, teacherJson] = await Promise.all([
      callOpenAi(STUDENT_SYSTEM, buildPromptPayload({ ...ctx, forTeacher: false })),
      callOpenAi(TEACHER_SYSTEM, buildPromptPayload({ ...ctx, forTeacher: true })),
    ]);

    return {
      student: {
        bg: String(studentJson.student_bg || '').trim(),
        en: String(studentJson.student_en || '').trim(),
      },
      teacher: {
        bg: String(teacherJson.teacher_bg || '').trim(),
        en: String(teacherJson.teacher_en || '').trim(),
      },
      generatedAt: new Date(),
      model: DEFAULT_MODEL,
    };
  } catch (err) {
    console.error('GAI LLM failed:', err.message);
    return null;
  }
}

/** Pre-submit hint when no submission yet */
async function generateGaiLlmStudyHint({ toolKey, toolName, assignmentTitle, inputSummary }) {
  if (!isLlmEnabled()) return null;

  const system = `You are GAI, a geodesy study coach. Reply JSON only:
{"hint_bg":"1-2 short sentences Bulgarian","hint_en":"1-2 short sentences English"}
Give a practical tip for solving this task type using the calculator — no final numeric answer.`;

  try {
    const json = await callOpenAi(system, {
      assignmentTitle,
      toolKey,
      toolName,
      given: inputSummary,
    });
    return {
      bg: String(json.hint_bg || '').trim(),
      en: String(json.hint_en || '').trim(),
    };
  } catch (err) {
    console.error('GAI study hint failed:', err.message);
    return null;
  }
}

module.exports = {
  isLlmEnabled,
  generateGaiLlmNarratives,
  generateGaiLlmStudyHint,
};
