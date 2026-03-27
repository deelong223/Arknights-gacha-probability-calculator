export function calculateMultiBanner(targets: number[], initialPity: number, initialBudget: number): number {
    const iterations = 100000;
    let successCount = 0;

    // Find the last banner that has a target > 0
    let lastBannerIndex = -1;
    for (let i = 0; i < targets.length; i++) {
        if (targets[i] > 0) lastBannerIndex = i;
    }
    
    // If no targets, success is 100%
    if (lastBannerIndex === -1) return 1.0;

    for (let i = 0; i < iterations; i++) {
        if (runSimulation(targets, initialPity, initialBudget, lastBannerIndex)) {
            successCount++;
        }
    }

    return successCount / iterations;
}

function runSimulation(targets: number[], initialPity: number, initialBudget: number, lastBannerIndex: number): boolean {
    let pity = initialPity;
    let budget = initialBudget;
    let nextBannerExtra = 0;

    for (let bannerIdx = 0; bannerIdx <= lastBannerIndex; bannerIdx++) {
        let target = targets[bannerIdx];
        
        // If target is 0, we skip this banner. Extra pulls from previous banner are lost.
        if (target === 0) {
            nextBannerExtra = 0;
            continue;
        }

        let pullsInBanner = 0;
        let copies = 0;
        let hasPulledLimited = false;
        
        let availableExtraPulls = nextBannerExtra;
        nextBannerExtra = 0;

        while (true) {
            let reachedTarget = copies >= target;
            // Strategy: if target reached between 9 and 59 pulls, and there are future banners, continue to 60.
            let shouldContinueTo60 = reachedTarget && pullsInBanner >= 9 && pullsInBanner < 60 && bannerIdx < lastBannerIndex;
            
            if (reachedTarget && !shouldContinueTo60) {
                break; // Done with this banner
            }

            // Consume a pull
            if (availableExtraPulls > 0) {
                availableExtraPulls--;
            } else if (budget > 0) {
                budget--;
            } else {
                return false; // Out of budget and extra pulls before reaching target
            }

            pullsInBanner++;
            pity++;

            let is6Star = false;
            let isLimited = false;

            // Rule 5: 120 pulls guarantee
            if (pullsInBanner === 120 && !hasPulledLimited) {
                is6Star = true;
                isLimited = true;
            } else {
                // Rule 1: Pity probability
                let prob = 0.008;
                if (pity >= 66 && pity <= 79) {
                    prob = 0.008 + 0.05 * (pity - 65);
                } else if (pity >= 80) {
                    prob = 1.0;
                }
                
                is6Star = Math.random() < prob;
                if (is6Star) {
                    // Rule 7: 50% chance for limited
                    isLimited = Math.random() < 0.5;
                }
            }

            if (is6Star) {
                pity = 0; // Reset pity
                if (isLimited) {
                    hasPulledLimited = true;
                    copies++;
                }
            }

            // Rule 3: 30 pulls milestone gives a free 10-pull
            if (pullsInBanner === 30) {
                for (let j = 0; j < 10; j++) {
                    pity++;
                    let p30 = 0.008;
                    if (pity >= 66 && pity <= 79) {
                        p30 = 0.008 + 0.05 * (pity - 65);
                    } else if (pity >= 80) {
                        p30 = 1.0;
                    }
                    
                    let is6Star30 = Math.random() < p30;
                    if (is6Star30) {
                        pity = 0;
                        if (Math.random() < 0.5) {
                            hasPulledLimited = true;
                            copies++;
                        }
                    }
                }
            }

            // Rule 4: 60 pulls milestone gives 10 extra pulls for next banner
            if (pullsInBanner === 60) {
                nextBannerExtra = 10;
            }

            // Rule 6: 240 pulls milestone directly gives a limited 6-star
            if (pullsInBanner === 240) {
                copies++;
            }
        }
    }

    return true; // Successfully reached targets for all requested banners
}
