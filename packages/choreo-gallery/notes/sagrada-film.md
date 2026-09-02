# The Sagrada film

`/_sagrada` is a second film on the Towers engine (`docs/choreo-splices.md`
for the machinery). The scene is the construction study in
`~/Projects/sagrada-familia`, vendored to `test-app/public/sagrada.html` by
that repo's own build (`node build/build.mjs --lean …`), and the film is
`test-app/app/components/sagrada-film.gts`, a fork of `tower-film.gts`.

## What the bridge adds

With `?host` the page publishes `window.__film` on the Towers surface plus:

- `year(y)`, `tAt(y)`, `yearAt(t)` — the clock in years. `dur` is the
  page's seconds; `present` is 2026.75.
- `pose({ fx, fz })` — a focus on the ground. The scene's camera orbits a
  point; a shot of the Nativity front aims at `fx: 2.05, fz: -0.95`.
- `plan('off'|'ghost'|'full')`, `city('on'|'glass'|'off')`, `shot(name)`
  for the five named close-ups (`shots()` lists them), `focus(x,y,z)`.
- `campaigns()` and `events()` — the record itself, for authoring traces
  and marks against real heights.
- `style()` is honoured and does nothing: one building.

## What the fork changes

- `Cam` carries `fx`/`fz`; they ride the Choreo path as `look.x`/`look.z`
  and the chase as two more keys. `lookY` is world height minus 6.6.
- `build` is in the page's seconds, authored through `tAt(year)`. The
  year table is copied from the scene (`08_layout_timeline.js`); keep
  them in step.
- The glyph slot takes Latin words (`is-latin`), set horizontally in the
  scene's own serif.
- Class prefix `sf-` throughout, so both films' styles can load at once.
- `dolly` is the scene's zoom: 1 frames the whole basilica, so a close-up
  on a finial is 2.5–3.5, not the 0.6–1.6 a Towers shot uses. The lens
  sits 80 units out at every zoom, so a low subject only gets a horizon
  at a pitch near zero; otherwise the frame is a site model from above.
- A `hold` beat aims at half of what stands (the Towers rule) unless it
  names a `to` point, in which case it keeps the aim it was given.
- `city` per beat: 'glass' (default, at `CITY_GLASS` 0.16 through the
  bridge's second argument), 'off' for the close-ups, 'on' for a solid
  model. The page's own 0.30 piles into foam in a long lens.

## The cut

Five chapters: THE SITE (1882–1925), SILENCE (1926–1952), THE LONG BUILD
(1954–2010), THE TOWERS (2016–2026), THE PLAN (2027–). Review with
`?from=N` and `?debug`; the build stamp is `BUILD` in the component.
No narration is recorded yet: `public/sagrada/vo/<id>.mp3` when it is.

Cut 2 (2026-09-02) was the framing pass: every shot re-posed against a
contact sheet of head frames, the frosted city stood back, the sea made
matte at night (a mirror-calm sea threw the moon back as one white
ellipse behind the mountains), the site plinth dimmed in film mode.

## Cut 4 — the cut-11 player, and a LUT in the glass

The Towers quality branch (`towers/quality`, cuts 8–11) was merged and
the fork re-carried onto it: 73 of the 88 hunks applied mechanically
under the rename (`tf-`→`sf-`), the rest were Towers-only beats plus four
real ones done by hand (the awake flag and join tables, the hold rule
with its `'top'` variant, the idle reset on restart, the SVG player bar).
The page's bridge (`build/parts/11_film.js` in the sagrada repo) grew to
the cut-11 surface: the grade and the dissolve in the post pass, live A/B
between two moving shots, the frame budget on the pixel ratio, the idle
gate, the narration on the page's own audio graph (`voice`, `voicePrime`,
`voiceStop`, `mix`, `pause`, `audio`), `themeDur`, `lightning` (the
scene's own bolt). `winter` and `tag` are honoured and do nothing here.

**The LUT.** `__film.lut(spec, instant)` puts a 3D lookup table in the
post pass after the parametric grade: `{look:'sandstone'}` bakes one of
the page's named looks (`build/parts/11a_luts.js`: sandstone, iron,
chalk, ink, plate, slide, neutral) into a 32-point atlas; `{url}` loads
an Adobe/Resolve `.cube` of any size. Two tables live in the shader and a
mix eases from the last to the next (τ 0.55 s); `amount` fades the whole
thing. The looks are also written out as 17-point `.cube` files by
`node build/luts.mjs`, copied to `public/sagrada/luts/` by the lean
build, so a colourist can swap them for stock. In the film every chapter
names its look (`CHAPTERS[].lut`), a beat can override with `lut` (a
name, a `file.cube`, or null), and it rides beside the grade at
`LUT_AMOUNT` 0.7, snapped under a still-join like the mood.

**Weight.** The lean page is 508 KB; three r149 is split out beside it
as `public/sagrada/three-149.js` (608 KB, cached once), the looks are
728 KB of text, the narration 2.8 MB.

## Cut 5 — the lens follows the work

Chris's rule: if a spire is going up in the shot, ZOOM OUT; as you push
in, follow the top that is being built; and draw no line on a thing
until it is finished.

- `Beat.follow`: a campaign id (`'barnabas'`, `'mary'`, `'jesus'`…),
  undefined for the tallest campaign rising, false to leave the pose
  alone. While the followed part is between base and top, the aim rides
  0.58 of the way up what stands and the zoom is capped at
  `7.0 / (top - base + 1)` so base and top both stay in frame; when it
  finishes, the authored pose returns on a 0.9 s one-pole.
- `Beat.buildBy`: the fraction of the beat by which a ranged build is
  finished (apse, Barnabas, Mary, Jesus 0.6; Nativity 0.85; Evangelists
  0.8), so the last part of the beat is on the finished thing.
- Traces and the callout wait for `rising(id).done` (or, unfollowed, for
  nothing to be rising), and their draw-on is timed from that moment.
  The Nativity ring moved to 7.95, the top of Barnabas.
- The bridge grew `rising(id)`, `now()`, `campaigns()` with `k`/`cut`,
  and `dbg()` (the scene graph, for probes).

**The pane cannot show this**: the Choreo clock is starved there even
with `?awake`, and the canvas can hold a stale frame. Check it in a
foreground tab — Barnabas (`?from=4`), Mary (`?from=11`), Jesus
(`?from=14`): the frame should widen as the spire climbs, the aim stay
on the rising top, and the line arrive only after the part is done.

## Cut 6 — the director's pass

Chris's notes, in the order they came, and what each became:

- **Double-check the lines; draw and undraw each.** Every trace was
  re-sampled off the built model through the bridge's `dbg()` scene:
  the apse ring now follows the chapel wall (`ringR`, a radius per
  bearing at y 3.3, centred on the apse's own centre), Barnabas's ring
  sits on his finial (r 0.34 at 7.5 on his own axis), Mary's under the
  star's points (r 0.3 at 10.6), the cross's round the arms (r 0.72 at
  13.4). Lines UNDRAW now — `traceUndraw` lifts the pen back along the
  path — instead of fading.
- **The basilica is tall: zoom out.** Wides at 0.42–0.9, close-ups on the
  detailed places at 3.6–4.5 (`portal`, `portico`, Barnabas, Mary, the
  cross), and every close-up cuts back to a broad drone
  (`*-wide`, dolly 0.55→0.48, 28–36° of yaw, climbing).
- **Decide when the city shows.** Off for the early close-ups (a flat
  landscape), glass for the wides, glass throughout the modern era, nearly
  under (0.08) by night.
- **Night is for the finished building.** Only `centenary`, `street`,
  `aerial-night` and the coda are night; the war is a storm at dusk with
  one bolt, Mary is built by day.
- **The tourist's eye, 0.5×.** `Beat.eye` puts the camera on the pavement
  with a 92–96° lens and walks it while the aim tilts up the tower
  (`tourist` by day, `street` under the floodlights). The bridge's near
  eye sets its own near plane.
- **The camera of the day.** Each beat wears the film of its year
  (`ERAS`): albumen plates, silver gelatin, Agfa, Ektachrome, Kodak Gold,
  early digital, 4K HD with an ACES curve and no grain, the plan as a
  render; `floodlit` for the nights, `vivid` for the finale. Grain,
  vignette, aberration, tone curve and the milk lift ride with the look
  (`LOOK_FX`). The Towers moods are neutralised to a European base.
- **Two showcase drones** at the end (`aerial` at sunset, `aerial-night`),
  pinned to the display's full pixel ratio (`Beat.quality`).
- **The dress.** Cinzel (Trajan's capitals) for the words in the air and
  the kickers, Cormorant Garamond for the lines, gold for the accent.
- **The sea.** From the towers you can see the Mediterranean (3.5 km to
  the south-east, past the Glory front); `mary-wide` and the coda look
  that way in low light so the water carries the sun.
- **No grass**: the sward is hidden under `?host`.

## Cut 7 — the new voice (2026-09-02)

Chris rejected the José Bionada read and chose **Cedric M** from six
auditions (two British, two American, two Castilian; the takes are kept in
`test-app/public/sagrada/vo-audition/`, with a page at its `index.html`).
All seventeen lines re-recorded, `VO_SECS` re-measured, and nine beats
widened a tick — the apse two — so every read still finishes with 1.6 s of
air. `VO_GAIN` recomputed to meet at -28 dB mean.

## Cut 8 — the centenary identity (2026-09-02)

**The information layer is the basilica's own.** The 2026 centenary
identity — heavy grotesque capitals in flat colour on stone paper, a
timeline of coloured dots — replaces the Cinzel/Cormorant museum plate.
Archivo throughout; each chapter carries a colour (`CHAPTERS[].tint`,
`tintD` for a dark frame) written to `--sf-chap` by `wear`, and the
eyebrow, the word, the reading, the rail number, the rule and the dot all
take it. The serif is kept for the caption band, where a sentence is being
spoken rather than displayed.

**Typography for Roman words.** The glyph block was cut for two CJK
characters: it now never wraps and takes its size from the letter count
already on the plane (`--sf-glyphs`), so `Evangelistes` fits where `Obra`
did. The kicker never wraps, the plate's cue column can shrink
(`minmax(0,1fr)`), the cue measure comes off the longest cue, and the
wordmark's tracking animation — which re-wrapped itself mid-animation —
is a `scaleX` instead. Five media queries where there were none: the plate
becomes one column under 860px, the ghost numeral goes, and the settings
move to the foot of the frame.

**One setting at a time, enforced.** A block from the first beat was found
still standing eight beats later. `sweepBlocks` takes any block that is not
the current one and has outstayed the longest hand-off off the glass.

**Every seam is now a GPU seam.** `dip` is the default join (a wipe
announces itself; an architectural record does not want that every eight
seconds) and the dip's freeze lives in the page's render target like the
blend's. Nothing calls `snapshot()` in normal play — that was a
full-resolution `toDataURL` on the frame of every cut.

**Safari.** WebKit opens at a 1.5 pixel-ratio cap and climbs, rather than
opening at 2 and stuttering for twenty seconds before the scaler steps
down; multisampling drops to 2 samples above 1.5×; a quality pin is a
request that yields after three quarters of a second over budget; and the
per-frame `drop-shadow` pair on the moving callout is one tight shadow.

**Colour blends.** The look crossfade is 1.6 s, not 0.55 — a decade's
colour crosses under the shot instead of landing with the cut.

**The lens is slower.** The chaser's stiffness drops from 5.2 to 3.9, so a
shot is still travelling when its last cue lands. The film's biggest images
got a tick back; the holds that said nothing lost one.

**Other.** The fire is at night with the llevantada over it and a new
`ashes` beat for the morning after. The tourist and street shots walk at
eye level and only then tilt (`Beat.lift`). The tower beams are a shader
shaft with a real point light at the cross instead of four additive tubes
that ended in mid-air. The traced apse ring is concentric with the apse.
Every red line draws in and undraws out, the callout included. The music
ends with the film (`__film.outro`). The ending says `1882 —`, not a
completion date, and the credits no longer claim someone else's work.

## Status: the second reference film

This film is committed as the second creative reference for the Choreo
film construct — see `notes/film-construct.md` for what the two films have
in common, what a `<c.Film>` would absorb, and the traps found building
them. `/_sagrada` serves the picture alone: no wall plate, no deep dive.
The notes component is still in the repo for whoever writes the construct;
it is simply not served with the film.

## Cut 10 — on the construct

The film is now cut on `<Film>` (`glimmer-motion/film`): this component is
the shot list, the script with its measured reads, the chapters, the
geometry sampled off the model, the year clock (`tAt`/`yearAt` as a
`FilmClock`), and the front and back matter as named blocks. The engine —
the chased lens, the joins, the type, the voice, the transport — is the
construct's, and its class prefix is `cf-`. See
[film-construct.md](film-construct.md), "Built".
