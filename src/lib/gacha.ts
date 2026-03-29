// gacha-dp-final.ts

/**
 * 計算多池抽卡成功率（動態規劃，剩餘總資源 + 保底）
 * @param targets 各池目標數量，0 表示跳過
 * @param initialPity 初始保底 (0~79)
 * @param initialBudget 初始預算（總可用抽數）
 * @returns 成功機率
 */
export function calculateMultiBanner(
    targets: number[],
    initialPity: number,
    initialBudget: number
): number {
    // 找到最後一個有目標的池
    let lastBannerIndex = -1;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] > 0) lastBannerIndex = i;
    }
    if (lastBannerIndex === -1) return 1.0;

    // 最大剩餘資源：初始預算 + 每個池最多獎勵 10（保守估計）
    const maxRemaining = initialBudget + 10 * targets.length;
    // 使用 Map 存儲狀態，鍵為 "remaining|pity"
    let dp = new Map<string, number>();
    dp.set(`${initialBudget}|${initialPity}`, 1.0);

    for (let i = 0; i <= lastBannerIndex; i++) {
        const target = targets[i];
        const isLast = i === lastBannerIndex;
        const nextDp = new Map<string, number>();

        if (target === 0) {
            // 跳過該池：剩餘資源不變，保底不變
            for (const [key, prob] of dp) {
                nextDp.set(key, (nextDp.get(key) || 0) + prob);
            }
            dp = nextDp;
            continue;
        }

        // 對每個當前狀態，應用該池的轉移
        for (const [key, prob] of dp) {
            const [remaining, pityIn] = key.split('|').map(Number);
            // 獲取該池的轉移分佈
            const transitions = getBannerTransition(pityIn, target, isLast);
            for (const trans of transitions) {
                const { pulls, endPity, prob: transProb, gotExtra } = trans;
                // 檢查資源是否足夠
                if (remaining < pulls) continue;
                // 新剩餘資源 = 剩餘 - 消耗 + 獎勵（如果有）
                let newRemaining = remaining - pulls + (gotExtra ? 10 : 0);
                const newKey = `${newRemaining}|${endPity}`;
                nextDp.set(newKey, (nextDp.get(newKey) || 0) + prob * transProb);
            }
        }
        dp = nextDp;
    }

    // 所有最終狀態都算成功（因為轉移時已過濾資源不足）
    let successProb = 0;
    for (const prob of dp.values()) {
        successProb += prob;
    }
    return Math.min(1.0, successProb);
}

// ---------- 單池精確轉移（動態規劃）----------
interface Transition {
    pulls: number;      // 該池內消耗的總抽數（不含贈送10連）
    endPity: number;    // 結束時的保底計數
    prob: number;       // 機率
    gotExtra: boolean;  // 是否獲得獎勵（pulls >= 60）
}

const transCache = new Map<string, Transition[]>();

function getBannerTransition(
    initialPity: number,
    target: number,
    isLast: boolean
): Transition[] {
    const cacheKey = `${initialPity}_${target}_${isLast}`;
    if (transCache.has(cacheKey)) return transCache.get(cacheKey)!;

    const results: Transition[] = [];

    // 狀態: (pity, copies, hasLimited)
    // pity: 0~79
    // copies: 0~target
    // hasLimited: 0/1
    const stateSize = 80 * (target + 1) * 2;
    const idx = (p: number, c: number, h: number) =>
        p * (target + 1) * 2 + c * 2 + h;

    let curr = new Float64Array(stateSize);
    curr[idx(initialPity, 0, 0)] = 1.0;

    let pulls = 0; // 只計算消耗資源的抽數，贈送10連不增加此值

    while (true) {
        // 1. 處理 30 抽里程碑：贈送 10 連（不計入 pulls）
        if (pulls === 30) {
            let next = new Float64Array(stateSize);
            for (let p = 0; p < 80; p++) {
                for (let c = 0; c <= target; c++) {
                    for (let h = 0; h < 2; h++) {
                        const prob = curr[idx(p, c, h)];
                        if (prob === 0) continue;
                        // 從當前 pity 開始，連續抽 10 次（不消耗資源，不增加 pulls）
                        const tenPullDist = getTenPullDistribution(p, target);
                        for (const outcome of tenPullDist) {
                            const newPity = outcome.endPity;
                            const newCopies = Math.min(target, c + outcome.limitedGained);
                            const newHasLimited = h || outcome.limitedGained > 0 ? 1 : 0;
                            next[idx(newPity, newCopies, newHasLimited)] += prob * outcome.prob;
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
                    // 策略：如果已達成目標，且 (抽數 < 9 或 抽數 >= 60 或 是最後一個池)，則停止
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
        if (!active || pulls > 500) break;

        // 3. 進行一次正常抽卡（消耗資源）
        pulls++;
        let next = new Float64Array(stateSize);
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= target; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = curr[idx(p, c, h)];
                    if (prob === 0) continue;

                    // 計算出六星機率
                    let p6 = get6StarProb(p + 1);
                    let isLimitedGiven6 = 0.5;

                    // 120 抽保底（pulls 是消耗資源的抽數）
                    if (pulls === 120 && h === 0) {
                        p6 = 1.0;
                        isLimitedGiven6 = 1.0;
                    }

                    // 不出六星
                    if (p6 < 1.0) {
                        const np = Math.min(79, p + 1);
                        let nc = c;
                        if (pulls === 240) nc = Math.min(target, nc + 1);
                        next[idx(np, nc, h)] += prob * (1 - p6);
                    }
                    // 出六星非限定
                    if (p6 > 0 && isLimitedGiven6 < 1.0) {
                        const np = 0;
                        let nc = c;
                        if (pulls === 240) nc = Math.min(target, nc + 1);
                        next[idx(np, nc, h)] += prob * p6 * (1 - isLimitedGiven6);
                    }
                    // 出限定六星
                    if (p6 > 0 && isLimitedGiven6 > 0) {
                        const np = 0;
                        let nc = Math.min(target, c + 1);
                        if (pulls === 240) nc = Math.min(target, nc + 1);
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

/**
 * 10連抽的結果分佈（不消耗資源，不影響 pulls 計數）
 * 返回: { endPity, limitedGained, prob }[]
 */
function getTenPullDistribution(startPity: number, target: number): { endPity: number, limitedGained: number, prob: number }[] {
    let dist = new Map<string, number>();
    dist.set(`${startPity}|0`, 1.0); // pity|limitedGained

    for (let step = 0; step < 10; step++) {
        const nextDist = new Map<string, number>();
        for (const [key, prob] of dist) {
            const [pityStr, gainedStr] = key.split('|');
            let pity = parseInt(pityStr);
            let gained = parseInt(gainedStr);

            const p6 = get6StarProb(pity + 1);

            // 不出六星
            if (p6 < 1.0) {
                const newKey = `${Math.min(79, pity + 1)}|${gained}`;
                nextDist.set(newKey, (nextDist.get(newKey) || 0) + prob * (1 - p6));
            }
            // 出六星非限定
            if (p6 > 0) {
                const newKey = `0|${gained}`;
                nextDist.set(newKey, (nextDist.get(newKey) || 0) + prob * p6 * 0.5);
                // 出限定六星
                const newKeyLimited = `0|${gained + 1}`;
                nextDist.set(newKeyLimited, (nextDist.get(newKeyLimited) || 0) + prob * p6 * 0.5);
            }
        }
        dist = nextDist;
    }

    const results: { endPity: number, limitedGained: number, prob: number }[] = [];
    for (const [key, prob] of dist) {
        const [pity, gained] = key.split('|').map(Number);
        results.push({ endPity: pity, limitedGained: gained, prob });
    }
    return results;
}

function get6StarProb(pity: number): number {
    if (pity >= 80) return 1.0;
    if (pity >= 66) {
        return 0.008 + 0.05 * (pity - 65);
    }
    return 0.008;
}
