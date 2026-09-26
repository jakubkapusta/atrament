// Verifies every order:
//  - master orders: the stored solution replays successfully (careful play: wait for calm)
//  - all orders: success rate of a careful random player (difficulty estimate)
//   npm run orders -- [--tries 200] [--level pryzmat]

import { LEVELS, OrderTracker, orderGame } from '../src/game/orders';
import { placeAndRelease } from '../src/game/ai';
import { randomRate, settle } from './orders-solve';

const args = process.argv.slice(2);
const arg = (k: string, d: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const tries = +arg('--tries', '200');
const only = arg('--level', '');
let bad = 0;

for (const level of LEVELS) {
  if (only && level.id !== only) continue;
  let replay = '';
  if (level.solution) {
    const g = orderGame(level);
    g.fx = false;
    const t = new OrderTracker(level);
    settle(g, t);
    for (const x of level.solution) {
      if (!g.current || t.progress(g).done) break;
      placeAndRelease(g, x);
      settle(g, t);
    }
    if (!t.progress(g).done) settle(g, t, 10);
    const ok = t.progress(g).done && !t.failed;
    if (!ok) bad++;
    replay = ok ? `rozwiązanie OK (${g.dropsUsed})` : `ROZWIĄZANIE NIE DZIAŁA${t.failed ? ` (${t.failed})` : ''}`;
  }
  const rr = randomRate(level, tries);
  const pct = rr.rate * 100;
  const note = level.section === 'mistrz' && pct > 15 ? '  ⚠ za łatwe na mistrzowskie?' : !rr.path && !level.solution ? '  ⚠ brak dowodu rozwiązywalności' : '';
  console.log(`${level.id.padEnd(10)} ${level.section === 'mistrz' ? 'M' : 'N'}  losowo ${pct.toFixed(1).padStart(5)}%  limit ${String(level.moves).padStart(2)} par ${String(level.par).padStart(2)}  ${replay}${note}`);
}
if (bad) {
  console.error(`\n${bad} rozwiązań nie działa — uruchom npm run solve -- --level <id> i podmień solution/par`);
  process.exit(1);
}
