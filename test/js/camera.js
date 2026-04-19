// ============================================================
// camera.js
// Overhead pan camera: WASD / arrows pan across the terrain.
// Camera angle is fixed — no mouse rotation.
// ============================================================

export class FlyCamera {
    constructor(camera, domElement) {
        this.camera = camera;

        this.keys = {
            forward:  false,
            backward: false,
            left:     false,
            right:    false,
            up:       false,
            down:     false,
        };

        this.moveSpeed = 0.8;

        this._bindEvents();
    }

    _bindEvents() {
        window.addEventListener('keydown', e => this._onKey(e, true));
        window.addEventListener('keyup',   e => this._onKey(e, false));
    }

    _onKey(e, pressed) {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp':    this.keys.forward  = pressed; break;
            case 'KeyS': case 'ArrowDown':  this.keys.backward = pressed; break;
            case 'KeyA': case 'ArrowLeft':  this.keys.left     = pressed; break;
            case 'KeyD': case 'ArrowRight': this.keys.right    = pressed; break;
            case 'KeyQ': case 'PageUp':     this.keys.up       = pressed; break;
            case 'KeyE': case 'PageDown':   this.keys.down     = pressed; break;
        }
    }

    update(delta) {
        const speed = this.moveSpeed * delta;

        // Pan in world XZ — camera angle stays fixed
        if (this.keys.forward)  this.camera.position.z -= speed;
        if (this.keys.backward) this.camera.position.z += speed;
        if (this.keys.left)     this.camera.position.x -= speed;
        if (this.keys.right)    this.camera.position.x += speed;
        if (this.keys.up)       this.camera.position.y += speed;
        if (this.keys.down)     this.camera.position.y -= speed;
    }
}
