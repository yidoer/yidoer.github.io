/**
 * 桌面宠物 · 毛绒蟹
 *
 * 有 WebGPU：整张页面就是它的桌面——一块铺满视口的透明画布，没有卡片、没有工具条。
 *  - 它自己会在整页走动：蟹的腿一动，屏幕上的位置就跟着挪；走累了歇一会儿再挑个新地方。
 *  - 也可以直接拎起来：按住它拖到任意位置，松手就落在那里（拖着的时候会晃、会荡）。
 *  - 鼠标靠近它的眼睛会跟着你转，点一下它会挥爪或咔嚓两下。
 * 页面其余部分照常点击、滚动：指针只有在真正碰到它时才被接管。
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
    function limitX(v) { return Math.min(Math.max(v, 8), Math.max(8, window.innerWidth - SIZE - 8)); }
    function limitY(v) { return Math.min(Math.max(v, 8), Math.max(8, window.innerHeight - SIZE - 8)); }
    function show(name, restart) { if (restart || state.name !== name) { state.name = name; state.t = 0; } }
    function render() {
      if (sx === null) sx = window.innerWidth - SIZE - 150;
      if (sy === null) sy = window.innerHeight - SIZE - 22;
      sx = limitX(sx); sy = limitY(sy);
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
        sx = limitX(sx + Math.sign(dx) * Math.min(Math.abs(dx), walk.speed * dt));
        render();
        if (Math.abs(walk.to - sx) < 1) { walk = null; show('idle', true); next = 3 + Math.random() * 5; }
      } else if (reduce.matches) { show('idle'); state.t = 0; }
      else {
        next -= dt;
        if (next <= 0) {
          var roll = Math.random();
          if (roll < 0.5) {
            var to = limitX(sx + (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * Math.min(420, window.innerWidth * 0.5)));
            if (Math.abs(to - sx) > 40) { walk = { to: to, speed: 46 + Math.random() * 22 }; show(to > sx ? 'walkR' : 'walkL', true); }
          }
          if (!walk) { show(roll < 0.74 ? 'wave' : roll < 0.9 ? 'snip' : 'hide', true); next = 4 + Math.random() * 5; }
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

    // 页面就是它的桌面：一块铺满视口的透明画布，蟹站在其中一个方块里
    var stage = { x: 0, y: 0, w: SW, h: SH };
    window.__crabStage = stage;

    var canvas = host.querySelector('#gl');
    var crab = null;
    var move = null;          // 屏幕上的位移补间
    var carry = null;         // 正被拎着
    var idle = 3 + Math.random() * 4;
    var seenGoal = null;      // 蟹自己决定要走去哪儿时，把这段路也搬到屏幕上

    function limitX(v) { return Math.min(Math.max(v, 8), Math.max(8, window.innerWidth - SW - 8)); }
    function limitY(v) { return Math.min(Math.max(v, 72), Math.max(72, window.innerHeight - SH - 8)); }
    function settle(first) {
      if (first) { stage.x = window.innerWidth - SW - 34; stage.y = window.innerHeight - SH - 18; }
      stage.x = limitX(stage.x); stage.y = limitY(stage.y);
    }

    // 走一段：屏幕上从当前位置滑到 (tx,ty)，同时让它的腿真的在走
    function startMove(tx, ty, dur, alreadyWalking) {
      tx = limitX(tx); ty = limitY(ty);
      var dx = tx - stage.x, dy = ty - stage.y;
      var dist = Math.hypot(dx, dy);
      if (dist < 30) return false;
      move = { fx: stage.x, fy: stage.y, dx: dx, dy: dy, t: 0, dur: Math.max(1.2, dur) };
      if (!alreadyWalking && crab) {
        // 世界里的目标按它能走到的距离给，免得腿停了屏幕还在滑
        var world = Math.min(4.5, 0.62 * move.dur);
        crab.walkTo([dx / dist * world, 0, dy / dist * world], move.dur);
      }
      return true;
    }

    function wander() {
      if (!crab || reduce.matches || move || carry) return;
      var m = 26;
      var tx = m + Math.random() * Math.max(1, window.innerWidth - SW - m * 2);
      var ty = 80 + Math.random() * Math.max(1, window.innerHeight - SH - 96);
      tx = 26 + Math.random() * Math.max(1, window.innerWidth - SW - 52);
      var dist = Math.hypot(tx - stage.x, ty - stage.y);
      if (dist < 140) return;
      startMove(tx, ty, Math.min(9, dist / 120));
      idle = 3 + Math.random() * 5;
    }

    // 它自己迈腿（闲着慌、或者被你用手指逗）时，屏幕上也跟着挪一段
    function mirrorOwnWalk() {
      if (!crab || move || carry) return;
      var g = crab.gait.goal;
      if (!g) { seenGoal = null; return; }
      if (g === seenGoal) return;
      seenGoal = g;
      if (!crab.gait.walking) return;
      var c = crab.sim.centroid();
      var dx = g[0] - c[0], dz = g[1] - c[2];
      var len = Math.hypot(dx, dz);
      if (len < 0.1) return;
      // 它一步只挪很短一段，映射成屏幕上的一小窜
      var px = Math.max(-320, Math.min(320, dx * 170 + (dx / len) * 60));
      var py = Math.max(-240, Math.min(240, dz * 170 + (dz / len) * 60));
      startMove(stage.x + px, stage.y + py, Math.max(1.8, len * 2.6), true);
    }

    // ── 指针只在真正碰到蟹的时候才交给它，页面其余地方照常点击 ──
    function over(ev) {
      if (!crab) return false;
      if (ev.clientX < stage.x || ev.clientX > stage.x + stage.w) return false;
      if (ev.clientY < stage.y || ev.clientY > stage.y + stage.h) return false;
      try {
        var ray = crab.rayFrom(ev.clientX, ev.clientY);
        if (crab.pick(ray) || Number.isFinite(crab.pickLeg(ray))) return true;
      } catch (_) { /* fall through to the body oval */ }
      // 走动时轮廓逐帧在变，给身体留一个宽扁的椭圆，四角仍然放行给页面
      var ox = (ev.clientX - (stage.x + stage.w / 2)) / (stage.w * 0.44);
      var oy = (ev.clientY - (stage.y + stage.h * 0.54)) / (stage.h * 0.3);
      return ox * ox + oy * oy <= 1;
    }
    window.addEventListener('pointermove', function (e) {
      if (carry) { carry.x = e.clientX; carry.y = e.clientY; return; }
      var hit = over(e);
      canvas.style.pointerEvents = hit ? 'auto' : 'none';
      host.classList.toggle('touching', hit);
    }, { passive: true });

    // ── 拎起来：按住它就能拖到页面任意位置 ──
    canvas.addEventListener('pointerdown', function (e) {
      if (!over(e)) return;
      move = null;
      carry = { x: e.clientX, y: e.clientY, ox: e.clientX - (stage.x + stage.w / 2), oy: e.clientY - (stage.y + stage.h * 0.54) };
      host.classList.add('carrying');
      canvas.style.pointerEvents = 'auto';
    });
    function drop() {
      if (!carry) return;
      carry = null;
      host.classList.remove('carrying');
      idle = 3 + Math.random() * 4;
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

          if (carry) {
            // 追着指针走，但留一点滞后，这样它会被拎着晃、腿在半空蹬
            var wantX = carry.x - carry.ox - stage.w / 2;
            var wantY = carry.y - carry.oy - stage.h * 0.54;
            var k = Math.min(1, dt * 7);
            stage.x = limitX(stage.x + (wantX - stage.x) * k);
            stage.y = limitY(stage.y + (wantY - stage.y) * k);
          } else if (move) {
            move.t += dt;
            var u = Math.min(1, move.t / move.dur);
            var e2 = u * u * (3 - 2 * u);
            stage.x = limitX(move.fx + move.dx * e2);
            stage.y = limitY(move.fy + move.dy * e2);
            if (u >= 1) { move = null; idle = 3 + Math.random() * 5; }
          } else if (crab) {
            mirrorOwnWalk();
            if (!reduce.matches) {
              idle -= dt;
              if (idle <= 0) { wander(); idle = 3 + Math.random() * 5; }
            }
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
