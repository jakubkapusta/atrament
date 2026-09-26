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

- Pojawiają się tylko kolory podstawowe, tiery 0–2.
- Wybuch K usuwa krople w promieniu zależnym od tieru (także muł), fala propaguje się
  (usuwanie z opóźnieniem ∝ odległość), dalsze krople dostają impuls → kaskady.
- Combo: reakcje w odstępie < 1.6 s zwiększają mnożnik.
- Fuzja dwóch kropli max tieru → Perła.

### Rzadkie atramenty (Atlas barw)
- **Złoto** — potrójna fuzja (3 krople tego samego koloru i tieru w kontakcie naraz).
  Łączy się z każdą kroplą tego samego tieru; wynik ma kolor tamtej kropli, punkty ×3.
- **Opal** — reakcja w locie dwóch kropli odepchniętych wybuchem. Dżoker: z każdą kroplą
  tego samego tieru daje czarną (bombę).
- **Perła** — fuzja na max tierze. Lekka; dotykając mułu (dowolny tier) rozpuszcza go
  (perła traci tier).
- Plan: kilka ukrytych atramentów + rekordy („kaskada ×5”) w Atlasie.

### Tryby
| Tryb       | Presja                                                        | Status |
|------------|---------------------------------------------------------------|--------|
| Klasyczny  | przegrana po przepełnieniu (krople nad linią MAX > 2.8 s)     | ✅     |
| Mętny      | jw. + woda mętnieje z każdą fuzją, wybuch czerni ją czyści    | ✅     |
| Słój dnia  | stałe 50 kropli (seed z daty), bez przegranej, wynik do share | ⏳     |
| Zlecenia   | gotowy układ + cel („duży fiolet w 15 ruchach”)               | ⏳     |

### Ciecze do odblokowania (⏳)
Woda (domyślna), olej (lepki, wolny), mleko (słaba widoczność), nieważkość — zmieniają
parametry fizyki (`gravityWater`, `drag`) i shader wody.

## Architektura

Vite + TypeScript, zero zależności runtime poza fontami (@fontsource). WebGL2, wszystko
proceduralne (brak tekstur/obrazków). Build → `dist/` statyczny, `base: './'`.
Deploy: `.github/workflows/deploy.yml` (GitHub Pages, push na `main`).

```
src/
  main.ts            — bootstrap, pętla, stany (menu/attract, gra, pauza, koniec), zapis stanu
  core/math.ts       — RNG (mulberry32), pomocnicze
  game/inks.ts       — definicje atramentów (absorbancja Beer-Lambert), reguły reakcji
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
  ui/hud.ts          — DOM: wynik, combo, sloty „następna/zapas”, ekrany, popupy
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

## Stan (v0.1)
- [x] Rdzeń: fizyka, reguły, fuzje, wybuchy, kaskady, combo, złoto/opal/perła
- [x] Tryby Klasyczny i Mętny, ekran końca gry, rekordy (localStorage)
- [x] Pełny potok graficzny (powyżej), dźwięk, haptyka (Android), pauza, zapis/wznowienie
- [x] Tryb „attract” w menu (AI wrzuca krople w tle)
- [x] PWA: manifest + service worker (runtime cache) → działa offline po 1. wizycie

## Roadmapa (kolejność)
1. Strojenie balansu (rozkład tierów, promienie wybuchu, punkty) po testach na telefonie.
2. **Słój dnia**: seed = data (YYYY-MM-DD), 50 kropli, wynik + udostępnianie
   (miniatura słoja → canvas → Web Share API / schowek).
3. **Atlas barw**: ekran kolekcji (odkryte atramenty już zapisywane w `atrament.discovered`),
   ukryte atramenty, osiągnięcia.
4. **Zlecenia**: format poziomu JSON (układ startowy, kolejka, cel, limit ruchów).
5. **Ciecze**: parametry fizyki + warianty shadera wody; odblokowanie z Atlasu.
6. Wydajność: auto-skalowanie jakości już jest (renderScale); ewentualnie niższa
   rozdzielczość płynu na słabych GPU.

## Uruchamianie
```
npm install
npm run dev      # http://localhost:5194 (patrz .claude/launch.json) lub vite domyślnie
npm run build    # dist/
```
Debug: `?debug` w URL pokazuje FPS i skalę renderowania.
