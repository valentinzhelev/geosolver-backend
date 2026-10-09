/**
 * Revisions (pure): confirmed evidence is immutable, so a correction starts a NEW editable session whose raw
 * entries are a faithful, lossless text rendering of the confirmed typed values. The original session, its
 * FieldObservationSet and every processing run stay exactly as they were.
 *
 * Round trip: raw text -> (evaluate) -> {value, unit} -> (this) -> raw text -> (evaluate) -> the same {value, unit}.
 * Angles carry an explicit unit suffix (so the new session's declared angle unit cannot reinterpret them); a DMS
 * reading stays DMS.
 */
function angleText(a) {
  if (!a || typeof a.value !== 'number' || !Number.isFinite(a.value)) return '';
  // a DMS reading is re-rendered as DMS (its decimal-degree form can need more digits than the parser accepts, and
  // evaluating the same components reproduces the identical value); everything else already fits the parser (<= 4 decimals)
  if (a.components && typeof a.components.deg === 'number') {
    const sign = a.value < 0 ? '-' : '';
    return `${sign}${Math.abs(a.components.deg)}°${a.components.min}'${a.components.sec}"`;
  }
  return a.unit === 'deg' ? `${a.value}°` : `${a.value}g`;
}

function measureText(m) {
  if (!m || typeof m.value !== 'number' || !Number.isFinite(m.value)) return '';
  // a unit written in the original stays written (even "m"), so `explicit` survives the round trip too
  return `${m.value}${m.unit && (m.unit !== 'm' || m.explicit) ? m.unit : ''}`;
}

/** @param {object[]} confirmedSetups FieldObservationSet.setups -> raw manual setups */
function setupsToRaw(confirmedSetups) {
  return (confirmedSetups || []).map((s) => ({
    index: s.index,
    station: { point: s.station.point || '', instrumentHeight: measureText(s.station.instrumentHeight), notes: s.station.notes || '' },
    orientation: s.orientation ? { target: s.orientation.target || '', direction: angleText(s.orientation.direction) } : null,
    observations: (s.observations || []).map((o) => ({
      row: o.row,
      target: o.target || '',
      hz: angleText(o.hz),
      vz: angleText(o.vz),
      distance: measureText(o.distance),
      horizontalDistance: measureText(o.horizontalDistance),
      prismHeight: measureText(o.prismHeight),
      code: o.code || '',
      notes: o.notes || '',
    })),
  }));
}

module.exports = { setupsToRaw, angleText, measureText };
