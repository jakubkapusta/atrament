import { DANGER, JAR_W, type Drop } from '../game/game';
import { Ink } from '../game/inks';

const EMOJI: Record<Ink, string> = {
  [Ink.R]: '🔴', [Ink.Y]: '🟡', [Ink.B]: '🔵', [Ink.O]: '🟠', [Ink.G]: '🟢', [Ink.P]: '🟣',
  [Ink.K]: '⚫', [Ink.M]: '🟤', [Ink.GOLD]: '🌟', [Ink.OPAL]: '💎', [Ink.PEARL]: '🤍',
  [Ink.MERCURY]: '🪩', [Ink.PRISM]: '🌈',
};
const EMPTY = '◽';

/** Emoji picture of the jar contents (Wordle-style), top row first; empty top rows trimmed. */
export function jarGrid(drops: Drop[], cols = 7, rows = 8) {
  const H = DANGER + 0.6;
  const lines: string[] = [];
  for (let r = rows - 1; r >= 0; r--) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x = ((c + 0.5) / cols) * JAR_W;
      const y = ((r + 0.5) / rows) * H;
      let hit: Drop | null = null;
      for (const d of drops) {
        if (d.state === 2) continue;
        const dx = d.x - x;
        const dy = d.y - y;
        if (dx * dx + dy * dy < d.r * d.r * 1.1 && (!hit || d.r > hit.r)) hit = d;
      }
      line += hit ? EMOJI[hit.ink] : EMPTY;
    }
    lines.push(line);
  }
  while (lines.length > 1 && lines[0] === EMPTY.repeat(cols)) lines.shift();
  return lines.join('\n');
}

export async function shareText(text: string): Promise<'shared' | 'copied' | 'failed'> {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return 'shared';
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return 'failed';
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
