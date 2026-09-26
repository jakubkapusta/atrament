export enum Ink {
  R, // czerwony (karmin)
  Y, // żółty
  B, // niebieski (ultramaryna)
  O, // pomarańczowy
  G, // zielony
  P, // fioletowy
  K, // czarny — bomba
  M, // muł
  GOLD,
  OPAL,
  PEARL,
  MERCURY, // hidden: left behind by a big black explosion; swallows smaller drops
  PRISM, // hidden: red + yellow + blue of one size at once; recolours a whole size class
}

export type Vec3 = [number, number, number];

export interface InkDef {
  name: string;
  /** Absorbance per unit path length (Beer-Lambert): transmitted = exp(-absorb * length). */
  absorb: Vec3;
  /** CSS colour for UI (roughly exp(-absorb*0.9)). */
  css: string;
  gold?: number;
  pearl?: number;
  opal?: number;
  mercury?: number;
  prism?: number;
  /** how it is made (Atlas) */
  recipe: string;
  /** effect description (Atlas) */
  effect?: string;
  /** teaser shown in the Atlas before discovery */
  hint?: string;
  /** mass multiplier */
  mass: number;
  /** multiplier of in-water gravity (1 = normal sinking, <0.3 = almost floats) */
  sink: number;
}

export const INKS: Record<Ink, InkDef> = {
  [Ink.R]: { name: 'Karmin', absorb: [0.08, 2.3, 1.85], css: '#d8202c', mass: 1, sink: 1, recipe: 'kolor podstawowy' },
  [Ink.Y]: { name: 'Kadm', absorb: [0.0, 0.24, 2.6], css: '#f2c21b', mass: 1, sink: 1, recipe: 'kolor podstawowy' },
  [Ink.B]: { name: 'Ultramaryna', absorb: [2.5, 1.35, 0.12], css: '#1f4fd0', mass: 1, sink: 1, recipe: 'kolor podstawowy' },
  [Ink.O]: { name: 'Oranż', absorb: [0.02, 0.85, 3.1], css: '#f07a12', mass: 1, sink: 1, recipe: 'karmin + kadm' },
  [Ink.G]: { name: 'Szmaragd', absorb: [2.4, 0.42, 1.3], css: '#12966a', mass: 1, sink: 1, recipe: 'kadm + ultramaryna' },
  [Ink.P]: { name: 'Fiolet', absorb: [0.85, 2.5, 0.32], css: '#8a2fb8', mass: 1, sink: 1, recipe: 'ultramaryna + karmin' },
  [Ink.K]: {
    name: 'Czerń', absorb: [3.6, 3.5, 3.3], css: '#121015', mass: 1.1, sink: 1,
    recipe: 'kolor pochodny + jego dopełnienie', effect: 'wybucha i czyści okolicę',
  },
  [Ink.M]: {
    name: 'Muł', absorb: [0.95, 1.35, 2.1], css: '#6b4a2a', mass: 2.2, sink: 1.6,
    recipe: 'dwa różne kolory pochodne', effect: 'ciężki, z niczym się nie łączy; znika w wybuchu',
  },
  [Ink.GOLD]: {
    name: 'Złoto', absorb: [0.1, 0.45, 1.7], css: '#e0a82e', gold: 1, mass: 1.4, sink: 1.1,
    recipe: 'trzy krople tego samego koloru i wielkości naraz', effect: 'łączy się z każdą kroplą swojej wielkości, punkty ×3',
    hint: 'Trzy to więcej niż dwa…',
  },
  [Ink.OPAL]: {
    name: 'Opal', absorb: [0.28, 0.2, 0.14], css: '#b9d6e8', opal: 1, mass: 1, sink: 0.8,
    recipe: 'reakcja dwóch kropli odepchniętych wybuchem', effect: 'z każdą kroplą swojej wielkości daje czerń',
    hint: 'Coś rodzi się w locie.',
  },
  [Ink.PEARL]: {
    name: 'Perła', absorb: [0.1, 0.1, 0.12], css: '#f1ece4', pearl: 1, mass: 0.6, sink: 0.12,
    recipe: 'dwie duże krople tego samego koloru', effect: 'prawie nie tonie; rozpuszcza muł',
    hint: 'Duże rzeczy dojrzewają powoli.',
  },
  [Ink.MERCURY]: {
    name: 'Rtęć', absorb: [0.3, 0.28, 0.25], css: '#b8bec6', mercury: 1, mass: 3, sink: 2,
    recipe: 'zostaje po wielkim wybuchu czerni', effect: 'połyka mniejsze krople (4 razy)',
    hint: 'Po naprawdę wielkim huku coś zostaje na dnie.',
  },
  [Ink.PRISM]: {
    name: 'Pryzmat', absorb: [0.02, 0.02, 0.02], css: '#e8f0ff', prism: 1, mass: 0.8, sink: 0.7,
    recipe: 'karmin, kadm i ultramaryna tej samej wielkości naraz', effect: 'przemalowuje wszystkie krople jednej wielkości',
    hint: 'Wszystkie trzy światła w jednym miejscu.',
  },
};

export const PRIMARIES = [Ink.R, Ink.Y, Ink.B];
export const SPECIAL = new Set([Ink.GOLD, Ink.OPAL, Ink.PEARL, Ink.MERCURY, Ink.PRISM]);
export const ALL_INKS: Ink[] = [Ink.R, Ink.Y, Ink.B, Ink.O, Ink.G, Ink.P, Ink.K, Ink.M, Ink.GOLD, Ink.OPAL, Ink.PEARL, Ink.MERCURY, Ink.PRISM];

export const isPrimary = (i: Ink) => i === Ink.R || i === Ink.Y || i === Ink.B;
export const isSecondary = (i: Ink) => i === Ink.O || i === Ink.G || i === Ink.P;

function mixPrimaries(a: Ink, b: Ink): Ink {
  const s = new Set([a, b]);
  if (s.has(Ink.R) && s.has(Ink.Y)) return Ink.O;
  if (s.has(Ink.Y) && s.has(Ink.B)) return Ink.G;
  return Ink.P;
}

const COMPLEMENT: Partial<Record<Ink, Ink>> = {
  [Ink.O]: Ink.B,
  [Ink.G]: Ink.R,
  [Ink.P]: Ink.Y,
};

export const MAX_TIER = 7;

export interface Reaction {
  ink: Ink;
  tier: number;
  scoreMul: number;
  kind: 'grow' | 'mix' | 'black' | 'mud' | 'gold' | 'opal' | 'pearl' | 'prism';
}

/** Reaction between two drops of the same tier; null = they just bounce. */
export function react(a: Ink, b: Ink, tier: number, pearlTier = MAX_TIER): Reaction | null {
  const up = Math.min(tier + 1, MAX_TIER);
  // mercury and prism act through their own contact rules (game.ts)
  if (a === Ink.MERCURY || b === Ink.MERCURY || a === Ink.PRISM || b === Ink.PRISM) return null;
  if (a === Ink.PEARL || b === Ink.PEARL) {
    if (a === b) return { ink: Ink.PEARL, tier: up, scoreMul: 2, kind: 'pearl' };
    return null; // pearl vs mud is handled separately (any tier)
  }
  if (a === Ink.OPAL || b === Ink.OPAL) {
    return { ink: Ink.K, tier: up, scoreMul: 2, kind: 'black' };
  }
  if (a === Ink.GOLD || b === Ink.GOLD) {
    const other = a === Ink.GOLD ? b : a;
    return { ink: other, tier: up, scoreMul: 3, kind: other === Ink.GOLD ? 'gold' : 'grow' };
  }
  if (a === b) {
    if (tier >= pearlTier && a !== Ink.K && a !== Ink.M) {
      return { ink: Ink.PEARL, tier, scoreMul: 4, kind: 'pearl' };
    }
    return { ink: a, tier: up, scoreMul: 1, kind: 'grow' };
  }
  if (a === Ink.K || b === Ink.K || a === Ink.M || b === Ink.M) return null;
  if (isPrimary(a) && isPrimary(b)) return { ink: mixPrimaries(a, b), tier: up, scoreMul: 1.5, kind: 'mix' };
  if (isSecondary(a) && isSecondary(b)) return { ink: Ink.M, tier: up, scoreMul: 0.5, kind: 'mud' };
  const sec = isSecondary(a) ? a : b;
  const pri = isSecondary(a) ? b : a;
  if (COMPLEMENT[sec] === pri) return { ink: Ink.K, tier: up, scoreMul: 2, kind: 'black' };
  return null;
}
