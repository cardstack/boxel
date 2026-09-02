# Towers — the porting delta

What the source page (`threeui/src/shaders/japanese-tower/Towers.html`,
3,387 lines over three.js r149) can do, against what the film at
`/_towers` asks of it. The vendored copy in `test-app/public/towers.html`
carries the whole page; nothing below was stripped — the gap is in what
the beats _use_.

## The page's atmosphere, in full

| system                  | knobs                                                          | what it does                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **hours** (`THEMES`)    | MORNING · NOON · SUNSET · NIGHT                                | sky gradient (six stops), fog colour and range, ground and grass tint, ridge colours, key light az/el/colour, hemi/ambient/fill/rim, shadow depth, blob, glow, stars, and a full CSS palette for the type |
| **weather** (`WEATHER`) | CLEAR · RAIN · STORM · SNOW                                    | fog pull-in and tint, sun/hemi/ambient scaling, sky and ground tint, star fade, a rain pool (density, fall speed), a snow pool, `wet`, `dust`, an ambience loop per state, lightning (`bolt`)             |
| **blizzard**            | `blizK` on a 41 s cycle (12 calm · 6 build · 15 blow · 8 ease) | fog pulled closer, another bite out of the sun, flakes grown into streaks, more of the pool drawn                                                                                                         |
| **settled snow**        | `snowPack`, banks over 24 s, thaws over 13 s                   | whitens the grass (`uSnow` in the blade shader), dusts tile and plaster but not timber or gilt                                                                                                            |
| **wet ground**          | from `wet`                                                     | terrain roughness down, metalness up, a puddle mesh at 0.72, splash sprites stepped by `wxRain`                                                                                                           |
| **wind on the grass**   | `uWind`, `uWindAmp`, two noise octaves                         | the sway — steady, never gusting; `uWindAmp` is a constant 0.30                                                                                                                                           |
| **lightning**           | `strike()`, `boltK`                                            | a bolt light, the sky material flashed, a screen-blended plane over the frame                                                                                                                             |
| **construction**        | `applyTime(t)`, 0..4.4                                         | a clip plane with a soft cap disc, scaffold groups per stage, a hit per stage (`ping`)                                                                                                                    |
| **six towers**          | `STYLES`                                                       | Japan, China, Vietnam, Thailand, Cambodia, Türkiye — each with its own music, build hit and bell                                                                                                          |

## What the film used before this pass

- Hours: all four (`theme` per beat).
- Weather: CLEAR and RAIN only. STORM and SNOW never. No blizzard, no
  settled snow, no lightning.
- Wet ground: only as a side effect of RAIN on `noki` / `hikaku`.
- Wind: the constant.
- Construction: forward only; the "deconstruction" was an opacity fade.
- Grades: six per-country LUTs that were the same afternoon in six
  tints.

## What was ported in this pass

- **`__film.winter({ pack, gust })`** — settled snow and a pinned
  blizzard on the _shot's_ clock. The page's own timings (24 s to bank,
  41 s per blizzard cycle) are right for a wide shot somebody sits in and
  wrong for a five-second beat that has to read as cold on its first
  frame. `null` hands both back to the weather. `Beat.winter` carries it;
  `settleAir` inherits it across a jump.
- **China snows.** `c-cn`: `wx: 3`, `winter: { gust: 0.55, pack: 0.8 }`.
  `c-vn` returns to `wx: 0`, `winter: null` — the thaw goes with the cut,
  not the page's thirteen seconds.
- **Cambodia at eye level.** The prasat reads from level or below — its
  terraces and redented corners are the point; from above it is a heap.
  Both ends of the move now sit at or under the horizon (pitch −4 → −1).
- **The deconstruction is the build clock run backwards.** `unbuild:
build: [4.4, 0]`; the coda restores `build: 4.4`. The fade it replaces
  turned a multi-part model into an X-ray at forty percent.
- **Six climates in the grade.** China drained to steel with a cool
  split-tone; Vietnam saturated jade and lime, hue toward green; Thailand
  gold in both ends with the vignette nearly gone; Cambodia laterite
  sepia with the corners closed; Türkiye limestone white against İznik
  blue, contrast up.
- **The transport over the picture.** The source runs its track as a
  hairline over the scene; the film's was a solid 76 px band under the
  frame. It is a fade of the chapter's own paper now, pinned to the
  viewport, and the stage owns the whole height.

## Still on the table

- **STORM for the rain chapter.** `noki` / `hikaku` are RAIN (`wx: 1`)
  with `rain: 1.15`. STORM (`wx: 2`) pulls the fog in, takes the sun to
  0.14, doubles the drops and arms lightning — and `__strike()` is
  already on the window. A single bolt on the `hikaku` cut ("six towers,
  one problem") is a cheap, earned punctuation. Needs a `Beat.strike`
  and a `__film.strike()`.
- **Wind as a knob.** `uWindAmp` never moves. A `__film.wind(amp)` and a
  gust on the storm beats (0.30 → 0.6) is ten lines; under the blizzard
  it should track `gust`.
- **Night stars.** `ikkoku` / `ishigaki` are NIGHT (`theme: 3`) with
  `starK: 1` — check they are visible under the grade's vignette.
- **Weather ambience.** `syncWeatherAudio` runs a loop per state (rain,
  storm, wind_snow). With sound on, the snow beat now brings wind under
  the Chinese score — listen for the level against the voice duck.
- **The `-plain` VO variants** on disk are unreferenced.
- **Storm on the Vietnam beat?** Monsoon would be honest; it is the one
  beat with a masonry body that would take the wet well. Left clear so
  the snow's exit reads.

## Cut 10 — a player, a mixer, six climates, and the fork

- **The colour was wrong at the root.** three r149 writes a render target
  in linear light whatever `outputEncoding` says, and the post quad was
  the last thing before the canvas — so the film had been shown in linear
  (dark, saturated) and the grade, written for sRGB pixels like the CSS
  filters it replaced, ran on the wrong numbers: soft-light warmth in
  linear lifts the darks hard, which was the red. The pass converts to
  display space right after the sample now. Proved with a 0.5 grey read
  back as 128, not 188.
- **Weather is a sentence.** Rain stays on the eaves (`noki`), snow on the
  north (`c-cn`), the storm was tried on `hikaku` and pulled: the question
  is asked in plain air. `wx: 2` + `lightning: <secs>` remain in the
  vocabulary for a beat that earns them (`__film.lightning()` fires one
  bolt on cue; the STORM preset throws its own).
- **The mixer.** One `masterBus` under everything, so mute is one switch
  for all of it; a `voiceBus` beside music, hits and weather; per-beat
  trims (`Beat.mix`, `__film.mix`) — the comparison beats run with the
  weather bed off. The narration moved onto the graph: `__film.voice(url,
gain)` plays a decoded buffer with a 70 ms rise, ducks the bed and lifts
  it on the line's end; `voicePrime` fetches the next line a beat early;
  `voiceStop(ms)` fades it; `pause(v)` is the context's own suspend, so a
  paused film holds line, bed and weather together. No library: this is
  the Web Audio API the page already had, with two more GainNodes.
- **The player.** One full-width bar with the chapters as segments, a knob
  computed from the same fractions as the fill over the measured track
  (the old knob used a second, linear formula and drifted inside every
  chapter), SVG transport on the left, modes on the right, the time beside
  the chapter's name, a dark scrim, and the whole thing off the picture
  when idle.
- **No beige start page.** The page's own header, columns, plaque and
  footer painted in full before the 36k-line script reached the bridge
  that hid them. A three-line script in `<head>` stamps
  `html[data-hosted]` before the body parses and a rule hides them on the
  first frame. The canvas, the wash behind it and the reconstruction tag
  stay: they are the picture.
- **The fork.** `public/towers.html` was "vendored, near-verbatim". It is
  a fork now and says so in its header (upstream path and commit); three
  r149 is split out to `public/towers/three-149.js`, so the page is 9k
  lines instead of 36k and a diff against upstream is the page, not the
  library.
- **Tooling trap, recorded:** a backtick anywhere inside a `.gts`
  `<template>` (a CSS comment counts) makes ember-eslint-parser fail with
  "Invalid count value" at 0:0.

## Cut 11 — A/B in the glass

A dissolve between two moving shots without a second renderer. At the cut
the page clones camera A with the velocity it had (the last frame's delta
in position and rotation) and, for the length of the dissolve, renders
the scene for both cameras — A extrapolated, B live — each through the
post pass, mixed by the same uniform the freeze uses. The first frame is
still the graded freeze, so there is no gap; the cost is 2× for half a
second. `__film.dissolve(kind, ms, live)` takes the flag,
`__film.dissolving()` reports `{mix, live, running}`.

The host asks for `live` only when nothing but the lens changes across
the seam. A seam that changes the hour, the weather, the model, the snow
or the mood keeps the still: a live A drawn under B's light is the old
shot dressed wrong. That is the same rule as the still-join snap, from
the other side — the still is A, the live is B, and each must be entirely
itself.

## Cut 12 — the bar learns to listen, and everything pauses

The transport becomes a player: a hover bubble that names the shot under
the hand (chapter and time, two lines), a ghost fill to the pointer, the
hovered chapter standing up, a fader that folds out of the speaker and is
the page's master gain (`__film.volume(v)`, remembered per viewer), the
chapter name as the door into the list, bubbles on every button with the
key that does the same thing, `K` / `F` / `1`–`5` / `0`, a tap on the
picture to pause and two taps for full screen, a centre glyph on each
play/pause, and a cursor that leaves with the controls.

Pause means everything stops. The score's run holds (`run.pause()` via
the region's context), the page's own clock holds (`__film.hold(v)`: the
loop still draws, nothing advances — grass, weather, build, day, lens),
the audio graph suspends, and resume shifts the beat clock by the length
of the hold. The old pause tore the Sequence down and play re-ran the
chapter.

Two bugs the film had carried: the door never turned the score back on
after a restart, so the second viewing stood at its first pose with a
play button that could not help; and every cut applied its head beat
twice — the cut itself and the run's first cue a pass later — so every
join ran twice and a wipe's second snapshot was of a lens that had
already moved. `primedLap` skips the cue's repeat. The wipe's sweep is now
two compositor transforms (a masked sheet slides, the still inside slides
back) instead of an animated mask-position that repainted a full frame
per tick.

Also: a muted begin now mutes the page's own switch (it started on);
captions sit above the bar while it is up; the opening plate starts at
poster size and settles as the push arrives; the title beat is four
ticks; the leader line fades with its caption; the comparison cuts to
clear weather (`wxCut`) and dries; wet ground lingers after rain
otherwise; snow whitens the ground fully; the night has its own grade and
a darker ground; the edict shot wears it; the ending settles a second
before the first tile moves and runs its day out over the first 72% of
the beat; the country beds crossfade over three seconds; the weather bed
ducks under the voice; the demo page's well takes the film's own aspect.

Later the same cut: the narrative goes on every face — the gallery card,
the door, the tile, the deep dive's opening and a director's statement
(`notes/towers-about.md`), the end card — _not a video: a live 3D composite
with motion graphics, interactive chapters, its own mixer, rendered in the
browser at any size; entirely generated with AI, directed by a human_. The
bar's chapters glyph is gone (the chapter name beside the clock is the way
in) and the loop arrow becomes a labelled **Title screen** button with a
title-card glyph. The demo page's well takes the film's aspect and grows a
corner grip: drag to resize within limits, the picture stays centred, a
readout shows the size, double-click or the chip snaps back, and the size
is remembered. A self-starting film (embed, deep link) begins with sound.
The night has both halves of its grade at last — the stylesheet half was
missing, so only the shader darkened — and the page's night lights are
dimmed. The plate's rule mask no longer clips a leaned glyph's left edge.
