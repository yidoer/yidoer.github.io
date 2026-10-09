/**
 * 桌面宠物 · 毛绒蟹
 *
 * 有 WebGPU：整张页面就是它的桌面——一块铺满视口的透明画布，没有卡片、没有工具条，
 * 蟹自己会在页面上溜达。直接上手就行：抓起来揉、掰腿、抛一抛，鼠标靠近它的眼睛会跟着你，
 * 点一下它会挥爪或咔嚓两下。
 * 没有 WebGPU：退回一张会动的精灵图，只能看不能捏。
 *
 * 网址后缀可关掉：?pet=off（彻底不要） / ?pet=sprite（只要那张轻量精灵图）。
 */
(function () {
  'use strict';

  var ATLAS = '/images/pet/crab-atlas.webp';
  var MODULE_URL = '/pet/crab.js';

  var query = window.location.search;
  if (/(^|[?&])pet=off(&|$)/.test(query)) return;
  var forceSprite = /(^|[?&])pet=sprite(&|$)/.test(query);

  var page = window.location.pathname.split('/').pop() || 'index.html';
  if (/editor\.html$/.test(page)) return;
  if (!window.matchMedia('(min-width: 900px) and (min-height: 620px)').matches) return;

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var SW = 460, SH = 410;   // the patch of desktop the crab occupies inside the full-screen canvas

  // ─────────────────────────────────────────────────────────────
  //  the light version: one image, eight frames a row
  // ─────────────────────────────────────────────────────────────
  function startSprite() {
    var COLS = 8, SIZE = 128;
    var rows = { idle: [0, 7, 1], walkL: [2, 11, 1], walkR: [1, 11, 1], wave: [3, 8, 0], snip: [4, 7, 0], hide: [5, 7, 0] };
    var el = document.createElement('div');
    el.className = 'pet-sprite';
    el.title = '毛绒蟹';
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', '一只会走动的毛绒蟹');
    var sheet = document.createElement('i');
    sheet.className = 'pet-sheet';
    sheet.style.backgroundImage = 'url(' + ATLAS + ')';
    sheet.style.backgroundSize = (COLS * SIZE) + 'px ' + (Object.keys(rows).length * SIZE) + 'px';
    el.appendChild(sheet);
    document.body.appendChild(el);

    var state = { name: 'idle', t: 0 }, walk = null, drag = null, next = 4 + Math.random() * 4;
    var sx = null, sy = null, last = performance.now();
    function limit(v) { return Math.min(Math.max(v, 8), Math.max(8, window.innerWidth - SIZE - 8)); }
    function show(name, restart) { if (restart || state.name !== name) { state.name = name; state.t = 0; } }
    function render() {
      if (sx === null) sx = window.innerWidth - SIZE - 150;
      if (sy === null) sy = window.innerHeight - SIZE - 22;
      sx = limit(sx); sy = Math.min(Math.max(sy, 8), Math.max(8, window.innerHeight - SIZE - 8));
      el.style.transform = 'translate(' + Math.round(sx) + 'px,' + Math.round(sy) + 'px)';
    }
    function frame(now) {
      requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; }
      var dt = Math.min((now - last) / 1000, 0.1); last = now;
      if (drag && now - drag.at > 1200) drag = null;
      if (drag) return;
      if (walk) {
        var dx = walk.to - sx;
        sx = limit(sx + Math.sign(dx) * Math.min(Math.abs(dx), walk.speed * dt));
        render();
        if (Math.abs(walk.to - sx) < 1) { walk = null; show('idle', true); next = 3 + Math.random() * 5; }
      } else if (reduce.matches) { show('idle'); state.t = 0; }
      else {
        next -= dt;
        if (next <= 0) {
          var roll = Math.random();
          if (roll < 0.45) {
            var to = limit(sx + (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * Math.min(360, window.innerWidth * 0.4)));
            if (Math.abs(to - sx) > 40) { walk = { to: to, speed: 26 + Math.random() * 16 }; show(to > sx ? 'walkR' : 'walkL', true); }
          }
          if (!walk) { show(roll < 0.72 ? 'wave' : roll < 0.9 ? 'snip' : 'hide', true); next = 4 + Math.random() * 5; }
        }
      }
      var spec = rows[state.name];
      state.t += dt;
      var n = Math.floor(state.t * spec[1]);
      if (spec[2]) sheet.style.backgroundPosition = (-(n % COLS) * SIZE) + 'px ' + (-spec[0] * SIZE) + 'px';
      else if (n >= COLS) show('idle', true);
      else sheet.style.backgroundPosition = (-n * SIZE) + 'px ' + (-spec[0] * SIZE) + 'px';
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      drag = { dx: e.clientX - sx, dy: e.clientY - sy, ox: e.clientX, oy: e.clientY, id: e.pointerId, moved: false, at: performance.now() };
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      el.classList.add('dragging');
      e.preventDefault();
    });
    el.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag.at = performance.now();
      sx = e.clientX - drag.dx; sy = e.clientY - drag.dy;
      if (Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy) > 4) drag.moved = true;
      render();
    });
    function release() { if (drag) { drag = null; el.classList.remove('dragging'); } }
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    window.addEventListener('blur', release);
    window.addEventListener('resize', render);
    render();
    requestAnimationFrame(frame);
  }

  // ─────────────────────────────────────────────────────────────
  //  the workshop simulation, living on the page
  // ─────────────────────────────────────────────────────────────
  var UI = [
    '<div class="pet-live-ui" hidden>',
    '<aside class="panel"></aside><header class="masthead"></header><section class="readouts"></section>',
    '<div id="toast"></div><div id="status"><span id="statusText"></span></div>',
    '<div id="fallback" hidden><h2 id="fallbackTitle"></h2><p id="fallbackDetail"></p></div>',
    '<div id="swatches"></div>',
    '<input id="firmness" type="range"><input id="tempo" type="range"><input id="furlen" type="range">',
    '<output id="firmnessOut"></output><output id="tempoOut"></output><output id="furlenOut"></output>',
    '<button id="scuttle"></button><button id="snip"></button><button id="hide"></button><button id="wave"></button>',
    '<button id="straighten"></button><button id="smooth"></button><button id="reset"></button><button id="pause"></button>',
    '<input id="slow" type="checkbox"><input id="mesh" type="checkbox">',
    '<p id="hintText"></p><span id="massOut"></span><span id="volOut"></span><span id="stepOut"></span><span id="snipOut"></span>',
    '<span id="nParticles"></span><span id="nTets"></span><span id="nLeg"></span><span id="nShells"></span>',
    '</div>',
  ].join('');

  function startLive() {
    var host = document.createElement('div');
    host.className = 'pet-live';
    host.id = 'pet-live';
    host.innerHTML = '<canvas id="gl" aria-label="一只可以抓起来揉、掰腿、梳毛的毛绒蟹" role="img"></canvas>' + UI;
    document.body.appendChild(host);
    document.body.classList.add('pet-free');

    // the page is the crab's desktop: one full-viewport transparent canvas
    var stage = { x: 0, y: 0, w: SW, h: SH };
    window.__crabStage = stage;
    function settle(first) {
      if (first) {
        stage.x = window.innerWidth - SW - 34;
        stage.y = window.innerHeight - SH - 18;
      }
      stage.x = Math.min(Math.max(stage.x, 8), Math.max(8, window.innerWidth - SW - 8));
      stage.y = Math.min(Math.max(stage.y, 72), Math.max(72, window.innerHeight - SH - 8));
    }

    var canvas = host.querySelector('#gl');
    var crab = null, moving = null, idle = 4 + Math.random() * 5, held = false;

    // ── 指针只在真正碰到蟹的时候才交给它，页面其余地方照常点击 ──
    function over(ev) {
      if (!crab || held) return false;
      if (ev.clientX < stage.x || ev.clientX > stage.x + stage.w) return false;
      if (ev.clientY < stage.y || ev.clientY > stage.y + stage.h) return false;
      try {
        var ray = crab.rayFrom(ev.clientX, ev.clientY);
        if (crab.pick(ray) || Number.isFinite(crab.pickLeg(ray))) return true;
      } catch (_) { /* fall through to the body oval */ }
      // while it is walking the exact silhouette shifts between frames, so the body itself stays
      // grabbable: a wide, flat oval over the shell, leaving the corners clickable
      var ox = (ev.clientX - (stage.x + stage.w / 2)) / (stage.w * 0.44);
      var oy = (ev.clientY - (stage.y + stage.h * 0.54)) / (stage.h * 0.3);
      return ox * ox + oy * oy <= 1;
    }
    window.addEventListener('pointermove', function (e) {
      var hit = over(e);
      canvas.style.pointerEvents = hit ? 'auto' : 'none';
      host.classList.toggle('touching', hit);
    }, { passive: true });

    // ── 它自己会在页面上溜达 ──
    function wander(force) {
      if (reduce.matches || moving || !crab || held) return;
      var m = 20;
      var tx = m + Math.random() * Math.max(1, window.innerWidth - SW - m * 2);
      var ty = window.innerHeight * 0.28 + Math.random() * Math.max(1, window.innerHeight * 0.72 - SH - m);
      var dx = tx - stage.x, dy = ty - stage.y;
      var dist = Math.hypot(dx, dy);
      if (!force && dist < 140) return;
      var dur = Math.min(10, Math.max(1.8, dist / 68));
      moving = { from: { x: stage.x, y: stage.y }, dx: dx, dy: dy, t: 0, dur: dur };
      crab.walkTo([dx * 0.004, 0, dy * 0.004], dur);
      idle = 5 + Math.random() * 7;
    }

    // ── 抓在手里的时候，整只蟹跟着指针走 ──
    canvas.addEventListener('pointerdown', function () { held = true; host.classList.add('touching'); });
    function drop() {
      if (!held) return;
      held = false;
      host.classList.remove('touching', 'grabbing');
      idle = 4 + Math.random() * 4;
    }
    window.addEventListener('pointerup', drop);
    window.addEventListener('pointercancel', drop);
    window.addEventListener('blur', drop);

    window.addEventListener('resize', function () { settle(false); });

    import(MODULE_URL).catch(function (err) {
      console.warn('[pet] live crab failed, falling back to the sprite', err);
      host.remove();
      document.body.classList.remove('pet-free');
      delete window.__crabStage;
      startSprite();
    });

    var tries = 0;
    var poll = setInterval(function () {
      if (window.__crab) {
        crab = window.__crab;
        crab.setQuality(2);   // full-viewport canvas: keep the fill rate sane
        host.classList.add('awake');
        clearInterval(poll);
        var last = performance.now();
        (function tick(now) {
          requestAnimationFrame(tick);
          if (document.hidden) { last = now; return; }
          var dt = Math.min((now - last) / 1000, 0.1); last = now;
          if (moving) {
            moving.t += dt;
            var k = Math.min(1, moving.t / moving.dur);
            var e = k * k * (3 - 2 * k);
            stage.x = moving.from.x + moving.dx * e;
            stage.y = moving.from.y + moving.dy * e;
            if (k >= 1) { moving = null; idle = 5 + Math.random() * 7; }
          } else if (!reduce.matches && !held) {
            idle -= dt;
            if (idle <= 0) wander(false);
          }
        })(last);
        return;
      }
      if (document.body.classList.contains('no-gpu') || ++tries > 60) {
        clearInterval(poll);
        host.remove();
        document.body.classList.remove('pet-free');
        delete window.__crabStage;
        startSprite();
      }
    }, 250);

    settle(true);
  }

  function boot() { if (navigator.gpu && !forceSprite) startLive(); else startSprite(); }
  if (document.readyState === 'complete') setTimeout(boot, 900);
  else window.addEventListener('load', function () { setTimeout(boot, 900); });
})();
