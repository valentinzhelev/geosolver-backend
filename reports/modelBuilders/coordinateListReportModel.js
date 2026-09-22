/**
 * Deterministic report-model builder for PROJECT_COORDINATE_LIST (V2.5 section 6). Pure function of an
 * ALREADY-FETCHED array of SurveyPoint documents (the project's current points AT THE MOMENT of generation) - the
 * caller is responsible for taking that snapshot; this function never queries anything itself, so the resulting
 * model is exactly what later persists on the ReportDocument (later edits to those SurveyPoints never change it).
 */
function sourceTypeLabel(point) {
  const kind = point.source && point.source.kind;
  if (kind === 'capture') return 'От заснемане'; // From capture
  if (kind === 'field-processing') {
    const isTraverse = point.source.processingType === 'traverse';
    return isTraverse
      ? 'От обработка (полигонов ход)' // From processing (traverse)
      : 'От обработка (полярна)'; // From processing (polar)
  }
  if (point.sourceCalculationId) return 'От изчисление'; // From calculation
  return 'Ръчно въведена'; // Manually entered
}

function buildCoordinateListReportModel({ project, points, generatedBy, generatedAt, documentNumber = null }) {
  const rows = points.map((p, i) => ({
    no: i + 1,
    name: p.name,
    code: p.code || '',
    x: typeof p.x === 'number' ? p.x : null,
    y: typeof p.y === 'number' ? p.y : null,
    h: typeof p.h === 'number' ? p.h : null,
    sourceType: sourceTypeLabel(p),
    notes: p.notes || '',
  }));

  return {
    reportType: 'PROJECT_COORDINATE_LIST',
    title: 'Координатен регистър',
    documentNumber,
    generatedAt,
    generatedBy: { id: String(generatedBy.id), name: generatedBy.name || generatedBy.email || '' },
    project: { id: String(project._id), name: project.name, crs: project.crs || null },
    pointCount: rows.length,
    points: rows,
  };
}

module.exports = { buildCoordinateListReportModel };
