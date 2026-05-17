/**
 * GAI — GeoSolver Artificial Intelligence
 * Rule-based pedagogical insights from submission comparison data.
 */

const TOOL_META = {
  'first-basic-task': {
    nameBg: 'Първа основна задача',
    nameEn: 'First Basic Task',
    fieldLabels: { x2: { bg: 'X₂', en: 'X₂' }, y2: { bg: 'Y₂', en: 'Y₂' } },
  },
  'second-basic-task': {
    nameBg: 'Втора основна задача',
    nameEn: 'Second Basic Task',
    fieldLabels: {
      distance: { bg: 'S', en: 'S' },
      alpha: { bg: 'α', en: 'α' },
    },
  },
  'forward-intersection': {
    nameBg: 'Права засечка',
    nameEn: 'Forward Intersection',
    fieldLabels: { xP: { bg: 'Xₚ', en: 'Xₚ' }, yP: { bg: 'Yₚ', en: 'Yₚ' } },
  },
  resection: {
    nameBg: 'Обратна засечка',
    nameEn: 'Resection',
    fieldLabels: { xP: { bg: 'Xₚ', en: 'Xₚ' }, yP: { bg: 'Yₚ', en: 'Yₚ' } },
  },
};

function fieldLabel(toolKey, field) {
  return TOOL_META[toolKey]?.fieldLabels?.[field] || { bg: field, en: field };
}

function relativeError(studentValue, correctValue) {
  if (typeof studentValue !== 'number' || typeof correctValue !== 'number') return null;
  const denom = Math.abs(correctValue);
  if (denom < 1e-9) return Math.abs(studentValue - correctValue);
  return (Math.abs(studentValue - correctValue) / denom) * 100;
}

function diagnoseField({ studentValue, correctValue, isCorrect, tolerance, toleranceType }) {
  if (isCorrect) {
    return {
      code: 'correct',
      severity: 'none',
      bg: 'В рамките на допустимата грешка.',
      en: 'Within the allowed tolerance.',
    };
  }

  const diff = Math.abs(studentValue - correctValue);
  const rel = relativeError(studentValue, correctValue);

  if (studentValue != null && correctValue != null) {
    const signFlip =
      studentValue * correctValue < 0 && Math.abs(studentValue) > Math.abs(correctValue) * 0.5;
    if (signFlip) {
      return {
        code: 'sign_error',
        severity: 'high',
        bg: 'Възможна грешка в знака или посоката на ъгъла.',
        en: 'Possible sign or direction error in the angle.',
      };
    }

    const ratio = Math.abs(correctValue) > 1e-9 ? studentValue / correctValue : null;
    if (ratio != null && (Math.abs(ratio - 10) < 0.15 || Math.abs(ratio - 0.1) < 0.015)) {
      return {
        code: 'scale_factor',
        severity: 'high',
        bg: 'Подозрение за грешка в единиците или десетичната запетая (×10).',
        en: 'Suspected unit or decimal place error (×10).',
      };
    }

    if (
      ratio != null &&
      (Math.abs(ratio - 100) < 2 || Math.abs(ratio - 0.01) < 0.002)
    ) {
      return {
        code: 'scale_factor_100',
        severity: 'high',
        bg: 'Подозрение за объркване гради/градуси или мащаб ×100.',
        en: 'Suspected gon/degree mix-up or ×100 scale error.',
      };
    }
  }

  if (rel != null && rel <= (toleranceType === 'percentage' ? tolerance * 2 : 5)) {
    return {
      code: 'near_miss',
      severity: 'low',
      bg: 'Близо до верния отговор — проверете закръгляването и допуска.',
      en: 'Close to the correct answer — check rounding and tolerance.',
    };
  }

  if (rel != null && rel > 50) {
    return {
      code: 'major_deviation',
      severity: 'high',
      bg: 'Голямо отклонение — вероятно грешен метод или объркани координати.',
      en: 'Large deviation — likely wrong method or swapped coordinates.',
    };
  }

  if (rel != null && rel > 15) {
    return {
      code: 'moderate_deviation',
      severity: 'medium',
      bg: 'Умерено отклонение — прегледайте междинните стъпки в калкулатора.',
      en: 'Moderate deviation — review intermediate steps in the calculator.',
    };
  }

  return {
    code: 'incorrect',
    severity: 'medium',
    bg: `Отклонение ${diff.toFixed(3)} от очакваната стойност.`,
    en: `Deviation of ${diff.toFixed(3)} from the expected value.`,
  };
}

function scoreLevel(score) {
  if (score == null) return 'unknown';
  if (score >= 95) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 50) return 'partial';
  return 'weak';
}

function buildHeadline(level, score, correctCount, totalFields) {
  const pct = score != null ? Math.round(score) : null;
  const map = {
    excellent: {
      bg: `Отличен резултат${pct != null ? ` (${pct}%)` : ''} — всички стойности са коректни.`,
      en: `Excellent${pct != null ? ` (${pct}%)` : ''} — all values are correct.`,
    },
    good: {
      bg: `Добър резултат${pct != null ? ` (${pct}%)` : ''} — ${correctCount}/${totalFields} верни стойности.`,
      en: `Good${pct != null ? ` (${pct}%)` : ''} — ${correctCount}/${totalFields} correct.`,
    },
    partial: {
      bg: `Частично верно${pct != null ? ` (${pct}%)` : ''} — обърнете внимание на грешните полета.`,
      en: `Partially correct${pct != null ? ` (${pct}%)` : ''} — review the incorrect fields.`,
    },
    weak: {
      bg: `Слаб резултат${pct != null ? ` (${pct}%)` : ''} — препоръчва се повторение на метода.`,
      en: `Weak${pct != null ? ` (${pct}%)` : ''} — method review recommended.`,
    },
    unknown: {
      bg: 'Изисква ръчен преглед от преподавателя.',
      en: 'Requires manual review by the teacher.',
    },
  };
  return map[level] || map.unknown;
}

function buildRecommendations(fieldInsights, submission) {
  const recs = [];
  const codes = fieldInsights.map((f) => f.diagnosis?.code).filter(Boolean);

  if (codes.includes('sign_error')) {
    recs.push({
      priority: 'high',
      bg: 'Обърнете внимание на знака на ъгъла и посоката на обхождане в задачата.',
      en: 'Review angle sign and traverse direction in class.',
    });
  }
  if (codes.some((c) => c.startsWith('scale_factor'))) {
    recs.push({
      priority: 'high',
      bg: 'Повторете единиците (м, гради) и въвеждането в калкулатора.',
      en: 'Revisit units (m, gon) and calculator input format.',
    });
  }
  if (submission?.isLate) {
    recs.push({
      priority: 'medium',
      bg: 'Предаването е след крайния срок — обмислете обратна връзка за времето.',
      en: 'Late submission — consider feedback on time management.',
    });
  }
  if (submission?.timeSpent != null && submission.timeSpent > 0 && submission.timeSpent < 2) {
    recs.push({
      priority: 'low',
      bg: 'Много кратко време за решаване — възможен случайен отговор.',
      en: 'Very short solving time — possible guess.',
    });
  }
  if (fieldInsights.filter((f) => !f.isCorrect).length === 1) {
    const wrong = fieldInsights.find((f) => !f.isCorrect);
    recs.push({
      priority: 'medium',
      bg: `Грешката е само в ${wrong?.label?.bg || wrong?.key} — насочете ученика към тази стъпка.`,
      en: `Error only in ${wrong?.label?.en || wrong?.key} — guide the student on that step.`,
    });
  }
  if (recs.length === 0 && fieldInsights.some((f) => !f.isCorrect)) {
    recs.push({
      priority: 'medium',
      bg: 'Сравнете отговорите с метода в GeoSolver калкулатора стъпка по стъпка.',
      en: 'Compare answers with the GeoSolver calculator method step by step.',
    });
  }

  return recs;
}

/**
 * Full GAI insights for teachers (includes correct values).
 */
function buildSubmissionGaiInsights({
  submission,
  toolKey,
  tolerance = 0.01,
  toleranceType = 'absolute',
}) {
  const comparison = submission?.rawComparison || {};
  const details = Array.isArray(comparison.details) ? comparison.details : [];
  const score = submission?.finalScore ?? comparison.score ?? null;
  const correctCount = details.filter((d) => d.isCorrect).length;
  const totalFields = details.length || 0;
  const level = scoreLevel(score);

  const fieldInsights = details.map((row) => {
    const label = fieldLabel(toolKey, row.field);
    const diagnosis = diagnoseField({
      studentValue: row.studentValue,
      correctValue: row.correctValue,
      isCorrect: row.isCorrect,
      tolerance,
      toleranceType,
    });
    return {
      key: row.field,
      label,
      isCorrect: Boolean(row.isCorrect),
      studentValue: row.studentValue,
      correctValue: row.correctValue,
      difference: row.difference,
      relativeErrorPct: relativeError(row.studentValue, row.correctValue),
      severity: diagnosis.severity,
      diagnosis: {
        code: diagnosis.code,
        bg: diagnosis.bg,
        en: diagnosis.en,
      },
    };
  });

  const headline = buildHeadline(level, score, correctCount, totalFields);

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    toolKey: toolKey || null,
    toolName: toolKey
      ? { bg: TOOL_META[toolKey]?.nameBg, en: TOOL_META[toolKey]?.nameEn }
      : null,
    summary: {
      level,
      score,
      correctCount,
      totalFields,
      headline,
      isAutoGraded: Boolean(submission?.gradingDetails?.isAutoGraded),
      status: submission?.status,
    },
    fieldInsights,
    recommendations: buildRecommendations(fieldInsights, submission),
    diagnosisCodes: [...new Set(fieldInsights.map((f) => f.diagnosis?.code).filter(Boolean))],
  };
}

/**
 * Student-safe feedback (no correct answers revealed).
 */
function buildAnonymousClassContext({ submissions, toolKey, minPeers = 3 }) {
  if (!submissions || submissions.length < minPeers) {
    return null;
  }
  const analytics = buildAssignmentGaiAnalytics({ submissions, toolKey });
  const fieldComparisons = (analytics.fieldErrorRates || [])
    .filter((f) => f.total >= minPeers && f.errorRatePct > 0)
    .map((f) => ({
      key: f.key,
      label: f.label,
      errorRatePct: f.errorRatePct,
      message: {
        bg: `${f.errorRatePct}% от класа (${analytics.submissionCount} ученика) са сгрешили ${f.label?.bg || f.key}.`,
        en: `${f.errorRatePct}% of the class (${analytics.submissionCount} students) missed ${f.label?.en || f.key}.`,
      },
    }));

  return {
    peerCount: analytics.submissionCount,
    avgScore: analytics.avgScore,
    passRatePct: analytics.passRatePct,
    fieldComparisons,
    topClassInsight: analytics.classInsights?.[0] || null,
  };
}

function buildStudentGaiFeedback(gaiInsights, classContext = null) {
  if (!gaiInsights?.fieldInsights?.length) {
    const level = gaiInsights?.summary?.level || 'unknown';
    return {
      headline: gaiInsights?.summary?.headline || {
        bg: 'Предаването е получено.',
        en: 'Your submission was received.',
      },
      fields: [],
      level,
      score: gaiInsights?.summary?.score ?? null,
    };
  }

  const fields = gaiInsights.fieldInsights.map((f) => {
    let message;
    if (f.isCorrect) {
      message = {
        bg: 'Верно в рамките на допуска.',
        en: 'Correct within tolerance.',
      };
    } else if (f.diagnosis?.code === 'near_miss') {
      message = {
        bg: 'Близо — проверете закръгляването.',
        en: 'Close — check your rounding.',
      };
    } else if (f.severity === 'high') {
      message = {
        bg: 'Има значително отклонение — прегледайте метода.',
        en: 'Significant deviation — review your method.',
      };
    } else {
      message = {
        bg: 'Нужда от корекция.',
        en: 'Needs correction.',
      };
    }
    return {
      key: f.key,
      label: f.label,
      status: f.isCorrect ? 'correct' : f.diagnosis?.code === 'near_miss' ? 'close' : 'incorrect',
      message,
    };
  });

  const classComparisons = [];
  if (classContext?.fieldComparisons?.length) {
    fields.forEach((f) => {
      if (f.status === 'incorrect' || f.status === 'close') {
        const peer = classContext.fieldComparisons.find((c) => c.key === f.key);
        if (peer && peer.errorRatePct >= 40) {
          classComparisons.push({
            key: f.key,
            label: f.label,
            errorRatePct: peer.errorRatePct,
            message: peer.message,
          });
        }
      }
    });
  }

  return {
    headline: gaiInsights.summary.headline,
    fields,
    level: gaiInsights.summary.level,
    score: gaiInsights.summary.score,
    classComparisons,
    classAvgScore: classContext?.avgScore ?? null,
    peerCount: classContext?.peerCount ?? null,
  };
}

function buildAssignmentGaiAnalytics({ submissions, toolKey }) {
  const withComparison = submissions.filter(
    (s) => s.rawComparison?.details?.length > 0 || s.finalScore != null
  );
  const scores = withComparison
    .map((s) => s.finalScore)
    .filter((n) => typeof n === 'number');
  const avgScore =
    scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const passRate =
    scores.length > 0 ? (scores.filter((s) => s >= 50).length / scores.length) * 100 : null;

  const distribution = [
    { range: '0–49', min: 0, max: 49, count: 0 },
    { range: '50–74', min: 50, max: 74, count: 0 },
    { range: '75–89', min: 75, max: 89, count: 0 },
    { range: '90–100', min: 90, max: 100, count: 0 },
  ];
  scores.forEach((s) => {
    const bucket = distribution.find((b) => s >= b.min && s <= b.max);
    if (bucket) bucket.count += 1;
  });

  const fieldStats = {};
  const diagnosisCounts = {};

  submissions.forEach((sub) => {
    const insights = buildSubmissionGaiInsights({ submission: sub, toolKey });
    insights.fieldInsights.forEach((f) => {
      if (!fieldStats[f.key]) {
        fieldStats[f.key] = { key: f.key, label: f.label, wrong: 0, total: 0 };
      }
      fieldStats[f.key].total += 1;
      if (!f.isCorrect) fieldStats[f.key].wrong += 1;
    });
    insights.diagnosisCodes.forEach((code) => {
      if (code === 'correct') return;
      diagnosisCounts[code] = (diagnosisCounts[code] || 0) + 1;
    });
  });

  const fieldErrorRates = Object.values(fieldStats)
    .map((f) => ({
      ...f,
      errorRatePct: f.total > 0 ? Math.round((f.wrong / f.total) * 100) : 0,
    }))
    .sort((a, b) => b.errorRatePct - a.errorRatePct);

  const commonDiagnoses = Object.entries(diagnosisCounts)
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  const classInsights = [];
  if (passRate != null && passRate < 50) {
    classInsights.push({
      type: 'alert',
      bg: 'Повече от половината клас е под 50% — обмислете преговор на темата.',
      en: 'Over half the class scored below 50% — consider a topic review.',
    });
  }
  if (fieldErrorRates[0]?.errorRatePct >= 60) {
    classInsights.push({
      type: 'focus',
      bg: `Най-честа грешка: ${fieldErrorRates[0].label?.bg || fieldErrorRates[0].key} (${fieldErrorRates[0].errorRatePct}% грешки).`,
      en: `Most common error: ${fieldErrorRates[0].label?.en || fieldErrorRates[0].key} (${fieldErrorRates[0].errorRatePct}% wrong).`,
    });
  }
  if (commonDiagnoses[0]?.code === 'sign_error') {
    classInsights.push({
      type: 'pattern',
      bg: 'Много ученици объркват знака на ъгъла — типична тема за упражнение.',
      en: 'Many students confuse angle sign — typical class exercise topic.',
    });
  }

  const studentSnapshots = submissions
    .map((s) => {
      const ins = buildSubmissionGaiInsights({ submission: s, toolKey });
      return {
        submissionId: s._id,
        student: s.student,
        score: s.finalScore,
        level: ins.summary.level,
        submittedAt: s.submittedAt,
        isLate: s.isLate,
        diagnosisCodes: ins.diagnosisCodes.filter((c) => c !== 'correct'),
      };
    })
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    submissionCount: submissions.length,
    gradedCount: scores.length,
    avgScore: avgScore != null ? Math.round(avgScore * 10) / 10 : null,
    passRatePct: passRate != null ? Math.round(passRate) : null,
    scoreDistribution: distribution,
    fieldErrorRates,
    commonDiagnoses,
    classInsights,
    studentSnapshots,
  };
}

function resolveToolKey(taskTemplate) {
  const tag = taskTemplate?.tags?.find((t) => typeof t === 'string' && t.startsWith('tool:'));
  if (tag) return tag.replace('tool:', '');
  if (taskTemplate?.paramsSchema?.toolKey) return taskTemplate.paramsSchema.toolKey;
  return null;
}

module.exports = {
  buildSubmissionGaiInsights,
  buildStudentGaiFeedback,
  buildAssignmentGaiAnalytics,
  buildAnonymousClassContext,
  resolveToolKey,
};
