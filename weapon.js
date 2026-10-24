/* weapon.js — 武器池「武庫申領」蒙地卡羅模擬
 *
 * 為什麼用模擬？
 *   武器池的抽卡資源「武庫配額」幾乎只能從角色池的抽取結果取得
 *   （4★ 20 / 5★ 200 / 6★ 2000），而角色池要抽幾抽、抽到什麼星級，
 *   本身又是保底 + 大保底 + 里程獎勵耦合出來的隨機量。
 *   兩層隨機疊在一起就沒有漂亮的封閉解，所以這裡直接模擬：
 *     角色池抽到停手 → 累積配額 → 換成申領次數 → 武器池能拿到什麼。
 *
 * 模型（2026/10 版本）：
 *   角色池：6★ 0.8%（UP 佔 50%）、66 抽起 +5pp、80 抽硬保底、
 *           120 抽大保底 UP、30 抽送加急十連、60 抽送情報書、每 240 抽一個信物。
 *   武器池：一次申領 1980 配額、給 10 件武器；
 *           6★ 4%（其中當期 UP 1%）、5★ 15%、其餘 4★；
 *           連續 3 次申領沒 6★ → 第 4 次必 6★（不繼承）；
 *           本期第 8 次申領必為當期 UP（僅一次、不繼承）。
 *
 * 對外 API（瀏覽器 window.Weapon，Node 用 require）：
 *   Weapon.RULES                      規則常數
 *   Weapon.simulate(cfg)              蒙地卡羅 + 申領鏈精算 → 統計
 *   Weapon.claimChain(start, horizon) 申領鏈（UP / 6★ 的累積機率）
 *   Weapon.estimateSuccess(cfg, n)    角色池通關機率（測試用，對照 DP）
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Weapon = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ---------------------------------------------------------------- 角色池
  var BASE6 = 0.008;              // 6★ 基礎機率
  var P5 = 0.08;                  // 5★ 機率（其餘為 4★）
  var UP_SHARE = 0.5;             // 6★ 之中當期 UP 佔比
  var PITY_MAX = 80;              // 第 80 抽必 6★
  var SOFT_START = 66;            // 第 66 抽起爬坡
  var SOFT_STEP = 0.05;
  var GUARANTEE_120 = 120;        // 第 120 抽必 UP
  var MILESTONE_30 = 30;
  var MILESTONE_60 = 60;
  var MILESTONE_240 = 240;
  var FREE_TEN = 10;
  var Q6 = 2000;                  // 抽到 6★ 的配額
  var Q5 = 200;
  var Q4 = 20;

  // ---------------------------------------------------------------- 武器池
  var QUOTA_PER_CLAIM = 1980;
  var CLAIM_SIZE = 10;
  var W6 = 0.04;                  // 單件 6★
  var W_UP = 0.01;                // 單件當期 UP（= 6★ 的 25%）
  var W5 = 0.15;
  var PITY6_CLAIMS = 4;           // 連續 3 次沒 6★ → 第 4 次必 6★
  var UP_GUARANTEE = 8;           // 本期第 8 次申領必 UP（僅一次）
  var MAX_START_CLAIMS = UP_GUARANTEE - 1;
  var CLAIM_CAP = 40;             // 安全上限

  // 單件機率換算成「一次申領」的機率
  var C_UP = 1 - Math.pow(1 - W_UP, CLAIM_SIZE);        // 0.0956
  var C_SIX = 1 - Math.pow(1 - W6, CLAIM_SIZE);         // 0.3352
  var C_SIX_NOT_UP = C_SIX - C_UP;                      // 0.2396
  var C_NONE = 1 - C_SIX;                               // 0.6648

  // 6★ 機率表：P6[p] = 距上次 6★ 已 p 抽時，下一抽中 6★ 的機率
  var P6 = (function () {
    var a = new Float64Array(PITY_MAX);
    for (var p = 0; p < PITY_MAX; p++) {
      var n = p + 1;
      var v = BASE6;
      if (n >= PITY_MAX) v = 1;
      else if (n >= SOFT_START) v = BASE6 + SOFT_STEP * (n - (SOFT_START - 1));
      a[p] = v > 1 ? 1 : v;
    }
    return a;
  })();

  // ---------------------------------------------------------------- 工具
  function makeRng(seed) {
    var s0 = (seed >>> 0) || 0x9e3779b9;
    var s1 = ((seed >>> 0) * 2654435761) >>> 0 || 2;
    return function rng() {
      s0 ^= s0 << 13; s0 >>>= 0;
      s0 ^= s0 >>> 17;
      s0 ^= s0 << 5; s0 >>>= 0;
      s1 = (s1 + 0x9e3779b9) >>> 0;
      var t = (s0 + s1) >>> 0;
      t ^= t >>> 15; t >>>= 0;
      t = Math.imul(t, 0x846ca68b) >>> 0;
      t ^= t >>> 13; t >>>= 0;
      return t / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function quantile(sorted, q) {
    if (!sorted.length) return 0;
    var idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
    return sorted[idx];
  }

  function meanOf(arr) {
    var s = 0;
    for (var i = 0; i < arr.length; i++) s += arr[i];
    return arr.length ? s / arr.length : 0;
  }

  function sortedCopy(arr) {
    var out = new Float64Array(arr.length);
    out.set(arr);
    out.sort(function (a, b) { return a - b; });
    return out;
  }

  // ---------------------------------------------------------------- 角色池：玩一期
  // 回傳 { ok, pity, budget, ticket, quota }
  // 停手策略與 UI 一致：達標即停；若達標時已抽 >= 門檻且未滿 60、預算也夠，就補到 60 拿情報書。
  function playBanner(rng, target, pity, budget, threshold, isLast) {
    var pulls = 0;
    var copies = 0;
    var gotUP = false;
    var ticket = false;
    var quota = 0;
    var k;

    while (budget > 0) {
      if (copies >= target) {
        var keep = !isLast && pulls >= threshold && pulls < MILESTONE_60 &&
          budget >= (MILESTONE_60 - pulls);
        if (!keep) break;
      }

      budget--; pulls++;

      var guaranteed = (pulls === GUARANTEE_120 && !gotUP);
      var p6 = guaranteed ? 1 : P6[pity];
      if (rng() < p6) {
        pity = 0;
        quota += Q6;
        if (guaranteed || rng() < UP_SHARE) { copies++; gotUP = true; }
      } else {
        pity = (pity + 1 < PITY_MAX) ? pity + 1 : PITY_MAX - 1;
        if (rng() < P5) quota += Q5;
        else quota += Q4;
      }

      // 30 抽送同池加急十連：只吃基礎機率、不計保底、不計累計次數
      if (pulls === MILESTONE_30) {
        for (k = 0; k < FREE_TEN; k++) {
          var u = rng();
          if (u < BASE6 * UP_SHARE) { copies++; gotUP = true; quota += Q6; }
          else if (u < BASE6) { quota += Q6; }
          else if (u < BASE6 + P5) { quota += Q5; }
          else { quota += Q4; }
        }
      }
      if (pulls === MILESTONE_60) ticket = true;
      if (pulls % MILESTONE_240 === 0) copies++;
    }

    return {
      ok: copies >= target,
      pity: pity,
      budget: budget,
      ticket: ticket,
      quota: quota,
    };
  }

  // 跑完整輪（多期），回傳 { ok, quota, spent }
  function simulateRun(rng, cfg) {
    var targets = cfg.targets || [];
    var threshold = cfg.threshold;
    if (threshold === undefined || threshold === null) threshold = 47;
    var pity = clamp(cfg.pity | 0, 0, PITY_MAX - 1);
    var budget = Math.max(0, cfg.budget | 0);
    var start = budget;
    var quota = 0;
    var ok = true;
    var carried = false;
    var i;

    for (i = 0; i < targets.length; i++) {
      if ((targets[i] | 0) <= 0) { carried = false; continue; }  // 跳過該期 → 情報書作廢
      if (carried) { budget += FREE_TEN; carried = false; }      // 情報書：下一期多 10 抽
      var last = true;
      for (var j = i + 1; j < targets.length; j++) {
        if ((targets[j] | 0) > 0) { last = false; break; }
      }
      var r = playBanner(rng, targets[i] | 0, pity, budget, threshold, last);
      quota += r.quota;
      pity = r.pity;
      budget = r.budget;
      carried = r.ticket;
      if (!r.ok) ok = false;
    }

    return { ok: ok, quota: quota, spent: start - budget + (carried ? 0 : 0) };
  }

  // ---------------------------------------------------------------- 武器池：申領鏈
  //
  // 狀態：距上次 6★ 的申領次數 c6（0..3）。逐次申領推進，算出
  //   up[k]  = 前 k 次申領內拿到當期 UP 的機率
  //   six[k] = 前 k 次申領內至少一把 6★ 的機率
  //
  // start：本期已經申領過幾次（假設那幾次都沒出 6★，最保守）。
  function claimChain(start, horizon) {
    start = clamp(start | 0, 0, MAX_START_CLAIMS);
    horizon = clamp(horizon | 0, 0, CLAIM_CAP);

    var up = new Float64Array(horizon + 1);
    var six = new Float64Array(horizon + 1);

    // a[c6]：還沒拿到 UP 的質量（c6 = 連續沒 6★ 的申領次數）
    // b[c6]：還沒拿到任何 6★ 的質量
    var a = [1, 0, 0, 0];
    var b = [1, 0, 0, 0];
    // 起始狀態：已申領 start 次都沒 6★
    if (start > 0) {
      a = [0, 0, 0, 0]; b = [0, 0, 0, 0];
      var c0 = Math.min(start, PITY6_CLAIMS - 1);
      a[c0] = 1; b[c0] = 1;
    }

    var doneUp = 0;
    var doneSix = 0;

    for (var k = 1; k <= horizon; k++) {
      var bannerClaim = start + k;
      var na = [0, 0, 0, 0];
      var nb = [0, 0, 0, 0];

      for (var c = 0; c < PITY6_CLAIMS; c++) {
        var wa = a[c];
        var wb = b[c];
        if (wa > 0) {
          if (bannerClaim === UP_GUARANTEE) {
            doneUp += wa;                       // 第 8 次申領：必 UP
          } else if (c === PITY6_CLAIMS - 1) {
            doneUp += wa * (W_UP / W6);         // 必 6★ → 25% 是 UP
            na[0] += wa * (1 - W_UP / W6);
          } else {
            doneUp += wa * C_UP;
            na[0] += wa * C_SIX_NOT_UP;
            na[c + 1] += wa * C_NONE;
          }
        }
        if (wb > 0) {
          if (bannerClaim === UP_GUARANTEE) {
            doneSix += wb;                      // 必 UP 也是 6★
          } else if (c === PITY6_CLAIMS - 1) {
            doneSix += wb;
          } else {
            doneSix += wb * C_SIX;
            nb[c + 1] += wb * C_NONE;
          }
        }
      }

      a = na; b = nb;
      up[k] = doneUp > 1 ? 1 : doneUp;
      six[k] = doneSix > 1 ? 1 : doneSix;
    }

    return { up: up, six: six, start: start, horizon: horizon };
  }

  // ---------------------------------------------------------------- 對外：模擬
  //
  // cfg = { targets, pity, budget, threshold, extraQuota, startClaims, iters, seed }
  function simulate(cfg) {
    cfg = cfg || {};
    var budget = Math.max(0, cfg.budget | 0);
    var extra = Math.max(0, cfg.extraQuota | 0);
    var start = clamp(cfg.startClaims | 0, 0, MAX_START_CLAIMS);
    var iters = clamp(cfg.iters || (budget <= 400 ? 20000 : 10000), 500, 200000);
    var rng = makeRng((cfg.seed || 0x5eed) >>> 0);

    var quotaSamples = new Float64Array(iters);
    var claimSamples = new Float64Array(iters);
    var sumQuota = 0;
    var sumClaims = 0;
    var i;

    for (i = 0; i < iters; i++) {
      var r = simulateRun(rng, cfg);
      var q = r.quota;
      var claims = start + Math.floor((q + extra) / QUOTA_PER_CLAIM);
      quotaSamples[i] = q;
      claimSamples[i] = claims;
      sumQuota += q;
      sumClaims += claims;
    }

    var qSorted = sortedCopy(quotaSamples);
    var cSorted = sortedCopy(claimSamples);

    // 曲線至少畫到保底為止；配額很多時再往後延伸到 P90，讓「你的點」看得出來
    var horizon = Math.max(UP_GUARANTEE - start, Math.ceil(quantile(cSorted, 0.9)));
    horizon = clamp(horizon, 1, 20);
    var chain = claimChain(start, horizon);

    var upProb = 0;
    var sixProb = 0;
    for (i = 0; i < iters; i++) {
      var at = claimSamples[i];
      var idx = at > horizon ? horizon : (at < 0 ? 0 : at);
      upProb += chain.up[idx];
      sixProb += chain.six[idx];
    }

    // 專武需要的申領次數分布（從目前狀態起算，含已經申領過的次數）
    var needMean = 0;
    var needMedian = start + horizon;
    var prev = 0;
    var medianFound = false;
    for (var k = 0; k <= horizon; k++) {
      var mass = chain.up[k] - prev;
      if (mass > 0) needMean += (start + k) * mass;
      prev = chain.up[k];
      if (!medianFound && chain.up[k] >= 0.5) { needMedian = start + k; medianFound = true; }
    }

    var curve = [];
    for (var x = 0; x <= horizon; x++) curve.push({ x: start + x, y: chain.up[x] });

    return {
      iters: iters,
      extraQuota: extra,
      startClaims: start,
      guaranteeAt: UP_GUARANTEE,
      quota: {
        mean: sumQuota / iters,
        p10: quantile(qSorted, 0.10),
        p50: quantile(qSorted, 0.50),
        p90: quantile(qSorted, 0.90),
      },
      claims: {
        mean: sumClaims / iters,
        p10: quantile(cSorted, 0.10),
        p50: quantile(cSorted, 0.50),
        p90: quantile(cSorted, 0.90),
      },
      upProb: upProb / iters,
      sixProb: sixProb / iters,
      need: { mean: needMean, p50: needMedian },
      curve: curve,
      chain: chain,
    };
  }

  // 角色池通關機率（蒙地卡羅；測試拿來對照 DP 引擎）
  function estimateSuccess(cfg, iters, seed) {
    var n = iters || 200000;
    var rng = makeRng((seed || 0x1234) >>> 0);
    var hits = 0;
    for (var i = 0; i < n; i++) if (simulateRun(rng, cfg).ok) hits++;
    return { p: hits / n, se: Math.sqrt((hits / n) * (1 - hits / n) / n), iters: n };
  }

  return {
    RULES: {
      quotaPerClaim: QUOTA_PER_CLAIM,
      claimSize: CLAIM_SIZE,
      weapon6: W6,
      weaponUpShare: W_UP / W6,
      weapon5: W5,
      pity6Claims: PITY6_CLAIMS,
      upGuaranteeClaim: UP_GUARANTEE,
      maxStartClaims: MAX_START_CLAIMS,
      quota6: Q6,
      quota5: Q5,
      quota4: Q4,
    },
    claimChain: claimChain,
    simulate: simulate,
    simulateRun: simulateRun,
    estimateSuccess: estimateSuccess,
    makeRng: makeRng,
  };
});
