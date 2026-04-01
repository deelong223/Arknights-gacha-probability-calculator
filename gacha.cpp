#include <emscripten.h>
#include <cmath>
#include <vector>
#include <algorithm>
#include <map>
#include <string>

using namespace std;

const double EPS = 1e-12;  // 機率閥值

// 二項式係數計算
double binomial(int n, double p, int k) {
    double coeff = 1.0;
    for (int i = 1; i <= k; ++i) {
        coeff = coeff * (n - i + 1) / i;
    }
    return coeff * pow(p, k) * pow(1 - p, n - k);
}

struct Transition {
    int pulls;
    int endPity;
    double prob;
    bool gotExtra;
};

static map<string, vector<Transition>> transCache;

vector<Transition> getBannerTransition(int initialPity, int target, bool isLast) {
    string key = to_string(initialPity) + "_" + to_string(target) + "_" + (isLast ? "1" : "0");
    auto it = transCache.find(key);
    if (it != transCache.end()) return it->second;

    const int PITY_MAX = 80;
    const int COPIES = target;
    const int STATE_SIZE = PITY_MAX * (COPIES + 1) * 2;

    auto idx = [COPIES](int p, int c, int h) -> int {
        return p * (COPIES + 1) * 2 + c * 2 + h;
        };

    vector<double> curr(STATE_SIZE, 0.0);
    curr[idx(initialPity, 0, 0)] = 1.0;

    vector<double> binomProbs(11);
    for (int k = 0; k <= 10; ++k) binomProbs[k] = binomial(10, 0.004, k);

    int pulls = 0;
    const int MAX_PULLS = 5000;

    while (true) {
        // 30抽里程碑
        if (pulls == 30) {
            vector<double> next(STATE_SIZE, 0.0);
            for (int p = 0; p < PITY_MAX; ++p) {
                for (int c = 0; c <= COPIES; ++c) {
                    for (int h = 0; h < 2; ++h) {
                        double prob = curr[idx(p, c, h)];
                        if (prob == 0.0) continue;
                        for (int k = 0; k <= 10; ++k) {
                            double pk = binomProbs[k];
                            if (pk < EPS) continue;
                            int nc = min(COPIES, c + k);
                            next[idx(p, nc, h)] += prob * pk;
                        }
                    }
                }
            }
            curr.swap(next);
        }

        // 收集結果並檢查活躍狀態
        bool active = false;
        for (int p = 0; p < PITY_MAX; ++p) {
            for (int c = 0; c <= COPIES; ++c) {
                for (int h = 0; h < 2; ++h) {
                    double prob = curr[idx(p, c, h)];
                    if (prob == 0.0) continue;
                    bool reached = c >= COPIES;
                    bool shouldContinue = reached && pulls >= 47 && pulls < 60 && !isLast;
                    if (reached && !shouldContinue) {
                        Transition t;
                        t.pulls = pulls;
                        t.endPity = p;
                        t.prob = prob;
                        t.gotExtra = pulls >= 60;
                        transCache[key].push_back(t);
                        curr[idx(p, c, h)] = 0.0;
                    }
                    else {
                        active = true;
                    }
                }
            }
        }
        if (!active || pulls >= MAX_PULLS) break;

        // 一次抽卡
        ++pulls;
        vector<double> next(STATE_SIZE, 0.0);
        for (int p = 0; p < PITY_MAX; ++p) {
            for (int c = 0; c <= COPIES; ++c) {
                for (int h = 0; h < 2; ++h) {
                    double prob = curr[idx(p, c, h)];
                    if (prob == 0.0) continue;

                    double p6 = 0.008;
                    double pLimGiven6 = 0.5;

                    if (pulls == 120 && h == 0) {
                        p6 = 1.0;
                        pLimGiven6 = 1.0;
                    }
                    else {
                        int n = p + 1;
                        if (n >= 66 && n <= 79) {
                            p6 = 0.008 + 0.05 * (n - 65);
                        }
                        else if (n >= 80) {
                            p6 = 1.0;
                        }
                    }

                    // 不出六星
                    if (p6 < 1.0) {
                        int np = min(79, p + 1);
                        int nc = c;
                        if (pulls == 240) nc = min(COPIES, nc + 1);
                        next[idx(np, nc, h)] += prob * (1 - p6);
                    }
                    // 出非限定六星
                    if (p6 > 0.0 && pLimGiven6 < 1.0) {
                        int np = 0;
                        int nc = c;
                        if (pulls == 240) nc = min(COPIES, nc + 1);
                        next[idx(np, nc, h)] += prob * p6 * (1 - pLimGiven6);
                    }
                    // 出限定六星
                    if (p6 > 0.0 && pLimGiven6 > 0.0) {
                        int np = 0;
                        int nc = min(COPIES, c + 1);
                        if (pulls == 240) nc = min(COPIES, nc + 1);
                        next[idx(np, nc, 1)] += prob * p6 * pLimGiven6;
                    }
                }
            }
        }
        curr.swap(next);
    }

    return transCache[key];
}

double calculateSingleBanner(int target, int initialPity, int budget) {
    const int PITY_MAX = 80;
    const int COPIES = target;
    const int STATE_SIZE = PITY_MAX * (COPIES + 1) * 2;

    auto idx = [COPIES](int p, int c, int h) -> int {
        return p * (COPIES + 1) * 2 + c * 2 + h;
        };

    vector<double> dp(STATE_SIZE, 0.0);
    dp[idx(initialPity, 0, 0)] = 1.0;

    vector<double> binomProbs(11);
    for (int k = 0; k <= 10; ++k) binomProbs[k] = binomial(10, 0.004, k);

    int remainingBudget = budget;
    int pulls = 0;
    double success = 0.0;

    while (remainingBudget > 0) {
        // 30抽里程碑
        if (pulls == 30) {
            vector<double> next(STATE_SIZE, 0.0);
            for (int p = 0; p < PITY_MAX; ++p) {
                for (int c = 0; c < COPIES; ++c) {
                    for (int h = 0; h < 2; ++h) {
                        double prob = dp[idx(p, c, h)];
                        if (prob == 0.0) continue;
                        for (int k = 0; k <= 10; ++k) {
                            double pk = binomProbs[k];
                            if (pk < EPS) continue;
                            int nc = min(COPIES, c + k);
                            next[idx(p, nc, h)] += prob * pk;
                        }
                    }
                }
            }
            // 保留已達標狀態
            for (int p = 0; p < PITY_MAX; ++p) {
                for (int c = COPIES; c <= COPIES; ++c) {
                    for (int h = 0; h < 2; ++h) {
                        double prob = dp[idx(p, c, h)];
                        if (prob > 0.0) {
                            next[idx(p, c, h)] += prob;
                        }
                    }
                }
            }
            dp.swap(next);
        }

        // 將已達標狀態移出到 success
        for (int p = 0; p < PITY_MAX; ++p) {
            for (int c = COPIES; c <= COPIES; ++c) {
                for (int h = 0; h < 2; ++h) {
                    double prob = dp[idx(p, c, h)];
                    if (prob > 0.0) {
                        success += prob;
                        dp[idx(p, c, h)] = 0.0;
                    }
                }
            }
        }

        // 檢查是否還有活躍狀態
        bool active = false;
        for (int i = 0; i < STATE_SIZE; ++i) {
            if (dp[i] > EPS) {
                active = true;
                break;
            }
        }
        if (!active) break;

        // 消耗預算
        remainingBudget--;
        pulls++;

        vector<double> next(STATE_SIZE, 0.0);
        for (int p = 0; p < PITY_MAX; ++p) {
            for (int c = 0; c < COPIES; ++c) {
                for (int h = 0; h < 2; ++h) {
                    double prob = dp[idx(p, c, h)];
                    if (prob == 0.0) continue;

                    double p6 = 0.008;
                    double pLimGiven6 = 0.5;

                    if (pulls == 120 && h == 0) {
                        p6 = 1.0;
                        pLimGiven6 = 1.0;
                    }
                    else {
                        int n = p + 1;
                        if (n >= 66 && n <= 79) {
                            p6 = 0.008 + 0.05 * (n - 65);
                        }
                        else if (n >= 80) {
                            p6 = 1.0;
                        }
                    }

                    // 不出六星
                    if (p6 < 1.0) {
                        int np = min(79, p + 1);
                        int nc = c;
                        if (pulls == 240) nc = min(COPIES, nc + 1);
                        next[idx(np, nc, h)] += prob * (1 - p6);
                    }
                    // 出非限定六星
                    if (p6 > 0.0 && pLimGiven6 < 1.0) {
                        int np = 0;
                        int nc = c;
                        if (pulls == 240) nc = min(COPIES, nc + 1);
                        next[idx(np, nc, h)] += prob * p6 * (1 - pLimGiven6);
                    }
                    // 出限定六星
                    if (p6 > 0.0 && pLimGiven6 > 0.0) {
                        int np = 0;
                        int nc = min(COPIES, c + 1);
                        if (pulls == 240) nc = min(COPIES, nc + 1);
                        next[idx(np, nc, 1)] += prob * p6 * pLimGiven6;
                    }
                }
            }
        }
        dp.swap(next);
    }

    // 最後一次將剩餘已達標狀態加入 success
    for (int p = 0; p < PITY_MAX; ++p) {
        for (int c = COPIES; c <= COPIES; ++c) {
            for (int h = 0; h < 2; ++h) {
                success += dp[idx(p, c, h)];
            }
        }
    }

    return min(1.0, success);
}

double calculateMultiBanner(const vector<int>& targets, int initialPity, int initialBudget) {
    // 偵測單卡池
    vector<int> nonZeroIndices;
    for (size_t i = 0; i < targets.size(); ++i) {
        if (targets[i] > 0) nonZeroIndices.push_back(i);
    }

    if (nonZeroIndices.size() == 1) {
        int target = targets[nonZeroIndices[0]];
        return calculateSingleBanner(target, initialPity, initialBudget);
    }

    // 多池邏輯
    int lastBannerIndex = -1;
    for (size_t i = 0; i < targets.size(); ++i) {
        if (targets[i] > 0) lastBannerIndex = i;
    }
    if (lastBannerIndex == -1) return 1.0;

    int maxRemaining = initialBudget + 10 * (int)targets.size();
    const int PITY_STATES = 80;
    int stateSize = (maxRemaining + 1) * PITY_STATES;

    vector<double> dp(stateSize, 0.0);
    dp[initialBudget * PITY_STATES + initialPity] = 1.0;

    for (int i = 0; i <= lastBannerIndex; ++i) {
        int target = targets[i];
        bool isLast = (i == lastBannerIndex);
        vector<double> nextDp(stateSize, 0.0);

        if (target == 0) {
            for (int r = 0; r <= maxRemaining; ++r) {
                for (int p = 0; p < PITY_STATES; ++p) {
                    double prob = dp[r * PITY_STATES + p];
                    if (prob > EPS) {
                        nextDp[r * PITY_STATES + p] += prob;
                    }
                }
            }
            dp.swap(nextDp);
            continue;
        }

        // 預計算轉移
        vector<vector<Transition>> transitionsForPity(PITY_STATES);
        for (int pityIn = 0; pityIn < PITY_STATES; ++pityIn) {
            transitionsForPity[pityIn] = getBannerTransition(pityIn, target, isLast);
        }

        for (int r = 0; r <= maxRemaining; ++r) {
            for (int p = 0; p < PITY_STATES; ++p) {
                double prob = dp[r * PITY_STATES + p];
                if (prob < EPS) continue;

                const auto& transitions = transitionsForPity[p];
                for (const auto& trans : transitions) {
                    int pulls = trans.pulls;
                    int endPity = trans.endPity;
                    double transProb = trans.prob;
                    bool gotExtra = trans.gotExtra;

                    if (r < pulls) continue;
                    int newRemaining = r - pulls + (gotExtra ? 10 : 0);
                    if (newRemaining > maxRemaining) newRemaining = maxRemaining;
                    double newProb = prob * transProb;
                    if (newProb < EPS) continue;
                    nextDp[newRemaining * PITY_STATES + endPity] += newProb;
                }
            }
        }
        dp.swap(nextDp);
    }

    double successProb = 0.0;
    for (size_t i = 0; i < dp.size(); ++i) {
        successProb += dp[i];
    }
    return min(1.0, successProb);
}

// 導出給 JavaScript 調用的函數
extern "C" {

    EMSCRIPTEN_KEEPALIVE
        double calculate(int* targets, int targetCount, int initialPity, int initialBudget) {
        vector<int> targetsVec(targets, targets + targetCount);
        return calculateMultiBanner(targetsVec, initialPity, initialBudget);
    }

    EMSCRIPTEN_KEEPALIVE
        double calculateSingle(int target, int initialPity, int budget) {
        return calculateSingleBanner(target, initialPity, budget);
    }

}