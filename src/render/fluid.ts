import { GLX, Program, type Double, type Target } from '../gl/gl';
import { FS_VERT } from './shaders';

// Stable-fluids solver on the water region. Velocity is stored in velocity-grid texels/second.
// Dye stores ink absorbance (rgb) + turbidity (a); rendering applies exp(-dye).

const H = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 o;
`;

const ADVECT = H + `
uniform sampler2D uVel, uSrc;
uniform vec2 uVelTexel;
uniform float uDt, uDiss, uDissA;
void main(){
  vec2 c = vUv - uDt * texture(uVel, vUv).xy * uVelTexel;
  vec4 v = texture(uSrc, c);
  o = vec4(v.rgb / (1.0 + uDiss * uDt), v.a / (1.0 + uDissA * uDt));
}`;

const DIVERGENCE = H + `
uniform sampler2D uVel; uniform vec2 uT;
void main(){
  float L = texture(uVel, vUv - vec2(uT.x,0)).x;
  float R = texture(uVel, vUv + vec2(uT.x,0)).x;
  float B = texture(uVel, vUv - vec2(0,uT.y)).y;
  float T = texture(uVel, vUv + vec2(0,uT.y)).y;
  vec2 C = texture(uVel, vUv).xy;
  if (vUv.x - uT.x < 0.0) L = -C.x;
  if (vUv.x + uT.x > 1.0) R = -C.x;
  if (vUv.y - uT.y < 0.0) B = -C.y;
  if (vUv.y + uT.y > 1.0) T = -C.y;
  o = vec4(0.5 * (R - L + T - B), 0, 0, 1);
}`;

const CURL = H + `
uniform sampler2D uVel; uniform vec2 uT;
void main(){
  float L = texture(uVel, vUv - vec2(uT.x,0)).y;
  float R = texture(uVel, vUv + vec2(uT.x,0)).y;
  float B = texture(uVel, vUv - vec2(0,uT.y)).x;
  float T = texture(uVel, vUv + vec2(0,uT.y)).x;
  o = vec4(0.5 * (R - L - T + B), 0, 0, 1);
}`;

const VORTICITY = H + `
uniform sampler2D uVel, uCurl; uniform vec2 uT; uniform float uCurlK, uDt;
void main(){
  float L = texture(uCurl, vUv - vec2(uT.x,0)).x;
  float R = texture(uCurl, vUv + vec2(uT.x,0)).x;
  float B = texture(uCurl, vUv - vec2(0,uT.y)).x;
  float T = texture(uCurl, vUv + vec2(0,uT.y)).x;
  float C = texture(uCurl, vUv).x;
  vec2 f = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f /= length(f) + 1e-4;
  f *= uCurlK * C;
  f.y *= -1.0;
  vec2 v = texture(uVel, vUv).xy + f * uDt;
  o = vec4(clamp(v, -2000.0, 2000.0), 0, 1);
}`;

const PRESSURE = H + `
uniform sampler2D uP, uDiv; uniform vec2 uT;
void main(){
  float L = texture(uP, vUv - vec2(uT.x,0)).x;
  float R = texture(uP, vUv + vec2(uT.x,0)).x;
  float B = texture(uP, vUv - vec2(0,uT.y)).x;
  float T = texture(uP, vUv + vec2(0,uT.y)).x;
  float d = texture(uDiv, vUv).x;
  o = vec4((L + R + B + T - d) * 0.25, 0, 0, 1);
}`;

const GRADIENT = H + `
uniform sampler2D uP, uVel; uniform vec2 uT;
void main(){
  float L = texture(uP, vUv - vec2(uT.x,0)).x;
  float R = texture(uP, vUv + vec2(uT.x,0)).x;
  float B = texture(uP, vUv - vec2(0,uT.y)).x;
  float T = texture(uP, vUv + vec2(0,uT.y)).x;
  vec2 v = texture(uVel, vUv).xy - vec2(R - L, T - B);
  // no-slip-ish walls: fade velocity at the jar walls and floor
  float wall = smoothstep(0.0, 0.025, vUv.x) * smoothstep(1.0, 0.975, vUv.x) * smoothstep(0.0, 0.02, vUv.y);
  o = vec4(v * mix(0.6, 1.0, wall), 0, 1);
}`;

const SCALE = H + `
uniform sampler2D uSrc; uniform float uK;
void main(){ o = texture(uSrc, vUv) * uK; }`;

// Batched gaussian splats. uP: xy = uv, z = radius² (in uv-y units), w = unused.
const SPLAT = H + `
uniform sampler2D uSrc; uniform float uAspect; uniform int uN;
uniform vec4 uP[24]; uniform vec4 uV[24];
void main(){
  vec4 base = texture(uSrc, vUv);
  for (int i = 0; i < 24; i++) {
    if (i >= uN) break;
    vec2 d = vUv - uP[i].xy; d.x *= uAspect;
    base += uV[i] * exp(-dot(d, d) / uP[i].z);
  }
  o = base;
}`;

// Multiplicative erase (explosions clear the water).
const ERASE = H + `
uniform sampler2D uSrc; uniform float uAspect; uniform int uN;
uniform vec4 uP[8];
void main(){
  vec4 base = texture(uSrc, vUv);
  for (int i = 0; i < 8; i++) {
    if (i >= uN) break;
    vec2 d = vUv - uP[i].xy; d.x *= uAspect;
    float g = exp(-pow(dot(d, d) / uP[i].z, 2.0));
    base *= 1.0 - uP[i].w * g;
  }
  o = base;
}`;

// Heavy ink sinks; turbidity slowly settles too.
const BUOY = H + `
uniform sampler2D uVel, uDye; uniform float uK, uDt;
void main(){
  vec2 v = texture(uVel, vUv).xy;
  vec4 d = texture(uDye, vUv);
  v.y -= uK * (d.r + d.g + d.b + d.a * 0.5) * uDt;
  o = vec4(v, 0, 1);
}`;

export interface Splat {
  x: number; // uv
  y: number;
  r: number; // radius in uv-y units
  v: [number, number, number, number];
}

export class Fluid {
  vel!: Double;
  dye!: Double;
  pres!: Double;
  div!: Target;
  curl!: Target;
  aspect = 1;
  private p: Record<string, Program>;
  velSplats: Splat[] = [];
  dyeSplats: Splat[] = [];
  erases: Splat[] = [];
  curlK = 26;
  dissipation = 0.35;
  dissipationA = 0.25;
  buoyancy = 22;

  constructor(private g: GLX) {
    this.p = {
      advect: g.program(FS_VERT, ADVECT, 'advect'),
      div: g.program(FS_VERT, DIVERGENCE, 'div'),
      curl: g.program(FS_VERT, CURL, 'curl'),
      vort: g.program(FS_VERT, VORTICITY, 'vort'),
      pres: g.program(FS_VERT, PRESSURE, 'pres'),
      grad: g.program(FS_VERT, GRADIENT, 'grad'),
      scale: g.program(FS_VERT, SCALE, 'scale'),
      splat: g.program(FS_VERT, SPLAT, 'splat'),
      erase: g.program(FS_VERT, ERASE, 'erase'),
      buoy: g.program(FS_VERT, BUOY, 'buoy'),
    };
  }

  resize(simW: number, dyeW: number, aspect: number) {
    const g = this.g;
    this.aspect = aspect;
    const sh = Math.round(simW / aspect);
    const dh = Math.round(dyeW / aspect);
    const oldDye = this.dye;
    this.vel = g.double(simW, sh);
    this.pres = g.double(simW, sh);
    this.div = g.target(simW, sh, g.gl.NEAREST);
    this.curl = g.target(simW, sh, g.gl.NEAREST);
    this.dye = g.double(dyeW, dh);
    if (oldDye) {
      // carry the ink over
      g.bind(this.dye.write);
      this.p.scale.use().set('uSrc', oldDye.read.tex).set('uK', 1);
      g.fullscreen();
      this.dye.swap();
    }
  }

  /** world velocity (units/s) → velocity-grid texels/s */
  get texPerUnitX() {
    return this.vel.w;
  }

  step(dt: number) {
    const g = this.g;
    const gl = g.gl;
    const { p, vel, dye, pres } = this;
    gl.disable(gl.BLEND);
    const vt = [vel.tx, vel.ty];

    this.flushSplats(vel, this.velSplats);
    this.flushSplats(dye, this.dyeSplats);
    if (this.erases.length) {
      g.bind(dye.write);
      const P = new Float32Array(32);
      const n = Math.min(8, this.erases.length);
      for (let i = 0; i < n; i++) {
        const s = this.erases[i];
        P.set([s.x, s.y, s.r * s.r, s.v[0]], i * 4);
      }
      p.erase.use().set('uSrc', dye.read.tex).set('uAspect', this.aspect).set('uN', n).set('uP', P);
      g.fullscreen();
      dye.swap();
      this.erases.length = 0;
    }

    g.bind(vel.write);
    p.buoy.use().set('uVel', vel.read.tex).set('uDye', dye.read.tex).set('uK', this.buoyancy).set('uDt', dt);
    g.fullscreen();
    vel.swap();

    g.bind(this.curl);
    p.curl.use().set('uVel', vel.read.tex).set('uT', vt);
    g.fullscreen();

    g.bind(vel.write);
    p.vort.use().set('uVel', vel.read.tex).set('uCurl', this.curl.tex).set('uT', vt).set('uCurlK', this.curlK).set('uDt', dt);
    g.fullscreen();
    vel.swap();

    g.bind(this.div);
    p.div.use().set('uVel', vel.read.tex).set('uT', vt);
    g.fullscreen();

    g.bind(pres.write);
    p.scale.use().set('uSrc', pres.read.tex).set('uK', 0.8);
    g.fullscreen();
    pres.swap();

    p.pres.use();
    for (let i = 0; i < 18; i++) {
      g.bind(pres.write);
      p.pres.use().set('uP', pres.read.tex).set('uDiv', this.div.tex).set('uT', vt);
      g.fullscreen();
      pres.swap();
    }

    g.bind(vel.write);
    p.grad.use().set('uP', pres.read.tex).set('uVel', vel.read.tex).set('uT', vt);
    g.fullscreen();
    vel.swap();

    g.bind(vel.write);
    p.advect.use().set('uVel', vel.read.tex).set('uSrc', vel.read.tex).set('uVelTexel', vt).set('uDt', dt).set('uDiss', 0.9).set('uDissA', 0.9);
    g.fullscreen();
    vel.swap();

    g.bind(dye.write);
    p.advect.use().set('uVel', vel.read.tex).set('uSrc', dye.read.tex).set('uVelTexel', vt).set('uDt', dt).set('uDiss', this.dissipation).set('uDissA', this.dissipationA);
    g.fullscreen();
    dye.swap();
  }

  private flushSplats(target: Double, list: Splat[]) {
    const g = this.g;
    const P = new Float32Array(96);
    const V = new Float32Array(96);
    while (list.length) {
      const n = Math.min(24, list.length);
      for (let i = 0; i < n; i++) {
        const s = list[i];
        P.set([s.x, s.y, Math.max(1e-6, s.r * s.r), 0], i * 4);
        V.set(s.v, i * 4);
      }
      list.splice(0, n);
      g.bind(target.write);
      this.p.splat.use().set('uSrc', target.read.tex).set('uAspect', this.aspect).set('uN', n).set('uP', P).set('uV', V);
      g.fullscreen();
      target.swap();
    }
  }
}
