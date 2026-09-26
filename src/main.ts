// latin + latin-ext only (Polish diacritics), keeps the offline bundle small
import '@fontsource/fraunces/latin-600.css';
import '@fontsource/fraunces/latin-ext-600.css';
import '@fontsource/fraunces/latin-600-italic.css';
import '@fontsource/fraunces/latin-ext-600-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-ext-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-ext-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-ext-700.css';
import './style.css';

import { Game, JAR_W, TUNING } from './game/game';
import { INKS, Ink, SPECIAL, react } from './game/inks';
import { LIQUIDS, type LiquidId } from './game/liquids';
import { LEVELS, OrderTracker, forbidText, goalText, orderGame, type Level } from './game/orders';
import {
  DAILY_DROPS, bestKey, dailyKey, dailySeed, dailyStreak, loadProfile, saveProfile, unlockedLiquids,
} from './game/progress';
import { chip } from './ui/chips';
import { renderAtlas } from './ui/atlas';
import { jarGrid, shareText } from './ui/share';
import { Renderer, type UISlot } from './render/renderer';
import { Audio } from './audio/audio';
import { clamp, store } from './core/math';

type State = 'menu' | 'starting' | 'play' | 'pause' | 'over';
type Kind = 'classic' | 'murky' | 'daily' | 'order';
interface Session {
  kind: Kind;
  liquid: LiquidId;
  practice?: boolean; // daily jar replay that is not recorded
  level?: Level;
  dateKey?: string;
}
interface SaveData {
  session: { kind: Kind; liquid: LiquidId; practice?: boolean; dateKey?: string };
  game: ReturnType<Game['serialize']>;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('gl');
const debug = new URLSearchParams(location.search).has('debug');

let renderer: Renderer;
try {
  renderer = new Renderer(canvas);
} catch (e) {
  const d = document.createElement('div');
  d.id = 'fatal';
  d.textContent = 'Nie udało się uruchomić grafiki (WebGL2). ' + (e instanceof Error ? e.message : '');
  document.body.appendChild(d);
  throw e;
}

const audio = new Audio();
audio.setMuted(store.get('atrament.muted', false));
const profile = loadProfile();
saveProfile(profile);

let state: State = 'menu';
let game = new Game('attract', { discovered: profile.discovered });
let session: Session | null = null;
let pending: Session | null = null;
let tracker: OrderTracker | null = null;
let winTimer = -1;
let aiming = false;
let aimPointer = -1;
let keyDir = 0;
let startTimer = 0;
let overTimer = -1;

// ---------------------------------------------------------------- UI helpers
const hud = $('hud');
const scoreEl = $('score');
const bestEl = $('best');
const comboEl = $('combo');
const holdEl = $('hold');
const nextEl = $('next');
const popups = $('popups');
const toast = $('toast');
const goalEl = $('goal');
const screens = {
  menu: $('menu'), how: $('how'), pause: $('pause'), over: $('over'),
  orders: $('orders'), orderIntro: $('orderIntro'), atlas: $('atlas'),
};

function show(name: keyof typeof screens | null) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
}

const WEEKDAYS = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota'];

function refreshMenu() {
  const liq = profile.liquid;
  document.querySelectorAll<HTMLElement>('[data-best]').forEach((el) => {
    const v = profile.best[bestKey(el.dataset.best!, liq)] || 0;
    el.textContent = v ? `rekord ${v}` : '';
  });
  const saved = store.get<SaveData | null>('atrament.save', null);
  const savedOk = !!saved && saved.session && (saved.session.kind !== 'daily' || saved.session.dateKey === dailyKey());
  $('continueBtn').classList.toggle('hidden', !savedOk);
  document.querySelectorAll('.mute-toggle').forEach((b) => (b.textContent = `Dźwięk: ${audio.muted ? 'wył.' : 'wł.'}`));
  // daily
  const now = new Date();
  $('dailyDate').textContent = `${WEEKDAYS[now.getDay()]} ${now.getDate()}.${String(now.getMonth() + 1).padStart(2, '0')}`;
  const today = profile.daily[dailyKey()];
  const streak = dailyStreak(profile);
  $('dailyStatus').textContent = today ? `✓ ${today.score}` : streak ? `seria ${streak} · zagraj` : 'zagraj';
  // orders / atlas
  const stars = LEVELS.reduce((a, l) => a + (profile.orders[l.id]?.stars ?? 0), 0);
  $('ordersStat').textContent = `★ ${stars}/${LEVELS.length * 3}`;
  $('atlasStat').textContent = `${profile.discovered.length}/13`;
  // liquid
  const open = unlockedLiquids(profile);
  if (!open.includes(profile.liquid)) profile.liquid = 'water';
  $('liqName').textContent = LIQUIDS[profile.liquid].name;
  const i = open.indexOf(profile.liquid);
  ($('liqPrev') as HTMLButtonElement).disabled = i <= 0;
  ($('liqNext') as HTMLButtonElement).disabled = i >= open.length - 1;
  $('liquidRow').classList.toggle('hidden', open.length < 2);
}

let lastScore = -1;
function updateHud() {
  if (game.score !== lastScore) {
    scoreEl.textContent = String(game.score);
    if (lastScore >= 0 && game.score > lastScore) {
      scoreEl.classList.add('bump');
      setTimeout(() => scoreEl.classList.remove('bump'), 120);
    }
    lastScore = game.score;
  }
  const s = session;
  if (s?.kind === 'daily') bestEl.textContent = `kropla ${Math.min(game.dropsUsed + (game.current ? 1 : 0), DAILY_DROPS)} / ${DAILY_DROPS}`;
  else if (s?.kind === 'order') bestEl.textContent = `ruch ${game.dropsUsed} / ${s.level!.moves}`;
  else if (s) bestEl.textContent = `rekord ${Math.max(profile.best[bestKey(s.kind, s.liquid)] || 0, game.score)}`;
  if (s?.kind === 'order' && tracker) {
    const pr = tracker.progress(game);
    const fb = forbidText(s.level!);
    goalEl.textContent = `${goalText(s.level!.goal)}${pr.text ? ` · ${pr.text}` : ''}${fb ? ` · ${fb}` : ''}`;
    goalEl.classList.toggle('done', pr.done);
  }
  const c = game.combo;
  comboEl.classList.toggle('on', c >= 2);
  if (c >= 2) comboEl.textContent = `combo ×${c}`;
  holdEl.classList.toggle('used', game.holdUsed);
}

function popup(x: number, y: number, text: string, ink: Ink, big = false, combo = 1) {
  const p = renderer.worldToCss(x, y);
  const el = document.createElement('div');
  el.className = 'pop' + (big ? ' big' : '');
  el.style.left = `${p.x}px`;
  el.style.top = `${p.y}px`;
  el.style.color = ink === Ink.Y ? '#b98a00' : INKS[ink].css;
  el.innerHTML = text + (combo > 1 ? `<small>×${combo}</small>` : '');
  popups.appendChild(el);
  setTimeout(() => el.remove(), 1150);
}

let toastT = 0;
function showToast(html: string) {
  toast.innerHTML = html;
  toast.classList.add('on');
  clearTimeout(toastT);
  toastT = window.setTimeout(() => toast.classList.remove('on'), 2600);
}

function vibrate(p: number | number[]) {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* ignore */
  }
}

let slotCache: { hold: DOMRect; next: DOMRect } | null = null;
function slots(): UISlot[] {
  if (state !== 'play' && state !== 'pause') return [];
  if (!slotCache) slotCache = { hold: holdEl.getBoundingClientRect(), next: nextEl.getBoundingClientRect() };
  const { hold, next } = slotCache;
  return [
    { x: hold.left + hold.width / 2, y: hold.top + hold.height / 2, size: hold.width, piece: game.hold, dim: game.holdUsed },
    { x: next.left + next.width / 2, y: next.top + next.height / 2, size: next.width, piece: game.queue[0] ?? null },
  ];
}

// ---------------------------------------------------------------- rules cheat sheet
const rulesEl = $('rules');
const rulesBtn = $('rulesBtn');
const rulesNow = rulesEl.querySelector('.rules-now') as HTMLElement;
let rulesPinned = false;
let rulesHover = false;
let rulesFor = '';

function rulesOpen() {
  return (rulesPinned || rulesHover) && (state === 'play' || state === 'pause');
}

function updateRules() {
  const open = rulesOpen();
  rulesEl.classList.toggle('hidden', !open);
  rulesBtn.classList.toggle('on', open);
  renderer.hint = open;
  if (!open || !game.current) return;
  const cur = game.current;
  const key = `${cur.ink}:${cur.tier}`;
  if (key === rulesFor) return;
  rulesFor = key;
  const parts: string[] = [];
  for (const other of [Ink.R, Ink.Y, Ink.B, Ink.O, Ink.G, Ink.P]) {
    const res = react(cur.ink, other, cur.tier, TUNING.pearlTier);
    if (!res) continue;
    const label = res.kind === 'black' ? ' wybuch' : res.kind === 'mud' ? ' muł' : '';
    parts.push(`<span>+${chip(other)}→${chip(res.ink)}${label}</span>`);
  }
  rulesNow.innerHTML = `<b>Twoja kropla</b> ${chip(cur.ink, true)} <span>z kroplą tej samej wielkości:</span><div class="row2">${parts.join('') || '<span>nic nie reaguje</span>'}</div>`;
}

rulesBtn.addEventListener('pointerenter', (e) => {
  if (e.pointerType === 'mouse') rulesHover = true;
});
rulesBtn.addEventListener('pointerleave', (e) => {
  if (e.pointerType === 'mouse') rulesHover = false;
});
rulesBtn.addEventListener('click', () => {
  audio.ui();
  rulesPinned = !rulesPinned;
  rulesFor = '';
});

// ---------------------------------------------------------------- game flow
let restoreData: ReturnType<Game['serialize']> | null = null;

function startSession(next: Session, restore: ReturnType<Game['serialize']> | null = null) {
  audio.unlock();
  requestTilt();
  pending = next;
  restoreData = restore;
  show(null);
  hud.classList.remove('hidden');
  goalEl.classList.toggle('hidden', next.kind !== 'order');
  slotCache = null;
  game.clearAll();
  state = 'starting';
  startTimer = 0.75;
}

function buildGame(s: Session): Game {
  const discovered = profile.discovered;
  switch (s.kind) {
    case 'daily': {
      const seed = dailySeed(s.dateKey!);
      return new Game('daily', { seed: seed + 1, pieceSeed: seed, dropLimit: DAILY_DROPS, noLose: true, discovered });
    }
    case 'order':
      return orderGame(s.level!, discovered);
    default:
      return new Game(s.kind, { liquid: s.liquid, discovered });
  }
}

function beginPlay() {
  session = pending!;
  game = restoreData ? Game.restore(restoreData, profile.discovered) : buildGame(session);
  restoreData = null;
  tracker = session.kind === 'order' ? new OrderTracker(session.level!) : null;
  winTimer = -1;
  lastScore = -1;
  state = 'play';
  store.del('atrament.save');
  updateHud();
  if (session.kind === 'order') showToast(goalText(session.level!.goal));
}

function toMenu() {
  if (state === 'play' || state === 'pause') save();
  state = 'menu';
  session = null;
  hud.classList.add('hidden');
  game = new Game('attract', { discovered: profile.discovered });
  show('menu');
  refreshMenu();
}

function pause() {
  if (state !== 'play') return;
  state = 'pause';
  aiming = false;
  save();
  show('pause');
}

function resume() {
  if (state !== 'pause') return;
  state = 'play';
  show(null);
  store.del('atrament.save');
}

function save() {
  saveProfile(profile);
  if (!session || game.mode === 'attract' || game.over || session.kind === 'order') return;
  const data: SaveData = {
    session: { kind: session.kind, liquid: session.liquid, practice: session.practice, dateKey: session.dateKey },
    game: game.serialize(),
  };
  store.set('atrament.save', data);
}

function starsHtml(n: number) {
  return [0, 1, 2].map((i) => (i < n ? '★' : '<span class="off">★</span>')).join('');
}

interface ResultOpts {
  tag: string;
  score: string;
  newBest?: boolean;
  stars?: number;
  stats: string;
  grid?: string;
  primary: [string, () => void];
  secondary?: [string, () => void];
}
let resultPrimary: () => void = () => undefined;
let resultSecondary: () => void = () => undefined;

function showResult(o: ResultOpts) {
  $('overTag').textContent = o.tag;
  $('finalScore').textContent = o.score;
  $('newBest').classList.toggle('hidden', !o.newBest);
  const st = $('stars');
  st.classList.toggle('hidden', o.stars == null);
  if (o.stars != null) st.innerHTML = starsHtml(o.stars);
  $('stats').innerHTML = o.stats;
  const grid = $('grid');
  grid.classList.toggle('hidden', !o.grid);
  grid.textContent = o.grid ?? '';
  $('overPrimary').textContent = o.primary[0];
  resultPrimary = o.primary[1];
  const sec = $('overSecondary');
  sec.classList.toggle('hidden', !o.secondary);
  if (o.secondary) {
    sec.textContent = o.secondary[0];
    resultSecondary = o.secondary[1];
  }
  overTimer = 1.6;
}

const stat = (v: string | number, label: string) => `<span><b>${v}</b>${label}</span>`;

function dailyShareText(key: string, r: { score: number; combo: number; explosions: number; grid: string }) {
  const [y, m, d] = key.split('-');
  return `Atrament · Słój dnia ${d}.${m}.${y}\n${r.score} pkt · combo ×${r.combo} · wybuchy ${r.explosions}\n${r.grid}\n${location.origin}${location.pathname}`;
}

async function doShare(text: string) {
  const res = await shareText(text);
  if (res === 'copied') showToast('Skopiowano wynik do schowka');
  else if (res === 'failed') showToast('Nie udało się udostępnić');
}

function showDailyStored() {
  const key = dailyKey();
  const r = profile.daily[key];
  if (!r) return;
  showResult({
    tag: `słój dnia · ${key.split('-').reverse().slice(0, 2).join('.')}`,
    score: String(r.score),
    stats: stat(`×${r.combo}`, 'combo') + stat(r.explosions, 'wybuchy') + stat(dailyStreak(profile), 'seria dni'),
    grid: r.grid,
    primary: ['Udostępnij', () => void doShare(dailyShareText(key, r))],
    secondary: ['Trening (bez zapisu)', () => startSession({ kind: 'daily', liquid: 'water', practice: true, dateKey: key })],
  });
  overTimer = 0.001;
}

function endSession(won: boolean) {
  const s = session!;
  profile.games++;
  profile.bestCombo = Math.max(profile.bestCombo, game.bestCombo);
  store.del('atrament.save');
  const again = () => startSession({ ...s });
  if (s.kind === 'classic' || s.kind === 'murky') {
    const k = bestKey(s.kind, s.liquid);
    const isBest = game.score > (profile.best[k] || 0) && game.score > 0;
    if (isBest) profile.best[k] = game.score;
    showResult({
      tag: s.liquid === 'water' ? 'słój pełny' : `słój pełny · ${LIQUIDS[s.liquid].name.toLowerCase()}`,
      score: String(game.score),
      newBest: isBest,
      stats: stat(game.dropsUsed, 'kropel') + stat(`×${game.bestCombo}`, 'najlepsze combo') + stat(game.explosions, 'wybuchy'),
      primary: ['Jeszcze raz', again],
    });
  } else if (s.kind === 'daily') {
    const r = { score: game.score, combo: game.bestCombo, explosions: game.explosions, grid: jarGrid(game.drops) };
    if (!s.practice && !profile.daily[s.dateKey!]) profile.daily[s.dateKey!] = r;
    showResult({
      tag: `słój dnia${s.practice ? ' · trening' : ''}`,
      score: String(r.score),
      stats: stat(`×${r.combo}`, 'combo') + stat(r.explosions, 'wybuchy') + stat(dailyStreak(profile), 'seria dni'),
      grid: r.grid,
      primary: s.practice ? ['Jeszcze raz', again] : ['Udostępnij', () => void doShare(dailyShareText(s.dateKey!, r))],
      secondary: s.practice ? undefined : ['Trening (bez zapisu)', () => startSession({ ...s, practice: true })],
    });
  } else if (s.kind === 'order') {
    const l = s.level!;
    const idx = LEVELS.indexOf(l);
    if (won) {
      const stars = tracker!.stars(game.dropsUsed);
      const prev = profile.orders[l.id];
      if (!prev || stars > prev.stars || (stars === prev.stars && game.dropsUsed < prev.moves)) {
        profile.orders[l.id] = { stars: Math.max(stars, prev?.stars ?? 0), moves: Math.min(game.dropsUsed, prev?.moves ?? 999) };
      }
      const next = LEVELS[idx + 1];
      showResult({
        tag: `zlecenie ${idx + 1} wykonane`,
        score: l.name,
        stars,
        stats: stat(`${game.dropsUsed}/${l.moves}`, 'ruchy') + stat(l.par, 'na 3 gwiazdki') + stat(game.score, 'pkt'),
        primary: next ? ['Następne zlecenie', () => openOrder(next)] : ['Lista zleceń', openOrders],
        secondary: ['Powtórz', again],
      });
    } else {
      showResult({
        tag: `zlecenie ${idx + 1} · nie tym razem`,
        score: l.name,
        stats: `<span>${tracker?.failed ?? goalText(l.goal)}</span>`,
        primary: ['Spróbuj ponownie', again],
        secondary: ['Lista zleceń', openOrders],
      });
    }
  }
  saveProfile(profile);
}

// ---------------------------------------------------------------- orders & atlas screens
function openOrders() {
  state = 'menu';
  hud.classList.add('hidden');
  if (game.mode !== 'attract') game = new Game('attract', { discovered: profile.discovered });
  const list = $('orderList');
  const tile = (l: Level, i: number) => {
    const done = profile.orders[l.id];
    const tutorialsDone = LEVELS.filter((x) => x.section === 'nauka' && profile.orders[x.id]).length;
    const firstMaster = l.section === 'mistrz' && LEVELS[i - 1]?.section !== 'mistrz';
    const unlocked = i === 0 || !!profile.orders[LEVELS[i - 1].id] || (firstMaster && tutorialsDone >= 8);
    return `<button class="order-tile${unlocked ? '' : ' locked'}${l.section === 'mistrz' ? ' master' : ''}" data-i="${i}" ${unlocked ? '' : 'disabled'}>
      <span class="n">${i + 1}</span><span class="nm">${l.name}</span>
      <span class="st">${unlocked ? starsHtml(done?.stars ?? 0) : '🔒'}</span></button>`;
  };
  const section = (name: string, key: string) =>
    `<h3 class="order-sec">${name}</h3><div class="order-grid">${LEVELS.map((l, i) => (l.section === key ? tile(l, i) : '')).join('')}</div>`;
  list.innerHTML = section('Nauka', 'nauka') + section('Mistrzowskie', 'mistrz');
  list.querySelectorAll<HTMLButtonElement>('.order-tile').forEach((b) =>
    b.addEventListener('click', () => {
      audio.ui();
      openOrder(LEVELS[+b.dataset.i!]);
    }),
  );
  show('orders');
}

let introLevel: Level | null = null;
function openOrder(l: Level) {
  state = 'menu';
  hud.classList.add('hidden');
  if (game.mode !== 'attract') game = new Game('attract', { discovered: profile.discovered });
  introLevel = l;
  const i = LEVELS.indexOf(l);
  $('oiNum').textContent = `zlecenie ${i + 1} z ${LEVELS.length}${l.liquid ? ` · ${LIQUIDS[l.liquid].name.toLowerCase()}` : ''}${l.murky ? ' · mętna woda' : ''}`;
  $('oiName').textContent = l.name;
  $('oiDesc').textContent = l.desc;
  const fb = forbidText(l);
  $('oiGoal').textContent = `${goalText(l.goal)}${fb ? ` · ${fb}` : ''} · limit ${l.moves} kropel`;
  show('orderIntro');
}

function openAtlas() {
  renderAtlas(profile, { grid: $('atlasGrid'), count: $('atlasCount'), liquids: $('atlasLiquids'), stats: $('atlasStats') });
  show('atlas');
}

// ---------------------------------------------------------------- events from the simulation
function processEvents() {
  const evs = game.events.splice(0);
  renderer.handleEvents(evs, game);
  const live = game.mode !== 'attract';
  for (const e of evs) {
    if (tracker && live) tracker.onEvent(e);
    switch (e.t) {
      case 'release':
        audio.release();
        if (live) profile.drops++;
        break;
      case 'splash':
        audio.plop(e.r);
        break;
      case 'merge':
        audio.merge(e.tier, e.kind, e.combo);
        if (live) profile.created[e.ink] = (profile.created[e.ink] ?? 0) + 1;
        if (game.mode !== 'attract') {
          popup(e.x, e.y + e.r * 0.2, `+${e.points}`, e.ink, e.kind === 'gold' || e.kind === 'opal' || e.kind === 'pearl', e.combo);
          vibrate(e.kind === 'black' ? 18 : 8);
        }
        break;
      case 'explode':
        audio.explode(e.tier);
        if (live) {
          profile.biggestBlast = Math.max(profile.biggestBlast, e.tier);
          if (e.tier >= 4) profile.created[Ink.MERCURY] = (profile.created[Ink.MERCURY] ?? 0) + 1;
        }
        if (game.mode !== 'attract') {
          popup(e.x, e.y, `+${e.points}`, Ink.K, true, e.combo);
          vibrate([30, 40, 60]);
        }
        break;
      case 'impact':
        audio.impact(e.speed);
        break;
      case 'pop':
        audio.bubble();
        break;
      case 'hold':
        audio.ui();
        break;
      case 'discover': {
        if (profile.discovered.includes(e.ink)) break;
        const before = new Set(unlockedLiquids(profile));
        profile.discovered = [...profile.discovered, e.ink];
        saveProfile(profile);
        if (SPECIAL.has(e.ink) || e.ink === Ink.K || e.ink === Ink.M) {
          audio.discover();
          showToast(`${chip(e.ink)} Nowy atrament: <b>${INKS[e.ink].name}</b>`);
        }
        const fresh = unlockedLiquids(profile).find((id) => !before.has(id));
        if (fresh) setTimeout(() => showToast(`Odblokowano ciecz: <b>${LIQUIDS[fresh].name}</b>`), 2800);
        break;
      }
      case 'prism':
        audio.discover();
        if (live) {
          profile.created[Ink.PRISM] = (profile.created[Ink.PRISM] ?? 0) + 1;
          popup(e.x, e.y, `+${e.points} pryzmat`, e.ink, true);
        }
        break;
      case 'swallow':
        audio.impact(4);
        if (live) popup(e.x, e.y, `+${e.points}`, Ink.MERCURY);
        break;
      case 'finish':
        if (session && live) {
          audio.discover();
          endSession(!tracker || (tracker.progress(game).done && !tracker.failed));
        }
        break;
      case 'gameover':
        audio.gameOver();
        vibrate([60, 60, 120]);
        if (session && live) endSession(false);
        break;
    }
  }
  if (game.drops.some((d) => d.ink === Ink.K && d.state === 0)) audio.fuse();
  // orders: goal reached → short celebration, then finish
  if (tracker && state === 'play' && !game.over) {
    if (tracker.failed) {
      winTimer = -1;
      game.finish();
    } else if (winTimer < 0 && tracker.progress(game).done) winTimer = 1.1;
  }
}

// ---------------------------------------------------------------- input
function worldX(clientX: number) {
  return renderer.cssToWorld(clientX, 0).x;
}

canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (state !== 'play') return;
  aiming = true;
  aimPointer = e.pointerId;
  canvas.setPointerCapture?.(e.pointerId);
  game.aim(worldX(e.clientX));
});

canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'mouse') {
    renderer.tilt.tx = clamp((e.clientX / window.innerWidth - 0.5) * 1.2, -0.6, 0.6);
    renderer.tilt.ty = clamp((0.5 - e.clientY / window.innerHeight) * 0.8, -0.4, 0.4);
  }
  if (state !== 'play') return;
  if (aiming && e.pointerId === aimPointer) game.aim(worldX(e.clientX));
  else if (e.pointerType === 'mouse') game.aim(worldX(e.clientX));
});

const endAim = (e: PointerEvent) => {
  if (!aiming || e.pointerId !== aimPointer) return;
  aiming = false;
  if (state === 'play' && e.type === 'pointerup') game.release();
};
canvas.addEventListener('pointerup', endAim);
canvas.addEventListener('pointercancel', endAim);

window.addEventListener('keydown', (e) => {
  if (e.repeat && (e.key === ' ' || e.key === 'Enter')) return;
  if (state === 'play') {
    if (e.key === 'ArrowLeft' || e.key === 'a') keyDir = -1;
    else if (e.key === 'ArrowRight' || e.key === 'd') keyDir = 1;
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 's') {
      game.release();
      e.preventDefault();
    } else if (e.key === 'Shift' || e.key === 'h' || e.key === 'ArrowUp' || e.key === 'w') game.swapHold();
    else if (e.key === 'Escape' || e.key === 'p') pause();
  } else if (state === 'pause' && (e.key === 'Escape' || e.key === 'p')) resume();
});
window.addEventListener('keyup', (e) => {
  if ((e.key === 'ArrowLeft' || e.key === 'a') && keyDir < 0) keyDir = 0;
  if ((e.key === 'ArrowRight' || e.key === 'd') && keyDir > 0) keyDir = 0;
});

holdEl.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  audio.unlock();
  if (state === 'play') game.swapHold();
});
$('pauseBtn').addEventListener('click', () => {
  audio.ui();
  pause();
});

document.querySelectorAll<HTMLButtonElement>('.mode[data-mode]').forEach((b) =>
  b.addEventListener('click', () => {
    audio.unlock();
    audio.ui();
    startSession({ kind: b.dataset.mode as Kind, liquid: profile.liquid });
  }),
);
$('dailyBtn').addEventListener('click', () => {
  audio.unlock();
  audio.ui();
  const key = dailyKey();
  if (profile.daily[key]) showDailyStored();
  else startSession({ kind: 'daily', liquid: 'water', dateKey: key });
});
$('ordersBtn').addEventListener('click', () => {
  audio.unlock();
  audio.ui();
  openOrders();
});
$('atlasBtn').addEventListener('click', () => {
  audio.unlock();
  audio.ui();
  openAtlas();
});
$('oiStart').addEventListener('click', () => {
  audio.ui();
  if (introLevel) startSession({ kind: 'order', liquid: introLevel.liquid ?? 'water', level: introLevel });
});
const cycleLiquid = (dir: number) => {
  const open = unlockedLiquids(profile);
  const i = Math.max(0, open.indexOf(profile.liquid));
  profile.liquid = open[Math.min(open.length - 1, Math.max(0, i + dir))];
  saveProfile(profile);
  audio.ui();
  refreshMenu();
};
$('liqPrev').addEventListener('click', () => cycleLiquid(-1));
$('liqNext').addEventListener('click', () => cycleLiquid(1));
$('continueBtn').addEventListener('click', () => {
  audio.unlock();
  const saved = store.get<SaveData | null>('atrament.save', null);
  if (saved?.session) startSession({ ...saved.session }, saved.game);
});
$('howBtn').addEventListener('click', () => {
  audio.unlock();
  audio.ui();
  show('how');
});
document.querySelectorAll('#how .back, #orders .back, #atlas .back').forEach((b) =>
  b.addEventListener('click', () => {
    audio.ui();
    show('menu');
    refreshMenu();
  }),
);
document.querySelector('#orderIntro .back')!.addEventListener('click', () => {
  audio.ui();
  openOrders();
});
document.querySelectorAll('.mute-toggle').forEach((b) =>
  b.addEventListener('click', () => {
    audio.unlock();
    audio.setMuted(!audio.muted);
    store.set('atrament.muted', audio.muted);
    refreshMenu();
  }),
);
$('resumeBtn').addEventListener('click', () => {
  audio.ui();
  resume();
});
$('restartBtn').addEventListener('click', () => {
  store.del('atrament.save');
  audio.ui();
  if (session) startSession({ ...session, practice: session.kind === 'daily' ? true : session.practice });
});
$('menuBtn').addEventListener('click', () => {
  audio.ui();
  toMenu();
});
$('overPrimary').addEventListener('click', () => {
  audio.ui();
  resultPrimary();
});
$('overSecondary').addEventListener('click', () => {
  audio.ui();
  resultSecondary();
});
$('overMenuBtn').addEventListener('click', () => {
  audio.ui();
  state = 'over';
  toMenu();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});
window.addEventListener('pagehide', save);
window.addEventListener('resize', () => {
  renderer.resize();
  slotCache = null;
});

// device tilt → parallax (iOS needs a permission prompt from a user gesture)
let tiltAsked = false;
function requestTilt() {
  if (tiltAsked) return;
  tiltAsked = true;
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> } | undefined;
  const listen = () =>
    window.addEventListener('deviceorientation', (e) => {
      if (e.gamma == null || e.beta == null) return;
      renderer.tilt.tx = clamp(e.gamma / 35, -1, 1) * 0.6;
      renderer.tilt.ty = clamp((e.beta - 50) / 35, -1, 1) * 0.4;
    });
  if (DOE && typeof DOE.requestPermission === 'function') {
    DOE.requestPermission()
      .then((r) => r === 'granted' && listen())
      .catch(() => undefined);
  } else listen();
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
let fpsAcc = 0;
let fpsN = 0;
const dbg = $('debug');
if (debug) {
  dbg.classList.remove('hidden');
  Object.assign(window, {
    __r: renderer,
    __game: () => game,
    __profile: profile,
    // run frames synchronously (for automated checks while the tab is throttled)
    __tick: (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) tick(dt);
    },
    // start a game (if needed) and drop n drops at pseudo-random positions
    __drive: (n: number, seed = 1, mode: Kind = 'classic') => {
      let s = seed;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      if (state !== 'play') {
        startSession({ kind: mode, liquid: profile.liquid, dateKey: dailyKey() });
        for (let i = 0; i < 60; i++) tick(1 / 60);
      }
      for (let i = 0; i < n; i++) {
        game.aim(0.8 + rnd() * (JAR_W - 1.6));
        for (let k = 0; k < 200 && !game.canRelease(); k++) tick(1 / 60);
        for (let k = 0; k < 6; k++) tick(1 / 60);
        game.release();
        for (let k = 0; k < 10; k++) tick(1 / 60);
      }
    },
  });
}

function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  tick(dt);
}

function tick(dt: number) {
  if (state === 'starting') {
    startTimer -= dt;
    if (startTimer <= 0) beginPlay();
  }
  if (state === 'play' && keyDir) game.aim(game.pip.tx + keyDir * dt * 7);
  const running = state !== 'pause';
  if (running) game.update(dt);
  processEvents();

  if (winTimer > 0 && state === 'play') {
    winTimer -= dt;
    if (winTimer <= 0) game.finish();
  }
  if ((state === 'play' && game.over) || state === 'menu') {
    if (overTimer > 0) {
      overTimer -= dt;
      if (overTimer <= 0) {
        state = 'over';
        hud.classList.add('hidden');
        show('over');
      }
    }
  }

  const aimAlpha = state === 'play' && game.canRelease() ? (aiming ? 1 : 0.6) : 0;
  renderer.render(game, running ? dt : 0, slots(), aimAlpha);
  if (state === 'play' || state === 'pause') updateHud();
  updateRules();

  if (debug) {
    fpsAcc += dt;
    fpsN++;
    if (fpsAcc > 0.5) {
      dbg.textContent = `${Math.round(fpsN / fpsAcc)} fps · ${renderer.rw}×${renderer.rh} · q${renderer.quality.toFixed(2)} · ${game.drops.length} kropel`;
      fpsAcc = 0;
      fpsN = 0;
    }
  }
}

document.fonts?.ready.then(() => renderer.updateLabel());
refreshMenu();
show('menu');
requestAnimationFrame(frame);

// initial aim for the attract pipette
game.aim(JAR_W / 2);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => undefined));
}
