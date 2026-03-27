// gacha-dp.ts

/**
 * 抽卡規則常數
 */
const BASE_RATE = 0.008;
const PITY_START = 66;      // 開始增加機率的保底數
const PITY_END = 80;        // 必出六星的保底數
const LIMITED_RATE = 0.5;   // 出六星時為限定的概率
const GUARANTEE_120 = 120;   // 120抽必出限定
const FREE_10_PULL = 30;     // 30抽送10連
const EXTRA_60 = 60;         // 60抽送10下一池
const GUARANTEE_240 = 240;   // 240抽直接送一個限定

/**
 * 計算給定 pity 下的出六星概率
 */
function get6StarProb(pity: number): number {
    if (pity >= PITY_END) return 1.0;
    if (pity >= PITY_START && pity <= PITY_END - 1) {
        return BASE_RATE + 0.05 * (pity - (PITY_START - 1));
    }
    return BASE_RATE;
}

/**
 * 單池轉移：給定目標數量、進入時的 pity 和 extra（0或10），
 * 返回一個 Map，key 為 "pity_out|extra_out|cost"，value 為概率。
 * cost 是該池消耗的預算（不包含 extra 消耗）。
 * maxBudget 用於限制狀態空間，可設為初始預算。
 */
function computeBannerTransition(
    target: number,
    pityIn: number,
    extraIn: number,
    maxBudget: number
): Map<string, number> {
    // 狀態編碼：pulls, pity, copies, hasLimited, usedExtra, usedBudget
    // 使用 Map 存儲當前分佈，鍵為字符串
    let cur = new Map<string, number>();
    const startKey = `0|${pityIn}|0|false|0|0`;
    cur.set(startKey, 1.0);

    // 最終輸出分佈
    const result = new Map<string, number>();

    // 最大抽數限制（防止無限循環）
    const maxPulls = maxBudget + 200; // 預算 + 可能的免費抽數

    // 迭代直到沒有活躍狀態
    while (cur.size > 0) {
        const next = new Map<string, number>();

        for (const [key, prob] of cur) {
            const parts = key.split('|');
            const pulls = parseInt(parts[0]);
            const pity = parseInt(parts[1]);
            const copies = parseInt(parts[2]);
            const hasLimited = parts[3] === 'true';
            const usedExtra = parseInt(parts[4]);
            const usedBudget = parseInt(parts[5]);

            // 停止條件：達到目標數量，且不需要為了 60 抽繼續
            const reachedTarget = copies >= target;
            // 如果已達到目標，且 (抽數 < 9 或 抽數 >= 60 或 沒有後續池)
            // 這裡沒有後續池的信息，我們會在外部處理，單池內假設總是要考慮繼續到60？
            // 實際應該由外部傳入「是否有後續池」標誌，但此處先簡單認為：只要達到目標就停止
            // 注意：外部調用時，對於最後一個池，不會有繼續到60的需求，因此這個標誌需要由外部給定
            // 我們稍後會改進，將「是否有後續池」作為參數傳入。
            // 先簡化：達到目標就停止。
            if (reachedTarget) {
                const extraOut = pulls >= EXTRA_60 ? 10 : 0;
                const outKey = `${pity}|${extraOut}|${usedBudget}`;
                const old = result.get(outKey) || 0;
                result.set(outKey, old + prob);
                continue;
            }

            // 如果抽數過大或預算已超，停止（失敗路徑不加入結果）
            if (pulls >= maxPulls || usedBudget > maxBudget) {
                continue; // 丟棄該路徑（無法成功）
            }

            // 準備一次抽卡
            let resourceOk = true;
            let newUsedExtra = usedExtra;
            let newUsedBudget = usedBudget;
            // 優先消耗 extra
            if (newUsedExtra < extraIn) {
                newUsedExtra++;
            } else if (newUsedBudget < maxBudget) {
                newUsedBudget++;
            } else {
                resourceOk = false; // 預算不足，路徑失敗
            }
            if (!resourceOk) continue;

            // 抽卡結果分支
            const newPulls = pulls + 1;
            const newPity = pity + 1;

            // 計算出六星概率
            let is6Star: boolean;
            let isLimited: boolean;

            // 120抽保底
            if (newPulls === GUARANTEE_120 && !hasLimited) {
                is6Star = true;
                isLimited = true;
            } else {
                const prob6 = get6StarProb(newPity);
                // 這裡需要離散化，但我們要精確概率，所以分成三種情況：
                // 不出六星、出非限定、出限定
                // 我們將概率分配到不同的後續狀態
                // 為了保持精確，我們不隨機，而是計算三個分支的概率

                // 不出六星的概率
                const no6Prob = 1 - prob6;
                if (no6Prob > 0) {
                    const nextKey = `${newPulls}|${newPity}|${copies}|${hasLimited}|${newUsedExtra}|${newUsedBudget}`;
                    next.set(nextKey, (next.get(nextKey) || 0) + prob * no6Prob);
                }

                // 出六星且限定的概率
                const limitedProb = prob6 * LIMITED_RATE;
                if (limitedProb > 0) {
                    const newCopies = copies + 1;
                    const newHasLimited = true;
                    const newPityAfter = 0; // 重置 pity
                    const nextKey = `${newPulls}|${newPityAfter}|${newCopies}|${newHasLimited}|${newUsedExtra}|${newUsedBudget}`;
                    next.set(nextKey, (next.get(nextKey) || 0) + prob * limitedProb);
                }

                // 出六星非限定的概率
                const nonLimitedProb = prob6 * (1 - LIMITED_RATE);
                if (nonLimitedProb > 0) {
                    const newHasLimited = hasLimited; // 不變
                    const newPityAfter = 0;
                    const nextKey = `${newPulls}|${newPityAfter}|${copies}|${newHasLimited}|${newUsedExtra}|${newUsedBudget}`;
                    next.set(nextKey, (next.get(nextKey) || 0) + prob * nonLimitedProb);
                }

                continue; // 已經處理了分支，跳過後面的統一處理
            }

            // 如果是120保底的情況，直接處理
            if (is6Star && isLimited) {
                const newCopies = copies + 1;
                const newHasLimited = true;
                const newPityAfter = 0;
                const nextKey = `${newPulls}|${newPityAfter}|${newCopies}|${newHasLimited}|${newUsedExtra}|${newUsedBudget}`;
                next.set(nextKey, (next.get(nextKey) || 0) + prob);
                continue;
            }

            // 理論上不會到這裡，但保留
        }

        cur = next;
    }

    return result;
}

/**
 * 將單池轉移結果轉換為便於捲積的格式
 * 輸入是 computeBannerTransition 的輸出 Map
 * 返回一個數組，索引為 cost，值為另一個 Map：key "pity_out|extra_out" -> 概率
 */
function expandTransition(transMap: Map<string, number>): Map<number, Map<string, number>> {
    const result = new Map<number, Map<string, number>>();
    for (const [key, prob] of transMap) {
        const parts = key.split('|');
        const pity = parseInt(parts[0]);
        const extra = parseInt(parts[1]);
        const cost = parseInt(parts[2]);
        const stateKey = `${pity}|${extra}`;
        let costMap = result.get(cost);
        if (!costMap) {
            costMap = new Map();
            result.set(cost, costMap);
        }
        costMap.set(stateKey, (costMap.get(stateKey) || 0) + prob);
    }
    return result;
}

/**
 * 主函數：使用動態規劃 + 捲積計算多池成功率
 * @param targets 各池目標數量，0表示跳過該池
 * @param initialPity 初始保底
 * @param initialBudget 初始預算
 * @param maxBudgetForDP 用於限制狀態空間，建議設為 initialBudget
 */
export function calculateMultiBannerDP(
    targets: number[],
    initialPity: number,
    initialBudget: number,
    maxBudgetForDP: number = initialBudget
): number {
    // 找到最後一個有目標的池
    let lastBannerIndex = -1;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] > 0) lastBannerIndex = i;
    }
    if (lastBannerIndex === -1) return 1.0;

    // 預先計算每個池的轉移（對於每個可能的輸入狀態 (pity, extra)）
    // 注意：pity 範圍 0~80，extra 範圍 0,10
    // 為了簡化，我們只計算實際可能用到的輸入狀態
    const bannerTransitions: Array<Map<string, Map<number, Map<string, number>>>> = [];

    for (let idx = 0; idx <= lastBannerIndex; idx++) {
        const target = targets[idx];
        if (target === 0) {
            // 跳過的池，轉移是恆等映射，但 extra 會被丟棄
            // 為了方便，我們創建一個特殊標記
            bannerTransitions.push(new Map()); // 佔位
            continue;
        }

        // 對於每個可能的輸入狀態 (pity, extra) 預計算
        const transForBanner = new Map<string, Map<number, Map<string, number>>>();
        for (let pity = 0; pity <= 80; pity++) {
            for (const extra of [0, 10]) {
                const inputKey = `${pity}|${extra}`;
                const rawTrans = computeBannerTransition(target, pity, extra, maxBudgetForDP);
                const expanded = expandTransition(rawTrans);
                transForBanner.set(inputKey, expanded);
            }
        }
        bannerTransitions.push(transForBanner);
    }

    // DP 狀態：dp[pity][extra][budget] = 概率
    // 使用 Map 存儲，節省空間
    let dp = new Map<string, number>();
    const startKey = `${initialPity}|0|0`; // pity, extra, budget
    dp.set(startKey, 1.0);

    for (let idx = 0; idx <= lastBannerIndex; idx++) {
        const target = targets[idx];
        const transMap = bannerTransitions[idx];

        if (target === 0) {
            // 跳過池，extra 丟失，pity 不變，budget 不變
            const newDp = new Map<string, number>();
            for (const [key, prob] of dp) {
                const parts = key.split('|');
                const pity = parseInt(parts[0]);
                // const extra = parseInt(parts[1]); // 丟棄
                const budget = parseInt(parts[2]);
                const newKey = `${pity}|0|${budget}`; // extra 重置為 0
                newDp.set(newKey, (newDp.get(newKey) || 0) + prob);
            }
            dp = newDp;
            continue;
        }

        // 有目標的池，應用轉移
        const newDp = new Map<string, number>();
        for (const [key, prob] of dp) {
            const parts = key.split('|');
            const pityIn = parseInt(parts[0]);
            const extraIn = parseInt(parts[1]);
            const budgetIn = parseInt(parts[2]);

            const inputKey = `${pityIn}|${extraIn}`;
            const costMap = transMap.get(inputKey);
            if (!costMap) continue; // 沒有轉移（可能預算不足）

            for (const [cost, stateMap] of costMap) {
                const newBudget = budgetIn + cost;
                if (newBudget > initialBudget) continue; // 超出預算，不計入成功
                for (const [stateKey, stateProb] of stateMap) {
                    // stateKey 格式: "pity_out|extra_out"
                    const outParts = stateKey.split('|');
                    const pityOut = parseInt(outParts[0]);
                    const extraOut = parseInt(outParts[1]);
                    const newKey = `${pityOut}|${extraOut}|${newBudget}`;
                    newDp.set(newKey, (newDp.get(newKey) || 0) + prob * stateProb);
                }
            }
        }
        dp = newDp;
    }

    // 匯總所有最終狀態的概率（只要 budget <= initialBudget 即可，已經在上一步過濾）
    let successProb = 0;
    for (const prob of dp.values()) {
        successProb += prob;
    }
    return successProb;
}
