/**
 * MenuScreen
 *
 * Handles button wiring and runs a Three.js planet-shader background
 * on #menu-bg-canvas while the menu is visible.
 *
 * Ported from a Shadertoy volumetric planet shader.
 * Uses `assets/textures/iChannel0.png` and `iChannel1.jpg` for the original
 * `texture(iChannel0, …)` / `texture(iChannel1, …)` lookups.
 */

import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

/** Same unit scale as GameScreen FBX assets. */
const OBJ_SCALE = 0.0001;

/** Start transition timing (must match `_loop`). */
const ZOOM_MS = 16000;
const BLACKOUT_START_MS = 12160;
const BLACKOUT_MS = 2400;
const END_MS = BLACKOUT_START_MS + BLACKOUT_MS + 700;

/** Ship covers the first half of its intro arc in this window, then eases with the planet zoom. */
const SHIP_DASH_MS = 4000;

/** Hull fades in over this window; warp stays keyed to planet time so effects lead the ship. */
const SHIP_FADEIN_MS = 1000;

// ── GLSL source ────────────────────────────────────────────────────────────

const VERT = /* glsl */`
  attribute vec3 position;
  void main() {
    gl_Position = vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  precision mediump float;
  uniform float uTime;
  uniform vec2  uResolution;
  uniform float uZoomT;
  uniform float uBlackout;
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;

  // ── Planet / atmosphere params ─────────────────────────────────────────
  const float sphsize     = 0.7;
  const float dist        = 0.27;
  const float perturb     = 0.3;
  const float displacement= 0.015;
  const float windspeed   = 0.04;
  const float steps       = 110.0;
  const float stepsize    = 0.025;
  const float brightness  = 0.43;
  const vec3  planetcolor = vec3(0.65, 0.22, 0.12);   // reddish alien world
  const float fade        = 0.005;
  const float glow        = 3.5;
  const int   iterations  = 13;
  const float fractparam  = 0.7;
  const vec3  offset      = vec3(1.5, 2.0, -1.5);

  float wind(vec3 p) {
    float d = max(0.0, dist - max(0.0, length(p) - sphsize) / sphsize) / dist;
    float x = max(0.2, p.x * 2.0);
    p.y *= 1.0 + max(0.0, -p.x - sphsize * 0.25) * 1.5;
    p -= d * normalize(p) * perturb;
    p += vec3(uTime * windspeed, 0.0, 0.0);
    p = abs(fract((p + offset) * 0.1) - 0.5);
    for (int i = 0; i < iterations; i++) {
      p = abs(p) / dot(p, p) - fractparam;
    }
    return length(p) * (1.0 + d * glow * x) + d * glow * x;
  }

  void main() {
    vec2 fragCoord = gl_FragCoord.xy;
    vec2 uv = fragCoord / uResolution - 0.5;
    uv.x *= uResolution.x / uResolution.y;

    // Zoom toward left side of the frame (aspect-corrected space: negative x = left)
    vec2 focal = vec2(-0.42, 0.0);
    float zoomAmt = mix(1.0, 5.5, clamp(uZoomT, 0.0, 1.0));
    uv = focal + (uv - focal) / max(zoomAmt, 0.001);

    vec3 dir  = vec3(uv, 1.0);

    // Ray origin — dither from iChannel0 (matches Shadertoy)
    float dither = texture2D(iChannel0, uv * 0.5 + vec2(uTime, 0.0)).x * stepsize;
    vec3  from   = vec3(0.0, 0.0, -2.0 + dither);

    float v = 0.0, l = -0.0001;
    float t = uTime * windspeed * 0.2;

    for (float r = 10.0; r < steps; r++) {
      vec3  p  = from + r * dir * stepsize;
      float tx = texture2D(iChannel0, uv * 0.2 + vec2(t, 0.0)).x * displacement;
      if (length(p) - sphsize - tx > 0.0) {
        v += min(50.0, wind(p)) * max(0.0, 1.0 - r * fade);
      } else if (l < 0.0) {
        float surf = texture2D(
          iChannel1,
          uv * vec2(2.0, 1.0) * (1.0 + p.z * 0.5) + vec2(tx + t * 0.5, 0.0)
        ).x;
        l = pow(max(0.53, dot(normalize(p), normalize(vec3(-1.0, 0.5, -0.3)))), 4.0)
            * (0.5 + surf * 2.0);
      }
    }

    v /= steps;
    v *= brightness;

    vec3 col = vec3(v * 1.25, v * v, v * v * v) + l * planetcolor;
    // Vignette
    vec2 uvRaw = fragCoord / uResolution - 0.5;
    col *= 1.0 - length(pow(abs(uvRaw), vec2(5.0))) * 14.0;

    col = mix(col, vec3(0.0), clamp(uBlackout, 0.0, 1.0));
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Ease for zoom (slow in / slow out). */
function _easeInOutCubic(t) {
  const x = Math.max(0, Math.min(1, t));
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Fast-out for the initial ship dash (covers half the arc quickly). */
function _easeOutCubic(t) {
  const x = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - x, 3);
}

/** 0..1 ship path: 0–50% in SHIP_DASH_MS (ease-out), 50–100% over remaining ZOOM_MS leg (ease-in-out). */
function _shipIntroPathT(elapsed) {
  if (elapsed <= SHIP_DASH_MS) {
    const p = Math.max(0, Math.min(1, elapsed / SHIP_DASH_MS));
    return 0.5 * _easeOutCubic(p);
  }
  const p2 = Math.max(
    0,
    Math.min(1, (elapsed - SHIP_DASH_MS) / (ZOOM_MS - SHIP_DASH_MS)),
  );
  return 0.5 + 0.5 * _easeInOutCubic(p2);
}

// ── Warp bubble (fresnel shell, intro layer only) ───────────────────────────

const WARP_BUBBLE_VERT = /* glsl */`
  varying vec3 vNorm;
  varying vec3 vView;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vView = -mvPosition.xyz;
    vNorm = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const WARP_BUBBLE_FRAG = /* glsl */`
  precision mediump float;
  varying vec3 vNorm;
  varying vec3 vView;
  uniform float uPulse;
  uniform float uTime;
  void main() {
    vec3 n = normalize(vNorm);
    vec3 v = normalize(vView);
    float nd = clamp(abs(dot(n, v)), 0.0, 1.0);
    float rim = pow(1.0 - nd, 3.2);
    float thin = pow(1.0 - nd, 10.0);
    float wob = 0.04 * sin(uTime * 6.0 + n.x * 14.0 + n.y * 11.0);
    float f = rim * (0.92 + wob) + thin * 0.55;
    vec3 cDeep = vec3(0.02, 0.25, 0.95);
    vec3 cHot = vec3(0.75, 0.98, 1.0);
    vec3 col = mix(cDeep, cHot, f);
    float a = clamp(f * 0.62 * uPulse + rim * 0.18 * uPulse, 0.0, 0.92);
    gl_FragColor = vec4(col * uPulse * 1.65, a);
  }
`;

// ── MenuScreen class ───────────────────────────────────────────────────────

export class MenuScreen {
  constructor() {
    this.onStartGame    = null;
    this.onOpenSettings = null;

    this._animFrameId = null;
    this._running     = false;
    this._transitioning = false;
    this._transitionStart = 0;
    /** @type {null | (() => void)} */
    this._transitionResolve = null;

    this._initRenderer();
    this._initIntroLayer();
    this._bindButtons();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._transitioning = false;
    this._transitionStart = 0;
    this._transitionResolve = null;
    if (this._uniforms) {
      this._uniforms.uZoomT.value = 0;
      this._uniforms.uBlackout.value = 0;
    }
    if (this._cruiserAnimGroup) {
      this._cruiserAnimGroup.visible = false;
    }
    if (this._warpExitFx) {
      this._warpExitFx.visible = false;
    }
    if (this._warpPoint) {
      this._warpPoint.intensity = 0;
    }
    if (this._warpPointCore) {
      this._warpPointCore.intensity = 0;
    }
    this._introWarpPrevMs = null;
    if (this._cruiserShipMat) {
      this._cruiserShipMat.opacity = 1;
    }
    document.querySelector('.menu-content')?.classList.remove('menu-content--to-game');
    const startBtn = document.getElementById('btn-start');
    if (startBtn) startBtn.disabled = false;

    this._running = true;
    this._clock.start();
    this._loop();
  }

  stop() {
    this._running = false;
    this._transitioning = false;
    this._transitionStart = 0;
    this._transitionResolve = null;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this._clock.stop();
  }

  /**
   * Cinematic handoff: fade menu UI, planet zoom, fade to black.
   * @returns {Promise<void>}
   */
  playStartTransition() {
    if (this._transitioning) return Promise.resolve();
    return new Promise((resolve) => {
      this._transitioning = true;
      this._transitionStart = performance.now();
      this._transitionResolve = resolve;
      this._introWarpPrevMs = null;
      this._resetWarpParticles();
      document.querySelector('.menu-content')?.classList.add('menu-content--to-game');
      const startBtn = document.getElementById('btn-start');
      if (startBtn) startBtn.disabled = true;
    });
  }

  // ── Three.js planet background ──────────────────────────────────────────

  _initRenderer() {
    const canvas = document.getElementById('menu-bg-canvas');

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);

    this._clock = new THREE.Clock(false);

    const placeholderData = new Uint8Array([128, 128, 128, 255]);
    const placeholderTex = new THREE.DataTexture(placeholderData, 1, 1);
    placeholderTex.colorSpace = THREE.NoColorSpace;
    placeholderTex.needsUpdate = true;

    const configureChannel = (tex) => {
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = THREE.NoColorSpace;
      tex.flipY = false;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
    };

    // Use the actual framebuffer dimensions (CSS size × DPR) so the shader
    // UV calculation matches the real pixel grid regardless of device pixel ratio.
    this._uniforms = {
      uTime:       { value: 0 },
      uResolution: { value: new THREE.Vector2(
        canvas.width,   // set by setSize × pixelRatio
        canvas.height,
      )},
      uZoomT:      { value: 0 },
      uBlackout:   { value: 0 },
      iChannel0:   { value: placeholderTex },
      iChannel1:   { value: placeholderTex },
    };

    const loader = new THREE.TextureLoader();
    loader.load(
      'assets/textures/iChannel0.png',
      (tex) => {
        configureChannel(tex);
        this._uniforms.iChannel0.value = tex;
      },
      undefined,
      (err) => console.error('MenuScreen: failed to load iChannel0.png', err),
    );
    loader.load(
      'assets/textures/iChannel1.jpg',
      (tex) => {
        configureChannel(tex);
        this._uniforms.iChannel1.value = tex;
      },
      undefined,
      (err) => console.error('MenuScreen: failed to load iChannel1.jpg', err),
    );

    // Full-screen triangle covers the viewport without edge gaps
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(
      new Float32Array([-1, -1, 0,  3, -1, 0,  -1, 3, 0]), 3
    ));
    const mat = new THREE.RawShaderMaterial({
      vertexShader:   VERT,
      fragmentShader: FRAG,
      uniforms:       this._uniforms,
      glslVersion:    THREE.GLSL1,
    });

    this._scene  = new THREE.Scene();
    this._camera = new THREE.Camera();
    this._scene.add(new THREE.Mesh(geo, mat));

    window.addEventListener('resize', () => this._onResize());
  }

  /** Second WebGL layer: cruiser FBX composited over the planet shader. */
  _initIntroLayer() {
    const canvas = document.getElementById('menu-intro-canvas');
    if (!canvas) return;

    this._introRenderer = new THREE.WebGLRenderer({
      canvas,
      antialias:   true,
      alpha:       true,
      depth:       true,
    });
    this._introRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._introRenderer.setSize(window.innerWidth, window.innerHeight);
    this._introRenderer.setClearColor(0x000000, 0);
    this._introRenderer.toneMapping = THREE.NoToneMapping;

    this._introScene = new THREE.Scene();
    const introEl = this._introRenderer.domElement;
    this._introCamera = new THREE.PerspectiveCamera(
      48,
      introEl.width / Math.max(1, introEl.height),
      0.05,
      80,
    );
    this._introCamera.position.set(0.22, 0.2, 4.35);
    this._introCamera.lookAt(0.02, 0.04, 0);

    const amb = new THREE.AmbientLight(0xe8c4a8, 0.32);
    const sun = new THREE.DirectionalLight(0xffd8b8, 0.68);
    sun.position.set(-4.2, 6.5, 2.8);
    this._introScene.add(amb, sun);

    this._cruiserAnimGroup = new THREE.Group();
    this._cruiserAnimGroup.visible = false;
    this._introScene.add(this._cruiserAnimGroup);

    this._warpExitFx = this._createWarpExitFx();
    this._introScene.add(this._warpExitFx);
    this._warpPoint = new THREE.PointLight(0x7aebff, 0, 18, 1.2);
    this._warpPoint.decay = 2;
    this._introScene.add(this._warpPoint);

    this._warpPointCore = new THREE.PointLight(0xffffff, 0, 10, 0.6);
    this._warpPointCore.decay = 2;
    this._introScene.add(this._warpPointCore);

    this._cruiserLoaded = false;
    this._cruiserShipMat = null;

    const atlas = new THREE.TextureLoader().load(
      'assets/textures/PolygonSciFiCity_Texture_01_A.png',
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
      },
    );
    const shipMat = new THREE.MeshPhongMaterial({
      map:       atlas,
      specular:  0x111122,
      shininess: 25,
    });
    shipMat.transparent = true;
    shipMat.opacity = 1;
    shipMat.depthWrite = false;
    this._cruiserShipMat = shipMat;

    const fbxLoader = new FBXLoader();
    fbxLoader.setResourcePath('assets/textures/');
    fbxLoader.load(
      'assets/obj/SM_Ship_Cruiser_02.fbx',
      (obj) => {
        const embedded = [];
        obj.traverse((child) => {
          if (child.isLight) embedded.push(child);
          if (child.isMesh) child.material = shipMat;
        });
        embedded.forEach((l) => l.parent?.remove(l));

        obj.scale.setScalar(OBJ_SCALE);
        obj.rotation.y = Math.PI;
        this._cruiserAnimGroup.add(obj);
        this._cruiserLoaded = true;
        if (this._transitioning) {
          this._cruiserAnimGroup.visible = true;
        }
      },
      undefined,
      (err) => console.error('MenuScreen: cruiser FBX load failed:', err),
    );
  }

  /**
   * Layered warp exit: fresnel bubble, bow torus, flash disc, particle stream.
   * @returns {THREE.Group}
   */
  _createWarpExitFx() {
    const root = new THREE.Group();
    root.name = 'warpExitFx';
    root.visible = false;

    this._warpBubbleUniforms = {
      uPulse: { value: 1 },
      uTime:  { value: 0 },
    };
    this._warpBubbleMat = new THREE.ShaderMaterial({
      glslVersion:    THREE.GLSL1,
      uniforms:       this._warpBubbleUniforms,
      vertexShader:   WARP_BUBBLE_VERT,
      fragmentShader: WARP_BUBBLE_FRAG,
      transparent:    true,
      depthWrite:     false,
      side:           THREE.DoubleSide,
      blending:       THREE.AdditiveBlending,
    });
    const bubble = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), this._warpBubbleMat);
    bubble.name = 'warpBubble';
    root.add(bubble);
    this._warpBubbleMesh = bubble;

    this._warpBowMat = new THREE.MeshBasicMaterial({
      color: 0xe8fbff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const bow = new THREE.Mesh(
      new THREE.TorusGeometry(0.95, 0.036, 14, 72),
      this._warpBowMat,
    );
    bow.rotation.x = Math.PI / 2;
    bow.rotation.y = Math.PI / 2;
    bow.name = 'warpBow';
    root.add(bow);
    this._warpBowRing = bow;

    this._warpFlashMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const flash = new THREE.Mesh(new THREE.CircleGeometry(1.12, 48), this._warpFlashMat);
    flash.rotation.y = Math.PI / 2;
    flash.position.x = 0.1;
    root.add(flash);
    this._warpFlashMesh = flash;

    const PART = 720;
    const pPos = new Float32Array(PART * 3);
    this._warpParticleVel = new Float32Array(PART * 3);
    for (let i = 0; i < PART; i++) {
      pPos[i * 3 + 0] = 1.2 + Math.random() * 4.2;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 2.0;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
      this._warpParticleVel[i * 3 + 0] = -2.2 - Math.random() * 6.5;
      this._warpParticleVel[i * 3 + 1] = (Math.random() - 0.5) * 2.0;
      this._warpParticleVel[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    this._warpParticleGeo = pGeo;
    this._warpParticleMat = new THREE.PointsMaterial({
      color:           0xb5ecff,
      size:            0.12,
      transparent:     true,
      opacity:         0.92,
      blending:        THREE.AdditiveBlending,
      depthWrite:      false,
      sizeAttenuation: true,
    });
    const pts = new THREE.Points(pGeo, this._warpParticleMat);
    pts.name = 'warpParticles';
    root.add(pts);
    this._warpParticles = pts;

    return root;
  }

  _resetWarpParticles() {
    if (!this._warpParticleGeo || !this._warpParticleVel) return;
    const pos = this._warpParticleGeo.attributes.position.array;
    const n = pos.length / 3;
    for (let i = 0; i < n; i++) {
      pos[i * 3 + 0] = 1.0 + Math.random() * 4.4;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 2.0;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
      this._warpParticleVel[i * 3 + 0] = -2.4 - Math.random() * 6.2;
      this._warpParticleVel[i * 3 + 1] = (Math.random() - 0.5) * 2.0;
      this._warpParticleVel[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
    }
    this._warpParticleGeo.attributes.position.needsUpdate = true;
  }

  /**
   * @param {number} zoomT   Eased 0..1, same as planet `uZoomT`.
   * @param {number} elapsed ms since transition start.
   * @param {number} blackout 0..1
   */
  _updateCruiserPose(zoomT, elapsed, blackout) {
    if (!this._cruiserAnimGroup || !this._introCamera) return;

    const t = Math.max(0, Math.min(1, zoomT));
    const shipReveal = THREE.MathUtils.smoothstep(elapsed, 0, SHIP_FADEIN_MS);
    const pathT = Math.max(0, Math.min(1, _shipIntroPathT(elapsed)));
    const wobble = Math.sin(elapsed * 0.012) * 0.04 * (1 - pathT);

    // Cinema pose (tuned): right entry x0, hero scale0 — edit these together.
    const x0 = 4.4;
    const x1 = -0.02;
    const y0 = 0.38;
    const y1 = -0.14;
    const z0 = 0.22;
    const z1 = -0.62;

    this._cruiserAnimGroup.position.set(
      THREE.MathUtils.lerp(x0, x1, pathT) + wobble * 0.35,
      THREE.MathUtils.lerp(y0, y1, pathT) + wobble,
      THREE.MathUtils.lerp(z0, z1, pathT),
    );

    const scale0 = 25.8;
    const scale1 = 0.09;
    const shipScale = THREE.MathUtils.lerp(scale0, scale1, Math.pow(pathT, 0.92));
    this._cruiserAnimGroup.scale.setScalar(shipScale);

    this._cruiserAnimGroup.rotation.set(
      THREE.MathUtils.lerp(0.12, 0.78, pathT),
      THREE.MathUtils.lerp(-0.35, -0.08, pathT),
      THREE.MathUtils.lerp(-0.18, -0.52, pathT) + wobble * 0.5,
    );

    // Slight camera push-in follows the ship path (dash then planet-eased pull).
    this._introCamera.position.x = 0.22 + pathT * 0.1;
    this._introCamera.position.y = 0.2 - pathT * 0.06;
    this._introCamera.position.z = 4.35 - pathT * 0.55;
    this._introCamera.lookAt(
      THREE.MathUtils.lerp(0.02, -0.08, pathT),
      THREE.MathUtils.lerp(0.04, -0.02, pathT),
      0,
    );

    // Warp exit: full strength from planet `t`; hull uses `shipReveal` so warp leads the fade-in.
    const warpStrength = 1 - THREE.MathUtils.smoothstep(t, 0, 0.5);
    const ship = this._cruiserAnimGroup.position;

    if (this._warpExitFx) {
      const pulse = 1 + 0.22 * Math.sin(elapsed * 0.072);
      const dim = 1 - blackout * 0.9;
      const entryFlash = 1 - THREE.MathUtils.smoothstep(elapsed, 0, 480);

      const dt = this._introWarpPrevMs == null
        ? 0.016
        : Math.min(0.052, (elapsed - this._introWarpPrevMs) * 0.001);
      this._introWarpPrevMs = elapsed;

      if (warpStrength >= 0.018) {
        this._warpExitFx.visible = true;
        this._warpExitFx.position.copy(ship);
        this._warpExitFx.quaternion.identity();

        const bubbleScale = 2.35 + 1.1 * warpStrength * pulse + 0.5 * entryFlash;
        if (this._warpBubbleMesh) {
          this._warpBubbleMesh.scale.setScalar(bubbleScale);
        }
        if (this._warpBubbleUniforms) {
          this._warpBubbleUniforms.uTime.value = elapsed * 0.001;
          this._warpBubbleUniforms.uPulse.value =
            dim * warpStrength * (0.88 + 0.52 * entryFlash);
        }

        if (this._warpBowRing) {
          const bowS = (0.82 + (1 - warpStrength) * 2.35 + 0.75 * entryFlash) * pulse;
          this._warpBowRing.scale.setScalar(bowS);
          this._warpBowRing.rotation.z = elapsed * 0.0011;
        }
        if (this._warpBowMat) {
          this._warpBowMat.opacity =
            (0.52 + 0.48 * warpStrength + 0.58 * entryFlash) * dim;
        }

        if (this._warpFlashMat) {
          this._warpFlashMat.opacity =
            (0.5 + 0.38 * pulse + 0.55 * entryFlash) * warpStrength * warpStrength * dim;
        }

        if (this._warpParticleGeo && this._warpParticleVel) {
          const pos = this._warpParticleGeo.attributes.position.array;
          const nP = pos.length / 3;
          const spdMul = warpStrength * (1.45 + 0.95 * (1 - warpStrength));
          for (let i = 0; i < nP; i++) {
            pos[i * 3 + 0] += this._warpParticleVel[i * 3 + 0] * dt * spdMul * 4.2;
            pos[i * 3 + 1] += this._warpParticleVel[i * 3 + 1] * dt * spdMul * 2.2;
            pos[i * 3 + 2] += this._warpParticleVel[i * 3 + 2] * dt * spdMul * 2.2;
            if (pos[i * 3 + 0] < -0.55) {
              pos[i * 3 + 0] = 1.4 + Math.random() * 4.0;
              pos[i * 3 + 1] = (Math.random() - 0.5) * 2.0;
              pos[i * 3 + 2] = (Math.random() - 0.5) * 2.0;
            }
          }
          this._warpParticleGeo.attributes.position.needsUpdate = true;
        }
        if (this._warpParticleMat) {
          this._warpParticleMat.opacity =
            (0.58 + 0.42 * warpStrength + 0.38 * entryFlash) * dim;
        }

        if (this._warpPoint) {
          this._warpPoint.position.copy(ship);
          this._warpPoint.position.x += 0.38 * warpStrength;
          this._warpPoint.intensity =
            (9 + 24 * entryFlash + 7 * warpStrength) * warpStrength * dim;
        }
        if (this._warpPointCore) {
          this._warpPointCore.position.copy(ship);
          this._warpPointCore.intensity =
            (16 * entryFlash * warpStrength + 5 * warpStrength) * dim;
        }
      } else {
        this._warpExitFx.visible = false;
        if (this._warpPoint) this._warpPoint.intensity = 0;
        if (this._warpPointCore) this._warpPointCore.intensity = 0;
      }
    }

    if (this._cruiserShipMat) {
      this._cruiserShipMat.opacity = Math.max(0, shipReveal * (1 - blackout * 0.98));
    }
  }

  _loop() {
    if (!this._running) return;
    this._animFrameId = requestAnimationFrame(() => this._loop());
    this._uniforms.uTime.value = this._clock.getElapsedTime();

    if (this._transitioning && this._transitionStart > 0) {
      const elapsed = performance.now() - this._transitionStart;

      const zoomPhase = Math.min(1, elapsed / ZOOM_MS);
      const zoomT = _easeInOutCubic(zoomPhase);
      this._uniforms.uZoomT.value = zoomT;

      let bo = 0;
      if (elapsed >= BLACKOUT_START_MS) {
        bo = Math.min(1, (elapsed - BLACKOUT_START_MS) / BLACKOUT_MS);
      }
      this._uniforms.uBlackout.value = bo;

      if (this._cruiserAnimGroup && this._cruiserLoaded) {
        this._updateCruiserPose(zoomT, elapsed, bo);
        this._cruiserAnimGroup.visible = true;
      }

      if (elapsed >= END_MS) {
        this._uniforms.uBlackout.value = 1;
        this._transitioning = false;
        this._transitionStart = 0;
        if (this._cruiserAnimGroup) {
          this._cruiserAnimGroup.visible = false;
        }
        if (this._warpExitFx) {
          this._warpExitFx.visible = false;
        }
        if (this._warpPoint) {
          this._warpPoint.intensity = 0;
        }
        if (this._warpPointCore) {
          this._warpPointCore.intensity = 0;
        }
        if (this._cruiserShipMat) {
          this._cruiserShipMat.opacity = 1;
        }
        const done = this._transitionResolve;
        this._transitionResolve = null;
        done?.();
      }
    } else if (this._cruiserAnimGroup) {
      this._cruiserAnimGroup.visible = false;
      if (this._warpExitFx) this._warpExitFx.visible = false;
      if (this._warpPoint) this._warpPoint.intensity = 0;
      if (this._warpPointCore) this._warpPointCore.intensity = 0;
    }

    this._renderer.render(this._scene, this._camera);

    if (
      this._introRenderer &&
      this._introScene &&
      this._introCamera &&
      this._cruiserAnimGroup?.visible
    ) {
      this._introRenderer.render(this._introScene, this._introCamera);
    }
  }

  _onResize() {
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    const canvas = this._renderer.domElement;
    this._uniforms.uResolution.value.set(canvas.width, canvas.height);
    if (this._introRenderer && this._introCamera) {
      this._introRenderer.setSize(window.innerWidth, window.innerHeight);
      const el = this._introRenderer.domElement;
      this._introCamera.aspect = el.width / Math.max(1, el.height);
      this._introCamera.updateProjectionMatrix();
    }
  }

  // ── Buttons ──────────────────────────────────────────────────────────────

  _bindButtons() {
    document.getElementById('btn-start')?.addEventListener('click', () => {
      this.onStartGame?.();
    });
    document.getElementById('btn-menu-settings')?.addEventListener('click', () => {
      this.onOpenSettings?.();
    });
  }
}
