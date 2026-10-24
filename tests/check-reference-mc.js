'use strict';
// 用蒙地卡羅驗證參考模型（reference.js）
const path = require('node:path');
const ref = require(path.join(__dirname, 'reference.js'));
const mc = require(path.join(__dirname, 'montecarlo.js'));

const cases = [
  [[1], 0, 80, 47],
  [[1], 0, 120, 47],
  [[1], 79, 1, 47],
  [[2], 0, 120, 47],
  [[2], 0, 200, 47],
  [[1, 1], 0, 120, 47],
  [[1, 1], 0, 120, 0],
  [[1, 1], 0, 55, 0],
  [[1, 0, 1], 0, 200, 47],
  [[3, 2, 1], 0, 400, 47],
];

const SAMPLES = 400000;
console.log('scenario'.padEnd(22), 'budget', 'threshold', 'reference', 'MonteCarlo ±3σ', 'z');
for (const [targets, pity, budget, th] of cases) {
  const r = ref.calculate(targets, pity, budget, th);
  const m = mc.estimate(targets, pity, budget, th, SAMPLES, 987654321);
  const z = Math.abs(r - m.p) / (m.se || 1e-9);
  const flag = z > 3 ? '  <== 不一致' : '';
  console.log(
    JSON.stringify(targets).padEnd(22),
    String(budget).padStart(6),
    String(th).padStart(9),
    (r * 100).toFixed(4).padStart(12),
    `${(m.p * 100).toFixed(4)} ± ${(m.se * 100 * 3).toFixed(4)}`.padStart(18),
    z.toFixed(2).padStart(6),
    flag
  );
}
