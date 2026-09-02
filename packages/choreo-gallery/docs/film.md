# `<Film>` — the construct, as built

> This is the **as-built reference**: what `<Film>` actually takes, what it
> yields, how its clock works, and — the part that matters for the rest of
> the library — how it composes with the other Choreo constructs rather
> than replacing them. For the design record (why it exists, the two
> reference films, the duplication that was measured, the fork between a
> seekable film and a chased one) see
> [film-construct.md](film-construct.md).

```ts
import { Film } from 'glimmer-motion/film';
```

Everything in this document lives at `glimmer-motion/film`. A subset is
re-exported from the package root under prefixed names (`Film`,
`FilmBeat`, `FilmChapter`, `FilmGrade`, `FilmHandle`, `FilmJoin`,
`FilmPicture`, `FilmCam`, `FilmClock`), but neither reference film uses
that door and it does not carry `TICK`, `LookFx`, the sub-components or
the clip API. Import from the subpath.

---

## 1 · What it is

`<Film>` is a cutting room, not a renderer. It owns a clock, a shot list
and an edit; it does not own a picture. The picture is a **port** — an
interface called `Picture` with about a hundred plain methods on it —
and both reference films satisfy that port with a separate WebGL page in
an iframe. Nothing in the construct knows that. A third film could put a
video element or a canvas behind the same interface.

What the construct does own, and what a film therefore stops writing:

- **one camera path** for the whole picture, and the splices in it
- **the seams** — twelve named joins, and the freeze-blend under them
- **the type** — kicker, key term, reading, up to four phrases, on their
  own Choreo region with entrances and exits
- **the clock** — beat windows, the cue offset, the scrub, the seek
- **the voice** — measured reads, ducking, priming, a line entered
  part-way when you seek into it
- **the grade and the stock** — named moods, named looks, `.cube` files
- **the furniture** — the front door, the chapter menu, the transport,
  the rail, the end card, the captions, the clips

A film supplies a script, a picture, and an identity.

---

## 2 · The shape

### 2.1 Required arguments

Eight. Everything else has a default.

| Arg          | Type        | What it is                                                             |
| ------------ | ----------- | ---------------------------------------------------------------------- |
| `@beats`     | `Beat[]`    | the shot list — the film                                               |
| `@chapters`  | `Chapter[]` | the chapter table, indexed by `Beat.ch`                                |
| `@src`       | `string`    | the picture's page, mounted in an iframe                               |
| `@assets`    | `string`    | where the film's files live: `vo/<id>.mp3`, `luts/*.cube`, photographs |
| `@standing`  | `number`    | the page clock at which the subject stands whole                       |
| `@name`      | `string`    | a short name — a body class, the boot log                              |
| `@title`     | `string`    | the iframe's accessible name                                           |
| `@menuTitle` | `string`    | how the chapter menu heads itself                                      |

`@standing` is worth a sentence. Both films open on an empty site and are
mostly about a finished building, so the construct stands the picture up
before the first beat runs. That is what lets a beat say only what it
_changes_, and it is what makes a deep link land on a real shot instead
of a field.

### 2.2 The arguments that direct it

| Arg                               | Default      | What it does                                                   |
| --------------------------------- | ------------ | -------------------------------------------------------------- |
| `@seek`                           | `'cut'`      | the fork — see §4                                              |
| `@join`                           | `'dip'`      | the seam a beat gets when it names none                        |
| `@rail`                           | `true`       | the one-line transport on the picture                          |
| `@clock`                          | —            | a `FilmClock`; turns the rail into a date rule                 |
| `@grades`                         | `{}`         | named moods, as numbers the glass takes                        |
| `@lookFx`                         | `{}`         | how each named look is worn                                    |
| `@lutAmount`                      | `0.52`       | how much of a stock a beat wearing one gets                    |
| `@voSecs`                         | `{}`         | what each read actually runs, measured                         |
| `@voGain`                         | `{}`         | the level each line was mixed to                               |
| `@seat`                           | —            | told the picture once, before the door                         |
| `@embed`                          | `false`      | no door, no transport; also read off `?embed`                  |
| `@rigMid`                         | `6.6`        | the rig's mid-height; `lookY` is measured from it              |
| `@cityGlass`                      | `0.16`       | how much frosted city a frame carries                          |
| `@cloudHaze`                      | `0.09`       | how much a passing cloud thickens the air                      |
| `@worldType`                      | Archivo 800  | how type standing in the scene is set                          |
| `@menuSub`                        | `'chapters'` | the menu's second line                                         |
| `@build`                          | `''`         | which cut this is; shown under `?debug`                        |
| `@onBeat`, `@onAir`               | —            | hooks for what the construct cannot know                       |
| `@accent`, `@gradeLum`, `@poster` | —            | the editorial accent, the mood luminances, how the door is lit |

`@worldType` replaces rather than merges: passing a partial object sets
the members you omit to the page's own, it does not keep the construct's.

### 2.3 The blocks

Three, each yielding the same `FilmHandle`:

```gts
<Film …>
  <:gate as |f|>…the front matter, on the door…</:gate>
  <:end as |f|>…the back matter, inside the end card…</:end>
  <:default as |f|>…under the stage: a wall plate, a cutting room…</:default>
</Film>
```

`:gate` renders only while the door is up, `:end` only after the film has
ended, `default` always — outside the stage, below the transport.

### 2.4 The handle

```ts
interface FilmHandle {
  beat: Beat; // the shot on screen
  chapter: Chapter; // the chapter it belongs to
  ready: boolean; // the picture is seated; the buttons may be pressed
  runtime: string; // the running time, said the way a poster says it
  begin(withSound: boolean): void;
  cutTo(index: number): void; // a beat index — an edit, never a seek
  seek(seconds: number): void;
  renderAt(seconds: number): Promise<void>;
  preview(join: Join): void; // play a seam over the live frame
  restart(): void;
  toc(): void;
}
```

`preview` is the one a wall plate wants: it plays any join as a pure
overlay on whatever is showing — no beat change, no snap — which is how
the Towers cutting room exhibits the seams as live buttons.

---

## 3 · The data

A film is a **table**, not a keyframe list. That is the whole authoring
claim: every field is a _fact about the shot_, so an agent directs the
film by editing data and a person directs it by dragging one number.

### 3.1 `Beat` — one beat is one shot

Five members are required — `id`, `ch`, `cam`, `mode`, `ticks` — and
forty-seven are optional. The optional ones are the direction:

- **the shot** — `cam`, `toCam`, `cut`, `lead`, `join`, `bob`, `eye`,
  `hold`, `follow`, `lift`, `to`
- **the type** — `mode`, `kicker`, `kanji`, `romaji`, `gloss`, `says`,
  `bare`, `sky`, `stamp`, `mark`, `cycle`
- **the air** — `grade`, `look`, `lut`, `theme`, `hours`, `hoursOver`,
  `haze`, `rain`, `winter`, `wx`, `wxCut`, `sun`, `rim`, `lightning`
- **the subject** — `build`, `buildBy`, `settle`, `style`, `trace`,
  `dissolve`, `grass`, `city`
- **the sound** — `vo`, `hush`, `mix`
- **the inserts** — `clip`, `photo`

`ticks` is how long it runs. One tick is two seconds, and a beat buys its
screen time by contributing that many waypoints to the camera spline — so
a beat that wants to _hold_ contributes the same pose several times over,
which a Catmull-Rom spline comes smoothly to rest on.

### 3.2 `Chapter`, `FilmGrade`, `LookFx`, `FilmClock`

`Chapter` is `{ n, title }` plus an optional `grade`, `lut` and a tint for
light and dark frames. `FilmGrade` is a mood expressed as numbers the
glass can take — saturation, contrast, brightness, sepia, hue, a warm and
a cool, and two mix amounts. `LookFx` is how a named look is worn:
`amount`, and the artefacts around it (`ca`, `grain`, `lift`, `tone`,
`vig`).

`FilmClock` is the one that changes the furniture:

```ts
interface FilmClock {
  span: [number, number];
  tAt(unit: number): number; // the film's unit → page seconds
  yearAt(t: number): number; // and back
}
```

Hand one in and the rail under the picture stops being a progress bar and
becomes a **date rule**: the head rides it, chapters are doors on it, and
the readout says the year. Sagrada Família passes one; Towers does not.

### 3.3 Clips

A clip is a video, a still or a freeze of the picture, held over the frame
for a window on the **film's** clock — not the beat's, so a clip may
outlive the beat that declared it. The mapping is three lines:

```
source = in + (film − start) × rate
window = for, or (out − in) / rate, or the rest of the beat
```

The media is never played by the browser's own clock. The film writes the
source time every frame — a paused element is seeked, a playing one is
corrected — so a clip is where the clock says it is whether the film
played there or was scrubbed there. Past its window a clip is taken off
(`end: 'remove'`, the default), held on its last sample, or frozen.

---

## 4 · The clock

### 4.1 Beat windows

`TICK = 2`. A beat's nominal head is every prior beat's `ticks` plus its
`lead`, times TICK. Its **actual** head carries one more tick:

```ts
beatStart(0) = 0
beatStart(i) = secsBefore(i) + (lead ?? 0) × TICK + TICK
```

That extra TICK is the single most load-bearing constant in the file. The
camera spline's first slot is occupied by the pose in force when the film
started, so waypoint _k_ is crossed at slot _k+1_ — every cue but the
first lands one slot late. The cue table carries the same offset:

```
beat cue  →  nominalHead + lead × TICK + TICK      (cue 0 fires at 0)
air cue   →  nominalHead + TICK                    (only when lead > 0)
```

Cue 0 is exempt because the boot and every re-cut apply the head beat by
hand, and a guard swallows its immediate re-fire. The `air` cue exists so
that the sky can turn _while the lens is still travelling_: the air
arrives as the sweep begins, the beat lands when it arrives.

Because `beatStart` and the cue table are derived from the same
expression, the picture and the type agree with the cut film to the
frame. Change one without the other and a film drifts two seconds.

### 4.2 The bar stops short

A click at the right edge of the scrub bar seeks to the total, and the
total _is_ the ending — which used to bring the end card up under a hand
that wanted the last shot. `barSecs` clamps every bar seek to
`totalSecs − 2`. The ending is reached by playing to it.

### 4.3 `@seek='cut'` — the hand-held film

The default. The score authors a pose and the lens **chases** it: one
critically-damped stage in the construct, the page's own chase as a
second, so two integrators in series bound the jerk. That is what gives
Towers its hand-held quality — and it is exactly what forfeits random
access, because a spring's state is its history.

So a skip in cut mode is an **edit, never a seek**: the score is re-cut
from the nearest shot's head and replayed under a fresh sequence name.

### 4.4 `@seek='exact'` — a pure function of one number

There is no integrator in the pose path. The beat in force is derived
from the clock, the type's run is seeked to it, the seams are driven by
it. Scrub anywhere and the frame is correct — and `renderAt(t)` on a cold
page is the same frame as playing there.

The engine is the **fold**: the beat whose window holds the clock is
applied _whole_, because every beat asserts its complete state and
inherits nothing from the one before. Entering it forward by playing and
entering it backward by dragging are the same operation.

A seek that lands inside a seam is the interesting case. The fold stands
the picture at the _previous_ beat's tail — its style, its clock, its
pose, snapped — takes one `snapshot()`, and plays the seam from its
middle exactly as it would have played into it.

The price is the hand: the lens follows the spline with a deterministic
breath instead of a spring, and every seam holds a still of the outgoing
frame, because the page's own dissolves run on their own clock.

---

## 5 · How it composes with the rest of Choreo

**`<Film>` is not a parallel engine.** It is an ordinary consumer of the
same constructs a demo uses, and this is the section worth reading if you
are extending either side.

The entire Choreo surface the film engine touches is five imports:
`<Choreo>`, `ChoreoContext`, `ChoreoRun`, `at()` and the `motion`
modifier. There is no `<Presence>`, no drag, no scroll, no layout
animation, no `viewTransition`, no private API.

### 5.1 The score is one region with two steps in it

```gts
<Choreo @onCamera3D={{this.shot}} @onPerform={{this.dispatch}}
        @camera3dFrom={{this.openPose}} as |c|>
  <i class='cf-rig' {{motion id='rig'}} {{this.grabScore c}}></i>

  <c.Sequence @name={{this.filmName}}>
    <c.Camera3D @name='film' @through={{this.path}}
      @duration={{this.filmSeconds}} @ease='linear' @tension={{0.34}} />

    {{#each this.cues as |cue|}}
      <c.Perform @at={{at 'film'}} @delay={{cue.delay}}
        @action={{cue.action}} @target={{cue.index}} />
    {{/each}}
    <c.Perform @action='lap' />
  </c.Sequence>
</Choreo>
```

That is the whole film. Nine lines of template, and every claim the
construct makes rests on them:

- **`c.Camera3D @through`** — one camera step for the entire picture.
  Every beat contributes waypoints to a single spline; `@through` splits
  its clock evenly between them, which is why _waypoint count is screen
  time_. A waypoint marked `cut` **splices** the path into clamped shots
  rather than travelling between them. The ease is `linear` on purpose:
  the shape belongs to the spline and the pace belongs to the chaser and
  to each shot's own head and tail.
- **`c.Perform` + `at('film')`** — one cue per beat, anchored to the
  start of the named camera step, so cues and waypoints share one origin.
  A `Perform` target is a _name_, and a beat's name is its place in the
  script: the index, as a string.
- **`@camera3dFrom`** — declares the opening pose so the first spline
  segment does not travel in from the library's default rig. Without it
  every cold boot wore a two-second bounce before its first real frame.
- **`{{motion id='rig'}}`** — the camera needs a real element to resolve
  against; an invisible `<i>` is it. This is the only `motion` modifier
  in the engine itself.
- **`@name={{this.filmName}}`** — a fresh name per lap. An _edited_ score
  replays from its own head, which is exactly the behaviour a re-cut
  wants; a restarted one would fight.
- **`{{#if this.booted}}`** — a rig on screen since the first pass was
  never inserted into anything, and the camera step would resolve to no
  subject. The region waits for the picture.

An **exact** film emits no `c.Perform` cues at all: the beat in force is
derived from the clock instead. The camera step stays either way, because
the spline _is_ the shot list. Cut films are told their beats by the run;
exact films read them off the number.

### 5.2 The type is a second region, not a special case

`<Plate>` opens its own `<Choreo>` and animates the lower third with
ordinary steps: an `n.Parallel` wrapping a dozen `n.Tween`s hung off
`n.inserted 'kick' / 'glyph' / 'read' / 's0'…'s3'` for the entrances and
`n.removed` for the exits, with `@stagger` on the glyph and delays handed
straight down from the beat. Four more regions do the same job elsewhere:
`<Clip>` (a wipe on `@clipPath`), `<Insert>` (a photograph wiped in,
faded out — "a fade says _meanwhile_, a wipe says _and here it is_"),
`<EndCard>` and `<Menu>`.

None of them nest inside the score. They are siblings with their own
timelines, which is what makes the type re-cuttable independently of the
camera.

### 5.3 Exact mode drives runs it does not play

`<Plate>` hands its `ChoreoContext` up through a `@grab` callback. The
film keeps two runs — the score's and the type's — and in exact mode
**pauses both and writes their clocks**:

```ts
run.time = t; // the score
plate.time = Math.max(0, t - beatStart(i)); // and the type
```

This is the composition point that made the construct worth building. A
Choreo run is addressable, so a film can be a pure function of one number
without the timeline knowing it is in a film — and a paused exact film is
simply a still, which is why the region must stand even while stopped.

---

## 6 · The picture port

`Picture` is thirty-eight required members and sixteen optional ones. The
required set is what any picture must offer for a score to cut it:
`pose`, `grade`, `time`, `theme`, `wx`, `haze`, `sky`, `trace`,
`project`, `view`, `sun`, `voice`, `duck`, `snapshot`, `dissolve` and the
rest. The optional set is honoured when present and skipped when not —
`lut`, `hold`, `volume`, `outro`, `year`, `plan`, `city`, `looks`,
`traceUndraw`, `rising`, `shot`, `style`, `quality`, `perf`, `grass`.

Two are worth calling out because the edit depends on them:

- **`snapshot(): string`** reads the frame back as a data URL. Every
  still join and every seek into a seam gets its outgoing frame this way.
  It is also how the gallery posters are made: one frame of each film,
  captured headless at a named shot (`scripts/film-poster.mjs`).
- **`dissolve(kind, ms, live): boolean`** does the freeze-blend inside
  the glass and returns `false` when the page cannot — WebGL1, or a
  dropped post pass — so the construct falls back to the DOM still
  without the film knowing.

---

## 7 · The two films, side by side

Both call the same component. What differs is the direction.

|             | Towers                                 | Sagrada Família                      |
| ----------- | -------------------------------------- | ------------------------------------ |
| route       | `/towers`                              | `/sagrada`                           |
| `@seek`     | `cut` — the hand-held lens             | `exact` — a function of one number   |
| `@join`     | `wipe`                                 | `dip` (the default)                  |
| `@rail`     | `false` — it keeps its own bar         | `true`, and it is a year rule        |
| `@clock`    | —                                      | a `FilmClock` over 1882–2034         |
| `@seat`     | —                                      | tells the picture what to show first |
| `:default`  | a cutting room, with live join buttons | none, by choice                      |
| the subject | one keep on one axis                   | a hundred metres with three fronts   |

Sagrada is the argument for the construct: it was written _against_
`<Film>` rather than cut out of it, and everything it needed that Towers
had not — a clock in years, a focus on the ground, exact seeking,
photographic stocks — became an argument the construct takes rather than
a fork of it.

---

## 8 · What is declared and unused

Five arguments are read by the engine and exercised by no consumer:
`@accent`, `@gradeLum`, `@onAir`, `@onBeat`, `@poster`. They are the
hooks a third film is expected to want. `Join` includes `'cut'`, which
has no entry in the seam-length table and therefore resolves to a
zero-length seam — a hard cut, which is correct, but it is arrived at by
absence rather than by statement.
