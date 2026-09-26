import { ALL_INKS, INKS, SPECIAL } from '../game/inks';
import { LIQUIDS, LIQUID_ORDER } from '../game/liquids';
import { dailyStreak, liquidProgress, type Profile } from '../game/progress';
import { chip } from './chips';

export function renderAtlas(p: Profile, root: { grid: HTMLElement; count: HTMLElement; liquids: HTMLElement; stats: HTMLElement }) {
  const found = new Set(p.discovered);
  root.count.textContent = `odkryto ${found.size} z ${ALL_INKS.length}`;
  root.grid.innerHTML = ALL_INKS.map((ink) => {
    const d = INKS[ink];
    const known = found.has(ink);
    const made = p.created[ink] ?? 0;
    if (!known) {
      const teaser = SPECIAL.has(ink) ? d.hint ?? '???' : d.recipe;
      return `<div class="atlas-item unknown">${chip(ink)}<b>???</b><small>${teaser}</small></div>`;
    }
    return `<div class="atlas-item">${chip(ink)}<b>${d.name}</b><small>${d.recipe}${d.effect ? ` — ${d.effect}` : ''}</small><small>${made ? `stworzono ${made}×` : ''}</small></div>`;
  }).join('');
  root.liquids.innerHTML = LIQUID_ORDER.map((id) => {
    const l = LIQUIDS[id];
    const pr = liquidProgress(p, id);
    const lock = `🔒 ${l.unlock}<br><small>${Math.min(pr.cur, pr.need)} / ${pr.need}</small>`;
    return `<div><span><b>${l.name}</b> · ${l.desc}</span><span class="${pr.done ? '' : 'lock'}">${pr.done ? '✓' : lock}</span></div>`;
  }).join('');
  const bestLine = Object.entries(p.best)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => {
      const [mode, liq] = k.split(':');
      const name = (mode === 'classic' ? 'Klasyczny' : mode === 'murky' ? 'Mętny' : mode) + (liq ? ` · ${LIQUIDS[liq as keyof typeof LIQUIDS]?.name ?? liq}` : '');
      return `<div><span>Rekord — ${name}</span><b>${v}</b></div>`;
    })
    .join('');
  root.stats.innerHTML =
    bestLine +
    `<div><span>Najlepsze combo</span><b>×${p.bestCombo}</b></div>` +
    `<div><span>Największa czerń</span><b>${p.biggestBlast >= 0 ? `wielkość ${p.biggestBlast + 1}` : '—'}</b></div>` +
    `<div><span>Rozegrane gry</span><b>${p.games}</b></div>` +
    `<div><span>Upuszczone krople</span><b>${p.drops}</b></div>` +
    `<div><span>Seria Słoja dnia</span><b>${dailyStreak(p)} dni</b></div>`;
}
