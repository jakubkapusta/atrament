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

import { Game, JAR_W, type Mode } from './game/game';
import { INKS, Ink } from './game/inks';
import { Renderer, type UISlot } from './render/renderer';
import { Audio } from './audio/audio';
import { clamp, store } from './core/math';

type State = 'menu' | 'starting' | 'play' | 'pause' | 'over';

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
let discovered: Ink[] = store.get('atrament.discovered', [] as Ink[]);
const best: Record<string, number> = store.get('atrament.best', { classic: 0, murky: 0 });

let state: State = 'menu';
let game = new Game('attract', undefined, discovered);
let aiming = false;
let aimPointer = -1;
let keyDir = 0;
let startTimer = 0;
let pendingMode: Mode = 'classic';
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
const screens = { menu: $('menu'), how: $('how'), pause: $('pause'), over: $('over') };

function show(name: keyof typeof screens | null) {
  for (const [k, el] of Object.entries(screens)) el.classList.toggle('hidden', k !== name);
}

function refreshMenu() {
  document.querySelectorAll<HTMLElement>('[data-best]').forEach((el) => {
    const v = best[el.dataset.best!] || 0;
    el.textContent = v ? `rekord ${v}` : '';
  });
  const saved = store.get<unknown>('atrament.save', null);
  $('continueBtn').classList.toggle('hidden', !saved);
  document.querySelectorAll('.mute-toggle').forEach((b) => (b.textContent = `Dźwięk: ${audio.muted ? 'wył.' : 'wł.'}`));
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
    bestEl.textContent = `rekord ${Math.max(best[game.mode] || 0, game.score)}`;
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

// ---------------------------------------------------------------- game flow
function startGame(mode: Mode, restore = false) {
  audio.unlock();
  requestTilt();
  pendingMode = mode;
  show(null);
  hud.classList.remove('hidden');
  slotCache = null;
  if (restore) {
    const saved = store.get<ReturnType<Game['serialize']> | null>('atrament.save', null);
    if (saved) {
      game.clearAll();
      state = 'starting';
      startTimer = 0.7;
      restoreData = saved;
      return;
    }
  }
  restoreData = null;
  game.clearAll();
  state = 'starting';
  startTimer = 0.75;
}
let restoreData: ReturnType<Game['serialize']> | null = null;

function beginPlay() {
  game = restoreData ? Game.restore(restoreData, discovered) : new Game(pendingMode, undefined, discovered);
  restoreData = null;
  lastScore = -1;
  state = 'play';
  store.del('atrament.save');
  updateHud();
}

function toMenu() {
  if (state === 'play' || state === 'pause') save();
  state = 'menu';
  hud.classList.add('hidden');
  game = new Game('attract', undefined, discovered);
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
  if (game.mode === 'attract' || game.over) return;
  store.set('atrament.save', game.serialize());
}

function onGameOver() {
  const mode = game.mode;
  const prev = best[mode] || 0;
  const isBest = game.score > prev;
  if (isBest) {
    best[mode] = game.score;
    store.set('atrament.best', best);
  }
  store.del('atrament.save');
  overTimer = 1.8;
  $('finalScore').textContent = String(game.score);
  $('newBest').classList.toggle('hidden', !isBest || game.score === 0);
  $('stats').innerHTML = `<span><b>${game.dropsUsed}</b>kropel</span><span><b>×${game.bestCombo}</b>najlepsze combo</span>`;
}

// ---------------------------------------------------------------- events from the simulation
function processEvents() {
  const evs = game.events.splice(0);
  renderer.handleEvents(evs, game);
  for (const e of evs) {
    switch (e.t) {
      case 'release':
        audio.release();
        break;
      case 'splash':
        audio.plop(e.r);
        break;
      case 'merge':
        audio.merge(e.tier, e.kind, e.combo);
        if (game.mode !== 'attract') {
          popup(e.x, e.y + e.r * 0.2, `+${e.points}`, e.ink, e.kind === 'gold' || e.kind === 'opal' || e.kind === 'pearl', e.combo);
          vibrate(e.kind === 'black' ? 18 : 8);
        }
        break;
      case 'explode':
        audio.explode(e.tier);
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
      case 'discover':
        if (!discovered.includes(e.ink)) {
          discovered = [...discovered, e.ink];
          store.set('atrament.discovered', discovered);
        }
        if (e.ink === Ink.GOLD || e.ink === Ink.OPAL || e.ink === Ink.PEARL) {
          audio.discover();
          showToast(`<i style="background:${INKS[e.ink].css}"></i>Nowy atrament: <b>${INKS[e.ink].name}</b>`);
        }
        break;
      case 'gameover':
        audio.gameOver();
        vibrate([60, 60, 120]);
        onGameOver();
        break;
    }
  }
  if (game.drops.some((d) => d.ink === Ink.K && d.state === 0)) audio.fuse();
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

document.querySelectorAll<HTMLButtonElement>('.mode').forEach((b) =>
  b.addEventListener('click', () => {
    audio.unlock();
    audio.ui();
    startGame(b.dataset.mode as Mode);
  }),
);
$('continueBtn').addEventListener('click', () => {
  audio.unlock();
  const saved = store.get<{ mode: Mode } | null>('atrament.save', null);
  if (saved) startGame(saved.mode, true);
});
$('howBtn').addEventListener('click', () => {
  audio.unlock();
  audio.ui();
  show('how');
});
document.querySelector('#how .back')!.addEventListener('click', () => {
  audio.ui();
  show('menu');
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
  startGame(game.mode === 'attract' ? 'classic' : game.mode);
});
$('menuBtn').addEventListener('click', () => {
  audio.ui();
  toMenu();
});
$('againBtn').addEventListener('click', () => {
  audio.ui();
  startGame(game.mode === 'attract' ? 'classic' : game.mode);
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
    // run frames synchronously (for automated checks while the tab is throttled)
    __tick: (n = 1, dt = 1 / 60) => {
      for (let i = 0; i < n; i++) tick(dt);
    },
    // start a game (if needed) and drop n drops at pseudo-random positions
    __drive: (n: number, seed = 1, mode: Mode = 'classic') => {
      let s = seed;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      if (state !== 'play') {
        startGame(mode);
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

  if (state === 'play' && game.over && overTimer > 0) {
    overTimer -= dt;
    if (overTimer <= 0) {
      state = 'over';
      hud.classList.add('hidden');
      show('over');
    }
  }

  const aimAlpha = state === 'play' && game.canRelease() ? (aiming ? 1 : 0.6) : 0;
  renderer.render(game, running ? dt : 0, slots(), aimAlpha);
  if (state === 'play' || state === 'pause') updateHud();

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
