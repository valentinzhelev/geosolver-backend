/**
 * Deterministic merge of a Field Session's notebook PAGES into ONE logical notebook (pure, no I/O, no LLM).
 *
 * Every page is an ordinary Field Notebook CaptureJob: it was uploaded, OCR-read, reconstructed and validated by the
 * unchanged Capture pipeline (capture/notebook/*). This module only decides how the already-evaluated pages combine,
 * with explicit rules that are all testable and never guess:
 *
 *   CONTINUATION   a page's LEADING setup that has no station line (`continuation`, blank station) continues the LAST
 *                  setup of the previous page - the evidence is exactly that: the page-break table has no station of
 *                  its own and a previous setup exists. Nothing before it (first page / nothing earlier) = orphan rows
 *                  = a blocking error, never a silent attachment to nothing.
 *   REPEATED HEAD  a page whose FIRST setup names the SAME station as the previous page's last setup is that setup's
 *                  heading repeated at the page break, not a second setup: its observations are appended, missing
 *                  metadata is filled from whichever page has it, and DIFFERING metadata (instrument height, backsight,
 *                  backsight direction) is a blocking CROSS_PAGE_CONFLICT - no value is ever silently chosen.
 *   NEW SETUP      any other station starts a new setup, in page order.
 *
 * After merging, cross-page validation looks at what a single page cannot see: the same target observed on two pages of
 * one setup, mixed angle units across pages, suspicious page order, pages that are not ready (failed / still processing /
 * confirmed elsewhere). Everything resolvable is resolved in the page itself (edit the cell, exclude the row, replace or
 * remove the page) - this module never edits evidence.
 *
 * Output observations keep their exact origin: `source: { page, captureJobId, setup, row }` (0-based page order, the page
 * job, and the page-local setup/row) plus the page's own cell geometry (`cells`) - audit data that is never shown.
 */
const { getConfig } = require('./config');

const norm = (s) => String(s === null || s === undefined ? '' : s).trim().toLowerCase();
const METERS = { m: 1, cm: 0.01, mm: 0.001 };
const toMeters = (m) => (m && Number.isFinite(m.value) ? m.value * (METERS[m.unit] || 1) : null);
const toGon = (a) => (a && Number.isFinite(a.value) ? (a.unit === 'deg' ? (a.value * 400) / 360 : a.value) : null);
const sameMetres = (a, b) => Math.abs(toMeters(a) - toMeters(b)) <= 1e-9;
const sameGon = (a, b) => Math.abs(toGon(a) - toGon(b)) <= 1e-6;
const fmtMeasure = (m) => (m ? `${m.value} ${m.unit}` : '');
const fmtAngle = (a) => (a ? `${a.value} ${a.unit === 'deg' ? '°' : 'gon'}` : '');

const MESSAGES = {
  PAGE_FAILED: 'Страницата не беше разпозната. Заменете я с нова снимка или я премахнете от сесията.',
  PAGE_PROCESSING: 'Страницата още се обработва. Изчакайте или я премахнете.',
  PAGE_MISSING: 'Заснемането на тази страница вече не е налично. Премахнете страницата и я добавете отново.',
  PAGE_CONFIRMED_ELSEWHERE: 'Страницата е потвърдена извън сесията и не може да се обедини. Премахнете я от сесията.',
  PAGE_EMPTY: 'В страницата не бяха открити данни за обединяване.',
  ORPHAN_CONTINUATION: 'Страницата започва с наблюдения без станция, но няма предишна станция, към която да се отнесат. Проверете реда на страниците или добавете страницата със станцията преди нея.',
  CROSS_PAGE_CONFLICT: 'Несъответствие между страниците.',
  DUPLICATE_OBSERVATION_ACROSS_PAGES: 'Същата цел е наблюдавана на повече от една страница в тази станция. Изключете повтарящия се ред или поправете целта.',
  ANGLE_UNIT_MISMATCH: 'В тази станция страниците използват различни единици за ъгли (гони и градуси). Проверете и поправете колоната.',
  MIXED_DISTANCE_UNIT_ACROSS_PAGES: 'В тази станция страниците използват различни мерни единици за разстояние.',
  MISSING_ORIENTATION: 'Няма зададена ориентация (заден пункт) за тази станция.',
  PAGE_ORDER_SUSPECT: 'Редът на страниците изглежда обърнат: тази страница започва със станцията, с която не завършва предишната, но я повтаря. Проверете реда.',
  NO_OBSERVATIONS: 'Няма наблюдения за потвърждаване.',
  NO_PAGES: 'Добавете поне една страница.',
};

const issue = (code, severity, message, extra = {}) => ({
  code, severity, message, section: 'page', setup: null, row: null, field: null, page: null, pageId: null, pageSetup: null, pageRow: null, ...extra,
});

/**
 * Every issue a page's evaluated notebook carries (page-level, setup-level, station/orientation cells, observation
 * cells), flattened with page-local coordinates. Excluded / blank rows carry none (they are not evidence).
 */
function collectPageIssues(notebook) {
  const out = [];
  const push = (is, extra) => out.push({ code: is.code, severity: is.severity, message: is.message, field: is.field || extra.field || null, ...extra });
  for (const is of notebook.issues || []) push(is, { section: 'page', pageSetup: null, pageRow: null });
  for (const setup of notebook.setups || []) {
    const li = setup.index;
    // MISSING_ORIENTATION is judged ONCE, after merging (a continuation / repeated heading legitimately has no backsight of
    // its own, and a heading page may complete the setup's metadata) - see mergePages
    for (const is of setup.issues || []) if (is.code !== 'MISSING_ORIENTATION') push(is, { section: 'setup', pageSetup: li, pageRow: null });
    const cell = (c, section, field, row) => { for (const is of (c && c.validation && c.validation.issues) || []) push(is, { section, field, pageSetup: li, pageRow: row }); };
    cell(setup.station.point, 'station', 'point', null);
    cell(setup.station.instrumentHeight, 'station', 'instrumentHeight', null);
    cell(setup.station.notes, 'station', 'notes', null);
    if (setup.orientation) {
      cell(setup.orientation.target, 'orientation', 'target', null);
      if (setup.orientation.direction) cell(setup.orientation.direction, 'orientation', 'direction', null);
    }
    for (const row of setup.observations || []) {
      if (row.excluded || row.skipped) continue;
      row.cells.forEach((c, ci) => cell(c, 'observation', (row.cols[ci] && row.cols[ci].field) || null, row.index));
    }
  }
  return out;
}

/**
 * @param {Array<{
 *   order: number, pageId: string, status: string, failure?: {code?: string, message?: string}|null,
 *   evaluated?: {notebook: object, summary: object, setups: object[]}|null,
 *   versions?: object
 * }>} pages  any order; sorted by `order` here. `status` is the CaptureJob status, or 'missing'.
 * @returns {{setups: object[], issues: object[], pages: object[], summary: object}}
 */
function mergePages(pages) {
  const ordered = [...pages].sort((a, b) => a.order - b.order);
  const merged = [];
  const issues = [];
  const pageViews = [];
  const refs = []; // per ready page: where its local setups/rows ended up, to place page-level issues
  let prevLast = null;

  ordered.forEach((page, pageIdx) => {
    const pageNo = page.order + 1;
    const view = { pageId: page.pageId, page: pageNo, order: page.order, state: 'ready', setups: 0, observations: 0, errors: 0, warnings: 0, continuesStation: null, repeatsStation: null };
    pageViews.push(view);
    const flag = (code, severity, message, extra = {}) => issues.push(issue(code, severity, message, { page: pageNo, pageId: page.pageId, ...extra }));

    if (page.status !== 'needs_review') {
      view.state = page.status === 'failed' ? 'failed' : page.status === 'confirmed' ? 'confirmed' : page.status === 'missing' ? 'missing' : 'processing';
      const code = { failed: 'PAGE_FAILED', confirmed: 'PAGE_CONFIRMED_ELSEWHERE', missing: 'PAGE_MISSING', processing: 'PAGE_PROCESSING' }[view.state];
      flag(code, 'error', MESSAGES[code], page.failure && page.failure.message ? { detail: page.failure.message } : {});
      return;
    }
    if (!page.evaluated || !page.evaluated.notebook) {
      view.state = 'failed';
      flag('PAGE_EMPTY', 'error', MESSAGES.PAGE_EMPTY);
      return;
    }

    const { notebook, summary, setups } = page.evaluated;
    const ref = { page, pageNo, setupMap: new Map(), rowMap: new Map() };
    refs.push(ref);
    view.observations = summary.observations;
    view.setups = (notebook.setups || []).length;

    // page-order suspicion: this page opens with the station the previous page began with (not the one it ended with)
    const prevPage = pageViews[pageIdx - 1] && refs.find((r) => r.page === ordered[pageIdx - 1]);
    if (prevPage && setups[0] && !setups[0].continuation) {
      const prevSetups = prevPage.page.evaluated.setups;
      if (prevSetups.length > 1 && norm(prevSetups[0].station.point) === norm(setups[0].station.point) && norm(prevSetups[prevSetups.length - 1].station.point) !== norm(setups[0].station.point)) {
        flag('PAGE_ORDER_SUSPECT', 'warning', MESSAGES.PAGE_ORDER_SUSPECT, { pageSetup: 0, section: 'setup' });
      }
    }

    setups.forEach((setup, position) => {
      const li = setup.index; // the page-local setup index (what the page's own review addresses)
      const first = position === 0;
      let target;
      if (first && setup.continuation) {
        if (prevLast) {
          target = prevLast;
          view.continuesStation = target.station.point;
        } else {
          flag('ORPHAN_CONTINUATION', 'error', MESSAGES.ORPHAN_CONTINUATION, { pageSetup: li, section: 'setup' });
          target = { index: merged.length, station: { point: null, instrumentHeight: null, notes: '' }, orientation: null, pages: [], observations: [], orphan: true };
          merged.push(target);
        }
      } else if (first && prevLast && setup.station.point && norm(prevLast.station.point) === norm(setup.station.point)) {
        target = prevLast;
        view.repeatsStation = target.station.point;
        mergeHeading(target, setup, page, pageNo, li, flag);
      } else {
        target = {
          index: merged.length,
          station: { point: setup.station.point, instrumentHeight: setup.station.instrumentHeight, notes: setup.station.notes || '' },
          orientation: setup.orientation ? { ...setup.orientation } : null,
          pages: [],
          observations: [],
          headingPage: page.order,
        };
        merged.push(target);
      }
      if (!target.pages.includes(page.order)) target.pages.push(page.order);
      ref.setupMap.set(li, target.index);
      for (const o of setup.observations) {
        const row = target.observations.length;
        target.observations.push({ ...o, row, source: { page: page.order, captureJobId: page.pageId, setup: li, row: o.row } });
        ref.rowMap.set(`${li}:${o.row}`, row);
      }
      prevLast = target;
    });
  });

  // ---- cross-page validation per merged setup ----------------------------------------------------------------------
  const pageNoOf = (order) => order + 1;
  for (const setup of merged) {
    const at = (o) => ({ page: pageNoOf(o.source.page), pageId: o.source.captureJobId, pageSetup: o.source.setup, pageRow: o.source.row, setup: setup.index, row: o.row, section: 'observation' });

    const byTarget = new Map();
    for (const o of setup.observations) {
      const k = norm(o.target);
      if (k) byTarget.set(k, [...(byTarget.get(k) || []), o]);
    }
    for (const group of byTarget.values()) {
      if (group.length > 1 && new Set(group.map((o) => o.source.page)).size > 1) {
        for (const o of group) issues.push(issue('DUPLICATE_OBSERVATION_ACROSS_PAGES', 'error', MESSAGES.DUPLICATE_OBSERVATION_ACROSS_PAGES, { ...at(o), field: 'target' }));
      }
    }

    for (const field of ['hz', 'vz']) {
      const units = new Map();
      for (const o of setup.observations) if (o[field]) units.set(o[field].unit, [...(units.get(o[field].unit) || []), o]);
      if (units.size > 1) {
        const pagesInvolved = [...new Set([...units.values()].flat().map((o) => pageNoOf(o.source.page)))].sort((a, b) => a - b);
        const first = setup.observations.find((o) => o[field]);
        issues.push(issue('ANGLE_UNIT_MISMATCH', 'error', `${MESSAGES.ANGLE_UNIT_MISMATCH} (${field === 'hz' ? 'Hz' : 'V'}, стр. ${pagesInvolved.join(', ')})`, { ...at(first), row: null, pageRow: null, field, section: 'setup', pageId: null }));
      }
    }

    const explicitUnits = new Set(setup.observations.map((o) => o.distance).filter((d) => d && d.explicit).map((d) => d.unit));
    const pagesWithUnit = new Set(setup.observations.filter((o) => o.distance && o.distance.explicit).map((o) => o.source.page));
    if (explicitUnits.size > 1 && pagesWithUnit.size > 1) {
      issues.push(issue('MIXED_DISTANCE_UNIT_ACROSS_PAGES', 'warning', MESSAGES.MIXED_DISTANCE_UNIT_ACROSS_PAGES, { setup: setup.index, section: 'setup', field: 'distance' }));
    }

    if (setup.observations.length && !setup.orientation && !setup.orphan) {
      issues.push(issue('MISSING_ORIENTATION', 'warning', MESSAGES.MISSING_ORIENTATION, { setup: setup.index, section: 'setup', page: pageNoOf(setup.headingPage), pageSetup: null }));
    }
  }

  // ---- the pages' own issues, placed in the merged notebook ---------------------------------------------------------
  for (const ref of refs) {
    for (const is of collectPageIssues(ref.page.evaluated.notebook)) {
      issues.push({
        ...is,
        page: ref.pageNo,
        pageId: ref.page.pageId,
        setup: is.pageSetup === null ? null : (ref.setupMap.has(is.pageSetup) ? ref.setupMap.get(is.pageSetup) : null),
        row: is.pageSetup === null || is.pageRow === null ? null : (ref.rowMap.has(`${is.pageSetup}:${is.pageRow}`) ? ref.rowMap.get(`${is.pageSetup}:${is.pageRow}`) : null),
      });
    }
  }

  const observationsKept = merged.reduce((n, s) => n + s.observations.length, 0);
  if (!ordered.length) issues.push(issue('NO_PAGES', 'error', MESSAGES.NO_PAGES));
  else if (observationsKept === 0 && !issues.some((i) => i.severity === 'error')) issues.push(issue('NO_OBSERVATIONS', 'error', MESSAGES.NO_OBSERVATIONS));

  issues.sort((a, b) => (a.page || 0) - (b.page || 0) || (a.pageSetup ?? -1) - (b.pageSetup ?? -1) || (a.pageRow ?? -1) - (b.pageRow ?? -1) || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
  for (const v of pageViews) {
    v.errors = issues.filter((i) => i.page === v.page && i.severity === 'error').length;
    v.warnings = issues.filter((i) => i.page === v.page && i.severity === 'warning').length;
  }

  const errors = issues.filter((i) => i.severity === 'error').length;
  const summary = {
    pages: ordered.length,
    setups: merged.filter((s) => !s.orphan).length,
    observations: pageViews.reduce((n, v) => n + v.observations, 0),
    errors,
    warnings: issues.length - errors,
    canConfirm: errors === 0 && observationsKept > 0 && pageViews.every((v) => v.state === 'ready'),
  };
  return { setups: merged, issues, pages: pageViews, summary };
}

/** Merges a repeated heading's metadata into the setup it repeats: fill what is missing, flag what differs. */
function mergeHeading(target, setup, page, pageNo, li, flag) {
  const first = target.headingPage + 1;
  const conflict = (field, label, a, b) => flag('CROSS_PAGE_CONFLICT', 'error',
    `${MESSAGES.CROSS_PAGE_CONFLICT} Станция ${target.station.point}: ${label} – ${a} (стр. ${first}) и ${b} (стр. ${pageNo}). Поправете една от стойностите.`,
    { pageSetup: li, section: 'station', field, setup: target.index, otherPage: first });

  const hiA = target.station.instrumentHeight;
  const hiB = setup.station.instrumentHeight;
  if (hiA && hiB) { if (!sameMetres(hiA, hiB)) conflict('instrumentHeight', 'височина на инструмента', fmtMeasure(hiA), fmtMeasure(hiB)); }
  else if (!hiA && hiB) target.station.instrumentHeight = hiB;

  const oA = target.orientation;
  const oB = setup.orientation;
  if (oA && oB) {
    if (oA.target && oB.target && norm(oA.target) !== norm(oB.target)) conflict('orientationTarget', 'ориентир', oA.target, oB.target);
    if (oA.direction && oB.direction) { if (!sameGon(oA.direction, oB.direction)) conflict('orientationDirection', 'посока към ориентира', fmtAngle(oA.direction), fmtAngle(oB.direction)); }
    else if (!oA.direction && oB.direction) oA.direction = oB.direction;
    if (!oA.target && oB.target) oA.target = oB.target;
  } else if (!oA && oB) {
    target.orientation = { ...oB };
  }
  if (!target.station.notes && setup.station.notes) target.station.notes = setup.station.notes;
}

/** The FieldObservationSet `pages` provenance array for the merged pages (audit data, never shown). */
function pageProvenance(pages) {
  return [...pages].sort((a, b) => a.order - b.order).map((p) => ({ page: p.order, captureJobId: p.pageId, ...(p.versions || {}) }));
}

module.exports = { mergePages, collectPageIssues, pageProvenance, MESSAGES, mergeVersion: () => getConfig().mergeVersion };
