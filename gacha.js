/**
 * gacha.js — gacha.wasm 的極簡載入器（取代原本 Emscripten 產生的黏合層）
 *
 * 為什麼自己寫？產出的 wasm 是 standalone 模組（沒有任何 import，直接匯出
 * memory / calculate / setTarget / ...），不需要 emscripten 的 JS runtime，
 * 也不需要 malloc + setValue 來傳參數。
 *
 * 對外 API（瀏覽器掛在 window.Gacha，Node 用 require）：
 *   Gacha.init(url?)            -> Promise<exports>
 *   Gacha.ready                 -> Promise（init 過就重用）
 *   Gacha.calculate(targets, pity, budget) -> number（0..1）
 *   Gacha.setThreshold(threshold)          -> void
 *   Gacha.version
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Gacha = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var isNode = typeof process !== 'undefined' && process.versions && process.versions.node;

  var exportsRef = null;
  var readyPromise = null;
  var pendingThreshold = 47;
  var wasmUrl = 'gacha.wasm';

  function base64ToBytes(b64) {
    if (typeof Uint8Array.fromBase64 === 'function') return Uint8Array.fromBase64(b64);
    var bin = (typeof atob === 'function') ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function loadBytes(url) {
    // 1) 瀏覽器：若建置時把 wasm 內嵌成 base64，就直接用（連 file:// 也能跑）
    if (!isNode && typeof root.GACHA_WASM_B64 === 'string' && root.GACHA_WASM_B64) {
      return Promise.resolve(base64ToBytes(root.GACHA_WASM_B64));
    }
    // 2) Node：直接讀檔
    if (isNode) {
      var fs = require('node:fs');
      var path = require('node:path');
      var here = (typeof __dirname === 'string') ? __dirname : '.';
      return Promise.resolve(fs.readFileSync(path.join(here, url)));
    }
    // 3) 瀏覽器：抓 .wasm
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error('無法載入 ' + url + '（HTTP ' + res.status + '）');
      return res.arrayBuffer();
    });
  }

  function init(url) {
    if (readyPromise) return readyPromise;
    if (url) wasmUrl = url;
    readyPromise = loadBytes(wasmUrl)
      .then(function (bytes) {
        // 目前建置出來的 wasm 沒有任何 import；這裡留一組 no-op 墊片，
        // 日後若不小心把 libc stdio 連進來也還載得起來。
        var imports = {
          wasi_snapshot_preview1: {
            fd_close: function () { return 0; },
            fd_write: function () { return 0; },
            fd_seek: function () { return 0; },
          },
        };
        return WebAssembly.instantiate(bytes, imports);
      })
      .then(function (result) {
        exportsRef = result.instance.exports;
        if (typeof exportsRef.gachaInit === 'function') exportsRef.gachaInit();
        exportsRef.setThreshold(pendingThreshold);
        return exportsRef;
      })
      .catch(function (err) {
        readyPromise = null;
        throw err;
      });
    return readyPromise;
  }

  function requireReady() {
    if (!exportsRef) throw new Error('gacha.wasm 尚未載入完成，請先 await Gacha.init()');
    return exportsRef;
  }

  return {
    version: 2,
    init: init,
    get ready() { return readyPromise || init(); },
    get loaded() { return exportsRef !== null; },

    setThreshold: function (threshold) {
      var t = Math.max(0, Math.min(60, Math.round(threshold) || 0));
      pendingThreshold = t;
      if (exportsRef) exportsRef.setThreshold(t);
    },

    calculate: function (targets, pity, budget) {
      var ex = requireReady();
      var n = Math.max(1, Math.min(8, targets.length));
      ex.setCount(n);
      for (var i = 0; i < n; i++) ex.setTarget(i, targets[i] || 0);
      return ex.calculate(pity | 0, budget | 0);
    },

    calculateSingle: function (target, pity, budget) {
      return requireReady().calculateSingle(target | 0, pity | 0, budget | 0);
    },

    /**
     * 單期「達標所需抽數」統計（達標即停，不含情報書續抽）
     * @returns {{mean:number, p10:number, p50:number, p90:number, p99:number}|null}
     */
    bannerStats: function (target, pity) {
      if (!target) return null;
      var ex = requireReady();
      var t = target | 0;
      var p = pity | 0;
      return {
        mean: ex.bannerMean(t, p, 60),
        p10: ex.bannerQuantile(t, p, 60, 0.10),
        p50: ex.bannerQuantile(t, p, 60, 0.50),
        p90: ex.bannerQuantile(t, p, 60, 0.90),
        p99: ex.bannerQuantile(t, p, 60, 0.99),
      };
    },
  };
});
