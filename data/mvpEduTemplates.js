/**
 * Built-in task templates aligned with GeoSolver MVP calculators.
 * generatorScript returns flat inputData; solutionScript receives inputData object.
 */
const MVP_EDU_TEMPLATES = [
  {
    toolKey: 'first-basic-task',
    name: 'Първа основна задача',
    type: 'custom',
    description: 'Изчисляване на координати по начална точка, посочен ъгъл и разстояние.',
    difficulty: 'easy',
    tags: ['tool:first-basic-task', 'builtin', 'mvp'],
    toolRoute: '/first-task',
    gradingSettings: { tolerance: 0.001, toleranceType: 'absolute', maxScore: 100 },
    generatorScript: `
      const y1 = Math.round((Math.random() * 800 - 200) * 1000) / 1000;
      const x1 = Math.round((Math.random() * 800 - 200) * 1000) / 1000;
      const alpha = Math.round((50 + Math.random() * 300) * 1000) / 1000;
      const s = Math.round((80 + Math.random() * 420) * 1000) / 1000;
      return { y1, x1, alpha, s };
    `,
    solutionScript: `
      const { y1, x1, alpha, s } = inputData;
      const alphaRad = (alpha * Math.PI) / 200;
      const deltaX = s * Math.cos(alphaRad);
      const deltaY = s * Math.sin(alphaRad);
      const x2 = Math.round((x1 + deltaX) * 1000) / 1000;
      const y2 = Math.round((y1 + deltaY) * 1000) / 1000;
      return { x2, y2 };
    `,
    answerKeys: ['x2', 'y2'],
  },
  {
    toolKey: 'second-basic-task',
    name: 'Втора основна задача',
    type: 'custom',
    description: 'Разстояние и посочен ъгъл между две точки.',
    difficulty: 'medium',
    tags: ['tool:second-basic-task', 'builtin', 'mvp'],
    toolRoute: '/second-task',
    gradingSettings: { tolerance: 0.01, toleranceType: 'absolute', maxScore: 100 },
    generatorScript: `
      const x1 = Math.round((Math.random() * 600 - 100) * 1000) / 1000;
      const y1 = Math.round((Math.random() * 600 - 100) * 1000) / 1000;
      const x2 = Math.round((x1 + 100 + Math.random() * 300) * 1000) / 1000;
      const y2 = Math.round((y1 + 50 + Math.random() * 250) * 1000) / 1000;
      return { x1, y1, x2, y2 };
    `,
    solutionScript: `
      const { x1, y1, x2, y2 } = inputData;
      const deltaX = x2 - x1;
      const deltaY = y2 - y1;
      const distance = Math.round(Math.sqrt(deltaX * deltaX + deltaY * deltaY) * 1000) / 1000;
      let alpha = Math.atan2(deltaY, deltaX) * 200 / Math.PI;
      if (alpha < 0) alpha += 400;
      alpha = Math.round(alpha * 1000) / 1000;
      return { distance, alpha };
    `,
    answerKeys: ['distance', 'alpha'],
  },
  {
    toolKey: 'forward-intersection',
    name: 'Права засечка',
    type: 'forward-intersection',
    description: 'Координати на точка P по две известни точки и ъгли β₁, β₂.',
    difficulty: 'hard',
    tags: ['tool:forward-intersection', 'builtin', 'mvp'],
    toolRoute: '/forward-intersection',
    gradingSettings: { tolerance: 0.01, toleranceType: 'absolute', maxScore: 100 },
    generatorScript: `
      // Milestone 2.1: built from REAL geometry. A and B are picked, a target point P is picked on
      // the LEFT of A->B (the GeoSolver forward-intersection convention), and beta1/beta2 are DERIVED
      // from A, B and P — never drawn independently. Coordinates: X north, Y east, bearings clockwise, gon.
      // The exact P is returned under the reserved key __groundTruth; the server removes it from the
      // student-visible inputData and stores it as the answer (models/TaskTemplate.generateVariantData).
      const r3 = (v) => Math.round(v * 1000) / 1000;
      const GON = Math.PI / 200;
      const wrap = (g) => ((g % 400) + 400) % 400;
      const bearing = (fy, fx, ty, tx) => wrap(Math.atan2(ty - fy, tx - fx) / GON);
      for (let attempt = 0; attempt < 500; attempt++) {
        const yA = r3(200 + Math.random() * 400);
        const xA = r3(200 + Math.random() * 400);
        const baseline = 100 + Math.random() * 150;
        const heading = Math.random() * 2 * Math.PI;
        const yB = r3(yA + baseline * Math.sin(heading));
        const xB = r3(xA + baseline * Math.cos(heading));
        const len = Math.sqrt((xB - xA) * (xB - xA) + (yB - yA) * (yB - yA));
        const ux = (xB - xA) / len;
        const uy = (yB - yA) / len;
        const along = len * (0.2 + 0.6 * Math.random());
        const left = len * (0.3 + 0.5 * Math.random());
        const xP = r3(xA + along * ux + left * uy);
        const yP = r3(yA + along * uy - left * ux);
        const aAB = bearing(yA, xA, yB, xB);
        const aBA = wrap(aAB + 200);
        const beta1 = r3(wrap(aAB - bearing(yA, xA, yP, xP)));
        const beta2 = r3(wrap(bearing(yB, xB, yP, xP) - aBA));
        const cut = 200 - beta1 - beta2;
        const sAP = Math.sqrt((xP - xA) * (xP - xA) + (yP - yA) * (yP - yA));
        const sBP = Math.sqrt((xP - xB) * (xP - xB) + (yP - yB) * (yP - yB));
        // valid by construction: beta1 > 0, beta2 > 0, beta1 + beta2 < 200 (the intersection angle is
        // kept in 60..140 gon and the rays are at most 300 m, so 3-decimal rounding of the angles moves
        // the recomputed point by at most a few millimetres).
        if (beta1 > 0 && beta2 > 0 && cut >= 60 && cut <= 140 && sAP <= 300 && sBP <= 300) {
          return { yA, xA, yB, xB, beta1, beta2, __groundTruth: { xP, yP } };
        }
      }
      throw new Error('Forward intersection generator found no valid geometry');
    `,
    solutionScript: `
      const { yA, xA, yB, xB, beta1, beta2 } = inputData;
      const deltaX = xB - xA;
      const deltaY = yB - yA;
      const sAB = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      let alphaAB = Math.atan2(deltaY, deltaX) * 200 / Math.PI;
      if (alphaAB < 0) alphaAB += 400;
      let alphaBA = alphaAB + 200;
      if (alphaBA >= 400) alphaBA -= 400;
      let alphaAP = alphaAB - beta1;
      if (alphaAP < 0) alphaAP += 400;
      let alphaBP = alphaBA + beta2;
      if (alphaBP >= 400) alphaBP -= 400;
      const b1 = beta1 * Math.PI / 200;
      const b2 = beta2 * Math.PI / 200;
      const sum = b1 + b2;
      const sAP = sAB * Math.sin(b2) / Math.sin(sum);
      const sBP = sAB * Math.sin(b1) / Math.sin(sum);
      const apRad = alphaAP * Math.PI / 200;
      const bpRad = alphaBP * Math.PI / 200;
      const xPrimP = xA + sAP * Math.cos(apRad);
      const yPrimP = yA + sAP * Math.sin(apRad);
      const xSecondP = xB + sBP * Math.cos(bpRad);
      const ySecondP = yB + sBP * Math.sin(bpRad);
      const xP = Math.round(((xPrimP + xSecondP) / 2) * 1000) / 1000;
      const yP = Math.round(((yPrimP + ySecondP) / 2) * 1000) / 1000;
      return { xP, yP };
    `,
    answerKeys: ['xP', 'yP'],
  },
  {
    toolKey: 'resection',
    name: 'Обратна засечка',
    type: 'resection',
    description: 'Позиция на станция P по три известни точки A, B, C и два насочени ъгъла по часовниковата стрелка: β₁ (от P→A към P→B) и β₂ (от P→B към P→C).',
    difficulty: 'hard',
    tags: ['tool:resection', 'builtin', 'mvp'],
    toolRoute: '/resection',
    gradingSettings: { tolerance: 0.01, toleranceType: 'absolute', maxScore: 100 },
    generatorScript: `
      // Milestone 2.1: built from a REAL station P (Resection v2 contract). Control points A, B, C are
      // placed around P so that A -> B -> C is seen CLOCKWISE from P; beta1 = directed clockwise angle
      // P->A to P->B and beta2 = directed clockwise angle P->B to P->C are DERIVED from the rounded
      // coordinates — never drawn at random and never ambiguous with 400-beta. Coordinates: X north,
      // Y east, bearings clockwise, gon. The exact P is returned under the reserved key __groundTruth;
      // the server strips it from the student-visible inputData and stores it as the answer.
      const r3 = (v) => Math.round(v * 1000) / 1000;
      const GON = Math.PI / 200;
      const wrap = (g) => ((g % 400) + 400) % 400;
      const bearing = (fy, fx, ty, tx) => wrap(Math.atan2(ty - fy, tx - fx) / GON);
      const grad = (qx, qy, px, py) => {
        const dx = qx - px;
        const dy = qy - py;
        const r2 = dx * dx + dy * dy;
        return [dy / r2, -dx / r2];
      };
      for (let attempt = 0; attempt < 500; attempt++) {
        const yP = r3(300 + Math.random() * 400);
        const xP = r3(300 + Math.random() * 400);
        const start = Math.random() * 400;
        const spread1 = 55 + Math.random() * 60;
        const spread2 = 55 + Math.random() * 60;
        const put = (bearingGon, dist) => [r3(xP + dist * Math.cos(bearingGon * GON)), r3(yP + dist * Math.sin(bearingGon * GON))];
        const [xA, yA] = put(start, 70 + Math.random() * 140);
        const [xB, yB] = put(start + spread1, 70 + Math.random() * 140);
        const [xC, yC] = put(start + spread1 + spread2, 70 + Math.random() * 140);
        const beta1 = r3(wrap(bearing(yP, xP, yB, xB) - bearing(yP, xP, yA, xA)));
        const beta2 = r3(wrap(bearing(yP, xP, yC, xC) - bearing(yP, xP, yB, xB)));
        // control geometry: distinct and clearly non-collinear
        const ab = Math.sqrt((xB - xA) * (xB - xA) + (yB - yA) * (yB - yA));
        const bc = Math.sqrt((xC - xB) * (xC - xB) + (yC - yB) * (yC - yB));
        const sinB = Math.abs((xB - xA) * (yC - yB) - (yB - yA) * (xC - xB)) / (ab * bc);
        // conditioning of the station (Jacobian of the two angles with respect to P): keeps the station
        // far from the danger circle and far below the canonical limit (condition number 1e4), and makes
        // the 3-decimal rounding of beta1/beta2 move the recomputed station by at most ~3 mm.
        const gA = grad(xA, yA, xP, yP);
        const gB = grad(xB, yB, xP, yP);
        const gC = grad(xC, yC, xP, yP);
        const a = gB[0] - gA[0];
        const b = gB[1] - gA[1];
        const c = gC[0] - gB[0];
        const d = gC[1] - gB[1];
        const s1 = a * a + b * b + c * c + d * d;
        const det = a * d - b * c;
        const disc = Math.sqrt(Math.max(0, s1 * s1 - 4 * det * det));
        const smax = Math.sqrt((s1 + disc) / 2);
        const smin = Math.sqrt(Math.max(0, (s1 - disc) / 2));
        if (sinB >= 0.1 && smin >= 0.004 && smax / smin <= 6) {
          return { xA, yA, xB, yB, xC, yC, beta1, beta2, __groundTruth: { xP, yP } };
        }
      }
      throw new Error('Resection generator found no valid geometry');
    `,
    solutionScript: `
      // The answer for this task is the station the generator started from (__groundTruth), stored
      // server-side when the variant is generated. There is deliberately NO second Resection solver
      // here: if this script is ever reached, the ground-truth path was bypassed — fail loudly instead
      // of silently grading against a different answer.
      throw new Error('Resection answers come from the generated ground truth; this script must not be used as an answer key.');
    `,
    answerKeys: ['xP', 'yP'],
  },
];

/**
 * SHA-256 (of the trimmed, LF-normalized script text) of PREVIOUS built-in definitions that have been
 * corrected. utils/ensureMvpTemplates.js upgrades a stored template ONLY when its generator and
 * solution scripts match one of these byte-for-byte, so an admin-edited or foreign template is never
 * overwritten. Never remove an entry while databases may still hold that definition.
 */
const SUPERSEDED_DEFINITIONS = {
  // Milestone 2.1: generator drew beta1/beta2 independently (sums up to ~205 gon, not derived from a station).
  'forward-intersection': [
    {
      generatorSha256: 'eed83b303a0b7850d0f3826951aa7b191c4e16935a7c9009841199e7019cc43e',
      solutionSha256: '6c611b44dcb7ce1c81097a9f368f86699058694e3d4284310ad4a582076638bf',
    },
  ],
  // Milestone 2.1: random angles unrelated to any station and an ad-hoc key that matched no resection solver.
  resection: [
    {
      generatorSha256: '12af51053ca6e6dcc53b302f00e59452dcab33406ea06ad9ccb57057d5837cea',
      solutionSha256: '905fb28152267c9ecc60e0ab0b2100e8f7e648708fd7b779d5158ca2d2bf39c1',
    },
  ],
};

module.exports = { MVP_EDU_TEMPLATES, SUPERSEDED_DEFINITIONS };
