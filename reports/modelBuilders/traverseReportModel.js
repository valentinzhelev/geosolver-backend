/**
 * Deterministic report-model builder for TRAVERSE_PROCESSING_REPORT (V2.5 section 4). Pure function of an
 * ALREADY-FETCHED, authoritative FieldProcessingRun (traverse) document alone - every field the report needs
 * (bearing, distance, raw/adjusted deltas and coordinates, closure, Bowditch corrections, status) is already
 * persisted directly on `run.traverse`, so this never joins against or re-reads the source FieldObservationSet.
 * NEVER recalculates: no trig, no closure arithmetic, no Bowditch math happens here.
 */
function buildTraverseReportModel({ run, project, generatedBy, generatedAt, documentNumber = null }) {
  const t = run.traverse;
  const adjusted = !!(t.adjustment && t.adjustment.applied);

  const legs = (t.legs || []).map((l) => ({
    index: l.index,
    from: l.from,
    to: l.to,
    status: l.status,
    bearingGon: l.bearingGon,
    horizontalDistance: l.horizontalDistance,
    rawDeltaX: l.rawDeltaX,
    rawDeltaY: l.rawDeltaY,
    rawX: l.rawX,
    rawY: l.rawY,
    rawH: l.rawH,
    heightReason: l.heightReason,
    adjustedX: adjusted ? l.adjustedX : null,
    adjustedY: adjusted ? l.adjustedY : null,
    correctionX: adjusted ? l.correctionX : null,
    correctionY: adjusted ? l.correctionY : null,
    errors: l.errors || [],
    warnings: l.warnings || [],
  }));

  return {
    reportType: 'TRAVERSE_PROCESSING_REPORT',
    title: 'Отчет за обработка на полигонов ход',
    documentNumber,
    generatedAt,
    generatedBy: { id: String(generatedBy.id), name: generatedBy.name || generatedBy.email || '' },
    project: { id: String(project._id), name: project.name, crs: project.crs || null },
    source: {
      fieldObservationSetId: String(run.source.fieldObservationSetId),
      captureJobId: String(run.source.captureJobId),
      processingRunId: String(run._id),
      processingVersion: run.processingVersion,
      engineVersions: run.engineVersions,
      verticalAngleConvention: run.verticalAngleConvention || null,
    },
    traverseType: t.traverseType,
    status: t.status,
    control: {
      start: { identifier: t.start ? t.start.identifier : null, point: t.start ? t.start.point : null },
      orientation: { identifier: t.orientation ? t.orientation.identifier : null, point: t.orientation ? t.orientation.point : null },
      end: t.end ? { identifier: t.end.identifier, point: t.end.point } : null,
    },
    closure: t.closure,
    adjustment: t.adjustment,
    legs,
  };
}

module.exports = { buildTraverseReportModel };
