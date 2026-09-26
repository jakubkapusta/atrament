import { GLX, Program, type Double, type MRT, type Target } from '../gl/gl';
import { Fluid } from './fluid';
import * as S from './shaders';
import { makeLabelCanvas } from './label';
import { DANGER, Game, JAR_H, JAR_W, PIP_LEN, TIER_R, TIP_Y, WATER, type Drop, type GameEvent } from '../game/game';
import { INKS, Ink, type Vec3 } from '../game/inks';
import { clamp } from '../core/math';

const FIELD_S = 1.28; // metaball influence radius (in drop radii)
const FIELD_T = Math.pow(1 - 1 / (FIELD_S * FIELD_S), 3); // iso value at d = 1
const DYE_L = WATER + 0.45; // fluid domain height (world)
const INST_FLOATS = 24;
const MAX_INST = 160;

interface Shock {
  x: number;
  y: number;
  t: number;
  dur: number;
  R: number;
  k: number;
}

let probe: HTMLDivElement | null = null;
function safeAreaTop() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px)';
    document.body.appendChild(probe);
  }
  return parseFloat(getComputedStyle(probe).paddingTop) || 0;
}

export interface UISlot {
  x: number; // css px
  y: number;
  size: number; // css px
  piece: { ink: Ink; tier: number } | null;
  dim?: boolean;
}

export class Renderer {
  readonly g: GLX;
  readonly gl: WebGL2RenderingContext;
  cssW = 1;
  cssH = 1;
  scale = 1; // device px per css px
  rw = 1;
  rh = 1;
  sPx = 40; // css px per world unit
  ox = 0; // css px of world origin
  oy = 0;
  w2u = new Float32Array(4);
  u2w = new Float32Array(4);
  private shakeX = 0;
  private shakeY = 0;
  private shakeV = 0;
  tilt = { x: 0, y: 0, tx: 0, ty: 0 };
  flash = 0;
  private time = 0;
  private shocks: Shock[] = [];
  private ambientT = 0;
  quality: number;
  budget: number;
  private frameTimes: number[] = [];

  private fluid: Fluid;
  private p: Record<string, Program> = {};
  private bg!: Target;
  private sceneA!: Target;
  private sceneB!: Target;
  private sceneC!: Target;
  private field!: MRT;
  private bloom: Target[] = [];
  private motes?: Double;
  private moteSide = 64;
  private waveTex: WebGLTexture;
  private labelTex: WebGLTexture;
  private quadVAO: WebGLVertexArrayObject;
  private instBuf: WebGLBuffer;
  private inst = new Float32Array(MAX_INST * INST_FLOATS);
  private bubVAO: WebGLVertexArrayObject;
  private bubBuf: WebGLBuffer;
  private bub = new Float32Array(256 * 4);
  private moteVAO: WebGLVertexArrayObject;
  mode: 'classic' | 'murky' | 'attract' = 'attract';

  constructor(readonly canvas: HTMLCanvasElement) {
    this.g = new GLX(canvas);
    const gl = (this.gl = this.g.gl);
    const mobile = matchMedia('(pointer: coarse)').matches;
    this.budget = mobile ? 1.5e6 : 3.2e6;
    this.quality = 1;
    const g = this.g;
    this.fluid = new Fluid(g);
    const P = (name: string, vs: string, fs: string) => (this.p[name] = g.program(vs, fs, name));
    P('bg', S.FS_VERT, S.BG);
    P('water', S.FS_VERT, S.WATER);
    P('moteUpdate', S.FS_VERT, S.MOTE_UPDATE);
    P('mote', S.MOTE_VS, S.MOTE_FS);
    P('field', S.FIELD_VS, S.FIELD_FS);
    P('drops', S.FS_VERT, S.DROPS);
    P('bubble', S.BUBBLE_VS, S.BUBBLE_FS);
    P('glass', S.FS_VERT, S.GLASS);
    P('bloomPre', S.FS_VERT, S.BLOOM_PRE);
    P('bloomDown', S.FS_VERT, S.BLOOM_DOWN);
    P('bloomUp', S.FS_VERT, S.BLOOM_UP);
    P('final', S.FS_VERT, S.FINAL);

    // unit quad + instance buffer for drops
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.quadVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVAO);
    const qb = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    for (let i = 0; i < 6; i++) {
      gl.enableVertexAttribArray(1 + i);
      gl.vertexAttribPointer(1 + i, 4, gl.FLOAT, false, INST_FLOATS * 4, i * 16);
      gl.vertexAttribDivisor(1 + i, 1);
    }
    this.bubVAO = gl.createVertexArray()!;
    gl.bindVertexArray(this.bubVAO);
    gl.bindBuffer(gl.ARRAY_BUFFER, qb);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.bubBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bubBuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.bub.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
    gl.vertexAttribDivisor(1, 1);
    this.moteVAO = gl.createVertexArray()!;
    gl.bindVertexArray(null);

    // water surface heights (1D)
    this.waveTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, 80, 1, 0, gl.RED, gl.FLOAT, new Float32Array(80));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.labelTex = gl.createTexture()!;
    this.updateLabel();
    this.resize();
  }

  updateLabel() {
    const gl = this.gl;
    const c = makeLabelCanvas();
    gl.bindTexture(gl.TEXTURE_2D, this.labelTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // ---------------------------------------------------------------- layout
  resize() {
    const cssW = Math.max(1, window.innerWidth);
    const cssH = Math.max(1, window.innerHeight);
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr, Math.sqrt((this.budget * this.quality) / (cssW * cssH)));
    const rw = Math.round(cssW * scale);
    const rh = Math.round(cssH * scale);
    this.cssW = cssW;
    this.cssH = cssH;
    this.layout();
    if (rw === this.rw && rh === this.rh && this.sceneA) return;
    this.scale = scale;
    this.rw = rw;
    this.rh = rh;
    this.canvas.width = rw;
    this.canvas.height = rh;
    const g = this.g;
    for (const t of [this.bg, this.sceneA, this.sceneB, this.sceneC, ...this.bloom]) g.deleteTarget(t);
    this.bg = g.target(rw, rh);
    this.sceneA = g.target(rw, rh);
    this.sceneB = g.target(rw, rh);
    this.sceneC = g.target(rw, rh);
    if (this.field) {
      for (const t of this.field.texs) this.gl.deleteTexture(t);
      this.gl.deleteFramebuffer(this.field.fbo);
    }
    this.field = g.mrt(rw * 0.5, rh * 0.5, 3);
    this.bloom = [];
    let bw = rw / 2;
    let bh = rh / 2;
    for (let i = 0; i < 6 && (i === 0 || (bw > 4 && bh > 4)); i++) {
      this.bloom.push(g.target(bw, bh));
      bw /= 2;
      bh /= 2;
    }
    const low = this.quality < 0.8 || this.budget < 2e6;
    const simW = low ? 72 : 96;
    const dyeW = low ? 256 : 400;
    if (!this.fluid.vel || this.fluid.dye.w !== dyeW) this.fluid.resize(simW, dyeW, JAR_W / DYE_L);
    if (!this.motes && g.hdr) this.initMotes(low ? 40 : 64);
  }

  private layout() {
    const { cssW, cssH } = this;
    const portrait = cssH > cssW * 1.2;
    const safeTop = safeAreaTop();
    const hudPx = portrait ? 92 + safeTop : 0;
    const xMin = -0.55;
    const xMax = JAR_W + 0.55;
    const yMin = -1.5;
    const yMax = TIP_Y + 3.35;
    const availH = cssH - hudPx - 6;
    const s = Math.min(cssW / (xMax - xMin), availH / (yMax - yMin));
    this.sPx = s;
    this.ox = cssW / 2 - (JAR_W / 2) * s;
    const spare = availH - (yMax - yMin) * s;
    this.oy = hudPx + spare * 0.3 + yMax * s; // css y of world y = 0
  }

  worldToCss(x: number, y: number) {
    return { x: this.ox + x * this.sPx, y: this.oy - y * this.sPx };
  }
  cssToWorld(x: number, y: number) {
    return { x: (x - this.ox) / this.sPx, y: (this.oy - y) / this.sPx };
  }

  private updateTransforms() {
    const s = this.sPx;
    const ox = this.ox + this.shakeX;
    const oy = this.oy + this.shakeY;
    this.w2u[0] = s / this.cssW;
    this.w2u[1] = s / this.cssH;
    this.w2u[2] = ox / this.cssW;
    this.w2u[3] = (this.cssH - oy) / this.cssH;
    this.u2w[0] = 1 / this.w2u[0];
    this.u2w[1] = 1 / this.w2u[1];
    this.u2w[2] = -this.w2u[2] / this.w2u[0];
    this.u2w[3] = -this.w2u[3] / this.w2u[1];
  }

  private initMotes(side: number) {
    const g = this.g;
    const gl = this.gl;
    this.moteSide = side;
    this.motes = g.double(side, side, gl.NEAREST);
    const data = new Float32Array(side * side * 4);
    for (let i = 0; i < side * side; i++) {
      data[i * 4] = Math.random();
      data[i * 4 + 1] = Math.random() * 0.95;
      data[i * 4 + 2] = Math.random();
      data[i * 4 + 3] = Math.random();
    }
    for (const t of [this.motes.read, this.motes.write]) {
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, side, side, gl.RGBA, gl.FLOAT, data);
    }
  }

  // ---------------------------------------------------------------- fluid helpers
  private dyeUv(x: number, y: number) {
    return { x: x / JAR_W, y: y / DYE_L };
  }
  private velK() {
    return this.fluid.vel.w / JAR_W; // texels per world unit
  }
  private velSplat(x: number, y: number, vx: number, vy: number, r: number) {
    const k = this.velK();
    const p = this.dyeUv(x, y);
    this.fluid.velSplats.push({ x: p.x, y: p.y, r: r / DYE_L, v: [vx * k, vy * k, 0, 0] });
  }
  private dyeSplat(x: number, y: number, a: Vec3, amt: number, r: number, turb = 0) {
    if (y > WATER + 0.3) return;
    const p = this.dyeUv(x, y);
    this.fluid.dyeSplats.push({ x: p.x, y: p.y, r: r / DYE_L, v: [a[0] * amt, a[1] * amt, a[2] * amt, turb] });
  }

  handleEvents(events: GameEvent[], game: Game) {
    const murky = game.mode === 'murky';
    for (const e of events) {
      switch (e.t) {
        case 'splash': {
          const a = INKS[e.ink].absorb;
          const sp = Math.min(e.vy, 14);
          this.velSplat(e.x, WATER - 0.35 - e.r * 0.5, 0, -sp * 1.3, 0.22 + e.r * 0.25);
          this.dyeSplat(e.x, WATER - 0.25, a, 1.1 + e.r * 1.0, 0.14 + e.r * 0.28, murky ? 0.1 : 0);
          break;
        }
        case 'merge': {
          const A = INKS[e.a].absorb;
          const B = INKS[e.b].absorb;
          const n = 6;
          const R = e.r * 0.95;
          const spin = (e.tier % 2 ? 1 : -1) * (2.6 + e.tier * 0.4);
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2;
            const x = e.x + Math.cos(ang) * R;
            const y = e.y + Math.sin(ang) * R;
            this.velSplat(x, y, -Math.sin(ang) * spin, Math.cos(ang) * spin, e.r * 0.5);
            this.dyeSplat(x, y, i % 2 ? A : B, 0.32 + e.tier * 0.05, e.r * 0.38, murky ? 0.16 : 0);
          }
          if (murky) this.dyeSplat(e.x, e.y, [0.2, 0.25, 0.3], 0.3, e.r * 1.4, 0.5 + e.tier * 0.05);
          if (e.kind === 'black') this.flash = Math.max(this.flash, 0.05);
          if (e.kind === 'gold' || e.kind === 'opal' || e.kind === 'pearl') {
            this.addShock(e.x, e.y, e.r * 4, 0.012, 0.7);
            this.flash = Math.max(this.flash, 0.12);
          }
          break;
        }
        case 'dissolve': {
          const a = INKS[e.ink].absorb;
          const amt = e.ink === Ink.K ? 0.3 : 1.2;
          this.dyeSplat(e.x, e.y, a, amt, e.r * 0.9, murky ? 0.12 : 0);
          for (let i = 0; i < 4; i++) {
            const ang = (i / 4) * Math.PI * 2 + e.x;
            this.velSplat(e.x + Math.cos(ang) * e.r * 0.6, e.y + Math.sin(ang) * e.r * 0.6, Math.cos(ang) * 3 + e.vx, Math.sin(ang) * 3 + e.vy, e.r * 0.5);
            this.dyeSplat(e.x + Math.cos(ang) * e.r * 0.8, e.y + Math.sin(ang) * e.r * 0.8, a, amt * 0.4, e.r * 0.4);
          }
          break;
        }
        case 'explode': {
          const n = 12;
          for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2;
            const r0 = e.R * 0.35;
            this.velSplat(e.x + Math.cos(ang) * r0, e.y + Math.sin(ang) * r0, Math.cos(ang) * 16, Math.sin(ang) * 16, e.R * 0.22);
          }
          const p = this.dyeUv(e.x, e.y);
          this.fluid.erases.push({ x: p.x, y: p.y, r: (e.R * 1.1) / DYE_L, v: [murky ? 0.97 : 0.85, 0, 0, 0] });
          this.dyeSplat(e.x, e.y, INKS[Ink.K].absorb, 0.18, e.R * 0.25);
          this.addShock(e.x, e.y, e.R * 1.6, 0.03 + e.tier * 0.004, 0.75);
          this.flash = Math.max(this.flash, 0.1 + e.tier * 0.015);
          this.shakeV = Math.max(this.shakeV, 6 + e.tier * 2.5);
          break;
        }
        case 'impact':
          if (e.speed > 4) this.shakeV = Math.max(this.shakeV, Math.min(3, e.speed * 0.25 * e.r));
          break;
        case 'gameover':
          this.shakeV = 8;
          break;
      }
    }
  }

  private addShock(x: number, y: number, R: number, k: number, dur: number) {
    this.shocks.push({ x, y, t: 0, dur, R, k });
    if (this.shocks.length > 4) this.shocks.shift();
  }

  // ---------------------------------------------------------------- instances
  private writeDrop(i: number, x: number, y: number, r: number, seed: number, d: Partial<Drop> & { ink: Ink }, fuseHeat = 0) {
    const o = i * INST_FLOATS;
    const f = this.inst;
    const colF = INKS[d.ink].absorb;
    const colA = INKS[d.colA ?? d.ink].absorb;
    const colB = INKS[d.colB ?? d.ink].absorb;
    const def = INKS[d.ink];
    f[o] = x;
    f[o + 1] = y;
    f[o + 2] = r;
    f[o + 3] = seed;
    f[o + 4] = d.a2x ?? 0;
    f[o + 5] = d.a2y ?? 0;
    f[o + 6] = d.a3x ?? 0;
    f[o + 7] = d.a3y ?? 0;
    f[o + 8] = colA[0];
    f[o + 9] = colA[1];
    f[o + 10] = colA[2];
    f[o + 11] = d.mixT ?? 1;
    f[o + 12] = colB[0];
    f[o + 13] = colB[1];
    f[o + 14] = colB[2];
    f[o + 15] = d.a0 ?? 0;
    f[o + 16] = colF[0];
    f[o + 17] = colF[1];
    f[o + 18] = colF[2];
    f[o + 19] = d.flash ?? 0;
    f[o + 20] = def.gold ?? 0;
    f[o + 21] = def.pearl ?? 0;
    f[o + 22] = def.opal ?? 0;
    f[o + 23] = fuseHeat;
  }

  private buildInstances(game: Game, slots: UISlot[]) {
    let n = 0;
    for (const d of game.drops) {
      if (n >= MAX_INST - 4) break;
      let r = d.r;
      if (d.state === 2 && d.dissolveDelay <= 0) r *= 1 - clamp(d.dissolveT, 0, 1) * 0.5;
      const heat = d.ink === Ink.K ? clamp(1 - d.fuse / 1.6, 0, 1) : 0;
      this.writeDrop(n++, d.x, d.y, r, d.seed, d, d.ink === Ink.K ? 0.25 + heat * 0.75 : 0);
    }
    // drop forming on the pipette tip
    if (game.current && game.pip.grow > 0.02 && !game.over) {
      const h = game.hangPos();
      const p = game.pip;
      const stretch = 0.06 + (1 - p.grow) * 0.2;
      const ang = Math.PI / 2 + p.ang;
      this.writeDrop(n++, h.x, h.y, h.r, 0.37, {
        ink: game.current.ink,
        a2x: Math.cos(2 * ang) * stretch,
        a2y: Math.sin(2 * ang) * stretch,
        a3x: Math.cos(3 * ang) * 0.04 * p.angV,
        a3y: Math.sin(3 * ang) * 0.04,
        a0: Math.sin(this.time * 5) * 0.01,
      });
    }
    // HUD slots (next / hold) rendered as real drops
    for (const s of slots) {
      if (!s.piece) continue;
      const w = this.cssToWorld(s.x, s.y);
      const maxR = (s.size * 0.36) / this.sPx;
      const r = Math.min(TIER_R[s.piece.tier], maxR) * (0.75 + 0.25 * (s.piece.tier / 2));
      this.writeDrop(n++, w.x, w.y, Math.min(r, maxR), 0.71, {
        ink: s.piece.ink,
        a2x: Math.sin(this.time * 2.1 + s.x) * 0.03,
        a2y: Math.cos(this.time * 1.7 + s.y) * 0.03,
        a0: 0,
      });
    }
    return n;
  }

  // ---------------------------------------------------------------- frame
  render(game: Game, dt: number, slots: UISlot[], aimAlpha: number) {
    const gl = this.gl;
    const g = this.g;
    this.time += dt;
    const t = this.time;

    // adaptive quality
    this.frameTimes.push(dt);
    if (this.frameTimes.length >= 90) {
      const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.frameTimes.length = 0;
      if (avg > 1 / 42 && this.quality > 0.45) {
        this.quality *= 0.8;
        this.resize();
      }
    }

    // camera shake, tilt, flash, shocks
    this.shakeV *= Math.exp(-dt * 7);
    this.shakeX = (Math.sin(t * 91) + Math.sin(t * 57) * 0.5) * this.shakeV * 0.5;
    this.shakeY = (Math.cos(t * 83) + Math.sin(t * 43) * 0.5) * this.shakeV * 0.5;
    this.tilt.x += (this.tilt.tx - this.tilt.x) * Math.min(1, dt * 5);
    this.tilt.y += (this.tilt.ty - this.tilt.y) * Math.min(1, dt * 5);
    this.flash *= Math.exp(-dt * 9);
    for (const s of this.shocks) s.t += dt;
    this.shocks = this.shocks.filter((s) => s.t < s.dur);
    this.updateTransforms();
    const w2u = this.w2u;
    const u2w = this.u2w;
    const tilt = [this.tilt.x, this.tilt.y];
    const jar = [JAR_W, JAR_H, WATER];
    const murky = game.mode === 'murky';

    // --- fluid forcing from moving drops
    const fl = this.fluid;
    fl.dissipation = murky ? 0.035 : 0.14;
    fl.dissipationA = murky ? 0.012 : 0.35;
    let budget = 20;
    for (const d of game.drops) {
      if (!d.inWater || d.state === 1) continue;
      const sp = Math.hypot(d.vx, d.vy);
      if (sp < 0.35 || budget <= 0) continue;
      budget--;
      this.velSplat(d.x, d.y, d.vx * 0.55, d.vy * 0.55, d.r * 0.75);
      if (sp > 0.9 && d.y < WATER - 0.2) {
        const a = INKS[d.ink].absorb;
        this.dyeSplat(d.x - d.vx * 0.06, d.y + d.r * 0.55 - d.vy * 0.04, a, Math.min(0.06 * sp, 0.4), d.r * 0.3);
      }
    }
    for (const d of game.drops) {
      if (d.ink === Ink.K && d.state === 0 && d.fuse < 1.2 && Math.random() < 0.3) {
        this.dyeSplat(d.x + (Math.random() - 0.5) * d.r, d.y + d.r * 0.8, INKS[Ink.K].absorb, 0.02, d.r * 0.25);
        this.velSplat(d.x, d.y + d.r, (Math.random() - 0.5) * 1.5, 1.2, d.r * 0.4);
      }
    }
    this.ambientT -= dt;
    if (this.ambientT <= 0) {
      this.ambientT = 0.25;
      this.velSplat(Math.random() * JAR_W, Math.random() * WATER, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.35, 1.2);
    }
    fl.step(Math.min(dt, 1 / 30));

    // wave texture
    gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 80, 1, gl.RED, gl.FLOAT, game.surface.h);

    const dyeMap = [1 / JAR_W, 1 / DYE_L, 0, 0];
    const dyeK = 2.1;
    const murk = game.murk;
    const murkCol = [0.62, 0.58, 0.5];
    const p = this.p;
    gl.disable(gl.BLEND);

    // --- background
    g.bind(this.bg);
    const slotU = new Float32Array(8);
    slots.slice(0, 2).forEach((sl, i) => {
      const w = this.cssToWorld(sl.x, sl.y);
      slotU.set([w.x, w.y, (sl.size * 0.5) / this.sPx, sl.dim ? 0.5 : 1], i * 4);
    });
    p.bg.use().setAll({ uU2W: u2w, uJar: jar, uTilt: tilt, uTime: t, uSlots: slotU });
    g.fullscreen();

    // --- water
    const hang = game.hangPos();
    g.bind(this.sceneA);
    p.water.use().setAll({
      uBg: this.bg.tex, uDye: fl.dye.read.tex, uWave: this.waveTex,
      uU2W: u2w, uW2U: w2u, uDyeMap: dyeMap, uAim: [hang.x, hang.y - hang.r, aimAlpha, 0],
      uJar: jar, uMurkCol: murkCol, uDyeK: dyeK, uTime: t, uMurk: murk, uRayK: 0.16,
    });
    g.fullscreen();

    // --- motes
    if (this.motes) {
      const m = this.motes;
      gl.disable(gl.BLEND);
      g.bind(m.write);
      p.moteUpdate.use().setAll({ uState: m.read.tex, uVel: fl.vel.read.tex, uVelTexel: [fl.vel.tx, fl.vel.ty], uDt: Math.min(dt, 1 / 30), uTime: t % 100 });
      g.fullscreen();
      m.swap();
      g.bind(this.sceneA);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      p.mote.use().setAll({
        uState: m.read.tex, uDye: fl.dye.read.tex, uW2U: w2u, uJar: jar, uL: DYE_L,
        uPx: this.sPx * this.scale, uDyeK: dyeK, uSide: this.moteSide,
      });
      gl.bindVertexArray(this.moteVAO);
      gl.drawArrays(gl.POINTS, 0, this.moteSide * this.moteSide);
      gl.disable(gl.BLEND);
    }

    // --- metaball field
    const n = this.buildInstances(game, slots);
    g.bind(this.field);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (n > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      p.field.use().setAll({ uW2U: w2u, uS: FIELD_S, uTime: t });
      gl.bindVertexArray(this.quadVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst, 0, n * INST_FLOATS);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.disable(gl.BLEND);
    }

    // --- drops shading
    g.bind(this.sceneB);
    p.drops.use().setAll({
      uScene: this.sceneA.tex, uF0: this.field.texs[0], uF1: this.field.texs[1], uF2: this.field.texs[2],
      uDye: fl.dye.read.tex, uWave: this.waveTex,
      uW2U: w2u, uU2W: u2w, uDyeMap: dyeMap, uJar: jar, uMurkCol: murkCol,
      uFT: [1 / this.field.w, 1 / this.field.h], uTilt: tilt,
      uS: FIELD_S, uThr: FIELD_T, uTime: t, uDyeK: dyeK, uFront: murky ? 0.75 : 0.35, uMurk: murk,
    });
    g.fullscreen();

    // --- bubbles
    const bs = game.bubbles;
    const nb = Math.min(bs.length, 256);
    if (nb > 0) {
      for (let i = 0; i < nb; i++) {
        const b = bs[i];
        this.bub[i * 4] = b.x;
        this.bub[i * 4 + 1] = b.y;
        this.bub[i * 4 + 2] = b.r * (1 + 0.08 * Math.sin(b.ph * 1.3));
        this.bub[i * 4 + 3] = Math.min(1, b.life * 8);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      p.bubble.use().setAll({ uScene: this.sceneA.tex, uW2U: w2u, uRes: [this.rw, this.rh] });
      gl.bindVertexArray(this.bubVAO);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bubBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.bub, 0, nb * 4);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nb);
      gl.disable(gl.BLEND);
    }

    // --- glass, table, pipette
    const caus = this.causticColor(game);
    const pip = game.pip;
    const pipInk = game.current ? INKS[game.current.ink].absorb : [0, 0, 0];
    g.bind(this.sceneC);
    p.glass.use().setAll({
      uScene: this.sceneB.tex, uLabel: this.labelTex, uWave: this.waveTex,
      uU2W: u2w, uW2U: w2u, uPip: [pip.x, TIP_Y, pip.ang, pip.squeeze],
      uJar: jar, uCaus: caus, uPipInk: pipInk, uTilt: tilt,
      uDanger: [DANGER, game.mode === 'attract' ? 0 : Math.max(game.danger, game.dangerNear * 0.35)],
      uTime: t, uPx: this.sPx * this.scale, uPipLevel: pip.level, uPipVis: game.over && game.mode !== 'attract' ? 0 : 1, uPipLen: PIP_LEN,
    });
    g.fullscreen();

    // --- bloom
    const bl = this.bloom;
    g.bind(bl[0]);
    p.bloomPre.use().setAll({ uSrc: this.sceneC.tex, uT: [1 / this.rw, 1 / this.rh], uThr: 3.2, uKnee: 1.0 });
    g.fullscreen();
    for (let i = 1; i < bl.length; i++) {
      g.bind(bl[i]);
      p.bloomDown.use().setAll({ uSrc: bl[i - 1].tex, uT: [bl[i - 1].tx, bl[i - 1].ty] });
      g.fullscreen();
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (let i = bl.length - 1; i > 0; i--) {
      g.bind(bl[i - 1]);
      p.bloomUp.use().setAll({ uSrc: bl[i].tex, uT: [bl[i].tx, bl[i].ty], uK: 1 });
      g.fullscreen();
    }
    gl.disable(gl.BLEND);

    // --- final
    const sh = new Float32Array(16);
    this.shocks.forEach((s, i) => {
      const k = s.t / s.dur;
      const uv = [s.x * w2u[0] + w2u[2], s.y * w2u[1] + w2u[3]];
      sh.set([uv[0], uv[1], s.R * k * w2u[1], s.k * (1 - k) * (1 - k)], i * 4);
    });
    g.bind(null, this.rw, this.rh);
    p.final.use().setAll({
      uScene: this.sceneC.tex, uBloom: bl[0].tex, uShock: sh, uRes: [this.rw, this.rh],
      uAspect: this.rw / this.rh, uTime: t, uBloomK: 0.6, uFlash: this.flash, uExposure: 1.0,
    });
    g.fullscreen();
  }

  private causticColor(game: Game): number[] {
    // light passing through the jar picks up the colour of its contents
    let r = 0;
    let gg = 0;
    let b = 0;
    let wsum = 0.0001;
    for (const d of game.drops) {
      const a = INKS[d.ink].absorb;
      const w = d.r * d.r;
      r += Math.exp(-a[0] * 0.6) * w;
      gg += Math.exp(-a[1] * 0.6) * w;
      b += Math.exp(-a[2] * 0.6) * w;
      wsum += w;
    }
    const fill = Math.min(1, wsum / 12);
    const base = [1.0, 0.97, 0.9];
    return [
      (base[0] * (1 - fill) + (r / wsum) * fill) * 0.9,
      (base[1] * (1 - fill) + (gg / wsum) * fill) * 0.9,
      (base[2] * (1 - fill) + (b / wsum) * fill) * 0.9,
    ];
  }
}
