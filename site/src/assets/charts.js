/* PGX_AI_Adventures — chart renderer. Draws the chart specs that build.mjs
   embeds in each week page (<div class="chart"><script type="application/json">).
   Plain SVG, no libraries. Follows a few fixed rules: thin marks, hairline grid,
   a legend whenever there are two or more series, a crosshair + one tooltip that
   lists every series, and a table view (rendered by the build) as the twin. */
(function () {
  'use strict';
  var SERIES = ['#17a865', '#3b8fe8', '#d24f9c', '#bf8300', '#8a78ee', '#d9602a'];
  var SVG = 'http://www.w3.org/2000/svg';
  var tip = document.getElementById('tip');

  function el(name, attrs, parent) {
    var n = document.createElementNS(SVG, name);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function html(name, cls, parent, text) {
    var n = document.createElement(name);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }
  function fmt(v, unit) {
    if (v == null || !isFinite(v)) return '–';
    var a = Math.abs(v);
    var d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : null;
    var s = d == null ? String(Number(v.toPrecision(3))) : v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    if (unit === '%' || unit === 'ratio') return unit === 'ratio' ? (v * 100).toFixed(1) + '%' : s + '%';
    return unit ? s + ' ' + unit : s;
  }
  function fmtTick(v, step) {
    var d;
    if (step != null && step > 0) d = step >= 1 ? 0 : Math.min(6, Math.ceil(-Math.log10(step)));
    else { var a = Math.abs(v); d = a >= 100 ? 0 : a >= 1 ? 2 : 4; }
    return v.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: d });
  }
  function fmtTime(ms) { var d = new Date(ms); return d.toISOString().slice(11, 19); }
  function niceStep(range, count) {
    var raw = range / Math.max(1, count);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var r = raw / mag;
    var s = r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10;
    return s * mag;
  }
  function ticks(min, max, count) {
    if (max === min) { max = min + 1; }
    var step = niceStep(max - min, count);
    var t0 = Math.ceil(min / step) * step; var out = [];
    for (var v = t0; v <= max + step * 1e-9; v += step) out.push(+v.toFixed(10));
    return out;
  }
  function textWidth(s, size) { return String(s).length * size * 0.58; }

  function showTip(x, y, build) {
    if (!tip) return;
    tip.innerHTML = '';
    build(tip);
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var px = x + 14, py = y + 14;
    if (px + r.width > window.innerWidth - 8) px = x - r.width - 14;
    if (py + r.height > window.innerHeight - 8) py = y - r.height - 14;
    tip.style.left = Math.max(8, px) + 'px'; tip.style.top = Math.max(8, py) + 'px';
  }
  function hideTip() { if (tip) tip.hidden = true; }
  function tipRow(parent, color, name, value, key) {
    var row = html('div', 'tip__row', parent);
    var k = html('span', 'key' + (key === 'rect' ? ' key--rect' : ''), row); k.style.background = color;
    html('span', null, row, name);
    html('strong', null, row, value);
  }

  function render(box) {
    var script = box.querySelector('script[type="application/json"]');
    if (!script) return;
    var spec; try { spec = JSON.parse(script.textContent); } catch (e) { return; }
    var old = box.querySelector('svg'); if (old) old.remove();
    var oldLegend = box.parentNode.querySelector('.legend'); if (oldLegend) oldLegend.remove();
    var W = Math.max(280, box.clientWidth || 600);
    if (spec.kind === 'bar') renderBar(box, spec, W); else renderLine(box, spec, W);
    if (spec.series.length >= 2) {
      var legend = html('ul', 'legend', null);
      legend.setAttribute('aria-label', 'Series');
      spec.series.forEach(function (s, i) {
        var li = html('li', null, legend);
        var k = html('span', 'key' + (spec.kind === 'bar' ? ' key--rect' : ''), li); k.style.background = SERIES[i % SERIES.length];
        html('span', null, li, s.name);
      });
      box.parentNode.insertBefore(legend, box.nextSibling);
    }
  }

  function renderLine(box, spec, W) {
    var H = 300;
    var isTime = spec.xType === 'time';
    var allX = [], allY = [];
    spec.series.forEach(function (s) { s.points.forEach(function (p) { allX.push(p[0]); allY.push(p[1]); }); });
    if (!allX.length) return;
    var xmin = Math.min.apply(null, allX), xmax = Math.max.apply(null, allX);
    var ymin = Math.min.apply(null, allY), ymax = Math.max.apply(null, allY);
    var zoomed = false;
    var y0, y1;
    if (ymin >= 0 && ymax > 0 && (ymax - ymin) / ymax < 0.1 && ymin > 0) { zoomed = true; var pad = (ymax - ymin) * 0.5 || ymax * 0.05; y0 = Math.max(0, ymin - pad); y1 = ymax + pad; }
    else { y0 = Math.min(0, ymin); y1 = ymax === y0 ? y0 + 1 : ymax; }
    var yT = ticks(y0, y1, 5); if (yT[yT.length - 1] < y1) yT.push(yT[yT.length - 1] + (yT[1] - yT[0])); y1 = yT[yT.length - 1]; y0 = Math.min(y0, yT[0]);
    var xT = isTime ? ticks(xmin, xmax, Math.min(6, Math.floor(W / 110))) : ticks(xmin, xmax, Math.min(10, Math.floor(W / 70)));
    if (!isTime && allX.every(function (v) { return v === Math.round(v); }) && (xmax - xmin) <= 20) { xT = []; for (var v = Math.ceil(xmin); v <= xmax; v++) xT.push(v); }
    var yLabelW = Math.max.apply(null, yT.map(function (t) { return textWidth(fmtTick(t, yT.length > 1 ? yT[1] - yT[0] : 1), 11.5); }));
    var endLabels = spec.series.length >= 2 && spec.series.length <= 4;
    var endW = endLabels ? Math.min(90, Math.max.apply(null, spec.series.map(function (s) { return textWidth(s.name, 11.5); })) + 10) : 0;
    var m = { t: 16, r: 16 + endW, b: 46, l: Math.ceil(yLabelW) + (spec.unit ? 34 : 14) };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var sx = function (x) { return m.l + (xmax === xmin ? pw / 2 : (x - xmin) / (xmax - xmin) * pw); };
    var sy = function (y) { return m.t + (1 - (y - y0) / (y1 - y0)) * ph; };

    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' }, box);
    var yStep = yT.length > 1 ? yT[1] - yT[0] : 1;
    yT.forEach(function (t) { el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }, svg); var tx = el('text', { class: 'tick', x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end' }, svg); tx.textContent = fmtTick(t, yStep); });
    el('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: sy(y0), y2: sy(y0) }, svg);
    xT.forEach(function (t) { var tx = el('text', { class: 'tick', x: sx(t), y: H - m.b + 18, 'text-anchor': 'middle' }, svg); tx.textContent = isTime ? fmtTime(t) : fmtTick(t, xT.length > 1 ? xT[1] - xT[0] : 1); });
    var xl = el('text', { class: 'axlabel', x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, svg); xl.textContent = spec.xLabel + (isTime ? ' (UTC)' : '');
    var yl = el('text', { class: 'axlabel', x: 12, y: m.t + ph / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (m.t + ph / 2) + ')' }, svg); yl.textContent = spec.unit || '';
    if (zoomed) { var zn = el('text', { class: 'zoom-note', x: W - m.r, y: m.t - 4, 'text-anchor': 'end' }, svg); zn.textContent = 'y-axis zoomed to the data range (does not start at 0)'; }

    var usedEnd = [];
    spec.series.forEach(function (s, i) {
      var color = SERIES[i % SERIES.length];
      var pts = s.points.slice().sort(function (a, b) { return a[0] - b[0]; });
      var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + sx(p[0]).toFixed(1) + ',' + sy(p[1]).toFixed(1); }).join(' ');
      if (spec.series.length === 1) el('path', { class: 'series-area', d: d + ' L' + sx(pts[pts.length - 1][0]).toFixed(1) + ',' + sy(y0) + ' L' + sx(pts[0][0]).toFixed(1) + ',' + sy(y0) + ' Z', fill: color }, svg);
      el('path', { class: 'series-line', d: d, stroke: color }, svg);
      if (pts.length <= 60) pts.forEach(function (p) { el('circle', { class: 'series-dot', cx: sx(p[0]), cy: sy(p[1]), r: 4, fill: color }, svg); });
      if (endLabels) {
        var last = pts[pts.length - 1]; var ly = sy(last[1]);
        if (!usedEnd.some(function (u) { return Math.abs(u - ly) < 13; })) { usedEnd.push(ly); var t = el('text', { class: 'endlabel', x: sx(last[0]) + 8, y: ly + 4 }, svg); t.textContent = s.name; }
      }
    });

    // hover layer
    var cross = el('line', { class: 'crosshair', x1: 0, x2: 0, y1: m.t, y2: m.t + ph }, svg);
    var dots = spec.series.map(function (s, i) { return el('circle', { class: 'hover-dot', r: 5, fill: SERIES[i % SERIES.length] }, svg); });
    var hit = el('rect', { class: 'hit', x: m.l, y: m.t, width: pw, height: ph }, svg);
    var xs = allX.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(function (a, b) { return a - b; });
    var idx = -1;
    function show(i, clientX, clientY) {
      if (i < 0 || i >= xs.length) return;
      idx = i; var xv = xs[i]; var px = sx(xv);
      cross.setAttribute('x1', px); cross.setAttribute('x2', px); cross.style.opacity = 1;
      var rows = [];
      spec.series.forEach(function (s, k) {
        var p = null; for (var j = 0; j < s.points.length; j++) if (s.points[j][0] === xv) { p = s.points[j]; break; }
        if (p) { dots[k].setAttribute('cx', px); dots[k].setAttribute('cy', sy(p[1])); dots[k].style.opacity = 1; rows.push([SERIES[k % SERIES.length], s.name, fmt(p[1], spec.unit)]); }
        else dots[k].style.opacity = 0;
      });
      var r = box.getBoundingClientRect();
      var cx = clientX != null ? clientX : r.left + px * (r.width / W);
      var cy = clientY != null ? clientY : r.top + m.t * (r.height / H) + 20;
      showTip(cx, cy, function (t) {
        html('div', 'tip__t', t, spec.xLabel + ' ' + (isTime ? fmtTime(xv) : fmtTick(xv)));
        rows.forEach(function (row) { tipRow(t, row[0], row[1], row[2]); });
      });
    }
    function hide() { cross.style.opacity = 0; dots.forEach(function (d) { d.style.opacity = 0; }); hideTip(); }
    hit.addEventListener('pointermove', function (e) {
      var r = box.getBoundingClientRect(); var px = (e.clientX - r.left) * (W / r.width);
      var best = 0, bd = Infinity;
      xs.forEach(function (v, i) { var d = Math.abs(sx(v) - px); if (d < bd) { bd = d; best = i; } });
      show(best, e.clientX, e.clientY);
    });
    hit.addEventListener('pointerleave', hide);
    box.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var n = idx < 0 ? 0 : idx + (e.key === 'ArrowRight' ? 1 : -1); show(Math.max(0, Math.min(xs.length - 1, n))); }
      if (e.key === 'Escape') hide();
    });
    box.addEventListener('blur', hide);
  }

  function renderBar(box, spec, W) {
    var H = 280;
    var cats = spec.x.values; var n = cats.length; var ns = spec.series.length;
    var allY = []; spec.series.forEach(function (s) { s.values.forEach(function (v) { if (v != null) allY.push(v); }); });
    if (!allY.length) return;
    var ymax = Math.max.apply(null, allY), ymin = Math.min(0, Math.min.apply(null, allY));
    var yT = ticks(ymin, ymax, 5); if (yT[yT.length - 1] < ymax) yT.push(yT[yT.length - 1] + (yT[1] - yT[0]));
    var y0 = Math.min(ymin, yT[0]), y1 = yT[yT.length - 1];
    var yLabelW = Math.max.apply(null, yT.map(function (t) { return textWidth(fmtTick(t, yT.length > 1 ? yT[1] - yT[0] : 1), 11.5); }));
    var m = { t: 16, r: 12, b: 48, l: Math.ceil(yLabelW) + (spec.unit ? 34 : 14) };
    var pw = W - m.l - m.r, ph = H - m.t - m.b;
    var band = pw / n;
    var gap = 2; var barW = Math.min(24, (band * 0.7 - gap * (ns - 1)) / ns);
    var groupW = barW * ns + gap * (ns - 1);
    var sy = function (y) { return m.t + (1 - (y - y0) / (y1 - y0)) * ph; };
    var svg = el('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, 'aria-hidden': 'true', focusable: 'false' }, box);
    var yStep = yT.length > 1 ? yT[1] - yT[0] : 1;
    yT.forEach(function (t) { el('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: sy(t), y2: sy(t) }, svg); var tx = el('text', { class: 'tick', x: m.l - 8, y: sy(t) + 4, 'text-anchor': 'end' }, svg); tx.textContent = fmtTick(t, yStep); });
    el('line', { class: 'axis', x1: m.l, x2: W - m.r, y1: sy(0), y2: sy(0) }, svg);
    var yl = el('text', { class: 'axlabel', x: 12, y: m.t + ph / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (m.t + ph / 2) + ')' }, svg); yl.textContent = spec.unit || '';
    var bars = [];
    cats.forEach(function (c, i) {
      var cx = m.l + band * i + band / 2;
      var label = String(c); if (textWidth(label, 11.5) > band - 6) label = label.slice(0, Math.max(3, Math.floor((band - 6) / 6.7))) + '…';
      var tx = el('text', { class: 'tick', x: cx, y: H - m.b + 18, 'text-anchor': 'middle' }, svg); tx.textContent = label;
      spec.series.forEach(function (s, k) {
        var v = s.values[i]; if (v == null) return;
        var x = cx - groupW / 2 + k * (barW + gap);
        var yTop = sy(Math.max(0, v)), yBase = sy(Math.min(0, v));
        var h = Math.max(0, yBase - yTop); var rr = Math.min(4, h / 2);
        var d = 'M' + x + ',' + yBase + ' V' + (yTop + rr) + ' a' + rr + ',' + rr + ' 0 0 1 ' + rr + ',-' + rr + ' h' + (barW - 2 * rr) + ' a' + rr + ',' + rr + ' 0 0 1 ' + rr + ',' + rr + ' V' + yBase + ' Z';
        var bar = el('path', { class: 'bar', d: d, fill: SERIES[k % SERIES.length] }, svg);
        var hitR = el('rect', { class: 'hit', x: x - gap, y: m.t, width: barW + 2 * gap, height: ph }, svg);
        bars.push(bar);
        function over(e) {
          bars.forEach(function (b) { b.classList.add('is-dim'); }); bar.classList.remove('is-dim');
          showTip(e.clientX, e.clientY, function (t) { html('div', 'tip__t', t, spec.xLabel + ' ' + c); tipRow(t, SERIES[k % SERIES.length], s.name, fmt(v, spec.unit), 'rect'); });
        }
        function out() { bars.forEach(function (b) { b.classList.remove('is-dim'); }); hideTip(); }
        hitR.addEventListener('pointermove', over); hitR.addEventListener('pointerleave', out);
      });
    });
    var xl = el('text', { class: 'axlabel', x: m.l + pw / 2, y: H - 6, 'text-anchor': 'middle' }, svg); xl.textContent = spec.xLabel;
  }

  var boxes = document.querySelectorAll('.chart[data-chart]');
  if (!boxes.length) return;
  boxes.forEach(render);
  if ('ResizeObserver' in window) {
    var pending = null;
    var ro = new ResizeObserver(function () { clearTimeout(pending); pending = setTimeout(function () { boxes.forEach(render); }, 120); });
    boxes.forEach(function (b) { ro.observe(b); });
  } else {
    var t2 = null; window.addEventListener('resize', function () { clearTimeout(t2); t2 = setTimeout(function () { boxes.forEach(render); }, 150); });
  }
})();
