const GON_TO_RAD = Math.PI / 200;

function parseNum(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function roundTo(value, decimals) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Normalize a gon angle to [0, 400). */
function normalizeGon(value) {
  if (!Number.isFinite(value)) return null;
  return ((value % 400) + 400) % 400;
}

/** Map a gon residual to [-200, 200] (signed misclosure). */
function signedGon(value) {
  let v = normalizeGon(value);
  if (v === null) return null;
  if (v > 200) v -= 400;
  return v;
}

/**
 * Полигонометричен (координатен) карнет.
 * α_i = α_{i-1} + β_i − 200 (gon),  ΔY = S·sinα,  ΔX = S·cosα,
 * Y_{i+1} = Y_i + ΔY,  X_{i+1} = X_i + ΔX.
 */
function computeCoordinateCarnet(rows, settings = {}) {
  const coordDecimals = Number.isFinite(Number(settings.rounding)) ? Number(settings.rounding) : 3;
  const angleDecimals = Number.isFinite(Number(settings.angleRounding)) ? Number(settings.angleRounding) : 4;
  const startY = parseNum(settings.startY) ?? 0;
  const startX = parseNum(settings.startX) ?? 0;
  const startBearing = normalizeGon(parseNum(settings.startBearing) ?? 0);
  const closed = settings.closed !== false; // default closed traverse
  const endY = closed ? startY : parseNum(settings.endY) ?? startY;
  const endX = closed ? startX : parseNum(settings.endX) ?? startX;
  const angularToleranceMgon = parseNum(settings.angularToleranceMgon) ?? 50;
  const linearTolerance = parseNum(settings.linearTolerance) ?? 1000; // 1/1000

  const warnings = [];
  const computed = [];

  // 1) Bearings (посочни ъгли)
  let prevAlpha = startBearing;
  let sumBeta = 0;
  let betaCount = 0;
  rows.forEach((row, i) => {
    const beta = parseNum(row.beta);
    if (beta !== null) {
      sumBeta += beta;
      betaCount += 1;
    }
    let alpha;
    if (i === 0) {
      alpha = startBearing;
    } else if (beta !== null && prevAlpha !== null) {
      alpha = normalizeGon(prevAlpha + beta - 200);
    } else {
      alpha = null;
    }
    computed.push({ ...row, beta, alpha });
    if (alpha !== null) prevAlpha = alpha;
  });

  // 2) Coordinate differences + coordinates
  let y = startY;
  let x = startX;
  let sumDeltaY = 0;
  let sumDeltaX = 0;
  let sumS = 0;

  computed.forEach((row, i) => {
    const distance = parseNum(row.distance);
    const alpha = row.alpha;
    let deltaY = null;
    let deltaX = null;
    if (distance !== null && alpha !== null) {
      const rad = alpha * GON_TO_RAD;
      deltaY = distance * Math.sin(rad);
      deltaX = distance * Math.cos(rad);
      sumDeltaY += deltaY;
      sumDeltaX += deltaX;
      sumS += distance;
    }

    row.y = roundTo(y, coordDecimals);
    row.x = roundTo(x, coordDecimals);
    row.deltaY = roundTo(deltaY, coordDecimals);
    row.deltaX = roundTo(deltaX, coordDecimals);
    row.alpha = roundTo(alpha, angleDecimals);

    if (deltaY !== null) {
      y += deltaY;
      x += deltaX;
    }

    if (!row.pointNo || !String(row.pointNo).trim()) {
      warnings.push(`Ред ${i + 1}: липсва номер на точка.`);
    }
  });

  // 3) Angular misclosure (ъглова невръзка)
  // Closed loop: after Σβ the bearing must return to start ⇒ residual = Σβ − n·200 (mod 400)
  const angularMisclosureGon = betaCount > 0 ? signedGon(sumBeta - betaCount * 200) : null;
  const angularMisclosureMgon = angularMisclosureGon !== null ? angularMisclosureGon * 1000 : null;

  if (angularMisclosureMgon !== null && Math.abs(angularMisclosureMgon) > angularToleranceMgon) {
    warnings.push(
      `Ъглова невръзка f_β = ${angularMisclosureMgon.toFixed(1)} mgon надвишава допуска (${angularToleranceMgon} mgon).`
    );
  }

  // 4) Linear misclosure (линейна невръзка)
  const fY = sumDeltaY - (endY - startY);
  const fX = sumDeltaX - (endX - startX);
  const fS = Math.sqrt(fY * fY + fX * fX);
  const relative = fS > 1e-9 && sumS > 0 ? sumS / fS : null;

  if (relative !== null && relative < linearTolerance) {
    warnings.push(
      `Линейна невръзка 1/${Math.round(relative)} е под допуска (1/${linearTolerance}).`
    );
  }

  return {
    rows: computed,
    warnings,
    summary: {
      sumBeta: roundTo(sumBeta, angleDecimals),
      sumS: roundTo(sumS, coordDecimals),
      sumDeltaY: roundTo(sumDeltaY, coordDecimals),
      sumDeltaX: roundTo(sumDeltaX, coordDecimals),
      angularMisclosureGon: roundTo(angularMisclosureGon, angleDecimals),
      angularMisclosureMgon: roundTo(angularMisclosureMgon, 1),
      fY: roundTo(fY, coordDecimals),
      fX: roundTo(fX, coordDecimals),
      fS: roundTo(fS, coordDecimals),
      relative: relative !== null ? Math.round(relative) : null,
      closed,
      coordDecimals,
      angleDecimals,
    },
  };
}

module.exports = { computeCoordinateCarnet, normalizeGon, signedGon, parseNum, roundTo };
