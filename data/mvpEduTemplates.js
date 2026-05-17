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
      const yA = Math.round((200 + Math.random() * 400) * 1000) / 1000;
      const xA = Math.round((200 + Math.random() * 400) * 1000) / 1000;
      const yB = Math.round((yA + 150 + Math.random() * 200) * 1000) / 1000;
      const xB = Math.round((xA + 120 + Math.random() * 180) * 1000) / 1000;
      const beta1 = Math.round((30 + Math.random() * 80) * 1000) / 1000;
      const beta2 = Math.round((25 + Math.random() * 70) * 1000) / 1000;
      return { yA, xA, yB, xB, beta1, beta2 };
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
    description: 'Позиция на точка P по три известни точки и два ъгъла.',
    difficulty: 'hard',
    tags: ['tool:resection', 'builtin', 'mvp'],
    toolRoute: '/resection',
    gradingSettings: { tolerance: 0.01, toleranceType: 'absolute', maxScore: 100 },
    generatorScript: `
      const xA = Math.round((100 + Math.random() * 200) * 1000) / 1000;
      const yA = Math.round((100 + Math.random() * 200) * 1000) / 1000;
      const xB = Math.round((xA + 120 + Math.random() * 80) * 1000) / 1000;
      const yB = Math.round((yA + 40 + Math.random() * 60) * 1000) / 1000;
      const xC = Math.round((xB - 40 + Math.random() * 100) * 1000) / 1000;
      const yC = Math.round((yB + 100 + Math.random() * 80) * 1000) / 1000;
      const beta1 = Math.round((40 + Math.random() * 60) * 1000) / 1000;
      const beta2 = Math.round((35 + Math.random() * 55) * 1000) / 1000;
      return { xA, yA, xB, yB, xC, yC, beta1, beta2 };
    `,
    solutionScript: `
      const { xA, yA, xB, yB, xC, yC, beta1, beta2 } = inputData;
      const beta1Rad = (beta1 * Math.PI) / 200;
      const beta2Rad = (beta2 * Math.PI) / 200;
      const dxAB = xB - xA;
      const dyAB = yB - yA;
      const dxBC = xC - xB;
      const dyBC = yC - yB;
      const angleA = Math.atan2(dyAB, dxAB);
      const angleB = Math.atan2(dyBC, dxBC);
      const sideAB = Math.sqrt(dxAB * dxAB + dyAB * dyAB);
      const sideBC = Math.sqrt(dxBC * dxBC + dyBC * dyBC);
      const angleAPB = Math.PI - beta1Rad;
      const angleBPC = Math.PI - beta2Rad;
      const sideAP = (sideAB * Math.sin(beta1Rad)) / Math.sin(angleAPB);
      const sideBP = (sideBC * Math.sin(beta2Rad)) / Math.sin(angleBPC);
      const xP1 = xA + sideAP * Math.cos(angleA + beta1Rad);
      const yP1 = yA + sideAP * Math.sin(angleA + beta1Rad);
      const xP2 = xB + sideBP * Math.cos(angleB - beta2Rad);
      const yP2 = yB + sideBP * Math.sin(angleB - beta2Rad);
      const xP = Math.round(((xP1 + xP2) / 2) * 1000) / 1000;
      const yP = Math.round(((yP1 + yP2) / 2) * 1000) / 1000;
      return { xP, yP };
    `,
    answerKeys: ['xP', 'yP'],
  },
];

module.exports = { MVP_EDU_TEMPLATES };
