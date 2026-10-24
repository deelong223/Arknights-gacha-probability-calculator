'use strict';
/**
 * 參考模型（reference oracle）— 只照遊戲規則寫，正確性優先，效能完全不管。
 * 用途：驗證 gacha.cpp / gacha.wasm 的數值。
 *
 * 規則（2026/10 現行《明日方舟：終末地》特許尋訪）：
 *  - 6★ 基礎 0.8%；6★ 中當期 UP 佔 50%。
 *  - 連續 65 抽沒 6★ → 第 66 抽起每抽 +5 個百分點；第 80 抽必 6★（小保底，跨池繼承）。
 *  - 本期第 120 抽若還沒拿到 UP → 該抽必為 UP 6★（每期一次、不繼承、抽到 UP 即失效）。
 *  - 本期累計 30 抽 → 送同一池 10 次「加急招募」：只用基礎機率、不計保底/不計累計次數。
 *  - 本期累計 60 抽 → 【尋訪情報書】→ 下一期特許尋訪專屬十連（會計入下期保底）。
 *  - 本期每累計 240 抽 → 當期 UP 信物 ×1（可重複）。
 */

const BASE_6 = 0.008;
const UP_SHARE = 0.5;
const PITY_HARD = 80;
const SOFT_START = 66;   // 第 66 抽起爬坡
const SOFT_STEP = 0.05;
const GUARANTEE_120 = 120;
const MILESTONE_30 = 30;
const MILESTONE_60 = 60;
const MILESTONE_240 = 240;
const FREE_TEN = 10;

// n = 這一抽是「連續第 n 抽沒 6★」
function p6At(n) {
  if (n >= PITY_HARD) return 1;
  if (n >= SOFT_START) return Math.min(1, BASE_6 + SOFT_STEP * (n - (SOFT_START - 1)));
  return BASE_6;
}

// 二項分布：送出 10 抽免費十連（只影響 copies 與「已取得 UP」旗標）
function binomial10(p) {
  const out = new Array(FREE_TEN + 1);
  let c = 1;
  for (let k = 0; k <= FREE_TEN; k++) {
    if (k > 0) c = (c * (FREE_TEN - k + 1)) / k;
    out[k] = c * Math.pow(p, k) * Math.pow(1 - p, FREE_TEN - k);
  }
  return out;
}
const BINOM10 = binomial10(BASE_6 * UP_SHARE);

/**
 * 單一卡池的「結局分布」。
 * @param {number} target     目標張數
 * @param {number} startPity  進池時的保底水位 0..79
 * @param {number} threshold  策略門檻：達標時若已抽 >= threshold 且未滿 60，就補到 60 拿情報書
 * @param {boolean} isLast    是否為最後一池（沒有下一期可吃情報書）
 * @param {object} opts       相容性開關（只用來解釋舊版行為，正式驗證不開）
 * @returns {{outcomes: Array<{t:number,p:number,w:number,ticket:boolean}>, lost:number}}
 */
function bannerOutcomes(target, startPity, threshold, isLast, opts = {}) {
  const bonusSetsUP = opts.bonusSetsUP !== false;
  const C = target;
  const S = PITY_HARD * (C + 1) * 2;
  const idx = (p, c, h) => p * (C + 1) * 2 + c * 2 + h;

  let cur = new Float64Array(S);
  cur[idx(startPity, 0, 0)] = 1;

  const outcomes = [];
  let lost = 0;
  const MAX_T = 20000;
  let t = 0;

  for (;;) {
    // ---- 里程碑（在「已抽 t 抽」時結算）----
    if (t === MILESTONE_30) {
      const next = new Float64Array(S);
      for (let p = 0; p < PITY_HARD; p++) {
        for (let c = 0; c <= C; c++) {
          for (let h = 0; h < 2; h++) {
            const w = cur[idx(p, c, h)];
            if (w === 0) continue;
            for (let k = 0; k <= FREE_TEN; k++) {
              const pk = BINOM10[k];
              if (pk === 0) continue;
              const nc = Math.min(C, c + k);
              // 免費十連抽到 UP 也算「已取得 UP」→ 120 大保底失效
              const nh = (bonusSetsUP && k > 0) ? 1 : h;
              next[idx(p, nc, nh)] += w * pk;
            }
          }
        }
      }
      cur = next;
    }
    if (t > 0 && t % MILESTONE_240 === 0) {
      const next = new Float64Array(S);
      for (let p = 0; p < PITY_HARD; p++) {
        for (let c = 0; c <= C; c++) {
          for (let h = 0; h < 2; h++) {
            const w = cur[idx(p, c, h)];
            if (w === 0) continue;
            next[idx(p, Math.min(C, c + 1), h)] += w;
          }
        }
      }
      cur = next;
    }

    // ---- 收斂：已達標的狀態要不要停手 ----
    let active = 0;
    for (let p = 0; p < PITY_HARD; p++) {
      for (let h = 0; h < 2; h++) {
        const w = cur[idx(p, C, h)];
        if (w === 0) continue;
        const keepGoing = !isLast && t >= threshold && t < MILESTONE_60;
        if (keepGoing) {
          active += w;
        } else {
          outcomes.push({ t, p, w, ticket: t >= MILESTONE_60 });
          cur[idx(p, C, h)] = 0;
        }
      }
    }
    // 未達標的狀態
    for (let p = 0; p < PITY_HARD; p++) {
      for (let c = 0; c < C; c++) {
        for (let h = 0; h < 2; h++) active += cur[idx(p, c, h)];
      }
    }

    if (active <= 1e-16 || t >= MAX_T) { lost = active; break; }

    // ---- 抽下一抽（t -> t+1）----
    t++;
    const next = new Float64Array(S);
    const force120 = (t === GUARANTEE_120);
    for (let p = 0; p < PITY_HARD; p++) {
      for (let c = 0; c <= C; c++) {
        for (let h = 0; h < 2; h++) {
          const w = cur[idx(p, c, h)];
          if (w === 0) continue;
          const guaranteed = force120 && h === 0;
          const p6 = guaranteed ? 1 : p6At(p + 1);
          const plim = guaranteed ? 1 : UP_SHARE;

          if (p6 < 1) next[idx(Math.min(PITY_HARD - 1, p + 1), c, h)] += w * (1 - p6);
          if (p6 > 0 && plim < 1) next[idx(0, c, h)] += w * p6 * (1 - plim);
          if (p6 > 0 && plim > 0) next[idx(0, Math.min(C, c + 1), 1)] += w * p6 * plim;
        }
      }
    }
    cur = next;
  }

  return { outcomes, lost };
}

/**
 * 多卡池成功機率（精確）。
 * @param {number[]} targets  每個卡池的目標張數（0 = 跳過該期）
 * @param {number} startPity  進第一期時的保底水位
 * @param {number} budget     總抽數
 * @param {number} threshold  策略門檻
 * @param {object} opts       相容性開關（解釋舊版行為用）
 */
function calculate(targets, startPity, budget, threshold = 47, opts = {}) {
  const active = [];
  targets.forEach((v, i) => { if (v > 0) active.push(i); });
  if (active.length === 0) return 1;

  const lastIdx = active[active.length - 1];
  const tableCache = new Map();

  function table(target, startPity, thr, isLast) {
    const key = `${target}|${thr}|${isLast}|${startPity}`;
    let tb = tableCache.get(key);
    if (!tb) {
      tb = bannerOutcomes(target, startPity, thr, isLast, opts).outcomes;
      tableCache.set(key, tb);
    }
    return tb;
  }

  let dist = new Map();
  dist.set(`${budget},${startPity}`, 1);

  for (const i of active) {
    const target = targets[i];
    const isLast = i === lastIdx;
    const nextIsActive = opts.ticketAlwaysRefund === true
      ? true
      : (i + 1 < targets.length && targets[i + 1] > 0);
    const next = new Map();

    for (const [k, w] of dist) {
      const [r, p] = k.split(',').map(Number);
      // r < 60 時「補到 60」買不起 → threshold 設 60 等同不續抽
      const thr = opts.noAffordabilityCheck === true
        ? threshold
        : (r >= MILESTONE_60 ? threshold : MILESTONE_60);
      for (const o of table(target, p, thr, isLast)) {
        if (o.t > r) continue;              // 買不起這個結局 → 這條路失敗
        const newR = r - o.t + (o.ticket && nextIsActive ? FREE_TEN : 0);
        const k2 = `${newR},${o.p}`;
        next.set(k2, (next.get(k2) || 0) + w * o.w);
      }
    }
    dist = next;
    if (dist.size === 0) return 0;
  }

  let s = 0;
  for (const w of dist.values()) s += w;
  return Math.min(1, s);
}

module.exports = { calculate, bannerOutcomes, p6At, BASE_6, UP_SHARE };
