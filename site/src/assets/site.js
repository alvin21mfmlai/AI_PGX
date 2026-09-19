/* PGX_AI_Adventures — page behaviour (navigation, reveal, counters, code tools, tabs, scroll-spy). */
(function () {
  'use strict';
  var doc = document;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- navigation toggle (mobile)
  var toggle = doc.querySelector('.nav__toggle');
  var links = doc.getElementById('navlinks');
  if (toggle && links) {
    toggle.addEventListener('click', function () {
      var open = links.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    links.addEventListener('click', function (e) { if (e.target.closest('a')) { links.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); } });
    doc.addEventListener('keydown', function (e) { if (e.key === 'Escape' && links.classList.contains('is-open')) { links.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); } });
  }

  // --- reveal on scroll
  var rv = doc.querySelectorAll('.rv');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });
    rv.forEach(function (el) { io.observe(el); });
    // Anything already in view on load (above the fold) shows immediately.
    setTimeout(function () { rv.forEach(function (el) { var r = el.getBoundingClientRect(); if (r.top < window.innerHeight && r.bottom > 0) el.classList.add('is-in'); }); }, 60);
  } else { rv.forEach(function (el) { el.classList.add('is-in'); }); }

  // --- count-up numbers
  function fmt(n, d) { return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }); }
  var counters = doc.querySelectorAll('[data-count]');
  function runCounter(el) {
    var target = parseFloat(el.getAttribute('data-count'));
    var d = parseInt(el.getAttribute('data-decimals') || '0', 10);
    if (!isFinite(target) || reduce) { el.textContent = fmt(target, d); return; }
    var t0 = null; var dur = 1100;
    function step(ts) {
      if (!t0) t0 = ts;
      var p = Math.min(1, (ts - t0) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(target * e, d);
      if (p < 1) requestAnimationFrame(step); else el.textContent = fmt(target, d);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var cio = new IntersectionObserver(function (entries) { entries.forEach(function (en) { if (en.isIntersecting) { runCounter(en.target); cio.unobserve(en.target); } }); }, { threshold: 0.3 });
    counters.forEach(function (el) { cio.observe(el); });
  } else { counters.forEach(runCounter); }

  // --- code: copy + expand
  doc.addEventListener('click', function (e) {
    var copy = e.target.closest('[data-copy]');
    if (copy) {
      var pre = copy.closest('.code').querySelector('pre');
      var text = pre ? pre.textContent : '';
      var done = function () { copy.textContent = 'Copied'; copy.classList.add('is-done'); setTimeout(function () { copy.textContent = 'Copy'; copy.classList.remove('is-done'); }, 1600); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
      else { fallbackCopy(text); done(); }
    }
    var expand = e.target.closest('[data-expand]');
    if (expand) { var box = expand.closest('.code'); box.classList.remove('is-collapsed'); expand.remove(); }
  });
  function fallbackCopy(text) {
    var ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.left = '-9999px';
    doc.body.appendChild(ta); ta.select(); try { doc.execCommand('copy'); } catch (err) { /* ignore */ } doc.body.removeChild(ta);
  }

  // --- tabs
  doc.querySelectorAll('[data-tabs]').forEach(function (tabs) {
    var list = tabs.querySelectorAll('[role="tab"]');
    var panels = tabs.querySelectorAll('[role="tabpanel"]');
    function select(i) {
      list.forEach(function (t, k) { var on = k === i; t.setAttribute('aria-selected', on ? 'true' : 'false'); t.tabIndex = on ? 0 : -1; });
      panels.forEach(function (p, k) { p.hidden = k !== i; });
    }
    list.forEach(function (t, i) {
      t.addEventListener('click', function () { select(i); });
      t.addEventListener('keydown', function (e) {
        var n = i;
        if (e.key === 'ArrowRight') n = (i + 1) % list.length; else if (e.key === 'ArrowLeft') n = (i - 1 + list.length) % list.length;
        else if (e.key === 'Home') n = 0; else if (e.key === 'End') n = list.length - 1; else return;
        e.preventDefault(); select(n); list[n].focus();
      });
    });
  });

  // --- scroll-spy for the week page sub-navigation
  var secs = doc.querySelectorAll('.wsec[id]');
  var spyLinks = doc.querySelectorAll('.subnav a[href^="#"], .aside__toc a[href^="#"]');
  if (secs.length && spyLinks.length && 'IntersectionObserver' in window) {
    var current = null;
    var sio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) current = en.target.id; });
      if (current) spyLinks.forEach(function (a) { a.classList.toggle('is-active', a.getAttribute('href') === '#' + current); });
    }, { rootMargin: '-35% 0px -55% 0px', threshold: 0 });
    secs.forEach(function (s) { sio.observe(s); });
  }
})();
