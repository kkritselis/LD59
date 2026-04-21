/**
 * ResourceManager
 *
 * Scatters collectible resource nodes across the terrain.
 * When the ship flies over one, a translucent tractor-beam cone appears and
 * the resource animates up toward the ship before fading out and being counted.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { sampleHeight, WATER_LEVEL } from './terrain.js';
import { FLOW_UV_MIN, FLOW_UV_MAX } from './EnemyManager.js';

// ── Tunables ────────────────────────────────────────────────────────────────

const RESOURCE_COUNT  = 100;   // how many nodes to scatter
const PICKUP_RADIUS   = 0.05;  // UV units from ship to trigger beam
const CANCEL_RADIUS   = 0.14;  // UV units — beam cancels if player strays this far
const ATTRACT_RATE    = 2.5;   // lerp rate pulling resource toward ship (per second)
const BEAM_BASE_R     = 0.14;  // tractor-beam cone base radius (world units)
const BEAM_OPACITY    = 0.25;
const ENEMY_DROP_CHANCE = 0.3;

/** Same Synty FBX scale as `GameScreen.js` ship / hangar (`OBJ_SCALE`). */
const OBJ_SCALE = 0.0001;
/** Multiplier on top of `OBJ_SCALE` for pickup mesh size (dial in here). */
const RESOURCE_SCALE = 0.075;
/** Uniform scale for resource FBX clones — single source of truth in `update`. */
const RESOURCE_MESH_SCALE = OBJ_SCALE * RESOURCE_SCALE;
/** Tractor beam world height (cap `shipY - baseY` so the cone cannot span the whole map). */
const BEAM_HEIGHT_MIN = 0.06;
const BEAM_HEIGHT_MAX = 2.8;

const RESOURCE_URLS = ['assets/obj/resource1.fbx', 'assets/obj/resource2.fbx'];

// ── ResourceManager ──────────────────────────────────────────────────────────

export class ResourceManager {
  /**
   * @param {THREE.Scene} scene
   * @param {number} heightScale
   * @param {number} uScale
   */
  constructor(scene, heightScale, uScale) {
    this._scene = scene;
    this._HS    = heightScale;
    this._US    = uScale;

    /** @type {{ mesh: THREE.Object3D, beamMesh: THREE.Mesh|null, uvx: number, uvy: number, baseY: number, animY: number, state: string, credit?: number, visualScale?: number }[]} */
    this._resources = [];
    this._collected = 0;

    /** Prepared roots (never in scene); clones pick one at random. */
    this._resourceTemplates = [];
    this._resourceMat = null;
    this._useSphereFallback = false;
    this._fallbackGeo = null;

    this._pendingScatterAfterLoad = true;

    // Shared cone geometry for beam (height=1 so scale.y = world distance)
    this._beamGeo = new THREE.ConeGeometry(BEAM_BASE_R, 1, 10, 1, true);

    this._initResourceModels();
  }

  _stripLights(root) {
    const lights = [];
    root.traverse((ch) => {
      if (ch.isLight) lights.push(ch);
    });
    lights.forEach((l) => l.parent?.remove(l));
  }

  _applyMat(root, mat) {
    root.traverse((ch) => {
      if (ch.isMesh && mat) ch.material = mat;
    });
  }

  /** FBX pickups use `RESOURCE_MESH_SCALE`; sphere fallback uses geometry size and scale 1. */
  _pickupScaleBasis(mesh) {
    if (this._useSphereFallback && this._fallbackGeo && mesh.geometry === this._fallbackGeo) return 1;
    return RESOURCE_MESH_SCALE;
  }

  /** Synty pipeline: uniform `OBJ_SCALE` like the ship — no bbox rescale (that broke visibility). */
  _preparePickupTemplate(root) {
    root.scale.setScalar(RESOURCE_MESH_SCALE);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    root.position.x -= (box.min.x + box.max.x) * 0.5;
    root.position.z -= (box.min.z + box.max.z) * 0.5;
    root.position.y -= box.min.y;
    root.updateMatrixWorld(true);
  }

  _initResourceModels() {
    const atlas = new THREE.TextureLoader().load('assets/textures/PolygonSciFiCity_Texture_01_A.png');
    atlas.colorSpace = THREE.SRGBColorSpace;
    this._resourceMat = new THREE.MeshPhongMaterial({
      map:       atlas,
      specular:  0x111122,
      shininess: 60,
      emissive:  0x0a1530,
    });

    let pending = RESOURCE_URLS.length;
    const fbx = new FBXLoader();
    fbx.setResourcePath('assets/textures/');

    const finishOne = () => {
      pending -= 1;
      if (pending > 0) return;
      if (this._resourceTemplates.length === 0) {
        this._useSphereFallback = true;
        this._fallbackGeo = new THREE.SphereGeometry(0.02, 8, 6);
      }
      if (this._pendingScatterAfterLoad) {
        this._pendingScatterAfterLoad = false;
        this._scatter();
      }
    };

    for (const url of RESOURCE_URLS) {
      fbx.load(
        url,
        (obj) => {
          this._stripLights(obj);
          this._applyMat(obj, this._resourceMat);
          this._preparePickupTemplate(obj);
          this._resourceTemplates.push(obj);
          finishOne();
        },
        undefined,
        (err) => {
          console.error(`[ResourceManager] FBX load failed (${url}):`, err);
          finishOne();
        },
      );
    }
  }

  /** Clone a random resource mesh with random yaw (local Y). */
  _createPickupMesh() {
    if (this._useSphereFallback && this._fallbackGeo) {
      return new THREE.Mesh(this._fallbackGeo, this._resourceMat);
    }
    const n = this._resourceTemplates.length;
    const tpl = this._resourceTemplates[n === 1 ? 0 : Math.floor(Math.random() * n)];
    const mesh = tpl.clone(true);
    this._applyMat(mesh, this._resourceMat);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    return mesh;
  }

  // ── Placement ──────────────────────────────────────────────────────────────

  _scatter() {
    const MAX_TRIES = 800;
    let tries = 0;

    const flowSpan = FLOW_UV_MAX - FLOW_UV_MIN;
    const edgePad  = 0.02 * flowSpan;

    while (this._resources.length < RESOURCE_COUNT && tries < MAX_TRIES) {
      tries++;
      const uvx = FLOW_UV_MIN + edgePad + Math.random() * (flowSpan - 2 * edgePad);
      const uvy = FLOW_UV_MIN + edgePad + Math.random() * (flowSpan - 2 * edgePad);

      // Keep clear of the base pad
      const du = uvx - 0.5, dv = uvy - 0.5;
      if (du * du + dv * dv < 0.10 * 0.10) continue;

      // Height filter: above water, below the thin-air ceiling
      const h = sampleHeight(uvx, uvy);
      if (h < WATER_LEVEL + 0.02 || h > 0.52) continue;

      const mesh = this._createPickupMesh();
      this._scene.add(mesh);

      this._resources.push({
        mesh,
        beamMesh: null,
        uvx, uvy,
        baseY:  h * this._HS,
        animY:  h * this._HS,
        state:  'idle',   // 'idle' | 'attracted' | 'done'
        credit: 1,
        visualScale: 1,
      });
    }
    console.log(`[ResourceManager] Placed ${this._resources.length} resources`);
  }

  // ── Per-frame update ────────────────────────────────────────────────────────

  /**
   * @param {number}        delta
   * @param {number}        elapsed  total elapsed seconds (for bob)
   * @param {THREE.Vector2} off      terrain offset
   * @param {number}        shipY    ship world Y
   * @returns {number}  resource amount collected this frame (may be fractional, e.g. 0.5)
   */
  update(delta, elapsed, off, shipY) {
    const US   = this._US;
    const HALF = US * 0.5;

    // Current UV position of the ship
    const shipUVX = 0.5 + off.x / US;
    const shipUVY = 0.5 + off.y / US;

    let collectedAmount = 0;

    for (const r of this._resources) {
      if (r.state === 'done') continue;

      // World X/Z derived from UV + terrain offset
      const wx = (r.uvx - 0.5) * US - off.x;
      const wz = -(r.uvy - 0.5) * US + off.y;
      const inBounds = Math.abs(wx) < HALF && Math.abs(wz) < HALF;

      // UV distance from ship to this resource
      const duvx = r.uvx - shipUVX;
      const duvy = r.uvy - shipUVY;
      const uvDist = Math.sqrt(duvx * duvx + duvy * duvy);

      // ── Idle ──────────────────────────────────────────────────────────
      if (r.state === 'idle') {
        const vs = r.visualScale ?? 1;
        const basis = this._pickupScaleBasis(r.mesh);
        r.mesh.position.set(wx, r.baseY + 0.02, wz);
        r.mesh.scale.setScalar(Math.max(1e-8, basis * vs));
        r.mesh.visible = inBounds;

        if (uvDist < PICKUP_RADIUS && inBounds) {
          r.state  = 'attracted';
          r.animY  = r.baseY;

          // Per-beam material so each beam can fade independently
          const beamMat = new THREE.MeshBasicMaterial({
            color:      0x4488ff,
            transparent: true,
            opacity:    BEAM_OPACITY,
            side:       THREE.DoubleSide,
            depthWrite: false,
          });
          r.beamMesh = new THREE.Mesh(this._beamGeo, beamMat);
          this._scene.add(r.beamMesh);
        }

      // ── Attracted ─────────────────────────────────────────────────────
      } else if (r.state === 'attracted') {
        // Cancel beam if player strays too far
        if (uvDist > CANCEL_RADIUS) {
          r.state = 'idle';
          r.animY = r.baseY;
          const basis = this._pickupScaleBasis(r.mesh);
          r.mesh.scale.setScalar(Math.max(1e-8, basis * (r.visualScale ?? 1)));
          if (r.beamMesh) {
            this._scene.remove(r.beamMesh);
            r.beamMesh.material.dispose();
            r.beamMesh = null;
          }
          continue;
        }

        // Always pull at least slightly above ground so range/progress stay stable when the ship is low.
        const targetY = Math.max(r.baseY + 0.02, shipY - 0.05);
        r.animY = THREE.MathUtils.lerp(r.animY, targetY, Math.min(1, delta * ATTRACT_RATE));

        const range = Math.max(0.001, targetY - r.baseY);
        const rawP  = (r.animY - r.baseY) / range;
        const progress = Math.min(1, Math.max(0, Number.isFinite(rawP) ? rawP : 0));
        const shrink = Math.min(1, Math.max(0.05, 1 - progress * 0.95));

        const vs = r.visualScale ?? 1;
        const basis = this._pickupScaleBasis(r.mesh);
        const opacity = 1 - progress;
        r.mesh.visible = inBounds;
        r.mesh.position.set(wx, r.animY, wz);
        r.mesh.scale.setScalar(Math.max(1e-8, basis * vs * shrink));
        r.mat?.setValues?.({ opacity }); // no-op if mat has no opacity (PhongMaterial is opaque)

        // Tractor-beam cone hangs straight down from the ship
        if (r.beamMesh) {
          const vertDist = THREE.MathUtils.clamp(
            shipY - r.baseY,
            BEAM_HEIGHT_MIN,
            BEAM_HEIGHT_MAX,
          );
          r.beamMesh.position.set(0, shipY - vertDist * 0.5, 0);
          r.beamMesh.rotation.set(0, 0, 0);   // straight down, no tilt
          r.beamMesh.scale.set(1, vertDist, 1);
          r.beamMesh.visible = inBounds;
          r.beamMesh.material.opacity = BEAM_OPACITY * (1 - progress * 0.8);
        }

        // Collect when close enough
        if (progress >= 0.92) {
          collectedAmount += r.credit ?? 1;
          r.state = 'done';
          r.mesh.visible = false;
          if (r.beamMesh) {
            this._scene.remove(r.beamMesh);
            r.beamMesh.material.dispose();
            r.beamMesh = null;
          }
        }
      }
    }

    this._collected += collectedAmount;
    return collectedAmount;
  }

  /**
   * When an enemy dies (player kill), chance to spawn a smaller pickup worth 0.5 resources.
   * @param {number} uvx
   * @param {number} uvy
   */
  trySpawnEnemyDrop(uvx, uvy) {
    if (Math.random() >= ENEMY_DROP_CHANCE) return;

    const du = uvx - 0.5;
    const dv = uvy - 0.5;
    if (du * du + dv * dv < 0.07 * 0.07) return;

    const h = sampleHeight(uvx, uvy);
    if (h < WATER_LEVEL + 0.02 || h > 0.52) return;

    if (!this._useSphereFallback && this._resourceTemplates.length === 0) return;

    const mesh = this._createPickupMesh();
    const vs = 0.5;
    const basis = this._pickupScaleBasis(mesh);
    mesh.scale.setScalar(Math.max(1e-8, basis * vs));
    this._scene.add(mesh);

    this._resources.push({
      mesh,
      beamMesh: null,
      uvx, uvy,
      baseY:  h * this._HS,
      animY:  h * this._HS,
      state:  'idle',
      credit: 0.5,
      visualScale: vs,
    });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  removeAll() {
    for (const r of this._resources) {
      this._scene.remove(r.mesh);
      if (r.beamMesh) {
        this._scene.remove(r.beamMesh);
        r.beamMesh.material.dispose();
      }
    }
    this._resources = [];
  }

  /** Clear and scatter a fresh set of resource nodes (e.g. new game session). */
  respawn() {
    this.removeAll();
    if (this._useSphereFallback || this._resourceTemplates.length > 0) {
      this._scatter();
    } else {
      this._pendingScatterAfterLoad = true;
    }
  }

  dispose() {
    this.removeAll();
    this._fallbackGeo?.dispose();
    this._resourceMat?.dispose();
    this._beamGeo.dispose();
  }

  get collected() { return this._collected; }
  get remaining()  { return this._resources.filter(r => r.state !== 'done').length; }
}
