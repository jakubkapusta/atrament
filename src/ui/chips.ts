import { Ink } from '../game/inks';

export const INK_CLASS: Partial<Record<Ink, string>> = {
  [Ink.R]: 'c-r',
  [Ink.Y]: 'c-y',
  [Ink.B]: 'c-b',
  [Ink.O]: 'c-o',
  [Ink.G]: 'c-g',
  [Ink.P]: 'c-p',
  [Ink.K]: 'c-k',
  [Ink.M]: 'c-m',
  [Ink.GOLD]: 'c-gold',
  [Ink.OPAL]: 'c-opal',
  [Ink.PEARL]: 'c-pearl',
};

/** Small CSS "drop" swatch for an ink. */
export const chip = (ink: Ink, big = false) => `<i class="chip ${INK_CLASS[ink] ?? ''}${big ? ' big' : ''}"></i>`;
