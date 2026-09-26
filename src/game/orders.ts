import { Ink, INKS } from './inks';
import { Game, TIER_R, type GameEvent, type Piece } from './game';
import type { LiquidId } from './liquids';

// Hand-made puzzles. Each teaches one idea; scripts/orders-check.ts verifies they are solvable.

export type Goal =
  | { type: 'make'; ink: Ink; tier?: number; count?: number }
  | { type: 'clear'; ink: Ink }
  | { type: 'explode'; count: number }
  | { type: 'score'; value: number }
  | { type: 'empty' } // no drops left in the jar
  | { type: 'have'; items: { ink: Ink; tier: number }[] } // all present at the same time
  | { type: 'combo'; value: number };

export type Forbid = 'mud' | 'explode';

export interface Level {
  id: string;
  name: string;
  desc: string;
  goal: Goal;
  moves: number;
  par: number; // moves for 3 stars
  queue?: Piece[]; // fixed drop sequence (cycled); omitted = random from seed
  seed?: number;
  setup?: [Ink, number, number, number?][]; // ink, tier, x, y (default: resting on the floor)
  murky?: boolean;
  liquid?: LiquidId;
  forbid?: Forbid[];
  section?: 'nauka' | 'mistrz';
  /** a known solution (x per drop), verified by scripts/orders-check.ts */
  solution?: number[];
}

const P = (ink: Ink, tier: number): Piece => ({ ink, tier });
const { R, Y, B, O, G, P: V, M } = Ink;

const TUTORIAL: Level[] = [
  {
    id: 'zielen', name: 'Pierwsza zieleń', desc: 'Kadm i ultramaryna tej samej wielkości dają szmaragd.',
    goal: { type: 'make', ink: Ink.G }, moves: 6, par: 3, queue: [P(Y, 1), P(B, 1)],
  },
  {
    id: 'fiolet', name: 'Dwa fiolety', desc: 'Karmin z ultramaryną — dwa razy.',
    goal: { type: 'make', ink: Ink.P, count: 2 }, moves: 9, par: 6, queue: [P(R, 1), P(B, 1), P(B, 1), P(R, 1)],
  },
  {
    id: 'wybuch', name: 'Pierwszy wybuch', desc: 'Oranż i ultramaryna tej samej wielkości to czerń.',
    goal: { type: 'explode', count: 1 }, moves: 9, par: 5, queue: [P(R, 0), P(Y, 0), P(B, 1)],
  },
  {
    id: 'mul', name: 'Muł na dnie', desc: 'Muł znika tylko w wybuchu czerni.',
    goal: { type: 'clear', ink: M }, moves: 18, par: 11, queue: [P(R, 0), P(Y, 0), P(B, 1)],
    setup: [[M, 1, 1.3], [M, 1, 3.75], [M, 1, 6.2]],
  },
  {
    id: 'perla', name: 'Perła', desc: 'Dwie duże krople tego samego koloru dojrzewają w perłę.',
    goal: { type: 'make', ink: Ink.PEARL }, moves: 7, par: 5, queue: [P(R, 3)],
  },
  {
    id: 'pryzmat', name: 'Pryzmat', desc: 'Wpuść ultramarynę między karmin i kadm — wszystkie trzy naraz.',
    goal: { type: 'make', ink: Ink.PRISM }, moves: 5, par: 3, queue: [P(B, 1), P(R, 1), P(Y, 1)],
    setup: [[R, 1, 2.05], [Y, 1, 3.45]],
  },
  {
    id: 'zloto', name: 'Złoty strzał', desc: 'Trzy krople tego samego koloru i wielkości naraz dają złoto.',
    goal: { type: 'make', ink: Ink.GOLD }, moves: 8, par: 3, queue: [P(Y, 1)],
    setup: [[Y, 1, 2.9], [Y, 1, 4.6]],
  },
  {
    id: 'metna', name: 'Mętna woda', desc: 'Każda fuzja mąci wodę. Trzy wybuchy ją oczyszczą.',
    goal: { type: 'explode', count: 3 }, moves: 26, par: 16, murky: true,
    queue: [P(R, 0), P(Y, 0), P(B, 1), P(Y, 1), P(B, 1), P(R, 2)],
  },
  {
    id: 'huk', name: 'Wielki huk', desc: 'Naprawdę duża czerń zostawia po sobie coś ciężkiego.',
    goal: { type: 'make', ink: Ink.MERCURY }, moves: 10, par: 6, queue: [P(R, 2), P(Y, 2), P(B, 3)],
  },
  {
    id: 'olej', name: 'W oleju', desc: 'Wszystko płynie wolniej. Zrób duży oranż.',
    goal: { type: 'make', ink: Ink.O, tier: 4 }, moves: 12, par: 7, liquid: 'oil',
    queue: [P(R, 2), P(R, 2), P(Y, 2), P(Y, 2)],
  },
  {
    id: 'mleko', name: 'Mleko i muł', desc: 'W mleku nic nie widać. Wyczyść muł.',
    goal: { type: 'clear', ink: M }, moves: 26, par: 16, liquid: 'milk',
    queue: [P(R, 0), P(Y, 0), P(B, 1), P(Y, 1), P(B, 0), P(R, 0)],
    setup: [[M, 1, 1.0], [M, 2, 3.0], [M, 1, 5.0], [M, 2, 6.6]],
  },
  {
    id: 'mistrz', name: 'Mistrz słoja', desc: 'Losowe krople. Zdobądź 2500 punktów w 60 kroplach.',
    goal: { type: 'score', value: 2500 }, moves: 60, par: 45, seed: 7,
  },
];

// Master orders: each needs planning; verified with scripts/orders-solve.ts (beam search on the
// real physics). A careful random player should rarely (<~5%) succeed.
const MASTER: Level[] = [
  {
    id: 'czysta', name: 'Czysta zieleń', desc: 'Duży szmaragd — bez mułu i bez wybuchów. Karmin trzymaj z dala od zieleni.',
    goal: { type: 'make', ink: G, tier: 4 }, moves: 14, par: 10, forbid: ['mud', 'explode'],
    queue: [P(Y, 1), P(B, 0), P(B, 0), P(Y, 0), P(R, 1), P(Y, 1), P(B, 1), P(R, 0), P(B, 2), P(Y, 2)],
    solution: [3.75, 5.37, 4.72, 1.15, 5.93, 2.81, 2.81, 1.15, 1.97, 1.38],
  },
  {
    id: 'pusty', name: 'Pusty słój', desc: 'Zostaw słój zupełnie pusty.',
    goal: { type: 'empty' }, moves: 12, par: 4,
    queue: [P(R, 0), P(Y, 0), P(B, 1), P(Y, 1), P(B, 0), P(R, 1)],
    setup: [[O, 1, 1.0], [B, 2, 2.6], [G, 1, 4.1], [Y, 1, 5.4], [V, 2, 6.65]],
    solution: [5.25, 3.14, 1.10],
  },
  {
    id: 'trzy', name: 'Trzy barwy naraz', desc: 'Oranż, szmaragd i fiolet w słoju jednocześnie — i żadnego mułu.',
    goal: { type: 'have', items: [{ ink: O, tier: 2 }, { ink: G, tier: 2 }, { ink: V, tier: 2 }] }, moves: 6, par: 6,
    forbid: ['mud'], queue: [P(R, 1), P(Y, 1), P(B, 1), P(Y, 1), P(R, 1), P(B, 1)],
    solution: [2.19, 3.13, 0.63, 0.63, 5.93, 4.69],
  },
  {
    id: 'cisza', name: 'Cisza w słoju', desc: '500 punktów bez ani jednego wybuchu. Czerń zawsze wybucha — nie dopuść do niej.',
    goal: { type: 'score', value: 500 }, moves: 25, par: 22, forbid: ['explode'], seed: 11,
    solution: [3.23, 1.59, 6.23, 4.54, 3.47, 3.07, 4.70, 1.40, 5.46, 5.53, 5.92, 0.67, 5.64, 3.65, 5.77, 4.74, 2.00, 2.54, 5.71, 1.05, 2.35, 0.79],
  },
  {
    id: 'korek', name: 'Pod korek', desc: 'Słój prawie pełny. Dwa wybuchy, zanim przeleje się przez MAX.',
    goal: { type: 'explode', count: 2 }, moves: 8, par: 7,
    queue: [P(Y, 1), P(R, 1), P(B, 2), P(R, 0)],
    setup: [
      [M, 2, 0.8], [M, 1, 2.4], [M, 2, 4.0], [M, 1, 5.5], [M, 2, 6.7],
      [M, 1, 1.6, 2.2], [M, 2, 3.2, 2.4], [M, 1, 4.8, 2.2], [M, 2, 6.2, 2.4],
      [M, 2, 0.9, 4.0], [M, 1, 2.5, 4.0], [M, 2, 4.1, 4.2], [M, 1, 5.6, 4.0],
    ],
    solution: [4.10, 2.02, 2.76, 3.75, 2.02, 1.67, 0.78],
  },
  {
    id: 'kaskada', name: 'Kaskada', desc: 'Combo ×5 — jedna reakcja musi pociągnąć następne.',
    goal: { type: 'combo', value: 5 }, moves: 14, par: 8,
    queue: [P(R, 0), P(R, 0), P(Y, 1), P(B, 1), P(Y, 0), P(Y, 0), P(R, 2), P(B, 2)],
    solution: [1.57, 6.61, 4.03, 2.05, 2.20, 4.69, 2.01],
  },
  {
    id: 'zloto2', name: 'Złota para', desc: 'Dwa razy złoto.',
    goal: { type: 'make', ink: Ink.GOLD, count: 2 }, moves: 12, par: 7,
    queue: [P(B, 1), P(B, 1), P(B, 1), P(R, 1), P(R, 1), P(R, 1), P(Y, 0)],
    solution: [1.35, 2.94, 2.61, 6.06, 4.58, 5.17],
  },
  {
    id: 'perly', name: 'Perły zamiast czerni', desc: 'Muł bez ani jednego wybuchu? Tylko perła go rozpuści.',
    goal: { type: 'clear', ink: M }, moves: 8, par: 7, forbid: ['explode'],
    queue: [P(B, 3), P(B, 3), P(B, 3), P(B, 3), P(Y, 0)],
    setup: [[M, 1, 0.8], [M, 2, 2.9], [M, 1, 4.9], [M, 2, 6.65]],
    solution: [1.408, 3.108, 4.061, 4.280, 3.736, 4.977],
  },
  {
    id: 'odkurzacz', name: 'Odkurzacz', desc: 'Pełno drobnicy. Wielki huk i jego pozostałość zrobią porządek.',
    goal: { type: 'empty' }, moves: 10, par: 6,
    queue: [P(R, 2), P(Y, 2), P(B, 3), P(Y, 0)],
    setup: [
      [R, 0, 0.6], [Y, 1, 1.75], [B, 0, 2.9], [R, 1, 4.0], [Y, 0, 5.1], [B, 1, 6.2],
      [G, 0, 1.2, 1.5], [O, 0, 3.4, 1.5], [V, 0, 5.6, 1.5],
    ],
    solution: [0.78, 1.77, 2.52, 4.83, 4.08],
  },
  {
    id: 'olej2', name: 'Olejna precyzja', desc: 'W oleju wszystko płynie wolno. Duży fiolet, bez mułu.',
    goal: { type: 'make', ink: V, tier: 4 }, moves: 12, par: 9, liquid: 'oil', forbid: ['mud'],
    queue: [P(R, 1), P(B, 1), P(R, 1), P(Y, 1), P(B, 1), P(R, 2), P(B, 2), P(Y, 0)],
    solution: [3.29, 4.42, 3.81, 1.39, 4.08, 3.25, 1.83, 1.85],
  },
  {
    id: 'mleko2', name: 'Mleczna czerń', desc: 'Trzy wybuchy w mleku, bez mułu. Zapamiętaj, co gdzie leży.',
    goal: { type: 'explode', count: 3 }, moves: 15, par: 11, liquid: 'milk', forbid: ['mud'],
    queue: [P(R, 0), P(Y, 0), P(B, 1), P(B, 0), P(Y, 0), P(R, 1), P(Y, 1), P(B, 1)],
    solution: [5.373, 6.996, 5.622, 3.101, 2.452, 3.126, 3.750, 3.126, 5.698, 6.671, 4.998],
  },
  {
    id: 'arcy', name: 'Arcymistrz', desc: 'Losowe krople, 3000 punktów w 50 kroplach — bez mułu.',
    goal: { type: 'score', value: 3000 }, moves: 50, par: 35, forbid: ['mud'], seed: 21,
    solution: [1.331, 1.806, 2.226, 5.424, 0.989, 5.003, 3.347, 5.173, 6.110, 6.678, 4.237, 3.446, 3.618, 5.244, 3.152, 6.390, 3.112, 5.140, 5.923, 1.330, 4.592, 3.961, 6.027, 4.755, 3.719, 6.620, 2.076, 4.884, 5.583, 6.165, 2.918],
  },
];

export const LEVELS: Level[] = [
  ...TUTORIAL.map((l) => ({ ...l, section: 'nauka' as const })),
  ...MASTER.map((l) => ({ ...l, section: 'mistrz' as const })),
];

export function setupFor(level: Level) {
  return (level.setup ?? []).map(([ink, tier, x, y]) => ({ ink, tier, x, y: y ?? TIER_R[tier] + 0.02 }));
}

/** The game for an order — shared by the app, the checker and the solver. */
export function orderGame(level: Level, discovered: Ink[] = []) {
  return new Game('order', {
    seed: 4242, pieceSeed: level.seed ?? 1, dropLimit: level.moves, queue: level.queue, setup: setupFor(level),
    liquid: level.liquid, murky: level.murky, discovered,
  });
}

/** Everything has come to rest (no merges, no fuses, nothing moving). */
export function calm(g: Game) {
  return g.merges.length === 0 && g.drops.every((d) => d.state === 0 && d.ink !== Ink.K && Math.hypot(d.vx, d.vy) < 0.4);
}

const FORBID_TEXT: Record<Forbid, string> = { mud: 'bez mułu', explode: 'bez wybuchów' };
export const forbidText = (l: Level) => (l.forbid ?? []).map((f) => FORBID_TEXT[f]).join(', ');

export function goalText(g: Goal) {
  switch (g.type) {
    case 'make':
      return `Stwórz: ${INKS[g.ink].name}${g.tier ? ` (wielkość ${g.tier + 1}+)` : ''}${g.count && g.count > 1 ? ` ×${g.count}` : ''}`;
    case 'clear':
      return `Usuń cały ${INKS[g.ink].name.toLowerCase()}`;
    case 'explode':
      return g.count > 1 ? `Wybuchy: ${g.count}` : 'Wywołaj wybuch';
    case 'score':
      return `Zdobądź ${g.value} pkt`;
    case 'empty':
      return 'Opróżnij słój';
    case 'have':
      return `Miej naraz: ${g.items.map((i) => `${INKS[i.ink].name.toLowerCase()} ${i.tier + 1}+`).join(', ')}`;
    case 'combo':
      return `Combo ×${g.value}`;
  }
}

/** Tracks goal progress from simulation events. */
export class OrderTracker {
  made = 0;
  blasts = 0;
  maxCombo = 0;
  failed: string | null = null;
  initial = -1;
  constructor(readonly level: Level) {}

  clone() {
    const t = new OrderTracker(this.level);
    t.made = this.made;
    t.blasts = this.blasts;
    t.maxCombo = this.maxCombo;
    t.failed = this.failed;
    t.initial = this.initial;
    return t;
  }

  onEvent(e: GameEvent) {
    const g = this.level.goal;
    const forbid = this.level.forbid ?? [];
    if (e.t === 'explode') {
      this.blasts++;
      this.maxCombo = Math.max(this.maxCombo, e.combo);
      if (g.type === 'make' && g.ink === Ink.MERCURY && e.tier >= 4) this.made++;
      if (forbid.includes('explode')) this.failed = 'Wybuch był zakazany';
    }
    if (e.t === 'merge') {
      this.maxCombo = Math.max(this.maxCombo, e.combo);
      if (g.type === 'make' && e.ink === g.ink && e.tier >= (g.tier ?? 0)) this.made++;
      if (e.ink === Ink.M && forbid.includes('mud')) this.failed = 'Powstał muł';
    }
  }

  private live(game: Game) {
    return game.drops.filter((d) => d.state !== 2);
  }

  /** 0..1 progress (with partial credit) — used by the solver and the HUD. */
  value(game: Game): number {
    const g = this.level.goal;
    const live = this.live(game);
    if (this.initial < 0) this.initial = Math.max(1, live.length);
    switch (g.type) {
      case 'make': {
        const need = g.count ?? 1;
        let partial = 0;
        for (const d of live) if (d.ink === g.ink) partial = Math.max(partial, Math.min(1, (d.tier + 1) / ((g.tier ?? 0) + 2)));
        return Math.min(1, (this.made + (this.made < need ? partial * 0.6 : 0)) / need);
      }
      case 'clear': {
        const left = live.filter((d) => d.ink === g.ink).length;
        return 1 - left / Math.max(left, this.initial);
      }
      case 'empty':
        return live.length === 0 ? 1 : 1 / (1 + live.length);
      case 'explode':
        return Math.min(1, this.blasts / g.count);
      case 'score':
        return Math.min(1, game.score / g.value);
      case 'combo':
        return Math.min(1, this.maxCombo / g.value);
      case 'have': {
        let sum = 0;
        for (const it of g.items) {
          let best = 0;
          for (const d of live) if (d.ink === it.ink) best = Math.max(best, Math.min(1, (d.tier + 1) / (it.tier + 1)));
          sum += best;
        }
        return sum / g.items.length;
      }
    }
  }

  progress(game: Game): { done: boolean; text: string } {
    const g = this.level.goal;
    const live = this.live(game);
    switch (g.type) {
      case 'make': {
        const need = g.count ?? 1;
        return { done: this.made >= need, text: need > 1 ? `${Math.min(this.made, need)}/${need}` : this.made ? '✓' : '' };
      }
      case 'clear': {
        const left = live.filter((d) => d.ink === g.ink).length;
        return { done: left === 0, text: `zostało ${left}` };
      }
      case 'empty':
        return { done: live.length === 0, text: `zostało ${live.length}` };
      case 'explode':
        return { done: this.blasts >= g.count, text: `${Math.min(this.blasts, g.count)}/${g.count}` };
      case 'score':
        return { done: game.score >= g.value, text: `${game.score}/${g.value}` };
      case 'combo':
        return { done: this.maxCombo >= g.value, text: `najlepsze ×${this.maxCombo}` };
      case 'have': {
        const ok = g.items.filter((it) => live.some((d) => d.ink === it.ink && d.tier >= it.tier)).length;
        return { done: ok === g.items.length, text: `${ok}/${g.items.length}` };
      }
    }
  }

  stars(movesUsed: number) {
    const par = this.level.par;
    if (movesUsed <= par) return 3;
    if (movesUsed <= Math.ceil(par * 1.6)) return 2;
    return 1;
  }
}
