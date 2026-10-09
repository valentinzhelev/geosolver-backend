/**
 * Deterministic report-model builder for POLAR_PROCESSING_REPORT (V2.5 section 5). Pure function: given an
 * ALREADY-FETCHED, authoritative FieldProcessingRun (polar) document and its source FieldObservationSet, produces
 * a plain-object snapshot ready to persist verbatim on the ReportDocument and to hand to the PDF renderer.
 *
 * NEVER recalculates a geodetic result: X/Y/H/direction/horizontalDistance/status all come straight from the
 * run's own persisted `setups`. The raw Hz/vertical-angle/slope-distance/prism-height readings shown alongside
 * them are read from the source FieldObservationSet's own persisted evidence (never re-derived, never re-run
 * through an engine) - joined by (setup index, observation row), matching the same correlation the run itself was
 * computed from.
 */
function rawSetupLookup(fos, setupIndex) {
  return (fos.setups || []).find((s) => s.index === setupIndex) || null;
}
function rawObservationLookup(fosSetup, row) {
  if (!fosSetup) return null;
  return (fosSetup.observations || []).find((o) => o.row === row) || null;
}

function buildPolarReportModel({ run, fos, project, generatedBy, generatedAt, documentNumber = null }) {
  const setups = (run.setups || []).map((setup) => {
    const fosSetup = rawSetupLookup(fos, setup.index);
    const observations = (setup.observations || []).map((o) => {
      const raw = rawObservationLookup(fosSetup, o.index);
      return {
        target: o.target,
        hz: raw && raw.hz ? { value: raw.hz.value, unit: raw.hz.unit } : null,
        direction: o.direction,
        horizontalDistance: o.horizontalDistance,
        slopeDistance: raw && raw.distance ? { value: raw.distance.value, unit: raw.distance.unit } : null,
        x: o.x,
        y: o.y,
        h: o.h,
        status: o.status,
        heightDetail: o.h !== null ? {
          stationH: setup.station.point ? setup.station.point.h : null,
          instrumentHeight: fosSetup && fosSetup.station ? fosSetup.station.instrumentHeight : null,
          verticalObservation: raw && raw.vz ? { value: raw.vz.value, unit: raw.vz.unit } : null,
          prismHeight: raw && raw.prismHeight ? { value: raw.prismHeight.value, unit: raw.prismHeight.unit } : null,
          derivedH: o.h,
        } : null,
        heightReason: o.heightReason || null,
        errors: o.errors || [],
        warnings: o.warnings || [],
      };
    });
    return {
      index: setup.index,
      station: { identifier: setup.station.identifier, point: setup.station.point },
      orientation: setup.orientation ? { identifier: setup.orientation.identifier, point: setup.orientation.point } : null,
      orientationConstantGon: setup.orientationConstantGon,
      setupError: setup.setupError,
      observations,
    };
  });

  return {
    reportType: 'POLAR_PROCESSING_REPORT',
    title: 'Отчет за полярна обработка',
    documentNumber,
    generatedAt,
    generatedBy: { id: String(generatedBy.id), name: generatedBy.name || generatedBy.email || '' },
    project: { id: String(project._id), name: project.name, crs: project.crs || null },
    source: {
      fieldObservationSetId: String(run.source.fieldObservationSetId),
      ...(run.source.captureJobId ? { captureJobId: String(run.source.captureJobId) } : {}),
      ...(run.source.fieldSessionId ? { fieldSessionId: String(run.source.fieldSessionId) } : {}),
      processingRunId: String(run._id),
      processingVersion: run.processingVersion,
      engineVersions: run.engineVersions,
      verticalAngleConvention: run.verticalAngleConvention || null,
    },
    setups,
  };
}

module.exports = { buildPolarReportModel };
