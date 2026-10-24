/* share.js — 分享：文字摘要 / 連結 / 圖片（Canvas 產生，可複製或下載）
   不依賴任何外部服務，離線也能產生 PNG。 */
(function (root) {
  'use strict';

  var IMG_W = 1080, IMG_H = 1360, SCALE = 2;

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawBackground(ctx) {
    var g = ctx.createLinearGradient(0, 0, IMG_W, IMG_H);
    g.addColorStop(0, '#08080e');
    g.addColorStop(0.5, '#0c0d16');
    g.addColorStop(1, '#080a12');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, IMG_W, IMG_H);

    var blobs = [
      [IMG_W * 0.15, IMG_H * 0.1, 420, 'rgba(110,168,254,0.22)'],
      [IMG_W * 0.9, IMG_H * 0.22, 380, 'rgba(180,135,255,0.20)'],
      [IMG_W * 0.45, IMG_H * 0.95, 460, 'rgba(75,227,192,0.14)'],
    ];
    blobs.forEach(function (b) {
      var rg = ctx.createRadialGradient(b[0], b[1], 0, b[0], b[1], b[2]);
      rg.addColorStop(0, b[3]);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, IMG_W, IMG_H);
    });

    ctx.fillStyle = 'rgba(255,255,255,0.045)';
    for (var y = 0; y < IMG_H; y += 26) {
      for (var x = (y / 26) % 2 ? 13 : 0; x < IMG_W; x += 26) {
        ctx.fillRect(x, y, 1.6, 1.6);
      }
    }
  }

  function drawCurve(ctx, box, points, maxX, t) {
    var x0 = box.x, y0 = box.y, w = box.w, h = box.h;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    roundRect(ctx, x0, y0, w, h, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();

    var padL = 64, padR = 26, padT = 58, padB = 40;
    var px = x0 + padL, py = y0 + padT, pw = w - padL - padR, ph = h - padT - padB;

    ctx.font = '600 20px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(200,208,230,0.75)';
    ctx.fillText(t('chart.curve.title'), x0 + 26, y0 + 40);

    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.setLineDash([4, 6]);
    for (var i = 0; i <= 4; i++) {
      var yy = py + ph * (1 - i / 4);
      ctx.beginPath(); ctx.moveTo(px, yy); ctx.lineTo(px + pw, yy); ctx.stroke();
      ctx.fillStyle = 'rgba(150,158,180,0.9)';
      ctx.font = '500 16px Inter, system-ui, sans-serif';
      ctx.fillText((i * 25) + '%', px - 46, yy + 6);
    }
    ctx.setLineDash([]);

    if (!points || !points.length) { ctx.restore(); return; }

    var sx = function (x) { return px + (pw * x) / maxX; };
    var sy = function (v) { return py + ph * (1 - v); };

    // 面積
    var grad = ctx.createLinearGradient(0, py, 0, py + ph);
    grad.addColorStop(0, 'rgba(150,175,255,0.42)');
    grad.addColorStop(1, 'rgba(150,175,255,0)');
    ctx.beginPath();
    ctx.moveTo(sx(points[0].x), sy(points[0].y));
    points.forEach(function (p) { ctx.lineTo(sx(p.x), sy(p.y)); });
    ctx.lineTo(sx(points[points.length - 1].x), py + ph);
    ctx.lineTo(sx(points[0].x), py + ph);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // 線
    var lg = ctx.createLinearGradient(px, 0, px + pw, 0);
    lg.addColorStop(0, '#8ec0ff');
    lg.addColorStop(0.55, '#b99cff');
    lg.addColorStop(1, '#8ff2dc');
    ctx.beginPath();
    points.forEach(function (p, idx) {
      if (idx === 0) ctx.moveTo(sx(p.x), sy(p.y));
      else ctx.lineTo(sx(p.x), sy(p.y));
    });
    ctx.strokeStyle = lg;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();

    // 目前位置
    var last = points[points.length - 1];
    ctx.beginPath();
    ctx.arc(sx(last.x), sy(last.y), 7, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#8ec0ff';
    ctx.lineWidth = 3;
    ctx.stroke();

    // x 軸
    ctx.fillStyle = 'rgba(150,158,180,0.9)';
    ctx.font = '500 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    [0, Math.round(maxX / 2), maxX].forEach(function (v) {
      ctx.fillText(String(v), sx(v), py + ph + 28);
    });
    ctx.textAlign = 'left';
    ctx.restore();
  }

  function wrap(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    var words = String(text).split(' ');
    var line = '';
    var lines = [];
    for (var i = 0; i < words.length; i++) {
      var test = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(test).width > maxWidth && line) {
        lines.push(line);
        line = words[i];
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    if (maxLines && lines.length > maxLines) lines = lines.slice(0, maxLines);
    lines.forEach(function (l, idx) { ctx.fillText(l, x, y + idx * lineHeight); });
    return lines.length;
  }

  /**
   * 產生分享圖。
   * @param {object} data {result, pity, budget, targets, bannerCount, curve, maxX, stats, url, lang, t}
   */
  function render(data) {
    var t = data.t;
    var canvas = document.createElement('canvas');
    canvas.width = IMG_W * SCALE;
    canvas.height = IMG_H * SCALE;
    var ctx = canvas.getContext('2d');
    ctx.scale(SCALE, SCALE);

    drawBackground(ctx);

    // ---- 標題 ----
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.font = '800 46px Inter, system-ui, sans-serif';
    ctx.fillText(t('share.imageTitle'), 64, 108);
    ctx.fillStyle = 'rgba(160,168,192,0.95)';
    ctx.font = '500 22px Inter, system-ui, sans-serif';
    ctx.fillText(t('app.tagline'), 64, 148);

    // ---- 大數字 ----
    var pct = (Math.max(0, Math.min(1, data.result)) * 100);
    var txt = pct.toFixed(4) + '%';
    ctx.font = '800 132px Inter, system-ui, sans-serif';
    var grad = ctx.createLinearGradient(64, 200, 700, 340);
    grad.addColorStop(0, '#a8c7ff');
    grad.addColorStop(0.6, '#d4b6ff');
    grad.addColorStop(1, '#8ff2dc');
    ctx.fillStyle = grad;
    ctx.fillText(txt, 64, 296);

    ctx.fillStyle = 'rgba(190,198,222,0.9)';
    ctx.font = '600 24px Inter, system-ui, sans-serif';
    ctx.fillText(t('result.caption'), 64, 340);

    // ---- 條件摘要 ----
    var summary = t('result.summary', {
      banners: data.bannerCount,
      targets: data.targets.reduce(function (a, b) { return a + b; }, 0),
      budget: data.budget,
    });
    ctx.fillStyle = 'rgba(220,226,245,0.95)';
    ctx.font = '600 26px Inter, system-ui, sans-serif';
    ctx.fillText(summary, 64, 400);

    ctx.fillStyle = 'rgba(150,158,182,0.95)';
    ctx.font = '500 22px Inter, system-ui, sans-serif';
    var detail = '🎯 ' + data.targets.filter(function (v) { return v > 0; }).join(' / ') +
      '   🎲 pity ' + data.pity +
      '   ⚙️ threshold ' + data.threshold;
    ctx.fillText(detail, 64, 442);

    // ---- 曲線 ----
    drawCurve(ctx, { x: 64, y: 486, w: IMG_W - 128, h: 420 }, data.curve, data.maxX || data.budget || 1, t);

    // ---- 統計三格 ----
    var st = data.stats || {};
    var pick = function (v) { return (typeof v === 'number' && isFinite(v)) ? Math.round(v) + ' ' + t('unit.pull') : '—'; };
    var median = (st.median !== undefined) ? st.median : st.p50;
    var cells = [
      { label: t('stats.mean'), value: pick(st.mean) },
      { label: t('stats.median'), value: pick(median) },
      { label: t('stats.p90'), value: pick(st.p90) },
    ];
    var cw = (IMG_W - 128 - 2 * 20) / 3;
    cells.forEach(function (c, i) {
      var cx = 64 + i * (cw + 20);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      roundRect(ctx, cx, 950, cw, 132, 20);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.09)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.96)';
      ctx.font = '800 40px Inter, system-ui, sans-serif';
      ctx.fillText(c.value, cx + 24, 1012);
      ctx.fillStyle = 'rgba(160,168,192,0.95)';
      ctx.font = '600 20px Inter, system-ui, sans-serif';
      ctx.fillText(c.label, cx + 24, 1052);
    });

    // ---- 武器池 ----
    if (data.weapon) {
      ctx.fillStyle = 'rgba(255,180,94,0.95)';
      ctx.font = '700 24px Inter, system-ui, sans-serif';
      var line = '⚔️ ' + t('weapon.upCaption') + ' ' + (data.weapon.upProb * 100).toFixed(2) + '%' +
        '   ·   ' + t('weapon.claims') + ' ' + Math.round(data.weapon.claims.p50) + ' ' + t('weapon.unit');
      ctx.fillText(line, 64, 1128);
    }

    // ---- 頁尾 ----
    ctx.fillStyle = 'rgba(120,128,150,0.95)';
    ctx.font = '500 20px Inter, system-ui, sans-serif';
    wrap(ctx, t('footer.credit'), 64, 1180, IMG_W - 128, 30, 2);
    ctx.fillStyle = 'rgba(160,170,200,0.95)';
    ctx.font = '600 22px Inter, system-ui, sans-serif';
    ctx.fillText(data.url || '', 64, 1270);

    ctx.fillStyle = 'rgba(110,168,254,0.85)';
    ctx.font = '700 20px Inter, system-ui, sans-serif';
    ctx.fillText('github.com/deelong223/Arknights-gacha-probability-calculator', 64, 1306);

    return canvas;
  }

  function toBlob(canvas) {
    return new Promise(function (resolve) {
      if (canvas.toBlob) canvas.toBlob(resolve, 'image/png');
      else resolve(null);
    });
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'endfield-gacha.png';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  }

  async function copyImage(canvas) {
    var blob = await toBlob(canvas);
    if (!blob) return false;
    try {
      if (navigator.clipboard && root.ClipboardItem) {
        await navigator.clipboard.write([new root.ClipboardItem({ 'image/png': blob })]);
        return true;
      }
    } catch (e) { /* 落到下載 */ }
    download(blob);
    return false;
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* ignore */ }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  root.Share = { render: render, toBlob: toBlob, download: download, copyImage: copyImage, copyText: copyText };
})(typeof globalThis !== 'undefined' ? globalThis : this);
