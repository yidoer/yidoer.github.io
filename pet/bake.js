/**
 * Sprite-sheet bake.
 *
 * The plush crab is a real-time simulation; the blog only wants the look of one. So this page
 * runs the workshop offscreen, poses it through each animation, and exports one transparent
 * atlas — exactly the shape a Codex-style pet is drawn from (rows of equal cells).
 *
 * It only runs on a machine with WebGPU, and only when opened directly. The site never loads it.
 */
const CELL = 176;          // cell size in the atlas
const ALPHA_CUT = 10;      // ignore near-invisible pixels when measuring the crab

const wait = ms => new Promise(r => setTimeout(r, ms));

async function waitForCrab(timeout = 90000) {
  const t0 = performance.now();
  while (!window.__crab) {
    if (performance.now() - t0 > timeout) throw new Error('crab never booted');
    await wait(100);
  }
  const frog = window.__crab;
  // first frame drawn, shaders compiled, quality locked high
  const t1 = performance.now();
  while (!document.body.classList.contains('ready')) {
    if (performance.now() - t1 > timeout) throw new Error('crab never rendered');
    await wait(100);
  }
  frog.setQuality(0);
  frog.bake(true);
  await wait(400);
  return frog;
}

// premultiplied swapchain -> straight RGBA for the 2D atlas
function unpremultiply(px) {
  for (let i = 0; i < px.length; i += 4) {
    const a = px[i + 3];
    if (a === 0) { px[i] = px[i + 1] = px[i + 2] = 0; continue; }
    if (a === 255) continue;
    const k = 255 / a;
    px[i] = Math.min(255, px[i] * k);
    px[i + 1] = Math.min(255, px[i + 1] * k);
    px[i + 2] = Math.min(255, px[i + 2] * k);
  }
  return px;
}

function toCanvas(shot) {
  const c = document.createElement('canvas');
  c.width = shot.w; c.height = shot.h;
  c.getContext('2d').putImageData(new ImageData(shot.px, shot.w, shot.h), 0, 0);
  return c;
}

// dt is chosen per row so the eight frames span the moment that reads: the snip only claps
// its claws together after ~1.1s, and the hide spends a beat pulling its legs in.
// The walk row is baked once and mirrored into a second row, so the pet can scuttle either way.
const ROWS = [
  { name: 'idle', frames: 8, dt: 0.13, setup: () => {} },
  { name: 'walk', frames: 8, dt: 0.09, setup: c => c.walkTo([3.0, 0, 0.4], 999) },
  { name: 'wave', frames: 8, dt: 0.15, setup: c => c.wave() },
  { name: 'snip', frames: 8, dt: 0.22, setup: c => c.snip() },
  { name: 'hide', frames: 8, dt: 0.15, setup: c => c.hide() },
];

async function collect(frog) {
  const shots = [];
  const names = [];
  for (const row of ROWS) {
    frog.resetAll();
    await wait(250);
    row.setup(frog);
    await wait(150);
    const frames = [];
    for (let i = 0; i < row.frames; i++) {
      frog.advance(row.dt);
      const shot = await frog.captureFrame();
      unpremultiply(shot.px);
      frames.push(toCanvas(shot));
    }
    shots.push(frames);
    names.push(row.name);
    console.log('baked row', row.name, frames.length, frames[0].width + 'x' + frames[0].height);
  }
  return { shots, names };
}

function spanOf(frames) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const cv of frames) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      if (d[(y * cv.width + x) * 4 + 3] > ALPHA_CUT) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (!isFinite(x0)) throw new Error('nothing drawn — is the bake background opaque?');
  return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}

async function bake() {
  const frog = await waitForCrab();
  const { shots, names } = await collect(frog);
  const spans = shots.map(spanOf);
  // one shared square for every row: rows stay in scale, each row is centred on its own crab
  let side = Math.max(...spans.map(s => Math.max(s.w, s.h))) * 1.08 + 4;
  side = Math.min(side, shots[0][0].width, shots[0][0].height);

  const cols = ROWS[0].frames;
  const atlas = document.createElement('canvas');
  atlas.width = cols * CELL;
  atlas.height = (ROWS.length + 1) * CELL;   // walk gets a mirrored twin
  const g = atlas.getContext('2d');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';

  const t = document.createElement('canvas');
  t.width = CELL; t.height = CELL;
  const tg = t.getContext('2d');

  const cellFor = (frames, sp, mirror) => {
    const bx = sp.cx - side / 2, by = sp.cy - side / 2;
    return frames.map(cv => {
      tg.clearRect(0, 0, CELL, CELL);
      tg.save();
      if (mirror) { tg.translate(CELL, 0); tg.scale(-1, 1); }
      tg.drawImage(cv, bx, by, side, side, 0, 0, CELL, CELL);
      tg.restore();
      const out = document.createElement('canvas');
      out.width = CELL; out.height = CELL;
      out.getContext('2d').drawImage(t, 0, 0);
      return out;
    });
  };

  const walkRow = ROWS.findIndex(r => r.name === 'walk');
  const built = [];
  shots.forEach((frames, r) => {
    built.push(cellFor(frames, spans[r], false));
    if (r === walkRow) built.push(cellFor(frames, spans[r], true));
  });

  built.forEach((cells, r) => cells.forEach((cell, i) => g.drawImage(cell, i * CELL, r * CELL)));
  const outNames = ROWS.flatMap(r => r.name === 'walk' ? ['walk-right', 'walk-left'] : [r.name]);

  const blob = await new Promise(res => atlas.toBlob(res, 'image/webp', 0.92));
  const dataUrl = await new Promise(res => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.readAsDataURL(blob);
  });
  return {
    dataUrl, bytes: blob.size, cell: CELL, cols, rows: outNames.length, names: outNames,
    src: { w: shots[0][0].width, h: shots[0][0].height }, side, spans,
  };
}

window.__bake = { bake, waitForCrab };
window.__bakeReady = true;
