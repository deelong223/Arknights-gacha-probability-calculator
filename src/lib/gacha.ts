// gacha-dp-final.ts (新增單池快速計算)

/**
 * 計算多池抽卡成功率（動態規劃，可累積免費抽）
 * 若僅有一個卡池有目標，則改用單池快速計算
 */
export function calculateMultiBanner(
    targets: number[],
    initialPity: number,
    initialBudget: number
): number {
    // 偵測是否為單卡池（只有一個非零目標）
    let nonZeroIndices = targets.map((t, idx) => t > 0 ? idx : -1).filter(i => i !== -1);
    if (nonZeroIndices.length === 1) {
        const target = targets[nonZeroIndices[0]];
        return calculateSingleBanner(target, initialPity, initialBudget);
    }

    // 原有多池邏輯（保持不變）
    let lastBannerIndex = -1;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] > 0) lastBannerIndex = i;
    }
    if (lastBannerIndex === -1) return 1.0;

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

        const transitionsForPity = new Array(PITY_STATES);
        for (let pityIn = 0; pityIn < PITY_STATES; pityIn++) {
            transitionsForPity[pityIn] = getBannerTransition(pityIn, target, isLast);
        }

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

function calculateSingleBanner(target: number, initialPity: number, budget: number): number {
    const maxCopies = target;
    const stateSize = 80 * (maxCopies + 1) * 2;
    const idx = (p: number, c: number, h: number) => p * (maxCopies + 1) * 2 + c * 2 + h;

    let dp = new Float64Array(stateSize);
    dp[idx(initialPity, 0, 0)] = 1.0;

    const binomProbs = new Float64Array(11);
    for (let k = 0; k <= 10; k++) {
        binomProbs[k] = binomial(10, 0.004, k);
    }

    let remainingBudget = budget;
    let pulls = 0;
    let success = 0;

    while (remainingBudget > 0) {
        // ===== 關鍵修正：30抽里程碑先處理（在檢查終止之前）=====
        if (pulls === 30) {
            let next = new Float64Array(stateSize);
            for (let p = 0; p < 80; p++) {
                for (let c = 0; c < target; c++) {
                    for (let h = 0; h < 2; h++) {
                        const prob = dp[idx(p, c, h)];
                        if (prob === 0) continue;
                        for (let k = 0; k <= 10; k++) {
                            const probK = binomProbs[k];
                            if (probK < 1e-12) continue;
                            const nextC = Math.min(maxCopies, c + k);
                            next[idx(p, nextC, h)] += prob * probK;
                        }
                    }
                }
            }
            // 同時保留已達標狀態（c >= target）不變
            for (let p = 0; p < 80; p++) {
                for (let c = target; c <= maxCopies; c++) {
                    for (let h = 0; h < 2; h++) {
                        const prob = dp[idx(p, c, h)];
                        if (prob > 0) {
                            next[idx(p, c, h)] += prob;
                        }
                    }
                }
            }
            dp = next;
        }

        // 將已達標狀態移出到 success
        for (let p = 0; p < 80; p++) {
            for (let c = target; c <= maxCopies; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = dp[idx(p, c, h)];
                    if (prob > 0) {
                        success += prob;
                        dp[idx(p, c, h)] = 0;
                    }
                }
            }
        }

        // 檢查是否還有活躍狀態
        let active = false;
        for (let i = 0; i < dp.length; i++) {
            if (dp[i] > 0) { active = true; break; }
        }
        if (!active) break;

        // 消耗預算
        remainingBudget--;
        pulls++;

        let next = new Float64Array(stateSize);
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c < target; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = dp[idx(p, c, h)];
                    if (prob === 0) continue;

                    let p6 = 0.008;
                    let pLimGiven6 = 0.5;
                    if (pulls === 120 && h === 0) {
                        p6 = 1.0;
                        pLimGiven6 = 1.0;
                    } else {
                        const n = p + 1;
                        if (n >= 66 && n <= 79) {
                            p6 = 0.008 + 0.05 * (n - 65);
                        } else if (n >= 80) {
                            p6 = 1.0;
                        }
                    }

                    // 不出六星
                    if (p6 < 1.0) {
                        const np = Math.min(79, p + 1);
                        let nc = c;
                        if (pulls === 240) nc = Math.min(maxCopies, nc + 1);
                        next[idx(np, nc, h)] += prob * (1 - p6);
                    }
                    // 出非限定
                    if (p6 > 0 && pLimGiven6 < 1.0) {
                        const np = 0;
                        let nc = c;
                        if (pulls === 240) nc = Math.min(maxCopies, nc + 1);
                        next[idx(np, nc, h)] += prob * p6 * (1 - pLimGiven6);
                    }
                    // 出限定
                    if (p6 > 0 && pLimGiven6 > 0) {
                        const np = 0;
                        let nc = Math.min(maxCopies, c + 1);
                        if (pulls === 240) nc = Math.min(maxCopies, nc + 1);
                        next[idx(np, nc, 1)] += prob * p6 * pLimGiven6;
                    }
                }
            }
        }
        dp = next;
    }

    // 最後一次將剩餘已達標狀態加入 success
    for (let p = 0; p < 80; p++) {
        for (let c = target; c <= maxCopies; c++) {
            for (let h = 0; h < 2; h++) {
                success += dp[idx(p, c, h)];
            }
        }
    }
    return Math.min(1.0, success);
}

// ---------- 單池轉移（與您的原版完全一致）----------
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

    const STATE_SIZE = 80 * (target + 1) * 2;
    const idx = (p: number, c: number, h: number) => p * (target + 1) * 2 + c * 2 + h;

    let curr = new Float64Array(STATE_SIZE);
    curr[idx(initialPity, 0, 0)] = 1.0;

    // 預計算30抽10連的二項分佈（固定機率 0.004）
    const binomProbs = new Float64Array(11);
    for (let k = 0; k <= 10; k++) {
        binomProbs[k] = binomial(10, 0.004, k);
    }

    let pulls = 0;
    const MAX_PULLS = 5000; // 足夠高

    while (true) {
        // 1. 30抽里程碑：一次性加上10連結果（不改變pity，不增加pulls）
        if (pulls === 30) {
            let next = new Float64Array(STATE_SIZE);
            for (let p = 0; p < 80; p++) {
                for (let c = 0; c <= target; c++) {
                    for (let h = 0; h < 2; h++) {
                        const prob = curr[idx(p, c, h)];
                        if (prob === 0) continue;
                        for (let k = 0; k <= 10; k++) {
                            const probK = binomProbs[k];
                            if (probK < 1e-12) continue;
                            const nextC = Math.min(target, c + k);
                            next[idx(p, nextC, h)] += prob * probK;
                        }
                    }
                }
            }
            curr = next;
        }

        // 2. 檢查終止條件
        let active = false;
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= target; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = curr[idx(p, c, h)];
                    if (prob === 0) continue;
                    const reached = c >= target;
                    const shouldContinue = reached && pulls >= 22 && pulls < 60 && !isLast;
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

        // 3. 進行一次正常抽卡
        pulls++;
        let next = new Float64Array(STATE_SIZE);
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= target; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = curr[idx(p, c, h)];
                    if (prob === 0) continue;

                    let p6 = 0.008;
                    let pLimGiven6 = 0.5;

                    if (pulls === 120 && h === 0) {
                        p6 = 1.0;
                        pLimGiven6 = 1.0;
                    } else {
                        const n = p + 1;
                        if (n >= 66 && n <= 79) {
                            p6 = 0.008 + 0.05 * (n - 65);
                        } else if (n >= 80) {
                            p6 = 1.0;
                        }
                    }

                    // 不出六星
                    if (p6 < 1.0) {
                        const np = Math.min(79, p + 1);
                        let nc = c;
                        if (pulls === 240) nc = Math.min(target, nc + 1);
                        next[idx(np, nc, h)] += prob * (1 - p6);
                    }
                    // 出非限定六星
                    if (p6 > 0 && pLimGiven6 < 1.0) {
                        const np = 0;
                        let nc = c;
                        if (pulls === 240) nc = Math.min(target, nc + 1);
                        next[idx(np, nc, h)] += prob * p6 * (1 - pLimGiven6);
                    }
                    // 出限定六星
                    if (p6 > 0 && pLimGiven6 > 0) {
                        const np = 0;
                        let nc = Math.min(target, c + 1);
                        if (pulls === 240) nc = Math.min(target, nc + 1);
                        next[idx(np, nc, 1)] += prob * p6 * pLimGiven6;
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
