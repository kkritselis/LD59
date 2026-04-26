/**
 * GameScreen
 *
 * Owns the Three.js scene, camera, renderer, and animation loop.
 * Renders the procedural terrain with geological cross-section.
 * WASD / arrow keys scroll the terrain sample window.
 */

import * as THREE from 'three';
import { FBXLoader }        from 'three/addons/loaders/FBXLoader.js';
import { Line2 }            from 'three/addons/lines/Line2.js';
import { LineGeometry }     from 'three/addons/lines/LineGeometry.js';
import { LineMaterial }     from 'three/addons/lines/LineMaterial.js';
import { noiseGLSL }        from './shaders/noise.js';
import { terrainVertGLSL }  from './shaders/terrain.vert.js';
import { terrainFragGLSL }  from './shaders/terrain.frag.js';
import { sampleHeight }     from './terrain.js';
import { EnemyManager }     from './EnemyManager.js';
import { ResourceManager }  from './ResourceManager.js';

const OBJ_SCALE = 0.0001;  // uniform scale applied to all loaded FBX assets

// Base HP at which the game ends
const BASE_MAX_HP = 25;
const INITIAL_ENEMY_COUNT = 50;

// Weapon
const FIRE_RATE      = 0.12;  // seconds between shots
const FIRE_RANGE     = 0.6;   // horizontal world units — kill radius around ship
const LASER_DURATION = 0.10;  // seconds each laser beam stays visible
const LASER_DASH     = 0.07;  // dash segment length (world units)
const LASER_GAP      = 0.035; // gap between dashes
const LASER_SPEED    = 1.2;   // dashOffset scroll rate — how fast pulses travel

// Dock shop / buildables
const TOWER_COST            = 25;
const TRANSMISSION_GOAL     = 100;
/** Jam listing page for ratings (edit to your itch.io page if you ship there instead). */
const JAM_RATE_URL          = 'https://ldjam.com/events/ludum-dare/59';
const WEAPON_COST_BASE      = 15;
const WEAPON_COST_PER_TIER  = 5;
const WEAPON_MULT_STEP      = 1.1;   // +10% range and fire rate per tier
const TOWER_HEIGHT          = 0.21;
const TOWER_DROP_SEC        = 0.5;
/** World +X offset from hangar root so the mast sits beside the pad, not on center. */
const TRANSMISSION_PAD_OFFSET_X = 0.38;
/** Transmission mast (`tower1.fbx`) target world height before funding scale. */
const TRANSMISSION_VISUAL_HEIGHT = 1.55;
/** Defense tower base / weapon pieces — world heights after OBJ_SCALE fit (single scale on clones). */
const DEFENSE_BASE_TARGET_HEIGHT   = 0.04;
const DEFENSE_WEAPON_TARGET_HEIGHT = 0.02;
/** Nudge root Y so the base clears terrain / z-fight after placement. */
const DEFENSE_TOWER_GROUND_BIAS = 0.004;
const TURRET_TURN_RATE             = 10;

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

    this.canvas    = document.getElementById('game-canvas');
    this.renderer  = null;
    this.scene     = null;
    this.camera    = null;
    this.clock     = new THREE.Clock();

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
    this._landFactor   = 1.0;   // 1 = fully landed on platform, 0 = fully airborne
    this._hasLaunched  = false; // true once the ship has taken off at least once
    this._landLockTimer = 0;    // seconds remaining in post-landing control lockout

    // Target reticle decal projected onto the terrain below the ship
    this._targetDecal  = null;

    // Direction arrow hovering above the ship
    this._dirArrow     = null;

    // Laser beams
    this._lasers       = [];   // { line, mat, timer }
    this._fireTimer    = 0;

    // Base structures
    this._hangar       = null;

    // Enemy / wave system
    this._enemyManager = null;
    this._baseHP       = BASE_MAX_HP;
    this._wave         = 0;
    this._waveTimer    = 60.0;  // first wave spawns at 1:00

    // Resources
    this._resourceManager = null;
    this._resourceCount   = 0;

    // HUD element references (cached once)
    this._hudHPValue   = document.getElementById('hud-hp-value');
    this._hudHPBar     = document.getElementById('hud-hp-bar');
    /** @type {HTMLSpanElement[]|null} */
    this._hudHPSegments = null;
    this._initHudHpBar();

    this._hudResourcesValue = document.getElementById('hud-resources-value');

    this._baseBackdropEl = document.getElementById('game-base-backdrop');

    // Radar / flow field overlay — on by default, F key toggles it
    this._flowRadarHud  = document.getElementById('flow-radar-hud');
    this._flowCanvas    = document.getElementById('flow-canvas');
    this._showFlowField = true;

    // Windblown dust motes (Points) around the play volume
    this._dustPoints = null;

    // Dock shop (modal while landed on base)
    this._dockModalEl       = null;
    this._dockModalOpen     = false;
    this._dockLandingLatch = false;
    /** @type {null | { id: string, action: string, name: string, description: string, cost: number, image: string, max?: string|number }[]> */
    this._storeItems        = null;
    /** @type {Promise<void> | null} */
    this._storeLoadPromise  = null;
    /** True after the player leaves the pad once — suppresses shop on session start. */
    this._playerHasLeftPadOnce = false;

    // Economy / upgrades
    this._pendingTowerPlace = false;
    this._weaponTier        = 0;
    this._weaponMult        = 1.0;
    this._transmissionProgress = 0;
    this._transmissionMesh   = null;
    this._distressSent       = false;
    this._gameEndModalEl    = document.getElementById('game-end-modal');
    this._gameEndEyebrowEl  = document.getElementById('game-end-eyebrow');
    this._gameEndTitleEl    = document.getElementById('game-end-title');
    this._gameEndBodyEl     = document.getElementById('game-end-body');
    this._gameEndRateEl     = document.getElementById('game-end-rate');
    this._gameEnded         = false;
    this._introModalEl      = document.getElementById('game-intro-modal');
    /** When true, `update()` skips simulation (briefing modal). */
    this._introBlocking     = false;

    /** @type {{ uvx: number, uvy: number, mesh: THREE.Object3D, state: string, dropT: number, fireTimer: number, useFbx?: boolean, weaponPivot?: THREE.Object3D, beamLocalY?: number }[]} */
    this._defenseTowers = [];

    /** FBX templates (never added to scene). */
    this._transmissionFbxTemplate = null;
    this._defenseBaseTemplate     = null;
    this._defenseWeaponTemplate   = null;
    /** World Y from base root to top surface (for weapon pivot). */
    this._defenseBaseTopY         = 0.12;
    /** Local Y on weapon pivot toward barrel for beam origin. */
    this._defenseWeaponBeamLocalY = 0.06;
    this._fbxSharedMat            = null;

    this._initRenderer();
    this._initScene();
    this._bindHUD();
    this._bindDockShop();
    this._startDockStoreLoad();
    this._bindResize();
    this._bindKeys();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._resetSessionState();
    this._running = true;
    this.clock.start();
    if (!this._dustPoints && this.scene) this._addDustMotes();
    this._showGameIntro();
    this._loop();
  }

  /** True between `start()` and `stop()`. */
  isRunning() {
    return this._running;
  }

  /**
   * @param {{ hideEndModal?: boolean }} [options]
   */
  stop(options = {}) {
    const hideEndModal = options.hideEndModal !== false;
    this._running = false;
    this.audioManager?.stopBackgroundLoop();
    this._hideGameIntro();
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this.clock.stop();
    this._enemyManager?.removeAll();
    this._resourceManager?.removeAll();
    this._clearBuildables();
    this._closeDockShop();
    this._syncBaseDockBackdrop(false);
    if (hideEndModal) this._hideGameEndModal();
    if (this._dustPoints) {
      this.scene?.remove(this._dustPoints);
      this._dustPoints.geometry.dispose();
      this._dustPoints.material.dispose();
      this._dustPoints = null;
    }
    for (const L of this._lasers) {
      this.scene.remove(L.line);
      L.line.geometry.dispose();
      L.mat.dispose();
    }
    this._lasers = [];
  }

  _resetSessionState() {
    this._closeDockShop();
    this._dockLandingLatch = false;
    this._playerHasLeftPadOnce = false;
    this._baseHP = BASE_MAX_HP;
    this._resourceCount = 0;
    this._weaponTier = 0;
    this._weaponMult = 1.0;
    this._pendingTowerPlace = false;
    this._transmissionProgress = 0;
    this._distressSent = false;
    this._gameEnded = false;
    this._hideGameEndModal();
    this._wave = 0;
    this._waveTimer = 60.0;
    this._fireTimer = 0;

    this._syncBaseDockBackdrop(false);
    this._syncBaseHpHud();
    if (this._hudResourcesValue) this._hudResourcesValue.textContent = this._formatResourceAmount(0);

    this._clearBuildables();
    this._resourceManager?.respawn();
    this._enemyManager?.removeAll();
    this._enemyManager?.spawnWave(INITIAL_ENEMY_COUNT, { scatter: true });
  }

  _clearBuildables() {
    for (const tw of this._defenseTowers) {
      this.scene?.remove(tw.mesh);
      if (!tw.useFbx && tw.mesh.isMesh) {
        tw.mesh.geometry?.dispose();
        tw.mesh.material?.dispose();
      }
    }
    this._defenseTowers = [];
    if (this._transmissionMesh) {
      this.scene?.remove(this._transmissionMesh);
      this._transmissionMesh = null;
    }
  }

  _weaponUpgradeCost() {
    return WEAPON_COST_BASE + this._weaponTier * WEAPON_COST_PER_TIER;
  }

  _effectiveFireRange() {
    return FIRE_RANGE * this._weaponMult;
  }

  _effectiveFireInterval() {
    return FIRE_RATE / this._weaponMult;
  }

  /** Snap ship to pad center and full landing so the dock UI matches the resting pose. */
  _snapShipToPlatform() {
    const HANGAR_RAISE = 0.05;
    const platformY = sampleHeight(0.5, 0.5) * this._HEIGHT_SCALE + HANGAR_RAISE;

    this._offset.set(0, 0);
    this._velocity.set(0, 0);
    this._landFactor = 1.0;
    this._shipY = platformY;
    this._shipAngle = 0;
    this._shipBank = 0;
    this._shipPitch = 0;

    if (this._ship) {
      this._ship.position.y = this._shipY;
      this._ship.rotation.y = Math.PI - this._shipAngle;
      this._ship.rotation.z = 0;
      this._ship.rotation.x = 0;
    }

    if (this._uniforms?.uOffset) this._uniforms.uOffset.value.copy(this._offset);

    if (this._csMesh && this._csBandColors) {
      this._csMesh.geometry.dispose();
      this._csMesh.geometry = _buildCrossSection(
        this._HEIGHT_SCALE,
        this._uniforms.uScale.value,
        this._offset.x,
        this._offset.y,
        this._csBandColors,
      );
      this._prevOffsetX = this._offset.x;
      this._prevOffsetY = this._offset.y;
    }
  }

  async _openDockShop() {
    if (this._dockModalOpen || !this._dockModalEl || this._baseHP <= 0) return;
    this._snapShipToPlatform();
    this._dockModalOpen = true;
    this._dockModalEl.classList.remove('hidden');
    this._dockModalEl.setAttribute('aria-hidden', 'false');
    try {
      await this._storeLoadPromise;
    } catch { /* store load failed; UI still opens */ }
    this._refreshDockShopUI();
  }

  _closeDockShop() {
    if (!this._dockModalEl) return;
    this._dockModalOpen = false;
    this._dockModalEl.classList.add('hidden');
    this._dockModalEl.setAttribute('aria-hidden', 'true');
    this._syncBaseDockBackdrop(false);
  }

  /** Show or hide the hangar full-screen backdrop (used by `_updateBaseDockBackdrop` and reset/stop). */
  _syncBaseDockBackdrop(visible) {
    const el = this._baseBackdropEl;
    if (!el) return;
    el.classList.toggle('is-visible', visible);
    el.setAttribute('aria-hidden', visible ? 'false' : 'true');
  }

  /**
   * Hangar backdrop only after the player has left the pad at least once, and only while
   * the dock shop modal is open (hides as soon as the modal closes).
   */
  _updateBaseDockBackdrop() {
    const DOCK_RADIUS = 0.25;
    const dist = this._offset.length();
    const fullyDocked = dist < DOCK_RADIUS && this._landFactor > 0.96;
    const show = (
      fullyDocked
      && this._playerHasLeftPadOnce
      && this._dockModalOpen
      && this._baseHP > 0
    );
    this._syncBaseDockBackdrop(show);
  }

  _formatResourceAmount(n) {
    const t = Math.round(n * 10) / 10;
    return Number.isInteger(t) ? String(t) : t.toFixed(1);
  }

  _refreshDockShopUI() {
    const r = this._resourceCount;
    const el = (id) => document.getElementById(id);
    const readout = el('dock-shop-resources-readout');
    if (readout) readout.textContent = `Resources: ${this._formatResourceAmount(r)}`;

    const wCost = this._weaponUpgradeCost();
    const wSpan = el('dock-weapon-cost');
    if (wSpan) wSpan.textContent = String(wCost);

    const items = this._storeItems;
    if (items && this._dockModalEl) {
      for (const item of items) {
        const card = this._dockModalEl.querySelector(`.dock-store-card[data-store-id="${item.id}"]`);
        if (!card) continue;
        const buy = card.querySelector('.dock-store-buy');
        const setText = (bind, text) => {
          const node = card.querySelector(`[data-bind="${bind}"]`);
          if (node) node.textContent = text;
        };
        setText('cost', String(item.cost ?? ''));

        let disabled = true;
        let ratioText = '';
        const act = item.action;
        if (act === 'repair') {
          ratioText = `${this._baseHP}/${BASE_MAX_HP}`;
          disabled = r < 1 || this._baseHP >= BASE_MAX_HP;
        } else if (act === 'transmission') {
          ratioText = `${this._transmissionProgress}/${TRANSMISSION_GOAL}`;
          disabled = r < 1 || this._transmissionProgress >= TRANSMISSION_GOAL;
        } else if (typeof act === 'string' && act.startsWith('tower')) {
          const n = this._defenseTowers?.length ?? 0;
          const rawMax = item.max;
          let maxPart = '—';
          if (rawMax != null && rawMax !== '' && rawMax !== '—') {
            const num = Number(rawMax);
            if (!Number.isNaN(num)) maxPart = String(rawMax);
          }
          ratioText = `${n}/${maxPart}`;
          disabled = r < TOWER_COST;
        }
        setText('ratio', ratioText);
        if (buy) buy.disabled = disabled;
      }
    }

    const bDistress = el('btn-dock-distress');
    if (bDistress) {
      if (this._distressSent) bDistress.classList.add('hidden');
      else if (this._transmissionProgress >= TRANSMISSION_GOAL) bDistress.classList.remove('hidden');
      else bDistress.classList.add('hidden');
    }
    const bWep = el('btn-dock-weapon');
    if (bWep) bWep.disabled = r < wCost;
  }

  _syncResourceHud() {
    const s = this._formatResourceAmount(this._resourceCount);
    if (this._hudResourcesValue) this._hudResourcesValue.textContent = s;
    if (this._dockModalOpen) this._refreshDockShopUI();
  }

  _initHudHpBar() {
    const track = this._hudHPBar;
    if (!track || track.querySelector('.hud-hp-bar-seg')) return;
    track.setAttribute('aria-valuemax', String(BASE_MAX_HP));
    this._hudHPSegments = [];
    for (let i = 0; i < BASE_MAX_HP; i++) {
      const seg = document.createElement('span');
      seg.className = 'hud-hp-bar-seg';
      seg.setAttribute('aria-hidden', 'true');
      track.appendChild(seg);
      this._hudHPSegments.push(seg);
    }
  }

  _syncBaseHpHud() {
    if (this._hudHPValue) this._hudHPValue.textContent = `${this._baseHP} / ${BASE_MAX_HP}`;
    if (this._hudHPBar) this._hudHPBar.setAttribute('aria-valuenow', String(this._baseHP));
    const segs = this._hudHPSegments;
    if (segs) {
      for (let i = 0; i < BASE_MAX_HP; i++) segs[i].classList.toggle('is-on', i < this._baseHP);
    }
  }

  _purchaseRepair() {
    if (this._resourceCount < 1 || this._baseHP >= BASE_MAX_HP) return;
    this._resourceCount -= 1;
    this._baseHP += 1;
    this._syncBaseHpHud();
    this._syncResourceHud();
  }

  _purchaseTower() {
    if (this._resourceCount < TOWER_COST) return;
    this._resourceCount -= TOWER_COST;
    this._pendingTowerPlace = true;
    this._syncResourceHud();
  }

  _purchaseTransmissionOne() {
    if (this._resourceCount < 1 || this._transmissionProgress >= TRANSMISSION_GOAL) return;
    this._resourceCount -= 1;
    this._transmissionProgress += 1;
    if (!this._transmissionMesh && this._transmissionProgress > 0) this._spawnTransmissionMesh();
    else this._syncTransmissionTowerScale();
    this._syncResourceHud();
    if (this._transmissionProgress >= TRANSMISSION_GOAL) {
      this.stop({ hideEndModal: false });
      this._showGameEndModal('win_transmission');
    }
  }

  /** Transmission mast from `tower1.fbx`; uniform scale grows with funding. */
  _spawnTransmissionMesh() {
    if (this._transmissionMesh || !this.scene) return;
    if (!this._transmissionFbxTemplate) return;

    const mesh = this._transmissionFbxTemplate.clone(true);
    const embedded = [];
    mesh.traverse((ch) => {
      if (ch.isLight) embedded.push(ch);
      if (ch.isMesh) ch.material = this._fbxSharedMat;
    });
    embedded.forEach((l) => l.parent?.remove(l));

    const s0 = mesh.scale.x;
    mesh.userData.transmissionScale0 = s0;
    this._syncTransmissionTowerScale(mesh);
    this._transmissionMesh = mesh;
    this.scene.add(mesh);
  }

  _syncTransmissionTowerScale(mesh = this._transmissionMesh) {
    if (!mesh) return;
    const t = Math.max(0.008, this._transmissionProgress / TRANSMISSION_GOAL);
    const s0 = mesh.userData.transmissionScale0 ?? mesh.scale.x;
    mesh.scale.setScalar(s0 * t);
  }

  _purchaseWeapon() {
    const c = this._weaponUpgradeCost();
    if (this._resourceCount < c) return;
    this._resourceCount -= c;
    this._weaponTier += 1;
    this._weaponMult *= WEAPON_MULT_STEP;
    this._syncResourceHud();
  }

  _tryPlaceTower() {
    if (!this._pendingTowerPlace || !this._ship) return;
    if (this._dockModalOpen) return;

    const airborne = 1.0 - this._landFactor;
    const off = this._offset;
    const distFromPad = off.length();
    // Was: airborne < 0.55 only — that blocks placement until the ship is well above the
    // hangar, which feels broken after a long dock session (player nudges horizontally but
    // landFactor still reads "landed"). Allow drop once we're past the pad bubble OR airborne enough.
    const DOCK_R = 0.25;
    const hangarBlockR = DOCK_R + 0.14;
    const hangarStillTooTight = distFromPad < hangarBlockR && airborne < 0.38;
    if (hangarStillTooTight) return;

    const uScale = this._uniforms.uScale.value;
    const uvx = THREE.MathUtils.clamp(0.5 + off.x / uScale, 0.02, 0.98);
    const uvy = THREE.MathUtils.clamp(0.5 + off.y / uScale, 0.02, 0.98);

    if (this._defenseBaseTemplate && this._defenseWeaponTemplate) {
      const root = new THREE.Group();
      const base = this._defenseBaseTemplate.clone(true);
      this._stripLightsApplyMat(base, this._fbxSharedMat);
      const weaponPivot = new THREE.Object3D();
      weaponPivot.position.y = this._defenseBaseTopY;
      const weapon = this._defenseWeaponTemplate.clone(true);
      this._stripLightsApplyMat(weapon, this._fbxSharedMat);
      weaponPivot.add(weapon);
      root.add(base);
      root.add(weaponPivot);

      // Root scale is only the drop shrink (0.12→1). Base/weapon keep template scale `u` / `uw` — do not multiply `u` here or world scale becomes u² and the tower vanishes.
      root.position.set(0, this._shipY, 0);
      root.scale.setScalar(0.12);
      this.scene.add(root);

      this._defenseTowers.push({
        uvx, uvy,
        mesh:         root,
        weaponPivot,
        beamLocalY:   this._defenseWeaponBeamLocalY,
        useFbx:       true,
        state:        'dropping',
        dropT:        0,
        fireTimer:    Math.random() * 0.4,
      });
    } else {
      const geo = new THREE.BoxGeometry(0.07, TOWER_HEIGHT, 0.07);
      const mat = new THREE.MeshPhongMaterial({
        color:     0x4a3528,
        specular:  0x111111,
        shininess: 20,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(0, this._shipY, 0);
      mesh.scale.set(1, 0.12, 1);
      this.scene.add(mesh);

      this._defenseTowers.push({
        uvx, uvy, mesh,
        useFbx:    false,
        state:     'dropping',
        dropT:     0,
        fireTimer: Math.random() * 0.4,
      });
    }
    this._pendingTowerPlace = false;
  }

  _pushLaser(from, to, color, isTower) {
    if (isTower) this.audioManager?.playBlasterTower();
    else this.audioManager?.playBlasterShip();

    const geo = new LineGeometry();
    geo.setPositions([from.x, from.y, from.z, to.x, to.y, to.z]);
    const mat = new LineMaterial({
      color,
      linewidth:  isTower ? 2.5 : 3,
      dashed:     true,
      dashSize:   LASER_DASH,
      gapSize:    LASER_GAP,
      dashOffset: 0,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
    });
    const line = new Line2(geo, mat);
    line.computeLineDistances();
    this.scene.add(line);
    this._lasers.push({ line, mat, timer: LASER_DURATION, isTower });
  }

  _updateTransmission(_delta, off, platformY) {
    if (!this._transmissionMesh) return;
    const m = this._transmissionMesh;
    m.position.set(-off.x + TRANSMISSION_PAD_OFFSET_X, platformY, off.y);
    this._syncTransmissionTowerScale(m);
  }

  _hideGameEndModal() {
    if (!this._gameEndModalEl) this._gameEndModalEl = document.getElementById('game-end-modal');
    this._gameEndModalEl?.classList.add('hidden');
    this._gameEndModalEl?.setAttribute('aria-hidden', 'true');
  }

  _freezeRunLoop() {
    this._closeDockShop();
    this.audioManager?.stopBackgroundLoop();
    this._running = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this.clock.stop();
  }

  /**
   * @param {'win_transmission'|'win_distress'|'lose'} kind
   */
  _showGameEndModal(kind) {
    if (this._gameEnded) return;
    this._gameEnded = true;

    if (!this._gameEndModalEl) this._gameEndModalEl = document.getElementById('game-end-modal');
    const modal = this._gameEndModalEl;
    if (!modal) return;

    const eyebrow = this._gameEndEyebrowEl ?? document.getElementById('game-end-eyebrow');
    const title   = this._gameEndTitleEl ?? document.getElementById('game-end-title');
    const body    = this._gameEndBodyEl ?? document.getElementById('game-end-body');
    const rate    = this._gameEndRateEl ?? document.getElementById('game-end-rate');
    const rateBtn = document.getElementById('btn-game-end-rate');

    if (kind === 'lose') {
      if (eyebrow) eyebrow.textContent = 'Hangar lost';
      if (title) title.textContent = 'You lost';
      if (body) {
        body.textContent = 'The base armor failed. The hangar is overrun.';
      }
      if (rate) rate.textContent = 'If you tried the build, a rating with honest feedback still helps.';
      if (rateBtn) rateBtn.style.display = '';
    } else if (kind === 'win_transmission') {
      if (eyebrow) eyebrow.textContent = 'Transmission online';
      if (title) title.textContent = 'You won!';
      if (body) {
        body.textContent = 'Your signal tower reached full height. The uplink is stable enough to call for help.';
      }
      if (rate) rate.textContent = 'If you enjoyed this build, please rate it on the jam page. It helps a lot.';
      if (rateBtn) rateBtn.style.display = '';
    } else {
      if (eyebrow) eyebrow.textContent = 'Beacon away';
      if (title) title.textContent = 'You won!';
      if (body) {
        body.textContent = 'Your distress call punched through the storm. Help is inbound.';
      }
      if (rate) rate.textContent = 'If you enjoyed this build, please rate it on the jam page. It helps a lot.';
      if (rateBtn) rateBtn.style.display = '';
    }

    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.getElementById('btn-game-end-main-menu')?.focus();
  }

  _sendDistressCall() {
    if (this._distressSent || this._transmissionProgress < TRANSMISSION_GOAL) return;
    this._distressSent = true;
    this._freezeRunLoop();
    this._showGameEndModal('win_distress');
    this._refreshDockShopUI();
  }

  _updateDefenseTowers(delta, off) {
    const US = this._uniforms.uScale.value;
    const HS = this._HEIGHT_SCALE;
    const HALF = US * 0.5;
    const rng = this._effectiveFireRange();
    const interval = this._effectiveFireInterval();

    for (const tw of this._defenseTowers) {
      const wx = (tw.uvx - 0.5) * US - off.x;
      const wz = -(tw.uvy - 0.5) * US + off.y;
      const gy = sampleHeight(tw.uvx, tw.uvy) * HS;
      const inTile = Math.abs(wx) < HALF && Math.abs(wz) < HALF;
      tw.mesh.visible = inTile;

      if (tw.state === 'dropping') {
        tw.dropT += delta / TOWER_DROP_SEC;
        const p = Math.min(1, tw.dropT);
        const s = THREE.MathUtils.lerp(0.12, 1, p);
        if (tw.useFbx) {
          const ty = THREE.MathUtils.lerp(this._shipY, gy + DEFENSE_TOWER_GROUND_BIAS, p);
          tw.mesh.position.set(
            THREE.MathUtils.lerp(0, wx, p),
            ty,
            THREE.MathUtils.lerp(0, wz, p),
          );
          tw.mesh.scale.setScalar(s);
        } else {
          const ty = THREE.MathUtils.lerp(this._shipY, gy + TOWER_HEIGHT * 0.5, p);
          tw.mesh.position.set(
            THREE.MathUtils.lerp(0, wx, p),
            ty,
            THREE.MathUtils.lerp(0, wz, p),
          );
          tw.mesh.scale.y = s;
        }
        if (p >= 1) {
          tw.state = 'ready';
          if (tw.useFbx) tw.mesh.scale.setScalar(1);
          else tw.mesh.scale.y = 1;
        }
      } else if (tw.useFbx) {
        tw.mesh.position.set(wx, gy + DEFENSE_TOWER_GROUND_BIAS, wz);
      } else {
        tw.mesh.position.set(wx, gy + TOWER_HEIGHT * 0.5, wz);
      }

      if (tw.state !== 'ready' || !this._enemyManager || !inTile) continue;

      const ox = tw.mesh.position.x;
      const oz = tw.mesh.position.z;

      if (tw.useFbx && tw.weaponPivot) {
        tw.mesh.updateMatrixWorld(true);
        let aimE = null;
        let bestA = rng;
        for (const e of this._enemyManager.enemies) {
          const d = Math.hypot(e.mesh.position.x - ox, e.mesh.position.z - oz);
          if (d < bestA) { bestA = d; aimE = e; }
        }
        if (aimE) {
          const dx = aimE.mesh.position.x - ox;
          const dz = aimE.mesh.position.z - oz;
          const targetYaw = Math.atan2(dx, -dz);
          let diff = targetYaw - tw.weaponPivot.rotation.y;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          tw.weaponPivot.rotation.y += diff * Math.min(1, TURRET_TURN_RATE * delta);
        }
      }

      tw.fireTimer -= delta;
      if (tw.fireTimer > 0) continue;

      let bestD = rng;
      let bestE = null;
      for (const e of this._enemyManager.enemies) {
        const dx = e.mesh.position.x - ox;
        const dz = e.mesh.position.z - oz;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < bestD) { bestD = d; bestE = e; }
      }
      if (bestE) {
        let from;
        if (tw.useFbx && tw.weaponPivot) {
          tw.mesh.updateMatrixWorld(true);
          const local = new THREE.Vector3(0, tw.beamLocalY ?? this._defenseWeaponBeamLocalY, 0);
          local.applyMatrix4(tw.weaponPivot.matrixWorld);
          from = local;
        } else {
          const beamY = tw.mesh.position.y + TOWER_HEIGHT * 0.35;
          from = new THREE.Vector3(ox, beamY, oz);
        }
        const to   = bestE.mesh.position.clone();
        this._pushLaser(from, to, 0x66ddff, true);
        this._resourceManager?.trySpawnEnemyDrop(bestE.uvx, bestE.uvy);
        this._enemyManager.kill(bestE);
        tw.fireTimer = interval;
      } else {
        tw.fireTimer = interval * 0.35;
      }
    }
  }

  _bindDockShop() {
    this._dockModalEl = document.getElementById('dock-shop-modal');
    document.getElementById('btn-dock-close')?.addEventListener('click', () => {
      this._closeDockShop();
    });
    document.getElementById('btn-dock-distress')?.addEventListener('click', () => {
      this._sendDistressCall();
    });
    document.getElementById('btn-dock-weapon')?.addEventListener('click', () => {
      this._purchaseWeapon();
    });
  }

  _startDockStoreLoad() {
    this._storeLoadPromise = fetch('./store.json')
      .then((res) => {
        if (!res.ok) throw new Error(`store.json ${res.status}`);
        return res.json();
      })
      .then((data) => {
        this._storeItems = Array.isArray(data?.items) ? data.items : [];
        this._buildDockStoreCards();
      })
      .catch((err) => {
        console.warn('[GameScreen] store.json', err);
        this._storeItems = [];
      });
  }

  /** Resolve store image path relative to the document (same as paths in index.html). */
  _storeImageUrl(path) {
    const raw = String(path ?? '').trim();
    if (!raw) return '';
    try {
      return new URL(raw, document.baseURI || window.location.href).href;
    } catch {
      return raw;
    }
  }

  _buildDockStoreCards() {
    const root = document.getElementById('dock-store-cards');
    if (!root || !this._storeItems?.length) return;

    root.replaceChildren();

    for (const item of this._storeItems) {
      if (!item?.id || !item.image) continue;
      const article = document.createElement('article');
      article.className = 'dock-store-card';
      article.dataset.storeId = item.id;

      const frame = document.createElement('div');
      frame.className = 'dock-store-card-frame';

      const img = document.createElement('img');
      img.className = 'dock-store-card-art';
      img.src = this._storeImageUrl(item.image);
      img.alt = '';
      img.draggable = false;
      img.decoding = 'async';

      const body = document.createElement('div');
      body.className = 'dock-store-card-body';

      const main = document.createElement('div');
      main.className = 'dock-store-card-main';

      const h3 = document.createElement('h3');
      h3.className = 'dock-store-name';
      h3.textContent = item.name ?? '';

      const p = document.createElement('p');
      p.className = 'dock-store-desc';
      p.textContent = item.description ?? '';

      const ratio = document.createElement('span');
      ratio.className = 'dock-store-ratio';
      ratio.dataset.bind = 'ratio';
      const hasMaxValue = item.max != null && String(item.max).trim() !== '';

      const costNum = document.createElement('span');
      costNum.className = 'dock-store-costnum';
      costNum.dataset.bind = 'cost';

      const buy = document.createElement('button');
      buy.type = 'button';
      buy.className = 'dock-store-buy';
      buy.dataset.action = item.action ?? '';
      buy.setAttribute('aria-label', `Buy ${item.name ?? item.action ?? 'item'}`);
      buy.addEventListener('click', () => this._onStorePurchase(item.action));

      main.appendChild(h3);
      main.appendChild(p);
      if (hasMaxValue) main.appendChild(ratio);
      main.appendChild(costNum);
      body.appendChild(main);
      body.appendChild(buy);
      frame.appendChild(img);
      frame.appendChild(body);
      article.appendChild(frame);
      root.appendChild(article);
    }
  }

  _onStorePurchase(action) {
    if (action === 'repair') this._purchaseRepair();
    else if (action === 'transmission') this._purchaseTransmissionOne();
    else if (typeof action === 'string' && action.startsWith('tower')) this._purchaseTower();
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
    if (this._introBlocking) return;

    const keys = this._keys;
    const off  = this._offset;

    const TURN_SPEED   = 1.8;  // radians / sec
    const THRUST_ACCEL = 1.0;  // offset units / sec²
    const MAX_SPEED    = 1.5;  // offset units / sec
    const DRAG         = Math.pow(0.35, delta);
    const SNAP_RADIUS  = 0.18; // snap-to-platform when offset gets this close

    // ── Post-landing control lockout countdown ────────────────────────────
    if (this._landLockTimer > 0) {
      this._landLockTimer = Math.max(0, this._landLockTimer - delta);
    }
    const locked = this._landLockTimer > 0;
    const inputLocked = locked || this._dockModalOpen;

    // ── Ship rotation (A/D + left/right arrows) ───────────────────────────
    let turning = 0;
    if (!inputLocked) {
      if (keys['ArrowLeft']  || keys['KeyA']) { this._shipAngle -= TURN_SPEED * delta; turning = -1; }
      if (keys['ArrowRight'] || keys['KeyD']) { this._shipAngle += TURN_SPEED * delta; turning =  1; }
    }

    // ── Thrust (W/Up = forward, S/Down = reverse) ─────────────────────────
    // Nose direction in offset space, derived from rotation.y = Math.PI - _shipAngle.
    // Local +Z of the model (the visual nose) in world = (sin θ, 0, -cos θ).
    // Offset mapping: off.x += world.x, off.y += -world.z = cos θ.
    const tdx =  Math.sin(this._shipAngle);
    const tdy =  Math.cos(this._shipAngle);

    if (!inputLocked) {
      if (keys['ArrowUp']   || keys['KeyW']) {
        this._velocity.x += tdx * THRUST_ACCEL * delta;
        this._velocity.y += tdy * THRUST_ACCEL * delta;
      }
      if (keys['ArrowDown'] || keys['KeyS']) {
        this._velocity.x -= tdx * THRUST_ACCEL * delta;
        this._velocity.y -= tdy * THRUST_ACCEL * delta;
      }
    }

    // ── Drag ──────────────────────────────────────────────────────────────
    this._velocity.multiplyScalar(DRAG);

    // ── Speed clamp ───────────────────────────────────────────────────────
    const spd = this._velocity.length();
    if (spd > MAX_SPEED) this._velocity.multiplyScalar(MAX_SPEED / spd);

    // ── Apply velocity to terrain offset ──────────────────────────────────
    off.x += this._velocity.x * delta;
    off.y += this._velocity.y * delta;

    // ── Snap-to-platform landing ──────────────────────────────────────────
    // Once the ship has launched and drifts back within SNAP_RADIUS, lock it
    // to the pad and freeze controls for 3 seconds.
    if (this._landFactor < 0.5) this._hasLaunched = true;
    if (this._hasLaunched && !locked && off.length() < SNAP_RADIUS) {
      off.set(0, 0);
      this._velocity.set(0, 0);
      this._landFactor    = 1.0;
      this._landLockTimer = 3.0;
      this._hasLaunched   = false;
    }

    this._uniforms.uTime.value = elapsed;
    this._uniforms.uOffset.value.copy(off);

    if (this._dustPoints) {
      const arr = this._dustPoints.geometry.attributes.position.array;
      const wx = 2.0 * delta;
      const wz = 0.45 * delta;
      const half = 4.2;
      for (let i = 0; i < arr.length; i += 3) {
        arr[i]     += wx;
        arr[i + 2] += wz;
        if (arr[i] > half) arr[i] -= half * 2;
        if (arr[i] < -half) arr[i] += half * 2;
        if (arr[i + 2] > half) arr[i + 2] -= half * 2;
        if (arr[i + 2] < -half) arr[i + 2] += half * 2;
      }
      this._dustPoints.geometry.attributes.position.needsUpdate = true;
    }

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

    // ── Landing / takeoff autopilot ───────────────────────────────────────
    // The hangar sits at UV (0.5, 0.5) which is world-centre (0,0) when offset=(0,0).
    // The ship is always at world XZ (0,0), so distance to platform = offset magnitude.
    const HANGAR_RAISE  = 0.05;
    const DOCK_RADIUS   = 0.25;   // fully landed inside this offset distance
    const LAUNCH_RADIUS = 0.70;   // fully airborne beyond this distance
    const platformY     = sampleHeight(0.5, 0.5) * this._HEIGHT_SCALE + HANGAR_RAISE;
    const offsetDist    = off.length();
    const landTarget    = 1.0 - THREE.MathUtils.clamp(
      (offsetDist - DOCK_RADIUS) / (LAUNCH_RADIUS - DOCK_RADIUS), 0, 1
    );
    // Landing is faster than takeoff so the descent feels responsive.
    const landRate = landTarget > this._landFactor ? 5.0 : 3.0;
    this._landFactor = THREE.MathUtils.lerp(this._landFactor, landTarget, Math.min(1, delta * landRate));
    const airborne = 1.0 - this._landFactor;  // convenience: 0 = landed, 1 = flying

    if (offsetDist > DOCK_RADIUS + 0.06 || airborne > 0.52) {
      this._playerHasLeftPadOnce = true;
    }

    const fullyDocked = offsetDist < DOCK_RADIUS && this._landFactor > 0.96;
    if (!fullyDocked) this._dockLandingLatch = false;
    else if (
      !this._dockLandingLatch
      && this._baseHP > 0
      && this._playerHasLeftPadOnce
    ) {
      this._dockLandingLatch = true;
      this._openDockShop();
    }

    this._updateBaseDockBackdrop();

    // ── Ship model: heading rotation + banking roll ────────────────────────
    if (this._ship) {
      // Math.PI - angle so that D (increasing angle) rotates the nose clockwise (right first).
      this._ship.rotation.y = Math.PI - this._shipAngle;

      // Suppress bank and pitch while on the platform.
      const targetBank = turning * 0.4 * airborne;
      this._shipBank = THREE.MathUtils.lerp(this._shipBank, targetBank, Math.min(1, delta * 6));
      this._ship.rotation.z = this._shipBank;

      // Y: blend between platform surface (landed) and terrain-hover (airborne).
      const uScale  = this._uniforms.uScale.value;
      const groundY = sampleHeight(
        0.5 + off.x / uScale,
        0.5 + off.y / uScale
      ) * this._HEIGHT_SCALE;

      // Keep target reticle flush with the terrain surface below the ship.
      if (this._targetDecal) {
        this._targetDecal.position.set(0, groundY + 0.02, 0);
        // Slow pulse to draw the eye without being distracting.
        const pulse = 1.0 + Math.sin(elapsed * 2.5) * 0.06;
        this._targetDecal.scale.setScalar(pulse);
        // Fade the reticle out while landed — it serves no purpose on the pad.
        this._targetDecal.material.opacity = Math.max(0, airborne - 0.1) / 0.9;
      }

      // Direction arrow — only when the hangar/base has scrolled off the terrain tile
      // (same bounds as hangar.visible); then fade in with distance like before.
      const TERRAIN_HALF_ARROW = 1.9;
      const baseOnTile =
        Math.abs(off.x) < TERRAIN_HALF_ARROW && Math.abs(off.y) < TERRAIN_HALF_ARROW;

      if (this._dirArrow) {
        this._dirArrow.position.set(0, this._shipY + 0.14, 0);
        const offsetDist2 = off.length();
        if (offsetDist2 > 0.01) {
          this._dirArrow.rotation.y = Math.atan2(off.x, -off.y);
        }
        const towardBase = THREE.MathUtils.clamp(
          (offsetDist2 - 0.15) / 0.25, 0, 1,
        );
        this._dirArrow.material.opacity = baseOnTile
          ? 0
          : towardBase * airborne;
      }

      const flyingTargetY = groundY + this.SHIP_HOVER;
      const targetY       = THREE.MathUtils.lerp(platformY, flyingTargetY, airborne);

      // Rise quickly to avoid clipping peaks; settle slowly for a floaty feel.
      // While landing (landFactor rising), use the fast rate so the descent is visible.
      const lerpRate = (targetY > this._shipY || this._landFactor > 0.15) ? 6.0 : 3.0;
      const climbErr = targetY - this._shipY;
      this._shipY    = THREE.MathUtils.lerp(this._shipY, targetY, Math.min(1, delta * lerpRate));
      this._ship.position.y = this._shipY;

      // Pitch: nose up/down with climb rate, but level on the ground.
      const targetPitch = THREE.MathUtils.clamp(climbErr * -2.5, -0.45, 0.45) * airborne;
      this._shipPitch   = THREE.MathUtils.lerp(this._shipPitch, targetPitch, Math.min(1, delta * 4));
      this._ship.rotation.x = this._shipPitch;

      // ── Autofire ────────────────────────────────────────────────────────
      this._fireTimer -= delta;
      const canFire = airborne > 0.5 && this._enemyManager && !this._dockModalOpen;
      if (this._fireTimer <= 0 && canFire) {
        const rng = this._effectiveFireRange();
        let bestDist  = rng;
        let bestEnemy = null;
        for (const e of this._enemyManager.enemies) {
          const dx = e.mesh.position.x;
          const dz = e.mesh.position.z;
          const d  = Math.sqrt(dx * dx + dz * dz);
          if (d < bestDist) { bestDist = d; bestEnemy = e; }
        }

        if (bestEnemy) {
          const from = new THREE.Vector3(0, this._shipY, 0);
          const to   = bestEnemy.mesh.position.clone();
          this._pushLaser(from, to, 0xff2200, false);
          this._resourceManager?.trySpawnEnemyDrop(bestEnemy.uvx, bestEnemy.uvy);
          this._enemyManager.kill(bestEnemy);
          this._fireTimer = this._effectiveFireInterval();
        } else {
          this._fireTimer = 0.05;
        }
      }
    }

    // ── Enemy wave timer ──────────────────────────────────────────────────
    if (this._enemyManager && this._baseHP > 0) {
      this._updateDefenseTowers(delta, off);

      this._waveTimer -= delta;
      if (this._waveTimer <= 0) {
        this._wave++;
        const count = Math.min(256, Math.pow(2, this._wave - 1)); // 1,2,4,8…256
        this._enemyManager.spawnWave(count);
        this._waveTimer = 60.0; // one wave per minute throughout
        console.log(`[Wave ${this._wave}] Spawned ${count} enemies`);
      }

      // Move enemies + check base damage
      const dmg = this._enemyManager.update(delta, off);
      if (dmg > 0) {
        this._baseHP = Math.max(0, this._baseHP - dmg);
        this._syncBaseHpHud();
        if (this._baseHP === 0) {
          console.warn('[Game Over] Base destroyed!');
          this.stop({ hideEndModal: false });
          this._showGameEndModal('lose');
        }
      }

      // Flow field overlay (drawn every frame so enemy dots stay live)
      if (this._showFlowField && this._flowCanvas) {
        const uScale  = this._uniforms.uScale.value;
        const shipUVX = 0.5 + off.x / uScale;
        const shipUVY = 0.5 + off.y / uScale;
        this._enemyManager.drawToCanvas(this._flowCanvas, shipUVX, shipUVY);
      }
    }

    // ── Resource collection ───────────────────────────────────────────────
    if (this._resourceManager && this._ship) {
      const got = this._resourceManager.update(delta, elapsed, off, this._shipY);
      if (got > 0) {
        this.audioManager?.playResourcePickup();
        this._resourceCount += got;
        this._syncResourceHud();
      }
    }

    // ── Laser beam animation ──────────────────────────────────────────────
    if (this._lasers.length > 0) {
      const dead = [];
      for (const L of this._lasers) {
        L.timer -= delta;
        // Scroll dashes from ship toward target
        L.mat.dashOffset -= LASER_SPEED * delta;
        if (L.timer <= 0) dead.push(L);
      }
      for (const L of dead) {
        this.scene.remove(L.line);
        L.line.geometry.dispose();
        L.mat.dispose();
      }
      if (dead.length) {
        const deadSet = new Set(dead);
        this._lasers = this._lasers.filter(L => !deadSet.has(L));
      }
    }

    // Hangar is pinned to heightmap UV (0.5, 0.5) — its world XZ slides
    // opposite to the offset so it stays locked to the landscape.
    if (this._hangar) {
      this._hangar.position.set(-off.x, platformY, off.y);

      // Hide the hangar once it scrolls beyond the terrain tile boundary (half-size = 2).
      const TERRAIN_HALF = 1.9;
      this._hangar.visible = Math.abs(off.x) < TERRAIN_HALF && Math.abs(off.y) < TERRAIN_HALF;
    }

    this._updateTransmission(delta, off, platformY);
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
    // Dust-storm sky tint (matches terrain / menu palette)
    this.scene.background = new THREE.Color(0x3d221c);
    this.scene.fog = new THREE.FogExp2(0x4a2a22, 0.042);

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
    const geo = new THREE.PlaneGeometry(4, 4, 600, 600);
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
    const csMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side:         THREE.DoubleSide,
      fog:          false,
    });
    this._csMesh = new THREE.Mesh(csGeo, csMat);
    this.scene.add(this._csMesh);

    // Sky sphere — hazy blood-dust gradient, soft sun, scrolling bands + grain
    const skyGeo = new THREE.SphereGeometry(80, 24, 12);
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms:       { uTime: this._uniforms.uTime },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
          vec3 horizon = vec3(0.42, 0.16, 0.09);
          vec3 zenith  = vec3(0.10, 0.04, 0.03);
          vec3 col = mix(horizon, zenith, pow(h, 0.52));

          vec3 sunDir = normalize(vec3(-0.6, 0.5, 0.3));
          float mu = max(0.0, dot(d, sunDir));
          float sunCore = pow(mu, 140.0);
          float sunHaze = pow(mu, 6.0) * 0.42;
          col += vec3(1.0, 0.42, 0.20) * sunCore * 2.2;
          col += vec3(0.55, 0.20, 0.10) * sunHaze;

          vec2 wv = d.xz * 9.0 + vec2(uTime * 0.38, uTime * 0.09);
          float band = sin(wv.x * 2.7 + sin(wv.y * 2.1 + uTime * 0.6)) * 0.5 + 0.5;
          col = mix(col, col * vec3(1.06, 0.90, 0.82), band * 0.14);
          float grain = fract(sin(dot(d.xz * 140.0 + uTime * 5.0, vec2(12.9898, 78.233))) * 43758.5453);
          col += (grain - 0.5) * 0.035;

          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.scene.add(new THREE.Mesh(skyGeo, skyMat));

    this._addDustMotes();

    // Direction arrow — horizontal sprite above the ship pointing toward the base
    const arrowTex = new THREE.TextureLoader().load('assets/textures/arrow.svg');
    const arrowGeo = new THREE.PlaneGeometry(0.35, 0.35);
    arrowGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    this._dirArrow = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({
      map:         arrowTex,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.NormalBlending,
    }));
    this.scene.add(this._dirArrow);

    // Target reticle — flat quad projected onto the terrain under the ship
    const targetTex = new THREE.TextureLoader().load('assets/textures/target.svg');
    const targetGeo = new THREE.PlaneGeometry(0.2, 0.2);
    targetGeo.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
    const targetMat = new THREE.MeshBasicMaterial({
      map:         targetTex,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.NormalBlending,
    });
    this._targetDecal = new THREE.Mesh(targetGeo, targetMat);
    this.scene.add(this._targetDecal);

    // Models
    this._loadShip();
    this._loadHangar();
    this._loadFbxBuildables();

    // Enemy system — flow field build happens here (one-time ~20–50 ms stutter)
    this._enemyManager = new EnemyManager(
      this.scene,
      this._HEIGHT_SCALE,
      this._uniforms.uScale.value
    );

    // Resource nodes scattered across the terrain
    this._resourceManager = new ResourceManager(
      this.scene,
      this._HEIGHT_SCALE,
      this._uniforms.uScale.value
    );
  }

  /** Low-cost drifting particles for airborne dust (rebuilt in start() after stop()). */
  _addDustMotes() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const r   = 1.2 + Math.random() * 5.8;
      const ang = Math.random() * Math.PI * 2;
      pos[i * 3 + 0] = Math.cos(ang) * r + (Math.random() - 0.5) * 0.4;
      pos[i * 3 + 1] = 0.25 + Math.random() * 3.8;
      pos[i * 3 + 2] = Math.sin(ang) * r + (Math.random() - 0.5) * 0.4;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color:          0xd4a574,
      size:           0.018,
      transparent:    true,
      opacity:        0.38,
      depthWrite:     false,
      sizeAttenuation: true,
    });
    this._dustPoints = new THREE.Points(geo, mat);
    this.scene.add(this._dustPoints);
  }

  _stripLightsApplyMat(root, mat) {
    const embedded = [];
    root.traverse((ch) => {
      if (ch.isLight) embedded.push(ch);
      if (ch.isMesh && mat) ch.material = mat;
    });
    embedded.forEach((l) => l.parent?.remove(l));
  }

  /** OBJ_SCALE then fit to `targetWorldHeight`; center on XZ; bottom at y = 0. */
  _fitObjectToGroundHeightCenterXZ(root, targetWorldHeight) {
    root.scale.setScalar(OBJ_SCALE);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(root);
    const h = box.max.y - box.min.y;
    if (h > 1e-6) root.scale.multiplyScalar(targetWorldHeight / h);
    root.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(root);
    root.position.x -= (box.min.x + box.max.x) * 0.5;
    root.position.z -= (box.min.z + box.max.z) * 0.5;
    root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
  }

  /**
   * Shared atlas material plus FBX templates: transmission (`tower1.fbx`),
   * defense base (`base1.FBX`) and weapon (`weapon1.FBX`). None are added to the scene.
   */
  _loadFbxBuildables() {
    const atlas = new THREE.TextureLoader().load('assets/textures/PolygonSciFiCity_Texture_01_A.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    this._fbxSharedMat = new THREE.MeshPhongMaterial({
      map:       atlas,
      specular:  0x111122,
      shininess: 25,
    });

    const fbx = new FBXLoader();
    fbx.setResourcePath('assets/textures/');
    const err = (label, e) => console.error(`${label} FBX load failed:`, e);

    fbx.load(
      'assets/obj/tower1.fbx',
      (obj) => {
        this._stripLightsApplyMat(obj, this._fbxSharedMat);
        this._fitObjectToGroundHeightCenterXZ(obj, TRANSMISSION_VISUAL_HEIGHT);
        this._transmissionFbxTemplate = obj;
      },
      undefined,
      (e) => err('Transmission mast', e),
    );

    fbx.load(
      'assets/obj/base1.FBX',
      (obj) => {
        this._stripLightsApplyMat(obj, this._fbxSharedMat);
        this._fitObjectToGroundHeightCenterXZ(obj, DEFENSE_BASE_TARGET_HEIGHT);
        const box = new THREE.Box3().setFromObject(obj);
        const span = box.max.y - box.min.y;
        this._defenseBaseTopY = span > 1e-6 ? box.max.y : 0.12;
        this._defenseBaseTemplate = obj;
      },
      undefined,
      (e) => err('Defense tower base', e),
    );

    fbx.load(
      'assets/obj/weapon1.FBX',
      (obj) => {
        this._stripLightsApplyMat(obj, this._fbxSharedMat);
        this._fitObjectToGroundHeightCenterXZ(obj, DEFENSE_WEAPON_TARGET_HEIGHT);
        const box = new THREE.Box3().setFromObject(obj);
        const span = box.max.y - box.min.y;
        this._defenseWeaponBeamLocalY = span > 1e-6 ? box.max.y * 0.88 : 0.06;
        this._defenseWeaponTemplate = obj;
      },
      undefined,
      (e) => err('Defense tower weapon', e),
    );
  }

  _loadHangar() {
    const atlas = new THREE.TextureLoader().load('assets/textures/PolygonSciFiCity_Texture_01_A.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshPhongMaterial({
      map:       atlas,
      specular:  0x111122,
      shininess: 25,
    });

    const fbxLoader = new FBXLoader();
    fbxLoader.setResourcePath('assets/textures/');
    fbxLoader.load(
      'assets/obj/SM_Bld_HangarPlatform_01.fbx',
      (obj) => {
        // Strip any lights baked into the FBX — they toggle with visibility
        // and cause the whole scene to flicker when the hangar scrolls off-screen.
        const embedded = [];
        obj.traverse(child => {
          if (child.isLight) embedded.push(child);
          if (child.isMesh)  child.material = mat;
        });
        embedded.forEach(l => l.parent?.remove(l));

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
    // Ambient + directional lights for all OBJ/FBX models.
    // Combined intensity kept at ~1.0 so fully-lit surfaces don't saturate to white.
    const ambient = new THREE.AmbientLight(0xe8c4a8, 0.26);
    this.scene.add(ambient);
    const sun = new THREE.DirectionalLight(0xffd8b8, 0.72);
    sun.position.set(-5.5, 7.5, 3.5);
    this.scene.add(sun);

    const atlas   = new THREE.TextureLoader().load('assets/textures/PolygonSciFiCity_Texture_01_A.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    const shipMat = new THREE.MeshPhongMaterial({
      map:       atlas,
      specular:  0x111122,
      shininess: 25,
    });

    const fbxLoader = new FBXLoader();
    fbxLoader.setResourcePath('assets/textures/');  // suppresses the .psd 404
    fbxLoader.load(
      'assets/obj/SM_Ship_Fighter_01.fbx',
      (obj) => {
        // Strip any lights baked into the FBX (same reason as hangar).
        const embedded = [];
        obj.traverse(child => {
          if (child.isLight) embedded.push(child);
          if (child.isMesh)  child.material = shipMat;
        });
        embedded.forEach(l => l.parent?.remove(l));

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
    const HANDLED = new Set([
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyT',
    ]);
    window.addEventListener('keydown', e => {
      this._keys[e.code] = true;
      if (this._running && e.code === 'KeyT' && !e.repeat) {
        if (this._dockModalOpen && this._pendingTowerPlace) {
          this._closeDockShop();
        }
        if (!this._dockModalOpen) {
          this._tryPlaceTower();
          e.preventDefault();
        }
      }
      if (this._running && HANDLED.has(e.code)) e.preventDefault();
      // Toggle flow-field overlay
      if (this._running && e.code === 'KeyF') {
        this._showFlowField = !this._showFlowField;
        if (this._flowRadarHud) {
          this._flowRadarHud.style.display = this._showFlowField ? 'flex' : 'none';
        } else if (this._flowCanvas) {
          this._flowCanvas.style.display = this._showFlowField ? 'block' : 'none';
        }
      }
    });
    window.addEventListener('keyup', e => { this._keys[e.code] = false; });
  }

  // ── HUD ────────────────────────────────────────────────────────────────────

  _showGameIntro() {
    if (!this._introModalEl) return;
    this._introBlocking = true;
    this._introModalEl.classList.remove('hidden');
    this._introModalEl.setAttribute('aria-hidden', 'false');
    document.getElementById('btn-game-intro-continue')?.focus();
  }

  _hideGameIntro() {
    this._introBlocking = false;
    if (!this._introModalEl) return;
    this._introModalEl.classList.add('hidden');
    this._introModalEl.setAttribute('aria-hidden', 'true');
  }

  _bindHUD() {
    document.getElementById('btn-game-intro-continue')?.addEventListener('click', () => {
      this._hideGameIntro();
      this.audioManager?.startBackgroundLoop();
    });
    document.getElementById('btn-game-settings')?.addEventListener('click', () => {
      this.onOpenSettings?.();
    });
    document.getElementById('btn-game-end-rate')?.addEventListener('click', () => {
      if (!JAM_RATE_URL) return;
      window.open(JAM_RATE_URL, '_blank', 'noopener,noreferrer');
    });
    document.getElementById('btn-game-end-main-menu')?.addEventListener('click', () => {
      this._gameEnded = false;
      this._hideGameEndModal();
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
      const res = new THREE.Vector2(w, h);
      for (const L of this._lasers) L.mat.resolution.copy(res);
    });
  }
}
