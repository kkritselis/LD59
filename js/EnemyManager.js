/**
 * EnemyManager
 *
 * Builds a flow field over the terrain heightmap using Dijkstra from the base
 * (UV 0.5, 0.5), then spawns and moves enemies through it each frame.
 *
 * Positions are stored in heightmap UV space (often within ~0–1 for the play tile;
 * flow field sampling spans a wider UV window). World position is derived each frame via:
 *   worldX = (uvx - 0.5) * uScale - offset.x
 *   worldZ = -(uvy - 0.5) * uScale + offset.y
 */

import * as THREE from 'three';
import { GLTFLoader } from './jsm/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from './jsm/utils/SkeletonUtils.js';
import { sampleHeight, WATER_LEVEL } from './terrain.js';

// ── Tunables ────────────────────────────────────────────────────────────────

/** UV domain area vs a 1×1 tile; linear span per axis = sqrt(this). Doubled vs original 4× (now 16× area). */
const FLOW_FIELD_AREA_MULT = 16;
const FLOW_UV_AXIS         = Math.sqrt(FLOW_FIELD_AREA_MULT);
/** Flow field is built on this UV range (extends past [0,1] so paths use more terrain). */
export const FLOW_UV_MIN = 0.5 - 0.5 * FLOW_UV_AXIS;
export const FLOW_UV_MAX = 0.5 + 0.5 * FLOW_UV_AXIS;
const FLOW_UV_SPAN       = FLOW_UV_MAX - FLOW_UV_MIN;

/** Grid size — scale with domain so UV step stays similar to the old 96×96 on 0–1. */
const GRID = Math.max(96, Math.round(96 * FLOW_UV_AXIS));

const STEEP_BLOCK  = 1.0;  // world-slope magnitude above which terrain is impassable
const HIGH_ALT     = 0.525; // UV height above which the air is too thin (blocks enemies)
const ENEMY_SPEED  = 0.02; // UV units / second on flat terrain (small tier baseline)
const CONTACT_DIST = 0.025; // UV distance from base centre to trigger a hit (small tier baseline)
const ENEMY_MODEL_PATH = 'assets/obj/spider.glb';
const ENEMY_TARGET_HEIGHT = 0.04;

/** Mesh scale vs small (small = 1). */
const ENEMY_TIER_SCALE = { small: 1, medium: 2, large: 4 };
/** Move speed vs small (small = 1; medium half; large quarter of small). */
const ENEMY_TIER_SPEED = { small: 1, medium: 0.5, large: 0.25 };

function _rollEnemyTier() {
  const r = Math.random();
  if (r < 0.75) return 'small';
  if (r < 0.95) return 'medium';
  return 'large';
}
const ENEMY_DEATH_SECONDS = 0.7;
/** Added to atan2 facing if the GLB’s forward axis is not +world Z (try `Math.PI` if it runs backward). */
const ENEMY_FACING_YAW_OFFSET = 0;

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
    this._enemyModelTemplate = null;
    this._enemyModelClips = [];
    /** @type {THREE.AnimationClip|null} */
    this._clipWalk = null;
    /** @type {THREE.AnimationClip|null} */
    this._clipAttack = null;
    /** @type {THREE.AnimationClip|null} */
    this._clipDeath = null;
    this._enemyModelScale = 1;
    this._modelLoadFailed = false;
    /** @type {{ count: number, options: { scatter?: boolean } }[]} */
    this._pendingSpawns = [];

    this._buildField();
    this._loadEnemyModel();
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
        const uvx = FLOW_UV_MIN + (gx / (G - 1)) * FLOW_UV_SPAN;
        const uvy = FLOW_UV_MIN + (gy / (G - 1)) * FLOW_UV_SPAN;
        heights[gy * G + gx] = sampleHeight(uvx, uvy);
      }
    }

    // Step 2: compute steepness and mark blocked cells
    // Slope = world height change / world horizontal distance (dimensionless)
    const uvStep  = FLOW_UV_SPAN / (G - 1);
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
    const bx = Math.round(((0.5 - FLOW_UV_MIN) / FLOW_UV_SPAN) * (G - 1));
    const by = Math.round(((0.5 - FLOW_UV_MIN) / FLOW_UV_SPAN) * (G - 1));

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

    this._field = { G, dist, fdx, fdy, fspd, blocked, uvSpan: FLOW_UV_SPAN };
    console.log(`[EnemyManager] Flow field (${G}×${G}, UV span ${FLOW_UV_SPAN.toFixed(3)}) built in ${(performance.now() - t0).toFixed(0)} ms`);
  }

  /** Look up flow field at a UV position. */
  _sample(uvx, uvy) {
    const { G, dist, fdx, fdy, fspd, blocked, uvSpan } = this._field;
    const span = uvSpan ?? 1;
    const gx = Math.max(0, Math.min(G - 1, Math.round(((uvx - FLOW_UV_MIN) / span) * (G - 1))));
    const gy = Math.max(0, Math.min(G - 1, Math.round(((uvy - FLOW_UV_MIN) / span) * (G - 1))));
    const i  = gy * G + gx;
    return { dirX: fdx[i], dirY: fdy[i], spd: fspd[i], blocked: blocked[i] === 1, dist: dist[i] };
  }

  // ── Spawning ─────────────────────────────────────────────────────────────

  _loadEnemyModel() {
    const loader = new GLTFLoader();
    loader.load(
      ENEMY_MODEL_PATH,
      (gltf) => {
        const root = gltf?.scene;
        if (!root) return;
        root.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(root);
        const h = box.max.y - box.min.y;
        this._enemyModelScale = h > 1e-6 ? (ENEMY_TARGET_HEIGHT / h) : 1;
        this._enemyModelTemplate = root;
        this._enemyModelClips = Array.isArray(gltf.animations) ? gltf.animations : [];
        this._clipAttack = this._findClip(/attack|bite|hit|strike/i);
        this._clipDeath = this._findClip(/death|die|dead|destroy|defeat/i);
        this._clipWalk = this._resolveWalkClip();

        const list = this._enemyModelClips.map((c, i) => {
          const n = (c?.name ?? '').trim();
          return n || `unnamed_${i}`;
        });
        console.log(`[EnemyManager] Enemy clips: ${list.join(', ')}`);
        console.log(`[EnemyManager] Selected clips -> walk: ${this._clipWalk?.name || 'unnamed'}, attack: ${this._clipAttack?.name || 'none'}, death: ${this._clipDeath?.name || 'none'}`);
        console.log(`[EnemyManager] Enemy model loaded (${this._enemyModelClips.length} clips): ${ENEMY_MODEL_PATH}`);

        const pending = this._pendingSpawns.splice(0);
        for (const job of pending) {
          this.spawnWave(job.count, job.options);
        }
      },
      undefined,
      (err) => {
        this._modelLoadFailed = true;
        this._pendingSpawns.length = 0;
        console.error('[EnemyManager] spider.glb load failed; enemies will not spawn.', err);
      },
    );
  }

  /** @param {RegExp} regex */
  _findClip(regex) {
    return this._enemyModelClips.find((clip) => regex.test(clip?.name ?? '')) ?? null;
  }

  /** Walk clip: name match, else first clip that is not attack/death (by reference). */
  _resolveWalkClip() {
    const direct = this._findClip(/walk|run|move|locomotion|idle|crawl|stride/i);
    if (direct) return direct;

    for (const clip of this._enemyModelClips) {
      if (clip === this._clipAttack || clip === this._clipDeath) continue;
      return clip;
    }
    return null;
  }

  _makeEnemyInstance(uvx, uvy) {
    if (!this._enemyModelTemplate) return;

    const tier = _rollEnemyTier();
    const tierScale = ENEMY_TIER_SCALE[tier];
    const speedMul = ENEMY_TIER_SPEED[tier];

    const mesh = cloneSkeleton(this._enemyModelTemplate);
    mesh.scale.setScalar(this._enemyModelScale * tierScale);
    mesh.traverse((node) => {
      if (node.isMesh) {
        node.castShadow = false;
        node.receiveShadow = false;
      }
    });

    let mixer = null;
    if (this._enemyModelClips.length > 0) {
      mixer = new THREE.AnimationMixer(mesh);
      mixer.timeScale = speedMul;
    }

    this._scene.add(mesh);
    const enemy = {
      mesh,
      uvx,
      uvy,
      tier,
      tierScale,
      speedMul,
      mixer,
      currentClip: null,
      dying: false,
      deathTimer: 0,
    };
    this._playClip(enemy, this._clipWalk, false);
    this._enemies.push(enemy);
  }

  /**
   * @param {{ mixer: THREE.AnimationMixer|null, currentClip: THREE.AnimationClip|null }} enemy
   * @param {THREE.AnimationClip|null} clip
   * @param {boolean} once
   */
  _playClip(enemy, clip, once) {
    if (!enemy?.mixer || !clip) return;
    if (!once && enemy.currentClip === clip) return;

    const next = enemy.mixer.clipAction(clip);
    if (enemy.currentClip) {
      const prev = enemy.mixer.clipAction(enemy.currentClip);
      prev.fadeOut(0.15);
    }
    next.reset();
    next.enabled = true;
    if (once) {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    } else {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    }
    next.fadeIn(0.12);
    next.play();
    if (!once) enemy.currentClip = clip;
  }

  _removeEnemyInstance(enemy) {
    this._scene.remove(enemy.mesh);
    this._enemies = this._enemies.filter(e => e !== enemy);
  }

  /**
   * Spawn `count` enemies on the ring around the base.
   * @param {number} count
   * @param {{ scatter?: boolean }} [options]
   */
  spawnWave(count, options = {}) {
    if (!this._enemyModelTemplate) {
      if (!this._modelLoadFailed) {
        this._pendingSpawns.push({ count, options });
      }
      return;
    }
    const scatter = options.scatter === true;
    for (let i = 0; i < count; i++) {
      if (scatter) this._spawnOneScattered();
      else this._spawnOne();
    }
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

      const uvx = FLOW_UV_MIN + (gx / (G - 1)) * FLOW_UV_SPAN;
      const uvy = FLOW_UV_MIN + (gy / (G - 1)) * FLOW_UV_SPAN;
      this._makeEnemyInstance(uvx, uvy);
      return;
    }
  }

  _spawnOneScattered() {
    // Pick a random cell anywhere in the flow-field domain.
    // Try up to 80 positions; skip blocked or Dijkstra-unreachable cells.
    const { G, blocked, dist } = this._field;
    for (let attempt = 0; attempt < 80; attempt++) {
      const gx = Math.floor(Math.random() * G);
      const gy = Math.floor(Math.random() * G);
      const fi = gy * G + gx;
      if (blocked[fi] || !isFinite(dist[fi])) continue;

      const uvx = FLOW_UV_MIN + (gx / (G - 1)) * FLOW_UV_SPAN;
      const uvy = FLOW_UV_MIN + (gy / (G - 1)) * FLOW_UV_SPAN;
      this._makeEnemyInstance(uvx, uvy);
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
      if (e.mixer) e.mixer.update(delta);
      if (e.dying) {
        e.deathTimer -= delta;
        if (e.deathTimer <= 0) dead.push(e);
      }

      const f = this._sample(e.uvx, e.uvy);
      const canMove = !e.dying && !f.blocked && isFinite(f.dist) && f.dist > 0;

      // Move in UV space using flow direction and terrain-adjusted speed
      if (canMove) {
        const spd = ENEMY_SPEED * e.speedMul * Math.max(0.05, f.spd);
        const lo = FLOW_UV_MIN + 1e-6;
        const hi = FLOW_UV_MAX - 1e-6;
        e.uvx = Math.max(lo, Math.min(hi, e.uvx + f.dirX * spd * delta));
        e.uvy = Math.max(lo, Math.min(hi, e.uvy + f.dirY * spd * delta));
      }

      // Derive world position from UV + current terrain offset
      // worldX = (uvx - 0.5) * uScale - offset.x
      // worldZ = -(uvy - 0.5) * uScale + offset.y
      const wx = (e.uvx - 0.5) * US - off.x;
      const wz = -(e.uvy - 0.5) * US + off.y;
      e.mesh.position.set(wx, sampleHeight(e.uvx, e.uvy) * HS + 0.045, wz);

      // Face world travel direction: UV flow (dirX, dirY) -> world xz velocity ~(dirX, -dirY).
      if (canMove) {
        const sq = f.dirX * f.dirX + f.dirY * f.dirY;
        if (sq > 1e-16) {
          e.mesh.rotation.y = Math.atan2(f.dirX, -f.dirY) + ENEMY_FACING_YAW_OFFSET;
        }
      }

      // Hide enemies that have scrolled beyond the terrain tile boundary
      const HALF = US * 0.5;
      e.mesh.visible = Math.abs(wx) < HALF && Math.abs(wz) < HALF;

      // Check distance to base in UV space (contact radius grows with tier)
      const contactR = CONTACT_DIST * e.tierScale;
      const contactR2 = contactR * contactR;
      const du = e.uvx - 0.5, dv = e.uvy - 0.5;
      const d2 = du * du + dv * dv;
      if (!e.dying) {
        if (d2 < contactR2 * 2.2) this._playClip(e, this._clipAttack, false);
        else this._playClip(e, this._clipWalk, false);
      }

      // One hit per enemy: deal damage once, then death animation / removal (do not repeat while dying inside radius).
      if (!e.dying && d2 < contactR2) {
        damage++;
        if (e.mixer && this._clipDeath) {
          e.dying = true;
          e.deathTimer = ENEMY_DEATH_SECONDS;
          this._playClip(e, this._clipDeath, true);
        } else {
          dead.push(e);
        }
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
    if (!enemy || enemy.dying) return;
    if (enemy.mixer && this._clipDeath) {
      enemy.dying = true;
      enemy.deathTimer = ENEMY_DEATH_SECONDS;
      this._playClip(enemy, this._clipDeath, true);
      return;
    }
    this._removeEnemyInstance(enemy);
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
    const { G, dist, fdx, fdy, blocked, uvSpan } = this._field;
    const span = uvSpan ?? 1;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;

    let maxDist = 0;
    for (let i = 0; i < G * G; i++) {
      if (isFinite(dist[i]) && dist[i] > maxDist) maxDist = dist[i];
    }
    if (maxDist < 1e-6) maxDist = 1;

    // Heatmap: each pixel shows the same 0–1 UV tile as before (radar unchanged); field samples the wider domain.
    const img = ctx.createImageData(W, H);
    const d   = img.data;
    const dUvCell = span / (G - 1);

    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const worldUvX = (px + 0.5) / W;
        const worldUvY = 1 - (py + 0.5) / H;
        let r, g, b, a = 210;
        if (worldUvX < FLOW_UV_MIN || worldUvX > FLOW_UV_MAX || worldUvY < FLOW_UV_MIN || worldUvY > FLOW_UV_MAX) {
          r = 6; g = 4; b = 12;
        } else {
          const gxf = ((worldUvX - FLOW_UV_MIN) / span) * (G - 1);
          const gyf = ((worldUvY - FLOW_UV_MIN) / span) * (G - 1);
          const gxC = Math.max(0, Math.min(G - 1, Math.round(gxf)));
          const gyC = Math.max(0, Math.min(G - 1, Math.round(gyf)));
          const fi  = gyC * G + gxC;
          const blk = blocked[fi];
          const dst = dist[fi];
          if (blk) {
            r = 12; g = 6; b = 28;
          } else if (!isFinite(dst)) {
            r = 35; g = 35; b = 35;
          } else {
            const t = dst / maxDist;
            r = Math.round(40  + t * 200);
            g = Math.round(180 - t * 160);
            b = 20;
          }
        }
        const di = (py * W + px) * 4;
        d[di] = r; d[di + 1] = g; d[di + 2] = b; d[di + 3] = a;
      }
    }
    ctx.putImageData(img, 0, 0);

    const STEP = 6;
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    for (let gy = STEP >> 1; gy < G; gy += STEP) {
      for (let gx = STEP >> 1; gx < G; gx += STEP) {
        const fi = gy * G + gx;
        if (blocked[fi] || !isFinite(dist[fi]) || dist[fi] === 0) continue;
        const cellUvX = FLOW_UV_MIN + ((gx + 0.5) / (G - 1)) * span;
        const cellUvY = FLOW_UV_MIN + ((gy + 0.5) / (G - 1)) * span;
        if (cellUvX < 0 || cellUvX > 1 || cellUvY < 0 || cellUvY > 1) continue;
        const cx = cellUvX * W;
        const cy = (1 - cellUvY) * H;
        const ax = fdx[fi] * STEP * dUvCell * W * 0.38;
        const ay = -fdy[fi] * STEP * dUvCell * H * 0.38;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + ax, cy + ay);
        ctx.stroke();
      }
    }

    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    ctx.fillStyle = '#ff3300';
    for (const e of this._enemies) {
      const ux = clamp01(e.uvx);
      const uy = clamp01(e.uvy);
      const pr = e.tier === 'large' ? 5 : e.tier === 'medium' ? 4 : 3;
      ctx.beginPath();
      ctx.arc(ux * W, (1 - uy) * H, pr, 0, Math.PI * 2);
      ctx.fill();
    }

    if (shipUVX !== undefined) {
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(clamp01(shipUVX) * W, (1 - clamp01(shipUVY)) * H, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ffd700';
    ctx.beginPath();
    ctx.arc(W * 0.5, H * 0.5, 5, 0, Math.PI * 2);
    ctx.fill();

    // Hint text lives in HTML (`.flow-radar-hint`) so it stays outside the circular clip.
  }

  /** Full teardown — call when the game session ends. */
  dispose() {
    this.removeAll();
  }

  get enemies() { return this._enemies; }
  get count()   { return this._enemies.length; }
}
