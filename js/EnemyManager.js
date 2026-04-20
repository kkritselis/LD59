/**
 * EnemyManager
 *
 * Builds a flow field over the terrain heightmap using Dijkstra from the base
 * (UV 0.5, 0.5), then spawns and moves enemies through it each frame.
 *
 * All positions are stored in heightmap UV space (0–1) so they remain correct
 * as the terrain offset changes.  World position is derived each frame via:
 *   worldX = (uvx - 0.5) * uScale - offset.x
 *   worldZ = -(uvy - 0.5) * uScale + offset.y
 */

import * as THREE from 'three';
import { sampleHeight, WATER_LEVEL } from './terrain.js';

// ── Tunables ────────────────────────────────────────────────────────────────

const GRID         = 96;   // flow field resolution (higher = better paths, slower build)
const STEEP_BLOCK  = 1.0;  // world-slope magnitude above which terrain is impassable
const HIGH_ALT     = 0.525; // UV height above which the air is too thin (blocks enemies)
const ENEMY_SPEED  = 0.02; // UV units / second on flat terrain
const CONTACT_DIST = 0.025; // UV distance from base centre to trigger a hit
const SPAWN_RADIUS = 0.44;  // UV units from base centre for the spawn ring

// ── MinHeap (for Dijkstra) ─────────────────────────────────────────────────

class MinHeap {
  constructor() { this._h = []; }

  push(cost, x, y) {
    this._h.push([cost, x, y]);
    let i = this._h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._h[p][0] <= this._h[i][0]) break;
      [this._h[p], this._h[i]] = [this._h[i], this._h[p]];
      i = p;
    }
  }

  pop() {
    const top  = this._h[0];
    const last = this._h.pop();
    if (this._h.length > 0) {
      this._h[0] = last;
      let i = 0;
      for (;;) {
        let m = i, l = 2*i+1, r = 2*i+2;
        if (l < this._h.length && this._h[l][0] < this._h[m][0]) m = l;
        if (r < this._h.length && this._h[r][0] < this._h[m][0]) m = r;
        if (m === i) break;
        [this._h[m], this._h[i]] = [this._h[i], this._h[m]];
        i = m;
      }
    }
    return top;
  }

  get size() { return this._h.length; }
}

// ── EnemyManager ──────────────────────────────────────────────────────────

export class EnemyManager {
  /**
   * @param {THREE.Scene} scene
   * @param {number} heightScale  uScale uniform value (world units per UV unit)
   * @param {number} uScale       terrain plane scale
   */
  constructor(scene, heightScale, uScale) {
    this._scene       = scene;
    this._heightScale = heightScale;
    this._uScale      = uScale;
    this._enemies     = [];
    this._field       = null;

    // Shared geometry — all enemies reference the same buffers (25% of original size)
    const geo = new THREE.ConeGeometry(0.015, 0.04, 6);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(Math.PI)); // tip downward
    this._geo = geo;
    this._mat = new THREE.MeshPhongMaterial({
      color:    0xff2200,
      emissive: 0x440000,
      shininess: 60,
    });

    this._buildField();
  }

  // ── Flow field construction ──────────────────────────────────────────────

  _buildField() {
    const G  = GRID;
    const HS = this._heightScale;
    const US = this._uScale;
    const t0 = performance.now();

    // Step 1: cache all height samples (avoids re-sampling neighbours)
    const heights = new Float32Array(G * G);
    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        heights[gy * G + gx] = sampleHeight(gx / (G - 1), gy / (G - 1));
      }
    }

    // Step 2: compute steepness and mark blocked cells
    // Slope = world height change / world horizontal distance (dimensionless)
    const uvStep  = 1 / (G - 1);
    const wStep   = uvStep * US;          // world distance per grid step
    const steep   = new Float32Array(G * G);
    const blocked = new Uint8Array(G * G);

    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const h  = heights[gy * G + gx];
        const hR = heights[gy * G + Math.min(G - 1, gx + 1)];
        const hU = heights[Math.min(G - 1, gy + 1) * G + gx];
        const sx = (hR - h) * HS / wStep;
        const sy = (hU - h) * HS / wStep;
        const s  = Math.sqrt(sx * sx + sy * sy);
        steep[gy * G + gx]   = s;
        blocked[gy * G + gx] = (h < WATER_LEVEL || s > STEEP_BLOCK || h > HIGH_ALT) ? 1 : 0;
      }
    }

    // Step 3: Dijkstra outward from base cell (UV 0.5, 0.5)
    const bx = Math.round((G - 1) * 0.5);
    const by = Math.round((G - 1) * 0.5);

    const dist = new Float32Array(G * G).fill(Infinity);
    const fdx  = new Float32Array(G * G);   // UV-space direction X toward base
    const fdy  = new Float32Array(G * G);   // UV-space direction Y toward base
    const fspd = new Float32Array(G * G);   // speed multiplier (0–1)

    dist[by * G + bx] = 0;
    fspd[by * G + bx] = 1;

    const heap = new MinHeap();
    heap.push(0, bx, by);

    // 8-directional neighbours: [dx, dy, base travel cost]
    const DIRS = [
      [-1,  0, 1], [1,  0, 1], [0, -1, 1], [0,  1, 1],
      [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2],
      [-1,  1, Math.SQRT2], [1,  1, Math.SQRT2],
    ];

    while (heap.size > 0) {
      const [cost, cx, cy] = heap.pop();
      const idx = cy * G + cx;
      if (cost > dist[idx]) continue;       // stale entry

      for (const [ndx, ndy, base] of DIRS) {
        const nx = cx + ndx, ny = cy + ndy;
        if (nx < 0 || nx >= G || ny < 0 || ny >= G) continue;
        const ni = ny * G + nx;
        if (blocked[ni]) continue;

        // Higher steepness → higher travel cost
        const nd = cost + base * (1 + steep[ni] * 2);
        if (nd < dist[ni]) {
          dist[ni] = nd;
          const len = Math.sqrt(ndx * ndx + ndy * ndy);
          // Direction: from this cell TOWARD the base = opposite of propagation step
          fdx[ni]  = -ndx / len;
          fdy[ni]  = -ndy / len;
          fspd[ni] = 1 / (1 + steep[ni] * 3);
          heap.push(nd, nx, ny);
        }
      }
    }

    this._field = { G, dist, fdx, fdy, fspd, blocked };
    console.log(`[EnemyManager] Flow field (${G}×${G}) built in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** Look up flow field at a UV position. */
  _sample(uvx, uvy) {
    const { G, dist, fdx, fdy, fspd, blocked } = this._field;
    const gx = Math.max(0, Math.min(G - 1, Math.round(uvx * (G - 1))));
    const gy = Math.max(0, Math.min(G - 1, Math.round(uvy * (G - 1))));
    const i  = gy * G + gx;
    return { dirX: fdx[i], dirY: fdy[i], spd: fspd[i], blocked: blocked[i] === 1, dist: dist[i] };
  }

  // ── Spawning ─────────────────────────────────────────────────────────────

  /**
   * Spawn `count` enemies on the ring around the base.
   * @param {number} count
   */
  spawnWave(count) {
    for (let i = 0; i < count; i++) this._spawnOne();
  }

  _spawnOne() {
    // Pick a random cell on one of the four UV border edges (= terrain perimeter).
    // Try up to 60 positions; skip blocked or Dijkstra-unreachable cells.
    const { G, blocked, dist } = this._field;
    for (let attempt = 0; attempt < 60; attempt++) {
      let gx, gy;
      switch (Math.floor(Math.random() * 4)) {
        case 0: gx = Math.floor(Math.random() * G); gy = 0;       break; // top edge
        case 1: gx = Math.floor(Math.random() * G); gy = G - 1;   break; // bottom edge
        case 2: gx = 0;       gy = Math.floor(Math.random() * G); break; // left edge
        default: gx = G - 1;  gy = Math.floor(Math.random() * G); break; // right edge
      }
      const fi = gy * G + gx;
      if (blocked[fi] || !isFinite(dist[fi])) continue;

      const mesh = new THREE.Mesh(this._geo, this._mat);
      this._scene.add(mesh);
      this._enemies.push({ mesh, uvx: gx / (G - 1), uvy: gy / (G - 1) });
      return;
    }
  }

  // ── Per-frame update ─────────────────────────────────────────────────────

  /**
   * Move all enemies, update world positions, check base contact.
   * @param {number}          delta
   * @param {THREE.Vector2}   off     current terrain offset
   * @returns {number}  damage dealt to base this frame
   */
  update(delta, off) {
    const US = this._uScale;
    const HS = this._heightScale;
    const dead = [];
    let damage = 0;

    for (const e of this._enemies) {
      const f = this._sample(e.uvx, e.uvy);

      // Move in UV space using flow direction and terrain-adjusted speed
      if (!f.blocked && isFinite(f.dist) && f.dist > 0) {
        const spd = ENEMY_SPEED * Math.max(0.05, f.spd);
        e.uvx = Math.max(0, Math.min(1, e.uvx + f.dirX * spd * delta));
        e.uvy = Math.max(0, Math.min(1, e.uvy + f.dirY * spd * delta));
      }

      // Derive world position from UV + current terrain offset
      // worldX = (uvx - 0.5) * uScale - offset.x
      // worldZ = -(uvy - 0.5) * uScale + offset.y
      const wx = (e.uvx - 0.5) * US - off.x;
      const wz = -(e.uvy - 0.5) * US + off.y;
      e.mesh.position.set(wx, sampleHeight(e.uvx, e.uvy) * HS + 0.1, wz);
      e.mesh.rotation.y += delta * 1.5;   // slow spin for visual interest

      // Hide enemies that have scrolled beyond the terrain tile boundary
      const HALF = US * 0.5;
      e.mesh.visible = Math.abs(wx) < HALF && Math.abs(wz) < HALF;

      // Check distance to base in UV space
      const du = e.uvx - 0.5, dv = e.uvy - 0.5;
      if (du * du + dv * dv < CONTACT_DIST * CONTACT_DIST) {
        damage++;
        dead.push(e);
      }
    }

    if (dead.length > 0) {
      const deadSet = new Set(dead);
      for (const e of dead) this._scene.remove(e.mesh);
      this._enemies = this._enemies.filter(e => !deadSet.has(e));
    }

    return damage;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /** Remove a specific enemy (e.g. killed by player). */
  kill(enemy) {
    this._scene.remove(enemy.mesh);
    this._enemies = this._enemies.filter(e => e !== enemy);
  }

  /** Remove all enemies from the scene. */
  removeAll() {
    for (const e of this._enemies) this._scene.remove(e.mesh);
    this._enemies = [];
  }

  // ── Flow field visualiser ────────────────────────────────────────────────

  /**
   * Render the flow field + live state to a 2D canvas.
   * Call each frame when the overlay is visible.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {number} shipUVX   ship's current heightmap UV x (0–1)
   * @param {number} shipUVY   ship's current heightmap UV y (0–1)
   */
  drawToCanvas(canvas, shipUVX, shipUVY) {
    const { G, dist, fdx, fdy, blocked } = this._field;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    // Find max finite distance for normalization
    let maxDist = 0;
    for (let i = 0; i < G * G; i++) {
      if (isFinite(dist[i]) && dist[i] > maxDist) maxDist = dist[i];
    }

    // Draw cells as a heatmap using ImageData (fast pixel fill)
    const img = ctx.createImageData(W, H);
    const d   = img.data;

    for (let gy = 0; gy < G; gy++) {
      for (let gx = 0; gx < G; gx++) {
        const fi  = gy * G + gx;
        const blk = blocked[fi];
        const dst = dist[fi];

        let r, g, b;
        if (blk) {
          r = 12; g = 6; b = 28;      // blocked — near-black purple
        } else if (!isFinite(dst)) {
          r = 35; g = 35; b = 35;     // unreachable island — dark grey
        } else {
          const t = dst / maxDist;    // 0 = at base, 1 = far edge
          // Green (close) → amber → red (far)
          r = Math.round(40  + t * 200);
          g = Math.round(180 - t * 160);
          b = 20;
        }

        // Map grid cell → pixel rect (Y flipped so UV top = canvas top of world view)
        const fgy  = G - 1 - gy;
        const px0 = Math.round(gx  * W / G);
        const px1 = Math.round((gx + 1) * W / G);
        const py0 = Math.round(fgy * H / G);
        const py1 = Math.round((fgy + 1) * H / G);

        for (let py = py0; py < py1; py++) {
          for (let px = px0; px < px1; px++) {
            const di = (py * W + px) * 4;
            d[di] = r; d[di + 1] = g; d[di + 2] = b; d[di + 3] = 210;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);

    // Flow direction arrows (every 6th cell)
    const STEP = 6;
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    for (let gy = STEP >> 1; gy < G; gy += STEP) {
      for (let gx = STEP >> 1; gx < G; gx += STEP) {
        const fi = gy * G + gx;
        if (blocked[fi] || !isFinite(dist[fi]) || dist[fi] === 0) continue;
        const fgy = G - 1 - gy;
        const cx = (gx + 0.5) * W / G;
        const cy = (fgy + 0.5) * H / G;
        const ax =  fdx[fi] * (W / G) * STEP * 0.38;
        const ay = -fdy[fi] * (H / G) * STEP * 0.38;  // negate: Y flipped
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + ax, cy + ay);
        ctx.stroke();
      }
    }

    // Enemy dots (Y flipped)
    ctx.fillStyle = '#ff3300';
    for (const e of this._enemies) {
      ctx.beginPath();
      ctx.arc(e.uvx * W, (1 - e.uvy) * H, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Ship position (white, Y flipped)
    if (shipUVX !== undefined) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(shipUVX * W, (1 - shipUVY) * H, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Base marker (gold)
    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.5, 5, 0, Math.PI * 2);
    ctx.fill();

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font      = '9px monospace';
    ctx.fillText('[F] toggle radar', 4, H - 4);
  }

  /** Full teardown — call when the game session ends. */
  dispose() {
    this.removeAll();
    this._geo.dispose();
    this._mat.dispose();
  }

  get enemies() { return this._enemies; }
  get count()   { return this._enemies.length; }
}
