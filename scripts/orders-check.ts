// Verifies that every order (puzzle) is solvable within its move limit.
//   npm run orders -- [--tries 300] [--level pryzmat]
// Random-position attempts approximate "a player who tries things"; greedy is a sanity check.

import { Game } from '../src/game/game';
import { LEVELS, OrderTracker, setupFor, type Level } from '../src/game/orders';
import { greedyBrain, placeAndRelease, randomBrain, type Brain } from '../src/game/ai';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const tries = +arg('--tries', '300');
const only = arg('--level', '');

function attempt(level: Level, brain: Brain, seed: number) {
  const g = new Game(level.murky ? 'order' : 'order', {
    seed,
    pieceSeed: level.seed ?? seed,
    dropLimit: level.moves,
    queue: level.queue,
    setup: setupFor(level),
    liquid: level.liquid,
    murky: level.murky,
  });
  g.fx = false;
  const tr = new OrderTracker(level);
  let wait = 0.6;
  for (let t = 0; t < 400; t += 1 / 60) {
    g.update(1 / 60);
    for (const e of g.events) tr.onEvent(e);
    g.events.length = 0;
    if (tr.progress(g).done) return { ok: true, moves: g.dropsUsed };
    if (g.over) break;
    if (g.canRelease()) {
      wait -= 1 / 60;
      if (wait <= 0) {
        const c = brain.choose(g);
        placeAndRelease(g, c.x);
        wait = 0.6;
      }
    }
  }
  return { ok: false, moves: g.dropsUsed };
}

for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  let ok = 0;
  const moves: number[] = [];
  for (let i = 0; i < tries; i++) {
    const r = attempt(level, randomBrain(i * 7919 + 1), i + 1);
    if (r.ok) {
      ok++;
      moves.push(r.moves);
    }
  }
  let gok = 0;
  const gm: number[] = [];
  for (let i = 0; i < 10; i++) {
    const r = attempt(level, greedyBrain(), 100 + i);
    if (r.ok) {
      gok++;
      gm.push(r.moves);
    }
  }
  moves.sort((a, b) => a - b);
  const med = moves.length ? moves[Math.floor(moves.length / 2)] : '-';
  const min = moves.length ? moves[0] : '-';
  const flag = ok / tries < 0.03 && gok === 0 ? '  ⚠ za trudne?' : ok / tries > 0.9 ? '  (bardzo łatwe)' : '';
  console.log(
    `${level.id.padEnd(9)} losowo ${String(Math.round((ok / tries) * 100)).padStart(3)}% (min ${min}, med ${med} ruchów)` +
      `  greedy ${gok}/10${gm.length ? ` (med ${gm.sort((a, b) => a - b)[Math.floor(gm.length / 2)]})` : ''}` +
      `  limit ${level.moves}, par ${level.par}${flag}`,
  );
}
