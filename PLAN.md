# Atrament — plan i stan projektu

Przeglądarkowa gra logiczna (Suika/2048 × mieszanie kolorów atramentu), pionowo na telefon
i myszą na laptopie. Sesje 4–8 min. Priorytet: grafika z efektem „wow” w estetyce
makrofotografii atramentu w wodzie.

Ten plik jest źródłem prawdy dla kolejnych agentów: specyfikacja, architektura, stan, roadmapa.

## Specyfikacja gry (uzgodniona z użytkownikiem)

### Zasady mieszania — reagują tylko krople tego samego rozmiaru (tier)
| Styk (ten sam tier)                          | Wynik                                   |
|----------------------------------------------|-----------------------------------------|
| ten sam kolor                                | ten sam kolor, tier+1                   |
| dwa różne podstawowe (R, Y, B)               | pochodny (O, G, P), tier+1              |
| pochodny + dopełnienie (G+R, O+B, P+Y)       | czarna (K), tier+1 → po lontcie wybucha |
| dwa różne pochodne                           | muł (M), tier+1 — ciężki, nie miesza się|
| podstawowy + sąsiedni pochodny (np. B+G)     | brak reakcji (odbijają się)             |
| K + K                                        | większa K, lont częściowo resetowany    |

- Pojawiają się tylko kolory podstawowe; tiery 0–3 z rampą trudności (`TUNING`).
- Wybuch K usuwa krople w promieniu zależnym od tieru (także muł), fala propaguje się
  (usuwanie z opóźnieniem ∝ odległość), dalsze krople dostają impuls → kaskady.
- Combo: reakcje w odstępie < 1.6 s zwiększają mnożnik.
- Fuzja dwóch kropli tego samego koloru na tierze `TUNING.pearlTier` (4) → Perła.

### Rzadkie atramenty (Atlas barw — 13 pozycji)
- **Złoto** — potrójna fuzja (trzecia kropla w odległości `tripleSlack`). Łączy się z każdą
  kroplą tego samego tieru; wynik ma kolor tamtej kropli, punkty ×3.
- **Opal** — reakcja w locie dwóch kropli odepchniętych wybuchem. Z każdą kroplą swojego
  tieru daje czerń.
- **Perła** — dwie krople tego samego koloru na tierze 4. Lekka; rozpuszcza muł (dowolny tier).
- **Rtęć** (ukryta) — zostaje po wybuchu czerni tieru ≥ 4. Połyka krople swojego tieru lub
  mniejsze (4 ładunki), potem znika.
- **Pryzmat** (ukryty) — R+Y+B tego samego tieru naraz. Dotykając kolorowej kropli
  przemalowuje wszystkie krople jej tieru na jej kolor → masowe fuzje.

### Tryby
| Tryb       | Presja / zasady                                                        | Status |
|------------|------------------------------------------------------------------------|--------|
| Klasyczny  | przegrana, gdy krople *leżące na stosie* są nad MAX > 2.8 s            | ✅     |
| Mętny      | jw. + woda mętnieje z każdą fuzją, wybuch czerni ją czyści             | ✅     |
| Słój dnia  | 50 kropli z seeda daty (`prng` osobny od efektów), bez przegranej,     | ✅     |
|            | 1 oficjalna próba/dzień + trening, seria dni, share: emoji-siatka słoja |        |
| Zlecenia   | 36: Nauka / Wprawa / Mistrzowskie (`src/game/orders.ts`), cel, zakazy, | ✅     |
|            | limit ruchów, gwiazdki; Wprawa od 6 samouczków, Mistrz. od 8 z Wprawy  |        |

### Ciecze (`src/game/liquids.ts`, odblokowanie liczbą odkryć w Atlasie)
Woda (0), Olej (6: grawitacja 0.55, opór 4.2, bursztynowy odcień), Mleko (8: stała mętność,
krople „przed” mlekiem słabiej widać), Nieważkość (10: grawitacja 0.16, mały opór).
Wybór w menu (strzałki), rekordy osobno per ciecz (`bestKey`).

## Architektura

Vite + TypeScript, zero zależności runtime poza fontami (@fontsource). WebGL2, wszystko
proceduralne (brak tekstur/obrazków). Build → `dist/` statyczny, `base: './'`.
Deploy: `.github/workflows/deploy.yml` (GitHub Pages, push na `main`).

```
src/
  main.ts            — bootstrap, pętla, sesje (klasyczna/mętna/dzienna/zlecenie), ekrany,
                       wyniki, profil, zapis/wznowienie, ściąga kolorów
  core/math.ts       — RNG (mulberry32), pomocnicze
  game/inks.ts       — definicje atramentów (absorbancja Beer-Lambert), reguły reakcji
  game/ai.ts         — boty do symulacji balansu (random/greedy/lookahead)
  game/liquids.ts    — parametry cieczy (fizyka + wygląd)
  game/orders.ts     — definicje zleceń, cele, OrderTracker, gwiazdki
  game/progress.ts   — profil gracza (localStorage `atrament.profile`): odkrycia, liczniki,
                       rekordy, historia Słoja dnia, postęp zleceń, wybrana ciecz
  game/game.ts       — fizyka PBD kropli, fuzje, wybuchy, bąbelki, fala powierzchni,
                       pipeta (celowanie), punkty, eventy dla renderera/audio
  gl/gl.ts           — wrapper WebGL2 (programy, FBO, MRT, double-FBO)
  render/shaders.ts  — wszystkie GLSL (tło, woda, pole metaballi, kompozycja kropli,
                       bąbelki, szkło+pipeta+stół, bloom, post)
  render/fluid.ts    — symulacja płynów 2D (stable fluids: adwekcja, wirowość, ciśnienie
                       Jacobi, wyporność barwnika) — dym atramentu
  render/renderer.ts — orkiestracja przebiegów, layout świat↔ekran, mapowanie eventów
                       gry na splaty barwnika/prędkości, fale uderzeniowe
  render/label.ts    — tekstura nadruku na szkle (podziałka ml, MAX, logo) z Canvas2D
  audio/audio.ts     — syntezowane dźwięki WebAudio (plusk, fuzja, wybuch, bąbelki)
  ui/chips.ts        — kolorowe „kropelki” CSS dla atramentów
  ui/atlas.ts        — ekran Atlasu barw (kolekcja, ciecze, rekordy)
  ui/share.ts        — emoji-siatka słoja + Web Share / schowek
```

### Potok renderowania (na klatkę)
1. **bg** → `bgTex`: podświetlony panel (lightbox) za słojem, ciemne studio, bokeh, blat.
   Paralaksa od żyroskopu/myszy.
2. **fluid.step**: splaty z eventów (plusk = pierścień wirowy „grzyb”, fuzja = zawirowanie,
   wybuch = radialny podmuch + czyszczenie barwnika), ślady opadających kropli, wyporność.
3. **water** → `sceneA`: soczewka cylindra (tło powiększone pod wodą, przeskok na linii wody),
   absorpcja barwnika exp(-dye), mętność (kanał A), promienie światła, kaustyki, celownik.
4. **motes** (GPU cząstki adwekowane polem prędkości) → `sceneA` (additive).
5. **field** (instancjonowane quady, MRT, pół rozdzielczości): pole metaballi z modami
   drgań (squash/wobble), marmurkowanie kolorów przy fuzji, materiały specjalne.
6. **drops** → `sceneB`: wysokość z pola → normalne → refrakcja, Beer-Lambert,
   jasny rdzeń soczewki / ciemna obwódka, fresnel, odbicia softboxa, złoto/perła/opal,
   świecenie lontu K, zmętnienie przed kroplami.
7. **bubbles** → `sceneB`: refrakcyjne bąbelki powietrza.
8. **glass** → `sceneC`: ścianki (refrakcja, zielonkawy odcień grubego szkła), pasy odbić,
   nadruk podziałki, linia MAX, rant, gruba podstawa, menisk z falą, odbicie w blacie,
   kolorowa kaustyka na stole, pipeta (szkło, atrament w rurce, gumowa gruszka).
9. **bloom** (łańcuch mip), **final**: fale uderzeniowe, aberracja chromatyczna, ACES,
   winieta, ziarno.

### Jednostki
Świat gry: wnętrze słoja x∈[0, 7.5], y∈[0, 11] (y w górę), woda do 9.5, linia MAX 8.6.
Fizyka: stały krok 1/120 s, 3 podkroki, PBD. Płyn: domena = obszar wody.

## Stan (v0.2)
- [x] Rdzeń: fizyka, reguły, fuzje, wybuchy, kaskady, combo, 5 rzadkich atramentów
- [x] Tryby Klasyczny, Mętny, Słój dnia, Zlecenia; ciecze; Atlas barw; profil i rekordy
- [x] Ściąga kolorów w grze (przycisk z kołem barw: hover na desktopie, tap na telefonie);
      gdy otwarta, krople reagujące z bieżącą pulsują
- [x] Pełny potok graficzny, dźwięk, haptyka (Android), pauza, zapis/wznowienie
- [x] Tryb „attract” w menu, PWA offline
- [x] Detale: rozbryzgi, fala powierzchni, menisk, bąbelki, pył w wodzie, kaustyki,
  promienie światła, odbicie w blacie, paralaksa, wahadłowa pipeta, nadruk podziałki

## Balans i symulacja (`npm run sim`)
Parametry trudności są w `TUNING` (`src/game/game.ts`), boty w `src/game/ai.ts`,
skrypt w `scripts/sim.ts` (bez UI, stały krok fizyki, bot „myśli” `--think` s na kroplę).
```
npm run sim -- --games 30 --ai greedy          # random | greedy | lookahead (wolny, najsilniejszy)
npm run sim -- --sweep tierScale=1.2,1.4,1.6
npm run sim -- --sweep 'late=15,30,35,20;10,25,35,30'   # ; gdy wartości mają przecinki
npm run sim -- --blastK 2.2 --rampDrops 140 --mode murky -v
```
Wyniki dla obecnych ustawień (think 1.0 s ≈ 1.75 s/kroplę, tryb klasyczny):
| bot       | mediana | p10–p90     | wybuchy/grę | złoto | opal | perła |
|-----------|---------|-------------|-------------|-------|------|-------|
| random    | ~3:30   | 2:06–5:27   | 8           | 0.3   | 0.1  | –     |
| greedy    | ~5–7:00 | 3:45–14:00  | 21          | 1.0   | 0.9  | 2.2   |
| lookahead | ~9:00   | 4:40–14:30  | 28          | –     | 0.3  | –     |
Wnioski z pierwszych pomiarów: przy pierwotnych ustawieniach (krople 1.0×, stały rozkład
tierów 0–2, duży promień wybuchu) nawet bot losowy nie przegrywał (limit 900 kropel).
Dlatego: krople 1.4× większe, rampa trudności (spawn tierów 0–3 przesuwa się w stronę
dużych przez 160 kropel), mniejszy promień wybuchu, luźniejsze warunki złota/perły.

## Zlecenia — projektowanie i weryfikacja
- **Nauka** (1–12): każdy poziom uczy jednej reguły — celowo łatwe (losowy gracz 30–90%).
- **Wprawa** (13–24): łączą dwie idee, lekkie ograniczenia, ciecze. Losowy gracz 15–40%.
- **Mistrzowskie** (25–36): nowe cele (`empty`, `have`, `combo`), zakazy (`forbid: mud/explode`
  → natychmiastowa porażka), ciasne układy startowe (`setup` z opcjonalnym `y`).
  Kryterium: istnieje rozwiązanie (`solution`), a *ostrożny losowy gracz* (czeka na spokój
  w słoju, rzuca w losowe miejsce) wygrywa w ≤ ~13% prób (obecnie 0.7–13%).
- `npm run solve -- --level <id> | --section wprawa [--beam 20 --cands 21 --random 800]` — beam search na
  prawdziwej fizyce (po każdej kropli czeka na spokój, ocenia `OrderTracker.value`), a gdy
  nie znajdzie, bierze najkrótszą udaną ścieżkę z prób losowych. Wypisuje `solution` (3 miejsca
  po przecinku — fizyka jest chaotyczna, zaokrąglenie do 2 psuje odtworzenie).
- `npm run orders` — odtwarza zapisane rozwiązania (exit 1, gdy któreś nie działa) i liczy
  odsetek losowych sukcesów. **Po każdej zmianie fizyki/reguł/TUNING uruchom i w razie
  potrzeby przelicz rozwiązania.** `par` (3 gwiazdki) ≈ długość rozwiązania solvera.
- Układ startowy musi składać się z kropli, które ze sobą nie reagują.

## Roadmapa (kolejność)
1. Strojenie balansu po testach na telefonie (symulator powyżej).
2. Rotacja „zlecenia dnia” (losowy poziom mistrzowski z modyfikatorem), kolejne zlecenia.
3. Osiągnięcia w Atlasie (kaskada ×5, pusty słój, 3 wybuchy naraz…).
4. Obrazek do udostępniania (render słoja do canvas → plik PNG w Web Share).
5. Wydajność na słabszych telefonach (niższa rozdzielczość płynu, mniej kroków ciśnienia).

## Uruchamianie
```
npm install
npm run dev      # http://localhost:5194 (patrz .claude/launch.json) lub vite domyślnie
npm run build    # dist/
```
Debug: `?debug` w URL pokazuje FPS i skalę renderowania oraz wystawia na `window`:
`__r` (Renderer), `__game()` (bieżąca gra), `__profile`, `__drive(n, seed, kind)` (start sesji
i n kropel w losowe miejsca), `__tick(n, dt)` — synchroniczne klatki
(przydatne do automatycznych testów, gdy karta jest w tle i rAF jest wstrzymany).
Przykład scenariusza: `__game().makeDrop(Ink, tier, x, y)` + `drops.push(...)` + `__tick(100)`.

## Notatki techniczne / pułapki
- Kolory kropli to absorbancja (Beer-Lambert), nie RGB — scena jest podświetlona od tyłu
  (lightbox), więc wszystko, co ma być widać „w atramencie”, musi mieć jasne tło za sobą.
  Dlatego sloty HUD (zapas/dalej) mają podświetlone szalki Petriego rysowane w shaderze tła.
- Pole metaballi: kolor ważony w², powierzchnia z sumy w; wysokość odzyskiwana z pola
  (odwrócenie falloffu) → normalne. `FIELD_S` steruje grubością „szyjek” między kroplami.
- Płyn: prędkość w texelach siatki/s; splaty są batchowane (24 na przebieg).
- **GLSL na Androidzie**: `pow(x, y)` z ujemnym `x` daje NaN (czarne prostokąty) —
  używaj `sq()`/`p6()` z COMMON albo `max(x, 0.0)`. Nie nazywaj zmiennych `sq`.
- W GLSL odwrócone argumenty `smoothstep(a, b, x)` z a > b są formalnie niezdefiniowane,
  ale używane w wielu miejscach i działają na ANGLE/Adreno/Mali — przy dziwnych artefaktach
  na nowym GPU sprawdź to w pierwszej kolejności.
- Materiały specjalne kropli idą przez 4 bufory MRT pola (`uF0..uF3`) i atrybuty instancji
  `iF` (złoto, perła, opal, lont) i `iG` (rtęć, pryzmat).
- Wydajność: budżet pikseli 1.5 MP (dotyk) / 3.2 MP (desktop), auto-obniżanie `quality`,
  gdy średnia klatka > 24 ms.
