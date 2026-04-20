/**
 * terrain.js
 *
 * CPU-side mirror of the GLSL heightmap shader.
 * Imported by GameScreen (cross-section geometry) and EnemyManager (flow field).
 * Keep in sync with shaders/terrain.vert.js — same noise params.
 */

function _fract(x) { return x - Math.floor(x); }

function _hash2(x0, x1) {
  const k0 = 0.3183099, k1 = 0.3678794;
  const ax = x0 * k0 + k1;
  const ay = x1 * k1 + k0;
  const fp = _fract(ax * ay * (ax + ay));
  return [
    -1 + 2 * _fract(16 * k0 * fp),
    -1 + 2 * _fract(16 * k1 * fp),
  ];
}

function _noised(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix,         fy = py - iy;
  const ux  = fx*fx*fx*(fx*(fx*6 - 15) + 10);
  const uy  = fy*fy*fy*(fy*(fy*6 - 15) + 10);
  const dux = 30*fx*fx*(fx*(fx - 2) + 1);
  const duy = 30*fy*fy*(fy*(fy - 2) + 1);
  const ga = _hash2(ix,   iy);
  const gb = _hash2(ix+1, iy);
  const gc = _hash2(ix,   iy+1);
  const gd = _hash2(ix+1, iy+1);
  const va = ga[0]*fx     + ga[1]*fy;
  const vb = gb[0]*(fx-1) + gb[1]*fy;
  const vc = gc[0]*fx     + gc[1]*(fy-1);
  const vd = gd[0]*(fx-1) + gd[1]*(fy-1);
  const val = va + ux*(vb-va) + uy*(vc-va) + ux*uy*(va-vb-vc+vd);
  const dvx = ga[0] + ux*(gb[0]-ga[0]) + uy*(gc[0]-ga[0]) + ux*uy*(ga[0]-gb[0]-gc[0]+gd[0])
            + dux*(uy*(va-vb-vc+vd) + (vb-va));
  const dvy = ga[1] + ux*(gb[1]-ga[1]) + uy*(gc[1]-ga[1]) + ux*uy*(ga[1]-gb[1]-gc[1]+gd[1])
            + duy*(ux*(va-vb-vc+vd) + (vc-va));
  return [val, dvx, dvy];
}

function _erosionVal(px, py, dx, dy, hBranchX, hBranchY) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = px - ix,         fy = py - iy;
  const TAU = 2 * Math.PI;
  const dirX = dx + hBranchX, dirY = dy + hBranchY;
  let vx = 0, vy = 0, vz = 0, wt = 0;
  for (let i = -2; i <= 1; i++) {
    for (let j = -2; j <= 1; j++) {
      const h   = _hash2(ix - i, iy - j);
      const ppx = fx + i - h[0] * 0.5;
      const ppy = fy + j - h[1] * 0.5;
      const d   = ppx*ppx + ppy*ppy;
      const w   = Math.exp(-d * 2);
      wt += w;
      const mag  = ppx * dirX + ppy * dirY;
      const cosm = Math.cos(mag * TAU);
      const sinm = Math.sin(mag * TAU);
      vx += cosm * w;
      vy += (-sinm * dirX) * w;
      vz += (-sinm * dirY) * w;
    }
  }
  return [vx/wt, vy/wt, vz/wt];
}

/**
 * Sample the terrain height at UV coordinate (0–1).
 * Returns a value in roughly [0, 1]. Multiply by heightScale for world Y.
 * @param {number} uvx
 * @param {number} uvy
 * @returns {number}
 */
export function sampleHeight(uvx, uvy) {
  const HT = 3.0, HA = 0.25, HG = 0.1, HL = 2.0;
  const ET = 4.0, EG = 0.5,  EL = 2.0, ES = 0.04;
  const ESS = 3.0, EBS = 3.0;
  const WATER = 0.45;
  const px = uvx * HT, py = uvy * HT;

  let nVal = 0, nDx = 0, nDy = 0, nf = 1, na = HA;
  for (let i = 0; i < 3; i++) {
    const nd = _noised(px * nf, py * nf);
    nVal += nd[0] * na;
    nDx  += nd[1] * na * nf;
    nDy  += nd[2] * na * nf;
    na *= HG; nf *= HL;
  }
  nVal = nVal * 0.5 + 0.5;
  const slopeDirX = nDy * ESS;
  const slopeDirY = -nDx * ESS;

  const e0 = WATER - 0.1, e1 = WATER + 0.2;
  const tt = Math.max(0, Math.min(1, (nVal - e0) / (e1 - e0)));
  let a = 0.5 * tt * tt * (3 - 2 * tt);

  let hVal = 0, hDy = 0, hDz = 0, fq = 1;
  for (let i = 0; i < 5; i++) {
    const e = _erosionVal(px * ET * fq, py * ET * fq, slopeDirX, slopeDirY, hDz * EBS, -hDy * EBS);
    hVal += e[0] * a;
    hDy  += e[1] * a * fq;
    hDz  += e[2] * a * fq;
    a *= EG; fq *= EL;
  }
  return nVal + (hVal - 0.5) * ES;
}

/** Water level threshold — UV height values below this are treated as impassable. */
export const WATER_LEVEL = 0.45;
