'use strict';
// 模擬瀏覽器環境（沒有 process、只有 globalThis/window）來驗證「內嵌 base64」的載入路徑
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');

const sandbox = {
  console,
  Math,
  Uint8Array,
  Uint32Array,
  Int32Array,
  Float64Array,
  ArrayBuffer,
  WebAssembly,
  Error,
  Promise,
  setTimeout,
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(ROOT, 'gacha-wasm-b64.js'), 'utf8'), sandbox, { filename: 'gacha-wasm-b64.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'gacha.js'), 'utf8'), sandbox, { filename: 'gacha.js' });

(async () => {
  if (!sandbox.Gacha) throw new Error('window.Gacha 沒有被建立');
  await sandbox.Gacha.init('gacha.wasm');
  const r1 = sandbox.Gacha.calculate([1], 0, 120);
  const r2 = sandbox.Gacha.calculate([1], 0, 30);
  sandbox.Gacha.setThreshold(0);
  const r3 = sandbox.Gacha.calculate([1, 1], 0, 55);
  console.log('瀏覽器路徑（base64 -> wasm）：');
  console.log('  [1] 120 抽 =', r1);
  console.log('  [1]  30 抽 =', r2.toFixed(6));
  console.log('  threshold=0, [1,1] 55 抽 =', r3.toFixed(6));
  const ok = r1 === 1 && Math.abs(r2 - 0.148130) < 1e-5 && Math.abs(r3 - 0.026979) < 1e-5;
  console.log(ok ? 'BROWSER-PATH-OK' : 'BROWSER-PATH-FAIL');
  process.exit(ok ? 0 : 1);
})();
