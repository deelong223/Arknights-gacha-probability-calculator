'use strict';
/**
 * i18n / 靜態契約測試：
 *  1. 三種語言的字典 key 必須完全一致
 *  2. index.html 用到的 data-i18n key 必須都存在於三語
 *  3. 規則說明每個語言的段落數、每段條目數要一致（避免漏翻）
 *  4. app.js / charts.js / share.js 直接呼叫的 t('...') key 也要存在
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { globalThis: {}, localStorage: null, navigator: { language: 'zh-TW' } };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'i18n.js'), 'utf8'), sandbox, { filename: 'i18n.js' });

const I18N = sandbox.I18N;
const LANGS = I18N.LANGS;
const dict = I18N.dict;

let failed = 0;
function fail(msg) { failed++; console.log('FAIL ' + msg); }

// 1. key 集合一致
const keySets = {};
LANGS.forEach((lang) => {
  const keys = Object.keys(dict[lang]).filter((k) => k !== 'rules').sort();
  keySets[lang] = new Set(keys);
});
const base = keySets['zh-TW'];
LANGS.forEach((lang) => {
  const set = keySets[lang];
  base.forEach((k) => { if (!set.has(k)) fail(`${lang} 缺少 key：${k}`); });
  set.forEach((k) => { if (!base.has(k)) fail(`zh-TW 缺少 key：${k}（${lang} 有）`); });
});

// 2. index.html 的 data-i18n
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const htmlKeys = new Set();
for (const m of html.matchAll(/data-i18n="([^"]+)"/g)) htmlKeys.add(m[1]);
for (const m of html.matchAll(/data-i18n-placeholder="([^"]+)"/g)) htmlKeys.add(m[1]);
LANGS.forEach((lang) => {
  htmlKeys.forEach((k) => {
    if (dict[lang][k] === undefined) fail(`index.html 用了不存在的 key：${k}（${lang}）`);
  });
});

// 3. 程式碼裡直接呼叫的 key（含動態字串）
const jsFiles = ['app.js', 'charts.js', 'share.js'];
const directKeys = new Set();
for (const file of jsFiles) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  for (const m of src.matchAll(/\bt\('([a-zA-Z][\w.]*)'/g)) directKeys.add(m[1]);
  for (const m of src.matchAll(/'([a-z]+\.[a-zA-Z]\w*)'/g)) {
    if (dict['zh-TW'][m[1]] !== undefined) directKeys.add(m[1]);
  }
}
LANGS.forEach((lang) => {
  directKeys.forEach((k) => {
    if (dict[lang][k] === undefined) fail(`${lang} 缺少程式碼用到的 key：${k}`);
  });
});

// 4. 規則段落一致性
const rules = dict.rules;
const zhRules = rules['zh-TW'];
LANGS.forEach((lang) => {
  const r = rules[lang];
  if (!Array.isArray(r)) { fail(`${lang} 沒有規則內容`); return; }
  if (r.length !== zhRules.length) fail(`${lang} 規則段落數 ${r.length} != ${zhRules.length}`);
  r.forEach((sec, i) => {
    if (zhRules[i] && sec.items.length !== zhRules[i].items.length) {
      fail(`${lang} 第 ${i + 1} 段條目數 ${sec.items.length} != ${zhRules[i].items.length}`);
    }
    if (!sec.h) fail(`${lang} 第 ${i + 1} 段沒有標題`);
    sec.items.forEach((it, j) => { if (!it || it.length < 6) fail(`${lang} 第 ${i + 1}.${j + 1} 條內容太短`); });
  });
});

// 5. 佔位符一致性（{n} / {x} 之類）
LANGS.forEach((lang) => {
  Object.keys(dict[lang]).forEach((k) => {
    if (k === 'rules') return;
    const baseVars = (dict['zh-TW'][k].match(/\{(\w+)\}/g) || []).sort().join(',');
    const thisVars = (dict[lang][k].match(/\{(\w+)\}/g) || []).sort().join(',');
    if (baseVars !== thisVars) fail(`${lang} 的 ${k} 佔位符不一致：[${thisVars}] vs [${baseVars}]`);
  });
});

if (failed) {
  console.log(`\ni18n 檢查：${failed} 項失敗`);
  process.exit(1);
}
console.log(`i18n 檢查通過：${LANGS.length} 種語言 · ${base.size} 個 key · ${htmlKeys.size} 個 HTML 引用 · ${directKeys.size} 個程式引用 · ${zhRules.length} 段規則`);
