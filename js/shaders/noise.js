// ============================================================
// noise.js  — GLSL source exported as a JS string
// Prepended to both vertex and fragment shaders.
// ============================================================
export const noiseGLSL = /* glsl */`

#define PI 3.14159265358979
#define EROSION_TILES 4.0
#define EROSION_OCTAVES 5
#define EROSION_GAIN 0.5
#define EROSION_LACUNARITY 2.0
#define EROSION_SLOPE_STRENGTH 3.0
#define EROSION_BRANCH_STRENGTH 3.0
#define EROSION_STRENGTH 0.04

#define HEIGHT_TILES 3.0
#define HEIGHT_OCTAVES 3
#define HEIGHT_AMP 0.25
#define HEIGHT_GAIN 0.1
#define HEIGHT_LACUNARITY 2.0

#define WATER_HEIGHT 0.45

// 2D hash -> pseudo-random gradient vector
vec2 hash2(in vec2 x) {
    const vec2 k = vec2(0.3183099, 0.3678794);
    x = x * k + k.yx;
    return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}

// Gradient noise with analytic derivatives
// Returns vec3(value, dValue/dx, dValue/dy)
vec3 noised(in vec2 p) {
    vec2 i  = floor(p);
    vec2 f  = fract(p);
    vec2 u  = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);

    vec2 ga = hash2(i + vec2(0.0, 0.0));
    vec2 gb = hash2(i + vec2(1.0, 0.0));
    vec2 gc = hash2(i + vec2(0.0, 1.0));
    vec2 gd = hash2(i + vec2(1.0, 1.0));

    float va = dot(ga, f - vec2(0.0, 0.0));
    float vb = dot(gb, f - vec2(1.0, 0.0));
    float vc = dot(gc, f - vec2(0.0, 1.0));
    float vd = dot(gd, f - vec2(1.0, 1.0));

    return vec3(
        va + u.x*(vb-va) + u.y*(vc-va) + u.x*u.y*(va-vb-vc+vd),
        ga + u.x*(gb-ga) + u.y*(gc-ga) + u.x*u.y*(ga-gb-gc+gd) +
        du * (u.yx*(va-vb-vc+vd) + vec2(vb,vc) - va)
    );
}

// Directional erosion kernel (Gavoronoise-style)
vec3 erosion(in vec2 p, vec2 dir) {
    vec2 ip = floor(p);
    vec2 fp = fract(p);
    float f  = 2.0 * PI;
    vec3  va = vec3(0.0);
    float wt = 0.0;

    for (int i = -2; i <= 1; i++) {
        for (int j = -2; j <= 1; j++) {
            vec2 o  = vec2(i, j);
            vec2 h  = hash2(ip - o) * 0.5;
            vec2 pp = fp + o - h;
            float d = dot(pp, pp);
            float w = exp(-d * 2.0);
            wt += w;
            float mag = dot(pp, dir);
            va += vec3(cos(mag * f), -sin(mag * f) * dir) * w;
        }
    }
    return va / wt;
}

// Full heightmap: base FBM + erosion FBM
// Returns vec2(finalHeight, erosionMask)
vec2 heightmap(vec2 uv) {
    vec2 p = uv * HEIGHT_TILES;

    vec3  n  = vec3(0.0);
    float nf = 1.0;
    float na = HEIGHT_AMP;
    for (int i = 0; i < HEIGHT_OCTAVES; i++) {
        n  += noised(p * nf) * na * vec3(1.0, nf, nf);
        na *= HEIGHT_GAIN;
        nf *= HEIGHT_LACUNARITY;
    }
    n.x = n.x * 0.5 + 0.5;

    vec2 dir = n.zy * vec2(1.0, -1.0) * EROSION_SLOPE_STRENGTH;

    vec3  h  = vec3(0.0);
    float a  = 0.5;
    float fq = 1.0;
    a *= smoothstep(WATER_HEIGHT - 0.1, WATER_HEIGHT + 0.2, n.x);

    for (int i = 0; i < EROSION_OCTAVES; i++) {
        h  += erosion(p * EROSION_TILES * fq, dir + h.zy * vec2(1.0, -1.0) * EROSION_BRANCH_STRENGTH) * a * vec3(1.0, fq, fq);
        a  *= EROSION_GAIN;
        fq *= EROSION_LACUNARITY;
    }

    return vec2(n.x + (h.x - 0.5) * EROSION_STRENGTH, h.x);
}
`;
