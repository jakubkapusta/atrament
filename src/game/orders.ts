import { Ink, INKS } from './inks';
import { TIER_R, type Game, type GameEvent, type Piece } from './game';
import type { LiquidId } from './liquids';

// Hand-made puzzles. Each teaches one idea; scripts/orders-check.ts verifies they are solvable.

export type Goal =
  | { type: 'make'; ink: Ink; tier?: number; count?: number }
  | { type: 'clear'; ink: Ink }
  | { type: 'explode'; count: number }
  | { type: 'score'; value: number };

export interface Level {
  id: string;
  name: string;
  desc: string;
  goal: Goal;
  moves: number;
  par: number; // moves for 3 stars
  queue?: Piece[]; // fixed drop sequence (cycled); omitted = random from seed
  seed?: number;
  setup?: [Ink, number, number][]; // ink, tier, x (placed resting on the floor / pile)
  murky?: boolean;
  liquid?: LiquidId;
}

const P = (ink: Ink, tier: number): Piece => ({ ink, tier });
const { R, Y, B, M } = Ink;

export const LEVELS: Level[] = [
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

export function setupFor(level: Level) {
  return (level.setup ?? []).map(([ink, tier, x]) => ({ ink, tier, x, y: TIER_R[tier] + 0.02 }));
}

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
  }
}

/** Tracks goal progress from simulation events. */
export class OrderTracker {
  made = 0;
  blasts = 0;
  constructor(readonly level: Level) {}

  onEvent(e: GameEvent) {
    const g = this.level.goal;
    if (e.t === 'explode') {
      this.blasts++;
      if (g.type === 'make' && g.ink === Ink.MERCURY && e.tier >= 4) this.made++;
    }
    if (g.type === 'make' && e.t === 'merge' && e.ink === g.ink && e.tier >= (g.tier ?? 0)) this.made++;
  }

  progress(game: Game): { done: boolean; text: string } {
    const g = this.level.goal;
    switch (g.type) {
      case 'make': {
        const need = g.count ?? 1;
        return { done: this.made >= need, text: need > 1 ? `${Math.min(this.made, need)}/${need}` : this.made ? '✓' : '' };
      }
      case 'clear': {
        const left = game.drops.filter((d) => d.ink === g.ink && d.state !== 2).length;
        return { done: left === 0, text: `zostało ${left}` };
      }
      case 'explode':
        return { done: this.blasts >= g.count, text: `${Math.min(this.blasts, g.count)}/${g.count}` };
      case 'score':
        return { done: game.score >= g.value, text: `${game.score}/${g.value}` };
    }
  }

  stars(movesUsed: number) {
    const par = this.level.par;
    if (movesUsed <= par) return 3;
    if (movesUsed <= Math.ceil(par * 1.6)) return 2;
    return 1;
  }
}
