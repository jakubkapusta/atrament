import { DANGER, Game, JAR_W, TIER_R, TUNING, type Drop, type Piece } from './game';
import { Ink, react } from './inks';

// Simple players for the headless simulation (scripts/sim.ts).

export interface Choice {
  x: number;
  hold: boolean;
}

export interface Brain {
  name: string;
  choose(g: Game): Choice;
}

/** Where a piece dropped straight down at x first touches the pile. */
function landing(g: Game, x: number, r: number) {
  let hit: Drop | null = null;
  let y = r; // floor
  for (const d of g.drops) {
    if (d.state !== 0) continue;
    const dx = Math.abs(d.x - x);
    const rs = r + d.r;
    if (dx >= rs) continue;
    const yc = d.y + Math.sqrt(rs * rs - dx * dx);
    if (yc > y) {
      y = yc;
      hit = d;
    }
  }
  return { hit, y };
}

function evalPlacement(g: Game, p: Piece, x: number) {
  const r = TIER_R[p.tier];
  const { hit, y } = landing(g, x, r);
  let s = -y * 1.6;
  const consider = (d: Drop, w: number) => {
    if (d.tier !== p.tier) return 0;
    const res = react(d.ink, p.ink, p.tier, TUNING.pearlTier);
    if (!res) return 0;
    let v = 16 + res.tier * 3;
    if (res.kind === 'black') v += 10 + (g.pileTop() / DANGER) * 30;
    if (res.kind === 'mud') v -= 40;
    return v * w;
  };
  if (hit) {
    const v = consider(hit, 1);
    s += v;
    if (v === 0) s -= 3 + (y / DANGER) * 14;
  }
  // neighbours it will likely roll against
  for (const d of g.drops) {
    if (d === hit || d.state !== 0) continue;
    const dist = Math.hypot(d.x - x, d.y - y);
    if (dist < r + d.r + 0.25) s += consider(d, 0.45);
  }
  return s;
}

function bestX(g: Game, p: Piece, samples = 25) {
  const r = TIER_R[p.tier];
  let best = { x: JAR_W / 2, s: -Infinity };
  for (let i = 0; i < samples; i++) {
    const x = r + ((JAR_W - 2 * r) * i) / (samples - 1);
    const s = evalPlacement(g, p, x);
    if (s > best.s) best = { x, s };
  }
  return best;
}

export const randomBrain = (seed = 1): Brain => {
  let s = seed;
  return {
    name: 'random',
    choose: (g) => {
      s = (s * 16807) % 2147483647;
      const r = g.current ? TIER_R[g.current.tier] : 0.4;
      return { x: r + (s / 2147483647) * (JAR_W - 2 * r), hold: false };
    },
  };
};

export const greedyBrain = (): Brain => ({
  name: 'greedy',
  choose: (g) => {
    const cur = bestX(g, g.current!);
    if (!g.holdUsed) {
      const alt = g.hold ?? g.queue[0];
      if (alt && bestX(g, alt).s > cur.s + 10) return { x: cur.x, hold: true };
    }
    return { x: cur.x, hold: false };
  },
});

/** Greedy shortlist + physics rollouts of each candidate. Slow but plays well. */
export const lookaheadBrain = (candidates = 5, horizon = 2.2): Brain => ({
  name: 'lookahead',
  choose: (g) => {
    const p = g.current!;
    const r = TIER_R[p.tier];
    const scored: { x: number; s: number }[] = [];
    for (let i = 0; i < 25; i++) {
      const x = r + ((JAR_W - 2 * r) * i) / 24;
      scored.push({ x, s: evalPlacement(g, p, x) });
    }
    scored.sort((a, b) => b.s - a.s);
    let best = { x: scored[0].x, v: -Infinity };
    for (const c of scored.slice(0, candidates)) {
      const sim = g.clone();
      placeAndRelease(sim, c.x);
      for (let t = 0; t < horizon; t += 1 / 60) sim.update(1 / 60);
      const mud = sim.drops.filter((d) => d.ink === Ink.M).length;
      const v = sim.score - g.score - sim.pileTop() * 12 - sim.danger * 150 - mud * 8 + c.s * 0.3;
      if (v > best.v) best = { x: c.x, v };
    }
    const alt = g.hold ?? g.queue[0];
    if (!g.holdUsed && alt && bestX(g, alt).s > scored[0].s + 14) return { x: best.x, hold: true };
    return { x: best.x, hold: false };
  },
});

/** Teleport the pipette (the sim skips the aiming animation) and drop. */
export function placeAndRelease(g: Game, x: number) {
  g.pip.x = g.pip.tx = x;
  g.pip.vx = 0;
  g.pip.ang = 0;
  g.pip.angV = 0;
  g.pip.grow = 1;
  g.pip.cooldown = 0;
  return g.release();
}
