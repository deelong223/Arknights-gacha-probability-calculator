/* app.js — UI 邏輯：輸入 → 引擎 → 結果 / 統計 / 圖表 / 分享 / i18n / 規則彈窗 */
(function () {
  'use strict';

  var BANNERS = 5;
  var LIMITS = {
    pity: [0, 79], budget: [0, 5000], threshold: [0, 59], target: [0, 6],
    wExtra: [0, 400000], wClaims: [0, 7],
  };

  var state = {
    lang: 'zh-TW',
    targets: [1, 1, 0, 0, 0],
    pity: 0,
    budget: 120,
    threshold: 47,
    wExtra: 0,
    wClaims: 0,
    result: null,
    curve: null,
    curveKey: '',
    bannerStats: [],
    marginal: null,
    weapon: null,
    weaponKey: '',
    busy: false,
  };

  var dom = {};

  function t(key, vars) { return window.I18N.t(state.lang, key, vars); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function num(value, fallback) {
    var n = parseInt(String(value).trim(), 10);
    return isNaN(n) ? fallback : n;
  }

  // ------------------------------------------------------------ i18n
  function applyI18n(rebuildBanners) {
    document.documentElement.lang = state.lang;
    document.title = t('app.title') + ' · ' + t('app.tagline');

    document.querySelectorAll('[data-i18n]').forEach(function (node) {
      node.textContent = t(node.getAttribute('data-i18n'));
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function (node) {
      node.setAttribute('placeholder', t(node.getAttribute('data-i18n-placeholder')));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function (node) {
      node.setAttribute('title', t(node.getAttribute('data-i18n-title')));
      node.setAttribute('aria-label', t(node.getAttribute('data-i18n-title')));
    });
    document.querySelectorAll('[data-lang]').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-lang') === state.lang));
    });
    renderRules();
    if (rebuildBanners) renderBannerRows();
    enhanceEmoji(document.body);
  }

  function setCalcLabel(key) {
    var span = dom.calcBtn.querySelector('[data-i18n]');
    if (span) span.textContent = t(key);
    else dom.calcBtn.textContent = t(key);
  }

  function setLang(lang) {
    state.lang = lang;
    window.I18N.save(lang);
    applyI18n(true);
    if (state.result !== null) {
      renderResult(false);
      renderStats();
      renderCurveChart();
      renderCostChart();
      renderWeapon();
    }
    updateUrl();
  }

  // ------------------------------------------------------------ 輸入列
  function renderBannerRows() {
    if (!dom.banners) return;
    dom.banners.innerHTML = '';
    for (var i = 0; i < BANNERS; i++) {
      (function (idx) {
        var row = document.createElement('div');
        row.className = 'banner-row';

        var label = document.createElement('span');
        label.textContent = t('banner.n', { n: idx + 1 });
        row.appendChild(label);

        var input = document.createElement('input');
        input.type = 'text';
        input.inputMode = 'numeric';
        input.value = String(state.targets[idx] || 0);
        input.setAttribute('aria-label', t('banner.n', { n: idx + 1 }));
        input.addEventListener('input', function () {
          var v = clamp(num(input.value, 0), LIMITS.target[0], LIMITS.target[1]);
          state.targets[idx] = v;
          if (String(v) !== input.value) input.value = String(v);
          updatePips(pips, v);
          updateUrl();
        });
        row.appendChild(input);

        var pips = document.createElement('div');
        pips.className = 'pips';
        for (var k = 0; k < LIMITS.target[1]; k++) pips.appendChild(document.createElement('i'));
        updatePips(pips, state.targets[idx] || 0);
        row.appendChild(pips);

        dom.banners.appendChild(row);
      })(i);
    }
  }

  function updatePips(container, value) {
    var dots = container.querySelectorAll('i');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('on', i < value);
    }
  }

  function syncInputsFromState() {
    dom.pity.value = String(state.pity);
    dom.budget.value = String(state.budget);
    dom.threshold.value = String(state.threshold);
    if (dom.wExtra) dom.wExtra.value = String(state.wExtra);
    if (dom.wClaims) dom.wClaims.value = String(state.wClaims);
  }

  // ------------------------------------------------------------ 計算
  function activeBanners() {
    var list = [];
    state.targets.forEach(function (v, i) { if (v > 0) list.push({ index: i, target: v }); });
    return list;
  }

  function sampleBudgets(budget) {
    var set = {};
    var fixed = [0, 1, 5, 10, 20, 30, 40, 50, 60, 80, 100, 120, 160, 200, 240, 300, 400, 500, 600, 800, 1000, 1200, 1600, 2000, 3000, 4000, 5000];
    fixed.forEach(function (v) { if (v <= budget) set[v] = 1; });
    for (var k = 1; k <= 18; k++) set[Math.round((budget * k) / 18)] = 1;
    set[budget] = 1;
    return Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
  }

  function buildCurve() {
    var key = state.targets.join(',') + '|' + state.pity + '|' + state.budget + '|' + state.threshold;
    if (state.curveKey === key && state.curve) return state.curve;

    var budgets = sampleBudgets(state.budget);
    var t0 = (window.performance || Date).now();
    var points = [];
    var truncated = false;

    for (var i = 0; i < budgets.length; i++) {
      if (i > 6 && ((window.performance || Date).now() - t0) > 650) { truncated = true; break; }
      points.push({ x: budgets[i], y: window.Gacha.calculate(state.targets, state.pity, budgets[i]) });
    }
    if (truncated || !points.length || points[points.length - 1].x !== state.budget) {
      points.push({ x: state.budget, y: state.result });
    }
    points.sort(function (a, b) { return a.x - b.x; });

    state.curve = points;
    state.curveKey = key;
    return points;
  }

  function computeAll() {
    var t0 = (window.performance || Date).now();
    state.result = window.Gacha.calculate(state.targets, state.pity, state.budget);
    var ms = (window.performance || Date).now() - t0;

    state.marginal = null;
    if (ms < 90) {
      var plus10 = window.Gacha.calculate(state.targets, state.pity, state.budget + 10);
      var plus30 = window.Gacha.calculate(state.targets, state.pity, state.budget + 30);
      state.marginal = {
        d10: (plus10 - state.result) * 100,
        d30: (plus30 - state.result) * 100,
      };
    }

    state.bannerStats = [];
    activeBanners().forEach(function (b, idx) {
      var pity = idx === 0 ? state.pity : 0;
      var s = window.Gacha.bannerStats(b.target, pity);
      if (s) state.bannerStats.push({ index: b.index, target: b.target, stats: s });
    });

    state.curveKey = '';
    state.curve = null;
  }

  // ------------------------------------------------------------ 畫面
  function renderResult(animate) {
    var pct = clamp(state.result, 0, 1) * 100;
    var label = (Math.round(pct * 100) / 100).toFixed(2) + '%';
    var exact = pct.toFixed(4) + '%';

    dom.gaugeValue.textContent = label;
    dom.gaugeValue.title = exact;
    dom.gaugeValue.parentElement.title = exact;

    var C = 2 * Math.PI * 88;
    var offset = C * (1 - clamp(state.result, 0, 1));
    dom.gaugeBar.style.strokeDasharray = C;
    dom.gaugeBar.style.strokeDashoffset = offset;

    var banners = activeBanners().length;
    var totalTargets = state.targets.reduce(function (a, b) { return a + b; }, 0);
    dom.resultSummary.textContent = t('result.summary', {
      banners: banners,
      targets: totalTargets,
      budget: state.budget,
    }) + ' · ' + exact;

    if (animate) {
      dom.gauge.classList.remove('pop');
      void dom.gauge.offsetWidth;
      dom.gauge.classList.add('pop');
    }
  }

  function renderStats() {
    if (!state.bannerStats.length) {
      dom.stats.innerHTML = '';
      return;
    }
    var first = state.bannerStats[0];
    var cards = [
      { label: t('stats.mean'), value: Math.round(first.stats.mean), hi: false },
      { label: t('stats.median'), value: Math.round(first.stats.p50), hi: true },
      { label: t('stats.p90'), value: Math.round(first.stats.p90), hi: false },
    ];

    var marginalText = '—';
    if (state.marginal) {
      var d = state.marginal.d10 >= 0.01 ? state.marginal.d10 : state.marginal.d30;
      var n = state.marginal.d10 >= 0.01 ? 10 : 30;
      marginalText = d <= 0.005 ? t('stats.marginalEmpty') : t('stats.marginalText', { n: n, d: d.toFixed(2) });
    }

    dom.stats.innerHTML = '';
    cards.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'stat' + (c.hi ? ' hi' : '');
      var b = document.createElement('b');
      b.textContent = c.value + ' ' + t('unit.pull');
      var s = document.createElement('span');
      s.textContent = c.label;
      el.appendChild(b);
      el.appendChild(s);
      dom.stats.appendChild(el);
    });

    var el2 = document.createElement('div');
    el2.className = 'stat';
    var b2 = document.createElement('b');
    b2.textContent = marginalText;
    b2.style.fontSize = state.marginal ? '1.02rem' : '1.5rem';
    var s2 = document.createElement('span');
    s2.textContent = t('stats.marginal');
    el2.appendChild(b2);
    el2.appendChild(s2);
    dom.stats.appendChild(el2);

    dom.statsSub.textContent = t('stats.sub', { target: first.target });
  }

  function renderCurveChart() {
    if (state.result === null) {
      window.Charts.renderCurve(dom.curveBox, { t: t, points: [] });
      return;
    }
    window.Charts.renderCurve(dom.curveBox, {
      t: t,
      points: buildCurve(),
      maxX: Math.max(1, state.budget),
      guides: [120, 240],
      onPick: function (x) {
        state.budget = clamp(x, LIMITS.budget[0], LIMITS.budget[1]);
        syncInputsFromState();
        updateUrl();
        run();
      },
    });
  }

  function renderCostChart() {
    var rows = state.bannerStats.map(function (b) {
      return {
        label: t('banner.n', { n: b.index + 1 }),
        median: b.stats.p50,
        mean: b.stats.mean,
        p10: b.stats.p10,
        p90: b.stats.p90,
      };
    });
    window.Charts.renderCost(dom.costBox, rows, t);
  }

  // ------------------------------------------------------------ 武器池
  function fmtInt(v) {
    var n = Math.round(v || 0);
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function weaponConfig() {
    return {
      targets: state.targets,
      pity: state.pity,
      budget: state.budget,
      threshold: state.threshold,
      extraQuota: state.wExtra,
      startClaims: state.wClaims,
    };
  }

  function computeWeapon() {
    if (!window.Weapon) return null;
    var cfg = weaponConfig();
    var key = cfg.targets.join(',') + '|' + cfg.pity + '|' + cfg.budget + '|' +
      cfg.threshold + '|' + cfg.extraQuota + '|' + cfg.startClaims;
    if (state.weaponKey === key && state.weapon) return state.weapon;
    state.weapon = window.Weapon.simulate(cfg);
    state.weaponKey = key;
    return state.weapon;
  }

  function renderWeapon() {
    if (!dom.weaponUp) return;
    var w = computeWeapon();
    if (!w) return;

    var pct = clamp(w.upProb, 0, 1) * 100;
    dom.weaponUp.textContent = (Math.round(pct * 100) / 100).toFixed(2) + '%';
    dom.weaponUp.title = pct.toFixed(4) + '%';
    dom.weaponSub.textContent = t('weapon.sub', { n: fmtInt(w.iters) });
    dom.weaponNote.textContent = t('weapon.note', {
      claims: Math.round(w.claims.p50),
      guard: w.guaranteeAt,
    });

    var cells = [
      { label: t('weapon.quota'), value: fmtInt(w.quota.mean), hi: false,
        hint: 'P10–P90 ' + fmtInt(w.quota.p10) + '–' + fmtInt(w.quota.p90) },
      { label: t('weapon.claims'), value: Math.round(w.claims.p50) + ' ' + t('weapon.unit'), hi: true,
        hint: 'P10–P90 ' + Math.round(w.claims.p10) + '–' + Math.round(w.claims.p90) },
      { label: t('weapon.need'), value: w.need.p50 + ' ' + t('weapon.unit'), hi: false,
        hint: t('weapon.needHint', { guard: w.guaranteeAt }) },
      { label: t('weapon.six'), value: (clamp(w.sixProb, 0, 1) * 100).toFixed(1) + '%', hi: false,
        hint: '' },
    ];

    dom.weaponStats.innerHTML = '';
    cells.forEach(function (c) {
      var el = document.createElement('div');
      el.className = 'stat' + (c.hi ? ' hi' : '');
      var b = document.createElement('b');
      b.textContent = c.value;
      el.appendChild(b);
      var s = document.createElement('span');
      s.textContent = c.label;
      el.appendChild(s);
      if (c.hint) el.title = c.hint;
      dom.weaponStats.appendChild(el);
    });

    renderWeaponChart(w);
  }

  function renderWeaponChart(w) {
    var maxX = w.curve.length ? w.curve[w.curve.length - 1].x : w.guaranteeAt;
    var at = clamp(Math.round(w.claims.p50), 0, maxX);
    var y = 0;
    w.curve.forEach(function (p) { if (p.x === at) y = p.y; });
    var guides = [];
    if (at > 0 && at !== w.guaranteeAt) guides.push({ x: at, text: String(at) });
    guides.push({ x: w.guaranteeAt, text: t('weapon.guardTag') });

    window.Charts.renderCurve(dom.weaponBox, {
      t: t,
      points: w.curve,
      maxX: maxX,
      guides: guides,
      live: { x: at, y: y },
      tip: function (p) {
        return t('weapon.tip', { x: Math.round(p.x), y: (p.y * 100).toFixed(1) });
      },
    });
  }

  async function run() {
    if (state.busy) return;
    state.busy = true;
    dom.calcBtn.disabled = true;
    setCalcLabel('btn.calculating');

    syncInputsFromState();
    window.Gacha.setThreshold(state.threshold);

    await new Promise(function (r) { setTimeout(r, 16); });
    try {
      computeAll();
      renderResult(true);
      renderStats();
      renderCurveChart();
      renderCostChart();
      renderWeapon();
      dom.shareCard.hidden = false;
      updateUrl();
    } catch (e) {
      console.error(e);
      dom.resultSummary.textContent = String(e && e.message ? e.message : e);
    } finally {
      state.busy = false;
      dom.calcBtn.disabled = false;
      setCalcLabel('btn.calculate');
      enhanceEmoji(document.body);
    }
  }

  // ------------------------------------------------------------ URL 狀態
  function updateUrl() {
    var params = [
      't=' + state.targets.join(','),
      'p=' + state.pity,
      'b=' + state.budget,
      'th=' + state.threshold,
      'wq=' + state.wExtra,
      'wc=' + state.wClaims,
      'l=' + state.lang,
    ];
    try {
      history.replaceState(null, '', '#' + params.join('&'));
    } catch (e) { /* file:// 下可能被拒，忽略 */ }
  }

  function readUrl() {
    var hash = (location.hash || '').replace(/^#/, '');
    if (!hash) return false;
    var out = {};
    hash.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) out[kv.slice(0, i)] = decodeURIComponent(kv.slice(i + 1));
    });
    if (out.t) {
      var list = out.t.split(',').slice(0, BANNERS).map(function (v) { return clamp(num(v, 0), 0, 6); });
      while (list.length < BANNERS) list.push(0);
      state.targets = list;
    }
    if (out.p !== undefined) state.pity = clamp(num(out.p, 0), 0, 79);
    if (out.b !== undefined) state.budget = clamp(num(out.b, 0), 0, 5000);
    if (out.th !== undefined) state.threshold = clamp(num(out.th, 47), 0, 59);
    if (out.wq !== undefined) state.wExtra = clamp(num(out.wq, 0), LIMITS.wExtra[0], LIMITS.wExtra[1]);
    if (out.wc !== undefined) state.wClaims = clamp(num(out.wc, 0), LIMITS.wClaims[0], LIMITS.wClaims[1]);
    if (out.l && window.I18N.LANGS.indexOf(out.l) >= 0) state.lang = out.l;
    return true;
  }

  function shareUrl() {
    return location.origin && location.origin !== 'null'
      ? location.origin + location.pathname + location.hash
      : 'https://deelong223.github.io/Arknights-gacha-probability-calculator/';
  }

  function shareText() {
    var pct = state.result === null ? 0 : state.result * 100;
    var lines = [];
    lines.push('🎲 ' + t('app.title'));
    lines.push('🎯 ' + state.targets.join(' / '));
    lines.push('🎰 pity ' + state.pity + ' · ' + state.budget + ' pulls · threshold ' + state.threshold);
    lines.push('✅ ' + pct.toFixed(4) + '%  ' + t('result.caption'));
    if (state.bannerStats.length) {
      var s = state.bannerStats[0].stats;
      lines.push('📊 ' + t('stats.mean') + ' ' + Math.round(s.mean) + ' · ' + t('stats.median') + ' ' + Math.round(s.p50) + ' · P90 ' + Math.round(s.p90));
    }
    if (state.weapon) {
      lines.push('⚔️ ' + t('weapon.upCaption') + ' ' + (state.weapon.upProb * 100).toFixed(2) + '% · ' +
        t('weapon.claims') + ' ' + Math.round(state.weapon.claims.p50) + t('weapon.unit'));
    }
    lines.push(shareUrl());
    return lines.join('\n');
  }

  // ------------------------------------------------------------ 規則彈窗
  function renderRules() {
    if (!dom.rulesBody) return;
    var sections = (window.I18N.dict.rules && window.I18N.dict.rules[state.lang]) || [];
    dom.rulesBody.innerHTML = '';
    sections.forEach(function (sec) {
      var wrap = document.createElement('section');
      wrap.className = 'rule-section';
      var h = document.createElement('h3');
      h.textContent = sec.h;
      wrap.appendChild(h);
      var ul = document.createElement('ul');
      sec.items.forEach(function (item) {
        var li = document.createElement('li');
        li.textContent = item;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
      dom.rulesBody.appendChild(wrap);
    });
    var note = document.createElement('p');
    note.className = 'rule-note';
    note.textContent = t('rules.note');
    dom.rulesBody.appendChild(note);
    dom.rulesTitle.textContent = t('rules.title');
    enhanceEmoji(dom.rulesBody);
  }

  function openRules(open) {
    dom.modal.classList.toggle('show', open);
    dom.modal.setAttribute('aria-hidden', String(!open));
    document.body.style.overflow = open ? 'hidden' : '';
  }

  // ------------------------------------------------------------ emoji / toast
  function enhanceEmoji(scope) {
    if (!window.twemoji) return;
    try { window.twemoji.parse(scope || document.body, { folder: 'svg', ext: '.svg' }); } catch (e) { /* ignore */ }
  }

  var toastTimer = null;
  function toast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { dom.toast.classList.remove('show'); }, 1800);
  }

  // ------------------------------------------------------------ 事件
  function bindEvents() {
    dom.calcBtn.addEventListener('click', run);

    [
      ['pity', function (v) { state.pity = v; }],
      ['budget', function (v) { state.budget = v; }],
      ['threshold', function (v) { state.threshold = v; }],
    ].forEach(function (pair) {
      var input = dom[pair[0]];
      var apply = function () {
        var limits = LIMITS[pair[0]];
        var v = clamp(num(input.value, state[pair[0]]), limits[0], limits[1]);
        pair[1](v);
        input.value = String(v);
        updateUrl();
      };
      input.addEventListener('change', apply);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') { apply(); run(); }
      });
    });

    // 武器池輸入：只重算武器段，不必重跑角色池 DP
    [
      ['wExtra', function (v) { state.wExtra = v; }],
      ['wClaims', function (v) { state.wClaims = v; }],
    ].forEach(function (pair) {
      var input = dom[pair[0]];
      if (!input) return;
      var apply = function () {
        var limits = LIMITS[pair[0]];
        var v = clamp(num(input.value, state[pair[0]]), limits[0], limits[1]);
        pair[1](v);
        input.value = String(v);
        updateUrl();
        renderWeapon();
      };
      input.addEventListener('change', apply);
      input.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') apply();
      });
    });

    document.querySelectorAll('[data-lang]').forEach(function (btn) {
      btn.addEventListener('click', function () { setLang(btn.getAttribute('data-lang')); });
    });

    dom.rulesBtn.addEventListener('click', function () { renderRules(); openRules(true); });
    dom.rulesClose.addEventListener('click', function () { openRules(false); });
    dom.modal.addEventListener('click', function (ev) { if (ev.target === dom.modal) openRules(false); });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') openRules(false); });

    dom.resetBtn.addEventListener('click', function () {
      state.targets = [1, 0, 0, 0, 0];
      state.pity = 0;
      state.budget = 120;
      state.threshold = 47;
      state.wExtra = 0;
      state.wClaims = 0;
      syncInputsFromState();
      renderBannerRows();
      updateUrl();
      run();
    });

    dom.copyTextBtn.addEventListener('click', async function () {
      var ok = await window.Share.copyText(shareText());
      toast(ok ? t('share.copied') : t('share.failed'));
    });

    dom.copyImageBtn.addEventListener('click', async function () {
      if (state.result === null) return;
      var canvas = buildShareCanvas();
      var ok = await window.Share.copyImage(canvas);
      toast(ok ? t('share.copied') : t('share.failed'));
    });

    dom.downloadBtn.addEventListener('click', async function () {
      if (state.result === null) return;
      var canvas = buildShareCanvas();
      var blob = await window.Share.toBlob(canvas);
      if (blob) window.Share.download(blob, 'endfield-gacha-' + Math.round(state.result * 10000) + '.png');
    });

    dom.copyLinkBtn.addEventListener('click', async function () {
      var ok = await window.Share.copyText(shareUrl());
      toast(ok ? t('share.copied') : t('share.failed'));
    });
  }

  function buildShareCanvas() {
    return window.Share.render({
      t: t,
      result: state.result || 0,
      pity: state.pity,
      budget: state.budget,
      threshold: state.threshold,
      targets: state.targets,
      bannerCount: activeBanners().length,
      curve: state.curve || [],
      maxX: Math.max(1, state.budget),
      stats: state.bannerStats.length ? state.bannerStats[0].stats : null,
      weapon: state.weapon,
      url: shareUrl(),
    });
  }

  // ------------------------------------------------------------ 啟動
  function cacheDom() {
    var ids = ['banners', 'pity', 'budget', 'threshold', 'calcBtn', 'resetBtn',
      'gauge', 'gaugeBar', 'gaugeValue', 'resultSummary',
      'weaponUp', 'weaponNote', 'weaponStats', 'weaponSub', 'weaponBox', 'wExtra', 'wClaims',
      'stats', 'statsSub', 'curveBox', 'costBox', 'shareCard',
      'copyTextBtn', 'copyImageBtn', 'downloadBtn', 'copyLinkBtn',
      'rulesBtn', 'rulesClose', 'rulesBody', 'rulesTitle', 'modal', 'toast'];
    ids.forEach(function (id) {
      dom[id] = document.getElementById(id);
    });
  }

  function init() {
    cacheDom();
    state.lang = window.I18N.detect();
    var fromUrl = readUrl();
    if (fromUrl) window.I18N.save(state.lang);

    applyI18n(true);
    syncInputsFromState();
    bindEvents();
    window.Gacha.setThreshold(state.threshold);

    window.Gacha.init('gacha.wasm').then(function () {
      window.Gacha.setThreshold(state.threshold);
      run();
    }).catch(function (err) {
      console.error(err);
      dom.resultSummary.textContent = '無法載入 gacha.wasm：' + (err && err.message ? err.message : err);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
