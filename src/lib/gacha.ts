export function calculateMultiBanner(targets: number[], initialPity: number, initialBudget: number): number {
    let lastBannerIndex = -1;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] > 0) lastBannerIndex = i;
    }
    
    if (lastBannerIndex === -1) return 1.0;

    // P maps state_key (rem_pulls * 80 + pity) to probability
    let P = new Map<number, number>();
    
    // Initial state
    P.set(initialBudget * 80 + initialPity, 1.0);

    for (let i = 0; i <= lastBannerIndex; i++) {
        let target = targets[i];
        let is_last_banner = (i === lastBannerIndex);
        
        if (target === 0) {
            continue; // rem_pulls and pity remain unchanged
        }
        
        let new_P = new Map<number, number>();
        
        for (let [state_key, p_val] of P.entries()) {
            if (p_val <= 1e-7) continue;
            
            let rem = Math.floor(state_key / 80);
            let initial_pity = state_key % 80;
            
            let trans = getBannerTransition(initial_pity, target, is_last_banner);
            
            for (let t of trans) {
                let pulls = t.pullsInBanner;
                if (pulls <= rem) {
                    let end_pity = t.end_pity;
                    let prob = t.prob;
                    let earned_pulls = pulls >= 60 ? 10 : 0;
                    
                    let next_rem = rem - pulls + earned_pulls;
                    let next_key = next_rem * 80 + end_pity;
                    
                    let current_new_p = new_P.get(next_key) || 0;
                    new_P.set(next_key, current_new_p + p_val * prob);
                }
            }
        }
        P = new_P;
    }

    let total_success = 0;
    for (let p_val of P.values()) {
        total_success += p_val;
    }
    return total_success;
}

function binomial(n: number, p: number, k: number): number {
    let coeff = 1;
    for (let i = 1; i <= k; i++) {
        coeff = coeff * (n - i + 1) / i;
    }
    return coeff * Math.pow(p, k) * Math.pow(1 - p, n - k);
}

// Cache for getBannerTransition
const transCache = new Map<string, { pullsInBanner: number, end_pity: number, prob: number }[]>();

function getBannerTransition(initial_pity: number, target: number, is_last_banner: boolean) {
    const cacheKey = `${initial_pity}_${target}_${is_last_banner}`;
    if (transCache.has(cacheKey)) {
        return transCache.get(cacheKey)!;
    }

    let results: { pullsInBanner: number, end_pity: number, prob: number }[] = [];
    
    // curr_state[pity][copies][hasPulledLimited]
    // pity: 0 to 79
    // copies: 0 to target
    // hasPulledLimited: 0 or 1
    const STATE_SIZE = 80 * (target + 1) * 2;
    let curr_state = new Float64Array(STATE_SIZE);
    
    // Index function
    const idx = (p: number, c: number, h: number) => p * (target + 1) * 2 + c * 2 + h;
    
    curr_state[idx(initial_pity, 0, 0)] = 1.0;
    
    // Precompute binomial probabilities for 30-pull milestone
    const binomProbs = new Float64Array(11);
    for (let k = 0; k <= 10; k++) {
        binomProbs[k] = binomial(10, 0.004, k);
    }
    
    let pullsInBanner = 0;
    while (true) {
        // 1. Apply 30-pull milestone
        if (pullsInBanner === 30) {
            let new_state = new Float64Array(STATE_SIZE);
            for (let p = 0; p < 80; p++) {
                for (let c = 0; c <= target; c++) {
                    for (let h = 0; h < 2; h++) {
                        let prob = curr_state[idx(p, c, h)];
                        if (prob > 0) {
                            for (let k = 0; k <= 10; k++) {
                                let prob_k = binomProbs[k];
                                if (prob_k < 1e-12) continue;
                                let next_c = Math.min(target, c + k);
                                new_state[idx(p, next_c, h)] += prob * prob_k;
                            }
                        }
                    }
                }
            }
            curr_state = new_state;
        }
        
        // 2. Check stopping condition
        let activeProb = 0;
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= target; c++) {
                for (let h = 0; h < 2; h++) {
                    let prob = curr_state[idx(p, c, h)];
                    if (prob > 0) {
                        let reachedTarget = (c >= target);
                        let shouldContinueTo60 = reachedTarget && pullsInBanner >= 9 && pullsInBanner < 60 && !is_last_banner;
                        
                        if (reachedTarget && !shouldContinueTo60) {
                            results.push({ pullsInBanner, end_pity: p, prob });
                            curr_state[idx(p, c, h)] = 0; // Remove from active
                        } else {
                            activeProb += prob;
                        }
                    }
                }
            }
        }
        
        if (activeProb < 1e-12 || pullsInBanner >= 5000) break;
        
        // 3. Perform the next pull
        let next_pull = pullsInBanner + 1;
        let next_state = new Float64Array(STATE_SIZE);
        
        for (let p = 0; p < 80; p++) {
            for (let c = 0; c <= target; c++) {
                for (let h = 0; h < 2; h++) {
                    let prob = curr_state[idx(p, c, h)];
                    if (prob === 0) continue;
                    
                    let p_6star = 0.008;
                    let p_lim_given_6 = 0.5;
                    
                    if (next_pull === 120 && h === 0) {
                        p_6star = 1.0;
                        p_lim_given_6 = 1.0;
                    } else {
                        let n = p + 1;
                        if (n >= 66 && n <= 79) {
                            p_6star = 0.008 + 0.05 * (n - 65);
                        } else if (n >= 80) {
                            p_6star = 1.0;
                        }
                    }
                    
                    if (p_6star < 1.0) {
                        let p_none = prob * (1.0 - p_6star);
                        let np = p + 1;
                        let nc = c;
                        if (next_pull === 240) nc = Math.min(target, nc + 1);
                        next_state[idx(np, nc, h)] += p_none;
                    }
                    
                    if (p_6star > 0 && p_lim_given_6 < 1.0) {
                        let p_std = prob * p_6star * (1.0 - p_lim_given_6);
                        let np = 0;
                        let nc = c;
                        if (next_pull === 240) nc = Math.min(target, nc + 1);
                        next_state[idx(np, nc, h)] += p_std;
                    }
                    
                    if (p_6star > 0 && p_lim_given_6 > 0) {
                        let p_lim = prob * p_6star * p_lim_given_6;
                        let np = 0;
                        let nc = Math.min(target, c + 1);
                        if (next_pull === 240) nc = Math.min(target, nc + 1);
                        next_state[idx(np, nc, 1)] += p_lim;
                    }
                }
            }
        }
        curr_state = next_state;
        pullsInBanner++;
    }
    
    transCache.set(cacheKey, results);
    return results;
}
