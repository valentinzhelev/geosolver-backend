/**
 * Renders a TRAVERSE_PROCESSING_REPORT model (V2.5 section 4) into a pdfmake docDefinition. Pure presentation:
 * every number displayed here is read straight from the model, never recomputed. OPEN traverses explicitly state
 * that closure/Bowditch do not apply - never a fake zero, never a silently-omitted section.
 */
const { buildDocument, tableLayout } = require('./layout');
const { fmtCoord, fmtHeight, fmtDistance, fmtGon, fmtRelativeClosure } = require('../formatting');
const { observationStatusLabel, traverseTypeLabel, reasonMessage } = require('../messages');

function controlSection(model, bg) {
  const c = model.control;
  const line = (label, ctrl) => (ctrl && ctrl.point
    ? `${label} ${ctrl.identifier}: X=${fmtCoord(ctrl.point.x)}, Y=${fmtCoord(ctrl.point.y)}${typeof ctrl.point.h === 'number' ? `, H=${fmtHeight(ctrl.point.h)}` : ''}`
    : `${label}: ${ctrl && ctrl.identifier ? ctrl.identifier : (bg ? 'не е намерена' : 'not found')}`);

  return [
    { text: bg ? 'Контролни данни' : 'Control data', style: 'h2' },
    { text: `${bg ? 'Тип на хода' : 'Traverse type'}: ${traverseTypeLabel(model.traverseType)}`, fontSize: 8.5, margin: [0, 0, 0, 3] },
    { text: line(bg ? 'Начална станция' : 'Start station', c.start), fontSize: 8.5, margin: [0, 0, 0, 3] },
    { text: line(bg ? 'Начална ориентация' : 'Initial orientation', c.orientation), fontSize: 8.5, margin: [0, 0, 0, 3] },
    c.end
      ? { text: line(bg ? 'Крайна контролна точка' : 'Endpoint control', c.end), fontSize: 8.5, margin: [0, 0, 0, 8] }
      : { text: bg ? 'Отворен ход - няма крайна контролна точка.' : 'Open traverse - no endpoint control.', fontSize: 8.5, margin: [0, 0, 0, 8] },
  ];
}

function summarySection(model, bg) {
  const out = [{ text: bg ? 'Обобщение на хода' : 'Traverse summary', style: 'h2' }];
  const c = model.closure;

  if (!c.available) {
    out.push({
      text: (bg
        ? 'За отворен ход независимо затваряне на координати и изравнение по Bowditch не са приложими.'
        : 'Independent coordinate closure and Bowditch adjustment are not applicable for an open traverse.') + ` (${reasonMessage(c.reason) || c.reason})`,
      style: 'note', margin: [0, 0, 0, 10],
    });
    return out;
  }

  out.push({
    fontSize: 8.5,
    columnGap: 16,
    margin: [0, 0, 0, 4],
    columns: [
      [
        { text: [{ text: `${bg ? 'Обща хоризонтална дължина' : 'Total horizontal length'}: `, bold: true }, fmtDistance(c.totalLength)] },
        { text: [{ text: 'fX: ', bold: true }, fmtCoord(c.fX)] },
        { text: [{ text: 'fY: ', bold: true }, fmtCoord(c.fY)] },
      ],
      [
        { text: [{ text: `${bg ? 'Линейна невръзка' : 'Linear misclosure'}: `, bold: true }, fmtCoord(c.linearMisclosure)] },
        { text: [{ text: `${bg ? 'Относителна невръзка' : 'Relative closure'}: `, bold: true }, c.perfectClosure ? (bg ? 'точно съвпадение' : 'exact match') : fmtRelativeClosure(c.relativeClosureDenominator, bg)] },
        { text: [{ text: `${bg ? 'Метод на изравнение' : 'Adjustment method'}: `, bold: true }, model.adjustment.applied ? 'Bowditch' : (bg ? 'не е приложено' : 'not applied')] },
      ],
    ],
  });
  return out;
}

function legTable(model, bg) {
  const headers = [
    bg ? 'От' : 'From', bg ? 'Към' : 'To', bg ? 'Посока' : 'Bearing', bg ? 'Разст.' : 'Dist.',
    'ΔX', 'ΔY', bg ? 'Статус' : 'Status',
  ].map((t) => ({ text: t, style: 'tableHeader' }));
  const rows = model.legs.map((l) => ([
    { text: l.from, style: 'cell' }, { text: l.to, style: 'cell' }, { text: fmtGon(l.bearingGon), style: 'cell' },
    { text: fmtDistance(l.horizontalDistance), style: 'cell' }, { text: fmtCoord(l.rawDeltaX), style: 'cell' }, { text: fmtCoord(l.rawDeltaY), style: 'cell' },
    { text: observationStatusLabel(l.status), style: 'cell' },
  ]));
  return {
    table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'], body: [headers, ...rows] },
    layout: tableLayout, margin: [0, 0, 0, 10],
  };
}

function resultTable(model, bg) {
  const adjusted = !!(model.adjustment && model.adjustment.applied);
  const headers = [
    bg ? 'Точка' : 'Point', `${bg ? 'Сурови' : 'Raw'} X`, `${bg ? 'Сурови' : 'Raw'} Y`, `${bg ? 'Сурова' : 'Raw'} H`,
    `${bg ? 'Изравнени' : 'Adjusted'} X`, `${bg ? 'Изравнени' : 'Adjusted'} Y`, bg ? 'Статус' : 'Status',
  ].map((t) => ({ text: t, style: 'tableHeader' }));
  const na = bg ? 'Не е приложимо' : 'Not applicable';
  const rows = model.legs.map((l) => ([
    { text: l.to, style: 'cell' }, { text: fmtCoord(l.rawX), style: 'cell' }, { text: fmtCoord(l.rawY), style: 'cell' }, { text: fmtHeight(l.rawH), style: 'cell' },
    { text: adjusted ? fmtCoord(l.adjustedX) : na, style: 'cell' }, { text: adjusted ? fmtCoord(l.adjustedY) : na, style: 'cell' },
    { text: observationStatusLabel(l.status), style: 'cell' },
  ]));
  return [
    { text: bg ? 'Резултати' : 'Results', style: 'h2' },
    { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'], body: [headers, ...rows] }, layout: tableLayout, margin: [0, 0, 0, 10] },
  ];
}

function bowditchTable(model, bg) {
  if (!model.adjustment || !model.adjustment.applied) return [];
  const headers = [
    bg ? 'Отсечка' : 'Leg', bg ? 'Дължина' : 'Length', 'cX', 'cY', `${bg ? 'Изр.' : 'Adj.'} ΔX`, `${bg ? 'Изр.' : 'Adj.'} ΔY`,
  ].map((t) => ({ text: t, style: 'tableHeader' }));
  const rows = model.legs.map((l) => ([
    { text: `${l.from} → ${l.to}`, style: 'cell' }, { text: fmtDistance(l.horizontalDistance), style: 'cell' },
    { text: fmtCoord(l.correctionX), style: 'cell' }, { text: fmtCoord(l.correctionY), style: 'cell' },
    { text: fmtCoord(l.rawDeltaX + l.correctionX), style: 'cell' }, { text: fmtCoord(l.rawDeltaY + l.correctionY), style: 'cell' },
  ]));
  return [
    { text: bg ? 'Изравнение по компасното правило (Bowditch)' : 'Compass-rule (Bowditch) adjustment', style: 'h2' },
    {
      text: bg
        ? 'Изравнението разпределя невръзката пропорционално на дължината на отсечките (класически метод, не е изравнение по най-малки квадрати).'
        : 'The adjustment distributes the misclosure proportionally by leg length (a classic method, not a least-squares adjustment).',
      style: 'small', margin: [0, 0, 0, 4],
    },
    { table: { headerRows: 1, widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'], body: [headers, ...rows] }, layout: tableLayout, margin: [0, 0, 0, 10] },
  ];
}

function renderTraverseReport(model, bg = true) {
  const content = [
    ...controlSection(model, bg),
    ...summarySection(model, bg),
    { text: bg ? 'Наблюдения / отсечки' : 'Observations / legs', style: 'h2' },
    legTable(model, bg),
    ...resultTable(model, bg),
    ...bowditchTable(model, bg),
  ];
  return buildDocument({ model, bg, content });
}

module.exports = { renderTraverseReport };
