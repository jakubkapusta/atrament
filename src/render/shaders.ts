// All GLSL for the renderer. Coordinates: "world" = jar interior units (y up),
// uv = screen [0,1] (y up). uW2U: uv = world*xy + zw ; uU2W: world = uv*xy + zw.

export const FS_VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main(){ vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const HEAD = `#version 300 es
precision highp float;
precision highp sampler2D;
`;

const COMMON = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
float fbm3(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 3; i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
float sq(float x){ return x * x; }
float p6(float x){ float y = x * x; return y * y * y; }
float lum(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float caustic(vec2 p, float t){
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(max(c, 0.0), 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 3.0);
}
// perspective openness of horizontal circles on the jar at height y (camera slightly above)
// camera is above the jar looking slightly down: circles further below the eye open up more
float ellE(float y, float H){ return mix(0.42, 0.2, clamp(y / H, 0.0, 1.2)); }
`;

// ------------------------------------------------------------------ background
export const BG = HEAD + COMMON + `
in vec2 vUv; out vec4 o;
uniform vec4 uU2W; uniform vec3 uJar; uniform vec2 uTilt; uniform float uTime;
uniform vec4 uSlots[2]; // backlit petri dishes behind the HUD slots: x y r on
float hexd(vec2 p){ p = abs(p); return max(p.x * 0.866 + p.y * 0.5, p.y); }
float panelAt(vec2 w){
  vec2 pc = vec2(uJar.x * 0.5, uJar.y * 0.5 + 1.2) + uTilt * vec2(0.6, 0.35);
  vec2 hs = vec2(uJar.x * 0.5 + 0.35, uJar.y * 0.5 + 1.9);
  vec2 q = abs(w - pc) - hs;
  float bd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
  return 1.0 - smoothstep(-1.4, 1.6, bd);
}
void main(){
  vec2 w = vUv * uU2W.xy + uU2W.zw;
  float p = panelAt(w);
  vec2 pc = vec2(uJar.x * 0.5, uJar.y * 0.5);
  vec2 d = (w - pc) / uJar.y;
  // warm studio paper, lit by a soft vertical strip behind the jar: the horizontal
  // falloff is what the water cylinder visibly magnifies
  vec3 panel = mix(vec3(0.98, 0.92, 0.84), vec3(0.9, 0.92, 0.96), clamp(d.y + 0.55, 0.0, 1.0));
  float dx = (w.x - pc.x) / uJar.x;
  panel *= 0.62 + 0.55 * exp(-sq(dx / 0.3)) + 0.18 * exp(-dot(d, d) * 5.0);
  panel *= 1.0 + 0.03 * (fbm3(w * 0.45 + 3.0) - 0.5);
  vec3 room = vec3(0.012, 0.011, 0.015) * (1.0 + 0.6 * vnoise(w * 0.2));
  // out-of-focus lights in the dark studio (hexagonal bokeh), stronger parallax
  vec2 wb = w - uTilt * 1.4;
  for (int i = 0; i < 10; i++) {
    float fi = float(i);
    float side = hash12(vec2(fi, 2.2)) < 0.5 ? -1.0 : 1.0;
    vec2 bp = pc + vec2(side * (uJar.x * 0.5 + 2.5 + hash12(vec2(fi, 1.7)) * 14.0), (hash12(vec2(fi, 8.3)) - 0.4) * 18.0);
    float br = 0.3 + hash12(vec2(fi, 3.1)) * 0.6;
    float hd = hexd((wb - bp) / br);
    float disc = smoothstep(1.0, 0.72, hd);
    float ring = smoothstep(0.6, 0.95, hd) * disc;
    vec3 bc = mix(vec3(1.0, 0.6, 0.28), vec3(0.45, 0.6, 1.0), step(0.65, hash12(vec2(fi, 5.5))));
    room += bc * (disc * 0.022 + ring * 0.025) * (0.3 + hash12(vec2(fi, 9.9)));
  }
  vec3 col = mix(room, panel, p);
  // glossy table below the jar: reflects the panel
  float yT = -0.62;
  if (w.y < yT + 0.25) {
    float dist = max(yT - w.y, 0.0);
    float refl = panelAt(vec2(w.x, yT + dist * 1.3)) * exp(-dist * 0.7);
    vec3 table = vec3(0.01, 0.009, 0.01) + panel * refl * 0.12;
    table += panel * 0.25 * exp(-sq(dist * 16.0)) * p;
    col = mix(col, table, smoothstep(yT + 0.2, yT - 0.05, w.y));
  }
  for (int i = 0; i < 2; i++) {
    vec4 sl = uSlots[i];
    if (sl.w <= 0.0) continue;
    float d = length(w - sl.xy) / sl.z;
    float disc = smoothstep(1.0, 0.94, d);
    vec3 lit = vec3(1.0, 0.97, 0.92) * (1.9 - 0.6 * d * d) * (1.0 + 0.02 * (vnoise(w * 9.0) - 0.5));
    col = mix(col, lit, disc * sl.w);
    col += vec3(1.2, 1.15, 1.1) * exp(-sq((d - 0.965) / 0.025)) * sl.w;
    col *= 1.0 - 0.5 * exp(-sq((d - 1.06) / 0.05)) * sl.w;
  }
  o = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ water
export const WATER = HEAD + COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uBg, uDye, uWave;
uniform vec4 uU2W, uW2U, uDyeMap, uAim;
uniform vec3 uJar, uMurkCol, uTint;
uniform float uDyeK, uTime, uMurk, uRayK, uMilk, uCosmic;
void main(){
  vec2 w = vUv * uU2W.xy + uU2W.zw;
  float W = uJar.x, H = uJar.y;
  float cx = W * 0.5;
  float u = (w.x - cx) / cx;
  float floorF = -ellE(0.0, H) * sqrt(max(1.0 - u * u, 0.0));
  if (abs(u) >= 1.0 || w.y < floorF - 0.01 || w.y > H + 0.6) { o = texture(uBg, vUv); return; }
  float wave = texture(uWave, vec2(w.x / W, 0.5)).r;
  float wl = uJar.z + wave;
  float chord = sqrt(1.0 - u * u);
  bool water = w.y < wl;
  vec2 sw = w;
  if (water) {
    float mu = u * (0.8 + 0.14 * u * u);
    sw.x = cx + mu * cx;
    sw.y = H * 0.45 + (w.y - H * 0.45) * 0.93 + wave * 0.9 * exp(-(wl - w.y) * 2.5);
  } else {
    sw.x = cx + u * 0.975 * cx;
  }
  vec3 col = texture(uBg, sw * uW2U.xy + uW2U.zw).rgb;
  if (water) {
    float depth = wl - w.y;
    col *= exp(-uTint * (0.5 + chord * 2.4));
    vec4 dye = texture(uDye, w * uDyeMap.xy + uDyeMap.zw);
    dye.rgb = 2.2 * (1.0 - exp(-dye.rgb / 2.2)); // soft cap: dense ink never goes pitch black
    float dyeAmt = dot(dye.rgb, vec3(0.3333));
    // caustics from the rippling surface — strongest on the floor
    float floorM = exp(-max(w.y, 0.0) * 1.3) * 0.8 + 0.15;
    float ca = caustic(w * vec2(1.05, 0.8) + vec2(0.0, uTime * 0.03), uTime * 0.55);
    col *= 1.0 + ca * floorM * 0.28 * exp(-dyeAmt * uDyeK);
    // god rays
    float xr = w.x + depth * 0.2 + sin(uTime * 0.11) * 0.4;
    float rays = pow(max(0.0, sin(xr * 2.1 + uTime * 0.19) * sin(xr * 1.31 - uTime * 0.15 + 1.7)), 3.0)
               + 0.6 * pow(max(0.0, sin(xr * 3.7 - uTime * 0.27)), 8.0);
    rays *= exp(-depth * 0.2) * chord;
    col += vec3(1.0, 0.97, 0.9) * rays * uRayK * exp(-dyeAmt * uDyeK * 0.7);
    // ink absorption (Beer-Lambert through the cylinder chord)
    col *= exp(-dye.rgb * uDyeK * (0.55 + 0.45 * chord));
    // turbidity: milky scattering reduces contrast
    float haze = 1.0 - exp(-(dye.a * 1.3 + uMurk * 1.6));
    col = mix(col, uMurkCol * (0.3 + 0.7 * lum(col)), haze);
    // surface: slightly darker just below (total internal reflection band)
    col *= 1.0 - 0.18 * exp(-depth * 9.0);
    if (uMilk > 0.0) {
      // opaque creamy liquid: light scatters instead of passing through; ink tints it pastel
      vec3 milk = vec3(1.0, 0.955, 0.87) * (1.28 + 0.12 * chord - 0.1 * smoothstep(0.0, 1.0, depth / 9.0));
      milk *= 1.0 + 0.04 * (fbm3(w * 0.8 + vec2(uTime * 0.03, 0.0)) - 0.5);
      milk *= exp(-dye.rgb * uDyeK * 0.45);
      col = mix(col, milk, 0.88 * uMilk);
    }
    if (uCosmic > 0.0) {
      // deep indigo space inside the jar: nebulae glow, stars twinkle
      col *= mix(vec3(1.0), vec3(0.2, 0.2, 0.52), uCosmic * (0.8 + 0.2 * chord));
      vec2 q = w * 0.32 + vec2(uTime * 0.012, -uTime * 0.008);
      float n1 = fbm(q + 3.1);
      float n2 = fbm(q * 1.7 - vec2(uTime * 0.01, 0.0) + 8.4);
      vec3 neb = vec3(0.62, 0.24, 0.95) * smoothstep(0.45, 0.82, n1) + vec3(0.15, 0.62, 1.0) * smoothstep(0.5, 0.86, n2)
               + vec3(1.0, 0.4, 0.6) * smoothstep(0.7, 0.95, n1 * n2 * 1.6);
      col += neb * 0.6 * uCosmic * exp(-dyeAmt * uDyeK * 0.5);
      for (int L = 0; L < 2; L++) {
        float sc = L == 0 ? 5.0 : 9.0;
        vec2 cell = floor(w * sc);
        vec2 f = fract(w * sc) - 0.5;
        vec2 jit = vec2(hash12(cell + float(L) * 7.0), hash12(cell + 3.3 + float(L))) - 0.5;
        float on = step(0.55, hash12(cell * 1.7 + float(L)));
        float d = length(f - jit * 0.7);
        float tw = 0.55 + 0.45 * sin(uTime * (2.0 + 3.0 * hash12(cell + 9.1)) + hash12(cell) * 20.0);
        float star = exp(-d * d * (L == 0 ? 900.0 : 2400.0)) * on * tw;
        col += vec3(1.25, 1.2, 1.45) * star * (L == 0 ? 6.0 : 3.0) * uCosmic;
      }
    }
  }
  // aiming guide: fine dashed line in the water
  if (uAim.z > 0.0 && w.y < uAim.y) {
    float dx = abs(w.x - uAim.x);
    float line = exp(-dx * dx / 0.0006);
    float dash = smoothstep(0.35, 0.5, fract((w.y + uTime * 0.6) * 2.6)) * smoothstep(1.0, 0.85, fract((w.y + uTime * 0.6) * 2.6));
    float fade = smoothstep(0.0, 1.2, w.y) * smoothstep(uAim.y, uAim.y - 0.6, w.y);
    col *= 1.0 - line * dash * fade * uAim.z * 0.45;
  }
  o = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ motes (GPU particles)
export const MOTE_UPDATE = HEAD + COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uState, uVel; uniform vec2 uVelTexel; uniform float uDt, uTime;
void main(){
  vec4 s = texture(uState, vUv);
  vec2 v = texture(uVel, s.xy).xy * uVelTexel;
  float h1 = hash12(vUv * 97.1 + uTime), h2 = hash12(vUv * 51.3 - uTime);
  s.xy += v * uDt * (0.55 + 0.45 * s.z) + (vec2(h1, h2) - 0.5) * 0.0015;
  s.y += (s.w - 0.6) * 0.004 * uDt;
  if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 0.97) {
    s.xy = vec2(hash12(vUv * 13.1 + uTime), hash12(vUv * 7.3 - uTime) * 0.95);
  }
  o = s;
}`;

export const MOTE_VS = HEAD + `
uniform sampler2D uState, uDye;
uniform vec4 uW2U; uniform vec3 uJar; uniform float uL, uPx, uDyeK, uMilk, uCosmic; uniform int uSide;
out float vA; out float vSize; out vec3 vT; out float vCos;
void main(){
  ivec2 c = ivec2(gl_VertexID % uSide, gl_VertexID / uSide);
  vec4 s = texelFetch(uState, c, 0);
  vec2 w = vec2(s.x * uJar.x, s.y * uL);
  vec2 uv = w * uW2U.xy + uW2U.zw;
  float blur = abs(s.z - 0.45);
  float size = (0.022 + blur * 0.2) * uPx;
  vSize = size;
  vA = (0.5 / (1.0 + blur * 40.0)) * smoothstep(uJar.z, uJar.z - 0.2, w.y) * (1.0 - uMilk) * (1.0 + uCosmic);
  vCos = uCosmic;
  vec4 d = texture(uDye, s.xy);
  vT = exp(-d.rgb * uDyeK * 0.5);
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = max(size, 1.0);
}`;

export const MOTE_FS = HEAD + `
in float vA; in float vSize; in vec3 vT; in float vCos; out vec4 o;
void main(){
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  float disc = smoothstep(1.0, 0.8, d);
  float ring = smoothstep(0.55, 0.95, d) * disc;
  float a = (disc * 0.6 + ring * 0.5) * vA;
  // dust silhouettes against the backlight, with a faint forward-scatter glint
  vec3 c = mix(vec3(0.05, 0.045, 0.04), vec3(1.6) * vT, 0.25);
  // in zero-g the dust becomes glittering star dust (additive)
  c = mix(c, vec3(2.2, 2.0, 2.6) * vT, vCos);
  o = vec4(c * a, a * (1.0 - vCos));
}`;

// ------------------------------------------------------------------ drop field (metaballs)
export const FIELD_VS = HEAD + `
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 iA; // x y r seed
layout(location=2) in vec4 iB; // a2x a2y a3x a3y
layout(location=3) in vec4 iC; // colA mixT
layout(location=4) in vec4 iD; // colB a0
layout(location=5) in vec4 iE; // colF flash
layout(location=6) in vec4 iF; // gold pearl opal fuse
layout(location=7) in vec4 iG; // mercury prism - -
uniform vec4 uW2U; uniform float uS;
out vec2 vL; out float vR;
flat out vec4 vB; flat out vec4 vC; flat out vec4 vD; flat out vec4 vE; flat out vec4 vF; flat out vec4 vG; flat out float vSeed;
void main(){
  float r = iA.z * (1.0 + iD.w);
  float ext = r * (uS + 0.5);
  vec2 wp = iA.xy + aQ * ext;
  vL = aQ * ext; vR = r;
  vB = iB; vC = iC; vD = iD; vE = iE; vF = iF; vG = iG; vSeed = iA.w;
  vec2 uv = wp * uW2U.xy + uW2U.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FIELD_FS = HEAD + COMMON + `
in vec2 vL; in float vR;
flat in vec4 vB; flat in vec4 vC; flat in vec4 vD; flat in vec4 vE; flat in vec4 vF; flat in vec4 vG; flat in float vSeed;
uniform float uS, uTime;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
layout(location=3) out vec4 o3;
void main(){
  vec2 q = vL;
  float len = length(q);
  float th = atan(q.y, q.x);
  float R = vR * (1.0 + vB.x * cos(2.0 * th) + vB.y * sin(2.0 * th) + vB.z * cos(3.0 * th) + vB.w * sin(3.0 * th));
  float d = len / max(R, 1e-4);
  if (d >= uS) discard;
  float t = 1.0 - d * d / (uS * uS);
  float w = t * t * t;
  float w2 = w * w;
  vec3 A = vE.rgb;
  float mixT = vC.w;
  if (mixT < 0.999) {
    // marbling: the two parent inks swirl inside the new drop, then settle into the result
    vec2 p = q / vR;
    float lp = length(p);
    float ang = (1.0 - mixT) * (6.0 * (1.0 - lp) + uTime * 0.8);
    float c = cos(ang), s = sin(ang);
    p = mat2(c, -s, s, c) * p;
    float n = fbm(p * 1.6 + vSeed * 31.0) - 0.5 + p.x * 0.4;
    float m = smoothstep(-0.05, 0.05, n);
    vec3 two = mix(vC.rgb, vD.rgb, m);
    A = mix(two, vE.rgb, smoothstep(0.3, 1.0, mixT));
  }
  o0 = vec4(A * w2, w2);
  o1 = vec4(w, vR * w, vF.x * w2, vF.y * w2);
  o2 = vec4(vF.z * w2, vF.w * w2, vE.w * w2, vSeed * w2);
  o3 = vec4(vG.x * w2, vG.y * w2, 0.0, 0.0);
}`;

// ------------------------------------------------------------------ drop shading
const ENV = `
float softbox(vec3 r, vec3 dir, vec2 size, float soft){
  float fr = dot(r, dir);
  if (fr <= 0.0) return 0.0;
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), dir));
  vec3 up = cross(dir, right);
  vec2 p = vec2(dot(r, right), dot(r, up)) / fr;
  vec2 d = abs(p) - size;
  return 1.0 - smoothstep(-soft, soft, max(d.x, d.y));
}
vec3 envMap(vec3 r, vec2 tilt, float back){
  vec3 c = vec3(0.018, 0.018, 0.022) + vec3(0.025) * max(r.y, 0.0);
  c += vec3(1.1, 1.06, 1.0) * smoothstep(0.15 - (1.0 - back) * 0.8, -0.55 - (1.0 - back) * 0.4, r.z) * 0.9;
  vec3 k = normalize(vec3(-0.55 + tilt.x * 0.35, 0.62 + tilt.y * 0.35, 0.56));
  c += softbox(r, k, vec2(0.36, 0.22), 0.04) * vec3(42.0, 40.0, 37.0);
  vec3 s = normalize(vec3(0.82 + tilt.x * 0.25, 0.08, 0.52));
  c += softbox(r, s, vec2(0.05, 0.55), 0.02) * vec3(9.0, 10.0, 12.0);
  vec3 f = normalize(vec3(0.1 + tilt.x * 0.2, -0.75, 0.6));
  c += softbox(r, f, vec2(0.5, 0.08), 0.08) * vec3(0.9, 0.85, 0.8);
  return c;
}`;

export const DROPS = HEAD + COMMON + ENV + `
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uF0, uF1, uF2, uF3, uDye, uWave;
uniform vec4 uW2U, uU2W, uDyeMap;
uniform vec3 uJar, uMurkCol;
uniform vec2 uFT, uTilt;
uniform float uS, uThr, uTime, uDyeK, uFront, uMurk, uMilk, uCosmic;
float hAt(vec2 uv){
  vec4 f1 = texture(uF1, uv);
  float f = f1.x;
  if (f <= 1e-5) return 0.0;
  float r = f1.y / f;
  float c = pow(max(f, 0.0), 1.0 / 3.0);
  float k = 1.0 - uS * uS * (1.0 - c);
  return r * sqrt(clamp(k, 0.0, 1.5));
}
void main(){
  vec3 scene = texture(uScene, vUv).rgb;
  vec4 f1 = texture(uF1, vUv);
  float f = f1.x;
  float aa = fwidth(f) * 0.9 + 1e-5;
  float alpha = smoothstep(uThr - aa, uThr + aa, f);
  // soft contact shadow / ambient occlusion just outside the drops
  float ao = smoothstep(uThr * 0.15, uThr, f) * (1.0 - alpha);
  if (alpha <= 0.0) { o = vec4(scene * (1.0 - ao * 0.18), 1.0); return; }
  vec2 w = vUv * uU2W.xy + uU2W.zw;
  float h = hAt(vUv);
  vec2 e = uFT * 1.2;
  float hL = hAt(vUv - vec2(e.x, 0.0)), hR = hAt(vUv + vec2(e.x, 0.0));
  float hD = hAt(vUv - vec2(0.0, e.y)), hU = hAt(vUv + vec2(0.0, e.y));
  vec2 grad = vec2((hR - hL) / (2.0 * e.x * uU2W.x), (hU - hD) / (2.0 * e.y * uU2W.y));
  vec3 n = normalize(vec3(-grad, 1.0));
  vec4 f0 = texture(uF0, vUv);
  vec4 f2 = texture(uF2, vUv);
  float ws = max(f0.a, 1e-7);
  vec3 A = f0.rgb / ws;
  float gold = f1.z / ws, pearl = f1.w / ws, opal = f2.x / ws, fuse = f2.y / ws, seed = f2.w / ws;
  float flash = f2.z / ws;
  vec4 f3 = texture(uF3, vUv);
  float mercury = f3.x / ws, prism = f3.y / ws;

  // refraction of what is behind (water, ink clouds, other drops' surroundings)
  vec2 refr = -n.xy * (0.18 + h * 0.55);
  vec3 bg = texture(uScene, vUv + refr * uW2U.xy).rgb;
  float L = 2.0 * h;
  float Lc = L / (1.0 + 0.42 * L);
  vec3 T = exp(-A * Lc * 3.4);
  float core = pow(max(n.z, 0.0), 3.0);
  vec3 col = bg * T * (0.62 + 0.95 * core);
  // light scattered inside the ink body
  vec3 body = exp(-A * 0.5);
  col += body * body * 0.06 * (1.0 - exp(-L * 3.0));
  // backlit sphere: dark refraction ring towards the rim
  float ring = smoothstep(0.04, 0.55, n.z);
  col *= mix(0.06, 1.0, ring);
  // inner caustic: light focused to the lower part of the drop
  vec2 lp = n.xy + vec2(0.0, 0.45);
  col += body * exp(-dot(lp, lp) * 9.0) * 0.18;

  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 Rf = reflect(-V, n);
  float F = 0.025 + 0.975 * pow(max(1.0 - n.z, 0.0), 5.0);
  vec3 env = envMap(Rf, uTilt, 1.0);

  if (gold > 0.01) {
    vec3 gc = vec3(1.0, 0.7, 0.26);
    vec2 gp = w * 1.6 + n.xy * 0.8;
    float swirl = fbm(gp + vec2(uTime * 0.15, -uTime * 0.1) + seed * 7.0);
    vec3 metal = gc * (0.18 + 0.95 * swirl * swirl) * (0.55 + 0.6 * core) + env * gc * 0.9;
    vec2 gl = (w + n.xy * 0.03) * 26.0;
    float sp = hash12(floor(gl) + floor(seed * 97.0));
    float tw = pow(max(0.0, sin(uTime * 3.3 + sp * 60.0)), 24.0) * step(0.9, sp);
    metal += vec3(1.0, 0.85, 0.5) * tw * 9.0 * (0.3 + core);
    col = mix(col, metal, clamp(gold, 0.0, 1.0));
  }
  if (pearl > 0.01) {
    vec3 film = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + n.z * 1.3 + dot(n.xy, vec2(0.8, 0.45)) + uTilt.x * 0.6));
    vec3 pc = mix(vec3(0.93, 0.91, 0.87), film, 0.32) * (0.62 + 0.45 * core) + body * 0.05;
    col = mix(col, pc, clamp(pearl, 0.0, 1.0) * 0.9);
  }
  if (opal > 0.01) {
    vec2 op = w * 1.25 + n.xy * 1.2 + uTilt * 2.0 + seed * 13.0;
    float cell = vnoise(op * 1.6 + uTime * 0.07);
    vec3 fire = 0.5 + 0.5 * cos(6.2831 * (cell * 2.6 + vec3(0.0, 0.33, 0.67) + n.x * 0.4));
    float mask = smoothstep(0.38, 0.62, vnoise(op * 2.3 - uTime * 0.05 + 4.0));
    float fleck = smoothstep(0.72, 0.9, vnoise(op * 7.0 + 9.0));
    vec3 oc = vec3(0.78, 0.86, 0.94) * (0.5 + 0.45 * core) + fire * (mask * 1.6 + fleck * 1.2) * (0.5 + 0.6 * core);
    col = mix(col, oc, clamp(opal, 0.0, 1.0) * 0.95);
  }
  if (mercury > 0.01) {
    // liquid mirror: dark chrome reflecting the studio, faint surface ripples
    vec3 hc = vec3(0.8, 0.84, 0.9);
    vec2 rp = n.xy + 0.035 * vec2(sin(w.y * 9.0 + uTime * 3.0), cos(w.x * 8.0 - uTime * 2.4));
    vec3 Rm = reflect(vec3(0.0, 0.0, -1.0), normalize(vec3(rp, n.z)));
    vec3 menv = envMap(Rm, uTilt, 0.0);
    // horizon line of the studio reflected in the ball
    float horizon = smoothstep(-0.05, 0.05, Rm.y);
    vec3 mc = hc * mix(vec3(0.03), vec3(0.16), horizon) + menv * hc * 0.85;
    mc = mix(mc, hc * 1.1, smoothstep(0.12, 0.0, n.z) * 0.8); // backlit rim
    col = mix(col, mc, clamp(mercury, 0.0, 1.0));
    flash *= 1.0 - 0.85 * clamp(mercury, 0.0, 1.0);
    env = mix(env, menv, clamp(mercury, 0.0, 1.0));
  }
  if (prism > 0.01) {
    // clear glass that splits the light into a moving spectrum
    vec3 pb = texture(uScene, vUv + refr * uW2U.xy * 3.0).rgb;
    float band = dot(n.xy, vec2(0.8, 0.6)) * 2.6 + uTime * 0.25 + seed * 3.0;
    vec3 spec = 0.5 + 0.5 * cos(6.2831 * (band + vec3(0.0, 0.33, 0.67)));
    spec *= spec;
    vec3 pc = pb * (0.35 + 0.35 * core) + spec * (0.9 + 0.5 * (1.0 - core));
    pc += vec3(1.3) * smoothstep(0.93, 1.0, fract(band * 1.5)) * (0.5 + 0.5 * core);
    pc *= mix(0.25, 1.0, smoothstep(0.05, 0.35, n.z)); // crisp dark glass edge
    col = mix(col, pc, clamp(prism, 0.0, 1.0));
  }
  col = mix(col, env, F);
  if (fuse > 0.01) {
    float cr = abs(fbm(w * 3.2 + seed * 9.0 + vec2(0.0, uTime * 0.9)) - 0.5);
    float crack = smoothstep(0.045, 0.0, cr) * (0.6 + 0.4 * sin(uTime * 23.0 + seed * 10.0));
    col += vec3(0.75, 0.45, 1.0) * crack * fuse * 7.0 * (0.35 + core);
    col += vec3(0.45, 0.25, 0.95) * fuse * fuse * 0.6 * core;
  }
  col += (body * 1.6 + 0.4) * flash * (0.4 + core);

  // murk / ink clouds in front of the drop
  float wl = uJar.z + texture(uWave, vec2(w.x / uJar.x, 0.5)).r;
  if (w.y < wl && w.x > 0.0 && w.x < uJar.x) {
    vec4 dye = texture(uDye, w * uDyeMap.xy + uDyeMap.zw);
    dye.rgb = 2.2 * (1.0 - exp(-dye.rgb / 2.2));
    col *= exp(-dye.rgb * uDyeK * uFront);
    float haze = 1.0 - exp(-(dye.a * 1.3 + uMurk * 1.6) * uFront);
    col = mix(col, uMurkCol * (0.3 + 0.7 * lum(col)), haze);
    if (uMilk > 0.0) col = mix(col, vec3(1.0, 0.955, 0.87) * 1.25 * exp(-dye.rgb * uDyeK * 0.45), 0.34 * uMilk);
  }
  if (uCosmic > 0.0) {
    float rimg = pow(max(1.0 - n.z, 0.0), 2.0);
    col += vec3(0.55, 0.35, 1.0) * rimg * 1.2 * uCosmic + vec3(0.3, 0.6, 1.0) * rimg * rimg * 1.2 * uCosmic;
    col += body * 0.12 * uCosmic; // faint inner glow so drops stay readable against the dark
  }
  o = vec4(mix(scene * (1.0 - ao * 0.18), col, alpha), 1.0);
}`;

// ------------------------------------------------------------------ bubbles
export const BUBBLE_VS = HEAD + `
layout(location=0) in vec2 aQ;
layout(location=1) in vec4 iB; // x y r alpha
uniform vec4 uW2U;
out vec2 vQ; out float vR; out float vA;
void main(){
  vQ = aQ * 1.15; vR = iB.z; vA = iB.w;
  vec2 wp = iB.xy + vQ * iB.z;
  vec2 uv = wp * uW2U.xy + uW2U.zw;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}`;

export const BUBBLE_FS = HEAD + `
in vec2 vQ; in float vR; in float vA; out vec4 o;
uniform sampler2D uScene; uniform vec4 uW2U; uniform vec2 uRes;
void main(){
  float d = length(vQ);
  if (d > 1.0) discard;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 off = -vQ * vR * 1.6;
  vec3 bg = texture(uScene, uv + off * uW2U.xy).rgb;
  vec3 col = bg * 1.04;
  float rim = smoothstep(0.5, 1.0, d);
  col *= 1.0 - rim * 0.8;
  col += vec3(1.0) * smoothstep(0.9, 0.99, d) * smoothstep(1.0, 0.985, d) * 0.5;
  vec2 hp = vQ - vec2(-0.32, 0.38);
  col += vec3(4.0) * exp(-dot(hp, hp) * 45.0);
  vec2 cp = vQ - vec2(0.28, -0.42);
  col += bg * exp(-dot(cp, cp) * 18.0) * 0.5;
  float a = smoothstep(1.0, 0.95, d) * vA;
  o = vec4(col, a);
}`;

// ------------------------------------------------------------------ glass, rim, table, pipette
export const GLASS = HEAD + COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uLabel, uWave;
uniform vec4 uU2W, uW2U, uPip;
uniform vec3 uJar, uCaus, uPipInk;
uniform vec2 uTilt, uDanger;
uniform float uTime, uPx, uPipLevel, uPipVis, uPipLen;
const float WALL = 0.2;
const float BASE = 0.55;

vec3 sceneAt(vec2 w){ return texture(uScene, w * uW2U.xy + uW2U.zw).rgb; }

void main(){
  vec2 w = vUv * uU2W.xy + uU2W.zw;
  vec3 col = texture(uScene, vUv).rgb;
  float W = uJar.x, H = uJar.y;
  float cx = W * 0.5;
  float Ro = cx + WALL;
  float u = (w.x - cx) / Ro;
  float au = abs(u);
  float s = sqrt(max(1.0 - u * u, 0.0));
  float px = 1.0 / uPx;
  float eB = ellE(0.0, H);
  float yBot = -BASE - eB * s; // outer bottom edge of the thick base
  float eT = ellE(H, H);
  float yTopB = H + eT * s;

  // ---- table: reflection of the jar, contact shadow, coloured caustic pool
  if (au < 1.6 && w.y < -BASE + 0.05) {
    float sb = sqrt(max(1.0 - min(au, 1.0) * min(au, 1.0), 0.0));
    float yb = -BASE - eB * sb;
    float below = yb - w.y;
    if (below > 0.0 && au < 1.0) {
      vec2 m = vec2(w.x, yb + below * 1.05 + 0.02);
      vec3 r = (sceneAt(m) + sceneAt(m + vec2(0.06, 0.05)) + sceneAt(m - vec2(0.06, -0.05))) / 3.0;
      col = mix(col, r, 0.32 * exp(-below * 1.1));
      col *= 1.0 - 0.7 * exp(-below * 16.0);
    }
    vec2 cp = (w - vec2(cx, yb - 0.75)) / vec2(Ro * 0.85, 0.42);
    float pool = exp(-pow(dot(cp, cp), 1.5) * 1.6);
    float cz = caustic(vec2(w.x * 1.1, w.y * 3.2) + 5.0, uTime * 0.4);
    col += uCaus * pool * (0.1 + cz * 0.22);
  }

  // ---- jar body
  if (au < 1.0 && w.y > yBot - px && w.y < yTopB + 0.12) {
    float ui = (w.x - cx) / cx;
    bool wall = abs(ui) > 1.0;
    float si0 = sqrt(max(1.0 - ui * ui, 0.0));
    float yFloorF = -eB * si0; // front edge of the inner floor (seen from above)
    bool base = w.y < yFloorF || wall && w.y < 0.0;
    float tw = wall ? (au - cx / Ro) / (1.0 - cx / Ro) : 0.0;
    vec2 off = vec2(0.0);
    if (wall) off.x = -sign(u) * (0.1 + 0.55 * tw * tw);
    else off.x = -u * u * u * 0.05;
    if (base) { off.y = (yFloorF - w.y) * 1.3 + 0.08; off.x -= u * 0.3; }
    vec3 g = sceneAt(w + off);
    if (base) {
      vec2 sm = vec2(0.22, 0.0);
      g = (g * 2.0 + sceneAt(w + off + sm) + sceneAt(w + off - sm) + sceneAt(w + off + sm * 2.2) + sceneAt(w + off - sm * 2.2)) / 6.0;
      g = mix(g, vec3(lum(g)) * vec3(0.8, 0.95, 0.88), 0.4) * 0.62;
    }
    float path = wall ? (0.8 + 3.2 * tw) : (base ? 2.6 : 0.2 / max(s, 0.25));
    g *= exp(-vec3(0.2, 0.045, 0.14) * path);
    if (wall) {
      g += vec3(0.85, 1.0, 0.95) * exp(-sq((tw - 0.03) / 0.03)) * 0.55;
      g *= 1.0 - 0.6 * exp(-sq((tw - 0.24) / 0.11));
      g *= mix(1.0, 0.4, smoothstep(0.7, 1.0, tw));
      g += vec3(1.0) * exp(-sq((tw - 0.965) / 0.02)) * 0.45;
    }
    if (base) {
      g += vec3(0.85, 1.0, 0.92) * exp(-sq((w.y - yBot) / 0.035)) * 0.9;
      g *= 0.85 + 0.35 * caustic(w * 3.3 + 2.0, uTime * 0.5);
      g *= 1.0 - 0.25 * smoothstep(yBot + 0.1, yFloorF, w.y); // darker towards the floor edge
    }
    float edgeAA = clamp((1.0 - au) * Ro / px, 0.0, 1.0) * clamp((w.y - yBot) / px, 0.0, 1.0);
    col = mix(col, g, edgeAA);
    if (!wall) {
      // inner floor: bright front edge where the thick base begins, faint back edge behind
      col += vec3(0.9, 1.0, 0.95) * exp(-sq((w.y - yFloorF) / (px * 1.4 + 0.012))) * 0.55;
      col *= 1.0 - 0.25 * exp(-sq((w.y - (yFloorF - 0.05)) / 0.04));
      col += vec3(0.9, 1.0, 0.95) * exp(-sq((w.y - eB * si0) / (px + 0.01))) * 0.12;
    }

    // printed graduation (wraps around the cylinder)
    if (!base && w.y < H) {
      float ang = asin(clamp(u, -1.0, 1.0));
      float ey = ellE(w.y, H) * s;
      vec2 luv = vec2((ang - 0.05) / 1.2, 1.0 - (w.y + ey) / H);
      if (luv.x > 0.0 && luv.x < 1.0 && luv.y > 0.0 && luv.y < 1.0) {
        vec4 lab = texture(uLabel, luv);
        float shade = 0.7 + 0.35 * s;
        col = col * (1.0 - lab.a * 0.9) + lab.rgb * 0.9 * shade * 1.15;
      }
      // MAX line
      float ey2 = ellE(uDanger.x, H) * s;
      float yl = uDanger.x - ey2;
      float dl = exp(-sq((w.y - yl) / (px * 1.2 + 0.01)));
      float dash = step(0.3, fract(w.x * 2.2));
      float pulse = uDanger.y * (0.6 + 0.4 * sin(uTime * 12.0));
      col = mix(col, vec3(0.8, 0.1, 0.08) * (1.0 + pulse * 4.0), dl * dash * (0.55 + 0.45 * uDanger.y) * float(!wall));
      col += vec3(1.0, 0.15, 0.05) * exp(-abs(w.y - yl) * 5.0) * pulse * 0.25 * float(!wall);
    }

    // water surface: visible top of the water (ellipse band) + meniscus
    if (!wall) {
      float wave = texture(uWave, vec2(w.x / W, 0.5)).r;
      float si = sqrt(max(1.0 - ui * ui, 0.0));
      float eW = ellE(uJar.z, H) * 0.8;
      float menis = 0.08 * exp(-(1.0 - abs(ui)) * 24.0);
      float yF = uJar.z + wave - eW * si + menis;
      float yB = uJar.z + wave * 0.5 + eW * si + menis;
      float band = smoothstep(yF - px, yF + px, w.y) * smoothstep(yB + px, yB - px, w.y);
      vec3 surf = col * 0.8 + vec3(0.05, 0.055, 0.06);
      float gl = pow(max(0.0, sin(w.x * 3.0 + wave * 30.0 + uTime)), 12.0);
      surf += vec3(1.2) * gl * 0.25;
      col = mix(col, surf, band * 0.75);
      col += vec3(1.0) * exp(-sq((w.y - yF) / (px * 1.3 + 0.006))) * 0.75;
      col *= 1.0 - 0.3 * exp(-sq((w.y - (yF - 0.05)) / 0.03));
      col += vec3(1.0) * exp(-sq((w.y - yB) / (px + 0.005))) * 0.3;
    }

    // front-surface reflections: vertical softbox stripes
    float uu = u + 0.005 * sin(w.y * 2.7 + 1.0) - uTilt.x * 0.05;
    float st = exp(-p6((uu + 0.6) / 0.03)) * 0.2
             + exp(-sq((uu + 0.79) / 0.01)) * 1.6
             + exp(-sq(sq((uu - 0.68) / 0.02))) * 0.14
             + exp(-sq((uu - 0.87) / 0.01)) * 2.4;
    float vfade = smoothstep(yBot, yBot + 1.4, w.y) * smoothstep(yTopB + 0.1, H - 1.2, w.y);
    col += vec3(1.0, 0.99, 0.97) * st * vfade;
    float fres = sq(sq(1.0 - s));
    col = mix(col, vec3(0.03), fres * 0.55);

    // rim (lip) — back and front arcs of the opening
    float yRF = H - eT * s;
    float yRB = yTopB;
    float bw = 0.07;
    float rimB = exp(-sq((w.y - yRB) / (bw * 0.8)));
    float rimF = exp(-sq((w.y - yRF) / bw));
    col = mix(col, col * 0.55 + vec3(0.03, 0.05, 0.045), rimB * 0.55);
    col += vec3(0.9, 1.0, 0.96) * exp(-sq((w.y - (yRB + bw * 0.5)) / (bw * 0.25))) * 0.5;
    col = mix(col, col * 0.45 + vec3(0.04, 0.07, 0.06), rimF * 0.65);
    col += vec3(0.95, 1.0, 0.97) * exp(-sq((w.y - (yRF + bw * 0.55)) / (bw * 0.22))) * (0.35 + 0.9 * smoothstep(0.4, -0.8, u));
    col += vec3(1.0) * exp(-sq((w.y - (yRF - bw * 0.7)) / (bw * 0.2))) * 0.25;
  }

  // ---- pipette
  if (uPipVis > 0.0) {
    float a = uPip.z;
    vec2 piv = vec2(uPip.x, uPip.y + uPipLen);
    vec2 d = w - piv;
    float ca = cos(-a), sa = sin(-a);
    vec2 lp = vec2(ca * d.x - sa * d.y, sa * d.x + ca * d.y) + vec2(0.0, uPipLen);
    float sqz = uPip.w;
    float tubeTop = 2.05;
    float rT = mix(0.05, 0.15, smoothstep(0.0, 0.85, lp.y));
    float sdT = max(abs(lp.x) - rT, max(-lp.y, lp.y - tubeTop));
    float sdC = max(abs(lp.x) - 0.23, abs(lp.y - (tubeTop + 0.06)) - 0.07);
    vec2 brad = vec2(0.33 * (1.0 + 0.2 * sqz), 0.58 * (1.0 - 0.12 * sqz));
    vec2 bc = vec2(0.0, tubeTop + 0.1 + brad.y * 0.92);
    vec2 bp = (lp - bc) / brad;
    float sdB = (length(bp) - 1.0) * min(brad.x, brad.y);
    // tube
    float covT = clamp(0.5 - sdT / px, 0.0, 1.0) * uPipVis;
    if (covT > 0.0) {
      float xn = clamp(lp.x / rT, -1.0, 1.0);
      vec3 tb = sceneAt(w + vec2(-xn * 0.07, 0.0));
      float inner = 1.0 - 0.02 / rT;
      float liqTop = 0.1 + uPipLevel * 1.8;
      float liquid = step(abs(xn), inner) * smoothstep(liqTop + 0.015, liqTop - 0.015, lp.y - 0.04 * xn * xn);
      float path = 2.0 * rT * sqrt(max(inner * inner - xn * xn, 0.0)) * 7.0;
      tb *= mix(vec3(1.0), exp(-uPipInk * path), liquid);
      tb *= 1.0 - smoothstep(inner - 0.15, 1.0, abs(xn)) * 0.6;
      tb += vec3(1.0) * exp(-sq((xn + 0.48) / 0.11)) * 0.65;
      tb += vec3(1.0) * exp(-sq((xn - 0.72) / 0.06)) * 0.22;
      tb *= vec3(0.95, 1.0, 0.98);
      col = mix(col, tb, covT);
    }
    // collar
    float covC = clamp(0.5 - sdC / px, 0.0, 1.0) * uPipVis;
    if (covC > 0.0) {
      float xn = lp.x / 0.23;
      vec3 cc = vec3(0.06, 0.06, 0.07) * (0.6 + 0.4 * (1.0 - xn * xn)) + vec3(0.6) * exp(-sq((xn + 0.45) / 0.15)) * 0.5;
      col = mix(col, cc, covC);
    }
    // rubber bulb (backlit edges glow translucent red)
    float covB = clamp(0.5 - sdB / px, 0.0, 1.0) * uPipVis;
    if (covB > 0.0) {
      float bd = min(length(bp), 1.0);
      vec3 nb = normalize(vec3(bp.x, bp.y * 0.7 + 0.035 * sin(lp.y * 38.0) * (1.0 - bd), sqrt(max(1.0 - bd * bd, 0.0)) + 0.05));
      vec3 kd = normalize(vec3(-0.5 + uTilt.x * 0.3, 0.6, 0.62));
      float diff = max(dot(nb, kd), 0.0);
      vec3 rub = vec3(0.3, 0.03, 0.025) * (0.2 + 0.85 * diff);
      float spec = pow(max(dot(reflect(vec3(0.0, 0.0, -1.0), nb), kd), 0.0), 18.0);
      rub += vec3(1.0, 0.8, 0.75) * spec * 0.55;
      rub += vec3(1.0, 0.25, 0.15) * pow(max(1.0 - nb.z, 0.0), 3.0) * 0.7;
      col = mix(col, rub, covB);
    }
  }
  o = vec4(col, 1.0);
}`;

// ------------------------------------------------------------------ post
export const BLOOM_PRE = HEAD + `
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uT; uniform float uThr, uKnee;
void main(){
  vec3 c = texture(uSrc, vUv + uT * vec2(-0.5, -0.5)).rgb + texture(uSrc, vUv + uT * vec2(0.5, -0.5)).rgb
         + texture(uSrc, vUv + uT * vec2(-0.5, 0.5)).rgb + texture(uSrc, vUv + uT * vec2(0.5, 0.5)).rgb;
  c *= 0.25;
  c = min(c, vec3(60.0));
  float br = max(c.r, max(c.g, c.b));
  float rq = clamp(br - uThr + uKnee, 0.0, 2.0 * uKnee);
  rq = rq * rq / (4.0 * uKnee + 1e-4);
  c *= max(rq, br - uThr) / max(br, 1e-4);
  o = vec4(c, 1.0);
}`;

export const BLOOM_DOWN = HEAD + `
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uT;
void main(){
  vec3 c = texture(uSrc, vUv).rgb * 4.0;
  c += texture(uSrc, vUv + uT * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uT * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uT * vec2(-1.0, 1.0)).rgb;
  c += texture(uSrc, vUv + uT * vec2(1.0, 1.0)).rgb;
  o = vec4(c / 8.0, 1.0);
}`;

export const BLOOM_UP = HEAD + `
in vec2 vUv; out vec4 o;
uniform sampler2D uSrc; uniform vec2 uT; uniform float uK;
void main(){
  vec3 c = vec3(0.0);
  c += texture(uSrc, vUv + uT * vec2(-1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uT * vec2(0.0, -1.0)).rgb * 2.0;
  c += texture(uSrc, vUv + uT * vec2(1.0, -1.0)).rgb;
  c += texture(uSrc, vUv + uT * vec2(-1.0, 0.0)).rgb * 2.0;
  c += texture(uSrc, vUv).rgb * 4.0;
  c += texture(uSrc, vUv + uT * vec2(1.0, 0.0)).rgb * 2.0;
  c += texture(uSrc, vUv + uT * vec2(-1.0, 1.0)).rgb;
  c += texture(uSrc, vUv + uT * vec2(0.0, 1.0)).rgb * 2.0;
  c += texture(uSrc, vUv + uT * vec2(1.0, 1.0)).rgb;
  o = vec4(c / 16.0 * uK, 1.0);
}`;

export const FINAL = HEAD + COMMON + `
in vec2 vUv; out vec4 o;
uniform sampler2D uScene, uBloom;
uniform vec4 uShock[4];
uniform vec2 uRes;
uniform float uAspect, uTime, uBloomK, uFlash, uExposure;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
void main(){
  vec2 uv = vUv;
  vec2 disp = vec2(0.0);
  float ca = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 s = uShock[i];
    if (s.w <= 0.0) continue;
    vec2 d = uv - s.xy; d.x *= uAspect;
    float dist = length(d);
    float wdt = 0.03 + s.z * 0.18;
    float ring = exp(-sq((dist - s.z) / wdt));
    vec2 dir = d / max(dist, 1e-4);
    disp -= dir * ring * s.w * vec2(1.0 / uAspect, 1.0);
    ca += ring * s.w;
  }
  vec2 cc = uv - 0.5;
  float edge = dot(cc, cc);
  vec2 cav = cc * (0.0012 + edge * 0.006 + ca * 0.5);
  vec2 suv = uv + disp;
  vec3 col;
  col.r = texture(uScene, suv + cav).r;
  col.g = texture(uScene, suv).g;
  col.b = texture(uScene, suv - cav).b;
  col += texture(uBloom, suv).rgb * uBloomK;
  col += uFlash * vec3(1.0, 0.96, 0.92);
  col *= uExposure;
  col = aces(col);
  col *= 1.0 - edge * 0.55;
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  float gr = hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 400.0) - 0.5;
  col += gr * 0.022;
  o = vec4(col, 1.0);
}`;
