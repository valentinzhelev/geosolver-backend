/**
 * Context-aware starter questions (V1.0.2): deterministic, built from the project summary and one REAL point name,
 * so the UI never suggests e.g. "точка 201" for a project that has no point 201, or a traverse question for a
 * project with no traverse processing.
 */
const MAX_STARTERS = 4;

function buildStarters(summary, examplePointName) {
  const s = summary || {};
  const proc = s.processing || {};
  const hasFieldData = (s.capture && s.capture.total > 0) || proc.total > 0;
  const out = ['Обобщи проекта'];
  if (hasFieldData) out.push('Кои данни чакат проверка?');
  if (proc.traverseCount > 0) out.push('Обясни последния полигонов ход');
  else if (proc.polarCount > 0) out.push('Обясни последната полярна обработка');
  if (examplePointName) out.push(`Как е получена точка ${examplePointName}?`);
  if (s.reportCount > 0) out.push('Кои отчети са генерирани?');
  if (!hasFieldData && s.pointCount > 0) out.push('Колко точки има проектът?');
  return out.slice(0, MAX_STARTERS);
}

module.exports = { buildStarters };
