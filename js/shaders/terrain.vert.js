// ============================================================
// terrain.vert.js  — vertex shader source as a JS string
// noise.js is prepended before this in main.js
// ============================================================
export const terrainVertGLSL = /* glsl */`

uniform float uTime;
uniform vec2  uOffset;
uniform float uScale;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vHeight;
varying float vErosion;

void main() {
    vec2 uv = uv + uOffset / uScale;

    vec2 h0  = heightmap(uv);
    vHeight  = h0.x;
    vErosion = h0.y;

    float eps = 1.0 / 256.0;
    float hR  = heightmap(uv + vec2(eps, 0.0)).x;
    float hU  = heightmap(uv + vec2(0.0, eps)).x;

    float heightScale = uScale * 1.0;
    vec3 tangentX = normalize(vec3(eps * uScale, (hR - h0.x) * heightScale, 0.0));
    vec3 tangentZ = normalize(vec3(0.0,          (hU - h0.x) * heightScale, eps * uScale));
    vNormal       = normalize(cross(tangentZ, tangentX));

    vec3 displaced = position;
    displaced.y    = h0.x * heightScale;
    vWorldPos      = displaced;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
`;
