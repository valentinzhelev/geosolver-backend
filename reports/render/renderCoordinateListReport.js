/**
 * Renders a PROJECT_COORDINATE_LIST model (V2.5 section 6) into a pdfmake docDefinition: a single long,
 * paginated register table. Official convention: X = Northing, Y = Easting (stated explicitly in the header row).
 */
const { buildDocument, tableLayout } = require('./layout');
const { fmtCoord, fmtHeight } = require('../formatting');

function renderCoordinateListReport(model, bg = true) {
  const headers = [
    'No', bg ? 'Точка' : 'Point', bg ? 'Код' : 'Code',
    'X (Север)', 'Y (Изток)', 'H',
    bg ? 'Източник' : 'Source', bg ? 'Бележки' : 'Notes',
  ].map((t) => ({ text: t, style: 'tableHeader' }));

  const rows = model.points.map((p) => ([
    { text: String(p.no), style: 'cell' },
    { text: p.name, style: 'cell' },
    { text: p.code || '—', style: 'cell' },
    { text: fmtCoord(p.x), style: 'cell' },
    { text: fmtCoord(p.y), style: 'cell' },
    { text: fmtHeight(p.h), style: 'cell' },
    { text: p.sourceType, style: 'cell' },
    { text: p.notes || '', style: 'cell' },
  ]));

  const content = [
    {
      text: bg
        ? `Общ брой точки: ${model.pointCount}`
        : `Total points: ${model.pointCount}`,
      fontSize: 8.5, margin: [0, 0, 0, 8],
    },
    model.pointCount > 0
      ? { table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto', '*'], body: [headers, ...rows] }, layout: tableLayout }
      : { text: bg ? 'Проектът няма точки.' : 'The project has no points.', style: 'note' },
  ];

  return buildDocument({ model, bg, content });
}

module.exports = { renderCoordinateListReport };
