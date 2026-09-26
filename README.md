# Atrament

A browser puzzle game about drops of ink in a glass jar — *Suika* meets colour mixing,
rendered like macro photography of ink in water. Built for 5-minute sessions on a phone
(portrait, one thumb) and for idle clicking on a laptop.

**Play:** https://jakubkapusta.github.io/atrament/

- Drop ink from a pipette into a backlit jar of water.
- Only drops of the **same size** react: the same colour grows; two primaries make a
  secondary (red + yellow = orange…); a secondary meets its complement → **black**, which
  detonates and clears its surroundings; two different secondaries → **mud**, dead weight.
- Rare inks (gold, opal, pearl, and two hidden ones), a date-seeded **Daily Jar**, 36
  hand-made **orders** (puzzles), unlockable **liquids** (oil, milk, zero-g) and an **Atlas**
  that collects everything you have discovered.

Everything is procedural — no textures or images, sound is synthesised with WebAudio.
The only runtime dependencies are two fonts.

---

## Running

Requires Node 20+.

```bash
npm install
npm run dev        # Vite dev server (http://localhost:5173, or see .claude/launch.json)
npm run build      # type-check + static build into dist/
npm run preview    # serve dist/
```

`vite.config.ts` uses `base: './'`, so the build works from any sub-path. Pushing to `main`
deploys to GitHub Pages via `.github/workflows/deploy.yml`. After the first visit the game
works offline (manifest + a small runtime-caching service worker in `public/sw.js`).

### Controls

| | Phone | Laptop |
|---|---|---|
| Aim | drag anywhere | move the mouse / ← → |
| Drop | release | click / Space |
| Hold (swap) | tap the *hold* dish | Shift / ↑ |
| Colour cheat sheet | tap the colour-wheel button | hover it |
| Pause | ⏸ | Esc / P |

### Tooling (headless, no browser needed)

```bash
npm run sim -- --games 30 --ai greedy              # simulate whole games, report length & stats
npm run sim -- --sweep tierScale=1.2,1.4,1.6       # parameter sweeps over TUNING
npm run sim -- --liquid oil --mode murky -v
npm run orders                                      # replay stored order solutions + difficulty estimate
npm run solve -- --section wprawa                   # beam-search solver for orders
```

Open the game with `?debug` for an FPS/resolution overlay and console hooks
(`__game()`, `__tick(n)`, `__drive(n)`, `__profile`) — handy when the tab is throttled.

---

## Project layout

```
src/
  main.ts              app shell: sessions, screens, input, profile, results, cheat sheet
  core/math.ts         seeded RNG (mulberry32), helpers, safe localStorage
  game/
    inks.ts            ink definitions (Beer–Lambert absorbance) and reaction rules
    game.ts            simulation: PBD physics, reactions, explosions, pipette, bubbles, waves
    liquids.ts         per-liquid physics + look parameters
    orders.ts          puzzle definitions, goals/forbids, OrderTracker
    progress.ts        player profile, daily jar, unlocks
    ai.ts              bots for the simulator (random / greedy / look-ahead)
  gl/gl.ts             tiny WebGL2 wrapper (programs, FBOs, MRT, ping-pong targets)
  render/
    renderer.ts        frame orchestration, world↔screen layout, events → fluid splats
    fluid.ts           GPU stable-fluids solver (the ink smoke)
    shaders.ts         all GLSL
    label.ts           Canvas2D texture for the enamel print on the glass
  audio/audio.ts       synthesised sounds
  ui/                  Atlas screen, colour chips, share text
scripts/               sim.ts, orders-check.ts, orders-solve.ts, gen-icons.mjs
```

`PLAN.md` holds the full design spec, balancing results and implementation notes.

---

## Physics

The simulation (`src/game/game.ts`) is completely independent of rendering, runs at a
**fixed 120 Hz step** with an accumulator and is deterministic for a given input sequence —
which is what makes the headless simulator, the order solver and the Daily Jar possible.

World units: the jar interior is `x ∈ [0, 7.5]`, `y ∈ [0, 11]` (y up), water up to `9.5`,
the MAX line at `8.6`. The physics lives in the jar's central cross-section; the 3-D look is
added by the renderer.

### Drops: position-based dynamics

Every drop is a circle. Each fixed step runs 3 sub-steps of classic PBD:

1. **Integrate** — gravity (strong in air, weak inside the liquid, multiplied by the ink's
   `sink` factor and the liquid's `gravity`), exponential drag `v *= exp(-drag·h)` in the
   liquid, then predict `x += v·h`.
2. **Project constraints** (2 iterations):
   - drop–drop overlap is split by inverse mass `wᵢ = 1/(r²·massᵢ)` (mud is heavy, pearl light);
   - the jar: flat walls and floor plus **rounded bottom corners** (a drop smaller than the
     corner radius is kept inside the corner arc).
3. **Derive velocity** `v = (x − x_prev)/h`, then damp relative tangential velocity at
   contacts (cheap friction).

Entering the liquid is detected per drop (with the current wave height) and triggers a
splash: the drop loses most of its speed, the surface gets an impulse, bubbles and
spray droplets are spawned.

### Soft-body look without soft bodies

Drops stay rigid circles for the solver, but each carries three damped oscillators that the
renderer turns into shape:

- `a0` — radial "breathing" (pops after merges),
- `a2 = (a2x, a2y)` — the 2-lobe squash mode, stored as `(cos 2θ, sin 2θ)` components so it can
  point in any direction,
- `a3` — a 3-lobe wobble.

The rendered radius is `R(θ) = r · (1 + a0 + a2x cos 2θ + a2y sin 2θ + a3x cos 3θ + a3y sin 3θ)`.

Excitation comes from the physics:

- **Impacts** — the approach speed along a new contact normal `n` kicks `a2` along
  `−(nx² − ny², 2nx·ny)`, i.e. the drop flattens against whatever it hit, then jiggles.
- **Static load** — every positional correction is accumulated into a per-drop contact tensor
  normalised by `g·h²` (≈ "how many own weights am I holding up"), low-pass filtered and used
  as the *rest target* of `a2`. Drops at the bottom of a pile visibly squash.
- **Speed** — fast drops stretch along their velocity.

Oscillators use semi-implicit Euler with `ω ∝ 1/√r` (big drops wobble slower) and ~0.17
damping ratio, which reads as jelly.

### Reactions, explosions, rare inks

- After each step, touching pairs (distance < 1.045·(r₁+r₂)) **of the same tier** are checked
  against the reaction table (`inks.ts`). A reacting group is frozen and pulled toward its
  mass-weighted centroid for 0.1 s — long enough for the metaballs to form a visible neck — and
  then replaced by the result drop, which inherits momentum, starts slightly smaller and
  overshoots (`a0`), and is elongated along the merge axis (`a2`).
- A third matching drop within `tripleSlack` joins the group → **gold** (same colour) or
  **prism** (the three primaries). Two drops reacting while both still carry the "blasted"
  flag from an explosion → **opal**.
- **Black** drops burn a fuse (they boil: random `a0/a3` kicks and bubbles), then explode with
  radius `r·2.4 + 0.5`. Drops inside are dissolved **with a delay proportional to distance**,
  so the blast visibly propagates as a wave; a black drop reached by the wave detonates too
  (chain reactions). Drops further out get a radial impulse. Blasts of tier ≥ 4 leave a bead of
  **mercury** behind, which swallows smaller drops.
- Game over: only drops that are **supported** (resting on the floor or another drop, tracked
  per step from contact normals) and nearly still count as being above the MAX line — slowly
  sinking drops in oil or zero-g don't.

### Water surface and bubbles

The surface is an 80-sample 1-D wave equation with damping and a restoring term
(`v += (c²·∇²h − k_d·v − k_s·h)·dt`, Neumann boundaries). Splashes, popping bubbles and
explosions inject impulses. Heights are uploaded every frame into an `R16F` texture that
all water/glass shaders sample for the waterline, meniscus and refraction.

Bubbles rise toward a size-dependent terminal velocity with a wobble, slide around drops (they
are projected out of any drop they enter) and pop at the surface.

### Liquids

A liquid is a parameter set (`liquids.ts`): in-liquid gravity, drag, wave speed, plus
rendering parameters. Water drops fall from the pipette to the floor in ~3.1 s, oil in
~4.7 s, milk in ~4.1 s, zero-g in ~3.8 s (low gravity *and* low drag, so drops drift and
bounce).

### Determinism and the Daily Jar

Two independent RNGs: `prng` generates the drop sequence, `rng` everything else (effects,
bubbles). The Daily Jar seeds `prng` from a hash of the local date, so everybody gets the
same 50 drops regardless of what happens in their jar.

---

## Graphics

WebGL2, HDR (`RGBA16F`) render targets throughout, all procedural. The scene is modelled on
how ink-in-water photos are actually made: **a dark studio, a large diffuse light panel behind
the jar**, the jar on a glossy table. Because the light comes from behind, every colour is
computed as **transmitted light** with Beer–Lambert absorption rather than as surface colour.

### Frame pipeline

| # | Pass | Output |
|---|------|--------|
| 1 | **Background** — warm light panel with a horizontal falloff, dark studio, hexagonal bokeh with stronger parallax, glossy table, backlit "petri dishes" behind the HUD slots | `bg` |
| 2 | **Fluid step** — splats from game events, buoyancy, vorticity, pressure solve, advection | dye / velocity |
| 3 | **Water** — cylinder lens, absorption by ink, turbidity, caustics, light rays, liquid looks (milk, cosmic), aiming guide | `sceneA` |
| 4 | **Motes** — 4096 GPU particles advected by the fluid velocity (dust, or star dust in zero-g) | `sceneA` |
| 5 | **Metaball field** — instanced quads, 4 MRTs, half resolution | `field[0..3]` |
| 6 | **Drop shading** — surface from the field, refraction, Beer–Lambert, Fresnel, materials | `sceneB` |
| 7 | **Bubbles & spray** — refractive spheres | `sceneB` |
| 8 | **Glass** — walls, base, rim, print, meniscus, table reflection & caustics, the pipette | `sceneC` |
| 9 | **Bloom** (6-level down/up chain) and **final** (shock waves, chromatic aberration, ACES, vignette, grain) | screen |

### Ink smoke: GPU stable fluids (`render/fluid.ts`)

A 2-D Navier–Stokes solver over the water region (velocity ~96 px wide, dye ~400 px):
semi-Lagrangian advection, **vorticity confinement** (curl pass + confinement force — this is
what makes the curly, smoky detail), divergence, 18 Jacobi pressure iterations, gradient
subtraction with slightly sticky walls.

- **Dye is absorbance, not colour**: RGB = per-channel absorbance of the ink, A = turbidity.
  The water pass multiplies the light by `exp(−dye·k)`, so overlapping clouds of yellow and
  blue really do turn green, and dense ink darkens instead of saturating (a soft cap
  `2.2·(1 − e^(−d/2.2))` keeps it from going pitch black).
- **Buoyancy**: velocity gets `−k·(dye.r + dye.g + dye.b)` downward — ink is heavier than water,
  so clouds slowly sink and finger.
- **Events → splats** (batched, 24 gaussians per pass): a drop entering the water fires a strong
  downward jet, which rolls up into a **vortex ring** — the classic mushroom of ink photography;
  a merge adds a ring of tangential splats (a swirl) carrying both parents' colours; an explosion
  fires a radial burst and **erases** dye in its radius (in the Murky mode that is the
  mechanic that clears the water); moving drops stir the water and leave faint trails.

### Metaball field (`FIELD_VS/FS`)

Each drop is an instanced quad that writes a compact-support kernel into four `RGBA16F`
render targets with additive blending (half resolution):

```
d = |p − c| / R(θ)                      // R(θ) includes the wobble modes
w = (1 − d²/s²)³   for d < s, s = 1.28  // influence radius in drop radii
iso T = (1 − 1/s²)³                     // so an isolated drop's surface is exactly at d = 1
```

| target | contents |
|---|---|
| 0 | `absorbance·w², w²` — colour, sharply partitioned between touching drops |
| 1 | `w, r·w, gold·w², pearl·w²` — surface field, local radius |
| 2 | `opal·w², fuse·w², flash·w², seed·w²` |
| 3 | `mercury·w², prism·w²` |

Colour is weighted by `w²` while the surface uses `Σw`, so touching drops merge into one
gooey surface but keep crisp colour boundaries. During a merge the colour is **marbled**:
domain-warped fbm, swirled around the centre, splits the drop between the two parent inks and
fades into the result over ~1.2 s.

### Drop shading (`DROPS`)

1. **Height from the field.** Inverting the kernel for a single drop gives
   `d² = s²(1 − ∛f)`, so a sphere-like height is `h = r̄·√(1 − s²(1 − ∛f))` where `r̄` is
   the field-weighted local radius. Applied to the summed field this gives smooth domes that
   blend at necks. Normals come from central differences of `h`.
2. **Refraction** of `sceneA` by `−n.xy·(0.18 + 0.55h)` — what's behind a drop is visibly lensed.
3. **Beer–Lambert** `T = exp(−A·L')` with path length `L = 2h`, compressed as `L/(1 + 0.42L)`
   so big drops stay colourful instead of going black.
4. **Backlit-sphere look**: a bright lens core (`n.z³`), a **dark refraction ring** toward the
   rim (what real backlit droplets look like), a small inner caustic, and light scattered
   inside the ink body.
5. **Fresnel reflection** of a procedural studio: a big key softbox top-left (HDR ≈ 40, drives
   bloom), a strip light on the right, a floor bounce and the backlight at grazing angles.
   Softboxes are evaluated as rectangles in the reflection direction's tangent plane, which
   gives the rectangular window highlights of product photography. Device tilt / mouse moves
   the lights (parallax).
6. **Materials**: gold (liquid metal swirl + glitter), pearl (thin-film iridescence), opal
   (play-of-colour cells), mercury (dark chrome with a reflected horizon and rippling surface),
   prism (dispersion bands through clear glass), and the black fuse (violet energy cracks).
7. Turbidity / ink in front of the drop, milk veil, cosmic rim glow.

### The water and the glass

- **Cylinder lens**: under the waterline the background is sampled horizontally compressed
  toward the axis (`u·(0.8 + 0.14u²)`), above it almost undistorted — so the backdrop visibly
  jumps at the waterline, like looking through a real glass of water. The warm panel's
  horizontal falloff is what makes that magnification readable.
- Caustics from the rippling surface (strongest on the floor), slanted light rays that dim
  where the ink is dense.
- **Perspective without 3-D geometry**: the camera is assumed above the jar looking slightly
  down, so every horizontal circle of the cylinder is drawn as an ellipse whose openness grows
  downward (`ellE(y)`: 0.42 at the floor → 0.2 at the rim). The rim (back and front arcs), the
  water surface band, the MAX line, the wrapped graduation print and the floor all use it.
  The inner floor is seen from above (water and caustics down to its front edge); below it is
  the thick base.
- **Glass**: the walls refract strongly toward the edge (`0.1 + 0.55t²`), pick up a greenish
  tint proportional to the path through the glass, and have a bright inner edge and a dark band;
  thin vertical softbox reflections run down the front; the enamel print is a Canvas2D texture
  mapped by `asin(u)` so it wraps around the cylinder.
- **Table**: a blurred mirror of the jar, a contact shadow and a caustic pool whose colour is
  derived from the jar's contents.
- **Pipette**: an SDF drawn in the glass pass — a tapered glass tube (refraction, highlights,
  ink column with a meniscus), a collar and a backlit rubber bulb that squeezes when a drop is
  released. It hangs from a pivot as a damped pendulum driven by the aim; the drop forming on
  the tip is an ordinary metaball, so it necks into the tube.

### Liquid looks

- **Oil** — amber absorption tint, lazier vorticity, slower ink fade.
- **Milk** — the water pass mixes in an opaque creamy scattering term tinted by the dye
  (pastel swirls); drops sit behind a partial milk veil.
- **Zero-g** — deep indigo absorption plus *emissive* nebulae (fbm), two layers of twinkling
  stars, motes switched to additive star dust, and glowing rims on the drops. Emission instead of
  more absorption, because the drops need light from behind to show their colour.

### Post-processing

Soft-knee bloom threshold (only the softbox highlights, flashes and stars bloom), up to four
concurrent **shock-wave** rings that displace the image and add chromatic aberration, ACES
tone mapping, vignette and film grain.

### Performance

- Rendering resolution is capped by a pixel budget (1.5 MP on touch devices, 3.2 MP on
  desktop) instead of the raw device pixel ratio, and drops further (`quality`) when the
  average frame time exceeds ~24 ms.
- The metaball field and the fluid run at reduced resolution; splats are batched; the physics
  is O(n²) over ≤ ~60 drops, which is negligible.

### Portability notes

- `pow(x, y)` with negative `x` is undefined in GLSL and returns NaN on some Android GPUs
  (it showed up as black rectangles). Shaders use `sq()` / `p6()` helpers or clamp the base.
- Float render targets need `EXT_color_buffer_float` (or the half-float variant); without it
  the renderer falls back to 8-bit targets.
- iOS requires a user gesture before `DeviceOrientationEvent.requestPermission()` — tilt
  parallax is requested when a game starts.

---

## Balancing and puzzle verification

- `scripts/sim.ts` plays thousands of headless games with bots and reports game length,
  score, explosions and rare-ink frequencies; all difficulty knobs live in `TUNING`
  (`game.ts`): drop size, spawn tier weights ramping over the first 160 drops, blast radius,
  danger time, pearl tier, triple-fusion slack.
- Orders come in three sections — *Nauka* (tutorial), *Wprawa* (intermediate), *Mistrzowskie*
  (master). `scripts/orders-solve.ts` is a **beam search over drop positions on the real
  physics** (after each drop it waits until the jar is calm, scores goal progress, keeps the
  best branches); master and intermediate orders store a verified solution. `npm run orders`
  replays them (exits non-zero if physics changes broke one) and estimates difficulty as the
  success rate of a careful random player.

## License

No license has been chosen yet — all rights reserved by the author.
