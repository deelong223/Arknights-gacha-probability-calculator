'use strict';
/**
 * 蒙地卡羅驗證器 — 直接「一次一抽」模擬遊戲規則，不共用任何 DP 結構。
 * 用途：獨立驗證 tests/reference.js（以及後來的 gacha.wasm）是否正確。
 */

const BASE_6 = 0.008;
const UP_SHARE = 0.5;

function p6At(n) {
  if (n >= 80) return 1;
  if (n >= 66) return Math.min(1, BASE_6 + 0.05 * (n - 65));
  return BASE_6;
}

// xorshift128+ 風格的小 PRNG（可重現）
function makeRng(seed) {
  let s0 = seed >>> 0 || 1, s1 = (seed * 2654435761) >>> 0 || 2;
  return function rng() {
    s0 ^= s0 << 13; s0 >>>= 0;
    s0 ^= s0 >>> 17;
    s0 ^= s0 << 5; s0 >>>= 0;
    s1 = (s1 + 0x9e3779b9) >>> 0;
    let t = (s0 + s1) >>> 0;
    t ^= t >>> 15; t >>>= 0;
    t = Math.imul(t, 0x846ca68b) >>> 0;
    t ^= t >>> 13; t >>>= 0;
    return t / 4294967296;
  };
}

/**
 * 玩一期卡池，回傳 {ok, pity, remaining}
 */
function playBanner(target, pity, remaining, threshold, isLast, nextActive, rng) {
  let copies = 0;
  let gotUP = false;
  let t = 0;
  let ticket = false;

  while (remaining > 0) {
    // ---- 抽一抽 ----
    remaining--;
    t++;
    const guaranteed = (t === 120 && !gotUP);
    const p6 = guaranteed ? 1 : p6At(pity + 1);
    if (rng() < p6) {
      pity = 0;
      if (guaranteed || rng() < UP_SHARE) { copies++; gotUP = true; }
    } else {
      pity++;
    }

    // ---- 里程碑（抽完才結算）----
    if (t === 30) {
      for (let k = 0; k < 10; k++) {
        if (rng() < BASE_6 * UP_SHARE) { copies++; gotUP = true; }
      }
    }
    if (t === 60) ticket = true;
    if (t % 240 === 0) copies++;

    // ---- 停手判斷 ----
    if (copies >= target) {
      const canContinue =
        !isLast && t >= threshold && t < 60 && remaining >= (60 - t);
      if (!canContinue) break;
    }
  }

  return {
    ok: copies >= target,
    pity,
    remaining: remaining + (ticket && nextActive ? 10 : 0),
  };
}

function simulate(targets, startPity, budget, threshold, rng) {
  let pity = startPity;
  let remaining = budget;
  let lastIdx = -1;
  for (let i = 0; i < targets.length; i++) if (targets[i] > 0) lastIdx = i;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (target === 0) continue;
    const nextActive = i + 1 < targets.length && targets[i + 1] > 0;
    const r = playBanner(target, pity, remaining, threshold, i === lastIdx, nextActive, rng);
    if (!r.ok) return false;
    pity = r.pity;
    remaining = r.remaining;
  }
  return true;
}

function estimate(targets, startPity, budget, threshold = 47, samples = 500000, seed = 12345) {
  const rng = makeRng(seed);
  let hits = 0;
  for (let n = 0; n < samples; n++) {
    if (simulate(targets, startPity, budget, threshold, rng)) hits++;
  }
  const p = hits / samples;
  const se = Math.sqrt((p * (1 - p)) / samples);
  return { p, se };
}

module.exports = { estimate, simulate, makeRng, p6At };
