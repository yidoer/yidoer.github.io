// ===== geometry.js =====
// ─────────────────────────────────────────────────────────────
//  Geometry core: SDF utilities, surface nets, principal frame,
//  the hex simulation lattice and barycentric embedding
// ─────────────────────────────────────────────────────────────

function sdGrad(sd, x, y, z, e = 1e-3) {
  const gx = sd(x + e, y, z) - sd(x - e, y, z), gy = sd(x, y + e, z) - sd(x, y - e, z), gz = sd(x, y, z + e) - sd(x, y, z - e);
  const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
  return [gx / l, gy / l, gz / l, l / (2 * e)];
}
// Newton steps onto the zero set
function project(sd, p, iters = 4) {
  for (let it = 0; it < iters; it++) {
    const d = sd(p[0], p[1], p[2]);
    if (Math.abs(d) < 1e-5) break;
    const g = sdGrad(sd, p[0], p[1], p[2]);
    const s = d / Math.max(0.3, g[3]);
    p[0] -= g[0] * s; p[1] -= g[1] * s; p[2] -= g[2] * s;
  }
  return p;
}

// run a cooperative job (a generator that yields now and then) to the end
function drain(gen) { let r; do { r = gen.next(); } while (!r.done); return r.value; }

// ── surface nets: one vertex per sign-changing cell, projected onto the surface ──
// (a generator: it yields between slabs, so a cut can be built while the knife is moving)
function surfaceNets(sd, box, s) { return drain(surfaceNetsGen(sd, box, s)); }
function* surfaceNetsGen(sd, box, s) {
  const x0 = box[0] - s, y0 = box[1] - s, z0 = box[2] - s;
  const nx = Math.ceil((box[3] - box[0]) / s) + 3, ny = Math.ceil((box[4] - box[1]) / s) + 3, nz = Math.ceil((box[5] - box[2]) / s) + 3;
  const nxy = nx * ny;
  const val = new Float32Array(nxy * nz);
  // blocks far from the surface are filled from their centre value (only the sign matters there)
  const BS = 5, hd = Math.sqrt(3) * BS * s / 2, far = 1.25 * hd + 1.5 * s;
  const bx = Math.ceil(nx / BS), by = Math.ceil(ny / BS), bz = Math.ceil(nz / BS);
  const near = new Uint8Array(bx * by * bz);
  for (let qk = 0; qk < bz; qk++) {
    for (let qj = 0; qj < by; qj++) {
      for (let qi = 0; qi < bx; qi++) {
        const bi = qi * BS, bj = qj * BS, bk = qk * BS;
        const ie = Math.min(nx, bi + BS + 1), je = Math.min(ny, bj + BS + 1), ke = Math.min(nz, bk + BS + 1);
        const dc = sd(x0 + (bi + BS / 2) * s, y0 + (bj + BS / 2) * s, z0 + (bk + BS / 2) * s);
        if (Math.abs(dc) > far) { for (let k = bk; k < ke; k++) for (let j = bj; j < je; j++) { const o = nx * j + nxy * k; for (let i = bi; i < ie; i++) val[o + i] = dc; } continue; }
        near[qi + bx * (qj + by * qk)] = 1;
        for (let k = bk; k < ke; k++) { const z = z0 + k * s; for (let j = bj; j < je; j++) { const y = y0 + j * s, o = nx * j + nxy * k; for (let i = bi; i < ie; i++) val[o + i] = sd(x0 + i * s, y, z); } }
      }
      if ((qj & 3) === 3) yield;
    }
  }
  const cellV = new Int32Array(nxy * nz).fill(-1);
  const pos = [], nrm = [];
  const E = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const off = [0, 1, nx, nx + 1, nxy, nxy + 1, nxy + nx, nxy + nx + 1];
  const cv = new Float64Array(8);
  // only cells inside (or touching) a block near the surface can change sign
  for (let qk = 0; qk < bz; qk++) for (let qj = 0; qj < by; qj++) {
    for (let qi = 0; qi < bx; qi++) {
      if (!near[qi + bx * (qj + by * qk)]) continue;
      const bi = qi * BS, bj = qj * BS, bk = qk * BS;
      const ie = Math.min(nx - 1, bi + BS), je = Math.min(ny - 1, bj + BS), ke = Math.min(nz - 1, bk + BS);
      for (let k = bk; k < ke; k++) for (let j = bj; j < je; j++) for (let i = bi; i < ie; i++) {
        const base = i + nx * j + nxy * k;
        let neg = 0;
        for (let c = 0; c < 8; c++) { cv[c] = val[base + off[c]]; if (cv[c] < 0) neg++; }
        if (neg === 0 || neg === 8) continue;
        let ax = 0, ay = 0, az = 0, n = 0;
        for (const [a, b] of E) {
          if ((cv[a] < 0) === (cv[b] < 0)) continue;
          const t = cv[a] / (cv[a] - cv[b]);
          ax += (a & 1) + (((b & 1) - (a & 1)) * t); ay += ((a >> 1) & 1) + ((((b >> 1) & 1) - ((a >> 1) & 1)) * t); az += ((a >> 2) & 1) + ((((b >> 2) & 1) - ((a >> 2) & 1)) * t);
          n++;
        }
        const p0 = x0 + (i + ax / n) * s, p1 = y0 + (j + ay / n) * s, p2 = z0 + (k + az / n) * s;
        // one Newton step onto the surface; its gradient doubles as the normal
        const g = sdGrad(sd, p0, p1, p2);
        const d = sd(p0, p1, p2) / Math.max(0.3, g[3]);
        cellV[base] = pos.length / 3;
        pos.push(p0 - g[0] * d, p1 - g[1] * d, p2 - g[2] * d); nrm.push(g[0], g[1], g[2]);
      }
    }
    if ((qj & 3) === 3) yield;
  }
  const idx = [];
  const quad = (a, b, c, d) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    const dAC = (pos[3 * a] - pos[3 * c]) ** 2 + (pos[3 * a + 1] - pos[3 * c + 1]) ** 2 + (pos[3 * a + 2] - pos[3 * c + 2]) ** 2;
    const dBD = (pos[3 * b] - pos[3 * d]) ** 2 + (pos[3 * b + 1] - pos[3 * d + 1]) ** 2 + (pos[3 * b + 2] - pos[3 * d + 2]) ** 2;
    if (dAC < dBD) idx.push(a, b, c, a, c, d); else idx.push(a, b, d, b, c, d);
  };
  for (let qk = 0; qk < bz; qk++) for (let qj = 0; qj < by; qj++) {
    for (let qi = 0; qi < bx; qi++) {
      if (!near[qi + bx * (qj + by * qk)]) continue;
      const bi = Math.max(1, qi * BS), bj = Math.max(1, qj * BS), bk = Math.max(1, qk * BS);
      const ie = Math.min(nx - 1, qi * BS + BS), je = Math.min(ny - 1, qj * BS + BS), ke = Math.min(nz - 1, qk * BS + BS);
      for (let k = bk; k < ke; k++) for (let j = bj; j < je; j++) for (let i = bi; i < ie; i++) {
        const base = i + nx * j + nxy * k, in0 = val[base] < 0;
        // edges from this node along +x, +y, +z, each shared by four cells
        if (i < nx - 1 && in0 !== (val[base + 1] < 0)) quad(cellV[base - nx - nxy], cellV[base - nxy], cellV[base], cellV[base - nx]);
        if (j < ny - 1 && in0 !== (val[base + nx] < 0)) quad(cellV[base - 1 - nxy], cellV[base - 1], cellV[base], cellV[base - nxy]);
        if (k < nz - 1 && in0 !== (val[base + nxy] < 0)) quad(cellV[base - 1 - nx], cellV[base - nx], cellV[base], cellV[base - 1]);
      }
    }
    if ((qj & 7) === 7) yield;
  }
  // windings agree with the outward gradient
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    const e1x = pos[3 * b] - pos[3 * a], e1y = pos[3 * b + 1] - pos[3 * a + 1], e1z = pos[3 * b + 2] - pos[3 * a + 2];
    const e2x = pos[3 * c] - pos[3 * a], e2y = pos[3 * c + 1] - pos[3 * a + 1], e2z = pos[3 * c + 2] - pos[3 * a + 2];
    const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
    const d = fx * (nrm[3 * a] + nrm[3 * b] + nrm[3 * c]) + fy * (nrm[3 * a + 1] + nrm[3 * b + 1] + nrm[3 * c + 1]) + fz * (nrm[3 * a + 2] + nrm[3 * b + 2] + nrm[3 * c + 2]);
    if (d < 0) { idx[t + 1] = c; idx[t + 2] = b; }
  }
  return { pos, nrm, idx };
}

// principal frame of a point cloud: centre, three orthonormal axes, extent along each
function principalFrame(pts) {
  const n = pts.length / 3;
  const c = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) c[k] += pts[3 * i + k] / n;
  const C = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < n; i++) {
    const d = [pts[3 * i] - c[0], pts[3 * i + 1] - c[1], pts[3 * i + 2] - c[2]];
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) C[3 * r + q] += d[r] * d[q] / n;
  }
  // Jacobi eigen-decomposition (symmetric 3×3)
  const V = [1, 0, 0, 0, 1, 0, 0, 0, 1], a = C.slice();
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-12) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[3 * p + q];
      if (Math.abs(apq) < 1e-14) continue;
      const th = (a[3 * q + q] - a[3 * p + p]) / (2 * apq);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) { const akp = a[3 * k + p], akq = a[3 * k + q]; a[3 * k + p] = cs * akp - sn * akq; a[3 * k + q] = sn * akp + cs * akq; }
      for (let k = 0; k < 3; k++) { const apk = a[3 * p + k], aqk = a[3 * q + k]; a[3 * p + k] = cs * apk - sn * aqk; a[3 * q + k] = sn * apk + cs * aqk; }
      for (let k = 0; k < 3; k++) { const vkp = V[3 * k + p], vkq = V[3 * k + q]; V[3 * k + p] = cs * vkp - sn * vkq; V[3 * k + q] = sn * vkp + cs * vkq; }
    }
  }
  let axes = [0, 1, 2].map(j => [V[j], V[3 + j], V[6 + j]]);
  // snap to the rest axes when the piece is (nearly) aligned with them — keeps lattices tidy
  axes = axes.map(ax => { const m = ax.map(Math.abs), i = m.indexOf(Math.max(...m)); return m[i] > 0.985 ? [0, 1, 2].map(k => (k === i ? Math.sign(ax[i]) : 0)) : ax; });
  // right-handed
  const cr = [axes[0][1] * axes[1][2] - axes[0][2] * axes[1][1], axes[0][2] * axes[1][0] - axes[0][0] * axes[1][2], axes[0][0] * axes[1][1] - axes[0][1] * axes[1][0]];
  axes[2] = cr;
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) {
    const d = (pts[3 * i] - c[0]) * axes[k][0] + (pts[3 * i + 1] - c[1]) * axes[k][1] + (pts[3 * i + 2] - c[2]) * axes[k][2];
    lo[k] = Math.min(lo[k], d); hi[k] = Math.max(hi[k], d);
  }
  return { c, axes, lo, hi };
}

// ── simulation lattice: hex cells in the piece's own frame, boundary nodes snapped onto the surface ──
// cells drive co-rotational shape matching; their 5-tet split carries volume and the embedding
function buildLattice(sd, frame, hCell, regionOf) {
  const { c, axes, lo, hi } = frame;
  const h = [hCell, hCell, hCell];
  const n = [0, 1, 2].map(k => Math.max(1, Math.ceil((hi[k] - lo[k]) / h[k] - 1e-6)));
  // centre the lattice on the piece
  const o = [0, 1, 2].map(k => (lo[k] + hi[k]) / 2 - n[k] * h[k] / 2);
  const W = (a, b, cc) => [c[0] + axes[0][0] * a + axes[1][0] * b + axes[2][0] * cc, c[1] + axes[0][1] * a + axes[1][1] * b + axes[2][1] * cc, c[2] + axes[0][2] * a + axes[1][2] * b + axes[2][2] * cc];
  const S = [n[0] + 1, n[1] + 1, n[2] + 1];
  const nodeAt = (i, j, k) => W(o[0] + i * h[0], o[1] + j * h[1], o[2] + k * h[2]);
  const hm = Math.min(...h);
  // keep cells whose centre lies inside (a little generous)
  const keep = new Uint8Array(n[0] * n[1] * n[2]);
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    const p = W(o[0] + (i + 0.5) * h[0], o[1] + (j + 0.5) * h[1], o[2] + (k + 0.5) * h[2]);
    if (sd(p[0], p[1], p[2]) < 0.12 * hm) keep[i + n[0] * (j + n[1] * k)] = 1;
  }
  const kept = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < n[0] && j < n[1] && k < n[2] && keep[i + n[0] * (j + n[1] * k)] === 1;
  const nodeId = new Int32Array(S[0] * S[1] * S[2]).fill(-1);
  const rest = [], lat = [], boundary = [];
  const nid = (i, j, k) => {
    const key = i + S[0] * (j + S[1] * k);
    if (nodeId[key] >= 0) return nodeId[key];
    const p = nodeAt(i, j, k);
    nodeId[key] = rest.length / 3;
    rest.push(p[0], p[1], p[2]); lat.push(p[0], p[1], p[2]);
    let all = true;
    for (let a = 0; a < 8; a++) if (!kept(i - 1 + (a & 1), j - 1 + ((a >> 1) & 1), k - 1 + ((a >> 2) & 1))) { all = false; break; }
    boundary.push(all ? 0 : 1);
    return nodeId[key];
  };
  const cells = [], tets = [], cellOf = [];
  const T0 = [[0, 1, 3, 5], [0, 3, 2, 6], [0, 5, 4, 6], [3, 5, 6, 7], [0, 3, 5, 6]];
  const T1 = [[0, 1, 2, 4], [3, 1, 2, 7], [5, 1, 4, 7], [6, 2, 4, 7], [1, 2, 4, 7]];
  for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) {
    if (!kept(i, j, k)) continue;
    const cn = [];
    for (let a = 0; a < 8; a++) cn.push(nid(i + (a & 1), j + ((a >> 1) & 1), k + ((a >> 2) & 1)));
    const ci = cells.length / 8;
    cells.push(...cn);
    for (const t of ((i + j + k) & 1 ? T1 : T0)) { tets.push(cn[t[0]], cn[t[1]], cn[t[2]], cn[t[3]]); cellOf.push(ci); }
  }
  const nN = rest.length / 3;
  const R = new Float64Array(rest);
  const volOf = (P, t) => tetVolume(P, tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]);
  // orient every tet to positive volume in the regular lattice
  for (let t = 0; t < tets.length / 4; t++) if (volOf(R, t) < 0) { const q = tets[4 * t + 2]; tets[4 * t + 2] = tets[4 * t + 3]; tets[4 * t + 3] = q; }
  const v0 = h[0] * h[1] * h[2] / 6;
  // snap boundary nodes onto the surface (in or out), then back off wherever that would crush a tet
  const snapped = new Float64Array(nN * 3);
  for (let i = 0; i < nN; i++) {
    const p = [R[3 * i], R[3 * i + 1], R[3 * i + 2]];
    if (boundary[i]) {
      const d = sd(p[0], p[1], p[2]);
      if (d > -0.95 * hm) project(sd, p, 5);
    }
    snapped.set(p, 3 * i);
  }
  const P = new Float64Array(snapped);
  const blend = new Float32Array(nN).fill(1);   // 1 = fully snapped
  for (let pass = 0; pass < 6; pass++) {
    let bad = 0;
    for (let t = 0; t < tets.length / 4; t++) {
      if (volOf(P, t) > 0.12 * v0) continue;
      bad++;
      for (let q = 0; q < 4; q++) {
        const v = tets[4 * t + q];
        if (!boundary[v] || blend[v] <= 0) continue;
        blend[v] = Math.max(0, blend[v] - 0.34);
        for (let k = 0; k < 3; k++) P[3 * v + k] = R[3 * v + k] + (snapped[3 * v + k] - R[3 * v + k]) * blend[v];
      }
    }
    if (!bad) break;
  }
  // tets still crushed are dropped (their cell still holds the nodes together)
  const keepT = [], keepCellOf = [];
  for (let t = 0; t < tets.length / 4; t++) if (volOf(P, t) > 0.03 * v0) { keepT.push(tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]); keepCellOf.push(cellOf[t]); }
  // material region per node (body, armour, sword...)
  const region = new Uint8Array(nN);
  for (let i = 0; i < nN; i++) region[i] = regionOf(P[3 * i], P[3 * i + 1], P[3 * i + 2]);
  // lookup for the embedding: lattice cell → its surviving tets
  const cellIdx = new Int32Array(n[0] * n[1] * n[2]).fill(-1);
  { let ci = 0; for (let k = 0; k < n[2]; k++) for (let j = 0; j < n[1]; j++) for (let i = 0; i < n[0]; i++) if (kept(i, j, k)) cellIdx[i + n[0] * (j + n[1] * k)] = ci++; }
  const cellTets = Array.from({ length: cells.length / 8 }, () => []);
  keepCellOf.forEach((ci, t) => cellTets[ci].push(t));
  const lattice = { c, axes, o, h, n, cellIdx, cellTets };
  return { rest: new Float32Array(P), tets: new Uint32Array(keepT), tetCell: new Uint32Array(keepCellOf), cells: new Uint32Array(cells), region, h, nCells: cells.length / 8, lattice };
}

// fast embedding into a piece's own lattice: only the tets of the 3×3×3 cells around a point
function embedLattice(sim, verts) { return drain(embedLatticeGen(sim, verts)); }
function* embedLatticeGen(sim, verts) {
  const { rest, tets, lattice: L } = sim;
  const { c, axes, o, h, n, cellIdx, cellTets } = L;
  const nT = tets.length / 4, nV = verts.length / 3;
  const inv = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]], a = id[0], m = [];
    for (let q = 1; q < 4; q++) for (let r = 0; r < 3; r++) m.push(rest[3 * id[q] + r] - rest[3 * a + r]);
    const M = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]), d = 1 / det;
    inv[9 * t + 0] = (M[4] * M[8] - M[5] * M[7]) * d; inv[9 * t + 1] = (M[2] * M[7] - M[1] * M[8]) * d; inv[9 * t + 2] = (M[1] * M[5] - M[2] * M[4]) * d;
    inv[9 * t + 3] = (M[5] * M[6] - M[3] * M[8]) * d; inv[9 * t + 4] = (M[0] * M[8] - M[2] * M[6]) * d; inv[9 * t + 5] = (M[2] * M[3] - M[0] * M[5]) * d;
    inv[9 * t + 6] = (M[3] * M[7] - M[4] * M[6]) * d; inv[9 * t + 7] = (M[1] * M[6] - M[0] * M[7]) * d; inv[9 * t + 8] = (M[0] * M[4] - M[1] * M[3]) * d;
  }
  const tetOf = new Uint32Array(nV), w = new Float32Array(nV * 4);
  const missing = [];
  for (let v = 0; v < nV; v++) {
    if (v % 3000 === 2999) yield;
    const x = verts[3 * v], y = verts[3 * v + 1], z = verts[3 * v + 2];
    const dx = x - c[0], dy = y - c[1], dz = z - c[2];
    const li = Math.floor((dx * axes[0][0] + dy * axes[0][1] + dz * axes[0][2] - o[0]) / h[0]);
    const lj = Math.floor((dx * axes[1][0] + dy * axes[1][1] + dz * axes[1][2] - o[1]) / h[1]);
    const lk = Math.floor((dx * axes[2][0] + dy * axes[2][1] + dz * axes[2][2] - o[2]) / h[2]);
    let best = -1, bs = -Infinity, b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    for (let R = 0; R <= 2 && bs < -1e-4; R++) {
      for (let k = lk - R; k <= lk + R; k++) for (let j = lj - R; j <= lj + R; j++) for (let i = li - R; i <= li + R; i++) {
        if (Math.max(Math.abs(i - li), Math.abs(j - lj), Math.abs(k - lk)) !== R) continue;
        if (i < 0 || j < 0 || k < 0 || i >= n[0] || j >= n[1] || k >= n[2]) continue;
        const ci = cellIdx[i + n[0] * (j + n[1] * k)]; if (ci < 0) continue;
        for (const t of cellTets[ci]) {
          const a = tets[4 * t], ex = x - rest[3 * a], ey = y - rest[3 * a + 1], ez = z - rest[3 * a + 2], I = 9 * t;
          const q1 = inv[I] * ex + inv[I + 1] * ey + inv[I + 2] * ez, q2 = inv[I + 3] * ex + inv[I + 4] * ey + inv[I + 5] * ez, q3 = inv[I + 6] * ex + inv[I + 7] * ey + inv[I + 8] * ez, q0 = 1 - q1 - q2 - q3;
          const s = Math.min(q0, q1, q2, q3);
          if (s > bs) { bs = s; best = t; b0 = q0; b1 = q1; b2 = q2; b3 = q3; }
        }
      }
      if (R >= 1 && best >= 0 && bs > -0.45) break;
    }
    if (best < 0) { missing.push(v); continue; }
    tetOf[v] = best; w[4 * v] = b0; w[4 * v + 1] = b1; w[4 * v + 2] = b2; w[4 * v + 3] = b3;
  }
  if (missing.length) {
    const pts = new Float32Array(missing.length * 3);
    missing.forEach((v, q) => { pts[3 * q] = verts[3 * v]; pts[3 * q + 1] = verts[3 * v + 1]; pts[3 * q + 2] = verts[3 * v + 2]; });
    const e = embed(rest, tets, pts);
    missing.forEach((v, q) => { tetOf[v] = e.tetOf[q]; w.set(e.w.subarray(4 * q, 4 * q + 4), 4 * v); });
  }
  return { tetOf, w };
}

function tetVolume(p, a, b, c, d) {
  const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
  const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
  const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
  const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
  return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
}

// ── barycentric embedding of points into tets (nearest tet when a point lies outside) ──
function embed(simRest, tets, verts) {
  const nT = tets.length / 4, nV = verts.length / 3;
  const cell = 0.25;
  const grid = new Map();
  const key = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);
  const inv = new Float64Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const id = [tets[4 * t], tets[4 * t + 1], tets[4 * t + 2], tets[4 * t + 3]];
    for (const v of id) for (let c = 0; c < 3; c++) { mn[c] = Math.min(mn[c], simRest[3 * v + c]); mx[c] = Math.max(mx[c], simRest[3 * v + c]); }
    for (let i = Math.floor(mn[0] / cell); i <= Math.floor(mx[0] / cell); i++)
      for (let j = Math.floor(mn[1] / cell); j <= Math.floor(mx[1] / cell); j++)
        for (let k = Math.floor(mn[2] / cell); k <= Math.floor(mx[2] / cell); k++) {
          const K = key(i, j, k); let l = grid.get(K); if (!l) grid.set(K, l = []); l.push(t);
        }
    const a = id[0], m = [];
    for (let c = 1; c < 4; c++) for (let r = 0; r < 3; r++) m.push(simRest[3 * id[c] + r] - simRest[3 * a + r]);
    const M = [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    const id2 = 1 / det;
    inv[9 * t + 0] = (M[4] * M[8] - M[5] * M[7]) * id2; inv[9 * t + 1] = (M[2] * M[7] - M[1] * M[8]) * id2; inv[9 * t + 2] = (M[1] * M[5] - M[2] * M[4]) * id2;
    inv[9 * t + 3] = (M[5] * M[6] - M[3] * M[8]) * id2; inv[9 * t + 4] = (M[0] * M[8] - M[2] * M[6]) * id2; inv[9 * t + 5] = (M[2] * M[3] - M[0] * M[5]) * id2;
    inv[9 * t + 6] = (M[3] * M[7] - M[4] * M[6]) * id2; inv[9 * t + 7] = (M[1] * M[6] - M[0] * M[7]) * id2; inv[9 * t + 8] = (M[0] * M[4] - M[1] * M[3]) * id2;
  }
  const tetOf = new Uint32Array(nV);
  const w = new Float32Array(nV * 4);
  const bb = new Float64Array(4);
  for (let v = 0; v < nV; v++) {
    const x = verts[3 * v], y = verts[3 * v + 1], z = verts[3 * v + 2];
    let best = -1, bestScore = -Infinity, b0 = 0, b1 = 0, b2 = 0, b3 = 0;
    const tryT = t => {
      const a = tets[4 * t];
      const dx = x - simRest[3 * a], dy = y - simRest[3 * a + 1], dz = z - simRest[3 * a + 2], I = 9 * t;
      const q1 = inv[I] * dx + inv[I + 1] * dy + inv[I + 2] * dz;
      const q2 = inv[I + 3] * dx + inv[I + 4] * dy + inv[I + 5] * dz;
      const q3 = inv[I + 6] * dx + inv[I + 7] * dy + inv[I + 8] * dz;
      const q0 = 1 - q1 - q2 - q3;
      const s = Math.min(q0, q1, q2, q3);
      if (s > bestScore) { bestScore = s; best = t; b0 = q0; b1 = q1; b2 = q2; b3 = q3; }
    };
    const ci = Math.floor(x / cell), cj = Math.floor(y / cell), ck = Math.floor(z / cell);
    // rings outward until the point is inside a tet — or, for a point just outside the mesh,
    // until a nearby tet has been found (extrapolating slightly from it is fine)
    for (let r = 0; r <= 4; r++) {
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) for (let k = ck - r; k <= ck + r; k++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj), Math.abs(k - ck)) !== r) continue;
        const l = grid.get(key(i, j, k)); if (l) for (const t of l) tryT(t);
      }
      if (bestScore >= -1e-4 || (r >= 1 && best >= 0 && bestScore > -0.45)) break;
    }
    if (best < 0) for (let t = 0; t < nT; t++) tryT(t);
    tetOf[v] = best; w[4 * v] = b0; w[4 * v + 1] = b1; w[4 * v + 2] = b2; w[4 * v + 3] = b3;
  }
  return { tetOf, w };
}


// ===== crab.js =====
// ─────────────────────────────────────────────────────────────
//  The plush crab: a wide, puffy domed shell pressed flat where it
//  sits, a soft brow along the front, two eyes on short stalks (each
//  a fuzzy eyeball with a round white felt patch and a glossy safety
//  eye), an embroidered smile and blush cheeks, pale spots over the
//  top, a paler underside, stitched seams where the legs are sewn on
//  — and eight walking legs and two chunky-clawed arms with a wire
//  inside (legs.js). The body is one signed distance field.
// ─────────────────────────────────────────────────────────────

// rest frame: y up, the crab faces +z, sitting on the table at y = 0
const H_CELL = 0.11;
const NET_STEP = 0.024;
const SHAPE = { fur: 0.058 };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function ell(x, y, z, c, r) {
  const px = (x - c[0]) / r[0], py = (y - c[1]) / r[1], pz = (z - c[2]) / r[2];
  const k0 = Math.hypot(px, py, pz), k1 = Math.hypot(px / r[0], py / r[1], pz / r[2]);
  return k1 < 1e-9 ? -Math.min(...r) : k0 * (k0 - 1) / k1;
}
function capsuleSD(x, y, z, a, b, r) {
  const pax = x - a[0], pay = y - a[1], paz = z - a[2], bax = b[0] - a[0], bay = b[1] - a[1], baz = b[2] - a[2];
  const h = Math.max(0, Math.min(1, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz)));
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

const SHELL = { c: [0, 0.34, -0.02], r: [0.84, 0.40, 0.54] };
const BROW = { c: [0, 0.5, 0.33], r: [0.56, 0.15, 0.17] };
const FLANK = { c: [0.6, 0.3, -0.02], r: [0.3, 0.24, 0.36] };
const STALK = { a: [0.255, 0.6, 0.34], b: [0.265, 0.76, 0.37], r: 0.092 };
const EYE = { x: 0.27, y: 0.875, z: 0.385, r: 0.155 };
function bodySD(x, y, z) {
  // the shell sits a little flattened on the table; a soft brow runs along the front; two stalks carry the eyeballs
  const ax = Math.abs(x);
  let d = ell(x, y, z, SHELL.c, SHELL.r);
  d = smin(d, ell(ax, y, z, FLANK.c, FLANK.r), 0.12);
  d = smin(d, ell(x, y, z, BROW.c, BROW.r), 0.14);
  d = smin(d, capsuleSD(ax, y, z, STALK.a, STALK.b, STALK.r), 0.06);
  d = smin(d, Math.hypot(ax - EYE.x, y - EYE.y, z - EYE.z) - EYE.r, 0.05);
  // flatten the seat
  return Math.max(d, -(y - 0.012) * 0.9);
}

// ── sewn-on parts: two glossy safety eyes on white felt patches, an embroidered smile ──
function onSurface(p) {
  for (let i = 0; i < 40; i++) { const d = bodySD(...p); if (Math.abs(d) < 1e-5) break; const g = sdGrad(bodySD, ...p); p = p.map((v, q) => v - g[q] * d); }
  return p;
}
function eyeFrames() {
  const out = [];
  for (const side of [-1, 1]) {
    const ax = norm([side * 0.26, 0.2, 1]);
    const p = onSurface([side * (EYE.x + 0.04), EYE.y + 0.06, EYE.z + EYE.r + 0.12]);
    const R = 0.082;
    out.push({ ctr: [p[0] - ax[0] * R * 0.3, p[1] - ax[1] * R * 0.3, p[2] - ax[2] * R * 0.3], ax, R, p });
  }
  return out;
}
const SMILE = { y0: 0.25, lift: 0.07, half: 0.2 };
const smileY = x => SMILE.y0 + SMILE.lift * (x / SMILE.half) ** 2;
function crabProps() {
  const out = { pos: [], nrm: [], mat: [], idx: [], rigid: [] };
  const push = (p, n, m) => { out.pos.push(p[0], p[1], p[2]); out.nrm.push(n[0], n[1], n[2]); out.mat.push(m); };
  const grid = (base, ni, nj, wrapJ) => {
    const nj1 = wrapJ ? nj : nj + 1;
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
      const a = base + i * nj1 + j, b = base + i * nj1 + (wrapJ ? (j + 1) % nj : j + 1), c = a + nj1, d = b + nj1;
      out.idx.push(a, c, b, b, c, d);
    }
  };
  const eyes = eyeFrames();
  // round white felt patches behind the glossy eyes
  for (const e of eyes) {
    const t1 = norm(cross(e.ax, [0, 1, 0])), t2 = cross(e.ax, t1), Rd = e.R * 1.75, NP = 32, NRr = 4;
    const c0 = e.p;
    const base = out.pos.length / 3;
    const g0 = norm(sdGrad(bodySD, ...c0));
    push([c0[0] + g0[0] * 0.012, c0[1] + g0[1] * 0.012, c0[2] + g0[2] * 0.012], g0, 7);
    for (let r = 1; r <= NRr; r++) for (let j = 0; j < NP; j++) {
      const ph = 2 * Math.PI * j / NP, rr = Rd * r / NRr;
      const q = onSurface([c0[0] + (t1[0] * Math.cos(ph) + t2[0] * Math.sin(ph)) * rr + g0[0] * 0.05, c0[1] + (t1[1] * Math.cos(ph) + t2[1] * Math.sin(ph)) * rr + g0[1] * 0.05, c0[2] + (t1[2] * Math.cos(ph) + t2[2] * Math.sin(ph)) * rr + g0[2] * 0.05]);
      const g = norm(sdGrad(bodySD, ...q)), lift = 0.012 * (1 - 0.55 * (r / NRr) ** 4);
      push([q[0] + g[0] * lift, q[1] + g[1] * lift, q[2] + g[2] * lift], g, 7);
    }
    for (let j = 0; j < NP; j++) out.idx.push(base, base + 1 + j, base + 1 + (j + 1) % NP);
    for (let r = 1; r < NRr; r++) for (let j = 0; j < NP; j++) {
      const a = base + 1 + (r - 1) * NP + j, b = base + 1 + (r - 1) * NP + (j + 1) % NP, c = a + NP, d = b + NP;
      out.idx.push(a, c, b, b, c, d);
    }
  }
  // the glossy safety eyes
  for (const e of eyes) {
    const t1 = norm(cross(e.ax, [0, 1, 0])), t2 = cross(e.ax, t1);
    const base = out.pos.length / 3, NT = 18, NP = 28;
    out.rigid.push({ v0: base, v1: base + (NT + 1) * NP, c: e.ctr.slice() });
    for (let i = 0; i <= NT; i++) {
      const th = Math.PI * i / NT, ct = Math.cos(th), st = Math.sin(th);
      for (let j = 0; j < NP; j++) {
        const ph = 2 * Math.PI * j / NP;
        const n = [0, 1, 2].map(k => e.ax[k] * ct + (t1[k] * Math.cos(ph) + t2[k] * Math.sin(ph)) * st);
        push([e.ctr[0] + n[0] * e.R, e.ctr[1] + n[1] * e.R, e.ctr[2] + n[2] * e.R], n, 1 + 0.45 * ct);
      }
    }
    grid(base, NT, NP, true);
  }
  // the embroidered smile: a round thread laid along the face
  {
    const N = 44, NR = 7, rT = 0.014, base = out.pos.length / 3, pts = [];
    for (let i = 0; i <= N; i++) {
      const x = -SMILE.half + 2 * SMILE.half * i / N;
      const p = onSurface([x, smileY(x), 0.95]), g = sdGrad(bodySD, ...p);
      pts.push({ p: [p[0] + g[0] * 0.004, p[1] + g[1] * 0.004, p[2] + g[2] * 0.004], n: g });
    }
    for (let i = 0; i <= N; i++) {
      const a = pts[Math.max(0, i - 1)].p, b = pts[Math.min(N, i + 1)].p;
      const t = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]), n = pts[i].n, bn = norm(cross(t, n)), nn = cross(bn, t);
      for (let j = 0; j < NR; j++) {
        const ph = 2 * Math.PI * j / NR;
        const d = [0, 1, 2].map(k => nn[k] * Math.cos(ph) + bn[k] * Math.sin(ph));
        push([pts[i].p[0] + d[0] * rT, pts[i].p[1] + d[1] * rT, pts[i].p[2] + d[2] * rT], d, 5);
      }
    }
    grid(base, N, NR, true);
  }
  return out;
}

// ── the limbs: eight walking legs (four a side), then the two arms; sewn on along the shell's flanks ──
const NLEG = 10, NWALK = 8, KSEG = 10;
const LEG_LEN = 0.9, ARM_LEN = 0.86;
const LIFT = 0.17;          // how far the body rises when it stands up to scuttle
function marchHip(o, d) {
  // march out from inside the shell along d to find the hip on the surface
  let t0 = 0, t1 = 0;
  for (let k = 0; k < 300 && bodySD(o[0] + d[0] * t1, o[1], o[2] + d[2] * t1) < 0; k++) { t0 = t1; t1 += 0.01; }
  for (let k = 0; k < 30; k++) { const t = (t0 + t1) / 2; if (bodySD(o[0] + d[0] * t, o[1], o[2] + d[2] * t) < 0) t0 = t; else t1 = t; }
  const t = (t0 + t1) / 2 - 0.04;
  return [o[0] + d[0] * t, o[1], o[2] + d[2] * t];
}
const LEGS = (() => {
  const out = [];
  const zs = [0.27, 0.09, -0.09, -0.27], ang = [0.56, 0.2, -0.2, -0.56];
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const d = [s * Math.cos(ang[i]), 0, Math.sin(ang[i])];
    out.push({ kind: 'leg', side: s, i, d, hip: marchHip([s * 0.2, 0.2, zs[i]], d), r0: 0.06 - i * 0.002, r1: 0.034 });
  }
  for (const s of [-1, 1]) {
    const d = [s * Math.sin(1.0), 0, Math.cos(1.0)];
    out.push({ kind: 'arm', side: s, i: 0, d, hip: marchHip([s * 0.25, 0.3, 0.2], d), r0: 0.078, r1: 0.07 });
  }
  return out;
})();

// sample a quadratic arch H → C → T at even link lengths (the limb's own length, whatever the curve's);
// past the end of the curve it carries straight on along the last direction
function archPoints(H, C, T, L, k) {
  const N = 240, pts = [], acc = [0];
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t;
    pts.push([a * H[0] + b * C[0] + c * T[0], a * H[1] + b * C[1] + c * T[1], a * H[2] + b * C[2] + c * T[2]]);
    if (i) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
  }
  const out = [], seg = L / (k - 1);
  for (let j = 0; j < k; j++) {
    const s = seg * j;
    if (s >= acc[N]) {
      const a = pts[N - 1], b = pts[N], l = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) || 1, e = s - acc[N];
      out.push([0, 1, 2].map(q => b[q] + (b[q] - a[q]) / l * e));
      continue;
    }
    let i = 1; while (i < N && acc[i] < s) i++;
    const f = (s - acc[i - 1]) / Math.max(1e-9, acc[i] - acc[i - 1]);
    out.push([0, 1, 2].map(q => pts[i - 1][q] + (pts[i][q] - pts[i - 1][q]) * f));
  }
  return out;
}
// a leg standing on the table: the foot's reach is solved so the toe lands exactly at the given height
function legStanding(H, d, kneeOut, kneeUp, footY, L, k) {
  const make = ext => archPoints(H, [H[0] + d[0] * ext * kneeOut, H[1] + kneeUp, H[2] + d[2] * ext * kneeOut], [H[0] + d[0] * ext, footY, H[2] + d[2] * ext], L, k);
  let lo = 0.15, hi = 1.5;
  for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (make(m)[k - 1][1] < footY) lo = m; else hi = m; }
  return make((lo + hi) / 2);
}
// a named pose: K points (body rest space) along a limb, from its hip
function legPose(leg, pose, k) {
  const H = leg.hip, d = leg.d, s = leg.side, add = (v, o) => [v[0] + o[0], v[1] + o[1], v[2] + o[2]];
  if (leg.kind === 'arm') {
    const L = ARM_LEN;
    let C, T;
    if (pose === 'hide') {          // both claws across the eyes, like hands over them
      C = [s * 0.92, 0.6, 0.74]; T = [s * 0.6, 0.8, 0.72];
    } else if (pose === 'wave') {   // raised high
      C = add(H, [s * 0.34, 0.5, 0.1]); T = add(H, [s * 0.3, 1.0, 0.16]);
    } else if (pose === 'snip') {   // up in front, claws forward
      C = add(H, [s * 0.46, 0.34, 0.22]); T = [s * 0.6, 0.92, 0.96];
    } else if (pose === 'hang') {   // dangling
      C = add(H, [s * 0.2, -0.2, 0.12]); T = add(H, [s * 0.22, -0.8, 0.22]);
    } else {                        // sitting / standing: claws held out in front
      C = add(H, [s * 0.42, 0.3, 0.16]); T = add(H, [s * 0.3, 0.5, 0.7]);
    }
    return archPoints(H, C, T, L, k);
  }
  const L = LEG_LEN, up = [0, 1, 0];
  if (pose === 'stand') return legStanding(H, d, 0.46, 0.5, 0.034 - LIFT, L, k);
  if (pose === 'hide') {           // pulled in: knees up, toes tucked beside the hips
    const C = add(H, [d[0] * 0.3, 0.4, d[2] * 0.3]), T = add(H, [d[0] * 0.0, -0.14, d[2] * 0.0]);
    return archPoints(H, C, T, L, k);
  }
  if (pose === 'hang') {
    return archPoints(H, add(H, [d[0] * 0.24, -0.12, d[2] * 0.24]), add(H, [d[0] * 0.3, -0.82, d[2] * 0.3]), L, k);
  }
  void up;
  return legStanding(H, d, 0.5, 0.38, 0.036, L, k);   // sit (also wave, snip)
}

// spheres the limbs slide over (their centres ride the body)
const COLLIDERS = [
  { c: [0, 0.33, -0.02], r: 0.36 }, { c: [0.42, 0.3, -0.02], r: 0.3 }, { c: [-0.42, 0.3, -0.02], r: 0.3 },
  { c: [0.62, 0.27, -0.02], r: 0.18 }, { c: [-0.62, 0.27, -0.02], r: 0.18 },
  { c: [0, 0.34, 0.3], r: 0.26 }, { c: [0, 0.3, -0.3], r: 0.26 },
];

// ── build ──
function buildCrab() {
  const box = [-0.94, -0.03, -0.62, 0.94, 1.08, 0.72];
  const net = surfaceNets(bodySD, box, NET_STEP);
  const nBody = net.pos.length / 3;
  const pr = crabProps();
  const pos = net.pos.concat(pr.pos), nrm = net.nrm.concat(pr.nrm);
  const mat = new Array(nBody).fill(0).concat(pr.mat);
  const index = new Uint32Array(net.idx.length + pr.idx.length);
  index.set(net.idx, 0);
  for (let i = 0; i < pr.idx.length; i++) index[net.idx.length + i] = pr.idx[i] + nBody;
  const nV = pos.length / 3;
  // per vertex regions: x = the top of the shell (where the spots go), y = the paler underside, z = the face, w = hip seams
  const arm = new Float32Array(nV * 4);
  for (let v = 0; v < nBody; v++) {
    const x = pos[3 * v], y = pos[3 * v + 1], z = pos[3 * v + 2], ny = nrm[3 * v + 1];
    const face = ss(0.36, 0.5, z) * ss(0.1, 0.2, y) * (1 - ss(0.46, 0.56, y));
    const stalkD = Math.hypot(Math.abs(x) - 0.265, z - 0.36);
    arm[4 * v] = ss(0.4, 0.7, ny) * ss(0.38, 0.5, y) * ss(0.13, 0.22, stalkD) * (1 - ss(0.78, 0.82, y)) * (1 - face);
    arm[4 * v + 1] = ss(-0.25, -0.7, ny);
    arm[4 * v + 2] = face;
    let seam = 0;
    for (const L of LEGS) seam = Math.max(seam, 1 - ss(0.05, 0.085, Math.hypot(x - L.hip[0], y - L.hip[1], z - L.hip[2])));
    arm[4 * v + 3] = seam;
  }
  let vol = 0, area = 0;
  const q = net.pos, I = net.idx;
  for (let t = 0; t < I.length; t += 3) {
    const a = 3 * I[t], b = 3 * I[t + 1], c = 3 * I[t + 2];
    vol += (q[a] * (q[b + 1] * q[c + 2] - q[b + 2] * q[c + 1]) - q[a + 1] * (q[b] * q[c + 2] - q[b + 2] * q[c]) + q[a + 2] * (q[b] * q[c + 1] - q[b + 1] * q[c])) / 6;
    const e1 = [q[b] - q[a], q[b + 1] - q[a + 1], q[b + 2] - q[a + 2]], e2 = [q[c] - q[a], q[c + 1] - q[a + 1], q[c + 2] - q[a + 2]];
    area += 0.5 * Math.hypot(e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]);
  }
  const rest = new Float32Array(pos);
  const latSD = (x, y, z) => bodySD(x, y, z) - 0.025;
  const frame = { c: [0, 0, 0], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], lo: [box[0], box[1], box[2]], hi: [box[3], box[4], box[5]] };
  const sim = buildLattice(latSD, frame, H_CELL, (x, y, z) => (-bodySD(x, y, z) < 0.05 ? 1 : 0));
  // embed: render vertices, the hips, the body frame (origin + three axis points), the collider centres
  const extra = [];
  const hipFirst = nV;
  for (const L of LEGS) extra.push(...L.hip);
  const frameFirst = nV + extra.length / 3;
  const FO = [0, 0.34, 0.0];
  extra.push(...FO, FO[0] + 0.2, FO[1], FO[2], FO[0], FO[1] + 0.2, FO[2], FO[0], FO[1], FO[2] + 0.2);
  const colFirst = nV + extra.length / 3;
  for (const c of COLLIDERS) extra.push(...c.c);
  const embPts = new Float32Array(rest.length + extra.length);
  embPts.set(rest, 0); embPts.set(extra, rest.length);
  const emb = embedLattice(sim, embPts);
  const nP = sim.rest.length / 3, nT = sim.tets.length / 4, nE = embPts.length / 3, nCell = sim.cells.length / 8;
  const skinIdx = new Uint32Array(nE * 4), skinW = new Float32Array(nE * 4);
  for (let v = 0; v < nE; v++) for (let j = 0; j < 4; j++) { skinIdx[4 * v + j] = sim.tets[4 * emb.tetOf[v] + j]; skinW[4 * v + j] = emb.w[4 * v + j]; }
  // the shell breathes
  const cellBreath = new Float32Array(nCell);
  for (let c = 0; c < nCell; c++) {
    let y = 0;
    for (let j = 0; j < 8; j++) y += sim.rest[3 * sim.cells[8 * c + j] + 1] / 8;
    cellBreath[c] = ss(0.1, 0.3, y);
  }
  return {
    sim: {
      rest: sim.rest, tets: sim.tets, tetCell: sim.tetCell, cells: sim.cells, cellH: new Float32Array(nCell).fill(H_CELL), region: sim.region,
      comp: new Uint16Array(nP), nComp: 1, ranges: [{ n0: 0, n1: nP, t0: 0, t1: nT, c0: 0, c1: nCell, v0: 0, v1: nV }],
    },
    render: {
      rest, nrm: new Float32Array(nrm), mat: new Float32Array(mat), arm, index,
      body: { first: 0, count: net.idx.length }, props: { first: net.idx.length, count: pr.idx.length }, nBody,
      rigid: pr.rigid.map(r => ({ v0: r.v0 + nBody, v1: r.v1 + nBody, c: r.c })),
    },
    skinIdx, skinW, nRender: nV, hipFirst, frameFirst, frameOrigin: FO, colFirst, cellBreath,
    skinVol: vol, area, eyes: eyeFrames(),
  };
}

// ===== physics.js =====
// ─────────────────────────────────────────────────────────────
//  XPBD soft body — the plush crab (the solver of the plush series)
//  · hex cells → co-rotational shape matching (elasticity; inverted cells always recover)
//  · their tets → volume constraints (near-incompressibility)
//  · soft grab attachment, floor contact with Coulomb friction
//  · relative-velocity damping along edges (internal viscosity)
//  · a piece that has come to rest sleeps until something touches it
//  Fixed 60 Hz step, small substeps (1 iteration each).
// ─────────────────────────────────────────────────────────────

// per material region: 0 stuffing, 1 the minky shell
const DENSITY_OF = [1, 1.0];
const FIRM_OF = [1, 1.25];

class SoftBody {
  constructor(world, opts = {}) {
    const { rest, tets, cells, cellH, region, comp, nComp, ranges } = world;
    this.n = rest.length / 3; this.nT = tets.length / 4; this.nC = cells.length / 8;
    this.tets = tets; this.cells = cells; this.comp = comp; this.nComp = nComp; this.ranges = ranges;
    this.rest = Float32Array.from(rest);
    this.region = region;
    this.x = new Float32Array(rest.length); this.prev = new Float32Array(rest.length); this.v = new Float32Array(rest.length);
    const n = this.n;

    // masses: lumped tet volumes, half of it spread evenly over the piece (well-conditioned contacts)
    this.restVol = new Float32Array(this.nT);
    const lump = new Float64Array(n);
    let vol = 0;
    for (let t = 0; t < this.nT; t++) {
      const v = Math.max(1e-6, tetVol(this.rest, tets, t));
      this.restVol[t] = v; vol += v;
      for (let k = 0; k < 4; k++) lump[tets[4 * t + k]] += v / 4;
    }
    this.totalRestVolume = vol;
    this.mass = new Float32Array(n); this.invMass = new Float32Array(n);
    this.compMass = new Float64Array(nComp);
    for (const [c, r] of ranges.entries()) {
      let V = 0; for (let i = r.n0; i < r.n1; i++) V += lump[i];
      const mean = V / (r.n1 - r.n0);
      for (let i = r.n0; i < r.n1; i++) { const m = Math.max(1e-6, 0.6 * lump[i] + 0.4 * mean) * DENSITY_OF[region[i]]; this.mass[i] = m; this.invMass[i] = 1 / m; this.compMass[c] += m; }
    }
    this.totalMass = 0; for (let i = 0; i < n; i++) this.totalMass += this.mass[i];

    // cells: rest offsets about the mass centre, warm-started rotations, firmness by material
    const nC = this.nC;
    this.cellQ = new Float32Array(nC * 24); this.cellM = new Float32Array(nC * 8); this.cellMass = new Float32Array(nC);
    this.cellRot = new Float32Array(nC * 4); this.cellFirm = new Float32Array(nC); this.cellInvH = new Float32Array(nC);
    this.cell3 = new Int32Array(nC * 8);
    for (let c = 0; c < nC; c++) {
      let M = 0, cx = 0, cy = 0, cz = 0, rg = 1;
      for (let k = 0; k < 8; k++) { const i = cells[8 * c + k], m = this.mass[i]; M += m; cx += rest[3 * i] * m; cy += rest[3 * i + 1] * m; cz += rest[3 * i + 2] * m; rg = Math.max(rg, FIRM_OF[region[i]]); }
      cx /= M; cy /= M; cz /= M;
      for (let k = 0; k < 8; k++) {
        const i = cells[8 * c + k];
        this.cell3[8 * c + k] = 3 * i; this.cellM[8 * c + k] = this.mass[i];
        this.cellQ[24 * c + 3 * k] = rest[3 * i] - cx; this.cellQ[24 * c + 3 * k + 1] = rest[3 * i + 1] - cy; this.cellQ[24 * c + 3 * k + 2] = rest[3 * i + 2] - cz;
      }
      this.cellMass[c] = M; this.cellRot[4 * c + 3] = 1;
      this.cellFirm[c] = rg;
      this.cellInvH[c] = 1 / cellH[c];
    }
    this.cellK0 = new Float32Array(nC);
    for (let c = 0; c < nC; c++) this.cellK0[c] = this.cellFirm[c] * this.cellInvH[c] * this.cellInvH[c];
    this.tet3 = new Int32Array(this.nT * 4);
    for (let q = 0; q < this.nT * 4; q++) this.tet3[q] = 3 * tets[q];

    // edges (for the mesh overlay and the internal damping), shuffled a little against Gauss–Seidel bias
    const edges = [], eRanges = [];
    for (const r of ranges) {
      const set = new Set(), e0 = edges.length / 2;
      for (let t = r.t0; t < r.t1; t++) for (const [a, b] of [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]]) {
        let i = tets[4 * t + a], j = tets[4 * t + b]; if (i > j) [i, j] = [j, i];
        const key = i * 1048576 + j; if (set.has(key)) continue; set.add(key); edges.push(i, j);
      }
      const e1 = edges.length / 2;
      for (let k = e1 - 1; k > e0; k--) {
        const r2 = e0 + ((k * 2654435761) >>> 0) % (k - e0 + 1);
        const a0 = edges[2 * k], a1 = edges[2 * k + 1]; edges[2 * k] = edges[2 * r2]; edges[2 * k + 1] = edges[2 * r2 + 1]; edges[2 * r2] = a0; edges[2 * r2 + 1] = a1;
      }
      eRanges.push([e0, e1]);
    }
    this.edges = new Uint32Array(edges); this.nE = edges.length / 2; this.eRanges = eRanges;

    // per piece: awake flag, calm timer
    this.awake = new Uint8Array(nComp).fill(1);
    this.calm = new Float32Array(nComp);

    // parameters (sim units ≈ 10 cm, seconds)
    this.gravity = -9.81;
    this.accel = [0, 0, 0];      // a uniform push on everything (the scuttle's lead)
    this.airK = 0.08;            // drag of the surrounding air (1/s)
    this.firmness = opts.firmness ?? 0.5;
    this.damping = opts.damping ?? 0.45;
    this.substeps = 6;
    this.stepDt = 1 / 60;
    this.friction = 0.9;
    this.restitution = 0.42;
    this.vyPre = new Float32Array(n);
    // the seat keeps its footing on the table unless the crab is lifted
    this.useRoots = opts.roots ?? false;
    this.rooted = this.useRoots; this.liftGrab = false; this.airborne = false; this.landT = 0;
    this.rootIdx = []; for (let i = 0; i < n; i++) if (rest[3 * i + 1] < 0.16) this.rootIdx.push(i);
    this.rootXZ = new Float32Array(this.rootIdx.length * 2);
    this.grabMask = new Uint8Array(n);
    this.floorY = 0;
    this.maxSpeed = 14;
    this.holdScale = 1; this.posture = 0.003; this.postureAll = null; this.postureYaw = 0;
    this.grabIdx = new Int32Array(n); this.grabW = new Float32Array(n); this.grabOff = new Float32Array(n * 3);
    this.grabN = 0; this.grabComp = -1;
    this.grabTarget = new Float32Array(3); this.grabRot = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.grabbing = false;
    this.finger = null;
    this.time = 0; this.sub = 0;
    this.reset(0);
  }

  // stiffness per unit mass of a cell (1/s²): firmness 0..1 on a log scale, × 1/h² so a body reacts
  // the same whatever its lattice spacing
  stiffness() { return Math.exp(Math.log(90) + (Math.log(1600) - Math.log(90)) * this.firmness); }
  volCompliance() { return 0.05 * (1 - 0.7 * this.firmness); }
  dampRate() { return 20 + 300 * this.damping * this.damping; }

  reset(drop = 0.35) {
    for (let i = 0; i < this.n; i++) {
      this.x[3 * i] = this.rest[3 * i]; this.x[3 * i + 1] = this.rest[3 * i + 1] + drop; this.x[3 * i + 2] = this.rest[3 * i + 2];
    }
    this.prev.set(this.x); this.v.fill(0);
    this.cellRot.fill(0); for (let c = 0; c < this.nC; c++) this.cellRot[4 * c + 3] = 1;
    this.endGrab(); this.wakeAll();
    if (this.rootIdx) { this.plantRoots(); this.rooted = this.useRoots; this.airborne = false; this.liftGrab = false; }
  }
  wakeAll() { this.awake.fill(1); this.calm.fill(0); }
  wake(c) { if (!this.awake[c]) { this.awake[c] = 1; this.calm[c] = 0; } }

  centroid() {
    let x = 0, y = 0, z = 0, m = 0;
    for (let i = 0; i < this.n; i++) { const w = this.mass[i]; m += w; x += this.x[3 * i] * w; y += this.x[3 * i + 1] * w; z += this.x[3 * i + 2] * w; }
    return [x / m, y / m, z / m];
  }
  bounds() {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], x = this.x;
    for (let i = 0; i < this.n; i++) for (let k = 0; k < 3; k++) { const v = x[3 * i + k]; if (v < b[k]) b[k] = v; if (v > b[3 + k]) b[3 + k] = v; }
    return b;
  }

  // ── grabbing ──
  beginGrab(hit, radius = 0.5) {
    this.grabN = 0;
    let nearest = -1, nd = Infinity;
    for (let i = 0; i < this.n; i++) {
      const d = (this.x[3 * i] - hit[0]) ** 2 + (this.x[3 * i + 1] - hit[1]) ** 2 + (this.x[3 * i + 2] - hit[2]) ** 2;
      if (d < nd) { nd = d; nearest = i; }
    }
    const cg = nearest >= 0 ? this.comp[nearest] : 0;
    const r = this.ranges[cg];
    for (let i = r.n0; i < r.n1; i++) {
      const dx = this.x[3 * i] - hit[0], dy = this.x[3 * i + 1] - hit[1], dz = this.x[3 * i + 2] - hit[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < radius) {
        const f = 1 - d / radius, k = this.grabN++;
        this.grabIdx[k] = i; this.grabW[k] = f * f * (3 - 2 * f);
        this.grabOff[3 * k] = dx; this.grabOff[3 * k + 1] = dy; this.grabOff[3 * k + 2] = dz;
      }
    }
    if (this.grabN === 0 && nearest >= 0) {
      this.grabIdx[0] = nearest; this.grabW[0] = 1;
      this.grabOff[0] = this.x[3 * nearest] - hit[0]; this.grabOff[1] = this.x[3 * nearest + 1] - hit[1]; this.grabOff[2] = this.x[3 * nearest + 2] - hit[2];
      this.grabN = 1;
    }
    this.grabMask.fill(0);
    for (let k = 0; k < this.grabN; k++) this.grabMask[this.grabIdx[k]] = 1;
    this.grabComp = cg; this.wake(cg);
    this.grabTarget.set(hit); this.grabStart = Float32Array.from(hit);
    this.grabRot.set([1, 0, 0, 0, 1, 0, 0, 0, 1]);
    this.grabbing = true;
  }
  moveGrab(target, rot) {
    this.grabTarget.set(target);
    const dx = target[0] - this.grabStart[0], dy = target[1] - this.grabStart[1], dz = target[2] - this.grabStart[2];
    const d = Math.hypot(dx, dy, dz), maxReach = 14;
    if (d > maxReach) { const k = maxReach / d; this.grabTarget[0] = this.grabStart[0] + dx * k; this.grabTarget[1] = this.grabStart[1] + dy * k; this.grabTarget[2] = this.grabStart[2] + dz * k; }
    if (rot) this.grabRot.set(rot);
    const R = this.grabRot;
    let lowest = Infinity;
    for (let k = 0; k < this.grabN; k++) lowest = Math.min(lowest, R[3] * this.grabOff[3 * k] + R[4] * this.grabOff[3 * k + 1] + R[5] * this.grabOff[3 * k + 2]);
    if (Number.isFinite(lowest)) this.grabTarget[1] = Math.max(this.grabTarget[1], this.floorY + 0.004 - lowest);
    if (this.grabComp >= 0) this.wake(this.grabComp);
  }
  endGrab() { this.grabbing = false; this.grabN = 0; this.grabComp = -1; if (this.grabMask) this.grabMask.fill(0); }

  // ── simulation ──
  step() {
    const sub = this.substeps, dt = this.stepDt / sub;
    if (this.finger) this.finger.touch = 0;
    for (let s = 0; s < sub; s++) { this.sub = s; this.substep(dt); }
    if (this.finger) this.finger.prev = this.finger.p.slice();
    this.time += this.stepDt;
    if (this.airborne && !this.grabbing) this.checkLanding();
    this.settle();
    for (let i = 0; i < this.x.length; i += 97) if (!Number.isFinite(this.x[i])) { this.reset(0.2); break; }
  }

  substep(dt) {
    const { x, prev, v, ranges, awake } = this;
    const g = this.gravity * dt;
    const air = Math.exp(-this.airK * dt), airG = Math.exp(-2.0 * dt);
    const A = this.accel, ax = A[0] * dt, ay = A[1] * dt, az = A[2] * dt;
    for (let c = 0; c < this.nComp; c++) {
      if (!awake[c]) continue;
      const r = ranges[c], a = c === this.grabComp && this.grabbing ? airG : air;
      for (let k = 3 * r.n0; k < 3 * r.n1; k += 3) {
        v[k + 1] += g; v[k] += ax; v[k + 1] += ay; v[k + 2] += az;
        v[k] *= a; v[k + 1] *= a; v[k + 2] *= a;
        this.vyPre[k / 3] = v[k + 1];
        prev[k] = x[k]; prev[k + 1] = x[k + 1]; prev[k + 2] = x[k + 2];
        x[k] += v[k] * dt; x[k + 1] += v[k + 1] * dt; x[k + 2] += v[k + 2] * dt;
      }
    }
    if (this.grabbing) this.solveGrab(dt);
    const kdt = this.stiffness() * dt * dt;
    for (let c = 0; c < this.nComp; c++) {
      if (!awake[c]) continue;
      const r = ranges[c];
      this.solveCells(r.c0, r.c1, kdt);
      this.solveVolumes(r.t0, r.t1, dt);
    }
    if (this.finger && this.finger.on) { this.solveFinger(); this.wakeAll(); }
    if (!(this.grabbing && this.liftGrab)) {
      if (this.rooted) this.solveRoots();
      if (this.posture > 0 && this.postureAll) this.solvePosture();
    }
    this.solveFloor();
    const inv = 1 / dt, vmax = this.maxSpeed;
    for (let c = 0; c < this.nComp; c++) {
      if (!awake[c]) continue;
      const r = ranges[c];
      for (let i = 3 * r.n0; i < 3 * r.n1; i += 3) {
        let vx = (x[i] - prev[i]) * inv, vy = (x[i + 1] - prev[i + 1]) * inv, vz = (x[i + 2] - prev[i + 2]) * inv;
        const sp = vx * vx + vy * vy + vz * vz;
        if (sp > vmax * vmax) { const f = vmax / Math.sqrt(sp); vx *= f; vy *= f; vz *= f; }
        // a plush that lands hard springs back up a little
        const vp = this.vyPre[i / 3];
        if (vp < -1.2 && x[i + 1] <= this.floorY + 1e-4) vy = Math.max(vy, -vp * this.restitution);
        v[i] = vx; v[i + 1] = vy; v[i + 2] = vz;
      }
      if (this.sub === this.substeps - 1) this.dampEdges(c, this.stepDt);
    }
  }

  // the wobble of a big body lives in its slow, whole-body modes, which edge damping barely sees:
  // split the motion into rigid (translation + rotation) and deformation, and let the deformation
  // part decay — falling, tumbling and sliding are left alone
  dampDeformation(c, dt) {
    const r = this.ranges[c], x = this.x, v = this.v, m = this.mass;
    let M = 0, cx = 0, cy = 0, cz = 0, vx = 0, vy = 0, vz = 0;
    for (let i = r.n0; i < r.n1; i++) { const w = m[i], k = 3 * i; M += w; cx += x[k] * w; cy += x[k + 1] * w; cz += x[k + 2] * w; vx += v[k] * w; vy += v[k + 1] * w; vz += v[k + 2] * w; }
    cx /= M; cy /= M; cz /= M; vx /= M; vy /= M; vz /= M;
    let Lx = 0, Ly = 0, Lz = 0, i00 = 0, i01 = 0, i02 = 0, i11 = 0, i12 = 0, i22 = 0;
    for (let i = r.n0; i < r.n1; i++) {
      const w = m[i], k = 3 * i, rx = x[k] - cx, ry = x[k + 1] - cy, rz = x[k + 2] - cz, ux = v[k] - vx, uy = v[k + 1] - vy, uz = v[k + 2] - vz;
      Lx += w * (ry * uz - rz * uy); Ly += w * (rz * ux - rx * uz); Lz += w * (rx * uy - ry * ux);
      const r2 = rx * rx + ry * ry + rz * rz;
      i00 += w * (r2 - rx * rx); i11 += w * (r2 - ry * ry); i22 += w * (r2 - rz * rz); i01 -= w * rx * ry; i02 -= w * rx * rz; i12 -= w * ry * rz;
    }
    const A = i11 * i22 - i12 * i12, B = i02 * i12 - i01 * i22, C = i01 * i12 - i02 * i11, det = i00 * A + i01 * B + i02 * C;
    if (Math.abs(det) < 1e-12) return;
    const D = i00 * i22 - i02 * i02, E = i01 * i02 - i00 * i12, F = i00 * i11 - i01 * i01, id = 1 / det;
    const wx = (A * Lx + B * Ly + C * Lz) * id, wy = (B * Lx + D * Ly + E * Lz) * id, wz = (C * Lx + E * Ly + F * Lz) * id;
    const k = Math.exp(-this.deformDamp() * dt);
    // rolling resistance: a soft body resting on the table squashes its contact patch, so rocking
    // and rolling die out instead of going on forever (never while it is held or in the air)
    let touch = 0;
    for (let i = r.n0; i < r.n1; i++) if (x[3 * i + 1] < this.floorY + 0.004) touch++;
    const held = this.grabbing && this.grabComp === c;
    const kr = touch >= 3 && !held && !this.rollFree ? Math.exp(-2.2 * dt) : 1;
    for (let i = r.n0; i < r.n1; i++) {
      const q = 3 * i, rx = x[q] - cx, ry = x[q + 1] - cy, rz = x[q + 2] - cz;
      const gx = vx + wy * rz - wz * ry, gy = vy + wz * rx - wx * rz, gz = vz + wx * ry - wy * rx;
      v[q] = gx * kr + (v[q] - gx) * k; v[q + 1] = gy * kr + (v[q + 1] - gy) * k; v[q + 2] = gz * kr + (v[q + 2] - gz) * k;
    }
  }
  deformDamp() { return 1.0 + 7 * this.damping; }

  // once a piece is nearly still, bleed off the last jitter; after a while at rest it sleeps
  settle() {
    for (let c = 0; c < this.nComp; c++) {
      if (!this.awake[c]) continue;
      const r = this.ranges[c];
      this.dampDeformation(c, this.stepDt);
      let e = 0;
      for (let i = r.n0; i < r.n1; i++) { const k = 3 * i; e += this.mass[i] * (this.v[k] ** 2 + this.v[k + 1] ** 2 + this.v[k + 2] ** 2); }
      const ke = 0.5 * e / this.compMass[c];
      const held = this.grabbing && this.grabComp === c;
      if (!held && ke < 2e-3) {
        const f = Math.max(0.86, 1 - 0.14 * (1 - ke / 2e-3));
        for (let i = 3 * r.n0; i < 3 * r.n1; i++) this.v[i] *= f;
      }
      if (!held && ke < 4e-5) this.calm[c] += this.stepDt; else this.calm[c] = 0;
      if (this.calm[c] > 0.6) {
        this.awake[c] = 0;
        for (let i = 3 * r.n0; i < 3 * r.n1; i++) this.v[i] = 0;
      }
    }
  }
  get sleeping() { let s = 0; for (let c = 0; c < this.nComp; c++) s += this.awake[c] ? 0 : 1; return s; }

  solveGrab(dt) {
    const { x, invMass } = this;
    const a = 2e-6 / (dt * dt), R = this.grabRot, T = this.grabTarget;
    for (let k = 0; k < this.grabN; k++) {
      const i = this.grabIdx[k], w = invMass[i];
      const ox = this.grabOff[3 * k], oy = this.grabOff[3 * k + 1], oz = this.grabOff[3 * k + 2];
      const tx = T[0] + R[0] * ox + R[1] * oy + R[2] * oz;
      const ty = Math.max(T[1] + R[3] * ox + R[4] * oy + R[5] * oz, this.floorY + 0.005);
      const tz = T[2] + R[6] * ox + R[7] * oy + R[8] * oz;
      let f = this.grabW[k] * w / (w + a);
      if (ty < x[3 * i + 1] && ty < 0.45) f *= Math.max(0.12, ty / 0.45);
      x[3 * i] += (tx - x[3 * i]) * f; x[3 * i + 1] += (ty - x[3 * i + 1]) * f; x[3 * i + 2] += (tz - x[3 * i + 2]) * f;
    }
  }

  // Cell-wise co-rotational shape matching: each lattice cell (8 nodes) is pulled toward its rest
  // shape under the best-fit rotation (warm-started quaternion extraction). Equal fractions for all
  // eight nodes conserve linear and angular momentum; a badly crushed or stretched cell is pulled
  // back harder.
  solveCells(c0, c1, kdt) {
    const G = this._goal || (this._goal = new Float64Array(24));
    const x = this.x, Q = this.cellRot, c3 = this.cell3, cm = this.cellM, cq = this.cellQ, cM = this.cellMass, K0 = this.cellK0, IH = this.cellInvH;
    for (let t = c0; t < c1; t++) {
      const o8 = 8 * t, o24 = 24 * t, M = cM[t];
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < 8; k++) { const i = c3[o8 + k], m = cm[o8 + k]; cx += x[i] * m; cy += x[i + 1] * m; cz += x[i + 2] * m; }
      cx /= M; cy /= M; cz /= M;
      let f00 = 0, f01 = 0, f02 = 0, f10 = 0, f11 = 0, f12 = 0, f20 = 0, f21 = 0, f22 = 0;
      for (let k = 0; k < 8; k++) {
        const i = c3[o8 + k], m = cm[o8 + k];
        const px = (x[i] - cx) * m, py = (x[i + 1] - cy) * m, pz = (x[i + 2] - cz) * m;
        const q0 = cq[o24 + 3 * k], q1 = cq[o24 + 3 * k + 1], q2 = cq[o24 + 3 * k + 2];
        f00 += px * q0; f01 += px * q1; f02 += px * q2; f10 += py * q0; f11 += py * q1; f12 += py * q2; f20 += pz * q0; f21 += pz * q1; f22 += pz * q2;
      }
      let qx = Q[4 * t], qy = Q[4 * t + 1], qz = Q[4 * t + 2], qw = Q[4 * t + 3];
      let r00 = 1 - 2 * (qy * qy + qz * qz), r01 = 2 * (qx * qy - qw * qz), r02 = 2 * (qx * qz + qw * qy);
      let r10 = 2 * (qx * qy + qw * qz), r11 = 1 - 2 * (qx * qx + qz * qz), r12 = 2 * (qy * qz - qw * qx);
      let r20 = 2 * (qx * qz - qw * qy), r21 = 2 * (qy * qz + qw * qx), r22 = 1 - 2 * (qx * qx + qy * qy);
      // one warm-started step per substep: the rotation barely moves between substeps
      {
        const ox = (r10 * f20 - r20 * f10) + (r11 * f21 - r21 * f11) + (r12 * f22 - r22 * f12);
        const oy = (r20 * f00 - r00 * f20) + (r21 * f01 - r01 * f21) + (r22 * f02 - r02 * f22);
        const oz = (r00 * f10 - r10 * f00) + (r01 * f11 - r11 * f01) + (r02 * f12 - r12 * f02);
        const den = Math.abs(r00 * f00 + r10 * f10 + r20 * f20 + r01 * f01 + r11 * f11 + r21 * f21 + r02 * f02 + r12 * f12 + r22 * f22) + 1e-12;
        const wx = ox / den, wy = oy / den, wz = oz / den, w2 = wx * wx + wy * wy + wz * wz;
        if (w2 > 1e-12) {
          const w = Math.sqrt(w2), sc = w > 1 ? 0.5 / w : 0.5;
          const ax = wx * sc, ay = wy * sc, az = wz * sc;
          const nx = qx + ax * qw + ay * qz - az * qy, ny = qy - ax * qz + ay * qw + az * qx;
          const nz = qz + ax * qy - ay * qx + az * qw, nw = qw - ax * qx - ay * qy - az * qz;
          const nl = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
          qx = nx * nl; qy = ny * nl; qz = nz * nl; qw = nw * nl;
          r00 = 1 - 2 * (qy * qy + qz * qz); r01 = 2 * (qx * qy - qw * qz); r02 = 2 * (qx * qz + qw * qy);
          r10 = 2 * (qx * qy + qw * qz); r11 = 1 - 2 * (qx * qx + qz * qz); r12 = 2 * (qy * qz - qw * qx);
          r20 = 2 * (qx * qz - qw * qy); r21 = 2 * (qy * qz + qw * qx); r22 = 1 - 2 * (qx * qx + qy * qy);
        }
      }
      Q[4 * t] = qx; Q[4 * t + 1] = qy; Q[4 * t + 2] = qz; Q[4 * t + 3] = qw;
      // goal positions once, then how far the cell is from them
      let dev = 0;
      for (let k = 0; k < 8; k++) {
        const i = c3[o8 + k], q0 = cq[o24 + 3 * k], q1 = cq[o24 + 3 * k + 1], q2 = cq[o24 + 3 * k + 2];
        const gx = cx + r00 * q0 + r01 * q1 + r02 * q2 - x[i], gy = cy + r10 * q0 + r11 * q1 + r12 * q2 - x[i + 1], gz = cz + r20 * q0 + r21 * q1 + r22 * q2 - x[i + 2];
        G[3 * k] = gx; G[3 * k + 1] = gy; G[3 * k + 2] = gz;
        dev += cm[o8 + k] * (gx * gx + gy * gy + gz * gz);
      }
      const kk = K0[t] * kdt;
      let f = kk / (1 + kk);
      const rel = Math.sqrt(dev / M) * IH[t];
      if (rel > 0.25) { const u = Math.min(1, (rel - 0.25) / 0.35); f += (0.35 - f) * Math.max(0, u * u * (3 - 2 * u)); }
      for (let k = 0; k < 8; k++) {
        const i = c3[o8 + k];
        x[i] += G[3 * k] * f; x[i + 1] += G[3 * k + 1] * f; x[i + 2] += G[3 * k + 2] * f;
      }
    }
  }

  solveVolumes(t0, t1, dt) {
    const { x, invMass, tet3, restVol } = this;
    const alpha0 = this.volCompliance() / (dt * dt);
    for (let t = t0; t < t1; t++) {
      const A = tet3[4 * t], B = tet3[4 * t + 1], Cc = tet3[4 * t + 2], D = tet3[4 * t + 3];
      const bax = x[B] - x[A], bay = x[B + 1] - x[A + 1], baz = x[B + 2] - x[A + 2];
      const cax = x[Cc] - x[A], cay = x[Cc + 1] - x[A + 1], caz = x[Cc + 2] - x[A + 2];
      const dax = x[D] - x[A], day = x[D + 1] - x[A + 1], daz = x[D + 2] - x[A + 2];
      const dbx = x[D] - x[B], dby = x[D + 1] - x[B + 1], dbz = x[D + 2] - x[B + 2];
      const cbx = x[Cc] - x[B], cby = x[Cc + 1] - x[B + 1], cbz = x[Cc + 2] - x[B + 2];
      const gax = dby * cbz - dbz * cby, gay = dbz * cbx - dbx * cbz, gaz = dbx * cby - dby * cbx;
      const gbx = cay * daz - caz * day, gby = caz * dax - cax * daz, gbz = cax * day - cay * dax;
      const gcx = day * baz - daz * bay, gcy = daz * bax - dax * baz, gcz = dax * bay - day * bax;
      const gdx = bay * caz - baz * cay, gdy = baz * cax - bax * caz, gdz = bax * cay - bay * cax;
      const V = (dax * gdx + day * gdy + daz * gdz) / 6;
      const wa = invMass[A / 3], wb = invMass[B / 3], wc = invMass[Cc / 3], wd = invMass[D / 3];
      const wsum = wa * (gax * gax + gay * gay + gaz * gaz) + wb * (gbx * gbx + gby * gby + gbz * gbz) + wc * (gcx * gcx + gcy * gcy + gcz * gcz) + wd * (gdx * gdx + gdy * gdy + gdz * gdz);
      if (wsum < 1e-12) continue;
      const r0 = restVol[t];
      const alpha = V < 0.25 * r0 ? 0 : alpha0 * r0;
      const s = -6 * (V - r0) / (wsum + alpha);
      x[A] += gax * s * wa; x[A + 1] += gay * s * wa; x[A + 2] += gaz * s * wa;
      x[B] += gbx * s * wb; x[B + 1] += gby * s * wb; x[B + 2] += gbz * s * wb;
      x[Cc] += gcx * s * wc; x[Cc + 1] += gcy * s * wc; x[Cc + 2] += gcz * s * wc;
      x[D] += gdx * s * wd; x[D + 1] += gdy * s * wd; x[D + 2] += gdz * s * wd;
    }
  }

  // the seat keeps its footing: a soft spring back to where it stands
  solveRoots() {
    const x = this.x, R = this.rootIdx, T = this.rootXZ;
    for (let q = 0; q < R.length; q++) {
      const k = 3 * R[q];
      if (x[k + 1] > this.floorY + 0.06 || this.grabMask[R[q]]) continue;   // a lifted or held foot is free
      x[k] += (T[2 * q] - x[k]) * 0.12; x[k + 2] += (T[2 * q + 1] - x[k + 2]) * 0.12;
    }
  }
  // the footing is wherever the seat now stands (it may have scuttled and turned)
  plantRoots() {
    const x = this.x, R = this.rootIdx, T = this.rootXZ;
    for (let q = 0; q < R.length; q++) { T[2 * q] = x[3 * R[q]]; T[2 * q + 1] = x[3 * R[q] + 2]; }
  }
  // a dropped crab takes its footing again once it has come down and stopped hopping
  checkLanding() {
    let low = 0, vy = 0;
    const R = this.rootIdx;
    for (let q = 0; q < R.length; q++) { const k = 3 * R[q]; if (this.x[k + 1] < this.floorY + 0.03) low++; vy += Math.abs(this.v[k + 1]); }
    vy /= R.length;
    // sitting on its seat — or, if it tumbled over, lying still on the table (then it gets up again)
    const still = this.minY() < this.floorY + 0.03 && this.kineticEnergy() / this.totalMass < 0.05;
    if ((low > R.length * 0.25 && vy < 0.6) || still) this.landT += this.stepDt; else this.landT = 0;
    if (this.landT > 0.12) { this.airborne = false; this.rooted = this.useRoots; this.plantRoots(); }
  }
  // a sitting toy keeps its posture: a weak pull of the body toward its rest pose over its footing.
  // The pull is toward the rest pose carried along with the body's own centre of mass, so it never
  // pushes the crab anywhere — it only turns it upright (a weighted toy rights itself) and lets the
  // wobble settle into its own shape.
  solvePosture() {
    const x = this.x, r = this.rest, m = this.mass, B = this.postureAll;
    const k = this.posture * (this.rooted ? 1 : 0.6);
    if (!this._pc) {
      let M = 0, cx = 0, cy = 0, cz = 0;
      for (let a = 0; a < B.length; a++) { const i = B[a], w = m[i]; M += w; cx += r[3 * i] * w; cy += r[3 * i + 1] * w; cz += r[3 * i + 2] * w; }
      this._pc = [cx / M, cy / M, cz / M, M];
    }
    const [rx, ry, rz, M] = this._pc;
    let cx = 0, cy = 0, cz = 0;
    for (let a = 0; a < B.length; a++) { const i = B[a], w = m[i]; cx += x[3 * i] * w; cy += x[3 * i + 1] * w; cz += x[3 * i + 2] * w; }
    cx /= M; cy /= M; cz /= M;
    // the rest pose turned to the heading it is scuttling (yaw about the vertical), carried with the body
    const cyw = Math.cos(this.postureYaw || 0), syw = Math.sin(this.postureYaw || 0);
    for (let a = 0; a < B.length; a++) {
      const i = B[a], q = 3 * i;
      if (this.grabMask[i]) continue;
      const px = r[q] - rx, py = r[q + 1] - ry, pz = r[q + 2] - rz;
      const tx = cx + cyw * px + syw * pz, ty = cy + py, tz = cz - syw * px + cyw * pz;
      x[q] += (tx - x[q]) * k; x[q + 1] += (ty - x[q + 1]) * k; x[q + 2] += (tz - x[q + 2]) * k;
    }
  }

  solveFloor() {
    const { x, prev } = this;
    const fy = this.floorY, mu = this.friction;
    for (let c = 0; c < this.nComp; c++) {
      if (!this.awake[c]) continue;
      const r = this.ranges[c];
      for (let i = r.n0; i < r.n1; i++) {
        const k = 3 * i, pen = fy - x[k + 1];
        if (pen <= 0) continue;
        x[k + 1] = fy;
        const dx = x[k] - prev[k], dz = x[k + 2] - prev[k + 2], dl = Math.sqrt(dx * dx + dz * dz);
        if (dl < 1e-12) continue;
        const f = dl < mu * pen ? 1 : mu * pen / dl;
        x[k] -= dx * f; x[k + 2] -= dz * f;
      }
    }
  }

  dampEdges(c, dt) {
    const { x, v, invMass, edges } = this;
    const k = 1 - Math.exp(-this.dampRate() * dt);
    const [e0, e1] = this.eRanges[c];
    for (let e = e0; e < e1; e++) {
      const I = 3 * edges[2 * e], J = 3 * edges[2 * e + 1];
      let nx = x[J] - x[I], ny = x[J + 1] - x[I + 1], nz = x[J + 2] - x[I + 2];
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (l < 1e-9) continue;
      nx /= l; ny /= l; nz /= l;
      const rv = (v[J] - v[I]) * nx + (v[J + 1] - v[I + 1]) * ny + (v[J + 2] - v[I + 2]) * nz;
      const wi = invMass[I / 3], wj = invMass[J / 3], imp = rv * k / (wi + wj);
      v[I] += nx * imp * wi; v[I + 1] += ny * imp * wi; v[I + 2] += nz * imp * wi;
      v[J] -= nx * imp * wj; v[J + 1] -= ny * imp * wj; v[J + 2] -= nz * imp * wj;
    }
  }

  // The finger comes in from the viewer's side (a capsule: its tip at p, its axis running back along A).
  // Everything is pushed out of it, so poking the shell dents it; the contact count tells the crab it was poked.
  solveFinger() {
    const F = this.finger, x = this.x;
    const fx = F.p[0], fy = F.p[1], fz = F.p[2], rf = F.r, L = F.len;
    const A = F.axis || [0, 1, 0], ax = A[0], ay = A[1], az = A[2];
    let touch = 0;
    for (let i = 0; i < this.n; i++) {
      const q = 3 * i;
      let rx = x[q] - fx, ry = x[q + 1] - fy, rz = x[q + 2] - fz;
      let t = rx * ax + ry * ay + rz * az;
      if (t > L + rf) continue;
      t = Math.min(L, Math.max(0, t));
      rx -= ax * t; ry -= ay * t; rz -= az * t;
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (d > rf + 0.03) continue;
      touch++;
      if (d < rf && d > 1e-6) { const s = (rf - d) / d; x[q] += rx * s; x[q + 1] += ry * s; x[q + 2] += rz * s; }
    }
    F.touch = Math.max(F.touch || 0, touch);
  }

  // ── the shell breathes: the cells' rest shapes swell a little across and up (weighted per cell),
  // the tets' rest volumes follow ──
  setupMuscles(breathW, tetCell) {
    this.breathW = breathW; this.tetCell = tetCell;
    this.cellQ0 = Float32Array.from(this.cellQ); this.restVol0 = Float32Array.from(this.restVol);
  }
  setMuscles(breath) {
    const W = this.breathW, Q = this.cellQ, Q0 = this.cellQ0;
    for (let c = 0; c < this.nC; c++) {
      const a = breath * W[c], sx = 1 + a, sy = 1 + 0.35 * a;
      for (let k = 0; k < 8; k++) { const o = 24 * c + 3 * k; Q[o] = Q0[o] * sx; Q[o + 1] = Q0[o + 1] * sy; Q[o + 2] = Q0[o + 2] * sx; }
    }
    const TC = this.tetCell, V = this.restVol, V0 = this.restVol0;
    for (let t = 0; t < this.nT; t++) { const a = breath * W[TC[t]]; V[t] = V0[t] * (1 + a) * (1 + a) * (1 + 0.35 * a); }
  }

  // ── diagnostics ──
  volumeRatio() { let s = 0; for (let t = 0; t < this.nT; t++) s += tetVol(this.x, this.tets, t); return s / this.totalRestVolume; }
  kineticEnergy() { let e = 0; for (let i = 0; i < this.n; i++) { const k = 3 * i; e += 0.5 * this.mass[i] * (this.v[k] ** 2 + this.v[k + 1] ** 2 + this.v[k + 2] ** 2); } return e; }
  minY() { let m = Infinity; for (let i = 1; i < this.x.length; i += 3) m = Math.min(m, this.x[i]); return m; }
  maxY() { let m = -Infinity; for (let i = 1; i < this.x.length; i += 3) m = Math.max(m, this.x[i]); return m; }
}

function tetVol(p, T, t) {
  const a = T[4 * t], b = T[4 * t + 1], c = T[4 * t + 2], d = T[4 * t + 3];
  const ax = p[3 * a], ay = p[3 * a + 1], az = p[3 * a + 2];
  const b0 = p[3 * b] - ax, b1 = p[3 * b + 1] - ay, b2 = p[3 * b + 2] - az;
  const c0 = p[3 * c] - ax, c1 = p[3 * c + 1] - ay, c2 = p[3 * c + 2] - az;
  const d0 = p[3 * d] - ax, d1 = p[3 * d + 1] - ay, d2 = p[3 * d + 2] - az;
  return (b0 * (c1 * d2 - c2 * d1) - b1 * (c0 * d2 - c2 * d0) + b2 * (c0 * d1 - c1 * d0)) / 6;
}

// ===== legs.js =====
// ─────────────────────────────────────────────────────────────
//  The limbs: eight plush walking legs and two arms, each an XPBD rod
//  · a chain of points from the hip (sewn to the body) to the toe / wrist,
//    stretch links only (the wire's pull supplies the stiffness)
//  · posed from the body's frame: each point is drawn toward where the
//    limb's pose puts it — firmly near the hip, less toward the end —
//    so a limb holds its shape but sags, swings and flops a little
//  · the wire is plastic: bend a limb past its give and it stays bent
//    (the pose itself takes the new shape, in the body's frame)
//  · walking: each toe can be drawn to a foothold on the table instead
//  · kept off the body by spheres riding it, off the table (toes grip it),
//    out of the finger (legs only — the claws are allowed to reach it)
//  · drawn as a plush tube along a smooth curve through the chain, with
//    pale joint bands; each arm ends in a chunky palm and two fat claw
//    fingers that hang from the wrist in the claw's own frame, opening
//    and closing by a single angle
// ─────────────────────────────────────────────────────────────

const LEG_PALM = 0.082;             // how much the arm swells into the palm
const CLAW = { len: 0.44, r0: 0.082, r1: 0.04, gape: 0.04, t0: -0.04 };

// the plush radius of a limb at s (0 at the hip … 1 at the toe / palm)
function limbRadius(leg, s) {
  const base = leg.r0 + (leg.r1 - leg.r0) * s;
  if (leg.kind === 'arm') {
    return base * (1 + 0.1 * Math.exp(-(((s - 0.34) / 0.1) ** 2))) + LEG_PALM * ss(0.66, 0.97, s);
  }
  return base * (1 + 0.1 * Math.exp(-(((s - 0.34) / 0.07) ** 2)) + 0.1 * Math.exp(-(((s - 0.64) / 0.07) ** 2)) + 0.2 * Math.exp(-(((s - 0.97) / 0.045) ** 2)));
}
const fingerRadius = u => CLAW.r0 + (CLAW.r1 - CLAW.r0) * Math.pow(u, 0.9);

// an arm reaching for a point P (body rest space): the wrist stops `stop` short of it along the claw's own
// direction, so the claw's fingers straddle P; the arm bows out to keep its length
function armToward(leg, P, k, stop = 0.4) {
  const H = leg.hip, s = leg.side;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  let u = norm([P[0] - H[0], P[1] - H[1], P[2] - H[2]]);
  let T = [P[0] - u[0] * stop, P[1] - u[1] * stop, P[2] - u[2] * stop];
  const lenOf = (C, T_) => { let L = 0, q = H; for (let i = 1; i <= 24; i++) { const t = i / 24, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), c = t * t; const p = [a * H[0] + b * C[0] + c * T_[0], a * H[1] + b * C[1] + c * T_[1], a * H[2] + b * C[2] + c * T_[2]]; L += dist(p, q); q = p; } return L; };
  let C = H;
  for (let it = 0; it < 3; it++) {
    // keep the wrist within reach of the hip
    let hd = dist(T, H);
    const maxR = ARM_LEN * 0.97;
    if (hd > maxR) { const f = maxR / hd; T = [H[0] + (T[0] - H[0]) * f, H[1] + (T[1] - H[1]) * f, H[2] + (T[2] - H[2]) * f]; hd = maxR; }
    if (hd < 0.18) { const f = 0.18 / Math.max(hd, 1e-4); T = [H[0] + (T[0] - H[0]) * f, H[1] + (T[1] - H[1]) * f, H[2] + (T[2] - H[2]) * f]; }
    const M = [(H[0] + T[0]) / 2, (H[1] + T[1]) / 2, (H[2] + T[2]) / 2];
    const ax = norm([T[0] - H[0], T[1] - H[1], T[2] - H[2]]);
    let out = [s * 0.8, 0.9, -0.1]; const dd = out[0] * ax[0] + out[1] * ax[1] + out[2] * ax[2];
    out = norm([out[0] - ax[0] * dd, out[1] - ax[1] * dd, out[2] - ax[2] * dd]);
    let lo = 0, hi = 1.6;
    for (let b = 0; b < 24; b++) { const m = (lo + hi) / 2; const Cm = [M[0] + out[0] * m, M[1] + out[1] * m, M[2] + out[2] * m]; if (lenOf(Cm, T) < ARM_LEN) lo = m; else hi = m; }
    const bw = (lo + hi) / 2;
    C = [M[0] + out[0] * bw, M[1] + out[1] * bw, M[2] + out[2] * bw];
    const te = norm([T[0] - C[0], T[1] - C[1], T[2] - C[2]]);
    T = [P[0] - te[0] * stop, P[1] - te[1] * stop, P[2] - te[2] * stop];
    u = te;
  }
  return archPoints(H, C, T, ARM_LEN, k);
}

class Legs {
  // rest: per limb, K points (any pose) — only their spacing is used for the links
  // arm: per limb, 1 for an arm (no foothold, may touch the finger)
  constructor(rest, radii, arm) {
    const nL = rest.length, K = rest[0].length;
    this.nL = nL; this.K = K; this.n = nL * K;
    const n = this.n;
    this.x = new Float32Array(n * 3); this.prev = new Float32Array(n * 3); this.v = new Float32Array(n * 3);
    this.target = new Float32Array(n * 3); this.target0 = new Float32Array(n * 3);
    this.w = new Float32Array(n); this.kp = new Float32Array(n); this.rad = new Float32Array(n); this.j = new Uint8Array(n);
    this.foot = new Float32Array(nL * 3); this.footW = new Float32Array(nL);
    this.isArm = Uint8Array.from(arm);
    const C = [];
    for (let l = 0; l < nL; l++) {
      const o = l * K, P = rest[l];
      for (let j = 0; j < K; j++) {
        const k = o + j, t = j / (K - 1);
        this.w[k] = j === 0 ? 0 : 1 / (0.7 + 0.3 * (1 - t));
        this.rad[k] = radii[l](t);
        this.j[k] = j;
        for (let q = 0; q < 3; q++) this.x[3 * k + q] = P[j][q];
      }
      for (let j = 0; j + 1 < K; j++) C.push(o + j, o + j + 1, Math.hypot(...[0, 1, 2].map(q => P[j][q] - P[j + 1][q])), 0);
    }
    this.nC = C.length / 4;
    this.ca = new Uint32Array(this.nC); this.cb = new Uint32Array(this.nC); this.cr = new Float32Array(this.nC); this.cc = new Float32Array(this.nC);
    for (let q = 0; q < this.nC; q++) { this.ca[q] = C[4 * q]; this.cb[q] = C[4 * q + 1]; this.cr[q] = C[4 * q + 2]; this.cc[q] = C[4 * q + 3]; }
    this.prev.set(this.x); this.target.set(this.x); this.target0.set(this.x);
    this.spheres = [];
    this.gScale = 0.6; this.drag = 2.0;
    this.substeps = 4; this.iters = 3;
    this.setWire(0.5);
    this.grab = null;
    this.finger = null;           // { on, p, axis, len, r }
    this.floorY = 0;
    this.wrist = [{ P: [0, 0, 0], T: [0, 0, 1], U: [0, 1, 0] }, { P: [0, 0, 0], T: [0, 0, 1], U: [0, 1, 0] }];
  }
  // how firmly the wire holds the pose (per substep): near the hip most, less toward the toe
  setWire(wire) {
    this.wire = wire;
    const k0 = 0.06 + 0.28 * wire;
    for (let k = 0; k < this.n; k++) { const t = this.j[k] / (this.K - 1); this.kp[k] = this.w[k] === 0 ? 1 : k0 * (1 - 0.55 * t); }
  }
  setTargets(t) { this.target0.set(this.target); this.target.set(t); }
  snap() { this.x.set(this.target); this.prev.set(this.x); this.v.fill(0); this.target0.set(this.target); }

  step(dt) {
    const sub = this.substeps, h = dt / sub, n = this.n, K = this.K;
    const x = this.x, prev = this.prev, v = this.v, w = this.w, T = this.target, T0 = this.target0, KP = this.kp;
    const kD = Math.exp(-this.drag * h), g = 9.81 * this.gScale * h;
    for (let s = 0; s < sub; s++) {
      const fr = (s + 1) / sub;
      for (let k = 0; k < n; k++) {
        const q = 3 * k;
        if (w[k] === 0) {
          prev[q] = x[q]; prev[q + 1] = x[q + 1]; prev[q + 2] = x[q + 2];
          x[q] = T0[q] + (T[q] - T0[q]) * fr; x[q + 1] = T0[q + 1] + (T[q + 1] - T0[q + 1]) * fr; x[q + 2] = T0[q + 2] + (T[q + 2] - T0[q + 2]) * fr;
          continue;
        }
        v[q + 1] -= g;
        v[q] *= kD; v[q + 1] *= kD; v[q + 2] *= kD;
        prev[q] = x[q]; prev[q + 1] = x[q + 1]; prev[q + 2] = x[q + 2];
        x[q] += v[q] * h; x[q + 1] += v[q + 1] * h; x[q + 2] += v[q + 2] * h;
      }
      // the wire: every point drawn toward its pose (a grabbed point is the hand's)
      const held = this.grab ? this.grabMask : null;
      for (let k = 0; k < n; k++) {
        if (w[k] === 0) continue;
        const q = 3 * k;
        let kk = KP[k];
        if (held && held[k] > 0) kk *= 1 - held[k];
        const tx = T0[q] + (T[q] - T0[q]) * fr, ty = T0[q + 1] + (T[q + 1] - T0[q + 1]) * fr, tz = T0[q + 2] + (T[q + 2] - T0[q + 2]) * fr;
        x[q] += (tx - x[q]) * kk; x[q + 1] += (ty - x[q + 1]) * kk; x[q + 2] += (tz - x[q + 2]) * kk;
      }
      // walking: the toe (and a little of the shin) to its foothold
      for (let l = 0; l < this.nL; l++) {
        const fw = this.footW[l];
        if (fw <= 0 || this.isArm[l]) continue;
        for (let j = K - 3; j < K; j++) {
          const k = l * K + j, q = 3 * k, f = fw * (j === K - 1 ? 0.55 : j === K - 2 ? 0.12 : 0.04);
          if (held && held[k] > 0) continue;
          const lift = j === K - 1 ? 0 : 0.05 * (K - 1 - j);
          x[q] += (this.foot[3 * l] - x[q]) * f; x[q + 1] += (this.foot[3 * l + 1] + lift - x[q + 1]) * f; x[q + 2] += (this.foot[3 * l + 2] - x[q + 2]) * f;
        }
      }
      if (this.grab) this.solveGrab();
      for (let it = 0; it < this.iters; it++) this.solveConstraints();
      if (this.finger && this.finger.on) this.solveFinger();
      this.collide();
      const inv = 1 / h;
      for (let k = 0; k < n; k++) {
        const q = 3 * k;
        v[q] = (x[q] - prev[q]) * inv; v[q + 1] = (x[q + 1] - prev[q + 1]) * inv; v[q + 2] = (x[q + 2] - prev[q + 2]) * inv;
        const sp = v[q] * v[q] + v[q + 1] * v[q + 1] + v[q + 2] * v[q + 2];
        if (sp > 400) { const f = 20 / Math.sqrt(sp); v[q] *= f; v[q + 1] *= f; v[q + 2] *= f; }
      }
    }
  }

  solveConstraints() {
    const x = this.x, w = this.w, ca = this.ca, cb = this.cb, cr = this.cr;
    for (let q = 0; q < this.nC; q++) {
      const a = 3 * ca[q], b = 3 * cb[q], wa = w[ca[q]], wb = w[cb[q]], ws = wa + wb;
      if (ws === 0) continue;
      const dx = x[b] - x[a], dy = x[b + 1] - x[a + 1], dz = x[b + 2] - x[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 1e-9) continue;
      const s = -(d - cr[q]) / ws / d;
      x[a] -= dx * s * wa; x[a + 1] -= dy * s * wa; x[a + 2] -= dz * s * wa;
      x[b] += dx * s * wb; x[b + 1] += dy * s * wb; x[b + 2] += dz * s * wb;
    }
  }

  collide() {
    const x = this.x, w = this.w, prev = this.prev, S = this.spheres, n = this.n, R = this.rad, J = this.j;
    for (let k = 0; k < n; k++) {
      if (w[k] === 0) continue;
      const q = 3 * k, pad = R[k] + 0.02;
      if (J[k] >= 2) for (let s = 0; s < S.length; s++) {
        const c = S[s].c, r = S[s].r + pad;
        const dx = x[q] - c[0], dy = x[q + 1] - c[1], dz = x[q + 2] - c[2], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= r * r || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), f = (r - d) / d;
        x[q] += dx * f; x[q + 1] += dy * f; x[q + 2] += dz * f;
      }
      const fl = this.floorY + R[k];
      if (x[q + 1] < fl) {
        x[q + 1] = fl;
        // a toe grips the table; the rest of the leg slides on it
        const grip = J[k] === this.K - 1 ? 0.8 : 0.35;
        x[q] += (prev[q] - x[q]) * grip; x[q + 2] += (prev[q + 2] - x[q + 2]) * grip;
      }
    }
  }

  solveFinger() {
    const F = this.finger, x = this.x, w = this.w;
    const fx = F.p[0], fy = F.p[1], fz = F.p[2], A = F.axis, L = F.len;
    let touch = 0;
    for (let k = 0; k < this.n; k++) {
      if (w[k] === 0 || this.isArm[(k / this.K) | 0]) continue;
      const q = 3 * k, rf = F.r + this.rad[k] + 0.015;
      let rx = x[q] - fx, ry = x[q + 1] - fy, rz = x[q + 2] - fz;
      const t = Math.min(L, Math.max(0, rx * A[0] + ry * A[1] + rz * A[2]));
      rx -= A[0] * t; ry -= A[1] * t; rz -= A[2] * t;
      const d = Math.sqrt(rx * rx + ry * ry + rz * rz);
      if (d >= rf || d < 1e-6) continue;
      const s = (rf - d) / d;
      x[q] += rx * s; x[q + 1] += ry * s; x[q + 2] += rz * s;
      touch++;
    }
    this.fingerTouch = touch;
  }

  // ── grabbing: a few points along the limb follow the hand; the wire lets go of them ──
  pickTris(o, d, pos, index) {
    let best = Infinity;
    for (let t = 0; t < index.length; t += 3) {
      const a = 3 * index[t], b = 3 * index[t + 1], c = 3 * index[t + 2];
      const ax = pos[a], ay = pos[a + 1], az = pos[a + 2];
      const e1x = pos[b] - ax, e1y = pos[b + 1] - ay, e1z = pos[b + 2] - az;
      const e2x = pos[c] - ax, e2y = pos[c + 1] - ay, e2z = pos[c + 2] - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det, tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
      const uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-4 && tt < best) best = tt;
    }
    return best;
  }
  beginGrab(hit) {
    const x = this.x, K = this.K;
    let best = -1, bd = Infinity;
    for (let k = 0; k < this.n; k++) { if (this.w[k] === 0) continue; const d = (x[3 * k] - hit[0]) ** 2 + (x[3 * k + 1] - hit[1]) ** 2 + (x[3 * k + 2] - hit[2]) ** 2; if (d < bd) { bd = d; best = k; } }
    if (best < 0) return false;
    const leg = Math.floor(best / K), jc = best % K;
    const idx = [], wt = [], off = [];
    this.grabMask = new Float32Array(this.n);
    for (let j = 1; j < K; j++) {
      const dj = Math.abs(j - jc);
      if (dj > 1) continue;
      const k = leg * K + j, ww = dj === 0 ? 1 : 0.45;
      idx.push(k); wt.push(ww); off.push(x[3 * k] - hit[0], x[3 * k + 1] - hit[1], x[3 * k + 2] - hit[2]); this.grabMask[k] = ww;
    }
    this.grab = { idx, wt, off, t: hit.slice(), leg, center: best };
    return true;
  }
  moveGrab(t) { if (this.grab) this.grab.t = t.slice(); }
  endGrab() { this.grab = null; this.grabMask = null; }
  solveGrab() {
    const G = this.grab, x = this.x;
    for (let m = 0; m < G.idx.length; m++) {
      const k = G.idx[m], q = 3 * k, f = G.wt[m] * 0.7;
      x[q] += (G.t[0] + G.off[3 * m] - x[q]) * f; x[q + 1] += (G.t[1] + G.off[3 * m + 1] - x[q + 1]) * f; x[q + 2] += (G.t[2] + G.off[3 * m + 2] - x[q + 2]) * f;
    }
  }
  // how far the grabbed point is from where it can reach (the limb straight out from its hip): past
  // that, the hand is pulling the whole crab by that limb
  grabOverreach() {
    if (!this.grab) return null;
    const K = this.K, l = this.grab.leg, jc = this.grab.center % K, x = this.x, h = 3 * (l * K);
    const reach = jc * this.cr[l * (K - 1)] * 1.02;
    const dx = this.grab.t[0] - x[h], dy = this.grab.t[1] - x[h + 1], dz = this.grab.t[2] - x[h + 2], d = Math.hypot(dx, dy, dz);
    return d > reach ? [dx * (1 - reach / d), dy * (1 - reach / d), dz * (1 - reach / d)] : [0, 0, 0];
  }

  // ── the plush tubes: the ten limbs, then four claw fingers ──
  surface(L, dyn, fur, up, pileShort = 0.42) {
    const K = this.K, R = L.R, RS = L.specs[0].rs, x = this.x;
    const cr = (p0, p1, p2, p3, t) => 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    if (!this._c || this._c.length !== RS * 3) { this._c = new Float32Array(RS * 3); this._r = new Float32Array(RS); }
    const Cn = this._c, Rd = this._r;
    for (let l = 0; l < this.nL; l++) {
      const o = l * K, leg = LEGS[l];
      const P = (j, q) => {
        if (j < 0) return 2 * x[3 * o + q] - x[3 * (o + 1) + q];
        if (j > K - 1) return 2 * x[3 * (o + K - 1) + q] - x[3 * (o + K - 2) + q];
        return x[3 * (o + j) + q];
      };
      for (let I = 0; I < RS; I++) {
        const f = I / R, j = Math.min(K - 2, Math.floor(f)), t = f - j;
        for (let q = 0; q < 3; q++) Cn[3 * I + q] = cr(P(j - 1, q), P(j, q), P(j + 1, q), P(j + 2, q), t);
        Rd[I] = limbRadius(leg, I / (RS - 1));
      }
      // the first ring sits a little inside the body
      Cn[0] -= (Cn[3] - Cn[0]) * 1.5; Cn[1] -= (Cn[4] - Cn[1]) * 1.5; Cn[2] -= (Cn[5] - Cn[2]) * 1.5;
      const end = sweepTube(L, l, Cn, Rd, up, dyn, fur, pileShort);
      if (leg.kind === 'arm') { const w = this.wrist[l - NWALK]; w.P = end.P; w.T = end.T; w.U = end.U; }
    }
  }
  // the claw fingers, hung from each wrist in the claw's own frame; theta[a] is the opening angle of arm a
  claws(L, dyn, fur, theta, pileShort = 0.42) {
    const RS = L.specs[NLEG].rs;
    if (!this._fc || this._fc.length !== RS * 3) { this._fc = new Float32Array(RS * 3); this._fr = new Float32Array(RS); }
    const Cn = this._fc, Rd = this._fr;
    for (let a = 0; a < 2; a++) {
      const w = this.wrist[a], T = w.T;
      // the claw opens in the plane across the arm's end: S = T × U (horizontal when the arm lies flat)
      const S = norm(cross(T, w.U)), B = cross(T, S);
      for (let f = 0; f < 2; f++) {
        const i = f === 0 ? -1 : 1, al = i * theta[a], ca = Math.cos(al), sa = Math.sin(al);
        for (let m = 0; m < RS; m++) {
          const u = m / (RS - 1), r = fingerRadius(u);
          const t0 = CLAW.t0 + (CLAW.len - CLAW.t0) * u;
          const s0 = i * (r * 0.96 + CLAW.gape * Math.sin(Math.PI * Math.pow(u, 0.85)));
          const t = t0 * ca - s0 * sa, s = t0 * sa + s0 * ca;
          for (let q = 0; q < 3; q++) Cn[3 * m + q] = w.P[q] + T[q] * t + S[q] * s;
          Rd[m] = r;
        }
        sweepTube(L, NLEG + 2 * a + f, Cn, Rd, B, dyn, fur, pileShort);
      }
    }
  }
}

// ── the plush tube mesh: rings round a centre line, a rounded end, per-tube radius profiles ──
const NT_SIN = [], NT_COS = [];
function tubeLayout(specs, NT, R) {
  const CAP = 3, idx = [], st = [], off = [];
  let nV = 0;
  for (const sp of specs) {
    const rs = sp.rs, rg = rs + CAP, v0 = nV;
    off.push(v0);
    const rEnd = sp.radius(1);
    for (let i = 0; i < rg; i++) {
      const s = Math.min(1, i / (rs - 1)), c = i - rs + 1;
      let rad = sp.radius(s), y = -s * sp.len;
      if (c > 0) { const a = (c / (CAP + 0.6)) * Math.PI / 2; rad = rEnd * Math.cos(a); y = -sp.len - rEnd * Math.sin(a); }
      for (let k = 0; k < NT; k++) {
        const th = 2 * Math.PI * k / NT;
        st.push(sp.id * 0.9 + Math.cos(th) * rad, y, Math.sin(th) * rad, 0, sp.kind, s, c > 0 ? 1 : 0, -3);
      }
    }
    st.push(sp.id * 0.9, -sp.len - rEnd, 0, 0, sp.kind, 1, 1, -3);
    for (let i = 0; i < rg - 1; i++) for (let k = 0; k < NT; k++) {
      const p = v0 + i * NT + k, q = v0 + i * NT + (k + 1) % NT;
      idx.push(p, p + NT, q, q, p + NT, q + NT);
    }
    const tip = v0 + rg * NT, last = v0 + (rg - 1) * NT;
    for (let k = 0; k < NT; k++) idx.push(last + k, tip, last + (k + 1) % NT);
    nV += rg * NT + 1;
  }
  return { specs, off, NT, CAP, R, nV, index: new Uint32Array(idx), statics: new Float32Array(st) };
}
// sweep tube t along its centre line Cn (RS points, radii Rd): a parallel-transport frame from `up`
function sweepTube(L, t, Cn, Rd, up, dyn, fur, pileShort) {
  const NT = L.NT, RS = L.specs[t].rs, v0 = L.off[t];
  if (NT_COS.length !== NT) { NT_COS.length = 0; NT_SIN.length = 0; for (let k = 0; k < NT; k++) { NT_COS.push(Math.cos(2 * Math.PI * k / NT)); NT_SIN.push(Math.sin(2 * Math.PI * k / NT)); } }
  const cs = NT_COS, sn = NT_SIN;
  let Tx = Cn[3] - Cn[0], Ty = Cn[4] - Cn[1], Tz = Cn[5] - Cn[2];
  let tl = Math.hypot(Tx, Ty, Tz) || 1; Tx /= tl; Ty /= tl; Tz /= tl;
  let Ux = up[0], Uy = up[1], Uz = up[2];
  const d0 = Ux * Tx + Uy * Ty + Uz * Tz; Ux -= Tx * d0; Uy -= Ty * d0; Uz -= Tz * d0;
  let ul = Math.hypot(Ux, Uy, Uz); if (ul < 1e-6) { Ux = 1; Uy = 0; Uz = 0; ul = 1; } Ux /= ul; Uy /= ul; Uz /= ul;
  const ring = (I, cx, cy, cz, rad, tx, ty, tz, ux, uy, uz, nOut) => {
    const bx = ty * uz - tz * uy, by = tz * ux - tx * uz, bz = tx * uy - ty * ux;
    for (let k = 0; k < NT; k++) {
      const nx = ux * cs[k] + bx * sn[k], ny = uy * cs[k] + by * sn[k], nz = uz * cs[k] + bz * sn[k];
      const v = v0 + I * NT + k, o6 = 6 * v, w4 = 4 * v;
      dyn[o6] = cx + nx * rad; dyn[o6 + 1] = cy + ny * rad; dyn[o6 + 2] = cz + nz * rad;
      let mx = nx * (1 - nOut) + tx * nOut, my = ny * (1 - nOut) + ty * nOut, mz = nz * (1 - nOut) + tz * nOut;
      const ml = Math.hypot(mx, my, mz) || 1;
      dyn[o6 + 3] = mx / ml; dyn[o6 + 4] = my / ml; dyn[o6 + 5] = mz / ml;
      fur[w4] = tx * 0.5; fur[w4 + 1] = ty * 0.5; fur[w4 + 2] = tz * 0.5; fur[w4 + 3] = pileShort;
    }
  };
  for (let I = 0; I < RS; I++) {
    const a = Math.max(0, I - 1), b = Math.min(RS - 1, I + 1);
    let nx = Cn[3 * b] - Cn[3 * a], ny = Cn[3 * b + 1] - Cn[3 * a + 1], nz = Cn[3 * b + 2] - Cn[3 * a + 2];
    const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    // carry the up vector round with the curve
    const d = Ux * nx + Uy * ny + Uz * nz; Ux -= nx * d; Uy -= ny * d; Uz -= nz * d;
    ul = Math.hypot(Ux, Uy, Uz) || 1; Ux /= ul; Uy /= ul; Uz /= ul;
    Tx = nx; Ty = ny; Tz = nz;
    ring(I, Cn[3 * I], Cn[3 * I + 1], Cn[3 * I + 2], Rd[I], Tx, Ty, Tz, Ux, Uy, Uz, 0);
  }
  // the rounded end
  const e = 3 * (RS - 1), rEnd = Rd[RS - 1];
  for (let c = 1; c <= L.CAP; c++) {
    const a = (c / (L.CAP + 0.6)) * Math.PI / 2;
    ring(RS - 1 + c, Cn[e] + Tx * Math.sin(a) * rEnd, Cn[e + 1] + Ty * Math.sin(a) * rEnd, Cn[e + 2] + Tz * Math.sin(a) * rEnd, rEnd * Math.cos(a), Tx, Ty, Tz, Ux, Uy, Uz, Math.sin(a));
  }
  const tv = v0 + (RS + L.CAP) * NT, o6 = 6 * tv;
  dyn[o6] = Cn[e] + Tx * rEnd; dyn[o6 + 1] = Cn[e + 1] + Ty * rEnd; dyn[o6 + 2] = Cn[e + 2] + Tz * rEnd;
  dyn[o6 + 3] = Tx; dyn[o6 + 4] = Ty; dyn[o6 + 5] = Tz;
  fur[4 * tv] = 0; fur[4 * tv + 1] = 0; fur[4 * tv + 2] = 0; fur[4 * tv + 3] = pileShort;
  return { P: [Cn[e], Cn[e + 1], Cn[e + 2]], T: [Tx, Ty, Tz], U: [Ux, Uy, Uz] };
}
// the tube set: limbs (RS rings each), then two fingers per arm
function crabTubes(R, NT, RSF) {
  const RS = (KSEG - 1) * R + 1, specs = [];
  for (let l = 0; l < NLEG; l++) {
    const leg = LEGS[l];
    specs.push({ id: l, kind: leg.kind === 'arm' ? 1 : 0, rs: RS, len: leg.kind === 'arm' ? ARM_LEN : LEG_LEN, radius: s => limbRadius(leg, s) });
  }
  for (let a = 0; a < 2; a++) for (let f = 0; f < 2; f++) {
    specs.push({ id: NLEG + 2 * a + f, kind: 2, rs: RSF, len: CLAW.len, radius: u => fingerRadius(u) });
  }
  return tubeLayout(specs, NT, R);
}

// the body's frame from four embedded points (origin, +x, +y, +z offsets): rotation by Gram–Schmidt
function bodyFrame(P) {
  const e1 = [P[3] - P[0], P[4] - P[1], P[5] - P[2]], l1 = Math.hypot(...e1) || 1;
  for (let k = 0; k < 3; k++) e1[k] /= l1;
  const e2 = [P[6] - P[0], P[7] - P[1], P[8] - P[2]], d = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
  for (let k = 0; k < 3; k++) e2[k] -= e1[k] * d;
  const l2 = Math.hypot(...e2) || 1; for (let k = 0; k < 3; k++) e2[k] /= l2;
  const e3 = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  return [e1[0], e2[0], e3[0], e1[1], e2[1], e3[1], e1[2], e2[2], e3[2]];
}

// ===== shaders.js =====
// ─────────────────────────────────────────────────────────────
//  WGSL — studio floor, sewn-on parts, the finger and the shell fur
// ─────────────────────────────────────────────────────────────

// where each limb is sewn on, and the felt behind the eyes (rest space): constants for the stitches and the short pile
const wv3 = v => `vec3f(${v.map(q => q.toFixed(5)).join(', ')})`;
const HIPS_WGSL = `
var<private> HIPS: array<vec3f, ${NLEG}> = array<vec3f, ${NLEG}>(${LEGS.map(L => wv3(L.hip)).join(', ')});
var<private> HDIR: array<vec3f, ${NLEG}> = array<vec3f, ${NLEG}>(${LEGS.map(L => wv3(L.d)).join(', ')});
const EYEP = ${wv3(eyeFrames()[1].p)};
const ECTR = ${wv3(eyeFrames()[1].ctr)};
const EAX = ${wv3(eyeFrames()[1].ax)};`;

const WGSL_COMMON = /* wgsl */`
struct U {
  viewProj: mat4x4f,
  view: mat4x4f,
  invViewProj: mat4x4f,
  lightVP: mat4x4f,
  topVP: mat4x4f,
  camPos: vec4f,     // xyz, w = time
  camFwd: vec4f,
  keyDir: vec4f,     // xyz toward light, w = intensity
  screen: vec4f,     // w, h, 1/w, 1/h
  furRoot: vec4f,    // fur colour at the root, w = fur length
  furTip: vec4f,     // fur colour at the tip, w = shell count
  under: vec4f,      // the paler fabric under the shell
  cheek: vec4f,      // blush
  felt: vec4f,       // the white felt patches
  skin: vec4f,       // the finger
  finger: vec4f,     // finger tip (xyz), radius
  misc: vec4f,       // exposure, meshAlpha, floorY, strand spacing
  bg: vec4f,
  shadowTint: vec4f,
  iris: vec4f,       // the ring around the pupil
  smile: vec4f,      // smile curve: y0, lift, half width, thread
  maps: vec4f,       // shadow map half size, height map half size, light depth range, camera distance
  spot: vec4f,       // the pale spots on the shell
  band: vec4f,       // the pale joint bands and toes
  clawc: vec4f,      // the claw tips
  extra: vec4f,      // where each loose pupil sits in its dome: left eye xy, right eye zw
  quirk: vec4f,      // dizzy swirl amount, its phase
  page: vec4f,       // desktop-pet mode: edge fade on, then unused
};

const PI = 3.14159265;
// pw() of a negative number is NaN on real GPUs (a black speck); smoothstep with its edges given
// high-to-low is undefined on some backends — so both are spelled out
fn pw(x: f32, e: f32) -> f32 { return pow(max(x, 0.0), e); }
fn sstep(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
const SUN = vec3f(1.16, 1.10, 1.02);

fn hash3(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
fn hash33(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
fn vnoise(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash3(i + vec3f(0,0,0)), hash3(i + vec3f(1,0,0)), u.x), mix(hash3(i + vec3f(0,1,0)), hash3(i + vec3f(1,1,0)), u.x), u.y);
  let b = mix(mix(hash3(i + vec3f(0,0,1)), hash3(i + vec3f(1,0,1)), u.x), mix(hash3(i + vec3f(0,1,1)), hash3(i + vec3f(1,1,1)), u.x), u.y);
  return mix(a, b, u.z);
}
fn fbm(p: vec3f) -> f32 {
  return 0.55 * vnoise(p) + 0.3 * vnoise(p * 2.13 + 7.1) + 0.15 * vnoise(p * 4.37 + 3.3);
}

// rounded rectangle softbox seen along direction d
fn softbox(d: vec3f, c: vec3f, up: vec3f, size: vec2f, blur: f32) -> f32 {
  let cd = dot(d, c);
  if (cd <= 0.0) { return 0.0; }
  let t1 = normalize(cross(up, c));
  let t2 = cross(c, t1);
  let uv = vec2f(dot(d, t1), dot(d, t2)) / cd;
  let q = abs(uv) - size;
  let sd = length(max(q, vec2f(0.0))) + min(max(q.x, q.y), 0.0) - 0.04;
  return 1.0 - sstep(-blur, blur, sd);
}
// procedural photo studio: pale cyclorama, overhead softbox, back-left strip, front-right fill card
fn studioEnv(d: vec3f, rough: f32, bg: vec3f) -> vec3f {
  let b = 0.012 + rough * 0.55;
  let y = d.y;
  var col = mix(bg * 0.62, bg * 1.05, sstep(-0.35, 0.25, y));
  col += bg * 0.55 * (1.0 - sstep(0.0, 0.3, abs(y + 0.08)));
  col = mix(col, bg * 0.8, sstep(0.3, 1.0, y));
  col += vec3f(1.0, 0.985, 0.96) * 3.2 * softbox(d, normalize(vec3f(0.05, 1.0, -0.15)), vec3f(0.0, 0.0, 1.0), vec2f(0.55, 0.32), b);
  col += vec3f(1.0, 0.98, 0.95) * 3.0 * softbox(d, normalize(vec3f(-0.42, 0.34, -0.8)), vec3f(0.0, 1.0, 0.0), vec2f(0.7, 0.06), b);
  col += vec3f(1.0, 0.97, 0.93) * 4.0 * softbox(d, normalize(vec3f(-0.8, 0.38, -0.2)), vec3f(0.0, 1.0, 0.0), vec2f(0.08, 0.55), b);
  col += vec3f(0.95, 0.97, 1.0) * 1.6 * softbox(d, normalize(vec3f(0.62, 0.32, 0.72)), vec3f(0.0, 1.0, 0.0), vec2f(0.45, 0.5), b * 1.3);
  return col;
}

fn ggx(N: vec3f, V: vec3f, L: vec3f, rough: f32) -> f32 {
  let H = normalize(V + L);
  let a = max(rough * rough, 0.002);
  let a2 = a * a;
  let NdH = max(dot(N, H), 0.0);
  let NdL = max(dot(N, L), 0.0);
  let NdV = max(dot(N, V), 1e-3);
  let dd = NdH * NdH * (a2 - 1.0) + 1.0;
  let D = a2 / (PI * dd * dd);
  let k = a * 0.5;
  let G = (NdL / (NdL * (1.0 - k) + k)) * (NdV / (NdV * (1.0 - k) + k));
  return D * G / max(4.0 * NdL * NdV, 1e-3) * NdL;
}

fn linearDepth(p: vec3f) -> f32 { return dot(p - u.camPos.xyz, u.camFwd.xyz); }

// ── where things are on the crab, in rest space (they deform with the body) ──
// body arm: x = the top of the shell (where the spots go), y = the paler underside, z = the face, w = round the hips
// tube arm: x = 0 leg / 1 arm / 2 claw finger, y = along it (0 hip … 1 toe), z = the end cap, w = -3
${HIPS_WGSL}
struct Reg { len: f32, under: f32, cheek: f32, thread: f32, top: f32, band: f32, tip: f32, limb: f32 };
fn regions(Q: vec3f, arm: vec4f) -> Reg {
  var r: Reg;
  r.len = 1.0; r.under = 0.0; r.cheek = 0.0; r.thread = 0.0; r.top = 0.0; r.band = 0.0; r.tip = 0.0; r.limb = 0.0;
  if (arm.w < -2.5) {
    let s = arm.y;
    r.limb = 1.0;
    if (arm.x < 0.5) {
      // a walking leg: pale bands at the joints and a pale little foot
      let b1 = 1.0 - sstep(0.02, 0.055, abs(s - 0.34));
      let b2 = 1.0 - sstep(0.02, 0.055, abs(s - 0.64));
      let toe = sstep(0.9, 0.95, s);
      r.band = max(max(b1, b2), toe);
      r.len = mix(0.9, 0.6, toe);
    } else if (arm.x < 1.5) {
      // an arm: a band at the elbow and another at the wrist
      let b1 = 1.0 - sstep(0.02, 0.055, abs(s - 0.34));
      let b2 = 1.0 - sstep(0.02, 0.055, abs(s - 0.6));
      r.band = max(b1, b2);
      r.len = 0.9;
    } else {
      // a claw finger: a dark tip
      r.tip = sstep(0.72, 0.86, s);
      r.len = mix(0.85, 0.45, r.tip);
    }
    return r;
  }
  let ax = abs(Q.x);
  let face = arm.z;
  // blush either side of the smile
  let ch = length(vec2f((ax - 0.34) / 0.09, (Q.y - 0.31) / 0.065));
  r.cheek = (1.0 - sstep(0.3, 1.1, ch)) * face;
  r.len = mix(r.len, 0.8, r.cheek);
  // the smile: a groove where the thread is laid in
  let sy = u.smile.x + u.smile.y * (Q.x / u.smile.z) * (Q.x / u.smile.z);
  let sd = abs(Q.y - sy) + max(ax - u.smile.z, 0.0) * 3.0;
  r.len = mix(r.len, 0.03, (1.0 - sstep(0.014, 0.042, sd)) * face);
  // the face is cropped a little shorter, and short round the felt behind each eye
  r.len = mix(r.len, 0.75, face);
  let ed = length(vec3f(ax, Q.y, Q.z) - EYEP);
  r.len = mix(r.len, 0.12, 1.0 - sstep(0.14, 0.2, ed));
  r.top = arm.x * (1.0 - sstep(0.16, 0.3, Q.z));
  // a pale underside
  r.under = arm.y * 0.85;
  r.len = mix(r.len, 0.7, arm.y);
  // short and stitched round where each limb is sewn on
  r.thread = arm.w;
  r.len = mix(r.len, 0.35, arm.w);
  return r;
}
// the pale spots: jittered discs scattered over the top of the shell (rest space, looked down on)
fn spotAt(Q: vec3f) -> f32 {
  let g = Q.xz / 0.17;
  let i0 = floor(g);
  var best = 0.0;
  for (var a = -1; a <= 1; a++) {
    for (var b = -1; b <= 1; b++) {
      let c = i0 + vec2f(f32(a), f32(b));
      let h = hash33(vec3f(c, 3.7));
      if (h.z < 0.3) { continue; }
      let ctr = c + 0.18 + h.xy * 0.64;
      let rad = 0.13 + 0.17 * fract(h.x * 7.3 + h.y * 3.1);
      best = max(best, 1.0 - sstep(rad * 0.8, rad, length(g - ctr)));
    }
  }
  return best;
}
// the running stitches round each hip: a dashed ring on the shell
fn stitch(Q: vec3f) -> f32 {
  var best = 0.0;
  for (var l = 0; l < ${NLEG}; l++) {
    let q = Q - HIPS[l];
    let d = length(q);
    if (d > 0.1) { continue; }
    let e2 = normalize(cross(HDIR[l], vec3f(0.0, 1.0, 0.0)));
    let ang = atan2(q.y, dot(q, e2));
    let dash = step(0.5, fract(ang * 2.546));
    best = max(best, (1.0 - sstep(0.005, 0.011, abs(d - 0.07))) * dash);
  }
  return best;
}
`;

const WGSL_DEPTH = /* wgsl */`
@group(0) @binding(0) var<uniform> m: mat4x4f;
@vertex fn vs(@location(0) p: vec3f) -> @builtin(position) vec4f { return m * vec4f(p, 1.0); }
`;

const WGSL_LIGHTING = /* wgsl */`
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var shadowMap: texture_depth_2d;
@group(0) @binding(2) var heightMap: texture_depth_2d;
@group(0) @binding(3) var cmp: sampler_comparison;

var<private> POISSON: array<vec2f, 16> = array<vec2f, 16>(
  vec2f(-0.94201624, -0.39906216), vec2f(0.94558609, -0.76890725), vec2f(-0.094184101, -0.92938870), vec2f(0.34495938, 0.29387760),
  vec2f(-0.91588581, 0.45771432), vec2f(-0.81544232, -0.87912464), vec2f(-0.38277543, 0.27676845), vec2f(0.97484398, 0.75648379),
  vec2f(0.44323325, -0.97511554), vec2f(0.53742981, -0.47373420), vec2f(-0.26496911, -0.41893023), vec2f(0.79197514, 0.19090188),
  vec2f(-0.24188840, 0.99706507), vec2f(-0.81409955, 0.91437590), vec2f(0.19984126, 0.78641367), vec2f(0.14383161, -0.14100790));

// soft key shadow (PCSS-lite: blocker search sets the penumbra, in world units)
fn keyShadow(P: vec3f, bias: f32) -> f32 {
  let lp = u.lightVP * vec4f(P, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  let z = lp.z - bias;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  let toUv = 0.5 / u.maps.x;
  let dims = vec2f(textureDimensions(shadowMap));
  var blk = 0.0; var nb = 0.0;
  for (var i = 0; i < 16; i++) {
    let s = uv + POISSON[i] * 0.2 * toUv;
    let d = textureLoad(shadowMap, vec2i(clamp(s, vec2f(0.0), vec2f(0.999)) * dims), 0);
    if (d < z - 0.0008) { blk += d; nb += 1.0; }
  }
  if (nb < 0.5) { return 1.0; }
  blk /= nb;
  let pen = clamp((z - blk) * u.maps.z * 0.075, 0.018, 0.2) * toUv;
  var sum = 0.0;
  let rot = hash3(P * 91.7) * 6.2831;
  let cs = vec2f(cos(rot), sin(rot));
  for (var i = 0; i < 16; i++) {
    let o = POISSON[i];
    let r = vec2f(o.x * cs.x - o.y * cs.y, o.x * cs.y + o.y * cs.x);
    sum += textureSampleCompareLevel(shadowMap, cmp, uv + r * pen, z - 0.0006);
  }
  return sum / 16.0;
}
// a cheap five-tap version for the fur shells (evaluated per vertex)
fn keyShadowSoft(P: vec3f, bias: f32) -> f32 {
  let lp = u.lightVP * vec4f(P, 1.0);
  let uv = vec2f(lp.x * 0.5 + 0.5, 0.5 - lp.y * 0.5);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { return 1.0; }
  let r = 0.05 * 0.5 / u.maps.x;
  let z = lp.z - bias;
  var s = textureSampleCompareLevel(shadowMap, cmp, uv, z);
  s += textureSampleCompareLevel(shadowMap, cmp, uv + vec2f(r, 0.0), z);
  s += textureSampleCompareLevel(shadowMap, cmp, uv - vec2f(r, 0.0), z);
  s += textureSampleCompareLevel(shadowMap, cmp, uv + vec2f(0.0, r), z);
  s += textureSampleCompareLevel(shadowMap, cmp, uv - vec2f(0.0, r), z);
  return s / 5.0;
}

fn contactAO(P: vec3f) -> f32 {
  let tp = u.topVP * vec4f(P, 1.0);
  let uv = vec2f(tp.x * 0.5 + 0.5, 0.5 - tp.y * 0.5);
  let dims = vec2f(textureDimensions(heightMap));
  let toUv = 0.5 / u.maps.y;
  var occ = 0.0;
  for (var ring = 0; ring < 3; ring++) {
    let rad = 0.07 + f32(ring) * 0.2;
    for (var i = 0; i < 8; i++) {
      let a = f32(i) * 0.785398 + f32(ring) * 0.39;
      let s = uv + vec2f(cos(a), sin(a)) * rad * toUv;
      if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) { continue; }
      let d = textureLoad(heightMap, vec2i(s * dims), 0);
      let h = d * 6.0 - 1.0;
      if (d < 0.9999) {
        let dist = rad + 0.08;
        occ += (1.0 - sstep(0.0, 0.6 + dist * 1.1, h)) * (1.0 - f32(ring) * 0.22);
      }
    }
  }
  return clamp(occ / 16.0, 0.0, 1.0);
}

// light falling on the fur from the studio: a bright sweep above, the warm table below
fn ambientAt(N: vec3f) -> vec3f {
  return mix(u.bg.rgb * vec3f(0.8, 0.76, 0.74), u.bg.rgb * 1.05, N.y * 0.5 + 0.5);
}
`;

// ── scene: background / floor, then the sewn-on parts ──
const WGSL_SCENE = WGSL_COMMON + WGSL_LIGHTING + /* wgsl */`
struct FSOut { @builtin(position) pos: vec4f, @location(0) ndc: vec2f };
@vertex fn vsFull(@builtin(vertex_index) i: u32) -> FSOut {
  var o: FSOut;
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  o.pos = vec4f(p, 0.0, 1.0); o.ndc = p; return o;
}

@fragment fn fsBackground(i: FSOut) -> @location(0) vec4f {
  let a = u.invViewProj * vec4f(i.ndc, 0.0, 1.0);
  let b = u.invViewProj * vec4f(i.ndc, 1.0, 1.0);
  let ro = a.xyz / a.w;
  let rd = normalize(b.xyz / b.w - ro);
  // sprite bake: the studio sweep drops out and only the contact shadow survives, as alpha
  if (u.page.x > 1.5) {
    var sa = 0.0;
    if (rd.y < -1e-4) {
      let t = (u.misc.z - ro.y) / rd.y;
      let P = ro + rd * t;
      let sh = keyShadow(P, 0.0);
      let ao = contactAO(P);
      let fade = sstep(u.maps.w * 1.1, u.maps.w * 3.3, t);
      sa = clamp((1.0 - sh) * 0.5 + ao * 0.45, 0.0, 0.8) * (1.0 - fade);
    }
    return vec4f(vec3f(0.05, 0.06, 0.04) * sa, sa);
  }
  var col = u.bg.rgb;
  col *= 1.0 - 0.08 * sstep(0.0, 0.6, rd.y);
  if (rd.y < -1e-4) {
    let t = (u.misc.z - ro.y) / rd.y;
    let P = ro + rd * t;
    let sh = keyShadow(P, 0.0);
    let ao = contactAO(P);
    let shadowCol = mix(vec3f(1.0), u.shadowTint.rgb, 1.0 - sh);
    var fl = u.bg.rgb * (0.9 + 0.1 * clamp(1.0 - length(P.xz) * 0.06, 0.0, 1.0));
    fl *= shadowCol;
    fl *= 1.0 - ao * 0.78;
    let fade = sstep(u.maps.w * 1.1, u.maps.w * 3.3, t);
    col = mix(fl, col, fade);
  }
  return vec4f(col, 1.0);
}

struct VIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) mat: f32, @location(5) arm: vec4f };
struct VOut { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) mat: f32 };
@vertex fn vsMesh(v: VIn) -> VOut {
  var o: VOut;
  o.pos = u.viewProj * vec4f(v.p, 1.0);
  o.wp = v.p; o.n = v.n; o.rest = v.rest; o.mat = v.mat;
  return o;
}

// felt: matte wool with a fine fuzz, a soft sheen at grazing angles
fn feltShade(base: vec3f, N: vec3f, V: vec3f, L: vec3f, sh: f32, Q: vec3f) -> vec3f {
  let fz = vnoise(Q * 420.0) * 0.6 + vnoise(Q * 140.0) * 0.4;
  let alb = base * (0.86 + 0.26 * fz);
  let NdL = dot(N, L);
  let dif = clamp(NdL * 0.75 + 0.25, 0.0, 1.0);
  let NdV = clamp(dot(N, V), 0.0, 1.0);
  let sheen = pw(1.0 - NdV, 3.0) * 0.35;
  return alb * (ambientAt(N) * 0.62 + SUN * u.keyDir.w * dif * sh * 0.52) + alb * sheen * (0.4 + 0.6 * sh) + vec3f(0.01) * fz;
}

@fragment fn fsProps(i: VOut, @builtin(front_facing) ff: bool) -> @location(0) vec4f {
  var N = normalize(i.n);
  if (!ff) { N = -N; }
  let V = normalize(u.camPos.xyz - i.wp);
  let L = u.keyDir.xyz;
  let NdV = max(dot(N, V), 1e-3);
  let sh = keyShadow(i.wp + N * 0.01, 0.0015);
  var col: vec3f;
  if (i.mat < 1.5) {
    // a googly eye: a clear glossy dome over a pale disc, and a loose black bead that rolls about inside it
    let side = select(-1.0, 1.0, i.rest.x > 0.0);
    let eax = normalize(vec3f(EAX.x * side, EAX.y, EAX.z));
    let ec = vec3f(ECTR.x * side, ECTR.y, ECTR.z);
    let t1 = normalize(cross(eax, vec3f(0.0, 1.0, 0.0)));
    let t2 = cross(eax, t1);
    let dl = normalize(i.rest - ec);
    let q = vec2f(dot(dl, t1), dot(dl, t2));
    let o = select(u.extra.xy, u.extra.zw, side > 0.0);
    let RP = 0.43;
    let pd = (q - o) / RP;
    let pr = length(pd);
    let pang = atan2(pd.y, pd.x);
    let bead = 1.0 - sstep(0.94, 1.0, pr);
    // dizzy: the bead turns into a spiral
    let arms = fract(pang / (2.0 * PI) * 2.0 + pr * 2.2 - u.quirk.y);
    let swirl = sstep(0.40, 0.46, arms) * (1.0 - sstep(0.90, 0.96, arms));
    let spiral = mix(vec3f(0.012), vec3f(0.92, 0.9, 0.82), swirl * (1.0 - sstep(0.82, 0.92, pr)));
    let beadCol = mix(vec3f(0.012, 0.011, 0.010), spiral, u.quirk.x);
    let qlen = length(q);
    var disc = vec3f(0.96, 0.945, 0.9) * (1.0 - 0.22 * sstep(0.45, 0.92, qlen));
    // the bead's shadow on the disc
    disc *= 1.0 - 0.35 * (1.0 - sstep(0.96, 1.25, pr)) * (1.0 - bead);
    var base = mix(disc, beadCol, bead);
    base = mix(base, vec3f(0.03, 0.026, 0.024), sstep(0.86, 0.95, qlen));   // the dome's dark rim
    let R = reflect(-V, N);
    let F = 0.04 + 0.96 * pw(1.0 - NdV, 5.0);
    let env = studioEnv(R, 0.02, u.bg.rgb);
    col = base * (ambientAt(N) * 0.5 + SUN * u.keyDir.w * max(dot(N, L), 0.0) * sh * 0.4);
    col += env * mix(0.06, 1.0, F) * 0.9;
    col += SUN * min(ggx(N, V, L, 0.05) * 0.5, 12.0) * u.keyDir.w * sh;
  } else if (i.mat > 6.5) {
    // felt: the white patch behind each glossy eye
    col = feltShade(u.felt.rgb, N, V, L, sh, i.rest);
  } else if (i.mat > 5.5) {
    // the finger: warm skin with light through its edges, faint creases at the knuckles, a glossy nail
    let q = i.rest;                      // finger-local: x across, y up from the tip, z toward the nail
    let nailD = length(vec2f(q.x / 0.068, (q.y - 0.13) / 0.12));
    let nail = (1.0 - sstep(0.9, 1.0, nailD)) * sstep(0.02, 0.06, q.z);
    let crease = (1.0 - sstep(0.0, 0.012, abs(q.y - 0.42))) + (1.0 - sstep(0.0, 0.012, abs(q.y - 0.86)));
    var alb = u.skin.rgb * (1.0 - 0.18 * crease * sstep(0.0, 0.05, q.z));
    alb = mix(alb, u.skin.rgb * vec3f(1.12, 1.0, 0.98) + vec3f(0.06, 0.05, 0.05), nail);
    let NdL = dot(N, L);
    let dif = clamp(NdL * 0.7 + 0.3, 0.0, 1.0);
    let sss = vec3f(0.9, 0.35, 0.25) * pw(1.0 - NdV, 2.0) * 0.25;
    col = alb * (ambientAt(N) * 0.62 + SUN * u.keyDir.w * dif * sh * 0.55) + alb * sss;
    let rough = mix(0.45, 0.12, nail);
    col += SUN * u.keyDir.w * sh * ggx(N, V, L, rough) * mix(0.05, 0.35, nail);
    col += studioEnv(reflect(-V, N), rough, u.bg.rgb) * (0.03 + 0.97 * pw(1.0 - NdV, 5.0)) * mix(0.15, 0.5, nail);
  } else {
    // embroidery thread: twisted cotton, a faint lustre along the twist
    let tw = 0.5 + 0.5 * sin(i.rest.x * 520.0 + i.rest.y * 210.0);
    let alb = u.furRoot.rgb * 0.16 + vec3f(0.012, 0.010, 0.009);
    let dif = clamp(dot(N, L) * 0.7 + 0.3, 0.0, 1.0);
    col = alb * (ambientAt(N) * 0.6 + SUN * u.keyDir.w * dif * sh * 0.5) * (0.85 + 0.3 * tw);
    col += SUN * ggx(N, V, L, 0.35) * 0.05 * tw * sh * u.keyDir.w;
  }
  return vec4f(col, 1.0);
}

// ── the fur ──
// base layer: the backing fabric and the dense roots — the dark that shows between strands
struct FIn { @location(0) p: vec3f, @location(1) n: vec3f, @location(2) rest: vec3f, @location(3) mat: f32, @location(4) lean: vec4f, @location(5) arm: vec4f };
struct FOut {
  @builtin(position) pos: vec4f,
  @location(0) wp: vec3f,
  @location(1) n: vec3f,
  @location(2) rest: vec3f,
  @location(3) tg: vec3f,
  @location(4) hs: vec2f,      // shell height (0..1), soft shadow at this vertex
  @location(5) reg: vec4f,     // regions (fur length here, underside, cheek, thread)
  @location(6) reg2: vec4f,    // top of the shell (spots), pale band, claw tip, 1 on a limb
};
@vertex fn vsBase(v: FIn) -> FOut {
  var o: FOut;
  o.pos = u.viewProj * vec4f(v.p, 1.0);
  o.wp = v.p; o.n = v.n; o.rest = v.rest; o.tg = v.lean.xyz;
  o.hs = vec2f(0.0, keyShadowSoft(v.p + v.n * 0.02, 0.002));
  let R = regions(v.rest, v.arm);
  o.reg = vec4f(R.len, R.under, R.cheek, R.thread);
  o.reg2 = vec4f(R.top, R.band, R.tip, R.limb);
  return o;
}

fn furAlbedo(R: vec4f, R2: vec4f, spot: f32, h: f32, id: f32) -> vec3f {
  // R: len, underside, cheek, thread; R2: top, band, claw tip, limb
  var root = u.furRoot.rgb;
  var tip = u.furTip.rgb;
  root = mix(root, u.spot.rgb * 0.86, spot); tip = mix(tip, u.spot.rgb, spot);
  root = mix(root, u.under.rgb * 0.84, R.y); tip = mix(tip, u.under.rgb, R.y);
  root = mix(root, u.cheek.rgb * 0.8, R.z); tip = mix(tip, u.cheek.rgb, R.z);
  root = mix(root, u.band.rgb * 0.86, R2.y); tip = mix(tip, u.band.rgb, R2.y);
  root = mix(root, u.clawc.rgb * 0.84, R2.z); tip = mix(tip, u.clawc.rgb, R2.z);
  var c = mix(mix(root, tip, 0.45), tip, sstep(0.0, 1.0, h));
  c *= 0.86 + 0.28 * id;
  return c;
}

@fragment fn fsBase(i: FOut) -> @location(0) vec4f {
  let N = normalize(i.n);
  let V = normalize(u.camPos.xyz - i.wp);
  let L = u.keyDir.xyz;
  let R = i.reg;
  var spot = 0.0; var thr = 0.0;
  if (i.reg2.x > 0.02) { spot = spotAt(i.rest) * i.reg2.x; }
  if (R.w > 0.02) { thr = stitch(i.rest) * R.w; }
  var alb = furAlbedo(R, i.reg2, spot, 0.0, 0.5) * 0.72;
  alb = mix(alb, u.furRoot.rgb * 0.14, thr);   // stitches
  let dif = clamp(dot(N, L) * 0.6 + 0.4, 0.0, 1.0);
  let lowAO = mix(0.55, 1.0, sstep(0.0, 0.35, i.wp.y - u.misc.z));
  let col = alb * (ambientAt(N) * 0.55 + SUN * u.keyDir.w * dif * i.hs.y * 0.5) * lowAO;
  return vec4f(col, 1.0);
}

// shells: the body drawn again and again, each layer a little further out along the (bent) strands
@vertex fn vsShell(v: FIn, @builtin(instance_index) inst: u32) -> FOut {
  let NS = u.furTip.w;
  let h = 1.0 - f32(inst) / NS;               // outermost first
  let len = u.furRoot.w * (1.0 - v.lean.w);   // lean.w: how much shorter the pile is here (the tentacles)
  let lean = v.lean.xyz;
  // the strand rises along the normal and bends over toward its lie; pile that is laid down
  // stands lower, so a brushed path sinks a little into the coat
  let lie = 1.0 / sqrt(1.0 + 0.45 * dot(lean, lean));
  let P = v.p + (v.n * (h * lie) + lean * h * h) * len;
  var o: FOut;
  o.pos = u.viewProj * vec4f(P, 1.0);
  o.wp = P; o.n = v.n;
  // the strands wander a little as they rise (per vertex: the wave is far broader than a vertex)
  let wave = vec3f(vnoise(v.rest * 14.0), vnoise(v.rest * 14.0 + 11.3), vnoise(v.rest * 14.0 + 27.1)) - 0.5;
  o.rest = v.rest + wave * (0.045 * h);
  let R = regions(v.rest, v.arm);
  o.reg = vec4f(R.len, R.under, R.cheek, R.thread);
  o.reg2 = vec4f(R.top, R.band, R.tip, R.limb);
  o.tg = normalize(v.n + lean * (2.0 * h) + vec3f(1e-5));
  o.hs = vec2f(h, keyShadowSoft(P + v.n * 0.015, 0.0025));
  return o;
}

struct Strand { cov: f32, id: f32, a: vec3f };
// strands are points scattered through rest space, one per little cube; a strand is the cross-section
// of a thin cone around its point, so its thickness and length vary with how close the skin passes
fn strands(Q: vec3f, h: f32, lenHere: f32) -> Strand {
  let s = u.misc.w;
  let g = Q / s;
  let i0 = floor(g);
  let f = g - i0;
  let o = select(vec3f(-1.0), vec3f(1.0), f >= vec3f(0.5));
  var best = 0.0; var bid = 0.0; var anc = Q;
  for (var k = 0; k < 8; k++) {
    let c = i0 + vec3f(f32(k & 1), f32((k >> 1) & 1), f32((k >> 2) & 1)) * o;
    let r = hash33(c);
    let Ls = (0.62 + 0.38 * fract(r.x * 7.13 + r.z * 3.1)) * lenHere;
    if (h > Ls) { continue; }
    let rad = 0.5 * pw(1.0 - h / Ls, 0.42);
    // each strand leans its own way as it rises, and is crimped like a fleece fibre
    let r2 = fract(r.zxy * 5.31 + r.yzx * 2.17) - 0.5;
    let r3 = fract(r.yzx * 3.73 + r.zxy * 1.91) - 0.5;
    let crimp = sin(h * (9.0 + 6.0 * r.x) + r.y * 6.28);
    let tilt = r2 * (1.5 * h) + r3 * (0.55 * crimp * h);
    let d = length(g - (c + r + tilt));
    let cov = 1.0 - sstep(rad * 0.25, rad, d);
    if (cov > best) { best = cov; bid = fract(r.y * 13.7 + r.x * 3.3); anc = (c + r) * s; }
  }
  var st: Strand; st.cov = best; st.id = bid; st.a = anc;
  return st;
}

@fragment fn fsShell(i: FOut) -> @location(0) vec4f {
  let h = i.hs.x;
  let R = i.reg;
  let st = strands(i.rest, h, R.x);
  if (st.cov < 0.02) { discard; }
  let N = normalize(i.n);
  let T = normalize(i.tg);
  let V = normalize(u.camPos.xyz - i.wp);
  let L = u.keyDir.xyz;
  // the pale spots and the stitches are decided per strand, at the point it grows from
  var spot = 0.0; var thr = 0.0;
  if (i.reg2.x > 0.02) { spot = spotAt(st.a) * i.reg2.x; }
  if (R.w > 0.02) { thr = stitch(st.a) * R.w; }
  var alb = furAlbedo(R, i.reg2, spot, h, st.id);
  alb = mix(alb, u.furRoot.rgb * 0.16, thr);
  // light: wrapped diffuse on the fur volume, darker toward the roots, a little lift where the
  // pile is seen along its lie (velvet), Kajiya–Kay highlights along the strands
  let NdL = dot(N, L);
  let dif = clamp((NdL + 0.3) / 1.3, 0.0, 1.0);
  let low = mix(0.62, 1.0, sstep(0.0, 0.3, i.wp.y - u.misc.z));
  let ao = mix(0.56, 1.0, pw(h, 0.7)) * low;
  let sh = i.hs.y;
  let tl = T - N * dot(T, N);
  let vt = V - N * dot(V, N);
  // velvet: pile seen against its lie shows the dense ends (darker), seen with it shows the sides (sheen)
  let velvet = 1.0 - 0.38 * clamp(dot(tl, vt) * 1.8, -1.0, 1.0);
  let H = normalize(L + V);
  let TdH = dot(T, H);
  let kk1 = pw(sqrt(max(1.0 - TdH * TdH, 0.0)), 70.0);
  let T2 = normalize(T + N * 0.3);
  let TdH2 = dot(T2, H);
  let kk2 = pw(sqrt(max(1.0 - TdH2 * TdH2, 0.0)), 18.0);
  var col = alb * (ambientAt(N) * 0.6 * ao + SUN * u.keyDir.w * dif * sh * 0.66 * ao) * velvet;
  // the underside and the limbs (in the body's shade) catch light bounced off the table
  // the underside and the legs (in the body's shade) catch light bounced off the table
  col += alb * u.bg.rgb * (0.12 * R.y + 0.2 * i.reg2.w) * ao;
  let flat = clamp(length(tl) * 1.2, 0.0, 1.0);
  col += SUN * u.keyDir.w * sh * (kk1 * (0.05 + 0.08 * flat) + kk2 * (0.1 + 0.12 * flat) * alb) * ao;
  // light caught in the outermost wisps: a soft halo along the silhouette, brightest against the key
  let NdV = clamp(dot(N, V), 0.0, 1.0);
  let rim = pw(1.0 - NdV, 2.6) * h * h * low;
  col += (alb * 0.8 + vec3f(0.02)) * rim * (0.2 + 0.8 * sh * clamp(dot(-V, L) * 0.5 + 0.5, 0.0, 1.0)) * u.keyDir.w * 0.4;
  // edge-on shells would show their layering: thin them where the view grazes
  let a = st.cov * mix(0.55, 1.0, sstep(0.05, 0.4, NdV)) * mix(1.0, 0.6, h * h);
  return vec4f(col, a);
}

// ── mesh overlay ──
struct LOut { @builtin(position) pos: vec4f, @location(0) d: f32 };
@vertex fn vsLine(@location(0) p: vec3f) -> LOut {
  var o: LOut; o.pos = u.viewProj * vec4f(p, 1.0); o.d = linearDepth(p); return o;
}
@fragment fn fsLine(i: LOut) -> @location(0) vec4f {
  let a = u.misc.y * mix(0.9, 0.35, clamp((i.d - 5.0) * 0.5, 0.0, 1.0));
  return vec4f(vec3f(0.04, 0.05, 0.06) * a, a);
}
`;

// ── post: exposure, Khronos PBR Neutral tone mapping, sRGB, dither ──
const WGSL_POST = WGSL_COMMON + /* wgsl */`
@group(0) @binding(0) var<uniform> u: U;
@group(0) @binding(1) var hdr: texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u)) * 2.0 - 1.0;
  return vec4f(p, 0.0, 1.0);
}
fn neutral(c0: vec3f) -> vec3f {
  let startC = 0.8 - 0.04;
  let desat = 0.15;
  let x = min(c0.r, min(c0.g, c0.b));
  let off = select(0.04, x - 6.25 * x * x, x < 0.08);
  var c = c0 - off;
  let peak = max(c.r, max(c.g, c.b));
  if (peak < startC) { return c; }
  let d = 1.0 - startC;
  let np = 1.0 - d * d / (peak + d - startC);
  c *= np / peak;
  let g = 1.0 - 1.0 / (desat * (peak - np) + 1.0);
  return mix(c, vec3f(np), g);
}
fn oetf(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let hdrC = textureLoad(hdr, vec2i(fc.xy), 0);
  var c = hdrC.rgb * u.misc.x;
  let cover = clamp(hdrC.a, 0.0, 1.0);
  c = clamp(c, vec3f(0.0), vec3f(64.0));
  c = neutral(max(c, vec3f(0.0)));
  var s = oetf(clamp(c, vec3f(0.0), vec3f(1.0)));
  s += (hash3(vec3f(fc.xy, 1.0)) - 0.5) / 255.0;
  // ── sprite bake: hand back the crab's own coverage, so the sheet has real alpha ──
  if (u.page.x > 1.5) { return vec4f(s * cover, cover); }
  // ── desktop-pet card: dissolve the studio sweep out toward the edges ──
  if (u.page.x > 0.5) {
    let q = clamp(fc.xy / vec2f(u.screen.xy) * 2.0 - vec2f(1.0), vec2f(-1.0), vec2f(1.0));
    let e = 1.0 - pw(sstep(0.55, 1.0, abs(q.x)), 1.6) * sstep(0.55, 1.0, abs(q.y));
    return vec4f(s * e, e);
  }
  return vec4f(s, 1.0);
}
`;

// ===== renderer.js =====
// ─────────────────────────────────────────────────────────────
//  WebGPU renderer
//  passes: key-light shadow map · top-down height map (contact AO)
//          · main (MSAA): floor, sewn-on parts, fur base, fur shells
//            (instanced, alpha-to-coverage), mesh overlay · tone map
// ─────────────────────────────────────────────────────────────

// ── tiny mat4 helpers (column-major, WebGPU clip z ∈ [0,1]) ──
const M4 = {
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = f / aspect; o[5] = f; o[10] = far / (near - far); o[11] = -1; o[14] = near * far / (near - far);
    return o;
  },
  ortho(l, r, b, t, n, f) {
    const o = new Float32Array(16);
    o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = 1 / (n - f);
    o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = n / (n - f); o[15] = 1;
    return o;
  },
  lookAt(eye, at, up) {
    let zx = eye[0] - at[0], zy = eye[1] - at[1], zz = eye[2] - at[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = up[1] * zz - up[2] * zy, xy = up[2] * zx - up[0] * zz, xz = up[0] * zy - up[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0,
      -(xx * eye[0] + xy * eye[1] + xz * eye[2]), -(yx * eye[0] + yy * eye[1] + yz * eye[2]), -(zx * eye[0] + zy * eye[1] + zz * eye[2]), 1]);
  },
  invert(m) {
    const inv = new Float32Array(16);
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = m;
    const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10, b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12, b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30, b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
    const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    inv[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det; inv[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
    inv[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det; inv[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
    inv[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det; inv[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
    inv[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det; inv[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
    inv[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det; inv[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
    inv[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det; inv[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
    inv[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det; inv[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
    inv[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det; inv[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
    return inv;
  },
};

const MSAA = 4;
const UBO_SIZE = 720;

class Renderer {
  static async create(canvas, mesh, simEdges, nParticles) {
    if (!navigator.gpu) throw new Error('no-webgpu');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('no-adapter');
    const device = await adapter.requestDevice();
    const r = new Renderer(canvas, device, mesh, simEdges, nParticles);
    r.adapter = adapter; Renderer.keep = { adapter, gpu: navigator.gpu };
    await r.checkShaders();
    return r;
  }

  constructor(canvas, device, mesh, simEdges, nParticles) {
    this.canvas = canvas;
    this.device = device;
    this.ctx = canvas.getContext('webgpu');
    this.format = navigator.gpu.getPreferredCanvasFormat();
    // premultiplied so the sprite bake carries real alpha; the full study still paints an
    // opaque sweep, so nothing changes there
    this.ctx.configure({ device, format: this.format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    this.lost = false;
    device.lost.then(info => { this.lost = true; this.onLost && this.onLost(info); });
    device.addEventListener && device.addEventListener('uncapturederror', e => { this.onError && this.onError(e.error); });
    this.setMesh(mesh, simEdges, nParticles);
    this.ubo = device.createBuffer({ size: UBO_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.uboData = new Float32Array(UBO_SIZE / 4);
    this.lightUbo = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.topUbo = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.cmpSampler = device.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' });
    this.shadowSize = 2048; this.topSize = 1024;
    this.shadowTex = device.createTexture({ size: [this.shadowSize, this.shadowSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.topTex = device.createTexture({ size: [this.topSize, this.topSize], format: 'depth32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.buildPipelines();
    this.w = 0; this.h = 0;
    this.shells = 40;
  }

  setMesh(mesh, simEdges, nParticles) {
    const device = this.device;
    for (const b of ['dynBuf', 'furBuf', 'staticBuf', 'indexBuf', 'lineIdx', 'particleBuf']) if (this[b]) this[b].destroy();
    this.mesh = mesh;
    this.nV = mesh.rest.length / 3;
    const buf = (data, usage) => {
      const b = device.createBuffer({ size: Math.max(4, Math.ceil(data.byteLength / 4) * 4), usage: usage | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(b, 0, data);
      return b;
    };
    // dynamic: skinned position + normal, and each vertex's fur lean (world space)
    this.dyn = new Float32Array(this.nV * 6);
    this.dynBuf = device.createBuffer({ size: this.dyn.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.fur = new Float32Array(this.nV * 4);
    this.furBuf = device.createBuffer({ size: this.fur.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    // static: rest position, material, and where on which arm (for the suckers and the underside)
    const st = new Float32Array(this.nV * 8);
    for (let i = 0; i < this.nV; i++) {
      st[8 * i] = mesh.rest[3 * i]; st[8 * i + 1] = mesh.rest[3 * i + 1]; st[8 * i + 2] = mesh.rest[3 * i + 2]; st[8 * i + 3] = mesh.mat[i];
      for (let k = 0; k < 4; k++) st[8 * i + 4 + k] = mesh.arm[4 * i + k];
    }
    this.staticBuf = buf(st, GPUBufferUsage.VERTEX);
    this.indexBuf = buf(mesh.index, GPUBufferUsage.INDEX);
    this.lineIdx = buf(simEdges, GPUBufferUsage.INDEX);
    this.lineCount = simEdges.length;
    this.particleBuf = device.createBuffer({ size: nParticles * 12, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
  }

  // the finger: a small rigid mesh posed on the CPU each frame
  setFinger(f) {
    const device = this.device;
    const nF = f.rest.length / 3;
    this.fingerDyn = new Float32Array(nF * 6);
    this.fingerDynBuf = device.createBuffer({ size: this.fingerDyn.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const st = new Float32Array(nF * 8);
    for (let i = 0; i < nF; i++) { st[8 * i] = f.rest[3 * i]; st[8 * i + 1] = f.rest[3 * i + 1]; st[8 * i + 2] = f.rest[3 * i + 2]; st[8 * i + 3] = 6; st[8 * i + 4] = -1; }
    const mk = (data, usage) => { const b = device.createBuffer({ size: Math.ceil(data.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
    this.fingerStatic = mk(st, GPUBufferUsage.VERTEX);
    this.fingerIdx = mk(f.index, GPUBufferUsage.INDEX);
    this.fingerCount = f.index.length;
    this.fingerVisible = false;
  }

  // the plush limbs: tubes posed on the CPU every frame, drawn with the body's own fur (base + shells)
  setLimbs(t) {
    const device = this.device;
    this.limbDyn = new Float32Array(t.nV * 6);
    this.limbFur = new Float32Array(t.nV * 4);
    this.limbDynBuf = device.createBuffer({ size: this.limbDyn.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    this.limbFurBuf = device.createBuffer({ size: this.limbFur.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
    const mk = (data, usage) => { const b = device.createBuffer({ size: Math.ceil(data.byteLength / 4) * 4, usage: usage | GPUBufferUsage.COPY_DST }); device.queue.writeBuffer(b, 0, data); return b; };
    this.limbStatic = mk(t.statics, GPUBufferUsage.VERTEX);
    this.limbIdx = mk(t.index, GPUBufferUsage.INDEX);
    this.limbCount = t.index.length;
  }
  uploadLimbs() {
    if (this.limbDynBuf) { this.device.queue.writeBuffer(this.limbDynBuf, 0, this.limbDyn); this.device.queue.writeBuffer(this.limbFurBuf, 0, this.limbFur); }
  }

  buildPipelines() {
    const d = this.device;
    const V = GPUShaderStage.VERTEX, F = GPUShaderStage.FRAGMENT;
    this.modules = {
      depth: d.createShaderModule({ label: 'depth', code: WGSL_DEPTH }),
      scene: d.createShaderModule({ label: 'scene', code: WGSL_SCENE }),
      post: d.createShaderModule({ label: 'post', code: WGSL_POST }),
    };
    this.layoutDepth = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V, buffer: { type: 'uniform' } }] });
    this.layoutScene = d.createBindGroupLayout({ entries: [
      { binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: V | F, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: V | F, texture: { sampleType: 'depth' } },
      { binding: 3, visibility: V | F, sampler: { type: 'comparison' } }] });
    this.layoutPost = d.createBindGroupLayout({ entries: [{ binding: 0, visibility: V | F, buffer: { type: 'uniform' } },
      { binding: 1, visibility: F, texture: { sampleType: 'unfilterable-float' } }] });
    const pl = l => d.createPipelineLayout({ bindGroupLayouts: [l] });

    const posOnly = { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] };
    const meshVB = [
      { arrayStride: 24, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'float32x3' }] },
      { arrayStride: 32, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }, { shaderLocation: 3, offset: 12, format: 'float32' }, { shaderLocation: 5, offset: 16, format: 'float32x4' }] },
    ];
    const furVB = [...meshVB, { arrayStride: 16, attributes: [{ shaderLocation: 4, offset: 0, format: 'float32x4' }] }];
    const HDR = 'rgba16float';
    const ms = { count: MSAA };
    const depthOpaque = { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' };

    this.pDepth = d.createRenderPipeline({
      label: 'depth', layout: pl(this.layoutDepth),
      vertex: { module: this.modules.depth, entryPoint: 'vs', buffers: [posOnly] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2 },
    });
    this.pBackground = d.createRenderPipeline({
      label: 'background', layout: pl(this.layoutScene),
      vertex: { module: this.modules.scene, entryPoint: 'vsFull' },
      fragment: { module: this.modules.scene, entryPoint: 'fsBackground', targets: [{ format: HDR }] },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: ms,
    });
    this.pProps = d.createRenderPipeline({
      label: 'props', layout: pl(this.layoutScene),
      vertex: { module: this.modules.scene, entryPoint: 'vsMesh', buffers: meshVB },
      fragment: { module: this.modules.scene, entryPoint: 'fsProps', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthOpaque, multisample: ms,
    });
    this.pBase = d.createRenderPipeline({
      label: 'fur base', layout: pl(this.layoutScene),
      vertex: { module: this.modules.scene, entryPoint: 'vsBase', buffers: furVB },
      fragment: { module: this.modules.scene, entryPoint: 'fsBase', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: depthOpaque, multisample: ms,
    });
    this.pShell = d.createRenderPipeline({
      label: 'fur shells', layout: pl(this.layoutScene),
      vertex: { module: this.modules.scene, entryPoint: 'vsShell', buffers: furVB },
      fragment: { module: this.modules.scene, entryPoint: 'fsShell', targets: [{ format: HDR }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: depthOpaque,
      multisample: { count: MSAA, alphaToCoverageEnabled: true },
    });
    this.pLines = d.createRenderPipeline({
      label: 'lines', layout: pl(this.layoutScene),
      vertex: { module: this.modules.scene, entryPoint: 'vsLine', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: {
        module: this.modules.scene, entryPoint: 'fsLine', targets: [{
          format: HDR,
          blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
        }],
      },
      primitive: { topology: 'line-list' },
      depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
      multisample: ms,
    });
    this.pPost = d.createRenderPipeline({
      label: 'post', layout: pl(this.layoutPost),
      vertex: { module: this.modules.post, entryPoint: 'vs' },
      fragment: { module: this.modules.post, entryPoint: 'fs', targets: [{ format: this.format }] },
    });

    this.bgLight = d.createBindGroup({ layout: this.layoutDepth, entries: [{ binding: 0, resource: { buffer: this.lightUbo } }] });
    this.bgTop = d.createBindGroup({ layout: this.layoutDepth, entries: [{ binding: 0, resource: { buffer: this.topUbo } }] });
    this.bgScene = d.createBindGroup({ layout: this.layoutScene, entries: [
      { binding: 0, resource: { buffer: this.ubo } },
      { binding: 1, resource: this.shadowTex.createView() },
      { binding: 2, resource: this.topTex.createView() },
      { binding: 3, resource: this.cmpSampler }] });
  }

  async checkShaders() {
    const problems = [];
    for (const [name, m] of Object.entries(this.modules)) {
      if (!m.getCompilationInfo) continue;
      const info = await m.getCompilationInfo();
      for (const msg of info.messages) if (msg.type === 'error') problems.push(`${name}:${msg.lineNum}:${msg.linePos} ${msg.message}`);
    }
    if (problems.length) throw new Error('WGSL compile error\n' + problems.join('\n'));
  }

  resize(w, h) {
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    if (w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w; this.canvas.height = h;
    const d = this.device;
    for (const t of ['msDepth', 'msHdr', 'hdrTex']) this[t] && this[t].destroy();
    const RA = GPUTextureUsage.RENDER_ATTACHMENT, TB = GPUTextureUsage.TEXTURE_BINDING;
    this.msDepth = d.createTexture({ size: [w, h], format: 'depth24plus', sampleCount: MSAA, usage: RA });
    this.msHdr = d.createTexture({ size: [w, h], format: 'rgba16float', sampleCount: MSAA, usage: RA });
    this.hdrTex = d.createTexture({ size: [w, h], format: 'rgba16float', usage: RA | TB });
    this.bgPost = d.createBindGroup({ layout: this.layoutPost, entries: [
      { binding: 0, resource: { buffer: this.ubo } },
      { binding: 1, resource: this.hdrTex.createView() }] });
  }

  // fill the uniform block; cam = { viewProj, view, invViewProj, pos, fwd }
  setUniforms(cam, light, palette, params) {
    const u = this.uboData;
    u.set(cam.viewProj, 0); u.set(cam.view, 16); u.set(cam.invViewProj, 32);
    u.set(light.lightVP, 48); u.set(light.topVP, 64);
    u.set([...cam.pos, params.time], 80);
    u.set([...cam.fwd, 0], 84);
    u.set([...light.dir, light.intensity], 88);
    u.set([this.w, this.h, 1 / this.w, 1 / this.h], 92);
    u.set([...palette.furRoot, params.furLen], 96);
    u.set([...palette.furTip, this.shells], 100);
    u.set([...palette.under, 1], 104);
    u.set([...(params.cheek || palette.cheek), 1], 108);
    u.set([...palette.felt, 1], 112);
    u.set([...params.skin, this.fingerVisible ? 1 : 0], 116);
    u.set(params.finger, 120);
    u.set([params.exposure, params.meshAlpha, params.floorY || 0, params.strand], 124);
    u.set([...params.bg, 1], 128);
    u.set([...palette.shadowTint, 1], 132);
    u.set([...palette.iris, 1], 136);
    u.set(params.smile, 140);
    u.set(params.maps, 144);
    u.set([...palette.spot, 1], 148); u.set([...palette.band, 1], 152); u.set([...palette.clawc, 1], 156);
    u.set(params.eyes || [0, 0, 0, 0], 160); u.set(params.quirk || [0, 0, 0, 0], 164);
    u.set(params.page || [0, 0, 0, 0], 168);
    this.device.queue.writeBuffer(this.ubo, 0, u);
    this.device.queue.writeBuffer(this.lightUbo, 0, light.lightVP);
    this.device.queue.writeBuffer(this.topUbo, 0, light.topVP);
  }

  uploadGeometry(particles, showMesh, moved) {
    if (moved) this.device.queue.writeBuffer(this.dynBuf, 0, this.dyn);
    if (this.fingerVisible) this.device.queue.writeBuffer(this.fingerDynBuf, 0, this.fingerDyn);
    this.device.queue.writeBuffer(this.furBuf, 0, this.fur);
    if (showMesh) this.device.queue.writeBuffer(this.particleBuf, 0, particles);
  }

  capture() { return new Promise(r => { this.captureResolve = r; }); }

  draw(showMesh) {
    if (this.lost) return;
    const d = this.device, m = this.mesh;
    const enc = d.createCommandEncoder();
    const all = m.body.count + m.props.count;
    // key-light shadow map and a top-down height map for contact occlusion
    {
      const p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.shadowTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setPipeline(this.pDepth); p.setBindGroup(0, this.bgLight);
      p.setVertexBuffer(0, this.dynBuf); p.setIndexBuffer(this.indexBuf, 'uint32');
      p.drawIndexed(all, 1, 0, 0, 0);
      if (this.fingerVisible) { p.setVertexBuffer(0, this.fingerDynBuf); p.setIndexBuffer(this.fingerIdx, 'uint32'); p.drawIndexed(this.fingerCount, 1, 0, 0, 0); }
      if (this.limbDynBuf) { p.setVertexBuffer(0, this.limbDynBuf); p.setIndexBuffer(this.limbIdx, 'uint32'); p.drawIndexed(this.limbCount, 1, 0, 0, 0); }
      p.end();
    }
    {
      const p = enc.beginRenderPass({ colorAttachments: [], depthStencilAttachment: { view: this.topTex.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' } });
      p.setPipeline(this.pDepth); p.setBindGroup(0, this.bgTop);
      p.setVertexBuffer(0, this.dynBuf); p.setIndexBuffer(this.indexBuf, 'uint32');
      p.drawIndexed(m.body.count, 1, 0, 0, 0);
      p.end();
    }
    // the studio, the sewn-on parts, then the fur from the backing outward
    {
      const p = enc.beginRenderPass({
        colorAttachments: [{ view: this.msHdr.createView(), resolveTarget: this.hdrTex.createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'discard' }],
        depthStencilAttachment: { view: this.msDepth.createView(), depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'discard' },
      });
      p.setBindGroup(0, this.bgScene);
      p.setPipeline(this.pBackground); p.draw(3);
      p.setVertexBuffer(0, this.dynBuf); p.setVertexBuffer(1, this.staticBuf); p.setVertexBuffer(2, this.furBuf); p.setIndexBuffer(this.indexBuf, 'uint32');
      p.setPipeline(this.pProps);
      p.drawIndexed(m.props.count, 1, m.props.first, 0, 0);
      p.setPipeline(this.pBase);
      p.drawIndexed(m.body.count, 1, 0, 0, 0);
      const limbs = !!this.limbDynBuf;
      const useLimbs = () => { p.setVertexBuffer(0, this.limbDynBuf); p.setVertexBuffer(1, this.limbStatic); p.setVertexBuffer(2, this.limbFurBuf); p.setIndexBuffer(this.limbIdx, 'uint32'); };
      const useBody = () => { p.setVertexBuffer(0, this.dynBuf); p.setVertexBuffer(1, this.staticBuf); p.setVertexBuffer(2, this.furBuf); p.setIndexBuffer(this.indexBuf, 'uint32'); };
      if (limbs) { useLimbs(); p.drawIndexed(this.limbCount, 1, 0, 0, 0); useBody(); }
      if (this.fingerVisible) {
        p.setPipeline(this.pProps);
        p.setVertexBuffer(0, this.fingerDynBuf); p.setVertexBuffer(1, this.fingerStatic); p.setIndexBuffer(this.fingerIdx, 'uint32');
        p.drawIndexed(this.fingerCount, 1, 0, 0, 0);
        p.setVertexBuffer(0, this.dynBuf); p.setVertexBuffer(1, this.staticBuf); p.setIndexBuffer(this.indexBuf, 'uint32');
      }
      p.setPipeline(this.pShell);
      p.drawIndexed(m.body.count, this.shells, 0, 0, 0);
      if (limbs) { useLimbs(); p.drawIndexed(this.limbCount, this.shells, 0, 0, 0); useBody(); }
      if (showMesh) {
        p.setPipeline(this.pLines);
        p.setVertexBuffer(0, this.particleBuf); p.setIndexBuffer(this.lineIdx, 'uint32');
        p.drawIndexed(this.lineCount, 1, 0, 0, 0);
      }
      p.end();
    }
    const out = this.ctx.getCurrentTexture();
    {
      const p = enc.beginRenderPass({ colorAttachments: [{ view: out.createView(), clearValue: [1, 1, 1, 1], loadOp: 'clear', storeOp: 'store' }] });
      p.setPipeline(this.pPost); p.setBindGroup(0, this.bgPost); p.draw(3);
      p.end();
    }
    let cap = null;
    if (this.captureResolve) {
      const bpr = Math.ceil(this.w * 4 / 256) * 256;
      const buf = d.createBuffer({ size: bpr * this.h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: out }, { buffer: buf, bytesPerRow: bpr }, [this.w, this.h]);
      cap = { buf, bpr, w: this.w, h: this.h, resolve: this.captureResolve, bgra: this.format.startsWith('bgra') };
      this.captureResolve = null;
    }
    d.queue.submit([enc.finish()]);
    if (cap) cap.buf.mapAsync(GPUMapMode.READ).then(() => {
      const src = new Uint8Array(cap.buf.getMappedRange());
      const px = new Uint8ClampedArray(cap.w * cap.h * 4);
      for (let y = 0; y < cap.h; y++) for (let x = 0; x < cap.w; x++) {
        const s = y * cap.bpr + x * 4, o = (y * cap.w + x) * 4;
        px[o] = src[s + (cap.bgra ? 2 : 0)]; px[o + 1] = src[s + 1]; px[o + 2] = src[s + (cap.bgra ? 0 : 2)]; px[o + 3] = src[s + 3];
      }
      cap.buf.unmap(); cap.buf.destroy();
      cap.resolve({ w: cap.w, h: cap.h, px });
    });
  }
}

// ===== main.js =====
// ─────────────────────────────────────────────────────────────
//  App: sim ↔ render glue, the limbs' poses and gait, scuttling
//  sideways, snipping, hiding, waving, reaching for a finger, the
//  fur's lie and sway, camera, picking, hand, finger, comb, UI
// ─────────────────────────────────────────────────────────────

const srgbToLin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linToSrgb = c => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
const hex = rgb => '#' + rgb.map(c => Math.round(Math.min(1, Math.max(0, linToSrgb(c))) * 255).toString(16).padStart(2, '0')).join('');
const lin = h => [1, 3, 5].map(i => srgbToLin(parseInt(h.slice(i, i + 2), 16) / 255));


// three dyed lots of the same pattern (linear RGB, from sRGB hex)
// furRoot/furTip: the minky; under: the paler underside; spot: the pale spots; band: the joint bands and toes;
// clawc: the claw tips; felt: the white patches behind the eyes.
// Dyed to sit beside the blog's "Akari Glass" greens rather than the studio's coral.
const PALETTES = {
  moss: {
    name: '青苔',
    furRoot: lin('#4a6741'), furTip: lin('#9dbf8a'), under: lin('#e9f1e0'), spot: lin('#f2f7ea'), band: lin('#e4eeda'), clawc: lin('#2f4529'),
    cheek: lin('#f0a0a4'), felt: lin('#fdfbf4'), iris: lin('#3a2a12'), shadowTint: [0.6, 0.62, 0.56],
  },
  clay: {
    name: '陶土',
    furRoot: lin('#a8763a'), furTip: lin('#e6bd76'), under: lin('#fff0d4'), spot: lin('#fff7e8'), band: lin('#fff1d8'), clawc: lin('#5e3d22'),
    cheek: lin('#ffa0a8'), felt: lin('#fdfbf4'), iris: lin('#4a2a10'), shadowTint: [0.62, 0.57, 0.5],
  },
  celadon: {
    name: '青瓷',
    furRoot: lin('#2f6f6b'), furTip: lin('#8fd0c4'), under: lin('#d8f0ea'), spot: lin('#e8f7f2'), band: lin('#dcefe9'), clawc: lin('#1f4a46'),
    cheek: lin('#f0a8b4'), felt: lin('#fdfbf4'), iris: lin('#33280f'), shadowTint: [0.56, 0.62, 0.6],
  },
};

const SKIN = lin('#e9b9a0');
const BLUSH = lin('#ff3d63');

let BG_FIELD = [0, 0, 0, 0];   // the post pass's page colour; pet mode turns it on
// the studio sweep follows the host page, so the toy sits in the blog rather than in a grey box
const PAGE_BG = { light: [0.953, 0.961, 0.937], dark: [0.063, 0.086, 0.051] }; // --bg, light and dark
const pageBgSrgb = () => {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--pet-bg').trim();
  const m = v.match(/^#?([0-9a-f]{6})$/i);
  return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16) / 255) : (document.documentElement.dataset.theme === 'dark' ? PAGE_BG.dark : PAGE_BG.light);
};
let BG_SRGB = PAGE_BG.light.slice();
const BG_RENDER = [0, 0, 0];
let BG_LIN = BG_SRGB.map(srgbToLin);
const pageField = () => {
  BG_SRGB = pageBgSrgb();
  BG_LIN = BG_SRGB.map(srgbToLin);
  for (let i = 0; i < 3; i++) BG_RENDER[i] = BG_LIN[i] + 0.04;
  // the post pass mixes toward the SRGB-encoded page colour, matching what oetf() has just written
  return [1, ...BG_SRGB, 0];
};
window.__crabSetTheme = (hex, dark) => {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.setProperty('--pet-bg', hex || '');
  BG_FIELD = pageField();
};
window.__crabSetTheme('', false);

const SCALE_CM = 10;       // illustrative: 1 simulation unit ≈ 10 cm (the crab is ~17 cm across its shell, ~30 cm with its legs out)
const DENSITY = 0.03;      // g/cm³, polyester fibrefill in a minky shell
const STRAND = 0.0078;     // strand spacing in rest space (sim units)

const $ = s => document.querySelector(s);

function setStatus(text, state) {
  const el = $('#status');
  $('#statusText').textContent = text;
  el.dataset.state = state;
}
function showFallback(title, detail) {
  const f = $('#fallback');
  f.hidden = false;
  $('#fallbackTitle').textContent = title;
  $('#fallbackDetail').textContent = detail;
  document.body.classList.add('no-gpu');
  setStatus('毛绒蟹 · 不可用', 'off');
  for (const el of document.querySelectorAll('.panel button, .panel input')) el.disabled = true;
}

// per-tet inverse rest matrices (for deformation gradients)
function restInverses(rest, tets) {
  const nT = tets.length / 4, out = new Float32Array(nT * 9);
  for (let t = 0; t < nT; t++) {
    const a = tets[4 * t], m = [];
    for (let r = 0; r < 3; r++) for (let c = 1; c < 4; c++) m.push(rest[3 * tets[4 * t + c] + r] - rest[3 * a + r]);
    const [A, B, C, D, E, F, G, H, I] = m;
    const k0 = E * I - F * H, k1 = -(D * I - F * G), k2 = D * H - E * G, det = A * k0 + B * k1 + C * k2, id = 1 / det;
    out.set([k0 * id, -(B * I - C * H) * id, (B * F - C * E) * id, k1 * id, (A * I - C * G) * id, -(A * F - C * D) * id, k2 * id, -(A * H - B * G) * id, (A * E - B * D) * id], 9 * t);
  }
  return out;
}

// the finger: a capsule from its tip (at the origin) straight up, a little flattened across, the
// nail side facing +z; rest coordinates are kept finger-local for the shader
function fingerMesh() {
  const pos = [], nrm = [], idx = [];
  const R = 0.1, LEN = 4.5, NP = 26, NT = 9, NY = 30;
  // a fingertip, the knuckle, a fuller base, then the back of the hand spreading out of view
  const rad = y => R * (0.92 + 0.08 * Math.min(1, y / 0.7) + 0.05 * Math.exp(-(((y - 0.55) / 0.12) ** 2)) + 0.1 * Math.min(1, Math.max(0, (y - 0.8) / 0.6))
    + 0.08 * Math.exp(-(((y - 1.25) / 0.14) ** 2)) + 1.6 * Math.max(0, (y - 1.9) / 2.6) ** 1.5);
  const ring = (y, r, ny) => {
    for (let j = 0; j < NP; j++) {
      const a = 2 * Math.PI * j / NP, cx = Math.sin(a), cz = Math.cos(a);
      pos.push(cx * r, y, cz * r * 0.88);
      const n = [cx * Math.sqrt(1 - ny * ny), ny, cz * Math.sqrt(1 - ny * ny) / 0.88];
      const l = Math.hypot(...n); nrm.push(n[0] / l, n[1] / l, n[2] / l);
    }
  };
  // the rounded tip, then the shaft
  for (let i = 0; i <= NT; i++) { const t = (Math.PI / 2) * i / NT; ring(R - Math.cos(t) * R, Math.sin(t) * R * 0.98 + 1e-3, -Math.cos(t)); }
  for (let i = 1; i <= NY; i++) { const y = R + (LEN - R) * i / NY; ring(y, rad(y), 0); }
  const rows = pos.length / 3 / NP;
  for (let i = 0; i < rows - 1; i++) for (let j = 0; j < NP; j++) {
    const a = i * NP + j, b = i * NP + (j + 1) % NP, c = a + NP, d = b + NP;
    idx.push(a, b, c, b, d, c);
  }
  // close the very tip
  const tipI = pos.length / 3; pos.push(0, 0, 0); nrm.push(0, -1, 0);
  for (let j = 0; j < NP; j++) idx.push(tipI, (j + 1) % NP, j);
  return { rest: new Float32Array(pos), nrm: new Float32Array(nrm), index: new Uint32Array(idx) };
}

async function main() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const canvas = $('#gl');
  setStatus('毛绒蟹 · 填充中', 'idle');
  await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

  // ── desktop-pet chrome ──
  // The page's own <html>/<body> classes decide which of the two layouts this is:
  // 'pet' is the little card that lives in the blog, anything else is the full study.
  const petMode = document.body.classList.contains('pet');       // the workshop card
  const freeMode = document.body.classList.contains('pet-free'); // the crab living on a page
  const bakeMode = document.body.classList.contains('bake');
  const sheet = $('#sheet'), moreBtn = $('#more'), panelEl = $('.panel');
  const setSheet = open => {
    if (!sheet || !moreBtn) return;
    sheet.hidden = !open;
    moreBtn.setAttribute('aria-expanded', String(open));
    moreBtn.textContent = open ? '▾' : '⋯';
  };
  if (sheet && moreBtn) {
    moreBtn.addEventListener('click', () => setSheet(sheet.hidden));
    // a click out in the scene puts the sheet away again
    document.addEventListener('pointerdown', e => {
      if (sheet.hidden || panelEl.contains(e.target)) return;
      setSheet(false);
    });
  }
  setSheet(false);

  // ── build the crab once ──
  const world = buildCrab();
  const sim = new SoftBody(world.sim, { firmness: 0.45, damping: reduced.matches ? 0.65 : 0.42, roots: true });
  // a sitting toy: its seat keeps its footing, and it rights itself (to whatever heading it scuttled to)
  sim.postureAll = Array.from({ length: sim.n }, (_, i) => i); sim.posture = 0.004; sim.postureYaw = 0;
  sim.setupMuscles(world.cellBreath, world.sim.tetCell);
  // the finger only presses on the body (a poke)
  sim.finger = { on: false, p: [0, 9, 0], prev: [0, 9, 0], r: 0.15, len: 4.4, axis: [1, 0, 0], grip: 0, touch: 0 };
  const renderMesh = world.render, nV = renderMesh.rest.length / 3, nBody = renderMesh.nBody;
  const { skinIdx, skinW } = world;
  const index = renderMesh.index, restN = renderMesh.nrm, restP = renderMesh.rest;
  const tetInv = restInverses(world.sim.rest, world.sim.tets);
  const nodeF = new Float32Array(world.sim.rest.length * 3), nodeCnt = new Float32Array(world.sim.rest.length / 3);
  for (let t = 0; t < world.sim.tets.length; t++) nodeCnt[world.sim.tets[t]]++;
  for (let i = 0; i < nodeCnt.length; i++) nodeCnt[i] = nodeCnt[i] ? 1 / nodeCnt[i] : 0;
  const vertF = new Float32Array(nV * 9);
  sim.reset(0);

  // embedded points: the hips, the body's frame, the spheres the limbs slide over
  const embedded = (v, out, o) => {
    let x = 0, y = 0, z = 0;
    for (let j = 0; j < 4; j++) { const i = skinIdx[4 * v + j], w = skinW[4 * v + j]; x += sim.x[3 * i] * w; y += sim.x[3 * i + 1] * w; z += sim.x[3 * i + 2] * w; }
    out[o] = x; out[o + 1] = y; out[o + 2] = z;
  };
  const K = KSEG, NL = NLEG, FO = world.frameOrigin;
  const hips = new Float32Array(NL * 3), framePts = new Float32Array(12), colP = new Float32Array(3);
  const body = { O: [0, 0, 0], R: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
  const spheres = COLLIDERS.map(c => ({ c: c.c.slice(), r: c.r }));
  function updateEmbedded() {
    for (let l = 0; l < NL; l++) embedded(world.hipFirst + l, hips, 3 * l);
    for (let q = 0; q < 4; q++) embedded(world.frameFirst + q, framePts, 3 * q);
    body.O = [framePts[0], framePts[1], framePts[2]]; body.R = bodyFrame(framePts);
    COLLIDERS.forEach((c, q) => { embedded(world.colFirst + q, colP, 0); spheres[q].c[0] = colP[0]; spheres[q].c[1] = colP[1]; spheres[q].c[2] = colP[2]; });
  }
  // the limbs' poses (body rest space), blended by weight; the wire's set (a bent limb stays bent)
  const POSES = ['sit', 'stand', 'hide', 'hang', 'wave', 'snip', 'reach'];
  const poseLib = {};
  for (const p of POSES) poseLib[p] = LEGS.map(L => legPose(L, p === 'reach' ? (L.kind === 'arm' ? 'stand' : 'sit') : p, K));
  const poseW = { sit: 1, stand: 0, hide: 0, hang: 0, wave: 0, snip: 0, reach: 0 }, poseWant = Object.assign({}, poseW);
  const bend = new Float32Array(NL * K * 3);           // the wire's own set, in the body's frame
  const legLocal = new Float32Array(NL * K * 3);       // where each point's pose puts it (body rest space)
  const legT = new Float32Array(NL * K * 3);
  const peek = [0, 0];                                 // how far each claw has lowered from the eyes (hiding)
  const gait = { walking: false, goal: null, side: 1, swing: -1, swingT: 0, from: new Float32Array(NL * 3), to: new Float32Array(NL * 3), steps: 0, until: 0 };
  function poseLegs(time) {
    for (let l = 0; l < NL; l++) {
      const arm = l >= NWALK, a = l - NWALK;
      for (let j = 1; j < K; j++) {
        const o = 3 * (l * K + j);
        let x = 0, y = 0, z = 0, W = 0;
        for (const p of POSES) {
          let wt = poseW[p];
          if (wt < 1e-4) continue;
          if (arm && p === 'hide' && peek[a] > 0) {
            const ws = wt * peek[a], S = poseLib.sit[l][j];
            x += S[0] * ws; y += S[1] * ws; z += S[2] * ws; W += ws;
            wt -= ws;
          }
          const P = poseLib[p][l][j]; x += P[0] * wt; y += P[1] * wt; z += P[2] * wt; W += wt;
        }
        if (W > 0) { x /= W; y /= W; z /= W; }
        const t = j / (K - 1);
        if (arm && poseW.wave > 0.01) x += Math.sin(time * 9 + (LEGS[l].side > 0 ? Math.PI : 0)) * 0.18 * t * t * poseW.wave;
        if (arm && poseW.snip > 0.01) y += Math.sin(time * 3.1 + a * 2) * 0.02 * t * poseW.snip;
        if (poseW.hang > 0.01) {
          // dangling limbs paddle the air
          const ph = time * 5.5 + l * 0.8;
          x += Math.sin(ph) * 0.07 * t * poseW.hang * LEGS[l].d[0]; y += Math.cos(ph) * 0.08 * t * poseW.hang; z += Math.sin(ph) * 0.07 * t * poseW.hang * LEGS[l].d[2];
        }
        if (poseW.stand > 0.01 && gait.walking && !arm) y += Math.sin(time * 14 + l * 1.7) * 0.025 * poseW.stand;   // knees bob as it scuttles
        legLocal[o] = x + bend[o]; legLocal[o + 1] = y + bend[o + 1]; legLocal[o + 2] = z + bend[o + 2];
      }
    }
    const R = body.R, O = body.O;
    for (let l = 0; l < NL; l++) for (let j = 0; j < K; j++) {
      const o = 3 * (l * K + j);
      if (j === 0) { legT[o] = hips[3 * l]; legT[o + 1] = hips[3 * l + 1]; legT[o + 2] = hips[3 * l + 2]; continue; }
      const lx = legLocal[o] - FO[0], ly = legLocal[o + 1] - FO[1], lz = legLocal[o + 2] - FO[2];
      legT[o] = O[0] + R[0] * lx + R[1] * ly + R[2] * lz; legT[o + 1] = O[1] + R[3] * lx + R[4] * ly + R[5] * lz; legT[o + 2] = O[2] + R[6] * lx + R[7] * ly + R[8] * lz;
    }
  }
  // the wire takes a set: while the hand bends a limb past its give, the pose follows it there
  function bendWire() {
    if (!legs.grab) return;
    const l = legs.grab.leg, R = body.R, O = body.O, yieldD = 0.04 + 0.08 * legs.wire, rate = 0.25 * (1.1 - legs.wire);
    for (let j = 1; j < K; j++) {
      const o = 3 * (l * K + j), q = 3 * (l * K + j);
      const dx = legs.x[q] - O[0], dy = legs.x[q + 1] - O[1], dz = legs.x[q + 2] - O[2];
      // into the body's rest frame (R is a rotation: its transpose undoes it)
      const lx = R[0] * dx + R[3] * dy + R[6] * dz + FO[0], ly = R[1] * dx + R[4] * dy + R[7] * dz + FO[1], lz = R[2] * dx + R[5] * dy + R[8] * dz + FO[2];
      const ex = lx - legLocal[o], ey = ly - legLocal[o + 1], ez = lz - legLocal[o + 2], e = Math.hypot(ex, ey, ez);
      if (e <= yieldD) continue;
      const f = (e - yieldD) / e * rate;
      bend[o] += ex * f; bend[o + 1] += ey * f; bend[o + 2] += ez * f;
    }
  }
  updateEmbedded();
  poseLegs(0);
  const legs = new Legs(LEGS.map((L, l) => poseLib.sit[l]), LEGS.map(L => s => limbRadius(L, s)), LEGS.map(L => (L.kind === 'arm' ? 1 : 0)));
  legs.setTargets(legT); legs.snap();
  legs.spheres = spheres;
  legs.finger = { on: false, p: [0, 9, 0], axis: [1, 0, 0], len: 4.4, r: 0.1 };
  const tubes = crabTubes(3, 10, 14);
  const claw = { a: [0.28, 0.28], want: [0.28, 0.28] };   // the claws' opening angles (radians per finger)

  let currentPalette = 'moss';
  const swatches = $('#swatches');
  for (const [key, p] of Object.entries(PALETTES)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.dataset.key = key;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', p.name + ' fur');
    b.innerHTML = `<span class="chip"><i style="background:${hex(p.furTip)}"></i><i style="background:${hex(p.furRoot)}"></i><i style="background:linear-gradient(90deg, ${hex(p.clawc)}, ${hex(p.under)})"></i></span><span class="swname">${p.name}</span>`;
    b.addEventListener('click', () => setPalette(key));
    swatches.appendChild(b);
  }
  function setPalette(key) {
    currentPalette = key;
    for (const b of swatches.children) b.setAttribute('aria-checked', String(b.dataset.key === key));
    document.documentElement.style.setProperty('--accent', hex(PALETTES[key].furRoot));
  }
  setPalette('moss');

  let renderer;
  const fmesh = fingerMesh();
  try {
    if (!navigator.gpu) throw new Error('no-webgpu');
    renderer = await Renderer.create(canvas, renderMesh, sim.edges, sim.n);
    renderer.setFinger(fmesh); renderer.setLimbs(tubes);
  } catch (err) {
    console.warn(err);
    const msg = String(err && err.message || err);
    if (msg === 'no-webgpu') showFallback('这只毛绒蟹需要 WebGPU。', '当前浏览器没有提供 navigator.gpu，没有可以渲染的东西。与其用别的方式假装绒毛，不如先留空。请换用较新的 Chrome、Edge 或 Safari（Windows 上的 Firefox 也可以），并确认已开启硬件加速。');
    else if (msg === 'no-adapter') showFallback('没有找到 WebGPU 适配器。', '浏览器支持 WebGPU，但连接不到图形适配器——通常是硬件加速被关闭，或显卡在屏蔽名单里。开启加速，或换一台设备再试。');
    else showFallback('渲染器没能启动。', msg.slice(0, 400));
    return;
  }
  let recoveries = 0;
  const wire = r => {
    r.onError = e => console.error('[webgpu]', e.message);
    r.onLost = async info => {
      if (info.reason === 'destroyed') return;
      if (recoveries++ < 2) {
        try {
          const fresh = await Renderer.create(canvas, renderMesh, sim.edges, sim.n);
          fresh.setFinger(fmesh); fresh.setLimbs(tubes); fresh.shells = renderer.shells;
          renderer = fresh; dyn = fresh.dyn; furOut = fresh.fur; wire(fresh); resize(); dirty = true;
          requestAnimationFrame(frame);
          return;
        } catch (e) { console.warn(e); }
      }
      showFallback('GPU 设备丢失了。', (info.message || '') + ' 刷新页面即可重新开始。');
    };
  };
  wire(renderer);
  let dyn = renderer.dyn, furOut = renderer.fur;

  // ── state ──
  // PET_FIELD feeds the post pass: on, then the page colour to dissolve the studio sweep into,
  // so the crab sits on the blog's paper instead of on a grey card
  // freeMode keeps the bake's look — transparent, contact shadow only — but stays interactive
  const PET_FIELD = freeMode ? [2, 0, 0, 0] : petMode ? BG_FIELD.slice() : [0, 0, 0, 0];
  const state = { paused: false, slow: false, showMesh: false, tool: 'hand', az: 0.38, el: 0.26, zoom: 1, time: 0, furLen: SHAPE.fur, tempo: 0.5 };

  // ── skinning: every render vertex follows its tetrahedron; normals ride along with the local
  // deformation (rest normal × cofactor of the node-averaged deformation gradient)
  let dirty = true, wasAwake = 1;
  function skin() {
    const aw = sim.awake[0] || dirty || wasAwake;
    wasAwake = sim.awake[0];
    dirty = false;
    if (!aw) return false;
    const x = sim.x, tets = sim.tets;
    nodeF.fill(0);
    for (let t = 0; t < sim.nT; t++) {
      const a = tets[4 * t], b = tets[4 * t + 1], cc = tets[4 * t + 2], d = tets[4 * t + 3];
      const ax = x[3 * a], ay = x[3 * a + 1], az = x[3 * a + 2];
      const e0 = x[3 * b] - ax, e1 = x[3 * cc] - ax, e2 = x[3 * d] - ax;
      const e3 = x[3 * b + 1] - ay, e4 = x[3 * cc + 1] - ay, e5 = x[3 * d + 1] - ay;
      const e6 = x[3 * b + 2] - az, e7 = x[3 * cc + 2] - az, e8 = x[3 * d + 2] - az;
      const I = 9 * t, m = tetInv;
      const F0 = e0 * m[I] + e1 * m[I + 3] + e2 * m[I + 6], F1 = e0 * m[I + 1] + e1 * m[I + 4] + e2 * m[I + 7], F2 = e0 * m[I + 2] + e1 * m[I + 5] + e2 * m[I + 8];
      const F3 = e3 * m[I] + e4 * m[I + 3] + e5 * m[I + 6], F4 = e3 * m[I + 1] + e4 * m[I + 4] + e5 * m[I + 7], F5 = e3 * m[I + 2] + e4 * m[I + 5] + e5 * m[I + 8];
      const F6 = e6 * m[I] + e7 * m[I + 3] + e8 * m[I + 6], F7 = e6 * m[I + 1] + e7 * m[I + 4] + e8 * m[I + 7], F8 = e6 * m[I + 2] + e7 * m[I + 5] + e8 * m[I + 8];
      for (let q = 0; q < 4; q++) {
        const o = 9 * tets[4 * t + q];
        nodeF[o] += F0; nodeF[o + 1] += F1; nodeF[o + 2] += F2; nodeF[o + 3] += F3; nodeF[o + 4] += F4; nodeF[o + 5] += F5; nodeF[o + 6] += F6; nodeF[o + 7] += F7; nodeF[o + 8] += F8;
      }
    }
    for (let v = 0; v < sim.n; v++) { const k = nodeCnt[v], o = 9 * v; for (let q = 0; q < 9; q++) nodeF[o + q] *= k; }
    for (let v = 0; v < nV; v++) {
      const i4 = 4 * v, o = 6 * v;
      const a = skinIdx[i4], b = skinIdx[i4 + 1], c = skinIdx[i4 + 2], d = skinIdx[i4 + 3];
      const w0 = skinW[i4], w1 = skinW[i4 + 1], w2 = skinW[i4 + 2], w3 = skinW[i4 + 3];
      dyn[o] = x[3 * a] * w0 + x[3 * b] * w1 + x[3 * c] * w2 + x[3 * d] * w3;
      dyn[o + 1] = x[3 * a + 1] * w0 + x[3 * b + 1] * w1 + x[3 * c + 1] * w2 + x[3 * d + 1] * w3;
      dyn[o + 2] = x[3 * a + 2] * w0 + x[3 * b + 2] * w1 + x[3 * c + 2] * w2 + x[3 * d + 2] * w3;
      const A = 9 * a, B = 9 * b, C = 9 * c, D = 9 * d, N = nodeF;
      const f0 = N[A] * w0 + N[B] * w1 + N[C] * w2 + N[D] * w3, f1 = N[A + 1] * w0 + N[B + 1] * w1 + N[C + 1] * w2 + N[D + 1] * w3, f2 = N[A + 2] * w0 + N[B + 2] * w1 + N[C + 2] * w2 + N[D + 2] * w3;
      const f3 = N[A + 3] * w0 + N[B + 3] * w1 + N[C + 3] * w2 + N[D + 3] * w3, f4 = N[A + 4] * w0 + N[B + 4] * w1 + N[C + 4] * w2 + N[D + 4] * w3, f5 = N[A + 5] * w0 + N[B + 5] * w1 + N[C + 5] * w2 + N[D + 5] * w3;
      const f6 = N[A + 6] * w0 + N[B + 6] * w1 + N[C + 6] * w2 + N[D + 6] * w3, f7 = N[A + 7] * w0 + N[B + 7] * w1 + N[C + 7] * w2 + N[D + 7] * w3, f8 = N[A + 8] * w0 + N[B + 8] * w1 + N[C + 8] * w2 + N[D + 8] * w3;
      const q = 9 * v;
      vertF[q] = f0; vertF[q + 1] = f1; vertF[q + 2] = f2; vertF[q + 3] = f3; vertF[q + 4] = f4; vertF[q + 5] = f5; vertF[q + 6] = f6; vertF[q + 7] = f7; vertF[q + 8] = f8;
      const nx0 = restN[3 * v], ny0 = restN[3 * v + 1], nz0 = restN[3 * v + 2];
      const c00 = f4 * f8 - f5 * f7, c01 = f5 * f6 - f3 * f8, c02 = f3 * f7 - f4 * f6;
      const c10 = f2 * f7 - f1 * f8, c11 = f0 * f8 - f2 * f6, c12 = f1 * f6 - f0 * f7;
      const c20 = f1 * f5 - f2 * f4, c21 = f2 * f3 - f0 * f5, c22 = f0 * f4 - f1 * f3;
      let nx = c00 * nx0 + c01 * ny0 + c02 * nz0, ny = c10 * nx0 + c11 * ny0 + c12 * nz0, nz = c20 * nx0 + c21 * ny0 + c22 * nz0;
      const l = 1 / (Math.sqrt(nx * nx + ny * ny + nz * nz) || 1);
      dyn[o + 3] = nx * l; dyn[o + 4] = ny * l; dyn[o + 5] = nz * l;
    }
    // glass eyes do not squash: each follows its patch of face rigidly (polar rotation of the averaged
    // deformation gradient, about the skinned centre)
    for (const g of renderMesh.rigid) {
      let cx = 0, cy = 0, cz = 0;
      const A = new Float64Array(9);
      for (let v = g.v0; v < g.v1; v++) { cx += dyn[6 * v]; cy += dyn[6 * v + 1]; cz += dyn[6 * v + 2]; for (let q = 0; q < 9; q++) A[q] += vertF[9 * v + q]; }
      const n = g.v1 - g.v0; cx /= n; cy /= n; cz /= n;
      for (let q = 0; q < 9; q++) A[q] /= n;
      let R = Array.from(A);
      for (let it = 0; it < 8; it++) {
        const [a, b, c, d, e, f, gg, h, i] = R;
        const k0 = e * i - f * h, k1 = f * gg - d * i, k2 = d * h - e * gg, det = a * k0 + b * k1 + c * k2;
        if (Math.abs(det) < 1e-8) break;
        const it_ = [k0, k1, k2, c * h - b * i, a * i - c * gg, b * gg - a * h, b * f - c * e, c * d - a * f, a * e - b * d].map(q => q / det);
        R = R.map((q, j) => 0.5 * (q + it_[j]));
      }
      let mx = 0, my = 0, mz = 0;
      for (let v = g.v0; v < g.v1; v++) { mx += restP[3 * v]; my += restP[3 * v + 1]; mz += restP[3 * v + 2]; }
      mx /= n; my /= n; mz /= n;
      for (let v = g.v0; v < g.v1; v++) {
        const rx = restP[3 * v] - mx, ry = restP[3 * v + 1] - my, rz = restP[3 * v + 2] - mz, o = 6 * v;
        dyn[o] = cx + R[0] * rx + R[1] * ry + R[2] * rz;
        dyn[o + 1] = cy + R[3] * rx + R[4] * ry + R[5] * rz;
        dyn[o + 2] = cz + R[6] * rx + R[7] * ry + R[8] * rz;
        const nx = restN[3 * v], ny = restN[3 * v + 1], nz = restN[3 * v + 2];
        dyn[o + 3] = R[0] * nx + R[1] * ny + R[2] * nz; dyn[o + 4] = R[3] * nx + R[4] * ny + R[5] * nz; dyn[o + 5] = R[6] * nx + R[7] * ny + R[8] * nz;
      }
    }
    return true;
  }

  // ── the fur's lie and sway ──
  // the pile runs back from the face over the body and down its sides, swirling a little
  const comb = new Float32Array(nBody * 3), combDefault = new Float32Array(nBody * 3);
  {
    const R = rng(7);
    for (let v = 0; v < nBody; v++) {
      const n = [restN[3 * v], restN[3 * v + 1], restN[3 * v + 2]];
      const p = [restP[3 * v], restP[3 * v + 1], restP[3 * v + 2]];
      let d = [0.25 * Math.sin(p[1] * 5 + p[2] * 3) + 0.35 * Math.sign(p[0]) * Math.min(1, Math.abs(p[0]) * 4), -0.45, -0.85];
      const dl = Math.hypot(...d) || 1; d = d.map(q => q / dl);
      const kk = d[0] * n[0] + d[1] * n[1] + d[2] * n[2];
      d = [d[0] - n[0] * kk, d[1] - n[1] * kk, d[2] - n[2] * kk];
      const l = Math.hypot(...d);
      const mag = 0.3 * Math.min(1, l * 1.6) * (0.85 + 0.3 * R());
      if (l > 1e-4) for (let q = 0; q < 3; q++) combDefault[3 * v + q] = d[q] / l * mag;
    }
    comb.set(combDefault);
  }
  const tip = new Float32Array(nBody * 3), tipV = new Float32Array(nBody * 3);
  const lastP = new Float32Array(nBody * 3), lastVel = new Float32Array(nBody * 3);
  let furPrimed = false, furCalm = 0;
  const FUR_K = 900, FUR_C = 24, FUR_S = 22;
  function updateFur(dt, moved) {
    if (!furPrimed) {
      for (let v = 0; v < nBody; v++) for (let q = 0; q < 3; q++) lastP[3 * v + q] = dyn[6 * v + q];
      furPrimed = true;
    }
    const idt = dt > 0 ? 1 / dt : 0;
    let energy = 0;
    const g = -9.81 * FUR_S;
    for (let v = 0; v < nBody; v++) {
      const o = 6 * v, q = 3 * v;
      const vx = (dyn[o] - lastP[q]) * idt, vy = (dyn[o + 1] - lastP[q + 1]) * idt, vz = (dyn[o + 2] - lastP[q + 2]) * idt;
      let ax = (vx - lastVel[q]) * idt, ay = (vy - lastVel[q + 1]) * idt, az = (vz - lastVel[q + 2]) * idt;
      const am = Math.hypot(ax, ay, az); if (am > 80) { const s = 80 / am; ax *= s; ay *= s; az *= s; }
      lastP[q] = dyn[o]; lastP[q + 1] = dyn[o + 1]; lastP[q + 2] = dyn[o + 2];
      lastVel[q] = vx; lastVel[q + 1] = vy; lastVel[q + 2] = vz;
      if (dt > 0) {
        let ux = tipV[q] + (-ax * FUR_S - FUR_K * tip[q] - FUR_C * tipV[q]) * dt;
        let uy = tipV[q + 1] + (g - ay * FUR_S - FUR_K * tip[q + 1] - FUR_C * tipV[q + 1]) * dt;
        let uz = tipV[q + 2] + (-az * FUR_S - FUR_K * tip[q + 2] - FUR_C * tipV[q + 2]) * dt;
        tipV[q] = ux; tipV[q + 1] = uy; tipV[q + 2] = uz;
        tip[q] += ux * dt; tip[q + 1] += uy * dt; tip[q + 2] += uz * dt;
        const tm = Math.hypot(tip[q], tip[q + 1], tip[q + 2]);
        if (tm > 1.1) { const s = 1.1 / tm; tip[q] *= s; tip[q + 1] *= s; tip[q + 2] *= s; }
        energy += ux * ux + uy * uy + uz * uz;
      }
      const F = 9 * v, c0 = comb[q], c1 = comb[q + 1], c2 = comb[q + 2];
      let lx = vertF[F] * c0 + vertF[F + 1] * c1 + vertF[F + 2] * c2 + tip[q];
      let ly = vertF[F + 3] * c0 + vertF[F + 4] * c1 + vertF[F + 5] * c2 + tip[q + 1];
      let lz = vertF[F + 6] * c0 + vertF[F + 7] * c1 + vertF[F + 8] * c2 + tip[q + 2];
      const nx = dyn[o + 3], ny = dyn[o + 4], nz = dyn[o + 5], dn = lx * nx + ly * ny + lz * nz;
      if (dn < -0.25) { const s = -0.25 - dn; lx += nx * s; ly += ny * s; lz += nz * s; }
      const w = 4 * v;
      furOut[w] = lx; furOut[w + 1] = ly; furOut[w + 2] = lz; furOut[w + 3] = 0;
    }
    furCalm = energy / nBody;
    return moved || furCalm > 1e-5;
  }
  function smoothFur() { comb.set(combDefault); }

  // ── camera & framing (keeps the crab clear of the text and panel) ──
  const cam = { viewProj: null, view: null, invViewProj: null, pos: [0, 0, 0], fwd: [0, 0, -1], dist: 10 };
  const target = [0, 0.4, 0];
  const FOV = 27 * Math.PI / 180;
  let fitR = bakeMode ? 2.2 : freeMode ? 1.5 : document.body.classList.contains('pet') ? 1.44 : 1.3;
  function safeRect() {
    const cr = canvas.getBoundingClientRect();
    // the sprite bake wants the whole frame; the pet card gives up the strip its toolbar sits on
    if (document.body.classList.contains('pet-free')) {
      // the page owns a full-viewport canvas; this rect is where the crab is standing right now
      const st = window.__crabStage;
      if (st && st.w > 0) return { x: st.x, y: st.y, w: st.w, h: st.h };
      return { x: 0, y: 0, w: cr.width, h: cr.height };
    }
    if (document.body.classList.contains('bake')) return { x: 0, y: 0, w: cr.width, h: cr.height };
    if (document.body.classList.contains('pet')) {
      const bar = document.getElementById('petbar');
      const bh = bar ? bar.getBoundingClientRect().height + 14 : 0;
      return { x: 20, y: 0, w: Math.max(120, cr.width - 20), h: Math.max(120, cr.height - bh) };
    }
    if (document.body.classList.contains('stacked')) return { x: 0, y: 0, w: cr.width, h: cr.height };
    const panel = $('.panel').getBoundingClientRect();
    const head = $('.masthead').getBoundingClientRect();
    const read = $('.readouts').getBoundingClientRect();
    const left = Math.min(head.right - cr.left, cr.width * 0.24) * 0.55;
    const right = panel.left - cr.left - 12;
    const top = Math.min(head.bottom - cr.top, cr.height * 0.34) * 0.3;
    const bottom = read.top - cr.top + 24;
    return { x: left, y: top, w: Math.max(200, right - left), h: Math.max(200, bottom - top) };
  }
  let bodyC = [0, 0.4, -0.2], bodyV = [0, 0, 0];
  function followScene(dt) {
    if (drag.mode === 'grab') return;
    const k = 1 - Math.exp(-dt * 1.0);
    target[0] += (bodyC[0] * 0.8 - target[0]) * k; target[2] += (bodyC[2] * 0.8 - target[2]) * k;
    target[1] += (Math.max(0.4, bodyC[1]) - (document.body.classList.contains('stacked') ? 0.2 : 0) - target[1]) * k;
  }
  function updateCamera() {
    const W = renderer.w, H = renderer.h;
    const cr = canvas.getBoundingClientRect();
    const r = safeRect();
    const aspect = W / H;
    const hf = r.h / cr.height, wf = r.w / cr.width;
    const st = document.body.classList.contains('stacked');
    // the legs spread ±1.5 sideways, so a narrow (portrait) frame is limited by width
    const Rh = st ? 1.72 : fitR * 0.95, Rv = fitR * 1.08;
    const t2 = Math.tan(FOV / 2);
    const dist = Math.max(Rv / (t2 * 0.92 * hf) * (st ? 1.18 : 1), Rh / (t2 * 0.94 * aspect * wf)) * state.zoom;
    cam.dist = dist;
    const ce = Math.cos(state.el);
    const eye = [target[0] + dist * Math.sin(state.az) * ce, target[1] + dist * Math.sin(state.el), target[2] + dist * Math.cos(state.az) * ce];
    const view = M4.lookAt(eye, target, [0, 1, 0]);
    const proj = M4.perspective(FOV, aspect, 0.2, 120);
    const cx = (r.x + r.w / 2) / cr.width, cy = (r.y + r.h / 2) / cr.height;
    proj[8] -= (cx * 2 - 1); proj[9] -= -(cy * 2 - 1);
    cam.view = view; cam.viewProj = M4.mul(proj, view); cam.invViewProj = M4.invert(cam.viewProj);
    cam.pos = eye;
    const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
    const fl = Math.hypot(...f); cam.fwd = f.map(v => v / fl);
  }
  const keyDir = (() => { const d = [-0.45, 0.85, 0.4]; const l = Math.hypot(...d); return d.map(v => v / l); })();
  const light = { dir: keyDir, intensity: 2.2, lightVP: null, topVP: null, half: 3, topHalf: 3.5, range: 24 };
  function updateLight() {
    const at = [bodyC[0], 0.4, bodyC[2]];
    light.half = 2.6; light.topHalf = 3.2; light.range = 24;
    light.lightVP = M4.mul(M4.ortho(-light.half, light.half, -light.half, light.half, 0.1, 24.1), M4.lookAt([at[0] + keyDir[0] * 12, at[1] + keyDir[1] * 12, at[2] + keyDir[2] * 12], at, [0, 0, 1]));
    light.topVP = M4.mul(M4.ortho(-light.topHalf, light.topHalf, -light.topHalf, light.topHalf, 0, 6), M4.lookAt([at[0], -1, at[2]], [at[0], 1, at[2]], [0, 0, -1]));
  }

  // ── resize ──
  const QUALITY = [[1.6, 36], [1.3, 30], [1.0, 24], [0.8, 18]];
  let quality = 0;
  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, QUALITY[quality][0]);
    renderer.shells = QUALITY[quality][1];
    renderer.resize(r.width * dpr, r.height * dpr);
  }
  let slowT = 0, lockQ = false;
  function adaptQuality(dt) {
    if (lockQ || quality >= QUALITY.length - 1 || document.hidden) return;
    if (dt > 1 / 38) slowT += dt; else slowT = Math.max(0, slowT - dt * 0.5);
    if (slowT > 1.5) { quality++; slowT = 0; resize(); $('#nShells').textContent = String(renderer.shells); }
  }
  const stacked = matchMedia('(max-width: 860px), (max-height: 560px) and (max-width: 1000px)');
  // the card the pet lives in is narrower than the stacked breakpoint, so pet mode ignores it
  const applyLayout = () => { document.body.classList.toggle('stacked', !petMode && !bakeMode && !freeMode && stacked.matches); resize(); };
  stacked.addEventListener('change', applyLayout);
  applyLayout();
  new ResizeObserver(resize).observe(canvas);

  // ── picking ──
  function rayFrom(clientX, clientY) {
    const r = canvas.getBoundingClientRect();
    const nx = ((clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((clientY - r.top) / r.height) * 2;
    const m = cam.invViewProj;
    // the camera is only built on the first frame; a pointer arriving before that gets a stand-in
    // ray rather than a throw, which would wedge the render loop for good
    if (!m) return { o: [0, 0, 0], d: [0, 0, -1] };
    const un = (x, y, z) => {
      const w = m[3] * x + m[7] * y + m[11] * z + m[15];
      return [(m[0] * x + m[4] * y + m[8] * z + m[12]) / w, (m[1] * x + m[5] * y + m[9] * z + m[13]) / w, (m[2] * x + m[6] * y + m[10] * z + m[14]) / w];
    };
    const a = un(nx, ny, 0), b = un(nx, ny, 1);
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; const l = Math.hypot(...d);
    return { o: a, d: d.map(v => v / l) };
  }
  // the ray against the skin (inflated by half the fur, so a touch on the fluff counts)
  function pick(ray) {
    let best = Infinity;
    const { o, d } = ray;
    const B = sim.bounds();
    let t0 = 0, t1 = Infinity;
    for (let k = 0; k < 3; k++) {
      const lo = B[k] - 0.3, hi = B[3 + k] + 0.3;
      if (Math.abs(d[k]) < 1e-9) { if (o[k] < lo || o[k] > hi) return null; continue; }
      let ta = (lo - o[k]) / d[k], tb = (hi - o[k]) / d[k]; if (ta > tb) { const q = ta; ta = tb; tb = q; }
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    }
    if (t1 < t0) return null;
    const infl = state.furLen * 0.5, end = renderMesh.body.count;
    for (let t = 0; t < end; t += 3) {
      const a = 6 * index[t], b = 6 * index[t + 1], cc = 6 * index[t + 2];
      const ax = dyn[a] + dyn[a + 3] * infl, ay = dyn[a + 1] + dyn[a + 4] * infl, az = dyn[a + 2] + dyn[a + 5] * infl;
      const e1x = dyn[b] + dyn[b + 3] * infl - ax, e1y = dyn[b + 1] + dyn[b + 4] * infl - ay, e1z = dyn[b + 2] + dyn[b + 5] * infl - az;
      const e2x = dyn[cc] + dyn[cc + 3] * infl - ax, e2y = dyn[cc + 1] + dyn[cc + 4] * infl - ay, e2z = dyn[cc + 2] + dyn[cc + 5] * infl - az;
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const tx = o[0] - ax, ty = o[1] - ay, tz = o[2] - az;
      const uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
      const tt = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (tt > 1e-4 && tt < best) best = tt;
    }
    return best < Infinity ? [o[0] + d[0] * best, o[1] + d[1] * best, o[2] + d[2] * best] : null;
  }
  // the ray against the legs (inflated by the pile, and a little more: they are thin)
  function pickLeg(ray) {
    const D = renderer.limbDyn, I = tubes.index, infl = state.furLen * 0.42 + 0.03;
    if (!D) return Infinity;
    const P = pickLeg.buf || (pickLeg.buf = new Float32Array(tubes.nV * 3));
    for (let v = 0; v < tubes.nV; v++) { P[3 * v] = D[6 * v] + D[6 * v + 3] * infl; P[3 * v + 1] = D[6 * v + 1] + D[6 * v + 4] * infl; P[3 * v + 2] = D[6 * v + 2] + D[6 * v + 5] * infl; }
    return legs.pickTris(ray.o, ray.d, P, I);
  }
  function pickNear(clientX, clientY, maxPx) {
    const r = canvas.getBoundingClientRect(), M = cam.viewProj, x = sim.x;
    let best = -1, bd = maxPx * maxPx;
    for (let i = 0; i < sim.n; i++) {
      const X = x[3 * i], Y = x[3 * i + 1], Z = x[3 * i + 2];
      const w = M[3] * X + M[7] * Y + M[11] * Z + M[15];
      const sx = r.left + ((M[0] * X + M[4] * Y + M[8] * Z + M[12]) / w * 0.5 + 0.5) * r.width;
      const sy = r.top + (0.5 - (M[1] * X + M[5] * Y + M[9] * Z + M[13]) / w * 0.5) * r.height;
      const d = (sx - clientX) ** 2 + (sy - clientY) ** 2 - w * 1e-3;
      if (d < bd) { bd = d; best = i; }
    }
    return best < 0 ? null : [x[3 * best], x[3 * best + 1], x[3 * best + 2]];
  }

  // ── comb: stroking the fur lays the pile down the way the stroke went ──
  const BRUSH = 0.17;
  function brush(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const dl = Math.hypot(dx, dy, dz);
    if (dl < 0.004) return false;
    const steps = Math.max(1, Math.ceil(dl / 0.05));
    let touched = false;
    for (let s = 1; s <= steps; s++) {
      const c = [from[0] + dx * s / steps, from[1] + dy * s / steps, from[2] + dz * s / steps];
      for (let v = 0; v < nBody; v++) {
        const o = 6 * v;
        const ex = dyn[o] - c[0], ey = dyn[o + 1] - c[1], ez = dyn[o + 2] - c[2];
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > BRUSH * BRUSH) continue;
        if (ex * dyn[o + 3] + ey * dyn[o + 4] + ez * dyn[o + 5] < -0.08) continue;
        const f = 1 - Math.sqrt(d2) / BRUSH, w = f * f * (3 - 2 * f) * 0.55;
        const F = 9 * v, m = vertF;
        const a0 = m[F], a1 = m[F + 1], a2 = m[F + 2], a3 = m[F + 3], a4 = m[F + 4], a5 = m[F + 5], a6 = m[F + 6], a7 = m[F + 7], a8 = m[F + 8];
        const k0 = a4 * a8 - a5 * a7, k1 = a5 * a6 - a3 * a8, k2 = a3 * a7 - a4 * a6;
        const det = a0 * k0 + a1 * k1 + a2 * k2;
        if (Math.abs(det) < 1e-6) continue;
        const id = 1 / det;
        let rx = (k0 * dx + (a2 * a7 - a1 * a8) * dy + (a1 * a5 - a2 * a4) * dz) * id;
        let ry = (k1 * dx + (a0 * a8 - a2 * a6) * dy + (a2 * a3 - a0 * a5) * dz) * id;
        let rz = (k2 * dx + (a1 * a6 - a0 * a7) * dy + (a0 * a4 - a1 * a3) * dz) * id;
        const nx = restN[3 * v], ny = restN[3 * v + 1], nz = restN[3 * v + 2], k = rx * nx + ry * ny + rz * nz;
        rx -= nx * k; ry -= ny * k; rz -= nz * k;
        const rl = Math.hypot(rx, ry, rz); if (rl < 1e-9) continue;
        const q = 3 * v, mag = 1.35;
        comb[q] += (rx / rl * mag - comb[q]) * w; comb[q + 1] += (ry / rl * mag - comb[q + 1]) * w; comb[q + 2] += (rz / rl * mag - comb[q + 2]) * w;
        touched = true;
      }
    }
    return touched;
  }

  // ── being alive: breathing, scuttling sideways, snipping, hiding, waving, reaching ──
  // The shell breathes (its cells' rest shapes swell a little). Scuttling: the body rises onto its legs
  // and is led toward a goal (a weak pull, and a heading the posture turns it to — a flank to the goal,
  // for a crab goes sideways); each toe is drawn to a foothold on the table, and the gait lifts alternate
  // sets of four to new footholds ahead. Snipping: both claws up, snapping a beat apart. Hiding: legs in,
  // claws over the eyes, then a peek. Reaching: it turns to face the finger and both claws close on it.
  const life = { mode: 'sit', t: 0, breath: 0, cool: 0, nextIdle: 7, snaps: [-1, -1], pinchT: [0, 0], pinched: false };
  const g9 = 9.81;
  let restLow = 0, snips = 0;
  const ease = (cur, want, rate, h) => cur + (want - cur) * (1 - Math.exp(-rate * h));
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const clampTo = (v, m) => Math.max(-m, Math.min(m, v));
  const headingOf = R => Math.atan2(R[2], R[8]);          // where the body's +z now points, as a yaw
  function setPose(name) { for (const p of POSES) poseWant[p] = p === name ? 1 : 0; }
  const toastEl = $('#toast');
  let toastT = 0;
  function toast(text) { toastEl.textContent = text; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 1900); }
  const GROUP = LEGS.slice(0, NWALK).map(L => ((L.side < 0) === (L.i % 2 === 0)) ? 0 : 1);
  // where a leg would like its foot: its standing pose's toe, in the body's frame, set on the table
  function idealFoot(l, out, lead) {
    const P = poseLib.stand[l][K - 1], R = body.R, O = body.O;
    const lx = P[0] - FO[0], ly = P[1] - FO[1], lz = P[2] - FO[2];
    out[0] = O[0] + R[0] * lx + R[1] * ly + R[2] * lz + lead[0];
    out[1] = legs.rad[l * K + K - 1];
    out[2] = O[2] + R[6] * lx + R[7] * ly + R[8] * lz + lead[2];
  }
  function walkTo(goal, seconds) {
    if (life.mode === 'hide' || life.mode === 'air') return;
    gait.goal = goal.slice(); gait.until = state.time + seconds;
    if (gait.walking) return;
    // a flank leads: whichever side is the shorter turn
    const c = sim.centroid(), gam = Math.atan2(goal[0] - c[0], goal[1] - c[2]);
    gait.side = Math.abs(wrap(gam - Math.PI / 2 - sim.postureYaw)) <= Math.abs(wrap(gam + Math.PI / 2 - sim.postureYaw)) ? 1 : -1;
    gait.walking = true; gait.swing = -1;
    for (let l = 0; l < NWALK; l++) { const k = 3 * (l * K + K - 1); legs.foot[3 * l] = legs.x[k]; legs.foot[3 * l + 1] = legs.rad[l * K + K - 1]; legs.foot[3 * l + 2] = legs.x[k + 2]; }
    life.mode = 'walk'; setPose('stand'); sim.rooted = false; sim.airborne = false; sim.wakeAll();
  }
  function stopWalk() {
    if (!gait.walking) return;
    gait.walking = false; gait.goal = null; gait.swing = -1;
    life.mode = 'sit'; setPose('sit'); letGo();
  }
  const tmpF = [0, 0, 0];
  function gaitStep(h) {
    for (let l = 0; l < NL; l++) legs.footW[l] = l < NWALK ? ease(legs.footW[l], gait.walking ? 1 : 0, gait.walking ? 6 : 4, h) : 0;
    if (!gait.walking) return;
    const lead = [bodyV[0] * 0.24, 0, bodyV[2] * 0.24];
    if (gait.swing >= 0) {
      gait.swingT += h / 0.17;
      const u = Math.min(1, gait.swingT), e = u * u * (3 - 2 * u);
      for (let l = 0; l < NWALK; l++) {
        if (GROUP[l] !== gait.swing) continue;
        for (let q = 0; q < 3; q++) legs.foot[3 * l + q] = gait.from[3 * l + q] + (gait.to[3 * l + q] - gait.from[3 * l + q]) * e;
        legs.foot[3 * l + 1] += 0.14 * Math.sin(Math.PI * u);
      }
      if (u >= 1) { gait.swing = -1; gait.steps += 4; }
      return;
    }
    // which set has fallen furthest behind? lift it, and set it down ahead
    const err = [0, 0];
    for (let l = 0; l < NWALK; l++) {
      idealFoot(l, tmpF, [0, 0, 0]);
      err[GROUP[l]] = Math.max(err[GROUP[l]], Math.hypot(tmpF[0] - legs.foot[3 * l], tmpF[2] - legs.foot[3 * l + 2]));
    }
    const gpick = err[0] >= err[1] ? 0 : 1;
    if (err[gpick] > 0.1) {
      gait.swing = gpick; gait.swingT = 0;
      for (let l = 0; l < NWALK; l++) {
        if (GROUP[l] !== gpick) continue;
        idealFoot(l, tmpF, lead);
        for (let q = 0; q < 3; q++) { gait.from[3 * l + q] = legs.foot[3 * l + q]; gait.to[3 * l + q] = tmpF[q]; }
      }
    }
  }
  const busy = () => life.mode === 'hide' || life.mode === 'air';
  // snip snip: both claws up, then each snaps shut a beat after the other
  function snip() {
    if (state.paused || busy()) return;
    if (gait.walking) stopWalk();
    life.mode = 'snip'; life.t = 0; life.snaps = [-1, -1]; setPose('snip'); sim.wakeAll();
  }
  const SNIP_P = 0.62;
  function snipAngle(a) {
    const tt = life.t - 0.5 - 0.3 * a;
    // the claws swing open, hold a beat, snap shut, and ease open again
    if (tt < 0) { const k = Math.min(1, life.t / 0.5); return 0.28 + 0.34 * (1 - (1 - k) * (1 - k)); }
    const cyc = Math.floor(tt / SNIP_P), p = (tt - cyc * SNIP_P) / SNIP_P;
    let ang;
    if (p < 0.12) ang = 0.62;
    else if (p < 0.2) ang = 0.62 * (1 - (p - 0.12) / 0.08);
    else if (p < 0.3) ang = 0.04 * Math.sin((p - 0.2) / 0.1 * Math.PI);
    else { const k = (p - 0.3) / 0.7; ang = 0.62 * (k * k * (3 - 2 * k)); }
    if (p >= 0.2 && life.snaps[a] !== cyc) { life.snaps[a] = cyc; snips++; }
    return Math.max(0, ang);
  }
  // hide: legs pulled in, claws closed over the eyes — then one peeks out, and the other
  function hide() {
    if (state.paused || life.mode === 'air') return;
    if (gait.walking) { gait.walking = false; gait.goal = null; gait.swing = -1; }
    life.mode = 'hide'; life.t = 0; peek[0] = peek[1] = 0; setPose('hide'); letGo();
  }
  function wave() {
    if (state.paused || busy()) return;
    if (gait.walking) stopWalk();
    life.mode = 'wave'; life.t = 0; setPose('wave'); sim.wakeAll();
  }
  function enterReach() {
    if (busy()) return;
    life.mode = 'reach'; life.t = 0; life.pinchT = [0, 0]; life.pinched = false; setPose('reach');
    sim.rooted = false; sim.airborne = false; sim.wakeAll();
  }
  function exitReach() {
    if (life.mode !== 'reach') return;
    life.mode = 'sit'; setPose('sit'); sim.postureYaw = headingOf(body.R); letGo();
  }
  function wander() {
    if (state.paused || busy()) return;
    // somewhere nearby on the table, not too close
    const c = sim.centroid();
    for (let tries = 0; tries < 20; tries++) {
      const a = Math.random() * Math.PI * 2, r = 0.6 + Math.random() * 0.8;
      const gx = c[0] + Math.sin(a) * r, gz = c[2] + Math.cos(a) * r;
      if (Math.hypot(gx, gz) < 1.3) { walkTo([gx, gz], 5); return; }
    }
    walkTo([0, 0], 5);
  }
  const lerpAng = (cur, want, rate, h) => ease(cur, want, rate, h);
  function lifeStep(h) {
    const L = life;
    L.t += h; L.cool = Math.max(0, L.cool - h);
    L.breath += h / (L.mode === 'hide' ? 1.5 : 2.8);
    sim.setMuscles((L.mode === 'hide' ? 0.025 : 0.035) * Math.sin(2 * Math.PI * L.breath));
    const c = sim.centroid();
    bodyV = [(c[0] - bodyC[0]) / h, (c[1] - bodyC[1]) / h, (c[2] - bodyC[2]) / h]; bodyC = c;
    let ax = 0, ay = 0, az = 0;
    // held up in the air (or still falling): the legs dangle and paddle
    const air = sim.grabbing ? sim.minY() > restLow + 0.1 : sim.airborne && sim.minY() > restLow + 0.3;
    if (air && L.mode !== 'air') {
      if (gait.walking) { gait.walking = false; gait.goal = null; gait.swing = -1; }
      L.mode = 'air'; L.t = 0; setPose('hang');
    } else if (!air && L.mode === 'air') {
      L.mode = 'sit'; L.t = 0; setPose('sit'); sim.postureYaw = headingOf(body.R); L.cool = 0.6;
    }
    // the finger: it scuttles over to it, turns to face it and pinches; a poke makes it hide
    const fingerOn = state.tool === 'finger' && finger.visible && !state.paused;
    if (fingerOn && !busy()) {
      if (sim.finger.touch > 2 && L.cool <= 0) hide();
      else {
        const gx = finger.aim[0] - c[0], gz = finger.aim[2] - c[2], d = Math.hypot(gx, gz);
        if (d > 1.9) {
          if (L.mode === 'reach') exitReach();
          if (!gait.walking || gait.until - state.time < 1) walkTo([c[0] + gx / d * (d - 1.2), c[2] + gz / d * (d - 1.2)], 4);
        } else if (d < 1.55 && L.mode !== 'reach') {
          if (gait.walking) stopWalk();
          enterReach();
        }
      }
    } else if (L.mode === 'reach') exitReach();

    const clawWant = claw.want;
    let clawFast = false;
    if (L.mode === 'walk' && gait.walking && gait.goal) {
      const hgt = sim.minY() - restLow, want = LIFT * poseW.stand;
      ay = Math.max(0, g9 + 16 * (want - hgt) - 4 * bodyV[1]);
      const gx = gait.goal[0] - c[0], gz = gait.goal[1] - c[2], d = Math.hypot(gx, gz);
      // turn a flank toward the goal (the posture carries the body round), then go — slower while still turning
      const yawGoal = Math.atan2(gx, gz) - gait.side * Math.PI / 2, err = wrap(yawGoal - sim.postureYaw);
      if (d > 0.15) sim.postureYaw += clampTo(err, 2.6 * h);
      const align = Math.max(0, Math.cos(err)), speed = Math.min(0.8, d * 1.2) * align * align;
      const vx = d > 1e-4 ? gx / d * speed : 0, vz = d > 1e-4 ? gz / d * speed : 0;
      ax = 7 * (vx - bodyV[0]); az = 7 * (vz - bodyV[2]);
      if (d < 0.12 || state.time > gait.until) stopWalk();
      for (let a = 0; a < 2; a++) clawWant[a] = 0.4 + 0.1 * Math.sin(state.time * 5 + a * 2.4);
    } else if (L.mode === 'snip') {
      for (let a = 0; a < 2; a++) { claw.a[a] = snipAngle(a); clawWant[a] = claw.a[a]; }
      clawFast = true;
      if (L.t > 0.8 + 3.55 * SNIP_P) { L.mode = 'sit'; setPose('sit'); }
    } else if (L.mode === 'hide') {
      peek[0] = 0.78 * ss(2.5, 2.9, L.t) * (1 - ss(3.3, 3.6, L.t));
      peek[1] = 0.78 * ss(1.8, 2.2, L.t) * (1 - ss(3.0, 3.3, L.t));
      clawWant[0] = clawWant[1] = 0.05;
      if (L.t > 3.8) { L.mode = 'sit'; setPose('sit'); L.cool = 1.6; peek[0] = peek[1] = 0; }
    } else if (L.mode === 'wave') {
      for (let a = 0; a < 2; a++) clawWant[a] = 0.36 + 0.24 * Math.sin(state.time * 7 + a * Math.PI);
      if (L.t > 2.8) { L.mode = 'sit'; setPose('sit'); }
    } else if (L.mode === 'air') {
      for (let a = 0; a < 2; a++) clawWant[a] = 0.4 + 0.22 * Math.sin(state.time * 3.4 + a * 2.2);
    } else if (L.mode === 'reach') {
      // face the finger, keep both claws on it
      const gx = finger.aim[0] - c[0], gz = finger.aim[2] - c[2], d = Math.hypot(gx, gz);
      if (d > 0.2) sim.postureYaw += clampTo(wrap(Math.atan2(gx, gz) - sim.postureYaw), 2.4 * h);
      for (let a = 0; a < 2; a++) {
        const w = legs.wrist[a], tx = w.P[0] + w.T[0] * 0.4, ty = w.P[1] + w.T[1] * 0.4, tz = w.P[2] + w.T[2] * 0.4;
        const near = Math.hypot(tx - reachW[a][0], ty - reachW[a][1], tz - reachW[a][2]) < 0.34;
        if (!near) { clawWant[a] = 0.62; continue; }
        L.pinchT[a] += h;
        // open … close gently on the finger … hold … open; the two claws a beat apart
        const ph = ((L.pinchT[a] - a * 0.45) % 1.7 + 1.7) % 1.7;
        clawWant[a] = ph < 0.4 ? 0.62 - 0.38 * ss(0, 0.4, ph) : ph < 0.9 ? 0.24 : 0.24 + 0.38 * ss(0.9, 1.6, ph);
      }
  if (!L.pinched && (L.pinchT[0] > 0.45 || L.pinchT[1] > 0.45)) { L.pinched = true; toast('轻轻捏了一下。'); }
    } else {
      // sitting: the claws held a little open; now and then a scuttle, a snip or a wave
      for (let a = 0; a < 2; a++) clawWant[a] = 0.27 + 0.05 * Math.sin(state.time * 0.9 + a * 1.7);
      if (sim.posture > 0.004 && L.t > 1.5) sim.posture = 0.004;
      L.nextIdle -= h;
      if (L.nextIdle <= 0) {
        L.nextIdle = 6 + Math.random() * 6;
        if (state.tool !== 'finger' && !sim.grabbing && !legs.grab) { const r = Math.random(); if (r < 0.45) wander(); else if (r < 0.78) snip(); else wave(); }
      }
    }
    if (!clawFast) for (let a = 0; a < 2; a++) claw.a[a] = lerpAng(claw.a[a], clawWant[a], L.mode === 'reach' ? 12 : 9, h);
    for (const p of POSES) poseW[p] = ease(poseW[p], poseWant[p], L.mode === 'hide' ? 9 : 5, h);
    gaitStep(h);
    sim.accel = [ax, ay, az];
  }
  // pulling a limb further than it reaches drags the crab along by that hip
  let towing = false;
  function legTow() {
    const d = legs.grabOverreach();
    if (!d) { if (towing) { sim.endGrab(); towing = false; letGo(); } return; }
    const len = Math.hypot(d[0], d[1], d[2]);
    const l = legs.grab.leg, H = [hips[3 * l], hips[3 * l + 1], hips[3 * l + 2]];
    if (len > 0.14) {
      if (!towing) { sim.beginGrab(H, 0.36); towing = true; sim.rooted = false; if (gait.walking) stopWalk(); }
      const e = (len - 0.1) / len;
      sim.moveGrab([H[0] + d[0] * e, H[1] + d[1] * e, H[2] + d[2] * e]);
    } else if (towing && len < 0.08) { sim.endGrab(); towing = false; letGo(); }
  }
  // whatever let go of it: it is in the air until it has landed and found its footing again
  function letGo() { sim.airborne = true; sim.rooted = false; sim.landT = 0; sim.wakeAll(); }
  // the claws' reach: both arms toward the finger (in the body's rest space). The claw on the fingertip's side
  // takes the tip; the other takes the finger a little further back along it
  const reachW = [[0, 0, 0], [0, 0, 0]];
  function updateReach() {
    if (poseW.reach < 0.01) return;
    const R = body.R, O = body.O, A = finger.A;
    const toBody = (x, y, z) => {
      const dx = x - O[0], dy = y - O[1], dz = z - O[2];
      return [R[0] * dx + R[3] * dy + R[6] * dz + FO[0], R[1] * dx + R[4] * dy + R[7] * dz + FO[1], R[2] * dx + R[5] * dy + R[8] * dz + FO[2]];
    };
    const tipArm = toBody(finger.x, finger.y, finger.z)[0] >= 0 ? 1 : 0;
    for (let a = 0; a < 2; a++) {
      const off = a === tipArm ? 0 : 0.34;
      reachW[a] = [finger.x + A[0] * off, finger.y + A[1] * off, finger.z + A[2] * off];
      poseLib.reach[NWALK + a] = armToward(LEGS[NWALK + a], toBody(reachW[a][0], reachW[a][1], reachW[a][2]), K);
    }
  }

  // ── the quirk: loose googly eyes ──
  // Each pupil is a bead rolling about in its clear dome: gravity and every jolt of the body push it round, and it bounces off
  // the rim. The crab can also look — at the pointer, at a finger held out (both eyes cross as it comes close), at you, at its
  // own nose. Shaken or thrown about, the beads turn to spirals and the crab is dizzy for a while. A shy crab blushes.
  const EYES = world.eyes.map(e => { const t1 = norm(cross(e.ax, [0, 1, 0])); return { c: e.ctr, ax: e.ax, t1, t2: cross(e.ax, t1) }; });
  const BEAD_MAX = 0.46;
  const pup = EYES.map(() => ({ o: [0, 0.3], v: [0, 0], ph: 0 }));
  const gaze = { mode: 'rest', t: 2.5, w: 0, p: null };
  const quirk = { dizzy: 0, dizzyT: 0, acc: 0, spin: 0, blush: 0, calm: 0, ptr: { x: 0, y: 0, t: -99 }, aF: [0, 0, 0], prevV: [0, 0, 0], toastT: -99 };
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const toWorld = v => { const R = body.R; return [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]]; };
  const fromWorld = v => { const R = body.R; return [R[0] * v[0] + R[3] * v[1] + R[6] * v[2], R[1] * v[0] + R[4] * v[1] + R[7] * v[2], R[2] * v[0] + R[5] * v[1] + R[8] * v[2]]; };
  const restToWorld = p => { const w = toWorld([p[0] - FO[0], p[1] - FO[1], p[2] - FO[2]]); return [body.O[0] + w[0], body.O[1] + w[1], body.O[2] + w[2]]; };
  function startDizzy() {
    quirk.dizzyT = 3.6; quirk.acc = 0;
    if (state.time - quirk.toastT > 6) { quirk.toastT = state.time; toast('晕了，什么都在转。'); }
  }
  function pickGaze() {
    const r = Math.random();
    if (r < 0.28) { gaze.mode = 'rest'; gaze.t = 1.5 + Math.random() * 2.5; }
    else if (r < 0.52) { gaze.mode = 'camera'; gaze.t = 1.6 + Math.random() * 2; }
    else if (r < 0.8) { gaze.mode = 'wander'; gaze.t = 0.9 + Math.random() * 1.6; gaze.p = [(Math.random() * 2 - 1) * 1.1, 0.5 + Math.random() * 0.6, 1.2 + Math.random() * 0.4]; }
    else { gaze.mode = 'nose'; gaze.t = 1.2 + Math.random() * 1.4; }
  }
  // where it is looking, in the world, and how firmly (0: the beads just hang and roll)
  function gazeTarget() {
    const E0 = restToWorld(EYES[0].c), E1 = restToWorld(EYES[1].c);
    const head = [(E0[0] + E1[0]) / 2, (E0[1] + E1[1]) / 2, (E0[2] + E1[2]) / 2];
    if (state.tool === 'finger' && finger.visible) return { p: [finger.x, finger.y, finger.z], w: 1 };
    if (state.time - quirk.ptr.t < 4) {
      const r = rayFrom(quirk.ptr.x, quirk.ptr.y), t = (head[0] - r.o[0]) * r.d[0] + (head[1] - r.o[1]) * r.d[1] + (head[2] - r.o[2]) * r.d[2];
      return { p: [r.o[0] + r.d[0] * t, r.o[1] + r.d[1] * t, r.o[2] + r.d[2] * t], w: 0.85 };
    }
    if (gaze.mode === 'camera') return { p: cam.pos.slice(), w: 0.8 };
    if (gaze.mode === 'nose') return { p: restToWorld([0, EYES[0].c[1] - 0.07, EYES[0].c[2] + 0.3]), w: 1 };
    if (gaze.mode === 'wander') return { p: restToWorld([gaze.p[0], EYES[0].c[1] + gaze.p[1] - 0.5, EYES[0].c[2] + gaze.p[2]]), w: 0.8 };
    return { p: null, w: 0 };
  }
  function quirkStep(h) {
    const L = life, Q = quirk;
    // shaken or thrown about: dizzy
    const spd = Math.hypot(bodyV[0], bodyV[1], bodyV[2]);
    if (Q.dizzyT <= 0 && state.time > 1.5) {
      Q.acc = Math.max(0, Q.acc + (spd > 2.6 ? (spd - 2.6) * 2 * h : -0.5 * h));
      if (Q.acc > 1.0) startDizzy();
    }
    Q.dizzyT = Math.max(0, Q.dizzyT - h);
    const dzWant = Q.dizzyT > 0.5 ? 1 : Q.dizzyT / 0.5;
    Q.dizzy = ease(Q.dizzy, dzWant, 8, h);
    Q.spin += h * (1.2 + 2.2 * Q.dizzy);
    // the jolts the dome feels
    const aw = [(bodyV[0] - Q.prevV[0]) / h, (bodyV[1] - Q.prevV[1]) / h, (bodyV[2] - Q.prevV[2]) / h];
    Q.prevV = bodyV.slice();
    const am = Math.hypot(...aw), cl = am > 70 ? 70 / am : 1;
    for (let k = 0; k < 3; k++) Q.aF[k] += (aw[k] * cl - Q.aF[k]) * 0.4;
    const F = [-Q.aF[0], -9.81 - Q.aF[1], -Q.aF[2]];
    // looking
    gaze.t -= h; if (gaze.t <= 0) pickGaze();
    const G = gazeTarget();
    gaze.w = ease(gaze.w, G.w, 7, h);
    for (let k = 0; k < 2; k++) {
      const e = EYES[k], P = pup[k];
      if (Q.dizzy > 0.02 && Q.dizzyT > 0) {
        // the bead runs round the rim
        P.ph += h * (k ? 10.5 : 12.5);
        const r = BEAD_MAX * 0.95;
        P.o[0] += (Math.cos(P.ph) * r - P.o[0]) * Math.min(1, 14 * h); P.o[1] += (Math.sin(P.ph) * r - P.o[1]) * Math.min(1, 14 * h);
        P.v[0] = P.v[1] = 0;
        continue;
      }
      const f1 = dot3(F, toWorld(e.t1)), f2 = dot3(F, toWorld(e.t2));
      const w = gaze.w, gs = 1 - 0.9 * w;
      let ax = 1.15 * f1 * gs - 2.2 * P.v[0], ay = 1.15 * f2 * gs - 2.2 * P.v[1];
      if (G.p && w > 0.01) {
        const E = restToWorld(e.c), d = fromWorld([G.p[0] - E[0], G.p[1] - E[1], G.p[2] - E[2]]), dl = Math.hypot(...d) || 1;
        let gx = dot3(d, e.t1) / dl * 0.9, gy = dot3(d, e.t2) / dl * 0.9; const gm = Math.hypot(gx, gy);
        if (gm > BEAD_MAX) { gx *= BEAD_MAX / gm; gy *= BEAD_MAX / gm; }
        ax += w * (70 * (gx - P.o[0]) - 11 * P.v[0]); ay += w * (70 * (gy - P.o[1]) - 11 * P.v[1]);
      }
      P.v[0] += ax * h; P.v[1] += ay * h;
      P.o[0] += P.v[0] * h; P.o[1] += P.v[1] * h;
      const m = Math.hypot(P.o[0], P.o[1]);
      if (m > BEAD_MAX) {
        const nx = P.o[0] / m, ny = P.o[1] / m;
        P.o[0] = nx * BEAD_MAX; P.o[1] = ny * BEAD_MAX;
        const vn = P.v[0] * nx + P.v[1] * ny;
        if (vn > 0) { P.v[0] -= 1.5 * vn * nx; P.v[1] -= 1.5 * vn * ny; }
      }
    }
    // shy: blushes when it hides, or when it has pinched a finger
    const shy = L.mode === 'hide' ? 1 : (L.mode === 'reach' && (L.pinchT[0] > 0.3 || L.pinchT[1] > 0.3)) ? 0.85 : Q.dizzyT > 0 ? 0.35 : 0;
    Q.blush = ease(Q.blush, shy, 2.2, h);
  }
  function quirkReset() {
    const Q = quirk; Q.dizzy = 0; Q.dizzyT = 0; Q.acc = 0; Q.blush = 0; Q.aF = [0, 0, 0]; Q.prevV = bodyV.slice();
    for (const P of pup) { P.o = [0, 0.3]; P.v = [0, 0]; }
  }
  const cheekNow = pal => pal.cheek.map((v, i) => v + (BLUSH[i] - v) * 0.85 * quirk.blush);
  function stepWorld(h) {
    updateFinger(h);
    lifeStep(h);
    sim.step();
    updateEmbedded();
    quirkStep(h);
    updateReach();
    poseLegs(state.time);
    legs.setTargets(legT);
    legs.step(h);
    bendWire();
    legTow();
  }
  function updateLegMesh() {
    const R = body.R;
    legs.surface(tubes, renderer.limbDyn, renderer.limbFur, [R[1], R[4], R[7]], 0.42);
    legs.claws(tubes, renderer.limbDyn, renderer.limbFur, claw.a, 0.42);
    renderer.uploadLimbs();
  }
  function straighten() { bend.fill(0); sim.wakeAll(); }

  // ── the finger: held out where the pointer is; the crab scuttles over to it, and hides when poked ──
  // It reaches in from the viewer's side, low and to the right, tip first; its axis A runs from the tip back to the hand.
  const finger = { visible: false, aim: [0.3, 1.25, 0.2], x: 0, y: 1.25, z: 0, out: 3.6, want: 3.6, grip: 0, A: [1, 0, 0] };
  const IN = 0, AWAY = 3.6;
  function fingerAt(clientX, clientY) {
    // the pointer on the upright plane through the crab, facing the camera
    const ray = rayFrom(clientX, clientY);
    let nx = cam.fwd[0], nz = cam.fwd[2]; const nl = Math.hypot(nx, nz) || 1; nx /= nl; nz /= nl;
    const den = ray.d[0] * nx + ray.d[2] * nz;
    if (Math.abs(den) < 1e-4) return null;
    const t = ((bodyC[0] - ray.o[0]) * nx + (bodyC[2] - ray.o[2]) * nz) / den;
    if (t < 0) return null;
    const q = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    q[1] = Math.min(2.2, Math.max(0.1, q[1]));
    const dx = q[0] - bodyC[0], dz = q[2] - bodyC[2], r = Math.hypot(dx, dz), lim = 2.6;
    if (r > lim) { q[0] = bodyC[0] + dx / r * lim; q[2] = bodyC[2] + dz / r * lim; }
    return q;
  }
  function fingerAxis() {
    // back toward the viewer, to the right and down: the viewer's own hand reaching in
    let fx = cam.fwd[0], fz = cam.fwd[2]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;                       // right = fwd × up
    const a = [rx * 0.55 - fx * 1.0, -0.42, rz * 0.55 - fz * 1.0], l = Math.hypot(...a);
    return [a[0] / l, a[1] / l, a[2] / l];
  }
  let fingerPtr = null, fingerPressed = false;
  function updateFinger(dt) {
    if (state.tool !== 'finger') { finger.want = AWAY; fingerPressed = false; }
    const px = finger.x, py = finger.y, pz = finger.z;
    const ke = 1 - Math.exp(-dt * 6);
    finger.out += (finger.want - finger.out) * ke;
    if (fingerPtr) {
      const q = fingerAt(fingerPtr.x, fingerPtr.y);
      if (q) { const k = 1 - Math.exp(-dt * 16); for (let c = 0; c < 3; c++) finger.aim[c] += (q[c] - finger.aim[c]) * k; }
    }
    // the hand keeps its angle while pressed, and follows the view otherwise
    if (!fingerPressed || dt === 0) {
      const A = fingerAxis(), k = dt === 0 ? 1 : 1 - Math.exp(-dt * 4);
      for (let c = 0; c < 3; c++) finger.A[c] += (A[c] - finger.A[c]) * k;
      const l = Math.hypot(...finger.A); for (let c = 0; c < 3; c++) finger.A[c] /= l;
    }
    const A = finger.A;
    finger.x = finger.aim[0] + A[0] * finger.out; finger.y = finger.aim[1] + A[1] * finger.out; finger.z = finger.aim[2] + A[2] * finger.out;
    finger.visible = state.tool === 'finger' && finger.out < AWAY - 0.05;
    finger.grip += ((fingerPressed ? 1 : 0.25) * (finger.visible ? 1 : 0) - finger.grip) * (1 - Math.exp(-dt * 5));
    const F = sim.finger;
    F.on = finger.visible && !state.paused; F.p = [finger.x, finger.y, finger.z]; F.axis = A; F.grip = 0; F.r = 0.15;
    const WF = legs.finger;
    WF.on = F.on; WF.p = F.p; WF.axis = A; WF.len = 4.4; WF.r = 0.1;
    void px; void py; void pz;
    renderer.fingerVisible = finger.visible;
    if (finger.visible) {
      // pose the mesh: local +y along A (tip to hand), local +z (the nail) as near to up as A allows
      let ux = -A[0] * A[1], uy = 1 - A[1] * A[1], uz = -A[2] * A[1]; const ul = Math.hypot(ux, uy, uz); ux /= ul; uy /= ul; uz /= ul;
      const X = [A[1] * uz - A[2] * uy, A[2] * ux - A[0] * uz, A[0] * uy - A[1] * ux];
      const P = fmesh.rest, N = fmesh.nrm, out = renderer.fingerDyn;
      for (let v = 0; v < P.length / 3; v++) {
        const x = P[3 * v], y = P[3 * v + 1], z = P[3 * v + 2];
        out[6 * v] = finger.x + X[0] * x + A[0] * y + ux * z; out[6 * v + 1] = finger.y + X[1] * x + A[1] * y + uy * z; out[6 * v + 2] = finger.z + X[2] * x + A[2] * y + uz * z;
        const nx = N[3 * v], ny = N[3 * v + 1], nz = N[3 * v + 2];
        out[6 * v + 3] = X[0] * nx + A[0] * ny + ux * nz; out[6 * v + 4] = X[1] * nx + A[1] * ny + uy * nz; out[6 * v + 5] = X[2] * nx + A[2] * ny + uz * nz;
      }
    }
  }

  // ── pointer interaction ──
  const drag = { mode: null, id: -1, plane: null, twist: 0, twist0: 0, second: null, lastX: 0, lastY: 0, lastHit: null, what: null };
  function rotMat(axis, ang) {
    const [x, y, z] = axis, c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
    return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
  }
  function dragTarget(clientX, clientY) {
    const ray = rayFrom(clientX, clientY);
    const { p, n } = drag.plane;
    const den = ray.d[0] * n[0] + ray.d[1] * n[1] + ray.d[2] * n[2];
    if (Math.abs(den) < 1e-5) return null;
    const t = ((p[0] - ray.o[0]) * n[0] + (p[1] - ray.o[1]) * n[1] + (p[2] - ray.o[2]) * n[2]) / den;
    const q = [ray.o[0] + ray.d[0] * t, ray.o[1] + ray.d[1] * t, ray.o[2] + ray.d[2] * t];
    const dx = q[0] - target[0], dz = q[2] - target[2], lim = 4.5, dl = Math.hypot(dx, dz);
    if (dl > lim) { q[0] = target[0] + dx / dl * lim; q[2] = target[2] + dz / dl * lim; }
    q[1] = Math.min(Math.max(q[1], 0.05), 4.5);
    return q;
  }
  function applyGrab(x, y) {
    const q = dragTarget(x, y);
    if (!q) return;
    if (drag.what === 'leg') legs.moveGrab(q); else sim.moveGrab(q, rotMat(cam.fwd, drag.twist));
  }
  canvas.addEventListener('pointerdown', e => {
    if (drag.mode === 'grab' && drag.what === 'body' && e.pointerId !== drag.id && e.pointerType === 'touch') {
      drag.second = { id: e.pointerId, x: e.clientX, y: e.clientY };
      drag.twist0 = drag.twist - Math.atan2(e.clientY - drag.lastY, e.clientX - drag.lastX);
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      return;
    }
    if ((drag.mode === 'orbit' || drag.mode === 'comb' || drag.mode === 'finger') && e.pointerId !== drag.id && e.pointerType === 'touch') {
      if (drag.mode === 'finger') fingerPressed = false;
      drag.mode = 'pinch';
      drag.pinch = { a: drag.id, b: e.pointerId, pa: [drag.lastX, drag.lastY], pb: [e.clientX, e.clientY], zoom0: state.zoom };
      drag.pinch.d0 = Math.max(20, Math.hypot(drag.pinch.pa[0] - e.clientX, drag.pinch.pa[1] - e.clientY));
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
      e.preventDefault();
      return;
    }
    if (drag.mode) return;
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return;
    drag.id = e.pointerId; drag.lastX = e.clientX; drag.lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    if (state.tool === 'finger' && !state.paused) {
      if (!fingerPtr || e.pointerType !== 'mouse') {
        const q = fingerAt(e.clientX, e.clientY);
        if (q) finger.aim = q;
        if (!finger.visible) finger.out = 1.6;
      }
      fingerPtr = { x: e.clientX, y: e.clientY };
      finger.want = IN; fingerPressed = true;
      drag.mode = 'finger';
      canvas.dataset.cursor = 'finger';
      e.preventDefault();
      return;
    }
    const ray = rayFrom(e.clientX, e.clientY);
    let hit = null, what = null;
    if (!state.paused) {
      const hb = pick(ray);
      const tb = hb ? Math.hypot(hb[0] - ray.o[0], hb[1] - ray.o[1], hb[2] - ray.o[2]) : Infinity;
      const tr = state.tool === 'hand' ? pickLeg(ray) : Infinity;
      if (tr < tb) { hit = [ray.o[0] + ray.d[0] * tr, ray.o[1] + ray.d[1] * tr, ray.o[2] + ray.d[2] * tr]; what = 'leg'; }
      else if (hb) { hit = hb; what = 'body'; }
      else if (state.tool === 'hand') { hit = pickNear(e.clientX, e.clientY, e.pointerType === 'touch' ? 34 : 18); what = hit ? 'body' : null; }
    }
    if (hit && state.tool === 'comb' && what === 'body') {
      drag.mode = 'comb'; drag.lastHit = hit;
      canvas.dataset.cursor = 'comb';
    } else if (hit && state.tool === 'hand') {
      drag.mode = 'grab'; drag.twist = 0; drag.what = what;
      drag.plane = { p: hit, n: cam.fwd.slice() };
      if (what === 'leg') { if (!legs.beginGrab(hit)) { drag.mode = 'orbit'; drag.what = null; } } else { sim.beginGrab(hit, 0.42); sim.rooted = false; if (gait.walking) stopWalk(); }
      canvas.dataset.cursor = 'grabbing';
    } else {
      drag.mode = 'orbit';
      canvas.dataset.cursor = 'orbit';
    }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', e => {
    quirk.ptr = { x: e.clientX, y: e.clientY, t: state.time };
    if (drag.second && e.pointerId === drag.second.id) {
      drag.second.x = e.clientX; drag.second.y = e.clientY;
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist0 + Math.atan2(drag.second.y - drag.lastY, drag.second.x - drag.lastX)));
      applyGrab(drag.lastX, drag.lastY);
      return;
    }
    if (drag.mode === 'pinch') {
      const P = drag.pinch;
      if (e.pointerId === P.a) P.pa = [e.clientX, e.clientY]; else if (e.pointerId === P.b) P.pb = [e.clientX, e.clientY]; else return;
      const d = Math.max(20, Math.hypot(P.pa[0] - P.pb[0], P.pa[1] - P.pb[1]));
      state.zoom = Math.max(0.45, Math.min(2.8, P.zoom0 * P.d0 / d));
      return;
    }
    if (state.tool === 'finger' && e.pointerType === 'mouse' && !drag.mode) {
      fingerPtr = { x: e.clientX, y: e.clientY };
      if (finger.want > IN) { finger.want = IN; if (!finger.visible) { const q = fingerAt(e.clientX, e.clientY); if (q) finger.aim = q; finger.out = 1.6; } }
    }
    if (e.pointerId !== drag.id || !drag.mode) { hoverX = e.clientX; hoverY = e.clientY; hoverDirty = true; return; }
    const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
    drag.lastX = e.clientX; drag.lastY = e.clientY;
    if (drag.mode === 'grab') applyGrab(e.clientX, e.clientY);
    else if (drag.mode === 'finger') fingerPtr = { x: e.clientX, y: e.clientY };
    else if (drag.mode === 'comb') {
      const hit = pick(rayFrom(e.clientX, e.clientY));
      if (hit) { if (drag.lastHit) brush(drag.lastHit, hit); drag.lastHit = hit; }
      else drag.lastHit = null;
    } else {
      state.az = state.az - dx * 0.006;
      state.el = Math.max(-0.35, Math.min(1.3, state.el + dy * 0.005));
    }
  });
  const endPointer = e => {
    if (drag.second && e.pointerId === drag.second.id) { drag.second = null; return; }
    if (drag.mode === 'pinch') {
      if (e.pointerId === drag.pinch.a || e.pointerId === drag.pinch.b) { drag.mode = null; drag.id = -1; drag.pinch = null; canvas.dataset.cursor = ''; }
      return;
    }
    if (e.pointerId !== drag.id) return;
    if (drag.mode === 'grab') { if (drag.what === 'leg') legs.endGrab(); else { sim.endGrab(); sim.postureYaw = headingOf(body.R); } }
    if (drag.mode === 'finger') {
      fingerPressed = false;
      if (e.pointerType !== 'mouse') { finger.want = AWAY; fingerPtr = null; }
    }
    drag.mode = null; drag.id = -1; drag.second = null; drag.lastHit = null; drag.what = null;
    canvas.dataset.cursor = state.tool === 'finger' ? 'finger' : '';
    hoverDirty = true;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  canvas.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && drag.mode !== 'finger') { fingerPtr = null; finger.want = AWAY; } });
  window.addEventListener('wheel', e => {
    if (drag.mode === 'grab' && drag.what === 'body') {
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      drag.twist = Math.max(-1.3, Math.min(1.3, drag.twist + d * 0.004));
      applyGrab(drag.lastX, drag.lastY);
    } else if (e.target === canvas) {
      e.preventDefault();
      state.zoom = Math.max(0.45, Math.min(2.8, state.zoom * Math.exp(e.deltaY * 0.001)));
    }
  }, { passive: false });
  canvas.addEventListener('dblclick', () => { if (state.tool !== 'finger') { state.az = 0.38; state.el = 0.26; state.zoom = 1; } });
  let hoverX = 0, hoverY = 0, hoverDirty = false;

  // ── UI ──
  const firm = $('#firmness'), tempo = $('#tempo'), furS = $('#furlen');
  const syncSliders = () => {
    sim.firmness = firm.value / 100; state.tempo = tempo.value / 100; legs.setWire(state.tempo);
    state.furLen = 0.035 + 0.09 * furS.value / 100;
    $('#firmnessOut').textContent = (firm.value / 100).toFixed(2);
    $('#tempoOut').textContent = (tempo.value / 100).toFixed(2);
    $('#furlenOut').textContent = (state.furLen * SCALE_CM * 10).toFixed(0) + ' mm';
    sim.wakeAll();
  };
  firm.value = Math.round(sim.firmness * 100); tempo.value = Math.round(state.tempo * 100); furS.value = Math.round((SHAPE.fur - 0.035) / 0.09 * 100);
  for (const s of [firm, tempo, furS]) s.addEventListener('input', syncSliders);
  syncSliders();

  $('#scuttle').addEventListener('click', wander);
  $('#snip').addEventListener('click', snip);
  $('#hide').addEventListener('click', hide);
  $('#wave').addEventListener('click', wave);
  $('#straighten').addEventListener('click', straighten);
  $('#smooth').addEventListener('click', smoothFur);
  function resetAll() {
    if (drag.mode === 'grab') { sim.endGrab(); legs.endGrab(); drag.mode = null; }
    towing = false; gait.walking = false; gait.goal = null; gait.swing = -1; gait.steps = 0; snips = 0;
    sim.reset(0); sim.accel = [0, 0, 0]; sim.setMuscles(0); sim.postureYaw = 0; sim.posture = 0.004;
    life.mode = 'sit'; life.t = 0; life.cool = 0; life.nextIdle = 7; peek[0] = peek[1] = 0;
    for (const p of POSES) { poseW[p] = p === 'sit' ? 1 : 0; poseWant[p] = poseW[p]; }
    bend.fill(0); legs.footW.fill(0); claw.a = [0.28, 0.28]; claw.want = [0.28, 0.28];
    updateEmbedded(); poseLegs(state.time); legs.setTargets(legT); legs.snap();
    smoothFur(); tip.fill(0); tipV.fill(0); acc = 0; dirty = true; quirkReset();
  }
  $('#reset').addEventListener('click', resetAll);
  const hint = $('#hintText');
  const HINTS = {
    hand: '<b>手</b>把它捏起来揉一揉、抛一抛，或者掰弯一条腿或爪——里面的铁丝会记住你留下的形状。拉得比它能到的更远，它就会跟着走。拖拽空白处可以换角度看。眼睛是松的：会跟着指针转，晃得狠了还会打旋。',
    finger: '<b>手指</b>把手指悬在桌面上方：它会横着爬过来，转身面对，伸出双爪轻轻捏一下。凑得太近，两只眼睛会对到一起。戳一下它的壳，它会躲起来。',
    comb: '<b>梳子</b>顺着绒毛梳过去，绒毛就伏下去；逆着梳颜色变深，顺着梳就发亮。「抚平绒毛」会把它恢复原样。',
  };
  function setTool(t) {
    state.tool = t;
    for (const b of document.querySelectorAll('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === t));
    document.body.dataset.tool = t;
    hint.innerHTML = HINTS[t];
    canvas.dataset.cursor = t === 'finger' ? 'finger' : '';
    if (t !== 'finger') { fingerPtr = null; finger.want = AWAY; fingerPressed = false; }
  }
  for (const b of document.querySelectorAll('.tool')) b.addEventListener('click', () => setTool(b.dataset.tool));
  setTool('hand');
  $('#slow').addEventListener('change', e => { state.slow = e.target.checked; });
  $('#mesh').addEventListener('change', e => { state.showMesh = e.target.checked; });
  const pauseBtn = $('#pause');
  pauseBtn.addEventListener('click', () => {
    state.paused = !state.paused;
    if (state.paused && drag.mode === 'grab') { sim.endGrab(); legs.endGrab(); drag.mode = null; }
    pauseBtn.textContent = state.paused ? '继续' : '暂停';
    pauseBtn.setAttribute('aria-pressed', String(state.paused));
    setStatus(state.paused ? '毛绒蟹 · 已暂停' : '毛绒蟹 · 运行中', state.paused ? 'paused' : 'live');
  });
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input, button, summary')) return;
    if (e.key === ' ') { e.preventDefault(); pauseBtn.click(); }
    if (e.key === 's' || e.key === 'S') $('#scuttle').click();
    if (e.key === 'n' || e.key === 'N') $('#snip').click();
    if (e.key === 'd' || e.key === 'D') $('#hide').click();
    if (e.key === 'v' || e.key === 'V') $('#wave').click();
    if (e.key === 'r' || e.key === 'R') $('#reset').click();
    if (e.key === 'c' || e.key === 'C') setTool(state.tool === 'comb' ? 'hand' : 'comb');
    if (e.key === 'f' || e.key === 'F') setTool(state.tool === 'finger' ? 'hand' : 'finger');
    if (e.key === 'h' || e.key === 'H') setTool('hand');
  });

  $('#nParticles').textContent = sim.n.toLocaleString('en');
  $('#nTets').textContent = sim.nT.toLocaleString('en');
  $('#nLeg').textContent = legs.n.toLocaleString('en');
  $('#nShells').textContent = String(renderer.shells);
  const massOut = $('#massOut'), volOut = $('#volOut'), stepOut = $('#stepOut'), snipOut = $('#snipOut');
  function updateReadouts() {
    const massG = world.skinVol * SCALE_CM ** 3 * DENSITY;
    massOut.textContent = massG.toFixed(0);
    volOut.textContent = (sim.volumeRatio() * 100).toFixed(1);
    stepOut.textContent = String(gait.steps);
    snipOut.textContent = String(snips);
  }

  // test hooks
  let held = false, pendingFrames = 0;
  // sprite bake: CAPTURE renders on alpha, BAKE hands the clock to the bake driver.
  // It is deliberately not state.paused — the crab's own wave/snip/wander refuse to start while paused.
  let CAPTURE = false, BAKE = false;
  window.__crab = { setQuality(q) { quality = q; lockQ = true; resize(); $('#nShells').textContent = String(renderer.shells); }, PALETTES, sim, legs, gait, life, poseW, bend, body, hips, state, cam, claw, peek, pick, pickLeg, rayFrom, renderer, setTool, setPalette, brush, smoothFur, wander, walkTo, snip, hide, wave, straighten, resetAll, finger, world, tubes,
    get snips() { return snips; },
    setFinger(x, y, z, pressed = true) { finger.aim = [x, y, z]; finger.want = IN; fingerPtr = null; fingerPressed = pressed; state.tool = 'finger'; },
    advance(sec) { for (let t = 0; t < sec - 1e-6; t += 1 / 60) { stepWorld(1 / 60); skin(); updateFur(1 / 60, true); state.time += 1 / 60; followScene(1 / 60); } updateLegMesh(); updateCamera(); dirty = true; },
    quirk, gaze, pup, startDizzy, hold(on = true) { held = on; }, run(n = 1) { pendingFrames += n; }, readouts() { updateReadouts(); },
    get fps() { return fps; }, get stepMs() { return stepMs; },
    // ── sprite bake ──
    bake(on = true) { BAKE = !!on; CAPTURE = !!on; state.showMesh = false; },
    captureFrame() { return renderer.capture(); },
    resizeNow() { resize(); } };
  const qs = new URLSearchParams(location.search);
  if (qs.has('hold')) held = true;
  if (qs.has('q')) window.__crab.setQuality(+qs.get('q'));

  // ── desktop-pet plumbing: the host page owns the theme and says when to stop drawing ──
  // a hidden tab costs nothing, whatever mode we are in
  if (petMode || freeMode) {
    document.addEventListener('visibilitychange', () => window.__crab.hold(document.hidden));
  }
  if (petMode) {
    let asleep = false;
    const sleep = on => {
      if (asleep === on) return;
      asleep = on;
      window.__crab.hold(on);   // freeze the solver; nothing is drawn while it is held
    };
    window.addEventListener('message', e => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (d.type === 'pet:theme') window.__crabSetTheme(d.bg, d.dark);
      else if (d.type === 'pet:active') sleep(!d.on);
    });
    // a hidden tab stops drawing too, so a background blog post costs nothing
    document.addEventListener('visibilitychange', () => sleep(document.hidden));
    window.parent.postMessage({ type: 'pet:ready' }, '*');
  }

  // ── loop ──
  let last = performance.now(), fpsStart = last, acc = 0, readoutT = 0, fps = 60, frames = 0, fpsT = 0, first = true, stepMs = 0;
  // let it settle onto the table before anyone sees it
  for (let i = 0; i < 50; i++) stepWorld(1 / 60);
  restLow = sim.minY();
  updateLegMesh();
  function frame(now) {
    if (renderer.lost) return;
    requestAnimationFrame(frame);
    if (held && pendingFrames <= 0) { last = now; return; }
    if (held) pendingFrames--;
    const dt = held ? 1 / 60 : Math.min((now - last) / 1000, 0.1);
    last = now;
    const sdt = state.paused || BAKE ? 0 : dt * (state.slow ? 0.25 : 1);
    let steps = 0;
    if (!state.paused && !BAKE && !held) {
      acc += sdt;
      const ts = performance.now();
      while (acc >= sim.stepDt && steps < 2) { stepWorld(sim.stepDt); acc -= sim.stepDt; steps++; }
      if (steps === 2) acc = Math.min(acc, sim.stepDt);
      if (steps) stepMs = stepMs * 0.9 + (performance.now() - ts) / steps * 0.1;
      state.time += sdt;
    } else updateFinger(0);
    const moved = skin();
    updateFur(held ? 0 : sdt, moved);
    if (steps || first) updateLegMesh();
    followScene(dt);
    updateCamera();
    updateLight();
    if (hoverDirty && !drag.mode && state.tool !== 'finger') {
      hoverDirty = false;
      const r = rayFrom(hoverX, hoverY);
      canvas.dataset.cursor = !state.paused && (pick(r) || (state.tool === 'hand' && pickLeg(r) < Infinity)) ? (state.tool === 'comb' ? 'comb' : 'grab') : '';
    }
    renderer.setUniforms(cam, light, PALETTES[currentPalette], {
      time: state.time, furLen: state.furLen, strand: STRAND,
      cheek: cheekNow(PALETTES[currentPalette]), eyes: [pup[0].o[0], pup[0].o[1], pup[1].o[0], pup[1].o[1]], quirk: [quirk.dizzy, quirk.spin % 1, quirk.blush, 0],
      smile: [SMILE.y0, SMILE.lift, SMILE.half, 0], skin: SKIN, finger: [finger.x, finger.y, finger.z, 0.1],
      maps: [light.half, light.topHalf, light.range, cam.dist],
      exposure: 1.0, meshAlpha: state.showMesh ? 0.32 : 0, bg: BG_RENDER, floorY: 0, page: CAPTURE ? [2, 0, 0, 0] : PET_FIELD,
    });
    renderer.uploadGeometry(sim.x, state.showMesh, moved || first);
    renderer.draw(state.showMesh);
    if (first) { first = false; setStatus('毛绒蟹 · 运行中', 'live'); document.body.classList.add('ready'); }
    readoutT += dt; frames++; fpsT += dt;
    if (fpsT > 0.5) { fps = frames / ((now - fpsStart) / 1000); frames = 0; fpsT = 0; fpsStart = now; }
    if (readoutT > 0.2) { readoutT = 0; updateReadouts(); }
    if (!first && !held) adaptQuality(dt);
  }
  requestAnimationFrame(frame);

}

main().catch(err => { console.error(err); showFallback('Something went wrong while starting.', String(err && err.message || err)); });
