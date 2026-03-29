// gacha-dp-corrected.ts

/**
 * 计算多池抽卡成功率（动态规划，剩余总资源 + 保底）
 * @param targets 各池目标数量，0 表示跳过
 * @param initialPity 初始保底 (0~79)
 * @param initialBudget 初始预算（总可用抽数）
 * @returns 成功概率
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

    // 最大剩余资源：初始预算 + 每个池最多奖励10（保守估计）
    const maxRemaining = initialBudget + 10 * targets.length;
    let dp = new Map<string, number>();
    dp.set(`${initialBudget}|${initialPity}`, 1.0);

    for (let i = 0; i <= lastBannerIndex; i++) {
        const target = targets[i];
        const isLast = i === lastBannerIndex;
        const nextDp = new Map<string, number>();

        if (target === 0) {
            // 跳过该池：剩余资源不变，保底不变
            for (const [key, prob] of dp) {
                nextDp.set(key, (nextDp.get(key) || 0) + prob);
            }
            dp = nextDp;
            continue;
        }

        for (const [key, prob] of dp) {
            const [remaining, pityIn] = key.split('|').map(Number);
            const transitions = getBannerTransition(pityIn, target, isLast);
            for (const trans of transitions) {
                const { pulls, endPity, prob: transProb, gotExtra } = trans;
                if (remaining < pulls) continue; // 资源不足
                let newRemaining = remaining - pulls + (gotExtra ? 10 : 0);
                const newKey = `${newRemaining}|${endPity}`;
                nextDp.set(newKey, (nextDp.get(newKey) || 0) + prob * transProb);
            }
        }
        dp = nextDp;
    }

    let successProb = 0;
    for (const prob of dp.values()) successProb += prob;
    return Math.min(1.0, successProb);
}

// ---------- 单池精确转移（动态规划）----------
interface Transition {
    pulls: number;      // 该池内消耗的总抽数（不含赠送10连）
    endPity: number;
    prob: number;
    gotExtra: boolean;  // 是否获得奖励（pulls >= 60）
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

    // 状态: (pity, copies, hasLimited)
    const stateSize = 80 * (target + 1) * 2;
    const idx = (p: number, c: number, h: number) =>
        p * (target + 1) * 2 + c * 2 + h;

    let curr = new Float64Array(stateSize);
    curr[idx(initialPity, 0, 0)] = 1.0;

    let pulls = 0; // 只计算消耗资源的抽数，赠送10连不增加此值
    const MAX_PULLS = 5000; // 足够覆盖高预算场景

    while (true) {
        // 1. 处理30抽里程碑：赠送10连（不计入 pulls）
        if (pulls === 30) {
            let next = new Float64Array(stateSize);
            for (let p = 0; p < 80; p++) {
                for (let c = 0; c <= target; c++) {
                    for (let h = 0; h < 2; h++) {
                        const prob = curr[idx(p, c, h)];
                        if (prob === 0) continue;
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

        // 2. 检查终止条件
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
                        curr[idx(p, c, h)] = 0; // 移除已收集的状态
                    } else {
                        active = true;
                    }
                }
            }
        }
        if (!active || pulls >= MAX_PULLS) break;

        // 3. 进行一次正常抽卡（消耗资源）
        pulls++;
        let next = new Float64Array(stateSize);
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= target; c++) {
                for (let h = 0; h < 2; h++) {
                    const prob = curr[idx(p, c, h)];
                    if (prob === 0) continue;

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
 * 10连抽的结果分布（不消耗资源，不影响 pulls 计数）
 * 返回: { endPity, limitedGained, prob }[]
 */
function getTenPullDistribution(startPity: number, target: number): { endPity: number, limitedGained: number, prob: number }[] {
    let dist = new Map<string, number>();
    dist.set(`${startPity}|0`, 1.0);

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
            // 出六星（非限定和限定）
            if (p6 > 0) {
                // 非限定
                const newKeyNon = `0|${gained}`;
                nextDist.set(newKeyNon, (nextDist.get(newKeyNon) || 0) + prob * p6 * 0.5);
                // 限定
                const newKeyLim = `0|${gained + 1}`;
                nextDist.set(newKeyLim, (nextDist.get(newKeyLim) || 0) + prob * p6 * 0.5);
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
