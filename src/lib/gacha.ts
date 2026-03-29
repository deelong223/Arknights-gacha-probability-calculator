// gacha-dp-corrected.ts

/**
 * 計算多池抽卡成功率（動態規劃，剩餘總資源 + 保底）
 * 單池內部完全匹配原版邏輯（10連一次性處理，使用二項分佈）
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
                    if (r < pulls) continue;
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

    let successProb = 0;
    for (let i = 0; i < dp.length; i++) {
        successProb += dp[i];
    }
    return Math.min(1.0, successProb);
}

// ---------- 單池轉移（與原版完全一致，使用二項分佈一次性處理10連）----------
interface Transition {
    pulls: number;
    endPity: number;
    prob: number;
    gotExtra: boolean;
}

const transCache = new Map<string, Transition[]>();

function getBannerTransition(initialPity: number, target: number, isLast: boolean): Transition[] {
    const cacheKey = `${initialPity}_${target}_${isLast}`;
    if (transCache.has(cacheKey)) return transCache.get(cacheKey)!;

    const results: Transition[] = [];

    // 狀態: (pity, copies, hasLimited)
    const maxCopies = target;
    const stateSize = 80 * (maxCopies + 1) * 2;
    const idx = (p: number, c: number, h: number) => p * (maxCopies + 1) * 2 + c * 2 + h;

    let curr = new Float64Array(stateSize);
    curr[idx(initialPity, 0, 0)] = 1.0;

    // 預計算30抽10連的二項分佈 (每次獲得限定的概率 = 0.008 * 0.5 = 0.004)
    const binomProbs = new Float64Array(11);
    for (let k = 0; k <= 10; k++) {
        binomProbs[k] = binomial(10, 0.004, k);
    }

    let pulls = 0;
    const MAX_PULLS = 5000; // 足夠大，實際會提前終止

    while (true) {
        // 1. 30抽里程碑：一次性處理10連（二項分佈）
        if (pulls === 30) {
            let next = new Float64Array(stateSize);
            for (let p = 0; p < 80; p++) {
                for (let c = 0; c <= maxCopies; c++) {
                    for (let h = 0; h < 2; h++) {
                        const prob = curr[idx(p, c, h)];
                        if (prob < 1e-12) continue;
                        for (let k = 0; k <= 10; k++) {
                            const probK = binomProbs[k];
                            if (probK < 1e-12) continue;
                            const newCopies = Math.min(maxCopies, c + k);
                            const newHasLimited = h || (k > 0 ? 1 : 0);
                            // 注意：pity 保持不變
                            next[idx(p, newCopies, newHasLimited)] += prob * probK;
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
        if (!active || pulls >= MAX_PULLS) break;

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

    transCache.set(cacheKey, results);
    return results;
}

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
