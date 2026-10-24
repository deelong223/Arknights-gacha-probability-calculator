'use strict';
/**
 * 武器池（武庫申領）模擬測試
 *
 *  A. 申領鏈（claimChain）vs 暴力蒙地卡羅：兩條獨立實作要對得上
 *  B. 申領鏈的硬性條件：40 抽必 6★、第 8 次申領必 UP、單調遞增、up <= six
 *  C. 角色池模擬器 vs DP 引擎（gacha.wasm）：偏差要在統計誤差內
 *  D. Weapon.simulate 的行為：配額公式、單調性、決定性、邊界
 *  E. 效能：單次模擬要夠快（UI 會即時呼叫）
 */
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const W = require(path.join(ROOT, 'weapon.js'));
const Gacha = require(path.join(ROOT, 'gacha.js'));

let passed = 0;
let failed = 0;
const failures = [];

function check(name, actual, expected, tol) {
  const diff = Math.abs(actual - expected);
  if (!Number.isFinite(actual) || diff > tol) {
    failed++;
    failures.push(`${name}\n   actual=${actual}\n   expect=${expected}  (|Δ|=${diff.toExponential(3)} > ${tol.toExponential(1)})`);
    return false;
  }
  passed++;
  return true;
}

function ok(name, cond, detail) {
  if (cond) { passed++; return true; }
  failed++;
  failures.push(`${name}${detail ? '  (' + detail + ')' : ''}`);
  return false;
}

function section(title) {
  process.stdout.write(`\n== ${title}\n`);
}

// ---------------------------------------------------------------- A
// 用最樸素的寫法重跑一次申領鏈：每次申領獨立抽 10 件
function bruteForceChain(start, horizon, iters, seed) {
  const rng = W.makeRng(seed || 99);
  const firstUp = new Float64Array(iters);
  const firstSix = new Float64Array(iters);
  for (let i = 0; i < iters; i++) {
    let c6 = Math.min(start, 3);
    let gotUp = false;
    let gotSix = false;
    firstUp[i] = -1;
    firstSix[i] = -1;
    for (let k = 1; k <= horizon; k++) {
      const bannerClaim = start + k;
      let pUp;
      let pSix;
      if (bannerClaim === 8 && !gotUp) { pUp = 1; pSix = 1; }
      else if (c6 === 3) { pUp = 0.25; pSix = 1; }
      else { pUp = 1 - Math.pow(0.99, 10); pSix = 1 - Math.pow(0.96, 10); }

      const u = rng();
      const hitSix = u < pSix;
      const hitUp = !gotUp && u < pUp;
      if (hitSix) { c6 = 0; if (!gotSix) { gotSix = true; firstSix[i] = k; } }
      else c6 = Math.min(c6 + 1, 3);
      if (hitUp) { gotUp = true; firstUp[i] = k; }
    }
  }
  const up = [];
  const six = [];
  for (let k = 0; k <= horizon; k++) {
    let a = 0;
    let b = 0;
    for (let i = 0; i < iters; i++) {
      if (firstUp[i] > 0 && firstUp[i] <= k) a++;
      if (firstSix[i] > 0 && firstSix[i] <= k) b++;
    }
    up.push(a / iters);
    six.push(b / iters);
  }
  return { up, six };
}

function testClaimChainAgainstBruteForce() {
  section('A. 申領鏈 vs 暴力模擬');
  for (const start of [0, 2, 5]) {
    const horizon = 8 - start;
    const chain = W.claimChain(start, horizon);
    const mc = bruteForceChain(start, horizon, 300000, 20260101 + start);
    let worst = 0;
    for (let k = 0; k <= horizon; k++) {
      worst = Math.max(worst, Math.abs(chain.up[k] - mc.up[k]), Math.abs(chain.six[k] - mc.six[k]));
      check(`start=${start} k=${k} up`, chain.up[k], mc.up[k], 0.006);
      check(`start=${start} k=${k} six`, chain.six[k], mc.six[k], 0.006);
    }
    console.log(`   已申領 ${start} 次：最大偏差 ${worst.toFixed(4)}（30 萬次模擬）`);
  }
}

// ---------------------------------------------------------------- B
function testChainInvariants() {
  section('B. 申領鏈的硬性規則');
  const c0 = W.claimChain(0, 8);
  ok('第 4 次申領必 6★（40 抽）', Math.abs(c0.six[4] - 1) < 1e-12, 'six[4]=' + c0.six[4]);
  ok('六星只可能在 4 次內出現', Math.abs(c0.six[3] - 1 + Math.pow(1 - (1 - Math.pow(0.96, 10)), 3)) < 1e-9);
  ok('第 8 次申領必 UP', Math.abs(c0.up[8] - 1) < 1e-12, 'up[8]=' + c0.up[8]);
  ok('第 7 次之前不是必得', c0.up[7] < 0.6, 'up[7]=' + c0.up[7]);

  for (const start of [0, 1, 3, 7]) {
    const h = 8 - start;
    const c = W.claimChain(start, h);
    let mono = true;
    for (let k = 1; k <= h; k++) {
      if (c.up[k] < c.up[k - 1] - 1e-15) mono = false;
      if (c.six[k] < c.six[k - 1] - 1e-15) mono = false;
      if (c.up[k] > c.six[k] + 1e-12) mono = false;
    }
    ok(`start=${start}：up / six 單調且 up <= six`, mono);
    ok(`start=${start}：最後一定拿得到 UP`, Math.abs(c.up[h] - 1) < 1e-12);
  }

  // 已經申領 3 次都沒 6★ → 下一次必 6★（其中 25% 是 UP）
  const c3 = W.claimChain(3, 1);
  ok('已墊 3 次 → 下一申領必 6★', Math.abs(c3.six[1] - 1) < 1e-12);
  ok('已墊 3 次 → 下一申領 25% 為 UP', Math.abs(c3.up[1] - 0.25) < 1e-12, 'up=' + c3.up[1]);
}

// ---------------------------------------------------------------- C
async function testAgainstEngine() {
  section('C. 角色池模擬器 vs DP 引擎');
  await Gacha.init('gacha.wasm');

  const cases = [
    { targets: [1], pity: 0, budget: 80, threshold: 60 },
    { targets: [2], pity: 0, budget: 120, threshold: 60 },
    { targets: [1, 1], pity: 0, budget: 120, threshold: 60 },
    { targets: [1, 1], pity: 0, budget: 240, threshold: 47 },
    { targets: [1, 0, 1], pity: 0, budget: 200, threshold: 47 },
    { targets: [2, 1], pity: 0, budget: 240, threshold: 47 },
    { targets: [1, 1, 1], pity: 40, budget: 300, threshold: 47 },
  ];

  for (const c of cases) {
    Gacha.setThreshold(c.threshold);
    const dp = Gacha.calculate(c.targets, c.pity, c.budget);
    const mc = W.estimateSuccess(c, 200000, 4242);
    const label = `${JSON.stringify(c.targets)} pity=${c.pity} budget=${c.budget} th=${c.threshold}`;
    const tol = Math.max(0.008, 4 * mc.se);
    check(`MC vs DP ${label}`, mc.p, dp, tol);
    console.log(`   ${label}  DP ${(dp * 100).toFixed(2)}% / MC ${(mc.p * 100).toFixed(2)}% ±${(mc.se * 100).toFixed(2)}`);
  }
}

// ---------------------------------------------------------------- D
function testSimulate() {
  section('D. Weapon.simulate 行為');

  // 單抽的配額期望值可以手算：0.8%×2000 + 99.2%×(8%×200 + 92%×20) = 50.12
  // 單抽配額的標準差 ≈ 182，6 萬次模擬的標準誤 ≈ 0.74，所以容差取 2.5
  const one = W.simulate({ targets: [1], pity: 0, budget: 1, threshold: 47, iters: 60000 });
  check('單抽的期望配額 = 50.12', one.quota.mean, 50.12, 2.5);

  // 預算 0、沒有額外配額 → 不可能有 UP
  const none = W.simulate({ targets: [1], pity: 0, budget: 0, threshold: 47 });
  check('沒有配額時 UP 機率 = 0', none.upProb, 0, 1e-12);
  check('沒有配額時可申領 = 0', none.claims.p50, 0, 1e-12);

  // 預算 0、剛好 8 次申領的配額 → 必得
  const full = W.simulate({ targets: [1], pity: 0, budget: 0, threshold: 47, extraQuota: 8 * 1980 });
  check('備妥 8 次申領配額 → UP 必得', full.upProb, 1, 1e-12);
  check('可申領次數 = 8', full.claims.p50, 8, 1e-12);

  // 額外配額越多，UP 機率越高
  let prev = -1;
  let mono = true;
  for (const q of [0, 1980, 3960, 7920, 11880, 15840]) {
    const r = W.simulate({ targets: [1, 1], pity: 0, budget: 120, threshold: 47, extraQuota: q, iters: 8000 });
    if (r.upProb < prev - 1e-9) mono = false;
    prev = r.upProb;
  }
  ok('額外配額 → UP 機率單調上升', mono);

  // 已申領 5 次 → 再 3 次就保底
  const late = W.simulate({ targets: [1], pity: 0, budget: 0, threshold: 47, startClaims: 5, extraQuota: 3 * 1980 });
  check('已申領 5 次 + 3 次配額 → 必得', late.upProb, 1, 1e-12);
  check('保底位置固定在 8', late.guaranteeAt, 8, 1e-12);

  // 決定性：同樣輸入 → 同樣輸出
  const a = W.simulate({ targets: [1, 1], pity: 12, budget: 180, threshold: 47, extraQuota: 3000 });
  const b = W.simulate({ targets: [1, 1], pity: 12, budget: 180, threshold: 47, extraQuota: 3000 });
  ok('同樣輸入 → 同樣輸出（固定亂數種子）',
    a.upProb === b.upProb && a.quota.mean === b.quota.mean && a.claims.p50 === b.claims.p50);

  // 配額只增不減地隨預算增加
  const small = W.simulate({ targets: [1], pity: 0, budget: 60, threshold: 47, iters: 8000 });
  const big = W.simulate({ targets: [1], pity: 0, budget: 240, threshold: 47, iters: 8000 });
  ok('預算越大 → 配額越多', big.quota.mean > small.quota.mean,
    `${Math.round(small.quota.mean)} → ${Math.round(big.quota.mean)}`);
  ok('UP 機率 <= 至少一把 6★', a.upProb <= a.sixProb + 1e-12);

  // 曲線本身：至少畫到保底位置（配額很多時會往後延伸），起點是已申領次數
  const lastPoint = a.curve[a.curve.length - 1];
  ok('曲線至少畫到保底位置', lastPoint.x >= a.guaranteeAt, 'end=' + lastPoint.x);
  ok('曲線在保底位置已達 100%', a.curve.find((p) => p.x === a.guaranteeAt).y === 1);
  ok('曲線起點 = 已申領次數', a.curve[0].x === a.startClaims);
}

// ---------------------------------------------------------------- E
function testPerformance() {
  section('E. 效能');
  const runs = [
    { label: '240 抽 / 2 期', cfg: { targets: [1, 1], pity: 0, budget: 240, threshold: 47 } },
    { label: '1200 抽 / 5 期', cfg: { targets: [1, 1, 1, 1, 1], pity: 0, budget: 1200, threshold: 47 } },
  ];
  for (const r of runs) {
    const t0 = Date.now();
    const out = W.simulate(r.cfg);
    const ms = Date.now() - t0;
    console.log(`   ${r.label}：${out.iters} 次模擬 ${ms} ms（UP ${(out.upProb * 100).toFixed(1)}%）`);
    ok(`${r.label} 要在 600ms 內`, ms < 600, ms + 'ms');
  }
}

(async () => {
  testClaimChainAgainstBruteForce();
  testChainInvariants();
  await testAgainstEngine();
  testSimulate();
  testPerformance();

  if (failed) {
    console.log('\n' + failures.join('\n'));
    console.log(`\n武器池測試：${failed} 項失敗（通過 ${passed} 項）`);
    process.exit(1);
  }
  console.log(`\n武器池測試全部通過（${passed} 項）`);
})();
