import { Ink, INKS, MAX_TIER, PRIMARIES, react, type Reaction } from './inks';
import { RNG, clamp } from '../core/math';

// ---- World constants (world units, y up; jar interior x∈[0,W], y∈[0,H]) ----
export const JAR_W = 7.5;
export const JAR_H = 11;
export const WATER = 9.5;
export const DANGER = 8.6;
export const CORNER = 1.1;
export const TIP_Y = 11.75; // pipette tip height
export const PIP_LEN = 3.3; // pivot distance above tip (pendulum length)
const BASE_R = [0.36, 0.45, 0.56, 0.7, 0.87, 1.08, 1.34, 1.66];

/**
 * Difficulty knobs — tweak with scripts/sim.ts (headless simulation).
 * tierScale: drop size relative to the jar (bigger = jar fills faster).
 */
export const TUNING = {
  tierScale: 1.4,
  earlyWeights: [60, 40, 0],
  spawnWeights: [40, 35, 25, 0], // spawn tier weights at the start…
  lateWeights: [10, 25, 35, 30], // …ramping linearly to these over rampDrops drops
  rampDrops: 160,
  blastK: 2.4, // explosion radius = r * blastK + blastBase
  blastBase: 0.5,
  dangerTime: 2.8, // seconds above the MAX line before game over
  pearlTier: 4, // two same-colour drops of this tier fuse into a pearl
  tripleSlack: 1.3, // a third same drop this close (× radii) joins the fusion → gold
};

export function spawnWeightsAt(drops: number) {
  const t = Math.min(1, drops / Math.max(1, TUNING.rampDrops));
  const a = TUNING.spawnWeights;
  const b = TUNING.lateWeights;
  const n = Math.max(a.length, b.length);
  const w: number[] = [];
  for (let i = 0; i < n; i++) w.push((a[i] ?? 0) * (1 - t) + (b[i] ?? 0) * t);
  return w;
}

/** Drop radius per tier (mutated in place by setTierScale, shared with the renderer). */
export const TIER_R = BASE_R.map((r) => r * TUNING.tierScale);
export function setTierScale(k: number) {
  TUNING.tierScale = k;
  for (let i = 0; i < BASE_R.length; i++) TIER_R[i] = BASE_R[i] * k;
}
const POINTS = [2, 5, 10, 18, 30, 48, 75, 120];

const G_AIR = 26;
const G_WATER = 5.2;
const DRAG = 2.1;
const STEP = 1 / 120;
const SUB = 3;
const ITERS = 2;

export type Mode = 'classic' | 'murky' | 'attract';

export interface Drop {
  id: number;
  ink: Ink;
  tier: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  px: number;
  py: number;
  r: number;
  rt: number;
  m: number;
  // visual oscillation modes (radial, 2-lobe squash, 3-lobe)
  a0: number;
  a0v: number;
  a2x: number;
  a2y: number;
  a2vx: number;
  a2vy: number;
  a3x: number;
  a3y: number;
  a3vx: number;
  a3vy: number;
  sx: number; // accumulated contact tensor this step
  sy: number;
  lx: number; // filtered load tensor
  ly: number;
  colA: Ink;
  colB: Ink;
  mixT: number;
  seed: number;
  age: number;
  state: 0 | 1 | 2; // live, merging, dissolving
  fuse: number;
  blasted: number;
  inWater: boolean;
  dissolveDelay: number;
  dissolveT: number;
  flash: number;
}

export interface Bubble {
  x: number;
  y: number;
  r: number;
  vx: number;
  vy: number;
  ph: number;
  life: number;
}

export type GameEvent =
  | { t: 'splash'; x: number; y: number; vy: number; r: number; ink: Ink }
  | { t: 'merge'; x: number; y: number; r: number; a: Ink; b: Ink; ink: Ink; tier: number; points: number; combo: number; kind: Reaction['kind'] }
  | { t: 'explode'; x: number; y: number; R: number; tier: number; points: number; combo: number }
  | { t: 'dissolve'; x: number; y: number; r: number; ink: Ink; vx: number; vy: number }
  | { t: 'impact'; x: number; y: number; speed: number; r: number }
  | { t: 'release'; x: number; ink: Ink; tier: number }
  | { t: 'discover'; ink: Ink }
  | { t: 'pop'; x: number; r: number }
  | { t: 'gameover'; score: number }
  | { t: 'hold' };

interface Merge {
  drops: Drop[];
  res: Reaction;
  t: number;
}

export interface Piece {
  ink: Ink;
  tier: number;
}

export class Surface {
  readonly n = 80;
  h = new Float32Array(80);
  v = new Float32Array(80);
  readonly dx = JAR_W / 79;
  step(dt: number) {
    const c2 = 30; // wave speed²
    const { h, v, n, dx } = this;
    for (let i = 0; i < n; i++) {
      const l = h[i > 0 ? i - 1 : 1];
      const r = h[i < n - 1 ? i + 1 : n - 2];
      v[i] += (c2 * (l + r - 2 * h[i]) / (dx * dx) - 3.2 * v[i] - 18 * h[i]) * dt;
    }
    for (let i = 0; i < n; i++) h[i] = clamp(h[i] + v[i] * dt, -0.45, 0.45);
  }
  impulse(x: number, amount: number, width: number) {
    for (let i = 0; i < this.n; i++) {
      const d = (i * this.dx - x) / width;
      this.v[i] += amount * Math.exp(-d * d) * (1 - 0.8 * d * d);
    }
  }
  at(x: number) {
    const f = clamp(x / this.dx, 0, this.n - 1.001);
    const i = Math.floor(f);
    const t = f - i;
    return this.h[i] * (1 - t) + this.h[i + 1] * t;
  }
}

let nextId = 1;

export class Game {
  mode: Mode;
  rng: RNG;
  drops: Drop[] = [];
  bubbles: Bubble[] = [];
  spray: Bubble[] = []; // water droplets thrown above the surface by splashes
  merges: Merge[] = [];
  events: GameEvent[] = [];
  surface = new Surface();

  queue: Piece[] = [];
  current: Piece | null = null;
  hold: Piece | null = null;
  holdUsed = false;
  dropsUsed = 0;

  pip = { x: JAR_W / 2, tx: JAR_W / 2, vx: 0, ang: 0, angV: 0, squeeze: 0, grow: 0, cooldown: 0.4, level: 1 };

  score = 0;
  combo = 0;
  comboT = 0;
  bestCombo = 0;
  danger = 0; // 0..1 time above the line
  dangerNear = 0; // 0..1 proximity of pile to the line
  over = false;
  time = 0;
  acc = 0;
  murk = 0;
  aiT = 1;
  /** false = headless simulation: skip purely visual particles */
  fx = true;
  discovered: Set<Ink>;

  constructor(mode: Mode, seed = (Math.random() * 2 ** 32) >>> 0, discovered: Ink[] = []) {
    this.mode = mode;
    this.rng = new RNG(seed);
    this.discovered = new Set(discovered);
    for (let i = 0; i < 3; i++) this.queue.push(this.gen());
    this.current = this.queue.shift()!;
    this.queue.push(this.gen());
  }

  private gen(): Piece {
    const early = this.dropsUsed < 6;
    return {
      ink: PRIMARIES[this.rng.int(3)],
      tier: this.rng.weighted(early ? TUNING.earlyWeights : spawnWeightsAt(this.dropsUsed)),
    };
  }

  // ---------------------------------------------------------------- input
  aim(x: number) {
    this.pip.tx = clamp(x, 0.35, JAR_W - 0.35);
  }

  tipPos() {
    const p = this.pip;
    return { x: p.x + Math.sin(p.ang) * PIP_LEN, y: TIP_Y - (1 - Math.cos(p.ang)) * PIP_LEN };
  }

  /** Position of the drop hanging on the pipette tip. */
  hangPos() {
    const t = this.tipPos();
    const r = this.current ? TIER_R[this.current.tier] * this.pip.grow : 0;
    return { x: t.x, y: t.y - r * 0.92 - 0.02, r };
  }

  /** Where the drop will actually be released: pulled towards the aim point so a lagging or
   *  swinging pipette doesn't cost accuracy. */
  releaseX() {
    const r = this.current ? TIER_R[this.current.tier] : 0;
    const x = this.hangPos().x * 0.3 + this.pip.tx * 0.7;
    return clamp(x, r + 0.01, JAR_W - r - 0.01);
  }

  canRelease() {
    return !this.over && !!this.current && this.pip.grow > 0.92 && this.pip.cooldown <= 0;
  }

  release() {
    if (!this.canRelease() || !this.current) return false;
    const h = this.hangPos();
    const d = this.makeDrop(this.current.ink, this.current.tier, this.releaseX(), h.y);
    d.vx = clamp(this.pip.vx * 0.03, -0.5, 0.5);
    d.vy = -1.2;
    d.a2x = -0.12; // released drop snaps from elongated
    d.a2vx = 2.5;
    this.drops.push(d);
    this.events.push({ t: 'release', x: d.x, ink: d.ink, tier: d.tier });
    this.pip.squeeze = 1;
    this.pip.cooldown = 0.42;
    this.pip.grow = 0;
    this.current = this.queue.shift()!;
    this.queue.push(this.gen());
    this.holdUsed = false;
    this.dropsUsed++;
    return true;
  }

  swapHold() {
    if (this.over || this.holdUsed || !this.current) return false;
    if (this.hold) {
      const t = this.hold;
      this.hold = this.current;
      this.current = t;
    } else {
      this.hold = this.current;
      this.current = this.queue.shift()!;
      this.queue.push(this.gen());
    }
    this.holdUsed = true;
    this.pip.grow = Math.min(this.pip.grow, 0.25);
    this.events.push({ t: 'hold' });
    return true;
  }

  // ---------------------------------------------------------------- drops
  makeDrop(ink: Ink, tier: number, x: number, y: number): Drop {
    const r = TIER_R[tier];
    return {
      id: nextId++, ink, tier, x, y, vx: 0, vy: 0, px: x, py: y, r, rt: r,
      m: r * r * INKS[ink].mass,
      a0: 0, a0v: 0, a2x: 0, a2y: 0, a2vx: 0, a2vy: 0, a3x: 0, a3y: 0, a3vx: 0, a3vy: 0,
      sx: 0, sy: 0, lx: 0, ly: 0,
      colA: ink, colB: ink, mixT: 1, seed: this.rng.next(), age: 0, state: 0,
      fuse: 0, blasted: 0, inWater: y < WATER, dissolveDelay: 0, dissolveT: 0, flash: 0,
    };
  }

  // ---------------------------------------------------------------- main update
  update(dt: number) {
    this.acc = Math.min(this.acc + dt, 0.1);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.fixed(STEP);
    }
  }

  private fixed(dt: number) {
    this.time += dt;
    this.updatePipette(dt);
    this.physics(dt);
    this.updateMerges(dt);
    this.reactions();
    this.updateDrops(dt);
    this.updateBubbles(dt);
    this.updateSpray(dt);
    this.surface.step(dt);
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) this.combo = 0;
    }
    if (this.mode === 'attract') this.ai(dt);
    else this.checkDanger(dt);
    if (this.mode === 'murky') this.murk = Math.max(0, this.murk - dt * 0.004);
  }

  private updatePipette(dt: number) {
    const p = this.pip;
    // critically damped follow of the pivot
    const w = 20;
    const ax = w * w * (p.tx - p.x) - 2 * w * p.vx;
    p.vx += ax * dt;
    p.x += p.vx * dt;
    // pendulum driven by pivot acceleration
    const g = 30;
    // swing driven by 40% of the pivot acceleration, well damped — enough to feel alive,
    // not enough to throw drops off target
    const angA = (-g * Math.sin(p.ang) - 0.4 * ax * Math.cos(p.ang)) / PIP_LEN - 5 * p.angV;
    p.angV += angA * dt;
    p.ang = clamp(p.ang + p.angV * dt, -0.22, 0.22);
    p.squeeze = Math.max(0, p.squeeze - dt * 4);
    if (p.cooldown > 0) p.cooldown -= dt;
    else if (this.current && !this.over) p.grow = Math.min(1, p.grow + dt * 3.2);
    p.level += ((this.current ? 0.8 - 0.25 * p.grow : 0.3) - p.level) * Math.min(1, dt * 6);
  }

  private physics(dt: number) {
    const h = dt / SUB;
    const ds = this.drops;
    const surf = this.surface;
    for (const d of ds) {
      d.sx = 0;
      d.sy = 0;
    }
    for (let s = 0; s < SUB; s++) {
      for (const d of ds) {
        d.px = d.x;
        d.py = d.y;
        if (d.state === 1) continue;
        const wl = WATER + surf.at(d.x);
        const wasIn = d.inWater;
        d.inWater = d.y - d.r * 0.3 < wl;
        if (d.inWater) {
          d.vy -= G_WATER * INKS[d.ink].sink * h;
          const k = Math.exp(-DRAG * h);
          d.vx *= k;
          d.vy *= k;
          if (!wasIn && d.vy < -1) this.splash(d);
        } else {
          d.vy -= G_AIR * h;
        }
        d.x += d.vx * h;
        d.y += d.vy * h;
      }
      for (let it = 0; it < ITERS; it++) {
        const first = s === 0 && it === 0;
        for (let i = 0; i < ds.length; i++) {
          const a = ds[i];
          for (let j = i + 1; j < ds.length; j++) {
            const b = ds[j];
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            const rs = a.r + b.r;
            const d2 = dx * dx + dy * dy;
            if (d2 >= rs * rs || d2 < 1e-10) continue;
            if (a.state === 1 && b.state === 1) continue;
            const dist = Math.sqrt(d2);
            const nx = dx / dist;
            const ny = dy / dist;
            const pen = rs - dist;
            const wa = a.state === 1 ? 0 : 1 / a.m;
            const wb = b.state === 1 ? 0 : 1 / b.m;
            if (wa + wb === 0) continue;
            const k = pen / (wa + wb);
            a.x -= nx * k * wa;
            a.y -= ny * k * wa;
            b.x += nx * k * wb;
            b.y += ny * k * wb;
            const c2 = nx * nx - ny * ny;
            const s2 = 2 * nx * ny;
            a.sx += k * wa * c2;
            a.sy += k * wa * s2;
            b.sx += k * wb * c2;
            b.sy += k * wb * s2;
            if (first) {
              const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
              if (vn < -1.2) this.impact(a, b, nx, ny, -vn);
            }
          }
        }
        for (const d of ds) if (d.state !== 1) this.walls(d, first);
      }
      for (const d of ds) {
        if (d.state === 1) continue;
        d.vx = (d.x - d.px) / h;
        d.vy = (d.y - d.py) / h;
      }
      // friction-ish damping for contacts
      for (let i = 0; i < ds.length; i++) {
        const a = ds[i];
        for (let j = i + 1; j < ds.length; j++) {
          const b = ds[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const rs = a.r + b.r + 0.01;
          const d2 = dx * dx + dy * dy;
          if (d2 >= rs * rs || d2 < 1e-10) continue;
          const dist = Math.sqrt(d2);
          const tx = -dy / dist;
          const ty = dx / dist;
          const vt = (b.vx - a.vx) * tx + (b.vy - a.vy) * ty;
          const wa = a.state === 1 ? 0 : 1 / a.m;
          const wb = b.state === 1 ? 0 : 1 / b.m;
          if (wa + wb === 0) continue;
          const jt = (vt * 0.06) / (wa + wb);
          a.vx += tx * jt * wa;
          a.vy += ty * jt * wa;
          b.vx -= tx * jt * wb;
          b.vy -= ty * jt * wb;
        }
      }
    }
    // turn accumulated contact corrections into a smoothed squash target
    const norm = 1 / (SUB * G_WATER * h * h);
    for (const d of ds) {
      const sx = d.sx * norm * 0.02;
      const sy = d.sy * norm * 0.02;
      d.lx += (sx - d.lx) * 0.15;
      d.ly += (sy - d.ly) * 0.15;
    }
  }

  private walls(d: Drop, first: boolean) {
    const r = d.r;
    let nx = 0;
    let ny = 0;
    let pen = 0;
    if (r < CORNER && d.y < CORNER && (d.x < CORNER || d.x > JAR_W - CORNER)) {
      const cx = d.x < CORNER ? CORNER : JAR_W - CORNER;
      const cy = CORNER;
      const dx = d.x - cx;
      const dy = d.y - cy;
      const dd = Math.hypot(dx, dy);
      const lim = CORNER - r;
      if (dd > lim) {
        const ux = dx / dd;
        const uy = dy / dd;
        pen = dd - lim;
        d.x = cx + ux * lim;
        d.y = cy + uy * lim;
        nx = -ux;
        ny = -uy;
      }
    } else {
      if (d.x < r) {
        pen = r - d.x;
        d.x = r;
        nx = 1;
      } else if (d.x > JAR_W - r) {
        pen = d.x - (JAR_W - r);
        d.x = JAR_W - r;
        nx = -1;
      }
      if (d.y < r) {
        pen = Math.max(pen, r - d.y);
        d.y = r;
        ny = 1;
      }
    }
    if (pen > 0) {
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const k = pen * 0.5;
      d.sx -= k * (nx * nx - ny * ny) * -1;
      d.sy -= k * (2 * nx * ny) * -1;
      if (first) {
        const vn = -(d.vx * nx + d.vy * ny);
        if (vn > 1.4) this.impactWall(d, nx, ny, vn);
      }
    }
  }

  private impact(a: Drop, b: Drop, nx: number, ny: number, speed: number) {
    const c2 = nx * nx - ny * ny;
    const s2 = 2 * nx * ny;
    const k = Math.min(speed, 8) * 0.22;
    a.a2vx -= c2 * k / Math.sqrt(a.r);
    a.a2vy -= s2 * k / Math.sqrt(a.r);
    b.a2vx -= c2 * k / Math.sqrt(b.r);
    b.a2vy -= s2 * k / Math.sqrt(b.r);
    const c3 = Math.cos(3 * Math.atan2(ny, nx));
    const s3 = Math.sin(3 * Math.atan2(ny, nx));
    a.a3vx += c3 * k * 0.4;
    a.a3vy += s3 * k * 0.4;
    b.a3vx -= c3 * k * 0.4;
    b.a3vy -= s3 * k * 0.4;
    if (speed > 2.2) this.events.push({ t: 'impact', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, speed, r: Math.max(a.r, b.r) });
  }

  private impactWall(d: Drop, nx: number, ny: number, speed: number) {
    const k = Math.min(speed, 8) * 0.25 / Math.sqrt(d.r);
    d.a2vx -= (nx * nx - ny * ny) * k;
    d.a2vy -= 2 * nx * ny * k;
    if (speed > 2.2) this.events.push({ t: 'impact', x: d.x, y: d.y - d.r, speed, r: d.r });
  }

  private splash(d: Drop) {
    const sp = -d.vy;
    this.surface.impulse(d.x, -sp * d.r * 0.55, 0.35 + d.r * 0.6);
    d.vy *= 0.42;
    d.a2vy += 0;
    d.a2vx += sp * 0.12; // flatten on entry
    const n = this.fx ? 3 + Math.floor(d.r * 10) : 0;
    for (let i = 0; i < n; i++) {
      this.bubbles.push({
        x: d.x + (this.rng.next() - 0.5) * d.r * 1.6,
        y: WATER - this.rng.next() * d.r * 1.2 - 0.1,
        r: 0.025 + this.rng.next() ** 2 * 0.09,
        vx: (this.rng.next() - 0.5) * 1.2,
        vy: -this.rng.next() * 1.5,
        ph: this.rng.next() * 6.28,
        life: 0,
      });
    }
    const ns = this.fx ? Math.min(14, Math.floor(sp * d.r * 2.2)) : 0;
    for (let i = 0; i < ns; i++) {
      const side = this.rng.next() < 0.5 ? -1 : 1;
      this.spray.push({
        x: d.x + side * d.r * (0.5 + this.rng.next() * 0.6),
        y: WATER + 0.02,
        r: 0.025 + this.rng.next() ** 2 * 0.06,
        vx: side * (0.6 + this.rng.next() * 2.2),
        vy: 2 + this.rng.next() * sp * 0.45,
        ph: 0,
        life: 0,
      });
    }
    this.events.push({ t: 'splash', x: d.x, y: WATER, vy: sp, r: d.r, ink: d.ink });
  }

  // ---------------------------------------------------------------- reactions
  private touching(a: Drop, b: Drop, slack = 1.045) {
    const rs = (a.r + b.r) * slack;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return dx * dx + dy * dy < rs * rs;
  }

  private reactions() {
    if (this.over) return;
    const ds = this.drops;
    for (let i = 0; i < ds.length; i++) {
      const a = ds[i];
      if (a.state !== 0 || a.age < 0.05) continue;
      for (let j = i + 1; j < ds.length; j++) {
        const b = ds[j];
        if (b.state !== 0 || b.age < 0.05) continue;
        if (!this.touching(a, b)) continue;
        // pearl dissolves mud of any size
        if ((a.ink === Ink.PEARL && b.ink === Ink.M) || (b.ink === Ink.PEARL && a.ink === Ink.M)) {
          const pearl = a.ink === Ink.PEARL ? a : b;
          const mud = pearl === a ? b : a;
          this.beginDissolve(mud, 0);
          this.addScore(POINTS[mud.tier] * 2, mud.x, mud.y);
          if (pearl.tier === 0) this.beginDissolve(pearl, 0.1);
          else {
            pearl.tier--;
            pearl.rt = TIER_R[pearl.tier];
            pearl.m = pearl.rt * pearl.rt * INKS[pearl.ink].mass;
            pearl.a0v -= 2;
          }
          continue;
        }
        if (a.tier !== b.tier) continue;
        let res = react(a.ink, b.ink, a.tier, TUNING.pearlTier);
        if (!res) continue;
        const group = [a, b];
        if (a.ink === b.ink && res.kind === 'grow' && a.ink !== Ink.K && a.ink !== Ink.M && a.ink !== Ink.GOLD) {
          for (const c of ds) {
            if (c === a || c === b || c.state !== 0 || c.ink !== a.ink || c.tier !== a.tier) continue;
            if (this.touching(c, a, TUNING.tripleSlack) || this.touching(c, b, TUNING.tripleSlack)) {
              group.push(c);
              res = { ink: Ink.GOLD, tier: Math.min(a.tier + 1, MAX_TIER), scoreMul: 4, kind: 'gold' };
              break;
            }
          }
        }
        if (a.blasted > 0 && b.blasted > 0 && res.kind !== 'black' && res.kind !== 'mud' && group.length === 2) {
          res = { ink: Ink.OPAL, tier: res.tier, scoreMul: 3, kind: 'opal' };
        }
        for (const g of group) g.state = 1;
        this.merges.push({ drops: group, res, t: 0 });
        break;
      }
    }
  }

  private updateMerges(dt: number) {
    const DUR = 0.1;
    for (let mi = this.merges.length - 1; mi >= 0; mi--) {
      const mg = this.merges[mi];
      mg.t += dt;
      let cx = 0;
      let cy = 0;
      let mt = 0;
      for (const d of mg.drops) {
        cx += d.x * d.m;
        cy += d.y * d.m;
        mt += d.m;
      }
      cx /= mt;
      cy /= mt;
      const pull = Math.min(1, dt * 22);
      for (const d of mg.drops) {
        d.x += (cx - d.x) * pull;
        d.y += (cy - d.y) * pull;
      }
      if (mg.t < DUR) continue;
      this.merges.splice(mi, 1);
      let vx = 0;
      let vy = 0;
      let blasted = 0;
      for (const d of mg.drops) {
        vx += d.vx * d.m;
        vy += d.vy * d.m;
        blasted = Math.max(blasted, d.blasted);
        const k = this.drops.indexOf(d);
        if (k >= 0) this.drops.splice(k, 1);
      }
      vx /= mt;
      vy /= mt;
      const [p0, p1] = mg.drops;
      const res = mg.res;
      const nd = this.makeDrop(res.ink, res.tier, cx, cy);
      nd.r = Math.max(p0.r, p1.r) * 1.05;
      nd.vx = vx;
      nd.vy = vy + 0.6;
      nd.blasted = blasted * 0.5;
      nd.colA = p0.ink;
      nd.colB = p1.ink;
      nd.mixT = p0.ink === p1.ink && p0.ink === res.ink ? 1 : 0;
      nd.flash = 1;
      nd.age = 0.05;
      const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      nd.a2x = Math.cos(2 * ang) * 0.22;
      nd.a2y = Math.sin(2 * ang) * 0.22;
      nd.a0 = -0.08;
      nd.a0v = 3.5;
      if (res.ink === Ink.K) nd.fuse = p0.ink === Ink.K ? 1.1 : 1.6;
      this.drops.push(nd);
      if (this.comboT > 0) this.combo++;
      else this.combo = 1;
      this.comboT = 1.7;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      const points = Math.round(POINTS[res.tier] * res.scoreMul * this.combo);
      if (this.mode !== 'attract') this.score += points;
      if (this.mode === 'murky') this.murk = Math.min(1, this.murk + 0.03 + res.tier * 0.01);
      this.events.push({ t: 'merge', x: cx, y: cy, r: nd.rt, a: p0.ink, b: p1.ink, ink: res.ink, tier: res.tier, points, combo: this.combo, kind: res.kind });
      const nb = 2 + res.tier * 2;
      for (let i = 0; i < nb; i++) this.spawnBubble(cx + (this.rng.next() - 0.5) * nd.rt, cy + (this.rng.next() - 0.5) * nd.rt, 0.02 + this.rng.next() * 0.05);
      if (!this.discovered.has(res.ink)) {
        this.discovered.add(res.ink);
        if (this.mode !== 'attract') this.events.push({ t: 'discover', ink: res.ink });
      }
    }
  }

  private addScore(p: number, _x: number, _y: number) {
    if (this.mode !== 'attract') this.score += Math.round(p);
  }

  private beginDissolve(d: Drop, delay: number) {
    if (d.state === 2) return;
    d.state = 2;
    d.dissolveDelay = delay;
    d.dissolveT = 0;
  }

  private explode(d: Drop) {
    const R = d.rt * TUNING.blastK + TUNING.blastBase;
    this.beginDissolve(d, 0);
    d.dissolveT = 1; // remove immediately
    if (this.comboT > 0) this.combo++;
    else this.combo = 1;
    this.comboT = 2;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    let points = POINTS[d.tier] * 3;
    for (const o of this.drops) {
      if (o === d || o.state === 2) continue;
      const dx = o.x - d.x;
      const dy = o.y - d.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      if (dist - o.r * 0.6 < R) {
        if (o.state === 1) continue;
        this.beginDissolve(o, dist / 15);
        points += POINTS[o.tier] * 1.5;
      } else if (dist < R * 2) {
        const f = (1 - (dist - R) / R) * 11;
        o.vx += (dx / dist) * f / Math.sqrt(o.m * 4 + 0.2);
        o.vy += (dy / dist) * f / Math.sqrt(o.m * 4 + 0.2);
        o.blasted = 0.9;
        o.a2vx += (dx / dist) * 2;
        o.a0v -= 3;
      }
    }
    points = Math.round(points * this.combo);
    if (this.mode !== 'attract') this.score += points;
    this.murk = Math.max(0, this.murk - 0.25 - d.tier * 0.04);
    this.surface.impulse(d.x, 3 + R, 2);
    for (let i = 0; i < 18 + d.tier * 8; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const rr = this.rng.next() * R * 0.8;
      this.spawnBubble(d.x + Math.cos(a) * rr, d.y + Math.sin(a) * rr, 0.02 + this.rng.next() ** 2 * 0.12, Math.cos(a) * 3, Math.sin(a) * 3);
    }
    this.events.push({ t: 'explode', x: d.x, y: d.y, R, tier: d.tier, points, combo: this.combo });
  }

  private updateDrops(dt: number) {
    const ds = this.drops;
    for (let i = ds.length - 1; i >= 0; i--) {
      const d = ds[i];
      d.age += dt;
      d.flash = Math.max(0, d.flash - dt * 2.5);
      if (d.blasted > 0) d.blasted -= dt;
      if (d.mixT < 1) d.mixT = Math.min(1, d.mixT + dt * 0.8);
      d.r += (d.rt - d.r) * Math.min(1, dt * 16);
      // oscillators
      const w = 19 / Math.sqrt(d.r / 0.5);
      const z = 0.17;
      const sp = Math.hypot(d.vx, d.vy);
      let tx = clamp(-d.lx, -0.16, 0.16);
      let ty = clamp(-d.ly, -0.16, 0.16);
      if (sp > 0.5) {
        const k = Math.min(sp * 0.012, 0.09);
        const c2 = (d.vx * d.vx - d.vy * d.vy) / (sp * sp);
        const s2 = (2 * d.vx * d.vy) / (sp * sp);
        tx += c2 * k;
        ty += s2 * k;
      }
      d.a0v += (-w * w * d.a0 - 2 * z * w * d.a0v) * dt;
      d.a0 += d.a0v * dt;
      d.a2vx += (-w * w * (d.a2x - tx) - 2 * z * w * d.a2vx) * dt;
      d.a2vy += (-w * w * (d.a2y - ty) - 2 * z * w * d.a2vy) * dt;
      d.a2x = clamp(d.a2x + d.a2vx * dt, -0.35, 0.35);
      d.a2y = clamp(d.a2y + d.a2vy * dt, -0.35, 0.35);
      const w3 = w * 1.75;
      d.a3vx += (-w3 * w3 * d.a3x - 2 * z * w3 * d.a3vx) * dt;
      d.a3vy += (-w3 * w3 * d.a3y - 2 * z * w3 * d.a3vy) * dt;
      d.a3x = clamp(d.a3x + d.a3vx * dt, -0.2, 0.2);
      d.a3y = clamp(d.a3y + d.a3vy * dt, -0.2, 0.2);

      if (d.ink === Ink.K && d.state === 0) {
        d.fuse -= dt;
        // boiling: jitter and bubbles as the fuse burns
        const heat = 1 - clamp(d.fuse / 1.6, 0, 1);
        d.a3vx += (this.rng.next() - 0.5) * heat * 6;
        d.a3vy += (this.rng.next() - 0.5) * heat * 6;
        d.a0v += (this.rng.next() - 0.5) * heat * 4;
        if (this.rng.next() < heat * 0.5) {
          const a = this.rng.next() * 6.28;
          this.spawnBubble(d.x + Math.cos(a) * d.r, d.y + Math.sin(a) * d.r, 0.015 + this.rng.next() * 0.03);
        }
        if (d.fuse <= 0) this.explode(d);
      }
      if (d.state === 2) {
        if (d.dissolveDelay > 0) {
          d.dissolveDelay -= dt;
          if (d.dissolveDelay <= 0 && d.ink === Ink.K && d.dissolveT < 1) {
            d.state = 0;
            d.fuse = 0.001; // chain explosion next step
          }
          continue;
        }
        d.dissolveT += dt / 0.2;
        d.flash = Math.max(d.flash, 1 - d.dissolveT);
        d.a0 += dt * 1.5;
        if (d.dissolveT >= 1) {
          ds.splice(i, 1);
          this.events.push({ t: 'dissolve', x: d.x, y: d.y, r: d.rt, ink: d.ink, vx: d.vx, vy: d.vy });
          for (let b = 0; b < 3 + d.tier; b++) this.spawnBubble(d.x + (this.rng.next() - 0.5) * d.r, d.y + (this.rng.next() - 0.5) * d.r, 0.02 + this.rng.next() * 0.05);
        }
      }
    }
  }

  spawnBubble(x: number, y: number, r: number, vx = 0, vy = 0) {
    if (!this.fx || this.bubbles.length > 220 || y > WATER - 0.05) return;
    this.bubbles.push({ x, y, r, vx, vy, ph: this.rng.next() * 6.28, life: 0 });
  }

  private updateSpray(dt: number) {
    const sp = this.spray;
    for (let i = sp.length - 1; i >= 0; i--) {
      const s = sp[i];
      s.life += dt;
      s.vy -= G_AIR * 0.8 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.x < s.r || s.x > JAR_W - s.r) s.vx *= -0.5;
      s.x = clamp(s.x, s.r, JAR_W - s.r);
      if (s.vy < 0 && s.y < WATER + this.surface.at(s.x)) {
        this.surface.impulse(s.x, -s.r * 6, 0.12);
        sp.splice(i, 1);
      }
    }
  }

  private updateBubbles(dt: number) {
    const bs = this.bubbles;
    for (let i = bs.length - 1; i >= 0; i--) {
      const b = bs[i];
      b.life += dt;
      const term = 0.8 + Math.sqrt(b.r) * 5;
      b.vy += (term - b.vy) * Math.min(1, dt * 3);
      b.vx *= Math.exp(-dt * 3);
      b.ph += dt * (8 + 20 * (0.1 - b.r));
      b.x += (b.vx + Math.sin(b.ph) * 0.35 * Math.min(1, b.r * 12)) * dt;
      b.y += b.vy * dt;
      for (const d of this.drops) {
        const dx = b.x - d.x;
        const dy = b.y - d.y;
        const rr = d.r + b.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 1e-8) {
          const dist = Math.sqrt(d2);
          b.x = d.x + (dx / dist) * rr;
          b.y = d.y + (dy / dist) * rr;
          // slide along the drop
          b.vx += (dx / dist) * 0.5;
        }
      }
      b.x = clamp(b.x, b.r, JAR_W - b.r);
      if (b.y > WATER + this.surface.at(b.x) - b.r * 0.5 || b.life > 12) {
        if (b.life <= 12) {
          this.surface.impulse(b.x, b.r * 3, 0.15);
          if (b.r > 0.05) this.events.push({ t: 'pop', x: b.x, r: b.r });
        }
        bs.splice(i, 1);
      }
    }
  }

  pileTop() {
    let top = 0;
    for (const d of this.drops) {
      if (d.state === 0 && d.age > 0.9 && d.inWater && Math.abs(d.vy) < 0.6) top = Math.max(top, d.y + d.r);
    }
    return top;
  }

  private checkDanger(dt: number) {
    if (this.over) return;
    let above = false;
    let near = 0;
    for (const d of this.drops) {
      if (d.state !== 0 || d.age < 1.2) continue;
      const top = d.y + d.r;
      near = Math.max(near, clamp((top - (DANGER - 1.6)) / 1.6, 0, 1));
      if (top > DANGER && Math.hypot(d.vx, d.vy) < 2.5) above = true;
    }
    this.dangerNear = near;
    if (above) this.danger += dt / TUNING.dangerTime;
    else this.danger = Math.max(0, this.danger - dt / 1.2);
    if (this.danger >= 1) this.gameOver();
  }

  gameOver() {
    this.over = true;
    this.current = null;
    let top = 0;
    for (const d of this.drops) top = Math.max(top, d.y);
    for (const d of this.drops) {
      if (d.ink === Ink.K) d.ink = Ink.M;
      this.beginDissolve(d, 0.5 + (top - d.y) * 0.09);
    }
    this.events.push({ t: 'gameover', score: this.score });
  }

  /** Clear the jar with a staggered dissolve (menu transitions). */
  clearAll() {
    let i = 0;
    for (const d of this.drops) {
      if (d.ink === Ink.K) d.ink = Ink.P;
      this.beginDissolve(d, 0.05 + (i++ % 12) * 0.03);
    }
    this.current = null;
    this.over = true;
  }

  // ---------------------------------------------------------------- attract-mode AI
  private ai(dt: number) {
    this.aiT -= dt;
    if (this.over) return;
    if (this.aiT <= 0 && this.current) {
      // aim above a drop the current piece reacts with, else random
      const cur = this.current;
      let best: Drop | null = null;
      let bestY = -1;
      for (const d of this.drops) {
        if (d.state !== 0 || d.tier !== cur.tier) continue;
        if (!react(d.ink, cur.ink, cur.tier)) continue;
        if (d.y > bestY) {
          bestY = d.y;
          best = d;
        }
      }
      const x = best && this.rng.next() < 0.8 ? best.x + (this.rng.next() - 0.5) * 0.3 : 0.8 + this.rng.next() * (JAR_W - 1.6);
      this.aim(x);
      if (Math.abs(this.pip.x - this.pip.tx) < 0.15 && this.canRelease()) {
        this.release();
        this.aiT = 1.0 + this.rng.next() * 1.2;
      }
    }
    if (this.drops.length > 10 && this.pileTop() > 6.8) {
      // keep the demo alive: detonate the highest drop
      let hi: Drop | null = null;
      for (const d of this.drops) if (d.state === 0 && d.ink !== Ink.K && (!hi || d.y > hi.y)) hi = d;
      if (hi) {
        hi.ink = Ink.K;
        hi.colA = hi.colB = Ink.K;
        hi.fuse = 1.2;
        hi.flash = 1;
      }
    }
  }

  /** Deep copy of the simulation state (for look-ahead AI); visual particles are dropped. */
  clone(): Game {
    const g = new Game(this.mode, 1, [...this.discovered]);
    g.fx = false;
    g.rng.s = this.rng.s;
    g.drops = this.drops.map((d) => ({ ...d }));
    const map = new Map(this.drops.map((d, i) => [d, g.drops[i]]));
    g.merges = this.merges.map((m) => ({ drops: m.drops.map((d) => map.get(d)!), res: m.res, t: m.t }));
    g.queue = this.queue.map((p) => ({ ...p }));
    g.current = this.current && { ...this.current };
    g.hold = this.hold && { ...this.hold };
    g.holdUsed = this.holdUsed;
    g.dropsUsed = this.dropsUsed;
    g.pip = { ...this.pip };
    g.score = this.score;
    g.combo = this.combo;
    g.comboT = this.comboT;
    g.bestCombo = this.bestCombo;
    g.danger = this.danger;
    g.time = this.time;
    g.acc = this.acc;
    g.murk = this.murk;
    g.over = this.over;
    g.surface.h.set(this.surface.h);
    g.surface.v.set(this.surface.v);
    return g;
  }

  // ---------------------------------------------------------------- persistence
  serialize() {
    return {
      v: 1,
      mode: this.mode,
      score: this.score,
      rng: this.rng.s,
      queue: this.queue,
      current: this.current,
      hold: this.hold,
      dropsUsed: this.dropsUsed,
      murk: this.murk,
      drops: this.drops.filter((d) => d.state === 0).map((d) => ({ i: d.ink, t: d.tier, x: +d.x.toFixed(3), y: +d.y.toFixed(3), f: d.fuse })),
    };
  }

  static restore(data: ReturnType<Game['serialize']>, discovered: Ink[]): Game {
    const g = new Game(data.mode, 1, discovered);
    g.rng.s = data.rng;
    g.score = data.score;
    g.queue = data.queue;
    g.current = data.current;
    g.hold = data.hold;
    g.dropsUsed = data.dropsUsed;
    g.murk = data.murk ?? 0;
    for (const s of data.drops) {
      const d = g.makeDrop(s.i, s.t, s.x, s.y);
      d.fuse = s.f;
      d.age = 2;
      g.drops.push(d);
    }
    return g;
  }
}
