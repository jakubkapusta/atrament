// Liquids change the physics of the jar and the look of the water.

export type LiquidId = 'water' | 'oil' | 'milk' | 'zerog';

export interface Liquid {
  id: LiquidId;
  name: string;
  desc: string;
  /** how to unlock (see progress.ts liquidProgress) */
  unlock: string;
  gravity: number; // in-liquid gravity multiplier
  drag: number; // velocity damping per second
  wave: number; // surface wave speed multiplier
  /** renderer: absorption tint of the liquid itself (per unit), baseline turbidity, flow curl */
  tint: [number, number, number];
  haze: number;
  hazeCol: [number, number, number];
  curl: number;
  dyeFade: number; // multiplier of ink dissipation
  milk: number; // 0..1 opaque creamy scattering
  cosmic: number; // 0..1 space look: indigo depth, nebulae, stars, glowing rims
}

export const LIQUIDS: Record<LiquidId, Liquid> = {
  water: {
    id: 'water', name: 'Woda', desc: 'krystalicznie czysta', unlock: '',
    gravity: 1, drag: 2.1, wave: 1, tint: [0.085, 0.028, 0.02], haze: 0, hazeCol: [0.62, 0.58, 0.5], curl: 26, dyeFade: 1, milk: 0, cosmic: 0,
  },
  oil: {
    id: 'oil', name: 'Olej', desc: 'gęsty i leniwy — krople suną wolniej', unlock: '2500 pkt w trybie Klasycznym',
    gravity: 0.85, drag: 2.8, wave: 0.55, tint: [0.02, 0.07, 0.3], haze: 0, hazeCol: [0.7, 0.6, 0.35], curl: 10, dyeFade: 0.6, milk: 0, cosmic: 0,
  },
  milk: {
    id: 'milk', name: 'Mleko', desc: 'widać tylko to, co blisko szkła', unlock: '6 zleceń z sekcji Wprawa',
    gravity: 0.9, drag: 2.6, wave: 0.9, tint: [0.03, 0.03, 0.05], haze: 0, hazeCol: [0.95, 0.93, 0.88], curl: 22, dyeFade: 1.2, milk: 1, cosmic: 0,
  },
  zerog: {
    id: 'zerog', name: 'Nieważkość', desc: 'krople ledwo opadają i odbijają się od siebie', unlock: 'wszystkie 13 atramentów w Atlasie',
    gravity: 0.16, drag: 0.7, wave: 0.4, tint: [0.06, 0.03, 0.01], haze: 0, hazeCol: [0.62, 0.58, 0.5], curl: 34, dyeFade: 0.8, milk: 0, cosmic: 1,
  },
};

export const LIQUID_ORDER: LiquidId[] = ['water', 'oil', 'milk', 'zerog'];
