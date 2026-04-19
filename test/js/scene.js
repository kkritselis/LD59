// ============================================================
// scene.js
// Creates the Three.js scene, terrain mesh with ShaderMaterial,
// a geological cross-section panel at the front face, sky
// background, and exports an update() for the render loop.
// ============================================================

import * as THREE from 'three';

// ------------------------------------------------------------
// JS approximation of the GLSL heightmap.
// Used to sample the front-edge terrain heights for the
// cross-section geometry.  Not pixel-perfect but close enough
// for the visual cross-section.
// ------------------------------------------------------------

function _fract(x) { return x - Math.floor(x); }

function _hash2(x0, x1) {
    const k0 = 0.3183099, k1 = 0.3678794;
    const ax = x0 * k0 + k1;   // x * k.x + k.y
    const ay = x1 * k1 + k0;   // y * k.y + k.x
    const fp = _fract(ax * ay * (ax + ay));
    return [
        -1 + 2 * _fract(16 * k0 * fp),
        -1 + 2 * _fract(16 * k1 * fp),
    ];
}

// Returns [value, dValue/dx, dValue/dy] — matches GLSL noised()
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
    const va = ga[0]*fx       + ga[1]*fy;
    const vb = gb[0]*(fx-1)   + gb[1]*fy;
    const vc = gc[0]*fx       + gc[1]*(fy-1);
    const vd = gd[0]*(fx-1)   + gd[1]*(fy-1);
    const val = va + ux*(vb-va) + uy*(vc-va) + ux*uy*(va-vb-vc+vd);
    // Analytic derivatives (matches the GLSL vec3 return)
    const dvx = ga[0] + ux*(gb[0]-ga[0]) + uy*(gc[0]-ga[0]) + ux*uy*(ga[0]-gb[0]-gc[0]+gd[0])
              + dux*(uy*(va-vb-vc+vd) + (vb-va));
    const dvy = ga[1] + ux*(gb[1]-ga[1]) + uy*(gc[1]-ga[1]) + ux*uy*(ga[1]-gb[1]-gc[1]+gd[1])
              + duy*(ux*(va-vb-vc+vd) + (vc-va));
    return [val, dvx, dvy];
}

// Returns the value component of the erosion kernel — matches GLSL erosion().x
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

function _sampleHeight(uvx, uvy) {
    const HT = 3.0, HA = 0.25, HG = 0.1, HL = 2.0;
    const ET = 4.0, EG = 0.5,  EL = 2.0, ES = 0.04;
    const ESS = 3.0, EBS = 3.0;   // slope + branch strengths
    const WATER = 0.45;
    const px = uvx * HT, py = uvy * HT;

    // Base FBM with derivatives — mirrors GLSL: n += noised(p*nf)*na*vec3(1,nf,nf)
    let nVal = 0, nDx = 0, nDy = 0, nf = 1, na = HA;
    for (let i = 0; i < 3; i++) {
        const nd = _noised(px * nf, py * nf);
        nVal += nd[0] * na;
        nDx  += nd[1] * na * nf;
        nDy  += nd[2] * na * nf;
        na *= HG; nf *= HL;
    }
    nVal = nVal * 0.5 + 0.5;
    // GLSL: dir = n.zy * vec2(1,-1) * SLOPE_STRENGTH  (n.z=ddy, n.y=ddx)
    const slopeDirX = nDy * ESS;
    const slopeDirY = -nDx * ESS;

    const e0 = WATER - 0.1, e1 = WATER + 0.2;
    const tt = Math.max(0, Math.min(1, (nVal - e0) / (e1 - e0)));
    let a = 0.5 * tt * tt * (3 - 2 * tt);

    let hVal = 0, hDy = 0, hDz = 0, fq = 1;
    for (let i = 0; i < 5; i++) {
        // Branch direction accumulates across octaves, same as GLSL
        const branchX = hDz * EBS;
        const branchY = -hDy * EBS;
        const e = _erosionVal(px * ET * fq, py * ET * fq, slopeDirX, slopeDirY, branchX, branchY);
        hVal += e[0] * a;
        hDy  += e[1] * a * fq;
        hDz  += e[2] * a * fq;
        a *= EG; fq *= EL;
    }
    return nVal + (hVal - 0.5) * ES;
}

// ------------------------------------------------------------
// Build the front-face geological cross-section panel.
//
// The panel is a vertical flat mesh positioned at the front
// edge of the terrain (z = +2).  It is divided into 25
// horizontal strata bands, each with a random shade of brown.
// The top vertices are clamped to the sampled terrain height,
// so the upper silhouette follows the terrain profile exactly.
// The bottom is a flat line at the minimum terrain height along
// that edge (the floor).  Any band whose bottom sits above a
// given column's terrain height is simply omitted from the
// index buffer, which is the "clipping" step.
// ------------------------------------------------------------
function _generateBandColors(numBands) {
    const colors = [];
    for (let k = 0; k < numBands; k++) {
        colors.push([
            0.18 + Math.random() * 0.22,  // R: 0.18 – 0.40
            0.12 + Math.random() * 0.15,  // G: 0.12 – 0.27
            0.06 + Math.random() * 0.08,  // B: 0.06 – 0.14
        ]);
    }
    return colors;
}

function buildCrossSection(heightScale, uScale, uOffsetX, uOffsetY, bandColors) {
    const NUM_COLS  = 513;   // 512 segments — matches terrain resolution
    const NUM_BANDS = 25;
    const SIZE      = 4;
    const half      = SIZE / 2;
    const Z         = half;  // front edge
    const FLOOR_Y   = 1.5;     // flat world-space floor — all bands clip here

    const offX = uOffsetX / uScale;
    const offY = uOffsetY / uScale;

    // Sample terrain heights along the front edge in world space
    const heights = new Float32Array(NUM_COLS);
    let ceilY = -Infinity;
    for (let j = 0; j < NUM_COLS; j++) {
        const uvx = j / (NUM_COLS - 1);
        heights[j] = _sampleHeight(uvx + offX, 0 + offY) * heightScale;
        if (heights[j] > ceilY) ceilY = heights[j];
    }

    // Each band has a fixed thickness in world space.
    // Bands are measured as constant depth below the terrain surface, so
    // they follow the terrain contour — peaks push the layers up, valleys
    // let them dip, and all are clipped flat at FLOOR_Y.
    const bandThickness = (ceilY * 0.5) / NUM_BANDS;

    // Each band owns its own vertex rows so colors are solid (no interpolation).
    const vCount = NUM_BANDS * 2 * NUM_COLS;
    const posArr = new Float32Array(vCount * 3);
    const colArr = new Float32Array(vCount * 3);
    const idxArr = [];

    let vi = 0;

    for (let k = 0; k < NUM_BANDS; k++) {
        const [r, g, b] = bandColors[k];

        const baseBot = vi;

        // Bottom row — k+1 band-thicknesses below the surface, clamped to floor
        for (let j = 0; j < NUM_COLS; j++) {
            const x    = -half + SIZE * j / (NUM_COLS - 1);
            const yBot = Math.max(heights[j] - (k + 1) * bandThickness, FLOOR_Y);
            posArr[vi*3] = x; posArr[vi*3+1] = yBot; posArr[vi*3+2] = Z;
            colArr[vi*3] = r; colArr[vi*3+1] = g;    colArr[vi*3+2] = b;
            vi++;
        }

        const baseTop = vi;

        // Top row — k band-thicknesses below the surface.
        // Band 0's top is the terrain surface itself.
        for (let j = 0; j < NUM_COLS; j++) {
            const x    = -half + SIZE * j / (NUM_COLS - 1);
            const yTop = k === 0
                ? heights[j]
                : Math.max(heights[j] - k * bandThickness, FLOOR_Y);
            posArr[vi*3] = x; posArr[vi*3+1] = yTop; posArr[vi*3+2] = Z;
            colArr[vi*3] = r; colArr[vi*3+1] = g;    colArr[vi*3+2] = b;
            vi++;
        }

        // Include a quad only when the (unclamped) top of this band is above
        // the floor for both columns — prevents degenerate zero-height faces.
        for (let j = 0; j < NUM_COLS - 1; j++) {
            const topL = heights[j]   - k * bandThickness;
            const topR = heights[j+1] - k * bandThickness;
            if (topL > FLOOR_Y && topR > FLOOR_Y) {
                const bl = baseBot + j,     br = baseBot + j + 1;
                const tl = baseTop + j,     tr = baseTop + j + 1;
                idxArr.push(bl, br, tr,  bl, tr, tl);
            }
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));
    geo.setIndex(idxArr);
    return geo;
}

export function buildScene(vertexShader, fragmentShader) {

    // ----------------------------------------------------------
    // Scene + renderer
    // ----------------------------------------------------------
    const scene    = new THREE.Scene();
    scene.background = new THREE.Color(0x8ca8c0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // ----------------------------------------------------------
    // Camera
    // ----------------------------------------------------------
    const camera = new THREE.PerspectiveCamera(
        65,
        window.innerWidth / window.innerHeight,
        0.01,
        200
    );
    camera.position.set(0.000, 3.500, 2.464);
    camera.lookAt(0.000, 0.000, -0.745);

    // ----------------------------------------------------------
    // Terrain uniforms
    // ----------------------------------------------------------
    const uniforms = {
        uTime:   { value: 0.0 },
        uOffset: { value: new THREE.Vector2(0, 0) },
        uScale:  { value: 4.0 },
    };

    // ----------------------------------------------------------
    // Terrain mesh
    // ----------------------------------------------------------
    const SEGMENTS = 1000;
    const geometry = new THREE.PlaneGeometry(4, 4, SEGMENTS, SEGMENTS);
    geometry.applyMatrix4(new THREE.Matrix4().makeRotationX(-Math.PI / 2));

    const material = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        side: THREE.FrontSide,
        wireframe: false,
    });

    const terrain = new THREE.Mesh(geometry, material);
    scene.add(terrain);

    // ----------------------------------------------------------
    // Geological cross-section — front face only, static panel
    // ----------------------------------------------------------
    const HEIGHT_SCALE  = uniforms.uScale.value * 1.0;
    const csBandColors  = _generateBandColors(25);  // fixed for the session
    const csGeo = buildCrossSection(
        HEIGHT_SCALE,
        uniforms.uScale.value,
        uniforms.uOffset.value.x,
        uniforms.uOffset.value.y,
        csBandColors
    );
    const csMat  = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const csMesh = new THREE.Mesh(csGeo, csMat);
    scene.add(csMesh);

    // ----------------------------------------------------------
    // Simple sky gradient via a large sphere
    // ----------------------------------------------------------
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
                vec3 horizon = vec3(0.67, 0.78, 0.85);
                vec3 zenith  = vec3(0.30, 0.50, 0.72);
                vec3 col     = mix(horizon, zenith, pow(t, 0.8));
                vec3 sunDir  = normalize(vec3(-0.6, 0.5, 0.3));
                float sun    = pow(max(0.0, dot(normalize(vDir), sunDir)), 256.0);
                col += vec3(1.0, 0.97, 0.85) * sun * 2.0;
                gl_FragColor = vec4(col, 1.0);
            }
        `,
    });
    const sky = new THREE.Mesh(skyGeo, skyMat);
    scene.add(sky);

    // ----------------------------------------------------------
    // Keyboard input — WASD and arrow keys both scroll the terrain
    // ----------------------------------------------------------
    const SCROLL_SPEED = 0.6;
    const keys = {};
    window.addEventListener('keydown', e => { keys[e.code] = true;  e.preventDefault(); });
    window.addEventListener('keyup',   e => { keys[e.code] = false; });

    const offset = new THREE.Vector2(0, 0);
    let prevOffsetX = 0, prevOffsetY = 0;

    // ----------------------------------------------------------
    // Resize handler
    // ----------------------------------------------------------
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ----------------------------------------------------------
    // Update — called each frame from main.js
    // ----------------------------------------------------------
    function update(elapsedTime, delta) {
        // Terrain scrolling — arrow keys and WASD
        if (keys['ArrowUp']    || keys['KeyW']) offset.y -= SCROLL_SPEED * delta;
        if (keys['ArrowDown']  || keys['KeyS']) offset.y += SCROLL_SPEED * delta;
        if (keys['ArrowLeft']  || keys['KeyA']) offset.x -= SCROLL_SPEED * delta;
        if (keys['ArrowRight'] || keys['KeyD']) offset.x += SCROLL_SPEED * delta;

        uniforms.uTime.value = elapsedTime;
        uniforms.uOffset.value.copy(offset);

        // Rebuild cross-section whenever the terrain window moves
        if (offset.x !== prevOffsetX || offset.y !== prevOffsetY) {
            csMesh.geometry.dispose();
            csMesh.geometry = buildCrossSection(
                HEIGHT_SCALE,
                uniforms.uScale.value,
                offset.x,
                offset.y,
                csBandColors
            );
            prevOffsetX = offset.x;
            prevOffsetY = offset.y;
        }

        renderer.render(scene, camera);
    }

    return { renderer, camera, update };
}
