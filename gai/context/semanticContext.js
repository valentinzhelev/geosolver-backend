/**
 * Provider-facing SEMANTIC projection (V1.0.2). The tool layer returns internal domain data (model-shaped keys,
 * status codes, ids) - that stays internal. This module is the ONLY thing that decides what the LLM sees: a
 * whitelisted, Bulgarian-keyed description of MEANING, built from deterministic facts, so the model paraphrases
 * product language instead of application internals.
 *
 * Value conventions (explained to the model in gai/prompt/systemPrompt.js):
 *   a number            -> checked by GeoSolver; 0 means "checked, there are none"
 *   "Не е приложимо..."  -> the concept does not apply (e.g. closure of an OPEN traverse)
 *   "Не е налично..."    -> it applies, but GeoSolver has no authoritative value (with the persisted reason)
 *   "Неизвестно"         -> not enough information
 *
 * Defence in depth: everything goes through redactInternalIdentifiers() last, and every user-authored string
 * (names, notes, file names, OCR text) through untrusted() - length-capped, control characters and the data-block
 * delimiters neutralised. Nothing here calculates a geodetic value; numbers are copied from persisted results.
 */
const T = require('../terminology');

const DATA_START = '<<<ДАННИ ОТ GEOSOLVER>>>';
const DATA_END = '<<<КРАЙ НА ДАННИТЕ>>>';
const LIST_CAP = 10;
const ROW_CAP = 30;
const OBJECT_ID = /\b[0-9a-f]{24}\b/gi;

const NOT_APPLICABLE = 'Не е приложимо';
const NOT_AVAILABLE = 'Не е налично';
const UNKNOWN = 'Неизвестно';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** User-authored text is DATA: cap it, strip control chars, neutralise our delimiters and any raw ids. */
function untrusted(value, max = 160) {
  if (value === null || value === undefined) return '';
  let s = String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/<<</g, '‹‹‹').replace(/>>>/g, '›››')
    .replace(OBJECT_ID, '…')
    .trim();
  if (s.length > max) s = `${s.slice(0, max - 1)}…`;
  return s;
}

function coords(x, y, h, { hMissing = 'Няма кота' } = {}) {
  return {
    X: isNum(x) ? x : 'Не е определено',
    Y: isNum(y) ? y : 'Не е определено',
    H: isNum(h) ? h : hMissing,
  };
}

const withIf = (cond, obj) => (cond ? obj : {});

function capped(list, cap, mapFn) {
  const items = list.slice(0, cap).map(mapFn);
  if (list.length > cap) items.push({ 'Бележка': `Показани са първите ${cap} от ${list.length}.` });
  return items;
}

/* ---------------------------------------------------------------- project-level facts (always present) */

function projectFacts(summary) {
  const p = summary.project || {};
  const cap = summary.capture || { total: 0, byStatus: {}, byMode: {}, needsReview: 0 };
  const legacy = summary.legacyFieldBooks || { total: 0, active: 0, byType: {} };
  const proc = summary.processing || { polarCount: 0, traverseCount: 0, traverseByStatus: {} };

  const captureFacts = {
    'Брой заснемания': cap.total,
    'От тях със статус „За проверка“': cap.needsReview || 0,
    ...withIf(cap.total > 0, {
      'По състояние': Object.fromEntries(Object.entries(cap.byStatus || {}).map(([k, n]) => [T.label(T.CAPTURE_STATUS, k), n])),
      'По вид': Object.fromEntries(Object.entries(cap.byMode || {}).map(([k, n]) => [T.label(T.CAPTURE_MODE, k, 'Друг вид'), n])),
    }),
  };
  const legacyFacts = {
    'Брой карнети': legacy.total,
    ...withIf(legacy.total > 0, {
      'По тип': Object.fromEntries(Object.entries(legacy.byType || {}).map(([k, n]) => [T.label(T.LEGACY_BOOK_TYPE, k, 'Друг тип'), n])),
    }),
    ...withIf(legacy.total > legacy.active, { 'От тях архивирани': legacy.total - legacy.active }),
  };

  return {
    'Проект': {
      'Име': untrusted(p.name, 120) || UNKNOWN,
      'Координатна система': p.crs ? untrusted(p.crs, 40) : 'Не е зададена',
    },
    'Точки': { 'Брой точки в проекта': summary.pointCount },
    'Теренни данни': {
      'Заснемания в модул „Теренни данни“': captureFacts,
      'Карнети от предходния модул за електронни карнети': legacyFacts,
    },
    'Обработки': {
      'Полярни обработки': proc.polarCount,
      'Обработки на полигонов ход': proc.traverseCount,
      ...withIf(proc.traverseCount > 0, {
        'Полигонови ходове по състояние': Object.fromEntries(Object.entries(proc.traverseByStatus || {}).map(([k, n]) => [T.label(T.TRAVERSE_STATUS, k), n])),
      }),
    },
    'Документи': { 'Генерирани отчети': summary.reportCount },
    'Изчисления': { 'Записани изчисления към проекта': summary.calculationCount },
  };
}

const ACTIVITY = { capture: 'Заснемане', processing: 'Обработка', report: 'Генериран отчет' };

/* ---------------------------------------------------------------- processing */

function closureFacts(t) {
  const c = t.closure || {};
  if (c.available) {
    return {
      'Обща дължина на хода (m)': isNum(c.totalLength) ? c.totalLength : UNKNOWN,
      'Невръзка по X – fX (m)': isNum(c.fX) ? c.fX : UNKNOWN,
      'Невръзка по Y – fY (m)': isNum(c.fY) ? c.fY : UNKNOWN,
      'Линейна невръзка (m)': isNum(c.linearMisclosure) ? c.linearMisclosure : UNKNOWN,
      'Относителна невръзка': isNum(c.relativeClosureDenominator) ? `1 : ${Math.round(c.relativeClosureDenominator)}` : UNKNOWN,
      ...withIf(c.perfectClosure === true, { 'Точно затваряне': 'Да' }),
    };
  }
  return { 'Състояние': c.reason === 'OPEN_TRAVERSE' ? NOT_APPLICABLE : NOT_AVAILABLE, 'Причина': T.reasonMessage(c.reason) || 'Неуточнена причина.' };
}

function adjustmentFacts(t) {
  const a = t.adjustment || {};
  const method = 'Bowditch (компасно правило) – невръзката се разпределя пропорционално на дължините на отсечките';
  if (a.applied) return { 'Метод': method, 'Приложено': 'Да' };
  return {
    'Метод': method, 'Приложено': 'Не',
    'Причина': a.reasonNotApplied === 'OPEN_TRAVERSE' ? 'Не е приложимо – отвореният ход няма невръзка за разпределяне.' : (T.reasonMessage(a.reasonNotApplied) || 'Неуточнена причина.'),
  };
}

function legFacts(l, adjusted) {
  return {
    'Отсечка': `${untrusted(l.from, 30)} → ${untrusted(l.to, 30)}`,
    'Състояние': T.label(T.OBSERVATION_STATUS, l.status),
    'Дирекционен ъгъл (gon)': isNum(l.bearingGon) ? l.bearingGon : NOT_AVAILABLE,
    'Хоризонтално разстояние (m)': isNum(l.horizontalDistance) ? l.horizontalDistance : NOT_AVAILABLE,
    'Сурови координати (преди изравняване)': { X: isNum(l.rawX) ? l.rawX : NOT_AVAILABLE, Y: isNum(l.rawY) ? l.rawY : NOT_AVAILABLE },
    'Изравнени координати (Bowditch)': adjusted && isNum(l.adjustedX)
      ? { X: l.adjustedX, Y: l.adjustedY }
      : `${NOT_APPLICABLE} – изравняване не е приложено`,
    H: isNum(l.rawH) ? l.rawH : 'Няма кота',
    ...withIf(l.heightReason, { 'Причина за липса на кота': T.reasonMessage(l.heightReason) }),
  };
}

function polarTargetFacts(o) {
  return {
    'Цел': untrusted(o.target, 30) || UNKNOWN,
    'Състояние': T.label(T.OBSERVATION_STATUS, o.status),
    'Дирекционен ъгъл към целта (gon)': isNum(o.directionGon) ? o.directionGon : NOT_AVAILABLE,
    'Хоризонтално разстояние (m)': isNum(o.horizontalDistance) ? o.horizontalDistance : NOT_AVAILABLE,
    ...coords(o.x, o.y, o.h),
    ...withIf(o.heightReason, { 'Причина за липса на кота': T.reasonMessage(o.heightReason) }),
  };
}

function generatedPointsFact(names) {
  return names && names.length ? names.map((n) => untrusted(n, 30)) : 'От тази обработка все още не са създадени точки в проекта.';
}

/** A full processing run (tools/processing.js#getProcessingRun) as product-language facts. */
function runDetailFacts(run) {
  const s = run.summary;
  const d = run.detail;
  const base = { 'Обработка': T.runLabel(s), 'Вид': T.label(T.PROCESSING_TYPE, s.processingType), 'Дата': T.formatDate(s.createdAt) || UNKNOWN };
  if (s.processingType === 'traverse') {
    const adjusted = !!(d.adjustment && d.adjustment.applied);
    const pt = (x) => (x ? { 'Име': untrusted(x.identifier, 30), ...coords(x.point && x.point.x, x.point && x.point.y, x.point && x.point.h, { hMissing: 'Няма записана кота' }) } : null);
    return {
      ...base,
      'Тип на хода': T.label(T.TRAVERSE_TYPE, d.traverseType),
      'Състояние': T.label(T.TRAVERSE_STATUS, d.status),
      'Начална станция': pt(d.start) || NOT_AVAILABLE,
      'Начален ориентир': pt(d.orientation) || NOT_AVAILABLE,
      'Крайна контролна точка': pt(d.end) || (d.traverseType === 'OPEN' ? `${NOT_APPLICABLE} – отвореният ход няма крайна контролна точка` : NOT_AVAILABLE),
      'Брой отсечки': s.legCount,
      'Невръзка': closureFacts(d),
      'Изравняване': adjustmentFacts(d),
      'Отсечки': capped(d.legs || [], ROW_CAP, (l) => legFacts(l, adjusted)),
      'Създадени точки в проекта': generatedPointsFact(run.generatedPointNames),
    };
  }
  const counts = s.counts || {};
  return {
    ...base,
    'Конвенция за вертикалния ъгъл': T.label(T.VERTICAL_ANGLE_CONVENTION, d.verticalAngleConvention, 'Не е зададена'),
    'Обобщение на целите': {
      'Готови (X, Y и H)': counts.READY || 0, 'Само X/Y (без кота)': counts.XY_ONLY || 0,
      'С предупреждение': counts.WARNING || 0, 'Невалидни': counts.ERROR || 0,
    },
    'Станции': (d.setups || []).map((st) => ({
      'Станция': untrusted(st.stationIdentifier, 30) || UNKNOWN,
      'Координати на станцията': st.stationPoint ? coords(st.stationPoint.x, st.stationPoint.y, st.stationPoint.h, { hMissing: 'Няма записана кота' }) : NOT_AVAILABLE,
      'Ориентир': st.orientationIdentifier ? untrusted(st.orientationIdentifier, 30) : 'Няма записан ориентир',
      'Ориентировъчен ъгъл (gon)': isNum(st.orientationConstantGon) ? st.orientationConstantGon : NOT_AVAILABLE,
      ...withIf(st.setupError, { 'Проблем със станцията': T.reasonMessage(st.setupError) }),
      'Цели': capped(st.observations || [], ROW_CAP, polarTargetFacts),
      ...withIf(isNum(st.observationCount) && st.observationCount > ROW_CAP, { 'Общ брой цели': st.observationCount }),
    })),
    'Създадени точки в проекта': generatedPointsFact(run.generatedPointNames),
  };
}

function runListItem(s) {
  const base = { 'Обработка': T.runLabel(s), 'Дата': T.formatDate(s.createdAt) || UNKNOWN };
  if (s.processingType === 'traverse') {
    return {
      ...base,
      'Тип на хода': T.label(T.TRAVERSE_TYPE, s.traverseType),
      'Състояние': T.label(T.TRAVERSE_STATUS, s.status),
      'Линейна невръзка (m)': s.closureAvailable && isNum(s.linearMisclosure)
        ? s.linearMisclosure
        : (s.closureReason === 'OPEN_TRAVERSE' ? `${NOT_APPLICABLE} (отворен ход)` : NOT_AVAILABLE),
      'Изравняване по Bowditch': s.adjustmentApplied ? 'Приложено' : 'Не е приложено',
      'Създадени точки': s.generatedPointCount,
    };
  }
  const c = s.counts || {};
  return {
    ...base,
    'Цели': { 'Готови (X, Y и H)': c.READY || 0, 'Само X/Y (без кота)': c.XY_ONLY || 0, 'С предупреждение': c.WARNING || 0, 'Невалидни': c.ERROR || 0 },
    'Създадени точки': s.generatedPointCount,
  };
}

/* ---------------------------------------------------------------- points */

function pointFacts(p) {
  return {
    'Име': untrusted(p.name, 40),
    ...withIf(p.code, { 'Код': untrusted(p.code, 40) }),
    ...coords(p.x, p.y, p.h, { hMissing: 'Няма записана кота' }),
    ...withIf(p.notes, { 'Бележка (въведена от потребител)': untrusted(p.notes, 200) }),
  };
}

function originSteps(prov) {
  const steps = [];
  const byKind = (k) => (prov.chain || []).find((s) => s.kind === k);
  if (prov.originKind === 'processing') {
    const run = byKind('processingRun');
    steps.push({ 'Стъпка': 'Създадена от обработка', 'Източник': run ? run.label : `${NOT_AVAILABLE} – обработката не е намерена в проекта` });
    const fos = byKind('fieldObservationSet');
    if (fos) steps.push({ 'Стъпка': 'Входни данни на обработката', 'Източник': fos.label });
    const job = byKind('captureJob');
    if (job) steps.push({ 'Стъпка': 'Първоизточник', 'Източник': job.label, ...withIf(job.fileName, { 'Файл': untrusted(job.fileName, 120) }) });
  } else if (prov.originKind === 'capture') {
    const job = byKind('captureJob');
    steps.push({ 'Стъпка': 'Импортирана от заснемане', 'Източник': job ? job.label : `${NOT_AVAILABLE} – заснемането не е намерено в проекта`, ...withIf(job && job.fileName, { 'Файл': untrusted(job && job.fileName, 120) }) });
  } else if (prov.originKind === 'calculation') {
    const calc = byKind('calculation');
    steps.push({ 'Стъпка': 'Създадена от изчисление', 'Източник': calc ? untrusted(calc.label, 80) : `${NOT_AVAILABLE} – изчислението не е намерено в проекта` });
  } else {
    steps.push({ 'Стъпка': 'Произход', 'Източник': 'В GeoSolver няма записан източник за тази точка (въведена ръчно или импортирана).' });
  }
  return steps;
}

function sourceObservationFacts(prov) {
  const r = prov.sourceResult;
  if (!r) return null;
  if (r.kind === 'leg') {
    const adjusted = !!(prov.runSummary && prov.runSummary.adjustmentApplied);
    return {
      'Вид на хода': T.label(T.TRAVERSE_TYPE, prov.runSummary && prov.runSummary.traverseType),
      ...legFacts(r.leg, adjusted),
      'Точката е записана със': adjusted ? 'изравнените координати (Bowditch)' : 'суровите координати (без изравняване)',
    };
  }
  return {
    'Станция': untrusted(r.setup.station && r.setup.station.identifier, 30) || UNKNOWN,
    'Ориентир': r.setup.orientation ? untrusted(r.setup.orientation.identifier, 30) : 'Няма записан ориентир',
    'Ориентировъчен ъгъл (gon)': isNum(r.setup.orientationConstantGon) ? r.setup.orientationConstantGon : NOT_AVAILABLE,
    ...polarTargetFacts({ ...r.observation, directionGon: r.observation.direction }),
  };
}

function fieldMeasurementFacts(m) {
  if (!m) return null;
  const v = (x, missing) => T.formatMeasurement(x) || missing;
  return {
    'Станция': untrusted(m.station, 30) || UNKNOWN,
    'Височина на инструмента': v(m.instrumentHeight, 'Не е записана'),
    ...withIf(m.orientationTarget, { 'Ориентир': untrusted(m.orientationTarget, 30) }),
    'Цел': untrusted(m.target, 30) || UNKNOWN,
    'Хоризонтален ъгъл (Hz)': v(m.hz, 'Не е записан'),
    'Вертикален/зенитен ъгъл (както е записан)': v(m.vz, 'Не е записан'),
    'Наклонено разстояние': v(m.slopeDistance, 'Не е записано'),
    'Хоризонтално разстояние': v(m.horizontalDistance, 'Не е записано'),
    'Височина на призмата': v(m.prismHeight, 'Не е записана'),
    ...withIf(m.code, { 'Код': untrusted(m.code, 40) }),
    ...withIf(m.notes, { 'Бележка в карнета (въведена от потребител)': untrusted(m.notes, 200) }),
  };
}

function requestedPointFacts(entry) {
  if (entry.status === 'NOT_FOUND') return { 'Търсено име': untrusted(entry.requested, 30), 'Резултат': 'В проекта няма точка с това име.' };
  if (entry.status === 'AMBIGUOUS') {
    return { 'Търсено име': untrusted(entry.requested, 30), 'Резултат': 'В проекта има няколко точки с това име.', 'Точки': capped(entry.candidates || [], 5, pointFacts) };
  }
  const prov = entry.provenance || { originKind: 'unrecorded', chain: [] };
  const obs = sourceObservationFacts(prov);
  const meas = fieldMeasurementFacts(prov.fieldMeasurement);
  return {
    'Търсено име': untrusted(entry.requested, 30),
    'Резултат': 'Намерена',
    'Точка': pointFacts(entry.point),
    'Произход': originSteps(prov),
    ...withIf(obs, { 'Изходен резултат от обработката': obs }),
    ...withIf(meas, { 'Полеви измервания (потвърдени)': meas }),
  };
}

/* ---------------------------------------------------------------- assembly */

const PROCESSING_NOUN = { open: 'отворен полигонов ход', traverse: 'обработка на полигонов ход', polar: 'полярна обработка', any: 'обработка' };

function toSemanticContext(context) {
  const { intent = {}, data = {} } = context;
  const out = projectFacts(data.projectSummary || {});

  if (intent.wantsOverview) {
    const act = (data.projectSummary && data.projectSummary.recentActivity) || [];
    out['Последна активност (заснемания, обработки и отчети)'] = act.length
      ? act.map((a) => ({ 'Събитие': ACTIVITY[a.kind] || 'Събитие', 'Дата': T.formatDate(a.date) || UNKNOWN }))
      : 'Няма записи.';
    if (data.recentRuns && data.recentRuns.length) out['Последни обработки'] = data.recentRuns.map(runListItem);
  }

  if (data.issues) {
    out['Проверка за отворени въпроси'] = {
      'Проверени категории': T.ISSUE_CATEGORIES_CHECKED,
      'Резултат': data.issues.length ? `Открити елементи: ${data.issues.length}` : 'В проверените категории не са открити елементи.',
      ...withIf(data.issues.length, {
        'Открити елементи': capped(data.issues, LIST_CAP, (i) => ({ 'Вид': i.label, 'Отнася се за': i.refLabel || UNKNOWN, ...withIf(i.fileName, { 'Файл': untrusted(i.fileName, 120) }) })),
      }),
    };
  }

  if (data.points) out['Запитани точки'] = data.points.map(requestedPointFacts);

  if (data.fieldData) {
    out['Заснемания, качени от вас (най-новите първи)'] = data.fieldData.length
      ? capped(data.fieldData, LIST_CAP, (j) => ({
        'Заснемане': T.captureLabel(j.mode, j.createdAt),
        ...withIf(j.originalName, { 'Файл': untrusted(j.originalName, 120) }),
        'Състояние': T.label(T.CAPTURE_STATUS, j.status),
        'Редове/наблюдения': j.rows,
        ...withIf(j.review, { 'Клетки за проверка': j.review }),
        ...withIf(j.invalid, { 'Невалидни клетки': j.invalid }),
      }))
      : 'Няма заснемания, качени от вас в модул „Теренни данни“.';
  }

  if (data.processingQuery) {
    const noun = PROCESSING_NOUN[data.processingQuery.filter] || PROCESSING_NOUN.any;
    out['Избрана обработка (най-новата съответстваща)'] = data.latestMatchingRunDetail
      ? runDetailFacts(data.latestMatchingRunDetail)
      : `В проекта няма ${noun}.`;
    if (data.processingRuns && data.processingRuns.length > 1) {
      out['Съответстващи обработки (най-новите първи)'] = capped(data.processingRuns, LIST_CAP, runListItem);
    }
  }

  if (data.reports) {
    out['Генерирани отчети (най-новите първи)'] = data.reports.length
      ? capped(data.reports, LIST_CAP, (r) => ({ 'Отчет': untrusted(r.title, 120), 'Вид': T.label(T.REPORT_TYPE, r.reportType, 'Отчет'), 'Генериран на': T.formatDate(r.generatedAt) || UNKNOWN }))
      : 'В проекта няма генерирани отчети.';
  }

  if (data.calculations) {
    out['Записани изчисления (най-новите първи)'] = data.calculations.length
      ? capped(data.calculations, LIST_CAP, (c) => ({ 'Изчисление': untrusted(c.title, 80) || 'Изчисление', 'Дата': T.formatDate(c.createdAt) || UNKNOWN }))
      : 'Към проекта няма записани изчисления.';
  }

  return redactInternalIdentifiers(out);
}

/**
 * Final defence layer (V1.0.1's stripInternalIds, hardened): drops id-shaped KEYS (`id`, `_id`, `...Id`, `...Ids`)
 * and any ObjectId-shaped VALUE at any depth - object, array, nested metadata - and masks ObjectIds embedded in
 * longer strings. Ordinary words that merely contain "id" ("valid", "width") are untouched.
 */
function redactInternalIdentifiers(value) {
  if (Array.isArray(value)) {
    return value.filter((v) => !(typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v))).map(redactInternalIdentifiers);
  }
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (/^_?id$/i.test(key) || /Ids?$/.test(key)) continue;
      if (typeof v === 'string' && /^[0-9a-f]{24}$/i.test(v)) continue;
      out[key] = redactInternalIdentifiers(v);
    }
    return out;
  }
  if (typeof value === 'string') return value.replace(OBJECT_ID, '…');
  return value;
}

/** The final user turn: data block (clearly delimited, data-only) + the user's actual question. */
function renderUserTurn(semantic, question) {
  return [
    DATA_START,
    JSON.stringify(semantic, null, 2),
    DATA_END,
    '',
    'Въпрос на потребителя:',
    untrusted(question, 2000),
  ].join('\n');
}

module.exports = { toSemanticContext, redactInternalIdentifiers, renderUserTurn, untrusted, DATA_START, DATA_END };
