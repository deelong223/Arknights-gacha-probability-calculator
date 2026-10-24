#!/usr/bin/env node
'use strict';
/**
 * tools/build.js — 跨平台建置入口（給 Vercel / CI / 本機共用）
 *
 * 規則：
 *   1. 有 EMSDK（本機 Windows）→ 重新編譯 wasm。
 *   2. 沒有 EMSDK（Vercel / Linux / 其他人的機器）→ 直接跳過，沿用已提交的
 *      gacha.wasm 與 gacha-wasm-b64.js。永不讓「建置」失敗。
 *
 * 環境變數：
 *   SKIP_WASM_BUILD=1   一律跳過重建
 *   BUILD_PLATFORM=...  模擬平台（測試用，例如 linux）
 *   EMSDK_ROOT=...      emsdk 位置
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const log = (msg) => console.log('[build] ' + msg);

const argv = process.argv.slice(2);
const force = argv.includes('--force');

if (process.env.SKIP_WASM_BUILD === '1' && !force) {
  log('SKIP_WASM_BUILD=1 → 跳過 wasm 重建，使用已提交的 gacha.wasm');
  process.exit(0);
}

const platform = process.env.BUILD_PLATFORM || process.platform;
const isWindows = platform === 'win32';

const home = process.env.HOME || process.env.USERPROFILE || '';
const emsdk = process.env.EMSDK_ROOT || (isWindows ? 'C:\\emsdk' : path.join(home, 'emsdk'));
const clangBin = path.join(emsdk, 'upstream', 'bin', isWindows ? 'clang.exe' : 'clang');

const artifacts = ['gacha.wasm', 'gacha-wasm-b64.js'].filter((f) => fs.existsSync(path.join(ROOT, f)));

function fallback(reason) {
  log(reason);
  if (artifacts.length === 2) {
    log('使用已提交的 ' + artifacts.join(' + ') + '（前端不需要重新編譯即可運作）');
  } else {
    log('警告：找不到已提交的 ' + ['gacha.wasm', 'gacha-wasm-b64.js'].filter((f) => !artifacts.includes(f)).join(' + '));
    log('提示：在已安裝 emsdk 的 Windows 上執行 npm run build:wasm 之後再提交。');
  }
  process.exit(0);
}

if (!fs.existsSync(clangBin)) {
  fallback('找不到 emsdk（' + emsdk + '）');
}

if (!isWindows) {
  fallback('非 Windows 平台沒有自動編譯腳本（需要 emsdk 的 clang + emcc）');
}

log('偵測到 emsdk：' + emsdk);
const res = spawnSync(
  'powershell',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'build.ps1')],
  { cwd: ROOT, stdio: 'inherit' }
);

if (res.error) {
  log('執行 build.ps1 失敗：' + res.error.message);
  fallback('改用已提交的產物');
}
if (res.status !== 0) {
  log('build.ps1 回傳 ' + res.status);
  fallback('改用已提交的產物');
}
log('完成');
