const { defineEngine } = require('../define');
const { EngineError } = require('../errors');

// Forward intersection. Signature order is (yA, xA, yB, xB, beta1, beta2) — Y first.
// P is placed on the LEFT of A->B: alpha_AP = alpha_AB - beta1, alpha_BP = alpha_BA + beta2.
function validateForward({ xA, yA, xB, yB, beta1, beta2 }) {
  if (beta1 <= 0 || beta2 <= 0) {
    throw new EngineError('OUT_OF_RANGE', 'Ъглите трябва да бъдат положителни', 'beta1');
  }
  if (beta1 + beta2 >= 200) {
    throw new EngineError('ANGLE_SUM_TOO_LARGE', 'Сумата от ъглите не може да бъде по-голяма от 200 гради', 'beta2');
  }
  if (xA === xB && yA === yB) {
    throw new EngineError('COINCIDENT_POINTS', 'Точките A и B не могат да съвпадат');
  }
}

function computeForward({ yA, xA, yB, xB, beta1, beta2 }) {
  const deltaY = yB - yA;
  const deltaX = xB - xA;
  const sAB = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  const alphaABRad = Math.atan2(deltaY, deltaX);
  let alphaAB = (alphaABRad * 200) / Math.PI;
  if (alphaAB < 0) alphaAB += 400;
  const alphaBA = alphaAB >= 200 ? alphaAB - 200 : alphaAB + 200;

  let alphaAP = alphaAB - beta1;
  let alphaBP = alphaBA + beta2;
  if (alphaAP < 0) alphaAP += 400;
  if (alphaAP >= 400) alphaAP -= 400;
  if (alphaBP < 0) alphaBP += 400;
  if (alphaBP >= 400) alphaBP -= 400;

  const gonToRad = Math.PI / 200;
  const beta1Rad = beta1 * gonToRad;
  const beta2Rad = beta2 * gonToRad;
  const beta3Rad = (beta1 + beta2) * gonToRad;
  const alphaAPRad = alphaAP * gonToRad;
  const alphaBPRad = alphaBP * gonToRad;

  const sAP = (sAB * Math.sin(beta2Rad)) / Math.sin(beta3Rad);
  const sBP = (sAB * Math.sin(beta1Rad)) / Math.sin(beta3Rad);

  const xPrimP = xA + sAP * Math.cos(alphaAPRad);
  const yPrimP = yA + sAP * Math.sin(alphaAPRad);
  const xSecondP = xB + sBP * Math.cos(alphaBPRad);
  const ySecondP = yB + sBP * Math.sin(alphaBPRad);

  return { sAB, alphaAB, sAP, sBP, xP: (xPrimP + xSecondP) / 2, yP: (yPrimP + ySecondP) / 2 };
}

const engine = defineEngine({
  toolName: 'forward-intersection',
  version: 1,
  displayName: { bg: 'Права засечка', en: 'Forward Intersection' },
  fields: ['yA', 'xA', 'yB', 'xB', 'beta1', 'beta2'],
  validate: validateForward,
  compute: computeForward,
  persisted: [['xP', 3], ['yP', 3], ['sAP', 3], ['sBP', 3]],
});

module.exports = { engines: [engine], validateForward, computeForward };
