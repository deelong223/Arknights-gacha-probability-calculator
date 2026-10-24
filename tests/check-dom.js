'use strict';
/**
 * 迷你 DOM 冒煙測試：在不開瀏覽器的情況下真的執行 charts.js 與 share.js 的繪製路徑，
 * 確認沒有打錯 API（appendChild / setAttribute / canvas 呼叫…）。
 *
 * 另外檢查 index.html 的靜態契約：app.js 取用的 id 都存在、沒有重複 id、
 * 本地 script/css 檔案都存在。
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
let failed = 0;
const fail = (m) => { failed++; console.log('FAIL ' + m); };
const ok = (m) => console.log('OK   ' + m);

// ------------------------------------------------------------------ 迷你 DOM
function makeStyle() {
  const store = {};
  return {
    setProperty(k, v) { store[k] = v; },
    getPropertyValue(k) { return store[k] || ''; },
    get cssText() { return ''; },
    set cssText(v) { /* noop */ },
  };
}

function makeNode(name, ns) {
  const classList = {
    _set: {},
    add(c) { this._set[c] = true; },
    remove(c) { delete this._set[c]; },
    toggle(c, on) { if (on === undefined) on = !this._set[c]; this._set[c] = !!on; },
    contains(c) { return !!this._set[c]; },
  };
  const node = {
    nodeName: name,
    namespaceURI: ns || null,
    childNodes: [],
    attrs: {},
    style: makeStyle(),
    dataset: {},
    textContent: '',
    classList,
    _listeners: {},
    get className() { return Object.keys(classList._set).filter((k) => classList._set[k]).join(' '); },
    set className(v) {
      Object.keys(classList._set).forEach((k) => delete classList._set[k]);
      String(v).split(/\s+/).filter(Boolean).forEach((c) => { classList._set[c] = true; });
    },
    get children() { return node.childNodes; },
    appendChild(child) { node.childNodes.push(child); child.parentNode = node; return child; },
    removeChild(child) {
      const i = node.childNodes.indexOf(child);
      if (i >= 0) node.childNodes.splice(i, 1);
      return child;
    },
    remove() { if (node.parentNode) node.parentNode.removeChild(node); },
    setAttribute(k, v) {
      node.attrs[k] = String(v);
      if (k === 'class') node.className = v;   // 讓 classList 反映 setAttribute('class')
    },
    getAttribute(k) { return node.attrs[k]; },
    addEventListener(type, fn) { (node._listeners[type] = node._listeners[type] || []).push(fn); },
    dispatch(type, ev) { (node._listeners[type] || []).forEach((fn) => fn(ev || {})); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 640, height: 260 }; },
    getTotalLength() { return 420; },
    get offsetWidth() { return 640; },
    get innerHTML() { return ''; },
    set innerHTML(v) { node.childNodes.length = 0; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return node;
}

function makeCanvas() {
  const ctx = {
    canvas: null,
    scale() {}, save() {}, restore() {},
    beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arcTo() {}, arc() {},
    fill() {}, stroke() {}, fillRect() {}, fillText() {}, setLineDash() {},
    measureText: (s) => ({ width: String(s).length * 8 }),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
    set font(v) {}, set textAlign(v) {}, set lineJoin(v) {}, set lineCap(v) {},
  };
  const canvas = makeNode('canvas');
  canvas.width = 0;
  canvas.height = 0;
  canvas.getContext = () => ctx;
  canvas.toBlob = (cb) => cb({ type: 'image/png', size: 1 });
  return canvas;
}

const document = {
  createElement: (name) => (name === 'canvas' ? makeCanvas() : makeNode(name)),
  createElementNS: (ns, name) => makeNode(name, ns),
  createTextNode: (text) => { const n = makeNode('#text'); n.textContent = text; return n; },
  body: makeNode('body'),
  documentElement: makeNode('html'),
  addEventListener() {},
  querySelectorAll: () => [],
};

const sandbox = {
  document,
  navigator: { language: 'zh-TW' },
  localStorage: null,
  location: { hash: '', origin: 'https://example.com', pathname: '/' },
  console,
  setTimeout: (fn) => { fn(); return 0; },
  clearTimeout() {},
  Promise,
  Math,
  Object,
  String,
  Number,
  Array,
  JSON,
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL() {} },
  performance: { now: () => Date.now() },
  Date,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
sandbox.history = { replaceState() {} };
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8'), sandbox, { filename: 'i18n.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'charts.js'), 'utf8'), sandbox, { filename: 'charts.js' });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'share.js'), 'utf8'), sandbox, { filename: 'share.js' });

const t = (k, v) => sandbox.I18N.t('zh-TW', k, v);

// ------------------------------------------------------------------ 測 charts.js
const box = makeNode('div');
const onPick = [];
sandbox.Charts.renderCurve(box, {
  t,
  points: [{ x: 0, y: 0 }, { x: 60, y: 0.24 }, { x: 120, y: 1 }],
  maxX: 120,
  onPick: (x) => onPick.push(x),
});
const svg = box.childNodes.find((n) => n.nodeName === 'svg');
if (!svg) fail('renderCurve 沒有產生 svg');
else {
  const paths = svg.childNodes.filter((n) => n.nodeName === 'path');
  if (paths.length < 2) fail('renderCurve 的 path 數量不足（線 + 面積）');
  if (!svg.attrs.viewBox) fail('renderCurve 沒有 viewBox');
  ok('renderCurve 產生 svg + 線/面積 path（' + paths.length + ' 條）');
}

const costBox = makeNode('div');
sandbox.Charts.renderCost(costBox, [
  { label: '1', median: 62, mean: 58, p10: 20, p90: 80 },
  { label: '2', median: 75, mean: 70, p10: 30, p90: 96 },
], t);
if (costBox.childNodes.length < 2) fail('renderCost 沒有產生列');
else {
  const bar = costBox.childNodes[0].childNodes[1].childNodes.find((n) => n.classList.contains('cost-bar'));
  if (!bar) fail('renderCost 缺少 cost-bar');
  else if (!bar.style.width || bar.style.width === '0%') fail('renderCost 的 bar 寬度沒設定');
  else ok('renderCost 產生 2 列、bar 寬度 ' + bar.style.width);
}

// 空資料
const emptyBox = makeNode('div');
sandbox.Charts.renderCurve(emptyBox, { t, points: [] });
if (!emptyBox.childNodes.length) fail('renderCurve 空資料時沒有顯示提示');

// 武器池曲線：guides 物件、指定 live 點、自訂 tooltip
const wBox = makeNode('div');
const wPoints = [{ x: 0, y: 0 }, { x: 2, y: 0.18 }, { x: 4, y: 0.38 }, { x: 8, y: 1 }];
sandbox.Charts.renderCurve(wBox, {
  t,
  points: wPoints,
  maxX: 8,
  guides: [{ x: 4, text: '4' }, { x: 8, text: t('weapon.guardTag') }],
  live: { x: 4, y: 0.38 },
  tip: (p) => t('weapon.tip', { x: p.x, y: (p.y * 100).toFixed(1) }),
});
const wSvg = wBox.childNodes.find((n) => n.nodeName === 'svg');
if (!wSvg) fail('renderCurve（武器池）沒有產生 svg');
else {
  const guides = wSvg.childNodes.filter((n) => n.nodeName === 'line' && n.classList.contains('marker-guide'));
  const texts = wSvg.childNodes.filter((n) => n.nodeName === 'text');
  if (guides.length !== 2) fail('武器池曲線的參考線數量應為 2，實際 ' + guides.length);
  if (!texts.length) fail('武器池曲線沒有座標文字');
  const live = wSvg.childNodes.find((n) => n.nodeName === 'circle');
  if (!live || Number(live.attrs.cx) === undefined) fail('武器池曲線缺少 live 標記');
  if (guides.length === 2) ok('renderCurve（武器池）：2 條參考線 + ' + texts.length + ' 個文字節點');
}

// ------------------------------------------------------------------ 測 share.js
const canvas = sandbox.Share.render({
  t,
  result: 0.255486,
  pity: 0,
  budget: 240,
  threshold: 47,
  targets: [1, 1, 0, 0, 0],
  bannerCount: 2,
  curve: [{ x: 0, y: 0 }, { x: 120, y: 0.24 }, { x: 240, y: 0.26 }],
  maxX: 240,
  stats: { mean: 58, p50: 62, p90: 80 },
  weapon: { upProb: 0.6342, claims: { p50: 6 }, need: { p50: 6 } },
  url: 'https://example.com/#t=1,1',
});
if (!canvas || !canvas.width) fail('Share.render 沒有回傳 canvas');
else ok('Share.render 產生 ' + canvas.width + '×' + canvas.height + ' 的 canvas');

// ------------------------------------------------------------------ HTML 契約
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
const idListMatch = appSrc.match(/var ids = \[([\s\S]*?)\];/);
if (!idListMatch) fail('找不到 app.js 的 ids 清單');
else {
  const ids = idListMatch[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean);
  const missing = ids.filter((id) => !new RegExp('id="' + id + '"').test(html));
  if (missing.length) fail('index.html 缺少 app.js 要用的 id：' + missing.join(', '));
  else ok('index.html 具備 app.js 需要的 ' + ids.length + ' 個 id');
}

const htmlIds = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
const dup = htmlIds.filter((id, i) => htmlIds.indexOf(id) !== i);
if (dup.length) fail('index.html 有重複 id：' + [...new Set(dup)].join(', '));
else ok('index.html 沒有重複 id（' + htmlIds.length + ' 個）');

const localScripts = [...html.matchAll(/<(?:script src|link rel="stylesheet" href)="([^"]+)"/g)]
  .map((m) => m[1])
  .filter((src) => !/^https?:/.test(src));
const missingFiles = localScripts.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (missingFiles.length) fail('index.html 引用了不存在的本地檔案：' + missingFiles.join(', '));
else ok('index.html 的 ' + localScripts.length + ' 個本地資源都存在');

if (failed) {
  console.log(`\nDOM/HTML 冒煙測試：${failed} 項失敗`);
  process.exit(1);
}
console.log('\nDOM/HTML 冒煙測試全部通過');
