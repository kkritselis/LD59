/**
 * GameScreen
 *
 * Owns the Three.js scene, camera, renderer, and animation loop.
 * The canvas element is shared with this module; Three.js renders
 * directly onto #game-canvas underneath the HUD overlay.
 *
 * Add your game logic in update() and build your scene in _buildScene().
 */

import * as THREE from 'three';

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

    // HUD callbacks
    this.onOpenSettings = null;
    this.onMainMenu     = null;

    this._initRenderer();
    this._initScene();
    this._bindHUD();
    this._bindResize();
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------

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

  // ------------------------------------------------------------------
  // Game loop
  // ------------------------------------------------------------------

  _loop() {
    if (!this._running) return;
    this._animFrameId = requestAnimationFrame(() => this._loop());

    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.update(delta, elapsed);
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Override or extend this method with your game logic.
   * @param {number} delta   - Seconds since last frame
   * @param {number} elapsed - Total seconds elapsed
   */
  update(delta, elapsed) {
    // Rotate the placeholder mesh
    if (this._placeholder) {
      this._placeholder.rotation.x += delta * 0.4;
      this._placeholder.rotation.y += delta * 0.6;
    }
  }

  // ------------------------------------------------------------------
  // Scene setup
  // ------------------------------------------------------------------

  _initRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x07070f, 1);
  }

  _initScene() {
    this.scene  = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    this.camera.position.set(0, 0, 5);

    this._buildScene();
  }

  /**
   * Build the initial scene content here.
   * Replace with your actual game world.
   */
  _buildScene() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);

    // Directional light
    const dirLight = new THREE.DirectionalLight(0xa89aff, 1.2);
    dirLight.position.set(3, 4, 5);
    this.scene.add(dirLight);

    // Point light accent
    const pointLight = new THREE.PointLight(0x6c63ff, 2, 10);
    pointLight.position.set(-2, 2, 3);
    this.scene.add(pointLight);

    // Placeholder mesh
    const geometry = new THREE.IcosahedronGeometry(1, 1);
    const material = new THREE.MeshStandardMaterial({
      color: 0x6c63ff,
      wireframe: false,
      roughness: 0.4,
      metalness: 0.6,
    });
    this._placeholder = new THREE.Mesh(geometry, material);
    this.scene.add(this._placeholder);

    // Grid helper for spatial reference
    const grid = new THREE.GridHelper(20, 20, 0x252538, 0x18182a);
    grid.position.y = -2;
    this.scene.add(grid);
  }

  // ------------------------------------------------------------------
  // HUD wiring
  // ------------------------------------------------------------------

  _bindHUD() {
    document.getElementById('btn-game-settings')?.addEventListener('click', () => {
      this.onOpenSettings?.();
    });

    document.getElementById('btn-main-menu')?.addEventListener('click', () => {
      this.stop();
      this.onMainMenu?.();
    });
  }

  // ------------------------------------------------------------------
  // Resize
  // ------------------------------------------------------------------

  _bindResize() {
    window.addEventListener('resize', () => this._onResize());
  }

  _onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}
