/**
 * GameScreen
 *
 * Owns the Three.js scene, camera, renderer, and animation loop.
 * Renders the procedural terrain with geological cross-section.
 * WASD / arrow keys scroll the terrain sample window.
 */

import * as THREE from 'three';
import { FBXLoader }       from 'three/addons/loaders/FBXLoader.js';
import { noiseGLSL }       from './shaders/noise.js';

const OBJ_SCALE = 0.0001;  // uniform scale applied to all loaded OBJ assets
import { terrainVertGLSL } from './shaders/terrain.vert.js';
import { terrainFragGLSL } from './shaders/terrain.frag.js';

// ─────────────────────────────────────────────────────────────────────────────
// JS heightmap — mirrors the GLSL heightmap() for CPU-side height queries.
// Used to build the cross-section geometry each frame.
// ─────────────────────────────────────────────────────────────────────────────

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
 * Sample the terrain height at a given UV coordinate (0–1 range).
 * Returns a value in roughly [0, 1] — multiply by heightScale for world Y.
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

// ─────────────────────────────────────────────────────────────────────────────
// Cross-section geometry builder
// ─────────────────────────────────────────────────────────────────────────────

function _generateBandColors(numBands) {
  const colors = [];
  for (let k = 0; k < numBands; k++) {
    colors.push([
      0.18 + Math.random() * 0.22,
      0.12 + Math.random() * 0.15,
      0.06 + Math.random() * 0.08,
    ]);
  }
  return colors;
}

function _buildCrossSection(heightScale, uScale, uOffsetX, uOffsetY, bandColors) {
  const NUM_COLS  = 513;
  const NUM_BANDS = 25;
  const SIZE = 4, half = SIZE / 2;
  const Z = half, FLOOR_Y = 1.5;

  const offX = uOffsetX / uScale, offY = uOffsetY / uScale;

  const heights = new Float32Array(NUM_COLS);
  let ceilY = -Infinity;
  for (let j = 0; j < NUM_COLS; j++) {
    heights[j] = sampleHeight(j / (NUM_COLS - 1) + offX, offY) * heightScale;
    if (heights[j] > ceilY) ceilY = heights[j];
  }

  const bandThickness = (ceilY * 0.5) / NUM_BANDS;
  const vCount = NUM_BANDS * 2 * NUM_COLS;
  const posArr = new Float32Array(vCount * 3);
  const colArr = new Float32Array(vCount * 3);
  const idxArr = [];
  let vi = 0;

  for (let k = 0; k < NUM_BANDS; k++) {
    const [r, g, b] = bandColors[k];
    const baseBot = vi;
    for (let j = 0; j < NUM_COLS; j++) {
      const x = -half + SIZE * j / (NUM_COLS - 1);
      const y = Math.max(heights[j] - (k + 1) * bandThickness, FLOOR_Y);
      posArr[vi*3] = x; posArr[vi*3+1] = y; posArr[vi*3+2] = Z;
      colArr[vi*3] = r; colArr[vi*3+1] = g; colArr[vi*3+2] = b;
      vi++;
    }
    const baseTop = vi;
    for (let j = 0; j < NUM_COLS; j++) {
      const x = -half + SIZE * j / (NUM_COLS - 1);
      const y = k === 0 ? heights[j] : Math.max(heights[j] - k * bandThickness, FLOOR_Y);
      posArr[vi*3] = x; posArr[vi*3+1] = y; posArr[vi*3+2] = Z;
      colArr[vi*3] = r; colArr[vi*3+1] = g; colArr[vi*3+2] = b;
      vi++;
    }
    for (let j = 0; j < NUM_COLS - 1; j++) {
      if (heights[j] - k * bandThickness > FLOOR_Y && heights[j+1] - k * bandThickness > FLOOR_Y) {
        const bl = baseBot + j, br = baseBot + j + 1;
        const tl = baseTop + j, tr = baseTop + j + 1;
        idxArr.push(bl, br, tr, bl, tr, tl);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
  geo.setIndex(idxArr);
  return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// GameScreen class
// ─────────────────────────────────────────────────────────────────────────────

export class GameScreen {
  constructor(audioManager) {
    this.audioManager = audioManager;

    this.canvas   = document.getElementById('game-canvas');
    this.renderer = null;
    this.scene    = null;
    this.camera   = null;
    this.clock    = new THREE.Clock();

    this._animFrameId = null;
    this._running     = false;

    // HUD callbacks (wired by main.js)
    this.onOpenSettings = null;
    this.onMainMenu     = null;

    // Terrain state
    this._uniforms      = null;
    this._csMesh        = null;
    this._csBandColors  = null;
    this._HEIGHT_SCALE  = 0;
    this._offset        = new THREE.Vector2(0, 0);
    this._prevOffsetX   = 0;
    this._prevOffsetY   = 0;
    this._keys          = {};

    // Ship
    this._ship         = null;
    this.SHIP_HOVER    = 0.3;   // world units above terrain surface
    this._shipAngle    = 0;     // heading offset from base rotation (radians)
    this._velocity     = new THREE.Vector2(0, 0);  // offset-space velocity
    this._shipBank     = 0;     // current roll angle for banking visual
    this._shipY        = 1.0;   // smoothed world-Y, lerped toward terrain + hover
    this._shipPitch    = 0;     // nose-up/down tilt in radians, driven by climb rate

    // Base structures
    this._hangar       = null;

    this._initRenderer();
    this._initScene();
    this._bindHUD();
    this._bindResize();
    this._bindKeys();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    this.clock.start();
    this._loop();
  }

  stop() {
    this._running = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this.clock.stop();
  }

  // ── Game loop ──────────────────────────────────────────────────────────────

  _loop() {
    if (!this._running) return;
    this._animFrameId = requestAnimationFrame(() => this._loop());
    const delta   = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();
    this.update(delta, elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  update(delta, elapsed) {
    const keys = this._keys;
    const off  = this._offset;

    const TURN_SPEED   = 1.8;  // radians / sec
    const THRUST_ACCEL = 1.0;  // offset units / sec²
    const MAX_SPEED    = 1.5;  // offset units / sec
    // Drag half-life ~1 sec: speed drops to 35% of peak 1 s after releasing thrust
    const DRAG = Math.pow(0.35, delta);

    // ── Ship rotation (A/D + left/right arrows) ───────────────────────────
    let turning = 0;
    if (keys['ArrowLeft']  || keys['KeyA']) { this._shipAngle -= TURN_SPEED * delta; turning = -1; }
    if (keys['ArrowRight'] || keys['KeyD']) { this._shipAngle += TURN_SPEED * delta; turning =  1; }

    // ── Thrust (W/Up = forward, S/Down = reverse) ─────────────────────────
    // Nose direction in offset space, derived from rotation.y = Math.PI - _shipAngle.
    // Local +Z of the model (the visual nose) in world = (sin θ, 0, -cos θ).
    // Offset mapping: off.x += world.x, off.y += -world.z = cos θ.
    const tdx =  Math.sin(this._shipAngle);
    const tdy =  Math.cos(this._shipAngle);

    if (keys['ArrowUp']   || keys['KeyW']) {
      this._velocity.x += tdx * THRUST_ACCEL * delta;
      this._velocity.y += tdy * THRUST_ACCEL * delta;
    }
    if (keys['ArrowDown'] || keys['KeyS']) {
      this._velocity.x -= tdx * THRUST_ACCEL * delta;
      this._velocity.y -= tdy * THRUST_ACCEL * delta;
    }

    // ── Drag ──────────────────────────────────────────────────────────────
    this._velocity.multiplyScalar(DRAG);

    // ── Speed clamp ───────────────────────────────────────────────────────
    const spd = this._velocity.length();
    if (spd > MAX_SPEED) this._velocity.multiplyScalar(MAX_SPEED / spd);

    // ── Apply velocity to terrain offset ──────────────────────────────────
    off.x += this._velocity.x * delta;
    off.y += this._velocity.y * delta;

    this._uniforms.uTime.value = elapsed;
    this._uniforms.uOffset.value.copy(off);

    if (off.x !== this._prevOffsetX || off.y !== this._prevOffsetY) {
      this._csMesh.geometry.dispose();
      this._csMesh.geometry = _buildCrossSection(
        this._HEIGHT_SCALE,
        this._uniforms.uScale.value,
        off.x, off.y,
        this._csBandColors
      );
      this._prevOffsetX = off.x;
      this._prevOffsetY = off.y;
    }

    // ── Ship model: heading rotation + banking roll ────────────────────────
    if (this._ship) {
      // Math.PI - angle so that D (increasing angle) rotates the nose clockwise (right first).
      this._ship.rotation.y = Math.PI - this._shipAngle;

      // Smoothly bank into turns; lerp factor tuned so the roll settles in ~0.25 s
      const targetBank = turning * 0.4;
      this._shipBank = THREE.MathUtils.lerp(this._shipBank, targetBank, Math.min(1, delta * 6));
      this._ship.rotation.z = this._shipBank;

      // Keep ship floating above the terrain at the world-centre UV.
      // Lerp the Y position so the ship rises and falls smoothly over ridges.
      const uScale   = this._uniforms.uScale.value;
      const groundY  = sampleHeight(
        0.5 + off.x / uScale,
        0.5 + off.y / uScale
      ) * this._HEIGHT_SCALE;
      const targetY  = groundY + this.SHIP_HOVER;
      // Rise quickly so the ship never clips into a peak; settle slowly for a floaty feel.
      const lerpRate = targetY > this._shipY ? 6.0 : 3.0;
      // Capture the gap before lerping — this is the instantaneous climb/sink demand.
      const climbErr = targetY - this._shipY;
      this._shipY    = THREE.MathUtils.lerp(this._shipY, targetY, Math.min(1, delta * lerpRate));
      this._ship.position.y = this._shipY;

      // Pitch nose up when climbing, down when sinking.
      // climbErr is in world units; scale to ±~0.45 rad (±25°) max.
      const targetPitch = THREE.MathUtils.clamp(climbErr * -2.5, -0.45, 0.45);
      this._shipPitch   = THREE.MathUtils.lerp(this._shipPitch, targetPitch, Math.min(1, delta * 4));
      this._ship.rotation.x = this._shipPitch;
    }

    // Hangar is pinned to heightmap UV (0.5, 0.5) — its world XZ slides
    // opposite to the offset so it stays locked to the landscape.
    if (this._hangar) {
      const HANGAR_RAISE = 0.05;
      const groundY = sampleHeight(0.5, 0.5) * this._HEIGHT_SCALE;
      this._hangar.position.set(-off.x, groundY + HANGAR_RAISE, off.y);

      // Hide the hangar once it scrolls beyond the terrain tile boundary (half-size = 2).
      const TERRAIN_HALF = 1.9;
      this._hangar.visible = Math.abs(off.x) < TERRAIN_HALF && Math.abs(off.y) < TERRAIN_HALF;
    }
  }

  // ── Scene setup ────────────────────────────────────────────────────────────

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas:    this.canvas,
      antialias: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  _initScene() {
    this.scene  = new THREE.Scene();
    this.scene.background = new THREE.Color(0x8ca8c0);

    this.camera = new THREE.PerspectiveCamera(
      65,
      window.innerWidth / window.innerHeight,
      0.01,
      200
    );
    this.camera.position.set(0.000, 3.500, 2.464);
    this.camera.lookAt(0.000, 0.000, -0.745);

    this._buildScene();
  }

  _buildScene() {
    const vertexShader   = noiseGLSL + '\n' + terrainVertGLSL;
    const fragmentShader = noiseGLSL + '\n' + terrainFragGLSL;

    // Terrain uniforms
    this._uniforms = {
      uTime:   { value: 0.0 },
      uOffset: { value: new THREE.Vector2(0, 0) },
      uScale:  { value: 4.0 },
    };

    // Terrain mesh
    const geo = new THREE.PlaneGeometry(4, 4, 768, 768);
    geo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const mat = new THREE.ShaderMaterial({
      uniforms:       this._uniforms,
      vertexShader,
      fragmentShader,
      side:      THREE.FrontSide,
      wireframe: false,
    });
    this.scene.add(new THREE.Mesh(geo, mat));

    // Geological cross-section
    this._HEIGHT_SCALE = this._uniforms.uScale.value;
    this._csBandColors = _generateBandColors(25);
    const csGeo = _buildCrossSection(
      this._HEIGHT_SCALE,
      this._uniforms.uScale.value,
      0, 0,
      this._csBandColors
    );
    const csMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this._csMesh = new THREE.Mesh(csGeo, csMat);
    this.scene.add(this._csMesh);

    // Sky sphere
    const skyGeo = new THREE.SphereGeometry(80, 16, 8);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {},
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDir;
        void main() {
          float t = clamp(vDir.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 horizon = vec3(0.62, 0.32, 0.18);
          vec3 zenith  = vec3(0.22, 0.10, 0.08);
          vec3 col     = mix(horizon, zenith, pow(t, 0.8));
          vec3 sunDir  = normalize(vec3(-0.6, 0.5, 0.3));
          float sun    = pow(max(0.0, dot(normalize(vDir), sunDir)), 256.0);
          col += vec3(1.0, 0.80, 0.50) * sun * 2.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    // Models
    this._loadShip();
    this._loadHangar();
  }

  _loadHangar() {
    const atlas = new THREE.TextureLoader().load('assets/textures/PolygonSciFiCity_Texture_01_A.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshPhongMaterial({
      map:       atlas,
      specular:  0x223344,
      shininess: 40,
    });

    const fbxLoader = new FBXLoader();
    fbxLoader.setResourcePath('assets/textures/');
    fbxLoader.load(
      'assets/obj/SM_Bld_HangarPlatform_01.fbx',
      (obj) => {
        obj.traverse(child => {
          if (child.isMesh) child.material = mat;
        });
        const groundY = sampleHeight(0.5, 0.5) * this._HEIGHT_SCALE;
        obj.position.set(0, groundY + 0.05, 0);
        obj.scale.setScalar(OBJ_SCALE);
        this._hangar = obj;
        this.scene.add(obj);
      },
      undefined,
      (err) => console.error('Hangar load failed:', err)
    );
  }

  _loadShip() {
    // Ambient + directional lights for all OBJ models
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.2);
    sun.position.set(-4, 8, 4);
    this.scene.add(sun);

    const atlas   = new THREE.TextureLoader().load('assets/textures/PolygonSciFiCity_Texture_01_A.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    const shipMat = new THREE.MeshPhongMaterial({
      map:       atlas,
      specular:  0x223344,
      shininess: 40,
    });

    const fbxLoader = new FBXLoader();
    fbxLoader.setResourcePath('assets/textures/');  // suppresses the .psd 404
    fbxLoader.load(
      'assets/obj/SM_Ship_Fighter_01.fbx',
      (obj) => {
        obj.traverse(child => {
          if (child.isMesh) child.material = shipMat;
        });
        const groundY = sampleHeight(0.5, 0.5) * this._HEIGHT_SCALE;
        obj.position.set(0, groundY + this.SHIP_HOVER, 0);
        obj.scale.setScalar(OBJ_SCALE);
        obj.rotation.y = Math.PI;
        this._ship = obj;
        this.scene.add(obj);
      },
      undefined,
      (err) => console.error('Ship load failed:', err)
    );
  }

  // ── Input ──────────────────────────────────────────────────────────────────

  _bindKeys() {
    const HANDLED = new Set(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD']);
    window.addEventListener('keydown', e => {
      this._keys[e.code] = true;
      if (this._running && HANDLED.has(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', e => { this._keys[e.code] = false; });
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  _bindHUD() {
    document.getElementById('btn-game-settings')?.addEventListener('click', () => {
      this.onOpenSettings?.();
    });
    document.getElementById('btn-main-menu')?.addEventListener('click', () => {
      this.stop();
      this.onMainMenu?.();
    });
  }

  // ── Resize ─────────────────────────────────────────────────────────────────

  _bindResize() {
    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    });
  }
}
