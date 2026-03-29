// gacha-dp-remaining.ts

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

    // DP: key = "freePulls|pity|budgetLeft", value = probability
    let dp = new Map<string, number>();
    dp.set(`0|${initialPity}|${initialBudget}`, 1.0);

    for (let i = 0; i <= lastBannerIndex; i++) {
        const target = targets[i];
        const isLast = i === lastBannerIndex;
        const nextDp = new Map<string, number>();

        if (target === 0) {
            // 跳過該池：免費抽數清零，保底不變，預算不變
            for (const [key, prob] of dp) {
                const parts = key.split('|');
                const pity = parseInt(parts[1]);
                const budget = parseInt(parts[2]);
                nextDp.set(`0|${pity}|${budget}`, (nextDp.get(`0|${pity}|${budget}`) || 0) + prob);
            }
            dp = nextDp;
            continue;
        }

        for (const [key, prob] of dp) {
            const parts = key.split('|');
            const freePulls = parseInt(parts[0]);
            const pityIn = parseInt(parts[1]);
            const budgetLeft = parseInt(parts[2]);

            const transitions = getBannerTransition(pityIn, target, isLast);
            
            for (const trans of transitions) {
                const { pulls, endPity, prob: transProb, gotExtra } = trans;
                
                // 優先使用免費抽
                let usedFree = Math.min(freePulls, pulls);
                let needBudget = pulls - usedFree;
                let newFree = freePulls - usedFree + (gotExtra ? 10 : 0);
                let newBudget = budgetLeft - needBudget;
                
                if (newBudget < 0) continue;
                
                const newKey = `${newFree}|${endPity}|${newBudget}`;
                nextDp.set(newKey, (nextDp.get(newKey) || 0) + prob * transProb);
            }
        }
        dp = nextDp;
    }

    let successProb = 0;
    for (const prob of dp.values()) {
        successProb += prob;
    }
    return Math.min(1.0, successProb);
}

interface Transition {
    pulls: number;      // 該池內消耗資源的總抽數（不含贈送）
    endPity: number;    // 結束時的保底
    prob: number;       // 機率
    gotExtra: boolean;  // 是否獲得10免費抽（pulls >= 60）
}

const transCache = new Map<string, Transition[]>();

function getBannerTransition(initialPity: number, target: number, isLast: boolean): Transition[] {
    const cacheKey = `${initialPity}_${target}_${isLast}`;
    if (transCache.has(cacheKey)) return transCache.get(cacheKey)!;

    const results: Transition[] = [];
    
    // 狀態: (pity, copies, hasLimited)
    // pity: 0~79
    // copies: 0~target
    // hasLimited: 0/1
    const stateSize = 80 * (target + 1) * 2;
    const idx = (p: number, c: number, h: number) => p * (target + 1) * 2 + c * 2 + h;
    
    let curr = new Float64Array(stateSize);
    curr[idx(initialPity, 0, 0)] = 1.0;
    
    let pulls = 0;  // 只計算消耗資源的抽數，贈送10連不增加此值
    
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
                    
                    // 120 抽保底（pulls 是消耗資源的抽數，贈送不計入）
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
    // 遞迴計算 10 次抽卡的所有可能結果
    // 簡化實現：使用 DP
    let dist = new Map<string, number>();
    dist.set(`${startPity}|0`, 1.0); // pity|limitedGained
    
    for (let step = 0; step < 10; step++) {
        const nextDist = new Map<string, number>();
        for (const [key, prob] of dist) {
            const parts = key.split('|');
            let pity = parseInt(parts[0]);
            let gained = parseInt(parts[1]);
            
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
            }
            // 出限定六星
            if (p6 > 0) {
                const newKey = `0|${gained + 1}`;
                nextDist.set(newKey, (nextDist.get(newKey) || 0) + prob * p6 * 0.5);
            }
        }
        dist = nextDist;
    }
    
    const results: { endPity: number, limitedGained: number, prob: number }[] = [];
    for (const [key, prob] of dist) {
        const parts = key.split('|');
        results.push({
            endPity: parseInt(parts[0]),
            limitedGained: parseInt(parts[1]),
            prob: prob
        });
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
