// gacha-dp-final.ts

/**
 * 計算多池抽卡成功率（動態規劃 + 剪枝 + Float64Array）
 * @param targets 各池目標數量，0表示跳過
 * @param initialPity 初始保底 (0~79)
 * @param initialBudget 初始預算
 */
export function calculateMultiBanner(
    targets: number[],
    initialPity: number,
    initialBudget: number
): number {
    let lastBannerIndex = -1;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] > 0) lastBannerIndex = i;
    }
    if (lastBannerIndex === -1) return 1.0;

    // 最大剩餘資源：初始預算 + 每個池最多獎勵10
    const maxRemaining = initialBudget + 10 * targets.length;
    const PITY_STATES = 80;
    const stateSize = (maxRemaining + 1) * PITY_STATES;
    let dp = new Float64Array(stateSize);
    dp[initialBudget * PITY_STATES + initialPity] = 1.0;

    for (let i = 0; i <= lastBannerIndex; i++) {
        const target = targets[i];
        const isLast = i === lastBannerIndex;
        const nextDp = new Float64Array(stateSize);

        if (target === 0) {
            // 跳過該池：剩餘資源不變，保底不變
            for (let r = 0; r <= maxRemaining; r++) {
                for (let p = 0; p < PITY_STATES; p++) {
                    const prob = dp[r * PITY_STATES + p];
                    if (prob > 1e-12) {
                        nextDp[r * PITY_STATES + p] += prob;
                    }
                }
            }
            dp = nextDp;
            continue;
        }

        // 預先取得此池的所有轉移 (pityIn -> 多個結果)
        const transitionsForPity = new Array(PITY_STATES);
        for (let pityIn = 0; pityIn < PITY_STATES; pityIn++) {
            transitionsForPity[pityIn] = getBannerTransition(pityIn, target, isLast);
        }

        // 遍歷所有非零狀態
        for (let r = 0; r <= maxRemaining; r++) {
            for (let p = 0; p < PITY_STATES; p++) {
                const prob = dp[r * PITY_STATES + p];
                if (prob < 1e-12) continue;

                const transitions = transitionsForPity[p];
                for (const trans of transitions) {
                    const { pulls, endPity, prob: transProb, gotExtra } = trans;
                    if (r < pulls) continue; // 資源不足
                    let newRemaining = r - pulls + (gotExtra ? 10 : 0);
                    if (newRemaining > maxRemaining) newRemaining = maxRemaining;
                    const newProb = prob * transProb;
                    if (newProb < 1e-12) continue;
                    nextDp[newRemaining * PITY_STATES + endPity] += newProb;
                }
            }
        }
        dp = nextDp;
    }

    // 所有剩餘狀態都算成功
    let successProb = 0;
    for (let i = 0; i < dp.length; i++) {
        successProb += dp[i];
    }
    return Math.min(1.0, successProb);
}

// ---------- 單池精確轉移（動態規劃）----------
interface Transition {
    pulls: number;      // 消耗的總抽數（不含贈送10連）
    endPity: number;
    prob: number;
    gotExtra: boolean;  // pulls >= 60
}

const bannerTransCache = new Map<string, Transition[]>();

function getBannerTransition(initialPity: number, target: number, isLast: boolean): Transition[] {
    const cacheKey = `${initialPity}_${target}_${isLast}`;
    if (bannerTransCache.has(cacheKey)) return bannerTransCache.get(cacheKey)!;

    const results: Transition[] = [];

    // 狀態: (pity, copies, hasLimited)
    const maxCopies = target;
    const stateSize = 80 * (maxCopies + 1) * 2;
    const idx = (p: number, c: number, h: number) => p * (maxCopies + 1) * 2 + c * 2 + h;

    let curr = new Float64Array(stateSize);
    curr[idx(initialPity, 0, 0)] = 1.0;

    let pulls = 0;
    // 動態上限：每個目標最多200抽
    const maxPulls = Math.min(5000, target * 200 + 500);

    while (true) {
        // 1. 30抽里程碑：贈送10連（不消耗資源、不計入 pulls、不影響保底）
        if (pulls === 30) {
            let next = new Float64Array(stateSize);
            const tenPullResults = getTenPullDist(); // 固定分佈，不依賴 pity
            for (let p = 0; p < 80; p++) {
                for (let c = 0; c <= maxCopies; c++) {
                    for (let h = 0; h < 2; h++) {
                        const prob = curr[idx(p, c, h)];
                        if (prob < 1e-16) continue;
                        for (const res of tenPullResults) {
                            const newCopies = Math.min(maxCopies, c + res.limitedGain);
                            const newHasLimited = h || (res.limitedGain > 0 ? 1 : 0);
                            // pity 保持不變
                            next[idx(p, newCopies, newHasLimited)] += prob * res.prob;
                        }
                    }
                }
            }
            curr = next;
        }

        // 2. 檢查終止條件
        let active = false;
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= maxCopies; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = curr[idx(p, c, h)];
                    if (prob < 1e-12) continue;
                    const reached = c >= target;
                    const shouldContinue = reached && pulls >= 9 && pulls < 60 && !isLast;
                    if (reached && !shouldContinue) {
                        results.push({
                            pulls: pulls,
                            endPity: p,
                            prob: prob,
                            gotExtra: pulls >= 60
                        });
                        curr[idx(p, c, h)] = 0;
                    } else {
                        active = true;
                    }
                }
            }
        }
        if (!active || pulls >= maxPulls) break;

        // 3. 進行一次正常抽卡（消耗資源）
        pulls++;
        let next = new Float64Array(stateSize);
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= maxCopies; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = curr[idx(p, c, h)];
                    if (prob < 1e-12) continue;

                    let p6 = get6StarProb(p + 1);
                    let isLimitedGiven6 = 0.5;

                    // 120抽保底
                    if (pulls === 120 && h === 0) {
                        p6 = 1.0;
                        isLimitedGiven6 = 1.0;
                    }

                    // 不出六星
                    if (p6 < 1.0) {
                        const np = Math.min(79, p + 1);
                        let nc = c;
                        if (pulls === 240) nc = Math.min(maxCopies, nc + 1);
                        next[idx(np, nc, h)] += prob * (1 - p6);
                    }
                    // 出六星非限定
                    if (p6 > 0 && isLimitedGiven6 < 1.0) {
                        const np = 0;
                        let nc = c;
                        if (pulls === 240) nc = Math.min(maxCopies, nc + 1);
                        next[idx(np, nc, h)] += prob * p6 * (1 - isLimitedGiven6);
                    }
                    // 出限定六星
                    if (p6 > 0 && isLimitedGiven6 > 0) {
                        const np = 0;
                        let nc = Math.min(maxCopies, c + 1);
                        if (pulls === 240) nc = Math.min(maxCopies, nc + 1);
                        next[idx(np, nc, 1)] += prob * p6 * isLimitedGiven6;
                    }
                }
            }
        }
        curr = next;
    }

    bannerTransCache.set(cacheKey, results);
    return results;
}

// ---------- 10連抽分佈（不影響保底，固定機率）---------
const tenPullDistCache: { limitedGain: number, prob: number }[] | null = null;

function getTenPullDist(): { limitedGain: number, prob: number }[] {
    // 固定結果，只需計算一次
    if (tenPullDistCache) return tenPullDistCache;
    
    const BASE_RATE = 0.008;
    const LIMITED_RATE = 0.5;
    const p = BASE_RATE * LIMITED_RATE; // 0.004
    
    const results: { limitedGain: number, prob: number }[] = [];
    for (let k = 0; k <= 10; k++) {
        const prob = binomial(10, p, k);
        if (prob > 1e-12) {
            results.push({ limitedGain: k, prob });
        }
    }
    return results;
}

// 二項分佈輔助函數
function binomial(n: number, p: number, k: number): number {
    let coeff = 1;
    for (let i = 1; i <= k; i++) {
        coeff = coeff * (n - i + 1) / i;
    }
    return coeff * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

function get6StarProb(pity: number): number {
    if (pity >= 80) return 1.0;
    if (pity >= 66) {
        return 0.008 + 0.05 * (pity - 65);
    }
    return 0.008;
}
