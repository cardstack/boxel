# Toward `<c.Film>` — the two reference films

## The reference is Final Cut Pro, programmable by an agent and tweakable

## by the person watching

`<c.Film>` is not a renderer with a configuration file. The model is an
editor: a timeline, and components dropped onto it. Two things follow from
that, and they are the whole design.

**A component may exist to do exactly one thing.** There is no obligation
to generalise. "Walk up the street at eye level and then put your head
back" is a shot that appears twice in one film and may never appear again,
and writing a small program that does only that is the correct answer. The
mistake is not the special case; the mistake is the special case with no
handles on it.

**Every component publishes its variables.** This is the After Effects
rule: the effect does something specific, and its controls sit in a panel
where a person can drag them. A component that hard-codes the walk's pace
is a component nobody can direct. A component that exposes the pace, the
lens and the moment the head goes back can be redirected by a person in a
panel or by an agent writing a value — and those are the same act.

So the construct set is of two kinds, and both are first class:

- **data-driven** — the component takes a table and renders it. The shot
  list, the chapter timeline, the captions: these are the JSON in the
  realm, and an agent edits them by editing data.
- **one-task programs** — the component is a piece of directed behaviour
  with a parameter surface. The walk-and-look-up, the follow rule, the
  trace that draws itself along an eave: these are code, and an agent
  edits them by setting exposed values.

What makes both agent-programmable is the same property: the parameters
are declared, not implied. A component should be able to say what it takes
— name, type, range, default, and what the value MEANS — so a panel can be
generated from it and an agent can discover it without reading the source.

### A one-task component, with its handles

The ground-level shot as it exists in this film, and what it would publish:

| variable                    | now                                  | what it means                                                    | range        |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------- | ------------ |
| `eye.at` → `eye.to`         | [6.0, 0.16, 0.6] → [4.8, 0.16, −0.2] | where the walk starts and ends                                   | world points |
| `eye.fov`                   | 96°                                  | the lens; 96 is a phone's 0.5×                                   | 60–110       |
| `lift`                      | 0.55                                 | the fraction of the shot spent walking before the head goes back | 0–0.9        |
| `cam.lookY` → `toCam.lookY` | −4.9 → 7.4                           | the aim, eye level to finial                                     | world height |
| `bob`                       | 0.5                                  | how much hand is in it                                           | 0–1.5        |

Five numbers, one of which (`lift`) is the whole idea. A person drags it
and the shot becomes a stroll or a double-take. An agent writes 0.7 and
gets the same. Neither has to know how the tilt is separated from the walk.

### A data-driven component, same shape

The chapter timeline takes a span, a set of marks and a playhead. It does
not know what a chapter is:

| variable | now                                  | what it means            |
| -------- | ------------------------------------ | ------------------------ |
| span     | 1882 → 2034                          | the ends of the rule     |
| marks    | five chapters at their opening years | a value and a label each |
| head     | the film's clock, mapped to a year   | where the marker sits    |
| tint     | one red                              | the accent               |

Note what is NOT a parameter: the fact that the marks are chapters, or
that the value is a year. Feed it construction phases in months and it is
the same component.

There are now two films built on the same engine, by hand, in full:

- `test-app/app/components/tower-film.gts` — Tenshu, the first
- `test-app/app/components/sagrada-film.gts` — Sagrada Família, the second

They are the reference material for a Choreo film construct. Neither is a
demo of a construct that exists; both are the long way round, done twice,
which is the only honest way to find out what the construct has to be.
Sagrada is served at `/_sagrada` **without a wall plate**: it is a film, not
an exhibit, and a film that arrives with its own commentary attached is
asking to be read rather than watched.

## What the duplication says

Normalise the class prefixes and diff the two components:

| measure                       | lines |
| ----------------------------- | ----- |
| tower-film.gts                | 7,378 |
| sagrada-film.gts              | 9,077 |
| identical after normalisation | 6,218 |

That is 69% of the second film already written in the first. The
duplication is the construct, and it is the ceiling on what a construct
removes.

Where those lines sit in the second film:

| bucket                                                                | lines | fate                                        |
| --------------------------------------------------------------------- | ----- | ------------------------------------------- |
| machinery: clock, joins, voice, transport, camera chaser, type timing | 4,554 | nearly all of it moves                      |
| stylesheet                                                            | 2,552 | the chrome moves, the identity stays        |
| template markup                                                       | 828   | player, gate, end card, menu, overlays move |
| beat table (the shot list)                                            | 1,143 | stays — it IS the film                      |

Expect roughly 2,900 lines left per film: the shot list, the identity
stylesheet, and the bridge to whatever draws the picture.

The 69% flatters the stylesheet. The two films share CSS today because the
second was forked from the first, and its identity has since been pulled
apart (Sagrada wears the basilica's own 2026 centenary identity — heavy
grotesque capitals, one red, a timeline of dots). What is genuinely
generic there is the chrome, not the type design.

## What the construct must expose

The machinery is not the risky part. Joins, the voice fitting, the
transport, the gate and the end card are the same objects in both films and
have been stable across nine cuts.

The DIRECTOR'S RULES below are the one-task components. They were written
for one shot each and there is no reason to generalise them — only to give
each one its handles, in the sense above:

- **the follow rule** — while a campaign is rising, aim at the part of it
  that is being built and cap the zoom to it (`followRise`)
- **walk before you tilt** (`Beat.lift`) — a ground-level shot finishes its
  approach at eye level and only then puts the head back
- **the build-by fraction** (`Beat.buildBy`) — the model finishes rising
  before the shot ends, so the last third is a held building
- **the trace gate** — no annotation on a thing still going up
- **the fit rule** — a beat is at least the measured read plus 1.6 s of air
  (`VO_SECS`, measured with ffprobe, never estimated)

And the seams: `dip` is the default join, and its freeze — like the
blend's and the melt's — lives in the page's render target. Nothing reads
the canvas back during play. A construct that reintroduces a `toDataURL`
per cut will be slower than either of these films.

## Traps found the hard way

1. **Element identity across a keyed re-render.** A type block from the
   first beat was found still on screen eight beats later, three chapters
   overprinting each other. Whatever the construct does for enter and
   leave, it needs a guarantee — and a way to see the guarantee fail.
2. **One clock or nothing.** Both films are a pure function of a single
   clock, which is why a beat can be widened and the type, the voice, the
   transport and the year readout all re-time together. It is the property
   worth preserving; the library is one way to get it.
3. **The picture must be behind a block.** The scene here is a separate
   WebGL page in an iframe, addressed through about a hundred plain calls.
   A construct that assumes three.js in the same document buys the first
   film and loses the third.

## Reviewing a film's typography

`/sagrada/type-harness.html?s=0..5` renders the component's own `<style>`
block against representative settings over light and dark grounds. It
exists because a film needs a foreground tab to run its clock, and neither
a preview pane nor a background tab is one — so the layout could not
otherwise be looked at. It found three faults nothing else did: block
measures written in `ch` are measured against the interface font, the year
numeral collided with the start of its own scale, and the caption band ate
the last cue of a centred plate.

## The information layer is the construct set

Everything the film puts on the picture that carries a FACT should be a
Choreo construct, not markup and a stylesheet. There are nine of them in
this film, and each one is the same shape underneath: a value, a time
source, and an anchor — a corner of the frame or a point in the world.
They are listed here with where they currently live, so they can be cut
out rather than reinvented.

| construct           | what it carries                                                   | anchor                  | now at (sagrada-film.gts) |
| ------------------- | ----------------------------------------------------------------- | ----------------------- | ------------------------- |
| the plate           | eyebrow, word, reading, gloss                                     | a corner, five modes    | template 5812, css 7315   |
| the cues            | up to four phrases, paced against the measured read               | inside the plate        | template 5861, css 7440   |
| the timeline        | the span 1882–2034, the chapters at their own years, the playhead | top corner              | template 6067, css 7833   |
| the numeral         | the chapter, enormous and nearly out of ink                       | behind the plate        | template 5799, css 7648   |
| the stamp           | the year the voice is saying, in the scene, behind the building   | a world bearing         | film.sky at 4563          |
| the word in the air | the chapter's name, standing in the place                         | a world bearing         | film.sky at 4035          |
| the trace           | a polyline ON the building that draws and undraws                 | world coordinates       | traceDraw/Undraw at 4492  |
| the callout         | a leader and a ring on a named point                              | a projected world point | template 5779, css 7046   |
| the captions        | the line being spoken                                             | the foot of the frame   | template 6050, css 7776   |
| the insert          | a photograph with its own caption and credit                      | a corner                | template 6020, css 7713   |

Three things they share, and the construct has to give all three:

1. **A value and a time**, never a duration. Every one of these is a pure
   function of the film's clock: the cues land against the MEASURED read
   (`VO_SECS`), the stamp lands at the fraction of the read where the voice
   says the year, the trace waits until the thing it annotates is finished
   rising. Nothing here is a timeout.
2. **An anchor that may be in the world.** Four of the ten are placed by a
   bearing or a projected point rather than by a corner, and that is what
   stops them reading as stickers: the building crosses in front of the
   stamp, the leader moves with the finial it points at. A construct that
   only anchors to the viewport buys half of them.
3. **Draw in, draw out.** Every line arrives as a stroke and leaves as
   one, in the order it arrived and out in reverse. A construct that offers
   only opacity will be worked around on the first film that uses it.

The per-frame writers are worth keeping as the pattern: the film writes
custom properties (`--sf-yearp`, `--sf-type-a`, `--sf-stamp-a`, the lean
and the rake) and CSS does the rest, so nothing in the information layer
re-renders on the clock.

---

# Next phase: the primitive Choreo is missing

Everything above is inventory. This part is the proposal, and it comes out
of a specific failure: of the ten infographics in this film, Choreo drives
one — the type plate. The other nine are CSS keyframes and per-frame
property writes, and two of them (the year timeline, the announced year)
were written that way TODAY, by me, in an animation repo, while designing
this. That is worth being exact about, because the reason is not
discipline.

## What the existing vocabulary cannot say

Choreo's unit is a sprite that enters or leaves, and a tween with a
duration. The nine that fell outside it all fail the same way:

- **the announced year** has no duration. It rises at the fraction of the
  MEASURED read where the voice says the date, holds for the phrase, and
  goes. Today:

  ```
  const read = VO_SECS[beat.id] ?? secs * 0.66;
  const t0 = (read * (st.at ?? 0.06) + this.typeAt[0]) / secs;
  const inK = clamp((local - t0) / rise), outK = clamp((local - t0 - rise - hold) / fall);
  return smooth(inK) * (1 - smooth(outK));
  ```

- **the year timeline** is a value, not an animation: `p = (year − 1882) /
(2034 − 1882)`, written to a custom property every frame, with CSS doing
  the rest.
- **the callout** is anchored to a point in the world, re-projected every
  frame as the camera moves; a tween cannot hold a moving endpoint.
- **the traces** draw along a path and undraw back along it, and only
  after the thing they annotate has finished rising.

Three missing ideas, then: a value that is a function of the clock, an
anchor that lives in the world, and a stroke that draws rather than fades.

## The primitive: a value bound to the clock

```hbs
<Choreo as |n|>
  <n.Value @name='yearp' @at={{this.year}} @from={{1882}} @to={{2034}} />
</Choreo>
```

`n.Value` declares a named number derived from the film's clock and
publishes it — as a CSS custom property by default, so the browser does
the work and nothing re-renders per frame. That is not a compromise; it is
the pattern that already works in this film, and it is why the information
layer costs nothing while the picture is drawing.

The rule that makes it a primitive rather than a helper: **a value is a
pure function of t.** Ask it for t and it answers; it never accumulates,
never fires on insertion, never has a duration. Everything follows from
that, and so does the acceptance test below.

Three composable specialisations, each of which exists in this film as
hand-written code:

**`n.Cue`** — an envelope against a measured read rather than a duration.

```hbs
<n.Cue
  @name='stamp'
  @read={{this.read}}
  @at={{0.03}}
  @rise={{0.9}}
  @hold={{2.6}}
  @fall={{1.1}}
/>
```

`@read` is the measured seconds of the line, `@at` where in it the fact is
spoken. This is the whole of `stampAt` and `sayAt`, and it is the piece
that keeps the type honest against the voice: beats are already cut to the
measured read plus air, and this is the same fact expressed forward.

**`n.Anchor`** — a world point, projected every frame.

```hbs
<n.Anchor @name='finial' @at={{array 0 13.4 -0.95}} as |p|>
  <line x1={{p.fromX}} y1={{p.fromY}} x2={{p.x}} y2={{p.y}} />
</n.Anchor>
```

The film hands `<c.Film>` a projector — `project(x, y, z) → {x, y, on}` —
and nothing in Choreo knows what draws the picture. This is the piece that
keeps the third film from being locked into three.js in an iframe, and it
is what turns four of the ten infographics from stickers into things
standing in the place.

**`n.Stroke`** — draw-in and draw-out along a path.

```hbs
<n.Stroke
  @of='apse-wall'
  @draw={{n.value 'traceIn'}}
  @undraw={{n.value 'traceOut'}}
/>
```

Two progresses, not one, because the pen lifts back along the path it
drew, first line first. Opacity is not an acceptable substitute and every
film will work around it.

And one gate, because annotation has a precondition:

```hbs
<n.Gate @when={{this.apseFinished}} as |ok|> … </n.Gate>
```

## The acceptance test

**Scrub to any t and the frame must be correct.** Not "the animation
replays" — correct. This is the Final Cut Pro requirement stated as an
engineering test, and it is the reason the primitive is a function of t
rather than a thing that starts.

By that test, today: the type plate passes, the values I hand-rolled pass
because they are already functions of t, and every join fails — the dips
and blends are CSS keyframes restarted by a keyed re-render, so scrubbing
into the middle of a seam shows nothing. That is the honest baseline, and
it is a good first thing to fix, because the joins are also the part both
films share verbatim.

## What NOT to build

Not a keyframe language. Final Cut and After Effects do not ask a person to
author keyframes for a bespoke effect: the effect is a program, and it has
controls. "Walk up the street and then put your head back" should stay a
small program with five published numbers, of which one — the fraction of
the shot spent walking — is the whole idea. The primitive above exists so
that program can be written in twenty lines instead of two hundred, not so
that it never has to be written.

---

# The other four demos, and a correction

Four more pieces in this repo were read against the design above: the
Sylva spike, the long take, the mockup, and the feature reel with its
compositor. They change it, and one of them corrects it.

## The correction: the primitive already exists, one level up

`test-app/app/lib/compositor.ts` opens with the rule I proposed as new:

> The contract in one sentence: the composition is a function of time.
> Timed cues are semantic commands folded through `t` — never callbacks,
> never remembered coordinates — so `renderAt(8.9)` on a fresh page
> produces the same state as playing there.

It also has the two hard parts already worked out. **Actor ports** —
`{ actions, parameters, presence, reset }` at a stable address, where every
action is an ensure rather than a toggle, so a replayed fold can hit it
twice. And **backward seek as reset plus replay of the prefix**, because a
semantic command cannot be un-executed, only re-derived from zero. It even
has clips with source time and an end policy (`remove | hold | freeze`).

So the primitive is not missing from Choreo. It is missing from the FILMS,
and the reason is a decision they made deliberately, which is the real
finding.

## The fork everything hangs on: seekable, or chased

The two positions are stated in the code, in almost the same words, and
they are incompatible.

`tower-film.gts:1893` —

> THE PLAYHEAD SNAPS TO A SHOT, because this film cannot seek: the lens is
> an integrator and a run dropped into its own middle arrives with the
> wrong velocity.

`feature-reel.gts:553` —

> Every wait here once had to be a constant-easing camera duplicate so a
> random-access seek would land on the pose. The score staying Wait-based
> IS the proof the transport reconstructs.

A cascaded-spring chaser between the score and the lens is what gives both
films their hand-held quality — the sway, the arrival at pace, the
softness after a cut. It is also exactly what forfeits seekability, because
a spring's state is its history. The reel gives up the chaser and gets
frame-accurate export; the films keep it and their scrub bar re-cuts to a
shot's head instead of landing mid-shot.

**`<c.Film> @seek={{"exact" | "cut"}}` is therefore the first parameter,
and everything else follows from it.** Not a preference: a film that
declares `exact` may not put an integrator in its pose path, and a film
that declares `cut` may not be exported frame by frame. My acceptance test
in the section above — scrub anywhere and the frame is correct — is the
right test for `exact` and the wrong test for `cut`. I wrote it as
universal, and it is not.

## What to lift, and where it already works

- **Timing derived from the geometry, not authored.** Sylva computes each
  card's reading pose from the anchor's own normal, and its cue times from
  the path's shape, so adding a card re-times the film. Both films
  hand-number every pose and every delay. A film should be able to hand the
  construct a waypoint _provider_.
- **Yaw unwrapping between waypoints.** Sylva solves the 340°-the-wrong-way
  swing; that is a property of any splined orbit and belongs in the library,
  not in an app.
- **A master clock with a slop band**, for a film with more than one plane:
  the long take syncs two regions at 1/30 s and says why equal durations
  are not enough — separate compile passes, separate start frames, separate
  clocks.
- **Tracks that mute without retiming.** The mockup switches a camera track
  off by swapping each step for a `Wait` of the same length. That should be
  built in, and each track should be seizable on its own gesture.
- **The self-tap guard**, for any film that drives real controls: a
  synthesised click bubbles to the stage exactly like a real one, straight
  into the "someone touched the screen" guard that stops the film.
- **A film's cheapest representation is a photograph of itself.** Sylva's
  tile face and the long take's frozen still are the same idea: the flat
  mode is not a degraded render, it is a capture of the live one.
- **Chrome as an argument.** Sylva's `?film` strips the controls to leave
  the world and the words; that is what a player exports, and it should be
  `@chrome={{false}}` rather than a URL flag.

## Parameters, not behaviour

Each of these is decided differently in two places already, which is the
test for whether it is a parameter:

1. **`@seek`** — exact, or cut to a shot's head. Above.
2. **`@end`** — loop, hold, or end and offer a card. Sylva bumps a lap
   forever; Tower refuses: "looping past your own ending is how a film
   tells the viewer it never meant any of it."
3. **`play()` vs `restart()`** — the long take resumes a run that is
   standing right there; every other piece bumps the score's name and
   starts from zero. On a double press the second stacks films.
4. **Measured vs named flights** — the mockup refuses to measure under a
   3D projection (at a 54° tilt a measured flight starts 40px out); the
   feature reel measures across planes. Both are right in place.
5. **Where the chrome sits** — outside the region for a 2D camera, which
   zooms the region's own frame; inside for a 3D one, which does not.

And two that should stop being parameters, because they are re-implemented
three times each and are pure library concerns: **recompiling a score to
restart it** (three spellings of a name bump), and **backward-seek reset
and replay of semantic cues** (the compositor, Sylva and the mockup each
have their own).

## What nothing in the repo has

Worth knowing before anyone assumes it is a solved problem. There is no
scroll- or gesture-driven timeline anywhere — the only scroll code gates
visibility. There is no responsive art direction inside a score: what
exists is context switching between tile, stage, theater and embed, and
media queries in the film's stylesheet. There is no preloading beyond
ready-gates and stills, apart from this film's `voicePrime`. And sound is
entirely this film's: a voice, music, effects and weather mixer with
ducking, against silence everywhere else.

---

# Built: `<Film>`, and the two films cut on it

The construct exists (2026-09-02). It lives in the addon at
`packages/glimmer-motion/src/film/` and is imported as `glimmer-motion/film`
(`Film` is also exported from the package root). Both reference films are
now cut ON it and serve from the same routes as before.

## What moved, in lines

| file                                           | before | after |
| ---------------------------------------------- | -----: | ----: |
| `test-app/app/components/tower-film.gts`       |  7,377 | 1,447 |
| `test-app/app/components/sagrada-film.gts`     |  8,939 | 1,788 |
| `packages/glimmer-motion/src/film/` (10 files) |      — | 7,670 |

Of the construct's 7,670 lines, 2,480 are the chrome stylesheet and 179 the
composed template; the rest is the engine and the components. What stays in
a film is what the doc above predicted: the shot list, the script and its
measured reads, the chapters, the geometry sampled off the model, the year
clock, the front and back matter, and an identity block of overrides.

## The model: a headless cutting room

`<Film>` is one clock and a set of components that read it. The 3D page is
the video track; everything else is a component dropped onto that clock:

| component            | file           | what it is                                                                                       |
| -------------------- | -------------- | ------------------------------------------------------------------------------------------------ |
| `Film`               | `film.gts`     | the engine: the score, the chased lens, the beat application, the voice, the transport, the keys |
| `Joins`              | `joins.gts`    | the transitions — wipe, blend, melt, dip, iris, blur, luma, flash, defocus — as one component    |
| `Plate`              | `plate.gts`    | the lower third / title / plate / point: kicker, word, reading, up to four cues, on Choreo       |
| `Rail`               | `rail.gts`     | the timeline: chapters as dots on a rule, the head riding it, a readout when the rule is a clock |
| `Player`, `Menu`     | `player.gts`   | the transport bar and the chapter menu                                                           |
| `Gate`, `EndCard`    | `titles.gts`   | the front door and the end card — shells; the matter is the film's, set in the title package     |
| `Insert`, `Captions` | `overlays.gts` | the photograph cut in beside the model; the narration printed                                    |
| `Stamp`, `Track`     | `overlays.gts` | the lineup's hanko; the glass that connects DOM to world (leader, tether, ring)                  |

The freeze frame is the page's own render target (`Picture.dissolve`), with
a still in the DOM as the fallback; nothing reads the canvas back in normal
play. Clip overlap is the L-cut: a beat with no line lets the outgoing
sentence finish across the seam, and a `lead` flies the lens in while the
next chapter's air is already turning.

## What a film hands in

```hbs
<Film
  @name='sagrada'
  @src={{this.src}}
  {{! the picture's page, mounted in an iframe }}
  @assets={{this.assets}}
  {{! vo/<id>.mp3, luts/*.cube, photographs }}
  @beats={{this.beats}}
  {{! the shot list — data }}
  @chapters={{this.chapters}}
  @grades={{this.grades}}
  {{! the moods, as numbers the glass takes }}
  @voSecs={{this.voSecs}}
  {{! measured reads, never estimated }}
  @voGain={{this.voGain}}
  @clock={{this.clock}}
  {{! years both ways, when the picture keeps one }}
  @standing={{T_TODAY}}
  {{! the page's clock at which the subject stands whole }}
  @seat={{this.seat}}
  {{! told once, before the door }}
  @rigMid={{6.6}}
  {{! lookY is world height minus this }}
>
  <:gate as |f|>…front matter, f.begin, f.runtime…</:gate>
  <:end as |f|>…back matter, f.restart, f.toc…</:end>
  <:default as |f|>…under the stage: a cutting room, f.preview…</:default>
</Film>
```

The After Effects rule holds at the film level too: everything a film
decides differently from the other is an argument, and each one is there
because the two films disagreed — `@join` (dip vs wipe), `@rigMid` (6.6 vs
7.065), `@cloudHaze`, `@cityGlass`, `@worldType` (the face and tracking of
type standing in the scene; a film that names none of it keeps the page's
own), `@accent` (the film's own, or the scene's palette by day), `@poster`
(the door's hour and key light), `@lutAmount`, `@lookFx`, and `@rail`
(the paper rail on the picture — chapters as dots on a rule, the year
riding the head — is Sagrada's transport; Towers says `false` and keeps
only its own floating bar). Two hooks, `@onBeat` and `@onAir`, are there
for what the construct does not know.

The picture is the `Picture` port (`types.ts`): the members every picture
must offer for a score to cut it, and optional ones honoured when present
(`lut`, `rising`, `traceUndraw`, `outro`, `city`, `grass`, `quality`,
`style`, `hold`, `volume`). Sagrada's page satisfied it unchanged; the
Towers page has since taken `traceUndraw`, `outro` and `lut` (the LUT
atlas, the baked looks and the ACES tone curve, ported from Sagrada's
page), `hold` and `volume`. A film that names no stock gets none.

## The handle

The door, the card and the default block are given a `FilmHandle`: `begin`,
`restart`, `toc`, `cutTo`, `preview` (any join as a pure overlay on the
living picture — the Towers cutting room's strip), `runtime`, `ready`,
`beat`, `chapter`. A block never reaches into the engine.

## Honest notes

- **The default identity is Sagrada's.** The chrome stylesheet carries the
  centenary voice (Archivo, one red) as its default; Towers overrides
  what the keep says differently (serif, vertical hanko, its cue sizes) in
  ~140 lines. A neutral default with the identity fully outside the
  library is a later cut; the variables to do it (`--cf-display`,
  `--cf-ui`, `--cf-serif`, `--cf-chap`, `--cf-accent`) are already the only
  way the stylesheet names a face or a colour.
- **Verified so far:** both films boot on the construct in the preview
  pane — the bridge is found, the door renders with each film's own
  matter, the poster frame is the right shot under the right light, and
  Sagrada's door opens into the first beat with its plate, the five dots
  and the 1882–2034 rule. A hidden pane does not run the clock
  ([[hidden-pane-starves-clocks]]), so the joins, the voice and the moves
  need a foreground tab; nothing in that path changed except its address.
- **Not built:** `@seek='exact'` — the fork above. This construct is the
  chased one, and says so.
- `public/sagrada/type-harness.html` was re-extracted from the construct's
  stylesheet and speaks `cf-`.

---

# Seek: the fork, built

`<Film @seek='exact'>` exists (2026-09-02, after the construct). Both films
take it from the URL: `/_sagrada?seek=exact`, `/_towers?seek=exact`. The
default stays `cut`.

## What "exact" means in the engine

The film becomes a pure function of one number, `t`, seconds into the whole
film. The frame loop advances it while playing; a scrub sets it; the fold
derives everything else from it:

- **The beat in force** is the one whose window holds `t`
  (`beatStart(i)` = the cue's own time, one tick after the table, so the
  windows agree with the cut film to the frame). Entering a beat — forward
  by playing, or by a seek in either direction — applies it whole, because
  every beat asserts its complete state (`applyBeat` + `settleAir`) and
  inherits nothing. No `c.Perform` cues are rendered in this mode; the
  camera step still is.
- **The lens is the spline.** No spring, no one-pole: `now = goal`, the
  page is posed with `snap: true` every frame so its own chase is stood
  down too. The breath and the hand's wander run on `t`, not the wall.
- **The score's run and the plate's run are driven, not played.** Each
  frame the score run's `time` is set to `t` (paused; Choreo's own seek
  reconstructs the camera fold), and the plate's run to `t − beatStart`.
  The Plate hands its region's context up through `@grab`.
- **Seams are functions of `t`.** The overlay's animations are paused and
  stood at `t − seamAt` every frame. A seek into a seam first re-makes the
  outgoing frame (`refreeze`: stand the page at the previous beat's tail,
  its clock, its hour, read it back), then applies the incoming beat over
  it. The page's own dissolves are not used in this mode because they run
  on the page's clock; every join carries a still. The whip, which is the
  chaser's, becomes a cut.
- **The voice starts from the middle.** `Picture.voice(url, gain, at)`
  gained `at`; both pages seek their buffer source to it. A seek within a
  read speaks the line from there; past it, silence and the bed back up.
- **The sun walks deterministically** (from the previous beat's light to
  this beat's over 1.5 s of beat time); the follow rule eases on the
  campaign's own progress; the dim, the mark's facing and the chapter
  word's fade are functions of beat time.
- **`renderAt(t)`** on the handle: pause, seek, one tick against a zero
  step, two frames for the page. The claim is that it is the same frame as
  playing there.

## What it costs

- **The hand.** The spring is gone. The spline is smooth and the breath is
  still there, but the arrival-at-pace and the sway after a cut are not.
  That is the fork, on purpose.
- **A read-back per cut.** Every seam holds a still of the outgoing frame,
  which is the `toDataURL` that cut 8 removed from the cut film. Exact
  mode pays it because a seam must be reconstructable.
- **Not yet deterministic:** the mark's entry height is read off the
  structure when the word arrives, so a seek past that moment lands it
  where a fresh page would not; the sun walk after a seek starts from the
  goal rather than from the previous beat; the light sweep and the
  rack-defocus's live blur run on the page's clock.
- **Verified:** types and lint. Not watched in a browser — Chris asked for
  no windows to be opened from this session; the URLs above are the check.

---

# Clips: a source-time window over the film's clock

`Beat.clip` exists (2026-09-02, after seek). A beat is a shot of the
picture; a clip is something laid over it for a while — a video, a still,
or a freeze of the picture itself — and it is the compositor's `ClipSpec`
arithmetic (`notes/choreo-composition.md`, Phase C3) lifted whole:

```
source = in + (film − start) × rate
window = for, or (out − in) / rate, or the rest of the beat
```

```ts
clip: {
  kind: 'video' | 'image' | 'freeze',
  src?: 'clips/crane.mp4',     // under assets; a freeze needs none
  at?: 1.2,                    // seconds into the beat it appears
  for?: 6,                     // seconds it stays (else: the rest of the beat)
  in?: 10, out?: 16, rate?: 1, // the source's window
  end?: 'remove' | 'hold' | 'freeze',
  fit?: 'cover' | 'inset',
  volume?: 0,                  // 0 keeps the film's voice in charge
  caption?, credit?
}
```

- **Every state is re-derived from the film time on every frame**
  (`resolveClip` in `clips.ts`, pure, unit-tested in
  `test-app/tests/unit/film-clips-test.ts`): absent before `start`, active
  inside the window with its source time, then the end policy — removed,
  held on the last sample, or frozen. Nothing is discovered by playing
  from zero, so an exact film scrubs into the middle of a clip and finds
  it where it should be.
- **The media is driven, not played.** A playing video is left to run at
  `rate` and corrected when it drifts past 0.2 s; a paused, scrubbed or
  held one is seeked to its source time; a frozen one is left alone. A
  clip never runs on the browser's clock.
- **A freeze is a real freeze frame:** the picture read back at the
  window's head, standing over the live picture while the film's clock
  goes on underneath. A seek into the window stands the page at the head
  first (the score is evaluated there for the pose, the build clock set)
  and reads it back, then restores the clock.
- **A clip may outlive its beat.** The window is measured on the film's
  clock, so a still that starts late in one shot crosses the seam into the
  next. That is the clip overlap an editor means; the newest clip wins,
  and a removed one hides nothing behind it.
- **Where it sits:** `cover` under the scrim and the type (the picture's
  layer), `inset` in the corner the type is not using, like the photograph,
  with its caption and credit. It arrives wiped in and leaves in a short
  fade, on its own Choreo region.

Sagrada carries one clip as the example: a freeze frame of the crane crew
at 200 m, inset, three seconds into that beat and held for eight. Video
and image clips are the infrastructure the next demo (HTML5 video and
generators) is built on.

## Cut 12, in the construct

Towers cut 12 landed on `main` (PR #35) after the lift, on the hand-rolled
film. Its transport work is exactly what the construct exists to hold
once, so it was ported into `<Film>` rather than merged into one film:

- **Pause means everything stops.** The viewer's pause holds the score's
  run (the lens included), the page's own clock (`Picture.hold`: weather,
  grass, build, day), the audio graph, and the beat clock, which is
  shifted forward by the length of the hold on resume. An exact film's
  runs are already standing, so only its clock holds — and it keeps
  deriving, so a scrub under a hold still draws. `space` and `K` toggle
  it; a tap on the glass does too, and two taps go full screen.
- **The head beat is applied once.** A cut applies its beat itself; the
  run's first cue at delay 0 names the same beat a pass later, and
  applying it again ran the join twice. A lap stamp guards it.
- **The bar listens.** A resting pointer gets the chapter and the time in
  a bubble and a ghost fill to where it would cut; the hovered chapter
  stands up; every button names itself and its key in the bar's own
  bubble; the chapter's name beside the clock opens the menu; the way
  back to the door says "Title screen"; the slider reports its value.
- **A master fader** (`Picture.volume`) folds out beside the speaker,
  after the mix and the mute, remembered across visits (one setting for
  every film: a viewer's volume is theirs). Dragging it up while muted
  unmutes. `M` mutes, `F` is full screen, `1`–`9` pick a chapter, `0`
  and `Home` go back to the title screen.
- **The door's choice is the page's state**: a muted begin turns the
  page's own switch off, and an embed begins with sound.
- **The night grade**, the one that pulls the picture down; a build
  clock's `settle`; `hoursOver`, the share of a beat its hours walk;
  `wxCut`, weather that changes at the head even on a flight; the last
  beat's type leaving under the end card; the title handing the frame to
  the subject (`--cf-title-k`); the leader fading with its caption.
- **The wipe is two transforms**, not a mask moving: the masked sheet
  slides and the still inside counter-slides, so the compositor
  rasterises once and only translates.

Both page bridges carry `hold` and `volume`; both are optional on the
`Picture` port. The Towers data took cut 12's own edits (the title's push
arrives, the edict wears the night, the building morning comes in under a
dip, the ridge-raising speaks, the takedown's day runs out early), and its
voice files are normalised in the file, so `VO_GAIN` is empty.
