// Beam-search solver for orders on the real physics.
//   npm run solve -- --level czysta [--beam 6] [--cands 15] [--random 200]
//   npm run solve -- --section wprawa        (all orders of a section; default: mistrz)
// After every drop it waits until the jar is calm (like a careful player), scores the goal
// progress and keeps the best branches. Prints a solution (x per drop) for Level.solution.

import { Game } from '../src/game/game';
import { LEVELS, OrderTracker, calm, orderGame, type Level } from '../src/game/orders';
import { TIER_R, JAR_W } from '../src/game/game';
import { placeAndRelease } from '../src/game/ai';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};

/** Run until calm and ready for the next drop. Returns false if the order failed. */
export function settle(g: Game, t: OrderTracker, maxT = 8) {
  for (let s = 0; s < maxT; s += 1 / 60) {
    g.update(1 / 60);
    for (const e of g.events) t.onEvent(e);
    g.events.length = 0;
    if (t.failed) return false;
    if (t.progress(g).done) return true;
    if (g.over) return false;
    if (s > 0.4 && calm(g) && (g.canRelease() || !g.current)) return true;
  }
  return !g.over && !t.failed;
}

function candidates(g: Game, n: number) {
  const r = g.current ? TIER_R[g.current.tier] : 0.5;
  const xs: number[] = [];
  for (let i = 0; i < n; i++) xs.push(+(r + ((JAR_W - 2 * r) * i) / (n - 1)).toFixed(3));
  return xs;
}

interface Node {
  g: Game;
  t: OrderTracker;
  path: number[];
  v: number;
}

export function solve(level: Level, beam = 6, cands = 15) {
  const g0 = orderGame(level);
  g0.fx = false;
  const t0 = new OrderTracker(level);
  settle(g0, t0);
  let front: Node[] = [{ g: g0, t: t0, path: [], v: 0 }];
  for (let m = 0; m < level.moves; m++) {
    const kids: Node[] = [];
    for (const node of front) {
      if (!node.g.current) continue;
      for (const x of candidates(node.g, cands)) {
        const g = node.g.clone();
        const t = node.t.clone();
        placeAndRelease(g, x);
        const ok = settle(g, t);
        const path = [...node.path, x];
        if (t.progress(g).done && !t.failed) return path;
        if (!ok) continue;
        const v = t.value(g) * 100 + g.score * 0.002 - g.pileTop() * 1.5 - g.danger * 40 + Math.random() * 0.05;
        kids.push({ g, t, path, v });
      }
    }
    if (!kids.length) return null;
    kids.sort((a, b) => b.v - a.v);
    // keep diversity: at most 2 children per parent path prefix
    const seen = new Map<string, number>();
    front = [];
    for (const k of kids) {
      const key = k.path.slice(0, -1).join(',');
      const c = seen.get(key) ?? 0;
      if (c >= 2) continue;
      seen.set(key, c + 1);
      front.push(k);
      if (front.length >= beam) break;
    }
  }
  return null;
}

/** A careful random player: waits for calm, then drops at a random x. */
export function randomRate(level: Level, tries: number) {
  let ok = 0;
  let found: number[] | null = null;
  for (let i = 0; i < tries; i++) {
    let s = i * 7919 + 13;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    const g = orderGame(level);
    g.fx = false;
    const t = new OrderTracker(level);
    settle(g, t);
    const path: number[] = [];
    while (g.current && !g.over && !t.failed) {
      const r = TIER_R[g.current.tier];
      const x = +(r + rnd() * (JAR_W - 2 * r)).toFixed(3);
      path.push(x);
      placeAndRelease(g, x);
      if (!settle(g, t)) break;
      if (t.progress(g).done) break;
    }
    // let the last drop finish
    if (!t.failed && !t.progress(g).done) settle(g, t, 10);
    if (t.progress(g).done && !t.failed) {
      ok++;
      if (!found || path.length < found.length) found = path;
    }
  }
  return { rate: ok / tries, path: found as number[] | null };
}

if (process.argv[1]?.endsWith('orders-solve.ts')) {
  const only = arg('--level', '');
  const sectionArg = arg('--section', 'mistrz');
  const beam = +arg('--beam', '6');
  const cands = +arg('--cands', '15');
  const rtries = +arg('--random', '150');
  for (const level of LEVELS) {
    if (only ? level.id !== only : level.section !== sectionArg) continue;
    const t0 = performance.now();
    const beamSol = solve(level, beam, cands);
    const rr = randomRate(level, rtries);
    const sol = beamSol && (!rr.path || beamSol.length <= rr.path.length) ? beamSol : rr.path;
    const src = sol === beamSol ? 'beam' : 'losowa';
    const dt = ((performance.now() - t0) / 1000).toFixed(0);
    console.log(
      `${level.id.padEnd(10)} ${sol ? `ROZWIĄZANE (${src}) w ${sol.length}/${level.moves}: [${sol.map((x) => x.toFixed(3)).join(', ')}]` : 'BRAK ROZWIĄZANIA'}` +
        `  | losowo ${(rr.rate * 100).toFixed(1)}%  [${dt}s]`,
    );
  }
}
