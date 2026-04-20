// ============================================================
// terrain.frag.js  — fragment shader source as a JS string
// noise.js is prepended before this in main.js
// ============================================================
export const terrainFragGLSL = /* glsl */`

#define saturate(x) clamp(x, 0.0, 1.0)
#define sq(x)       ((x)*(x))

#define CLIFF_COLOR   vec3(0.28, 0.14, 0.10)
#define DIRT_COLOR    vec3(0.55, 0.28, 0.15)
#define GRASS_COLOR1  vec3(0.52, 0.22, 0.10)
#define GRASS_COLOR2  vec3(0.62, 0.32, 0.14)
#define SAND_COLOR    vec3(0.72, 0.48, 0.30)
#define SNOW_COLOR    vec3(0.80, 0.62, 0.50)
#define WATER_COLOR   vec3(0.18, 0.04, 0.06)
#define SHORE_COLOR   vec3(0.38, 0.12, 0.10)

#define SUN_DIR       normalize(vec3(-0.6, 0.5, 0.3))
#define SUN_COLOR     (vec3(1.0, 0.78, 0.62) * 1.95)
#define AMBIENT_COLOR (vec3(0.38, 0.12, 0.09) * 0.11)
#define FOG_COLOR     vec3(0.38, 0.16, 0.10)
#define FOG_DENSITY   0.32

uniform float uTime;

varying vec3  vWorldPos;
varying vec3  vNormal;
varying float vHeight;
varying float vErosion;

float diffuseBurley(float NoL, float NoV, float LoH, float roughness) {
    float f90 = 0.5 + 2.0 * roughness * LoH * LoH;
    float fl  = 1.0 + (f90 - 1.0) * pow(1.0 - NoL, 5.0);
    float fv  = 1.0 + (f90 - 1.0) * pow(1.0 - NoV, 5.0);
    return fl * fv / PI;
}

void main() {
    vec3  N   = normalize(vNormal);
    vec3  L   = SUN_DIR;
    vec3  V   = normalize(cameraPosition - vWorldPos);
    vec3  H   = normalize(L + V);

    float NoL = saturate(dot(N, L));
    float NoV = saturate(dot(N, V)) + 1e-5;
    float NoH = saturate(dot(N, H));
    float LoH = saturate(dot(L, H));

    float height    = vHeight;
    float erosion   = vErosion;
    float occlusion = sq(saturate(erosion + 0.5));

    // --- Terrain color ---
    vec3 color = CLIFF_COLOR;
    color = mix(color, DIRT_COLOR, smoothstep(0.3, 0.0, occlusion));

    vec3  grassCol  = mix(GRASS_COLOR1, GRASS_COLOR2, smoothstep(0.4, 0.6, height - erosion * 0.05));
    float grassMask = smoothstep(WATER_HEIGHT + 0.05, WATER_HEIGHT + 0.02, height)
                    * smoothstep(0.8, 1.0, N.y);
    color = mix(color, grassCol, grassMask);
    color = mix(color, SNOW_COLOR, smoothstep(0.53, 0.62, height));
    color = mix(color, SAND_COLOR, smoothstep(WATER_HEIGHT + 0.008, WATER_HEIGHT, height));

    // --- Water ---
    bool underwater = height < WATER_HEIGHT;
    if (underwater) {
        float shore = exp(-abs(height - WATER_HEIGHT) * 30.0);
        color = mix(WATER_COLOR, SHORE_COLOR, shore);
        N     = vec3(0.0, 1.0, 0.0);
        NoL   = saturate(dot(N, L));
        NoV   = saturate(dot(N, V)) + 1e-5;
    }

    float roughness = underwater ? 0.05 : 0.85;

    // --- Lighting ---
    vec3 lit = color * AMBIENT_COLOR;
    lit += color * SUN_COLOR * NoL * diffuseBurley(NoL, NoV, LoH, roughness) * PI;
    float bounce = dot(N, L * vec3(1.0, -1.0, 1.0)) * 0.5 + 0.5;
    lit += color * SUN_COLOR * bounce * 0.04;

    if (underwater) {
        float spec = pow(NoH, 128.0);
        // Attenuate specular when camera is nearly overhead (NoV near 1)
        lit += SUN_COLOR * spec * 0.4 * (1.0 - NoV * 0.5);
    }

    lit *= mix(1.0, occlusion, 0.4);

    // --- Fog (distance + wind-scrolled dust variation) ---
    float dist = length(vWorldPos - cameraPosition);
    vec2  gustUv = vWorldPos.xz * 0.22 + vec2(uTime * 1.15, uTime * 0.22);
    float gust   = noised(gustUv).x * 0.5 + 0.5;
    float dust   = mix(0.78, 1.28, gust);
    float fogAmt = 1.0 - exp(-dist * dist * FOG_DENSITY * 0.055 * dust);
    vec3  fogCol = mix(FOG_COLOR, FOG_COLOR * vec3(1.12, 0.94, 0.82), gust * 0.35);
    lit = mix(lit, fogCol, fogAmt);

    // --- Tonemap + gamma ---
    lit = (lit * (2.51 * lit + 0.03)) / (lit * (2.43 * lit + 0.59) + 0.14);
    lit = pow(clamp(lit, 0.0, 1.0), vec3(1.0 / 2.2));

    // Slight desaturation — dusty air, flatter palette
    float luma = dot(lit, vec3(0.299, 0.587, 0.114));
    lit = mix(vec3(luma), lit, 0.92);
    lit = clamp(lit, 0.0, 1.0);

    gl_FragColor = vec4(lit, 1.0);
}
`;
