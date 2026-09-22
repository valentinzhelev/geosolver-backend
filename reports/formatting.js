/**
 * Centralized geodetic display formatting for the Report engine (V2.5 section 9). These functions NEVER round or
 * mutate a persisted value - they only produce a presentation string from an already-computed number. A report
 * renderer must always pass the exact persisted numeric value straight from a ReportDocument's snapshot model.
 */
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

const DASH = '—';

/** A coordinate (X/Y), 3 decimals by default: "4700030.000". Never a fabricated 0 - a missing value is a dash. */
function fmtCoord(value, decimals = 3) {
  return finite(value) ? value.toFixed(decimals) : DASH;
}

/** A height (H), same rule as fmtCoord but with an explicit Bulgarian "not available" for the detail line. */
function fmtHeight(value, decimals = 3) {
  return finite(value) ? value.toFixed(decimals) : DASH;
}
function heightUnavailableLabel(bg = true) {
  return bg ? 'не е налична' : 'not available';
}

/** A horizontal/slope distance/length: "125.438 m". */
function fmtDistance(value, decimals = 3) {
  return finite(value) ? `${value.toFixed(decimals)} m` : DASH;
}

/** An angle already expressed in gon (the internal working unit for all V2.4 field-processing results): "123.4567 gon". */
function fmtGon(value, decimals = 4) {
  return finite(value) ? `${value.toFixed(decimals)} gon` : DASH;
}

/** An angle in decimal degrees: "123.4567°". */
function fmtDeg(value, decimals = 4) {
  return finite(value) ? `${value.toFixed(decimals)}°` : DASH;
}

/** An angle in decimal degrees, formatted as degrees/minutes/seconds: 94.504222 -> "94°30'15.2\"". */
function fmtDMS(decimalDegrees, secondsDecimals = 1) {
  if (!finite(decimalDegrees)) return DASH;
  const sign = decimalDegrees < 0 ? '-' : '';
  const abs = Math.abs(decimalDegrees);
  let deg = Math.floor(abs);
  let min = Math.floor((abs - deg) * 60);
  let sec = (abs - deg - min / 60) * 3600;
  let secStr = sec.toFixed(secondsDecimals);
  // carry a seconds rounding of 60.0 up into minutes/degrees, never display "60.0\""
  if (Number(secStr) >= 60) { secStr = (0).toFixed(secondsDecimals); min += 1; }
  if (min >= 60) { min = 0; deg += 1; }
  const secPadded = Number(secStr) < 10 ? `0${secStr}` : secStr;
  return `${sign}${deg}°${String(min).padStart(2, '0')}'${secPadded}"`;
}

/** A raw {value, unit} angle reading exactly as recorded (never force-converted to a different unit for display).
 *  A FieldObservationSet only ever stores 'gon' or 'deg' (capture/notebook resolves any ambiguity before
 *  confirmation), so those are the only two branches. */
function fmtAngleRaw(angle, decimals = 4) {
  if (!angle || !finite(angle.value)) return DASH;
  return angle.unit === 'deg' ? fmtDeg(angle.value, decimals) : fmtGon(angle.value, decimals);
}

/** A relative closure ratio "1 : N" - never a fabricated N when the denominator is unavailable/undefined. */
function fmtRelativeClosure(denominator, bg = true) {
  if (!finite(denominator)) return DASH;
  return `1 : ${Math.round(denominator).toLocaleString(bg ? 'bg-BG' : 'en-US')}`;
}

/** A generated-document timestamp: "22.09.2026 14:05". */
function fmtDateTime(value, bg = true) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return DASH;
  return d.toLocaleString(bg ? 'bg-BG' : 'en-GB', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

module.exports = { fmtCoord, fmtHeight, heightUnavailableLabel, fmtDistance, fmtGon, fmtDeg, fmtDMS, fmtAngleRaw, fmtRelativeClosure, fmtDateTime, DASH };
