// 明日方舟：終末地 — 抽卡機率引擎
//
// 規則（2026/10 現行「特許尋訪」）：
//   6★ 基礎 0.8%，6★ 中當期 UP 佔 50%
//   連續 65 抽沒 6★ → 第 66 抽起每抽 +5 個百分點；第 80 抽必 6★（小保底，跨池繼承）
//   本期第 120 抽若還沒拿到 UP → 該抽必為 UP 6★（每期一次、不繼承、抽到 UP 即失效）
//   本期累計 30 抽  → 送同池 10 抽「加急招募」（只吃基礎機率、不計保底／不計累計次數）
//   本期累計 60 抽  → 【尋訪情報書】→ 下一期特許尋訪專屬十連（計入下期保底）
//   本期每 240 抽   → 當期 UP 信物 ×1（可重複）
//
// 演算法：
//   1. 先算單一卡池的「結局分布」表：這一池花幾抽 (cost) → 收池時的保底水位 (endPity)
//      → 有沒有拿到情報書 (ticket)，以及機率。
//   2. 再對多卡池做 DP：狀態 = (剩餘預算, 保底水位)，逐池推進。
//      情報書只能用在「緊接著的下一期」，若下一期被跳過就作廢。
//
// 最佳化重點：
//   * 單池 DP 用平坦陣列 + 提前截斷（存活質量 < 1e-13 就停，誤差遠小於顯示精度）。
//   * 多池 DP 只走「有質量的狀態」（稀疏清單），不做 O(R×P) 全掃。
//   * 結局表依 (目標張數, 有效門檻, 起始水位) 快取；門檻沒變就不重算。

#include <emscripten.h>
#include <cmath>
#include <cstring>
#include <vector>
#include <cstdint>
#include <algorithm>

using namespace std;

// ---------------------------------------------------------------- 規則常數
static const double BASE6 = 0.008;
static const double UP_SHARE = 0.5;
static const int PITY_MAX = 80;          // 水位 0..79，第 80 抽必中
static const int SOFT_START = 66;        // 第 66 抽起爬坡
static const double SOFT_STEP = 0.05;
static const int GUARANTEE_120 = 120;
static const int MILESTONE_30 = 30;
static const int MILESTONE_60 = 60;
static const int MILESTONE_240 = 240;
static const int FREE_TEN = 10;
static const int MAX_BANNERS = 8;
static const int MAX_TARGET = 6;
static const int MAX_T = 20000;          // 安全上限（正常不會走到）

// 截斷門檻：低於此值的機率視為 0（誤差 < 1e-12，遠小於顯示精度）
static const double ACTIVE_EPS = 1e-13;  // 單池 DP 的存活質量
static const double ENTRY_EPS = 1e-14;   // 結局表的單筆機率

// ---------------------------------------------------------------- 全域狀態
static double P6[PITY_MAX];              // P6[p] = 水位 p 時，下一抽中 6★ 的機率
static double BINOM10[FREE_TEN + 1];     // 免費十連抽到 0..10 張 UP
static int gTargets[MAX_BANNERS] = { 0 };
static int gCount = 5;
static int gThreshold = 47;
static int gCurrentBanner = 0;

// 除錯用計數器（不影響結果）
static long long gStatStates = 0;
static long long gStatOps = 0;
static long long gStatTables = 0;

// ---------------------------------------------------------------- 結局表
struct Table {
    vector<int> cost;        // 這一池花了幾抽（遞增）
    vector<uint8_t> endPity; // 收池時的保底水位
    vector<uint8_t> ticket;  // 是否拿到情報書（cost >= 60）
    vector<double> prob;
    vector<double> cdf;      // cdf[c] = P(cost <= c)；只有最後一期會用到，惰性建立
};

// 建立 cost 累積分布（給「最後一期」用：只要知道達標機率，不需要收池水位）
static void buildCdf(Table& t) {
    if (!t.cdf.empty() || t.cost.empty()) return;
    const int maxC = t.cost.back();
    t.cdf.assign((size_t)maxC + 1, 0.0);
    size_t k = 0;
    const size_t n = t.cost.size();
    for (int c = 0; c <= maxC; ++c) {
        while (k < n && t.cost[k] == c) { t.cdf[c] += t.prob[k]; ++k; }
        if (c > 0) t.cdf[c] += t.cdf[c - 1];
    }
}

static vector<Table> gTables;
static vector<long long> gTableKeys;

static inline long long tableKey(int target, int effThr, int startPity) {
    return (((long long)target * 128 + effThr) * 128) + startPity;
}

static void initConstants() {
    static bool done = false;
    if (done) return;
    for (int p = 0; p < PITY_MAX; ++p) {
        int n = p + 1;
        double v = BASE6;
        if (n >= PITY_MAX) v = 1.0;
        else if (n >= SOFT_START) v = BASE6 + SOFT_STEP * (n - (SOFT_START - 1));
        P6[p] = (v > 1.0) ? 1.0 : v;
    }
    const double q = BASE6 * UP_SHARE;
    double c = 1.0;
    for (int k = 0; k <= FREE_TEN; ++k) {
        if (k > 0) c = c * (FREE_TEN - k + 1) / k;
        BINOM10[k] = c * pow(q, k) * pow(1.0 - q, FREE_TEN - k);
    }
    done = true;
}

// 單池的結局分布。thr >= 60 代表「達標就收手」（不續抽到 60）。
static void buildTable(int target, int startPity, int thr, Table& out) {
    const int C = target;
    const int S = PITY_MAX * (C + 1) * 2;
    auto idx = [&](int p, int c, int h) { return (p * (C + 1) + c) * 2 + h; };

    vector<double> cur(S, 0.0), nxt(S, 0.0);
    cur[idx(startPity, 0, 0)] = 1.0;

    const bool keepMode = (thr < MILESTONE_60);

    out.cost.clear(); out.endPity.clear(); out.ticket.clear(); out.prob.clear();

    for (int t = 0;; ++t) {
        // ---- 里程碑 ----
        if (t == MILESTONE_30) {
            fill(nxt.begin(), nxt.end(), 0.0);
            for (int p = 0; p < PITY_MAX; ++p) {
                for (int c = 0; c <= C; ++c) {
                    for (int h = 0; h < 2; ++h) {
                        const double w = cur[idx(p, c, h)];
                        if (w == 0.0) continue;
                        for (int k = 0; k <= FREE_TEN; ++k) {
                            const double pk = BINOM10[k];
                            if (pk < ENTRY_EPS) continue;
                            const int nc = (c + k > C) ? C : c + k;
                            const int nh = (k > 0) ? 1 : h;  // 免費十連抽到 UP 也算「已取得 UP」
                            nxt[idx(p, nc, nh)] += w * pk;
                        }
                    }
                }
            }
            cur.swap(nxt);
        }
        if (t > 0 && t % MILESTONE_240 == 0) {
            fill(nxt.begin(), nxt.end(), 0.0);
            for (int p = 0; p < PITY_MAX; ++p) {
                for (int c = 0; c <= C; ++c) {
                    for (int h = 0; h < 2; ++h) {
                        const double w = cur[idx(p, c, h)];
                        if (w == 0.0) continue;
                        const int nc = (c + 1 > C) ? C : c + 1;
                        nxt[idx(p, nc, h)] += w;
                    }
                }
            }
            cur.swap(nxt);
        }

        // ---- 收池判定 ----
        double active = 0.0;
        const bool keepGoingHere = keepMode && (t >= thr) && (t < MILESTONE_60);
        for (int p = 0; p < PITY_MAX; ++p) {
            for (int h = 0; h < 2; ++h) {
                double& w = cur[idx(p, C, h)];
                if (w == 0.0) continue;
                if (keepGoingHere) {
                    active += w;            // 目標已達標，但繼續補到 60 抽拿情報書
                } else {
                    if (w >= ENTRY_EPS) {
                        out.cost.push_back(t);
                        out.endPity.push_back((uint8_t)p);
                        out.ticket.push_back((uint8_t)(t >= MILESTONE_60 ? 1 : 0));
                        out.prob.push_back(w);
                    }
                    w = 0.0;
                }
            }
        }
        for (int p = 0; p < PITY_MAX; ++p) {
            for (int c = 0; c < C; ++c) {
                for (int h = 0; h < 2; ++h) active += cur[idx(p, c, h)];
            }
        }

        if (active <= ACTIVE_EPS || t >= MAX_T) break;

        // ---- 抽下一抽 ----
        const int nt = t + 1;
        const bool force120 = (nt == GUARANTEE_120);
        fill(nxt.begin(), nxt.end(), 0.0);
        for (int p = 0; p < PITY_MAX; ++p) {
            for (int c = 0; c <= C; ++c) {
                for (int h = 0; h < 2; ++h) {
                    const double w = cur[idx(p, c, h)];
                    if (w == 0.0) continue;
                    const bool guar = force120 && (h == 0);
                    const double p6 = guar ? 1.0 : P6[p];
                    const double plim = guar ? 1.0 : UP_SHARE;

                    if (p6 < 1.0) {
                        const int np = (p + 1 < PITY_MAX) ? p + 1 : PITY_MAX - 1;
                        nxt[idx(np, c, h)] += w * (1.0 - p6);
                    }
                    if (p6 > 0.0 && plim < 1.0) {
                        nxt[idx(0, c, h)] += w * p6 * (1.0 - plim);
                    }
                    if (p6 > 0.0 && plim > 0.0) {
                        const int nc = (c + 1 > C) ? C : c + 1;
                        nxt[idx(0, nc, 1)] += w * p6 * plim;
                    }
                }
            }
        }
        cur.swap(nxt);
    }
}

static Table& getTable(int target, int startPity, int thr) {
    const int effThr = (thr >= MILESTONE_60) ? MILESTONE_60 : thr;
    const long long key = tableKey(target, effThr, startPity);
    for (size_t i = 0; i < gTableKeys.size(); ++i) {
        if (gTableKeys[i] == key) return gTables[i];
    }
    gTables.push_back(Table());
    gTableKeys.push_back(key);
    buildTable(target, startPity, effThr, gTables.back());
    ++gStatTables;
    return gTables.back();
}

// ---------------------------------------------------------------- 多池 DP
//
// 狀態 = (保底水位 p, 剩餘預算 r)。為了讓記憶體連續（可向量化），
// 佈局用 [p][r]，r 這軸是連續的；每個 p 只追蹤「有質量的 r 區間」。

// 把「水位 p、剩餘預算 r ∈ [lo,hi]」的質量，依結局表推進到下一池。
static void applyRow(int p, int lo, int hi, int thr, int bonus, int maxR, int R,
    vector<double>& curW, vector<double>& nextW,
    bool* inNext, int* nRmin, int* nRmax, vector<int>& nextP) {
    const Table& T = getTable(gTargets[gCurrentBanner], p, thr);
    const size_t n = T.cost.size();
    const double* __restrict src = &curW[(size_t)p * R];

    for (size_t k = 0; k < n; ++k) {
        const int c = T.cost[k];
        if (c > hi) break;                     // cost 遞增
        const int r0 = (lo > c) ? lo : c;      // 買得起才走這條結局
        const int shift = -c + (T.ticket[k] ? bonus : 0);
        int r1 = hi;
        if (r1 + shift > maxR) r1 = maxR - shift;
        if (r0 > r1) continue;

        const int e = T.endPity[k];
        double* __restrict dst = &nextW[(size_t)e * R + shift];
        const double q = T.prob[k];
        for (int r = r0; r <= r1; ++r) dst[r] += src[r] * q;   // 連續 SAXPY

        if (!inNext[e]) { inNext[e] = true; nextP.push_back(e); }
        if (r0 + shift < nRmin[e]) nRmin[e] = r0 + shift;
        if (r1 + shift > nRmax[e]) nRmax[e] = r1 + shift;
        gStatOps += (r1 - r0 + 1);
    }
}

// 某一期「保證度」成本：從水位 0（最壞情況）出發，累積機率達 1-1e-12 所需的抽數。
// 用途：預算超過所有期數的總和時，直接回 1，不必跑 DP。
static int satCostFor(int target) {
    int best = 0;
    for (int mode = 0; mode < 2; ++mode) {
        const int thr = (mode == 0) ? gThreshold : MILESTONE_60;
        Table& t = getTable(target, 0, thr);
        double acc = 0.0;
        int cost = 0;
        for (size_t k = 0; k < t.cost.size(); ++k) {
            acc += t.prob[k];
            cost = t.cost[k];
            if (acc >= 1.0 - 1e-12) break;
        }
        if (cost > best) best = cost;
    }
    return best;
}

static double solve(int startPity, int budget) {
    int lastIdx = -1, nb = 0;
    for (int i = 0; i < gCount; ++i) {
        if (gTargets[i] > 0) { lastIdx = i; ++nb; }
    }
    if (lastIdx < 0) return 1.0;

    // 快速通關：若預算足以負擔每一期「1-1e-12 分位」的抽數，結果就是 1（誤差 < nb*1e-12）。
    {
        long long need = 0;
        for (int i = 0; i <= lastIdx; ++i) {
            if (gTargets[i] > 0) need += satCostFor(gTargets[i]);
        }
        if (budget >= need) return 1.0;
    }

    const int maxR = budget + FREE_TEN * nb;      // 剩餘預算上限（含情報書回饋）
    const int R = maxR + 1;

    vector<double> curW((size_t)PITY_MAX * R, 0.0), nextW((size_t)PITY_MAX * R, 0.0);
    int rmin[PITY_MAX], rmax[PITY_MAX];
    int nRmin[PITY_MAX], nRmax[PITY_MAX];
    bool inNext[PITY_MAX] = { false };
    vector<int> curP, nextP;
    curP.reserve(PITY_MAX); nextP.reserve(PITY_MAX);

    for (int i = 0; i < PITY_MAX; ++i) { rmin[i] = R; rmax[i] = -1; nRmin[i] = R; nRmax[i] = -1; }

    curW[(size_t)startPity * R + budget] = 1.0;
    rmin[startPity] = rmax[startPity] = budget;
    curP.push_back(startPity);

    for (int i = 0; i <= lastIdx; ++i) {
        const int target = gTargets[i];
        if (target == 0) continue;
        gCurrentBanner = i;

        const bool isLast = (i == lastIdx);
        const bool nextActive = (!isLast) && (i + 1 < gCount) && (gTargets[i + 1] > 0);

        // ---- 最後一期：不需要「收池水位」，只要「r 抽內能否達標」的機率 → O(狀態數) ----
        if (isLast) {
            double s = 0.0;
            for (int p : curP) {
                const int lo = rmin[p], hi = rmax[p];
                if (lo > hi) continue;
                Table& T = getTable(target, p, MILESTONE_60);
                buildCdf(T);
                const double* row = &curW[(size_t)p * R];
                const int cdfMax = (int)T.cdf.size() - 1;
                int r = lo;
                for (; r <= hi && r <= cdfMax; ++r) {
                    const double w = row[r];
                    if (w != 0.0) s += w * T.cdf[r];
                }
                if (r <= hi) {
                    const double tail = (cdfMax >= 0) ? T.cdf[cdfMax] : 0.0;
                    for (; r <= hi; ++r) {
                        const double w = row[r];
                        if (w != 0.0) s += w * tail;
                    }
                }
                ++gStatStates;
            }
            return (s > 1.0) ? 1.0 : s;
        }

        fill(nextW.begin(), nextW.end(), 0.0);
        for (int p = 0; p < PITY_MAX; ++p) { nRmin[p] = R; nRmax[p] = -1; inNext[p] = false; }
        nextP.clear();
        const int bonus = nextActive ? FREE_TEN : 0;

        for (int p : curP) {
            const int lo = rmin[p], hi = rmax[p];
            if (lo > hi) continue;
            ++gStatStates;

            // 低預算（r < 60）買不起「補到 60」→ 達標即停；高預算才用策略門檻的表。
            const int split = (hi < MILESTONE_60) ? hi : (MILESTONE_60 - 1);
            if (lo <= split) applyRow(p, lo, split, MILESTONE_60, bonus, maxR, R, curW, nextW, inNext, nRmin, nRmax, nextP);
            if (hi >= MILESTONE_60) applyRow(p, (lo > MILESTONE_60 ? lo : MILESTONE_60), hi, gThreshold, bonus, maxR, R, curW, nextW, inNext, nRmin, nRmax, nextP);
        }

        if (nextP.empty()) return 0.0;

        // 換手（舊 curW 直接整個清掉）
        curW.swap(nextW);
        curP.clear();
        for (int p : nextP) {
            rmin[p] = nRmin[p];
            rmax[p] = nRmax[p];
            curP.push_back(p);
        }
    }

    double s = 0.0;
    for (int p : curP) {
        const double* row = &curW[(size_t)p * R];
        for (int r = rmin[p]; r <= rmax[p]; ++r) s += row[r];
    }
    return (s > 1.0) ? 1.0 : s;
}

// ---------------------------------------------------------------- 對外 API
extern "C" {

EMSCRIPTEN_KEEPALIVE
void gachaInit() {
    initConstants();
}

EMSCRIPTEN_KEEPALIVE
int setTarget(int index, int value) {
    if (index < 0 || index >= MAX_BANNERS) return -1;
    if (value < 0) value = 0;
    if (value > MAX_TARGET) value = MAX_TARGET;
    gTargets[index] = value;
    return gTargets[index];
}

EMSCRIPTEN_KEEPALIVE
void setCount(int count) {
    if (count < 1) count = 1;
    if (count > MAX_BANNERS) count = MAX_BANNERS;
    gCount = count;
}

EMSCRIPTEN_KEEPALIVE
void setThreshold(int threshold) {
    if (threshold < 0) threshold = 0;
    if (threshold > MILESTONE_60) threshold = MILESTONE_60;
    gThreshold = threshold;
    gTables.clear();          // 門檻變了 → 續抽表全部作廢
    gTableKeys.clear();
}

EMSCRIPTEN_KEEPALIVE
double calculate(int startPity, int budget) {
    initConstants();
    if (startPity < 0) startPity = 0;
    if (startPity >= PITY_MAX) startPity = PITY_MAX - 1;
    if (budget < 0) budget = 0;
    if (budget > 200000) budget = 200000;
    return solve(startPity, budget);
}

// ---- 單期統計（圖表用）：達標所需抽數的分布 ----
// thr 預設傳 60（達標即停，不做情報書續抽），才是玩家真正「要幾抽」的分布。
EMSCRIPTEN_KEEPALIVE
double bannerMean(int target, int startPity, int thr) {
    initConstants();
    if (target <= 0) return 0.0;
    if (target > MAX_TARGET) target = MAX_TARGET;
    if (startPity < 0) startPity = 0;
    if (startPity >= PITY_MAX) startPity = PITY_MAX - 1;
    Table& t = getTable(target, startPity, thr);
    double many = 0.0, mass = 0.0;
    for (size_t k = 0; k < t.cost.size(); ++k) {
        many += t.cost[k] * t.prob[k];
        mass += t.prob[k];
    }
    return (mass > 0.0) ? (many / mass) : 0.0;
}

EMSCRIPTEN_KEEPALIVE
int bannerQuantile(int target, int startPity, int thr, double q) {
    initConstants();
    if (target <= 0) return 0;
    if (target > MAX_TARGET) target = MAX_TARGET;
    if (startPity < 0) startPity = 0;
    if (startPity >= PITY_MAX) startPity = PITY_MAX - 1;
    if (q <= 0.0) q = 0.0;
    if (q >= 1.0) q = 1.0;
    Table& t = getTable(target, startPity, thr);
    buildCdf(t);
    if (t.cdf.empty()) return 0;
    for (size_t c = 0; c < t.cdf.size(); ++c) {
        if (t.cdf[c] >= q) return (int)c;
    }
    return (int)t.cdf.size() - 1;
}

EMSCRIPTEN_KEEPALIVE
double calculateSingle(int target, int startPity, int budget) {
    initConstants();
    if (target < 0) target = 0;
    if (target > MAX_TARGET) target = MAX_TARGET;
    if (startPity < 0) startPity = 0;
    if (startPity >= PITY_MAX) startPity = PITY_MAX - 1;
    if (budget < 0) budget = 0;
    for (int i = 0; i < MAX_BANNERS; ++i) gTargets[i] = 0;
    gTargets[0] = target;
    gCount = 1;
    return solve(startPity, budget);
}

EMSCRIPTEN_KEEPALIVE
double statGet(int which) {
    switch (which) {
    case 0: return (double)gStatStates;
    case 1: return (double)gStatOps;
    case 2: return (double)gStatTables;
    default: return 0.0;
    }
}

EMSCRIPTEN_KEEPALIVE
void statReset() { gStatStates = gStatOps = gStatTables = 0; }

} // extern "C"
