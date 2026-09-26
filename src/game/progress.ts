import { hashString, store } from '../core/math';
import { ALL_INKS, Ink } from './inks';
import { LIQUID_ORDER, type LiquidId } from './liquids';
import { LEVELS } from './orders';

export interface DailyResult {
  score: number;
  combo: number;
  explosions: number;
  grid: string;
}

export interface Profile {
  v: 1;
  discovered: Ink[];
  created: Partial<Record<Ink, number>>;
  best: Record<string, number>; // mode or mode:liquid
  bestCombo: number;
  biggestBlast: number; // tier of the largest black drop detonated (-1 = none)
  games: number;
  drops: number;
  daily: Record<string, DailyResult>;
  orders: Record<string, { stars: number; moves: number }>;
  liquid: LiquidId;
  seenLiquids: LiquidId[]; // unlocks already announced
}

const KEY = 'atrament.profile';

function fresh(): Profile {
  return {
    v: 1, discovered: [], created: {}, best: {}, bestCombo: 0, biggestBlast: -1,
    games: 0, drops: 0, daily: {}, orders: {}, liquid: 'water', seenLiquids: ['water'],
  };
}

export function loadProfile(): Profile {
  const p = store.get<Profile | null>(KEY, null);
  if (p && p.v === 1) {
    const merged = { ...fresh(), ...p };
    if (!p.seenLiquids) merged.seenLiquids = unlockedLiquids(merged);
    return merged;
  }
  // migrate v0.1 keys
  const np = fresh();
  np.discovered = store.get<Ink[]>('atrament.discovered', []);
  np.best = store.get<Record<string, number>>('atrament.best', {});
  return np;
}

export function saveProfile(p: Profile) {
  store.set(KEY, p);
}

/** Local calendar day, YYYY-MM-DD. */
export function dailyKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dailySeed(key: string) {
  return hashString(`atrament/${key}`);
}

export const DAILY_DROPS = 50;

/** Consecutive days with a daily result, counting back from today (or yesterday). */
export function dailyStreak(p: Profile) {
  const d = new Date();
  if (!p.daily[dailyKey(d)]) d.setDate(d.getDate() - 1);
  let n = 0;
  while (p.daily[dailyKey(d)]) {
    n++;
    d.setDate(d.getDate() - 1);
  }
  return n;
}

export function bestKey(mode: string, liquid: LiquidId) {
  return liquid === 'water' ? mode : `${mode}:${liquid}`;
}

export function liquidProgress(p: Profile, id: LiquidId): { done: boolean; cur: number; need: number } {
  switch (id) {
    case 'oil':
      return { cur: p.best.classic ?? 0, need: 2500, done: (p.best.classic ?? 0) >= 2500 };
    case 'milk': {
      const n = LEVELS.filter((l) => l.section === 'wprawa' && p.orders[l.id]).length;
      return { cur: n, need: 6, done: n >= 6 };
    }
    case 'zerog':
      return { cur: p.discovered.length, need: ALL_INKS.length, done: p.discovered.length >= ALL_INKS.length };
    default:
      return { cur: 1, need: 1, done: true };
  }
}

export function liquidUnlocked(p: Profile, id: LiquidId) {
  return liquidProgress(p, id).done;
}

export function unlockedLiquids(p: Profile) {
  return LIQUID_ORDER.filter((id) => liquidUnlocked(p, id));
}

/** Liquids unlocked since the last call (marks them as announced). */
export function newlyUnlocked(p: Profile): LiquidId[] {
  const fresh = unlockedLiquids(p).filter((id) => !p.seenLiquids.includes(id));
  p.seenLiquids = [...p.seenLiquids, ...fresh];
  return fresh;
}

