// Headless gameplay simulation for balancing.
//
//   npm run sim -- --games 30 --ai greedy
//   npm run sim -- --ai lookahead --games 8 --think 1.2
//   npm run sim -- --sweep tierScale=0.9,1,1.1,1.2 --games 20
//   npm run sim -- --weights 50,35,15 --blastK 3 --mode murky
//   npm run sim -- --sweep 'weights=40,35,25;30,35,25,10'   (use ; when values contain commas)
//
// Time is simulated game time: after the pipette is ready the bot "thinks" for --think s.
// Real play ≈ 0.75 s pipette cycle + think time per drop.

import { Game, TUNING, setTierScale, type Mode } from '../src/game/game';
import { Ink } from '../src/game/inks';
import type { LiquidId } from '../src/game/liquids';
import { greedyBrain, lookaheadBrain, placeAndRelease, randomBrain, type Brain } from '../src/game/ai';

interface Opts {
  games: number;
  ai: string;
  think: number;
  seed: number;
  mode: Mode;
  cap: number;
  liquid: LiquidId;
  verbose: boolean;
}

function parse(argv: string[]) {
  const o: Opts = { games: 20, ai: 'greedy', think: 1.0, seed: 1, mode: 'classic', cap: 900, verbose: false, liquid: 'water' };
  const tune: Record<string, string> = {};
  let sweep: { key: string; values: string[] } | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = argv[i + 1];
    switch (a) {
      case '--games': o.games = +v; i++; break;
      case '--ai': o.ai = v; i++; break;
      case '--think': o.think = +v; i++; break;
      case '--seed': o.seed = +v; i++; break;
      case '--mode': o.mode = v as Mode; i++; break;
      case '--cap': o.cap = +v; i++; break;
      case '--liquid': o.liquid = v as LiquidId; i++; break;
      case '-v': case '--verbose': o.verbose = true; break;
      case '--sweep': {
        const [key, list] = v.split('=');
        sweep = { key, values: list.split(list.includes(';') ? ';' : ',') };
        i++;
        break;
      }
      default:
        if (a.startsWith('--')) {
          tune[a.slice(2)] = v;
          i++;
        }
    }
  }
  return { o, tune, sweep };
}

function applyTuning(t: Record<string, string>) {
  for (const [k, v] of Object.entries(t)) {
    if (k === 'tierScale') setTierScale(+v);
    else if (k === 'weights') TUNING.spawnWeights = v.split(',').map(Number);
    else if (k === 'earlyWeights') TUNING.earlyWeights = v.split(',').map(Number);
    else if (k === 'late') TUNING.lateWeights = v.split(',').map(Number);
    else if (k in TUNING) (TUNING as Record<string, unknown>)[k] = +v;
    else throw new Error(`unknown tuning key: ${k}`);
  }
}

function makeBrain(name: string, seed: number): Brain {
  if (name === 'random') return randomBrain(seed);
  if (name === 'lookahead') return lookaheadBrain();
  return greedyBrain();
}

interface Result {
  drops: number;
  seconds: number;
  score: number;
  explosions: number;
  bestCombo: number;
  mud: number;
  gold: number;
  opal: number;
  pearl: number;
  capped: boolean;
}

function playOne(o: Opts, seed: number): Result {
  const g = new Game(o.mode, { seed, liquid: o.liquid });
  g.fx = false;
  const brain = makeBrain(o.ai, seed);
  const r: Result = { drops: 0, seconds: 0, score: 0, explosions: 0, bestCombo: 0, mud: 0, gold: 0, opal: 0, pearl: 0, capped: false };
  const dt = 1 / 60;
  let wait = o.think;
  while (!g.over) {
    g.update(dt);
    for (const e of g.events) {
      if (e.t === 'explode') r.explosions++;
      if (e.t === 'merge') {
        if (e.ink === Ink.M) r.mud++;
        if (e.kind === 'gold') r.gold++;
        if (e.kind === 'opal') r.opal++;
        if (e.kind === 'pearl') r.pearl++;
      }
    }
    g.events.length = 0;
    if (g.canRelease()) {
      wait -= dt;
      if (wait <= 0) {
        const c = brain.choose(g);
        if (c.hold && g.swapHold()) continue;
        placeAndRelease(g, c.x);
        wait = o.think;
        if (g.dropsUsed >= o.cap) {
          r.capped = true;
          break;
        }
      }
    }
  }
  r.drops = g.dropsUsed;
  r.seconds = g.time;
  r.score = g.score;
  r.bestCombo = g.bestCombo;
  return r;
}

const q = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmtMin = (s: number) => {
  const t = Math.round(s);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};

function run(o: Opts, label: string) {
  const res: Result[] = [];
  const t0 = performance.now();
  for (let i = 0; i < o.games; i++) {
    const r = playOne(o, o.seed * 1000 + i);
    res.push(r);
    if (o.verbose) {
      console.log(`  #${i + 1}: ${r.drops} kropel, ${fmtMin(r.seconds)}, ${r.score} pkt, wybuchy ${r.explosions}, combo ×${r.bestCombo}${r.capped ? ' (limit)' : ''}`);
    }
  }
  const secs = res.map((r) => r.seconds);
  const drops = res.map((r) => r.drops);
  const scores = res.map((r) => r.score);
  console.log(
    `${label.padEnd(22)} czas śr ${fmtMin(mean(secs))}  med ${fmtMin(q(secs, 0.5))}  p10–p90 ${fmtMin(q(secs, 0.1))}–${fmtMin(q(secs, 0.9))}` +
      ` | krople śr ${mean(drops).toFixed(0)} (p10 ${q(drops, 0.1)}, p90 ${q(drops, 0.9)})` +
      ` | pkt śr ${mean(scores).toFixed(0)} | wybuchy/grę ${mean(res.map((r) => r.explosions)).toFixed(1)}` +
      ` | muł ${mean(res.map((r) => r.mud)).toFixed(1)} | złoto ${mean(res.map((r) => r.gold)).toFixed(2)} opal ${mean(res.map((r) => r.opal)).toFixed(2)} perła ${mean(res.map((r) => r.pearl)).toFixed(2)}` +
      `${res.some((r) => r.capped) ? ` | limit: ${res.filter((r) => r.capped).length}` : ''}` +
      `  [${((performance.now() - t0) / 1000).toFixed(1)} s]`,
  );
}

const { o, tune, sweep } = parse(process.argv.slice(2));
applyTuning(tune);
console.log(`AI=${o.ai} tryb=${o.mode} ciecz=${o.liquid} gier=${o.games} myślenie=${o.think}s  TUNING=${JSON.stringify(TUNING)}`);
if (sweep) {
  for (const v of sweep.values) {
    applyTuning({ [sweep.key]: v });
    run(o, `${sweep.key}=${v}`);
  }
} else run(o, 'wynik');
