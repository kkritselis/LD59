/**
 * MenuScreen
 *
 * Handles button wiring and runs a Three.js planet-shader background
 * on #menu-bg-canvas while the menu is visible.
 *
 * Ported from a Shadertoy volumetric planet shader.
 * Both iChannel0 and iChannel1 texture lookups have been replaced with
 * procedural 2D value noise — no image assets required.
 */

import * as THREE from 'three';

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

  // ── Procedural noise (replaces iChannel0 and iChannel1) ───────────────
  float hash21(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }
  float noise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i),              hash21(i + vec2(1.0, 0.0)), u.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

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

    vec3 dir  = vec3(uv, 1.0);

    // Ray origin — slight procedural dither for anti-banding
    float dither = noise2D(uv * 80.0 + uTime * 2.0) * stepsize;
    vec3  from   = vec3(0.0, 0.0, -2.0 + dither);

    float v = 0.0, l = -0.0001;
    float t = uTime * windspeed * 0.2;

    for (float r = 10.0; r < steps; r++) {
      vec3  p  = from + r * dir * stepsize;
      // Hot-air displacement (replaces iChannel0 texture)
      float tx = noise2D(uv * 50.0 + vec2(t * 5.0, 0.0)) * displacement;
      if (length(p) - sphsize - tx > 0.0) {
        v += min(50.0, wind(p)) * max(0.0, 1.0 - r * fade);
      } else if (l < 0.0) {
        // Planet surface shading (replaces iChannel1 texture)
        float surf = noise2D(uv * vec2(120.0, 60.0) * (1.0 + p.z * 0.5)
                             + vec2(tx * 10.0 + t * 2.0, 0.0));
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

    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── MenuScreen class ───────────────────────────────────────────────────────

export class MenuScreen {
  constructor() {
    this.onStartGame    = null;
    this.onOpenSettings = null;

    this._animFrameId = null;
    this._running     = false;

    this._initRenderer();
    this._bindButtons();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start() {
    if (this._running) return;
    this._running = true;
    this._clock.start();
    this._loop();
  }

  stop() {
    this._running = false;
    if (this._animFrameId) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
    this._clock.stop();
  }

  // ── Three.js planet background ──────────────────────────────────────────

  _initRenderer() {
    const canvas = document.getElementById('menu-bg-canvas');

    this._renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    this._renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this._renderer.setSize(window.innerWidth, window.innerHeight);

    this._clock = new THREE.Clock(false);

    // Use the actual framebuffer dimensions (CSS size × DPR) so the shader
    // UV calculation matches the real pixel grid regardless of device pixel ratio.
    this._uniforms = {
      uTime:       { value: 0 },
      uResolution: { value: new THREE.Vector2(
        canvas.width,   // set by setSize × pixelRatio
        canvas.height,
      )},
    };

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

  _loop() {
    if (!this._running) return;
    this._animFrameId = requestAnimationFrame(() => this._loop());
    this._uniforms.uTime.value = this._clock.getElapsedTime();
    this._renderer.render(this._scene, this._camera);
  }

  _onResize() {
    this._renderer.setSize(window.innerWidth, window.innerHeight);
    const canvas = this._renderer.domElement;
    this._uniforms.uResolution.value.set(canvas.width, canvas.height);
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
