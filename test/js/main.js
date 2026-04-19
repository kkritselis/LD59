// ============================================================
// main.js
// Imports GLSL strings directly — no fetch, no server required.
// ============================================================

import { buildScene }      from './scene.js';
import { noiseGLSL }       from '../shaders/noise.js';
import { terrainVertGLSL } from '../shaders/terrain.vert.js';
import { terrainFragGLSL } from '../shaders/terrain.frag.js';

function init() {
    const vertexShader   = noiseGLSL + '\n' + terrainVertGLSL;
    const fragmentShader = noiseGLSL + '\n' + terrainFragGLSL;

    const { renderer, camera, update } = buildScene(vertexShader, fragmentShader);

    const loading = document.getElementById('loading');
    if (loading) setTimeout(() => loading.classList.add('hidden'), 400);

    const clock = { start: performance.now(), last: performance.now() };

    function loop() {
        requestAnimationFrame(loop);
        const now     = performance.now();
        const elapsed = (now - clock.start) / 1000;
        const delta   = (now - clock.last)  / 1000;
        clock.last    = now;
        update(elapsed, delta);
    }

    loop();
}

try {
    init();
} catch(err) {
    console.error('Init failed:', err);
    document.body.innerHTML = `<pre style="color:red;padding:2rem;">${err}</pre>`;
}
