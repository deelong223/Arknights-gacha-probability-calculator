/* charts.js — 純 SVG 圖表（無外部依賴，離線可用）
   1) renderCurve：成功率累積曲線（可 hover 顯示、可點擊設定預算）
   2) renderCost ：各期達標抽數（中位數 / P10–P90 / 平均） */
(function (root) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function el(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    if (attrs) for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) node.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(node);
    return node;
  }

  function niceStep(range) {
    var raw = range / 6;
    var pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
    var n = raw / pow;
    var mult = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
    return Math.max(1, mult * pow);
  }

  // ------------------------------------------------------------- 曲線圖
  function renderCurve(container, opts) {
    var t = opts.t;
    var points = opts.points || [];
    var onPick = opts.onPick;
    container.innerHTML = '';

    if (!points.length) {
      var empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = t('chart.empty');
      container.appendChild(empty);
      return;
    }

    var W = 640, H = 260, padL = 42, padR = 14, padT = 16, padB = 26;
    var maxX = Math.max(1, opts.maxX || points[points.length - 1].x);
    var plotW = W - padL - padR, plotH = H - padT - padB;

    var sx = function (x) { return padL + (plotW * x) / maxX; };
    var sy = function (y) { return padT + plotH * (1 - y); };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, role: 'img', 'aria-label': t('chart.curve.title') }, container);

    var defs = el('defs', null, svg);
    var lg = el('linearGradient', { id: 'lineGrad', x1: '0', y1: '0', x2: '1', y2: '1' }, defs);
    el('stop', { offset: '0%', 'stop-color': '#8ec0ff' }, lg);
    el('stop', { offset: '55%', 'stop-color': '#b99cff' }, lg);
    el('stop', { offset: '100%', 'stop-color': '#8ff2dc' }, lg);
    var ag = el('linearGradient', { id: 'areaGrad', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
    el('stop', { offset: '0%', 'stop-color': 'rgba(140,170,255,0.42)' }, ag);
    el('stop', { offset: '100%', 'stop-color': 'rgba(140,170,255,0)' }, ag);

    // 格線 + y 軸標籤
    var g = el('g', { class: 'axis' }, svg);
    for (var i = 0; i <= 4; i++) {
      var yv = i / 4;
      el('line', { class: 'grid-line', x1: padL, x2: W - padR, y1: sy(yv), y2: sy(yv) }, g);
      var label = el('text', { x: padL - 8, y: sy(yv) + 3.5, 'text-anchor': 'end' }, g);
      label.textContent = Math.round(yv * 100) + '%';
    }
    // x 軸刻度
    var step = niceStep(maxX);
    for (var xv = 0; xv <= maxX + 0.001; xv += step) {
      var tx = el('text', { x: sx(xv), y: H - 8, 'text-anchor': 'middle' }, g);
      tx.textContent = Math.round(xv);
    }
    el('line', { class: 'axis-line', x1: padL, x2: W - padR, y1: H - padB, y2: H - padB, stroke: 'rgba(255,255,255,0.18)' }, g);

    // 120 / 240 參考線
    [120, 240].forEach(function (guard) {
      if (guard > maxX) return;
      el('line', { class: 'marker-guide', x1: sx(guard), x2: sx(guard), y1: padT, y2: H - padB }, svg);
      if (guard < maxX * 0.92) {
        var gt = el('text', { class: 'marker-text', x: sx(guard) + 3, y: padT + 9 }, svg);
        gt.textContent = guard;
      }
    });

    // 線 + 面積
    var d = '';
    points.forEach(function (p, idx) {
      d += (idx === 0 ? 'M' : 'L') + sx(p.x).toFixed(2) + ' ' + sy(p.y).toFixed(2) + ' ';
    });
    var areaD = d + 'L' + sx(points[points.length - 1].x).toFixed(2) + ' ' + sy(0) + ' L' + sx(points[0].x).toFixed(2) + ' ' + sy(0) + ' Z';
    el('path', { class: 'series-area', d: areaD }, svg);
    var line = el('path', { class: 'series-line', d: d }, svg);

    // 目前預算標記
    var live = points[points.length - 1];
    el('circle', { class: 'marker-live', cx: sx(live.x), cy: sy(live.y), r: 4.5 }, svg);

    // hover 互動
    var hoverLine = el('line', { class: 'hover-line', y1: padT, y2: H - padB }, svg);
    var hoverDot = el('circle', { class: 'marker-live', r: 4, opacity: 0 }, svg);
    var tip = document.createElement('div');
    tip.className = 'chart-tip';
    container.appendChild(tip);

    function nearest(clientX) {
      var box = svg.getBoundingClientRect();
      var rel = ((clientX - box.left) / box.width) * W;
      var best = points[0], bestD = Infinity;
      points.forEach(function (p) {
        var dd = Math.abs(sx(p.x) - rel);
        if (dd < bestD) { bestD = dd; best = p; }
      });
      return best;
    }

    svg.addEventListener('mousemove', function (ev) {
      var p = nearest(ev.clientX);
      hoverLine.setAttribute('x1', sx(p.x));
      hoverLine.setAttribute('x2', sx(p.x));
      hoverLine.style.opacity = 0.8;
      hoverDot.setAttribute('cx', sx(p.x));
      hoverDot.setAttribute('cy', sy(p.y));
      hoverDot.style.opacity = 1;
      tip.textContent = t('chart.tip', { x: Math.round(p.x), y: (p.y * 100).toFixed(2) });
      var box = svg.getBoundingClientRect();
      tip.style.left = ((sx(p.x) / W) * box.width) + 'px';
      tip.style.top = ((sy(p.y) / H) * box.height) + 'px';
      tip.classList.add('show');
    });
    svg.addEventListener('mouseleave', function () {
      tip.classList.remove('show');
      hoverLine.style.opacity = 0;
      hoverDot.style.opacity = 0;
    });
    svg.addEventListener('click', function (ev) {
      if (typeof onPick !== 'function') return;
      onPick(Math.round(nearest(ev.clientX).x));
    });
    svg.style.cursor = typeof onPick === 'function' ? 'crosshair' : 'default';

    // 進場動畫：把路徑長度餵給 CSS 的 stroke-dasharray（動畫本身在 styles.css）
    try {
      var len = line.getTotalLength();
      line.style.setProperty('--len', len);
    } catch (e) { /* 少數環境沒有 getTotalLength，忽略 */ }
  }

  // ------------------------------------------------------------- 抽數分布
  function renderCost(container, rows, t) {
    container.innerHTML = '';
    if (!rows || !rows.length) {
      var empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = t('chart.empty');
      container.appendChild(empty);
      return;
    }
    var maxV = 1;
    rows.forEach(function (r) { maxV = Math.max(maxV, r.p90 || 0, r.mean || 0, r.median || 0); });
    maxV = Math.ceil(maxV * 1.08) || 1;

    rows.forEach(function (r, i) {
      var row = document.createElement('div');
      row.className = 'cost-row';

      var name = document.createElement('span');
      name.textContent = r.label;
      row.appendChild(name);

      var track = document.createElement('div');
      track.className = 'cost-track';

      var range = document.createElement('div');
      range.className = 'cost-range';
      var l = Math.max(0, (r.p10 || 0) / maxV * 100);
      var rr = Math.min(100, (r.p90 || 0) / maxV * 100);
      range.style.left = l + '%';
      range.style.width = Math.max(1, rr - l) + '%';
      track.appendChild(range);

      var bar = document.createElement('div');
      bar.className = 'cost-bar';
      bar.style.left = '0';
      bar.style.width = '0%';
      setTimeout(function () { bar.style.width = Math.max(1, (r.median || 0) / maxV * 100) + '%'; }, 60 + i * 70);
      track.appendChild(bar);

      var mean = document.createElement('div');
      mean.className = 'cost-mean';
      mean.style.left = Math.min(99, (r.mean || 0) / maxV * 100) + '%';
      track.appendChild(mean);

      row.appendChild(track);

      var val = document.createElement('b');
      val.textContent = Math.round(r.median || 0) + ' ' + t('unit.pull');
      row.appendChild(val);

      container.appendChild(row);
    });


  }

  root.Charts = { renderCurve: renderCurve, renderCost: renderCost };
})(typeof globalThis !== 'undefined' ? globalThis : this);
