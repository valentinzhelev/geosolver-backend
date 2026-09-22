/**
 * Renders a POLAR_PROCESSING_REPORT model (V2.5 section 5) into a pdfmake docDefinition. Pure presentation: every
 * number displayed here is read straight from the model, never recomputed.
 */
const { buildDocument, tableLayout } = require('./layout');
const { fmtCoord, fmtHeight, fmtDistance, fmtGon, fmtAngleRaw } = require('../formatting');
const { observationStatusLabel, reasonMessage } = require('../messages');

function sourceSection(model, bg) {
  return [
    { text: bg ? 'Източник' : 'Source', style: 'h2' },
    {
      fontSize: 8.5,
      columnGap: 16,
      columns: [
        [
          { text: [{ text: `${bg ? 'Версия на обработката' : 'Processing version'}: `, bold: true }, model.source.processingVersion] },
          { text: [{ text: `${bg ? 'Конвенция за вертикален ъгъл' : 'Vertical-angle convention'}: `, bold: true }, model.source.verticalAngleConvention || (bg ? 'не е зададена' : 'not set')] },
        ],
        [
          { text: [{ text: `${bg ? 'Идентификатор на обработката' : 'Processing run id'}: `, bold: true }, model.source.processingRunId] },
          { text: [{ text: `${bg ? 'Версии на двигателите' : 'Engine versions'}: `, bold: true }, Object.entries(model.source.engineVersions || {}).map(([k, v]) => `${k} v${v}`).join(', ')] },
        ],
      ],
    },
  ];
}

function setupSection(setup, bg) {
  const out = [
    { text: `${bg ? 'Станция' : 'Station'} ${setup.station.identifier}`, style: 'h2' },
  ];
  const p = setup.station.point;
  const o = setup.orientation && setup.orientation.point;
  out.push({
    fontSize: 8.5,
    columnGap: 16,
    margin: [0, 0, 0, 6],
    columns: [
      { text: p ? [{ text: `X=${fmtCoord(p.x)}  Y=${fmtCoord(p.y)}  H=${fmtHeight(p.h)}` }] : (bg ? 'не е намерена' : 'not found') },
      { text: setup.orientation ? `${bg ? 'Ориентир' : 'Orientation'}: ${setup.orientation.identifier}${o ? ` (X=${fmtCoord(o.x)}, Y=${fmtCoord(o.y)})` : ''}` : (bg ? 'Без ориентир' : 'No orientation'), alignment: 'right' },
    ],
  });
  if (setup.orientationConstantGon !== null && setup.orientationConstantGon !== undefined) {
    out.push({ text: `${bg ? 'Ориентировъчен ъгъл' : 'Orientation constant'}: ${fmtGon(setup.orientationConstantGon)}`, fontSize: 8.5, margin: [0, 0, 0, 6] });
  }

  if (setup.setupError) {
    out.push({ text: `${bg ? 'Невалидна станция' : 'Invalid setup'}: ${reasonMessage(setup.setupError)}`, style: 'note' });
    return out;
  }

  const headers = [
    bg ? 'Цел' : 'Target', 'Hz', bg ? 'Посока' : 'Direction',
    bg ? 'Хор. разст.' : 'Horiz. dist.', bg ? 'Накл. разст.' : 'Slope dist.',
    'X', 'Y', 'H', bg ? 'Статус' : 'Status',
  ].map((t) => ({ text: t, style: 'tableHeader' }));

  const rows = setup.observations.map((o2) => ([
    { text: o2.target, style: 'cell' },
    { text: fmtAngleRaw(o2.hz), style: 'cell' },
    { text: fmtGon(o2.direction), style: 'cell' },
    { text: fmtDistance(o2.horizontalDistance), style: 'cell' },
    { text: o2.slopeDistance ? fmtDistance(o2.slopeDistance.value) : '—', style: 'cell' },
    { text: fmtCoord(o2.x), style: 'cell' },
    { text: fmtCoord(o2.y), style: 'cell' },
    { text: fmtHeight(o2.h), style: 'cell' },
    { text: observationStatusLabel(o2.status), style: 'cell' },
  ]));

  out.push({
    table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'], body: [headers, ...rows] },
    layout: tableLayout,
    margin: [0, 0, 0, 4],
  });

  const notes = setup.observations.filter((o2) => o2.heightReason || (o2.errors && o2.errors.length));
  if (notes.length) {
    out.push({
      ul: notes.map((o2) => {
        const reason = o2.heightReason ? reasonMessage(o2.heightReason) : (o2.errors[0] && o2.errors[0].message);
        return `${o2.target}: ${reason}`;
      }),
      style: 'note',
      margin: [0, 0, 0, 8],
    });
  }

  return out;
}

function renderPolarReport(model, bg = true) {
  const content = [
    ...sourceSection(model, bg),
    ...model.setups.flatMap((s) => setupSection(s, bg)),
  ];
  return buildDocument({ model, bg, content });
}

module.exports = { renderPolarReport };
