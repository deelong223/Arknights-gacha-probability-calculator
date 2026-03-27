/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { calculateMultiBanner } from './lib/gacha';
import { Calculator, Settings2, Target, Wallet } from 'lucide-react';
import { motion } from 'motion/react';

export default function App() {
  const [initialPity, setInitialPity] = useState<string>("0");
  const [budget, setBudget] = useState<string>("0");
  const [targets, setTargets] = useState<string[]>(["0", "0", "0", "0", "0"]);
  const [result, setResult] = useState<number | null>(null);
  const [isCalculating, setIsCalculating] = useState(false);

  const handleCalculate = async () => {
    setIsCalculating(true);
    // Use setTimeout to yield to the event loop so UI can update
    setTimeout(() => {
      const parsedPity = parseInt(initialPity) || 0;
      const parsedBudget = parseInt(budget) || 0;
      const parsedTargets = targets.map(t => parseInt(t) || 0);
      const prob = calculateMultiBanner(parsedTargets, parsedPity, parsedBudget);
      setResult(prob);
      setIsCalculating(false);
    }, 50);
  };

  const updateTarget = (index: number, value: string) => {
    const newTargets = [...targets];
    if (value === "") {
      newTargets[index] = "";
    } else {
      const num = parseInt(value);
      if (!isNaN(num)) newTargets[index] = Math.max(0, Math.min(6, num)).toString();
    }
    setTargets(newTargets);
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-50 p-6 md:p-12 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <header className="space-y-2">
          <h1 className="text-4xl font-bold tracking-tight text-white flex items-center gap-3">
            <Calculator className="w-8 h-8 text-blue-500" />
            終末地抽卡計算機
          </h1>
          <p className="text-2xl text-neutral-200">
            Arknights:Endfield gacha probability calculator
          </p>
        </header>

        <main className="grid gap-8 md:grid-cols-2">
          <div className="space-y-6 bg-neutral-900 p-6 rounded-2xl border border-neutral-800 shadow-xl">
            <div className="space-y-4">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Settings2 className="w-5 h-5 text-neutral-400" />
                Current State(當前情況)
              </h2>
              
              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300">Initial Pity (墊幾抽) (0~79)</label>
                <input 
                  type="number" 
                  min="0" max="79"
                  value={initialPity}
                  onWheel={(e) => (e.target as HTMLElement).blur()}
                  onChange={(e) => {
                    if (e.target.value === "") setInitialPity("");
                    else {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) setInitialPity(Math.max(0, Math.min(79, num)).toString());
                    }
                  }}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-neutral-300 flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  Budget (預算) (0~5000)
                </label>
                <input 
                  type="number" 
                  min="0"
                  value={budget}
                  onWheel={(e) => (e.target as HTMLElement).blur()}
                  onChange={(e) => {
                    if (e.target.value === "") setBudget("");
                    else {
                      const num = parseInt(e.target.value);
                      if (!isNaN(num)) setBudget(Math.max(0, Math.min(5000, num)).toString());
                    }
                  }}
                  className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-neutral-800">
              <h2 className="text-xl font-semibold flex items-center gap-2">
                <Target className="w-5 h-5 text-neutral-400" />
                Banner Targets (目標數量)
              </h2>
              <p className="text-base text-neutral-500">valid number (輸入範圍):0~6</p>
              
              <div className="space-y-3">
                {targets.map((target, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <label className="text-sm font-medium text-neutral-400 w-20">Banner {idx + 1}</label>
                    <input 
                      type="number" 
                      min="0" max="6"
                      value={target}
                      onWheel={(e) => (e.target as HTMLElement).blur()}
                      onChange={(e) => updateTarget(idx, e.target.value)}
                      className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={handleCalculate}
              disabled={isCalculating}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold py-3 px-4 rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isCalculating ? (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
                  className="w-5 h-5 border-2 border-white border-t-transparent rounded-full"
                />
              ) : (
                "Calculate Probability(計算結果)"
              )}
            </button>
          </div>

          <div className="bg-neutral-900 p-6 rounded-2xl border border-neutral-800 shadow-xl flex flex-col items-center justify-center min-h-[300px] relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-purple-500/5" />
            
            <div className="relative z-10 text-center space-y-4">
              <h3 className="text-lg font-medium text-neutral-400">Success Probability(成功率)</h3>
              
              {result !== null ? (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  key={result}
                  className="space-y-2"
                >
                  <div className="text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400">
                    {(Math.min(1, result) * 100).toFixed(2)}%
                  </div>
                  <p className="text-sm text-neutral-500">
                    You have {parseFloat((Math.min(1, result) * 100).toFixed(2)) || 0}% chance to get your target.
                  </p>
                </motion.div>
              ) : (
                <div className="text-neutral-600 text-lg">
                  Click calculate to see results
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
