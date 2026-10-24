'use strict';
/**
 * 測試套件：gacha.wasm（C++ 引擎）vs 參考模型 vs 蒙地卡羅
 * 執行： node tests/run.js            （全部）
 *        node tests/run.js --fast     （跳過蒙地卡羅）
 *        node tests/run.js --perf     （含效能 benchmark）
 */

const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const Gacha = require(path.join(ROOT, 'gacha.js'));
const ref = require(path.join(__dirname, 'reference.js'));
const mc = require(path.join(__dirname, 'montecarlo.js'));

const FAST = process.argv.includes('--fast');
const PERF = process.argv.includes('--perf');

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected, tol) {
  const diff = Math.abs(actual - expected);
  if (!Number.isFinite(actual) || diff > tol) {
    failed++;
    failures.push(`${name}\n   engine=${actual}\n   expect=${expected}  (|Δ|=${diff.toExponential(3)} > ${tol.toExponential(1)})`);
    return false;
  }
  passed++;
  return true;
}

function section(title) {
  process.stdout.write(`\n== ${title}\n`);
}

// ---------------------------------------------------------------- 解析解
function closedFormSingle(n) {
  // 抽 n 次（n <= 30）：每個位置 UP 機率固定 0.4%，第 30 抽後再送免費十連
  const pulls = n + (n >= 30 ? 10 : 0);
  return 1 - Math.pow(1 - 0.008 * 0.5, pulls);
}

function testClosedForm() {
  section('A. 解析解（可手算的情境）');
  Gacha.setThreshold(47);

  check('1 抽 / 目標 1', Gacha.calculate([1], 0, 1), 0.004, 1e-12);
  for (const n of [2, 5, 10, 20, 29]) {
    check(`${n} 抽 / 目標 1`, Gacha.calculate([1], 0, n), closedFormSingle(n), 1e-12);
  }
  check('30 抽（含免費十連）/ 目標 1', Gacha.calculate([1], 0, 30), closedFormSingle(30), 1e-12);

  // 墊 79 抽 → 第 80 抽硬保底 6★，50% 為 UP
  check('墊 79 抽 + 1 抽', Gacha.calculate([1], 79, 1), 0.5, 1e-12);
  // 墊 65 抽 → 第 66 抽起爬坡：0.008 + 5.8% 之後……
  check('墊 65 + 29 抽（爬坡到 80 抽）', Gacha.calculate([1], 65, 29), ref.calculate([1], 65, 29), 1e-12);

  // 120 抽大保底
  check('120 抽 / 目標 1 = 必得', Gacha.calculate([1], 0, 120), 1, 1e-12);
  check('0 抽 / 目標 1', Gacha.calculate([1], 0, 0), 0, 1e-12);
  check('全 0 目標', Gacha.calculate([0, 0, 0, 0, 0], 0, 100), 1, 1e-12);
}

// ---------------------------------------------------------------- 參考模型對照
function gridCases() {
  const cases = [];
  const push = (targets, pity, budget, th) => cases.push({ targets, pity, budget, th });

  for (const b of [1, 10, 29, 30, 45, 59, 60, 61, 80, 100, 119, 120, 121, 150, 200, 240, 241, 300, 400]) {
    push([1], 0, b, 47);
    push([2], 0, b, 47);
  }
  for (const p of [0, 1, 30, 55, 65, 66, 70, 79]) {
    push([1], p, 60, 47);
    push([2], p, 240, 47);
  }
  for (const th of [0, 20, 30, 40, 45, 47, 50, 51, 55, 59]) {
    push([1, 1], 0, 120, th);
    push([1, 1, 1], 0, 200, th);
  }
  push([1, 1], 0, 55, 0);
  push([1, 1], 0, 59, 0);
  push([1, 1], 0, 60, 0);
  push([1, 0, 1], 0, 200, 47);
  push([1, 0, 0, 0, 1], 0, 240, 47);
  push([2, 1], 0, 240, 47);
  push([3, 2, 1], 0, 400, 47);
  push([3, 2, 1], 0, 600, 47);
  push([6, 6, 6, 6, 6], 0, 900, 47);
  push([1, 1, 1, 1, 1], 40, 600, 47);
  push([6], 0, 3000, 47);
  push([2, 2, 2, 2, 2], 0, 1200, 47);

  return cases;
}

function testAgainstReference() {
  section('B. 參考模型（獨立實作）逐點對照');
  const cases = gridCases();
  let worst = 0;
  let worstName = '';
  for (const c of cases) {
    Gacha.setThreshold(c.th);
    const got = Gacha.calculate(c.targets, c.pity, c.budget);
    const want = ref.calculate(c.targets, c.pity, c.budget, c.th);
    const d = Math.abs(got - want);
    if (d > worst) { worst = d; worstName = `targets=${JSON.stringify(c.targets)} pity=${c.pity} budget=${c.budget} th=${c.th}`; }
    check(`ref ${JSON.stringify(c.targets)} p=${c.pity} b=${c.budget} th=${c.th}`, got, want, 1e-9);
  }
  console.log(`   ${cases.length} 個情境，最大偏差 ${worst.toExponential(2)}  @ ${worstName}`);
}

// ---------------------------------------------------------------- 蒙地卡羅
function testMonteCarlo() {
  section('C. 蒙地卡羅（一次一抽模擬，獨立驗證）');
  const cases = [
    [[1], 0, 80, 47, 400000],
    [[2], 0, 120, 47, 400000],
    [[1, 1], 0, 120, 47, 400000],
    [[1, 1], 0, 55, 0, 400000],
    [[1, 0, 1], 0, 200, 47, 300000],
    [[3, 2, 1], 0, 400, 47, 300000],
  ];
  for (const [targets, pity, budget, th, n] of cases) {
    Gacha.setThreshold(th);
    const got = Gacha.calculate(targets, pity, budget);
    const m = mc.estimate(targets, pity, budget, th, n, 20261024);
    const tol = Math.max(3 * m.se, 1e-9);
    const ok = check(`mc ${JSON.stringify(targets)} b=${budget} th=${th}`, got, m.p, tol);
    console.log(
      `   ${JSON.stringify(targets).padEnd(18)} b=${String(budget).padStart(4)} th=${String(th).padStart(2)}` +
      ` engine=${(got * 100).toFixed(4)}%  mc=${(m.p * 100).toFixed(4)}% ±${(3 * m.se * 100).toFixed(4)}  ${ok ? 'OK' : 'FAIL'}`
    );
  }
}

// ---------------------------------------------------------------- 邊界
function testEdgeCases() {
  section('D. 邊界與輸入合法性');
  Gacha.setThreshold(47);

  check('預算 0', Gacha.calculate([1], 0, 0), 0, 0);
  check('目標 0', Gacha.calculate([0], 0, 500), 1, 0);
  check('水位上限 79', Gacha.calculate([1], 79, 1), 0.5, 1e-12);
  check('水位超界 200 → 夾到 79', Gacha.calculate([1], 200, 1), Gacha.calculate([1], 79, 1), 0);
  check('目標超界 99 → 夾到 6', Gacha.calculate([99], 0, 300), Gacha.calculate([6], 0, 300), 0);
  check('負預算 → 0', Gacha.calculate([1], 0, -5), 0, 0);
  check('單調性：預算越多不會更差', Gacha.calculate([1], 0, 121) >= Gacha.calculate([1], 0, 120) - 1e-15 ? 1 : 0, 1, 0);

  // 已達標就不可能因為多抽而變差
  let mono = true;
  let prev = -1;
  for (let b = 0; b <= 400; b += 7) {
    const v = Gacha.calculate([2], 0, b);
    if (v < prev - 1e-12) mono = false;
    prev = v;
  }
  check('單調性：0..400 抽遞增', mono ? 1 : 0, 1, 0);

  // 上限：抽到 240 張信物時仍要收斂在 1
  check('超大預算 → 1', Gacha.calculate([1], 0, 5000), 1, 1e-12);
}

// ---------------------------------------------------------------- 統計接口
function refStats(target, pity) {
  const out = ref.bannerOutcomes(target, pity, 60, false).outcomes;
  let mass = 0;
  let acc = 0;
  for (const o of out) { mass += o.w; acc += o.t * o.w; }
  const cdf = [];
  let run = 0;
  for (const o of out) { run += o.w / mass; cdf.push({ t: o.t, cdf: run }); }
  const q = (p) => {
    for (const c of cdf) if (c.cdf >= p) return c.t;
    return cdf[cdf.length - 1].t;
  };
  return { mean: acc / mass, p10: q(0.1), p50: q(0.5), p90: q(0.9) };
}

function testStats() {
  section('F. 統計接口（平均 / P10 / 中位數 / P90）');
  let maxMeanErr = 0;
  for (const target of [1, 2, 3, 4, 6]) {
    for (const pity of [0, 40, 79]) {
      const expect = refStats(target, pity);
      const got = Gacha.bannerStats(target, pity);
      if (!got) { check(`stats ${target}/${pity}`, 0, 1, 0); continue; }
      maxMeanErr = Math.max(maxMeanErr, Math.abs(got.mean - expect.mean));
      check(`mean  t=${target} p=${pity}`, got.mean, expect.mean, Math.max(0.6, expect.mean * 0.01));
      check(`p10   t=${target} p=${pity}`, got.p10, expect.p10, 1);
      check(`p50   t=${target} p=${pity}`, got.p50, expect.p50, 1);
      check(`p90   t=${target} p=${pity}`, got.p90, expect.p90, 1);
      if (!(got.p10 <= got.p50 && got.p50 <= got.p90 && got.p90 <= got.p99)) {
        check(`分位數單調 t=${target} p=${pity}`, 0, 1, 0);
      }
    }
  }
  console.log(`   平均抽數與參考模型最大差 ${maxMeanErr.toFixed(2)} 抽（截斷造成，可接受）`);

  // 已知錨點：目標 1 張、水位 0 → 中位數應落在 60–70 之間
  const one = Gacha.bannerStats(1, 0);
  check('單張中位數合理（55–75）', (one.p50 >= 55 && one.p50 <= 75) ? 1 : 0, 1, 0);
  // 墊到 79 抽 → 下一抽就必得
  const near = Gacha.bannerStats(1, 79);
  check('墊 79 抽的 P50 = 1', near.p50, 1, 0);
}

// ---------------------------------------------------------------- 效能
function benchmark() {
  section('E. 效能（含 wasm 初始化）');
  const scenarios = [
    { targets: [1], pity: 0, budget: 120, label: '單池 1 隻 / 120 抽' },
    { targets: [1, 1, 1, 1, 1], pity: 0, budget: 600, label: '5 池各 1 隻 / 600 抽' },
    { targets: [3, 2, 1], pity: 0, budget: 600, label: '3 池 3/2/1 隻 / 600 抽' },
    { targets: [6, 6, 6, 6, 6], pity: 0, budget: 5000, label: '最壞：5 池各 6 隻 / 5000 抽' },
  ];
  for (const s of scenarios) {
    Gacha.setThreshold(47);            // 清快取，量「冷啟動」
    const t0 = process.hrtime.bigint();
    const v = Gacha.calculate(s.targets, s.pity, s.budget);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    console.log(`   ${s.label.padEnd(34)} ${ms.toFixed(1).padStart(8)} ms   (${(v * 100).toFixed(3)}%)`);
  }

  // 暖快取（同一組參數再算一次）
  Gacha.setThreshold(47);
  Gacha.calculate([6, 6, 6, 6, 6], 0, 5000);
  const t1 = process.hrtime.bigint();
  Gacha.calculate([6, 6, 6, 6, 6], 0, 5000);
  const ms1 = Number(process.hrtime.bigint() - t1) / 1e6;
  console.log(`   ${'暖快取重算（同上）'.padEnd(30)} ${ms1.toFixed(1).padStart(8)} ms`);
}

// ---------------------------------------------------------------- 主流程
(async () => {
  const t0 = process.hrtime.bigint();
  await Gacha.init();
  const initMs = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`gacha.wasm 載入完成（${initMs.toFixed(1)} ms）`);

  testClosedForm();
  testAgainstReference();
  testEdgeCases();
  testStats();
  if (!FAST) testMonteCarlo();
  if (PERF) benchmark();

  console.log(`\n===== 結果：${passed} 通過 / ${failed} 失敗 =====`);
  if (failed) {
    for (const f of failures.slice(0, 20)) console.log(`\n[FAIL] ${f}`);
    process.exit(1);
  }
  process.exit(0);
})();
