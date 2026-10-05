# `<Film>` — the construct, as built

> This is the **as-built reference**: what `<Film>` actually takes, what it
> yields, how its clock works, and — the part that matters for the rest of
> the library — how it composes with the other Choreo constructs rather
> than replacing them. For the design record (why it exists, the two
> reference films, the duplication that was measured, the fork between a
> seekable film and a chased one) see
> [film-construct.md](film-construct.md).

```ts
import { Film } from '@cardstack/choreo/film';
```

Everything in this document lives at `@cardstack/choreo/film`.
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

### 2.0 A film is a graph

Since Phase 2 of the film-graph work a film is written as a **graph** in
the default block, and the table arguments below are the compiled form —
still accepted, and still what the engine runs, but no longer what a film
writes:

```gts
<Film @name='sagrada' @src={{this.src}} @assets={{this.assets}} @seek='exact' …>
  <:default as |f|>
    <f.Spine @join='dip'>
      <f.Chapter @n='01' @title='THE SITE' @grade='amber' @lut='sandstone'>
        <f.Shot @name='title' @ticks={{5}} @dolly={{0.5}} @yaw={{35}} @pitch={{14}} @lookY={{-2.4}}>
          <f.To @dolly={{0.74}} @yaw={{52}} @pitch={{14}} @lookY={{-2.0}} />
          <f.Type @mode='title' @kicker='A CONSTRUCTION STUDY' @word='Obra' @reading='THE WORKS' />
          <f.Voice @line='March, eighteen eighty-two…' @read={{get VO_SECS 'title'}} />
          <f.picture.Weather @theme={{0}} @wx={{1}} />
          <f.picture.Build @clock={{tAt 1882.3}} />
          <f.Stamp @year={{1882}} @at={{0.04}} />
        </f.Shot>
        <f.Join @presentation='dip' />
        <f.Shot @name='crypt' …>…</f.Shot>
      </f.Chapter>
    </f.Spine>
  </:default>
</Film>
```

The vocabulary `f` yields, and what each compiles to:

| node                                                                | is                                                               | compiles to                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| `f.Spine @join`                                                     | the film; `@join` is the seam a shot gets when nothing names one | the table, and the film's default join                          |
| `f.Chapter @n @title @grade @lut`                                   | a named sequence the menu and the rail read                      | a `Chapter` row; its shots' `ch`                                |
| `f.Sequence @join @cut @hold @bob`                                  | a group of shots wearing defaults; attachments under it inherit  | fields on every shot in it                                      |
| `f.Shot @name @ticks @dolly @yaw…`                                  | one shot: the head pose as its own arguments, and its facts      | `id`, `ticks`, `cam`, `cut`, `lead`, …                          |
| `f.To`, `f.Eye`                                                     | the tail pose; an eye-level walk                                 | `toCam`; `eye`                                                  |
| `f.Join @presentation @secs @over @to`                              | a sibling before the shot it cuts into                           | the next shot's `join`, `dipTo`, `over`                         |
| `f.Type`, `f.Voice`                                                 | the lower third; the narration and its measured read             | `mode kicker kanji romaji gloss says`; `vo`, `voSecs`           |
| `f.Stamp`, `f.Sky`, `f.Mark`, `f.Trace`, `f.Lineup`                 | what stands in the world                                         | `stamp`, `sky`, `mark`, `trace[]`, `cycle`                      |
| `f.picture.*`, `f.sound.Mix`                                        | **adjustments** the picture and the sound actor declare          | `grade lut look theme wx haze sun rim city grass build…`; `mix` |
| `f.Attach @at @for @end` around `f.Insert` / `f.Freeze` / `f.Video` | a window over a region the film does not own                     | `photo`; `clip`                                                 |
| `f.Inset @x @y @w @radius @fade`                                    | a picture in the picture: a layer placed in percent of the frame | `clip` with `fit: 'pip'`                                        |

The compiler is pure (`film/graph/compile.ts`); the components are markers
walked in document order after each render, so the template's nesting is
the tree. Both reference films exist as a table and as a graph, and
`tests/integration/film/graph-test.gts` asserts the graph compiles to the
table row for row — which is how they were migrated without a frame
changing, and why `tests/fixtures/film/*.json` still pins them.

### 2.1 Required arguments

Two: `@name` (a short name — a body class, the boot log) and `@menuTitle`
(how the chapter menu heads itself). The score is the graph in the
default block; the picture is a component in the `<:picture>` block.

### 2.1a The picture block

Everything that was ever about the page behind the iframe — where it
lives, where its files are, how it is seated before the door, the rig's
mid-height, how much frosted city a frame carries, the moods and looks
the glass takes — belongs to the picture, and the picture is a component:

```gts
<Film @name='sagrada' @menuTitle='SAGRADA FAMÍLIA' @seek='exact' @clock={{CLOCK}}>
  <:picture as |register|>
    <IframePicture @register={{register}}
      @src={{this.src}} @assets={{this.assets}} @title='Sagrada Família'
      @standing={{T_TODAY}} @seat={{seat}} @rigMid={{6.6}} @cityGlass={{0.16}}
      @lutAmount={{0.52}} @grades={{GRADES}} @lookFx={{LOOK_FX}} />
  </:picture>
  <:default as |f|>…</:default>
</Film>
```

`IframePicture` renders nothing: it registers its spec with the film a
frame after render and declares the **adjustments** a score may hold on
it — `f.picture.Look`, `Weather`, `Winter`, `Sun`, `Light`, `Set`,
`Build` — which is what `f.picture.*` yields. Its arguments are the
`PictureSpec` (`film/picture.gts`): `src`, `assets`, `title`, `standing`,
and the optional `seat`, `rigMid`, `cityGlass`, `cloudHaze`, `lutAmount`,
`grades`, `lookFx`, `worldType`, `accent`, `gradeLum`, `poster`. A third
kind of picture is another component with its own spec and its own
adjustments; the film never sees the difference.

### 2.2 The arguments that direct it

| Arg                 | Default      | What it does                                   |
| ------------------- | ------------ | ---------------------------------------------- |
| `@seek`             | `'cut'`      | the fork — see §4                              |
| `@settle`           | ¼ of a slot  | seconds of hand on the camera path — see §4.2a |
| `@join`             | `'dip'`      | the seam a beat gets when it names none        |
| `@rail`             | `true`       | the one-line transport on the picture          |
| `@clock`            | —            | a `FilmClock`; turns the rail into a date rule |
| `@over`             | `'picture'`  | how deep a seam goes — see §5.5                |
| `@voGain`           | `{}`         | the level each line was mixed to               |
| `@embed`            | `false`      | no door, no transport; also read off `?embed`  |
| `@menuSub`          | `'chapters'` | the menu's second line                         |
| `@build`            | `''`         | which cut this is; shown under `?debug`        |
| `@onBeat`, `@onAir` | —            | hooks for what the construct cannot know       |

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

A clip is fitted three ways, and they are three different objects rather
than one with options. `cover` is the full frame over the picture.
`inset` is the editorial photograph — a paper card with a rule and a
caption, in the corner the type is not using, positioned by the
stylesheet. `pip` is a LAYER: `x`, `y` and `w` in percent of the frame, a
corner radius, its own `fade` in and out, and nothing around it. A pip is
what a picture-in-picture actually is and the card is what an inset
actually is; they were one thing for a while and should not have been.

One limit worth knowing before you plan around it: **a beat carries one
clip**. Two `f.Inset` children on the same shot compile to one row and the
second wins. Lifting that is the insert-track question in
`docs/film-graph/GAPS.md`.

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

### 4.2a `@settle` — the hand, as a function of the clock

Both forks share one smoother, and it runs on the PATH rather than on
the frame. A cardinal spline crosses each waypoint with continuous
velocity and a **step in curvature**, which the eye reads as a tick — at
two seconds per waypoint, that is most of a minute's worth per chapter.
`@settle` reports a Hann-weighted average of the same spline around the
current progress instead of the spline itself. It defaults to a quarter
of the gap between waypoints, which is the only number that means the
same thing to two films with different pace; both films here spend two
seconds a waypoint, so both get half a second.

Being centred it has no lag, which is what separates it from a chaser;
being an average of a pure function of progress it is still a pure
function of progress, which is what lets `@seek='exact'` have it. The
window tapers to nothing at a `cut` and at either end of the path, by
`tanh` rather than by a hard `min` — a filter whose width has a corner
in it puts a tick back into what it filters.

On both reference films' own paths at 60 fps, measured away from the
splices: peak jerk falls about eight times (sagrada 2267 → 281 °/s³,
towers 270 → 36) while peak pan speed moves by half a percent. Past
about a second it gets worse again, the window rivalling the gap between
waypoints. `@settle={{0}}` gives the raw spline.

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

This used to cost the hand: the lens followed the spline with a
deterministic breath instead of a spring, because a spring cannot be
seeked. `@settle` is that hand written as a function of the clock —
an average of the spline rather than a chase of it — so an exact film
now has one. (A seek into a seam once also paid a read-back to re-make
the outgoing still; it now stands at the seam's end instead — §5.4.)

---

### 4.5 The schedule, headless

Everything in this section is arithmetic on the shot list, and it lives
in one pure module: `packages/choreo/src/film/schedule.ts` —
`totalSecs`, `secsBefore`, `beatStart`, `cues`, `chapterHeads`,
`contents`, `joinInto`, `tailFor` (where a shot ends: the authored tail,
floored so it reads as a move, clamped so it never travels past the next
shot's head) and `waypoints` (the spline, `ticks` points per beat, `lead`
points travelling in, `cut` splices). The engine calls these; nothing in
the module reads the clock, the page or the DOM.

That is what makes the film **measurable**. `schedule(beats, chapters,
defaultJoin)` returns the whole thing as one object — every beat's start,
the cue table, the waypoints, the chapters — and two things pin it:

- `scripts/film-fixtures.mjs` writes it for each reference film to
  `test-app/tests/fixtures/film/{sagrada,towers}.json`, headless, on
  Node's own type stripping (`node scripts/film-fixtures.mjs`; `--check`
  fails when a fixture would change). It can do that because the films'
  data is plain TypeScript with no Ember in it:
  `test-app/app/lib/films/{sagrada,towers}.ts` — the shot list, the
  chapters, the measured reads, the geometry sampled off the model.
- `test-app/tests/unit/film-schedule-test.ts` recomputes the schedule in
  the browser and asserts it equals the fixture to the digit.

The rule that follows: **the cue table and the camera path are the
film.** A change to the engine that alters any number in the fixtures has
changed the film, and says so in the diff of the JSON; a change that means
to re-runs the script and reviews that diff. Sagrada Família is 29 beats,
170 waypoints and 340 seconds; Towers is 26, 137 and 274.

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
      @duration={{this.filmSeconds}} @ease='linear'
      @settle={{this.settle}} @tension={{0.34}} />

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
- **`@settle`** — the operator's second hand, in seconds. A spline
  crosses every waypoint with a step in curvature, and the eye reads that
  step as a tick about once every two seconds for the whole running time.
  The reported pose is a Hann-weighted average of the same spline around
  the current progress: centred, so no lag; an average of a pure function
  of the clock, so still a pure function of the clock. The window tapers
  to nothing at a `cut` and at either end, so cuts stay hard and a path
  still lands exactly on its last waypoint. `<Film>` defaults to 0.5 s,
  which takes eight times the jerk out of both reference films' paths and
  moves their peak pan speed by half a percent.
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

### 5.3 The type, the insert and the clip are attached

The score carries one `c.Attach` window per beat for the plate, one for a
beat with a photograph, one for a beat with a clip — each anchored at the
camera step with the beat's own delay and length, so the shot list, the
cues and the windows share one origin:

```gts
{{#each this.windows as |w|}}
  <c.Attach @region={{w.region}} @at={{at 'film'}} @delay={{w.start}}
    @duration={{w.length}} @end={{w.end}} @exact={{this.exact}} />
{{/each}}
```

The three regions declare their ids (`plate`, `insert`, `clip`) and
nothing else: they do not know they are in a film. In exact mode the fold
writes **one** clock, `run.time = t`, and the score's run drives every
window from it; in cut mode the score plays and drives them the same way.
This is the composition point that made the construct worth building: a
Choreo run is addressable, so a film can be a pure function of one number
without the timeline knowing it is in a film — and a paused exact film is
simply a still, which is why the region must stand even while stopped.
See [choreo-constructs.md](choreo-constructs.md) §3.4a for the construct.

---

### 5.4 The seams are presentations

A join is what happens to the outgoing frame while the incoming shot
plays underneath it **from its very first frame**. Since the joins
rewrite, each of the film's twelve is a component satisfying one
contract (`PresentationSignature`: `@still`, `@at`, `@color`,
`@seekable`), registered by name in `PRESENTATIONS` with its length and
whether it needs a still; `<Joins>` renders whichever the kind names, a
new element per cut. Three of the twelve are not presentations — a `cut`
and a `whip` are the camera's, a `sweep` is the light's — and three
(`blend`, `melt`, `dip`) the picture does in its own glass when it can.

A seam written in an app satisfies the same contract with no library
privilege: a score names it with `<f.Join @presentation={{Curtain}}
@secs={{0.8}} />`, the compiler names it for the film
(`presentation:N`) and registers it, and the film plays it like the
twelve. `tests/integration/film/join-presentation-test.gts` is the proof.

One rule changed with the rewrite, Chris's direction after watching the
migrated films:

- **A seek lands past the seam.** A seam is played forward over a still
  of the frame that was actually on screen; a seek has no such frame.
  The exact film used to re-make one (stand the picture at the previous
  tail, read it back, replay the seam from its middle) — a read-back per
  scrub for a transition nobody asked to watch. Now a jump into a seam's
  window stands at its end: the incoming shot, whole. `refreeze` is gone,
  and with it the "read-back per cut" price §4.4 listed.

A second rule was asked for and is still owed: the incoming clip's type
should enter from the START of the transition rather than after it. That
needs the seam layer to sit ABOVE the type, the insert and the clip —
otherwise an incoming caption drawn during the seam is painted over the
outgoing still — so the two go together. Tried once, it regressed on
Chris's screen (a visible gap, and the building doubled), and both halves
were reverted: `.cf-joins` keeps its auto z-index before the cloud, and
the type still waits `secsOf(join) + 0.45`.

#### The still has to be paintable before the lens moves

A join's still is a full-resolution JPEG data URL, and a JPEG handed to
the DOM is not paintable on the frame it is handed over: the browser
decodes it off the main thread. `pose({ snap: true })` moves the lens on
that frame regardless, so the seam played backwards — three frames of the
incoming shot at 60 Hz, then the freeze of the outgoing one, then the
transition over it. Chris filmed it.

`Seam.hold` (`film/seam.ts`) is the gate. It decodes the frame into the
memory cache first and holds the whole cut — the lens snap, the overlay,
an iris's projection — until the decode resolves, so the DOM image paints
from that decode on the frame it is inserted. Three rules, each with a
test in `tests/unit/film-seam-test.ts`:

- a seam with no still (a cut, a flash, a dissolve the page held in its
  own glass) runs synchronously, on the caller's stack, as it always did;
- a cut that arrives while an earlier one is waiting retires it;
- a decode that never returns is given 120 ms and then the film cuts
  anyway.

The outgoing shot stays live for those few milliseconds, which nobody can
see. A cut two frames late reads as a cut; a cut that shows the wrong
picture does not. Note that this does NOT reproduce in headless Chrome —
SwiftShader renders the incoming camera slowly enough that the still
always wins the race — so it is one of the few things in the film only a
real GPU at retina scale can confirm.

### 5.5 What a seam covers: the frame, not just the picture

A join used to transition exactly one thing. The still was a JPEG of the
canvas, the dissolve happened inside the picture's own glass, and the
overlay sat in `.cf-joins` — one absolutely-positioned box among ten. The
paper wash (`.cf-scrim-lower/-title/-plate/-point`, a radial gradient in
the scene's palette chosen by the shot's `mode`) and the passing cloud
(`.cf-cloud`) were two more boxes ABOVE it. So a wipe swept a still with
the incoming wash painted over it, and a shot whose mode changed at the
cut showed the picture dissolving while the paper behind the type moved on
its own 700 ms. Two edits at once.

Neither Final Cut nor After Effects lets you enumerate what a transition
covers: a transition renders its own container, and to include a title you
put both in a compound clip or a pre-comp. So rather than give the join a
list of layers, the layers moved INTO the container. The post pass already
owned the vignette, the grain, the split tone, the LUT and the grade — all
coloured from the same palette — and the wash and the cloud were the only
two members of that family still in CSS. They are terms in the pass now,
after the grade and the grain and before the freeze mix, which is exactly
where the DOM layers sat: above the picture, below the furniture.

The dim (`.cf-dim`, the wash a lecturer puts on the plate when an
annotation goes up) is the third of them and moved for the same reason:
it is a grade ON the picture, not furniture beside it.

The film tells the picture about them through three optional port
members, `wash(mode, paper)`, `cloud(k, rakeDeg)` and `dim(k)` — the same
handful of numbers it used to write to `--cf-paper-*`, `--cf-cloud`,
`--cf-rake` and an inline opacity. A
picture that offers them gets them, and `Film` stops rendering
`.cf-scrim`, `.cf-cloud` and `.cf-dim`; one that does not keeps the CSS
layers, so the port's "honoured when present" contract holds. The picture eases a
change of mode itself over the same 700 ms the stylesheet's
`transition: background` did.

Two things came out of it. The seam now carries the wash, because the
freeze is captured from the pass. And the still finally matches the frame
it froze: it used to be a snapshot of an unwashed canvas shown under a
DOM wash, which is why a cut had a visible step in it. Measured on the
title-to-shiro wipe, headless, the same 22-frame sweep either side of the
change — the frame where the still appears used to jump by 12.66 (of 255)
and then sit frozen for 17 frames; it is now continuous.

#### The dip's curve

A veil is composited in sRGB, so an opacity of `a` leaves `(1 - a)^2.2`
of the LIGHT. A veil eased evenly to black is therefore down to a fifth
of the light by its halfway mark and then crawls — the picture lurches
into the dark and waits there, which is what a dip used to feel like. The
alpha that makes the LIGHT fall smoothly is a very different shape:
almost nothing for the first third, then a rush into black. It is in the
keyframes as a table of stops with a `linear` timing function, because
the curve is the stops.

The rest of the dip is editorial. Close over 34% of its length, hold
black for 10% — a dip is punctuation and the hold is the full stop — and
open over the remaining 56%, so the way out is longer than the way in.
The outgoing frame is swapped for the incoming one inside the hold, where
none of the change is on screen. Measured on the towers dip: the veil now
reaches a frame mean of 11 of 255 (the dip colour itself) where it used
to bottom out at 38, and the fall reads 47, 46, 45, 44, 42, 41, 39, 36,
34, 31, 28, 24, 21, 17, 12, 11 instead of dropping 30 points in its first
two frames.

#### `@over`: the picture, or everything

How deep a seam goes is one argument on the join, with two values.

`picture` is the default and is what every seam did before: the
transition happens to the picture and to nothing else, so the incoming
shot's type has to WAIT for the seam to finish (`secsOf(join) + 0.45`)
before it may enter. Otherwise a caption for the new setting would be
read over a still of the old one.

`everything` lifts the seam above the type, the stamp, the rail, the
inserts and the clips instead. The still covers the whole frame, so the
incoming shot plays under it with its type already running, and the sweep
reveals a setting that is UNDER WAY rather than one that starts when the
sweep is over. The type's wait goes to zero, which is the point.

```hbs
<f.Spine @join="wipe" @over="everything">   {{! the film's default }}
  …
  <f.Join @presentation="dip" @over="picture" />   {{! this one is shallow }}
  <f.Chapter @n="04" @over="picture">…</f.Chapter> {{! this chapter is }}
```

The spine's `@over` is the film's default and is NOT written into the
rows, exactly like its `@join`; a chapter's, a sequence's or a join's IS,
because it is not the default. A brought presentation may declare its own
in `Presentation.over` — a curtain that drops in front of the picture and
leaves the caption standing in front of it is not a curtain. The film
resolves row, then presentation, then default.

Two things follow from it, both worth knowing before turning it on.

The layer sits at `z-index: 5`: above the type, the stamp, the rail, the
photos and the clips (1 to 4); level with the transport, which is later
in the document and so stays in front of it; below the menu, the
captions, the door and the fault banner. A viewer never loses the
controls to a transition, and the layer takes no pointer events either
way. The class is on only while the seam runs.

Both reference films run on it. A note for anyone turning it on: the
type's wait going to zero moves every beat's type earlier, and `sayAt`
derives from `typeAt`, so the spoken line cues move with it. It changes a
film's rhythm throughout, not only at its seams.

The tier is also what forced the dim into the pass. Lifting the seam
above `.cf-dim` exposed the fact that the still, being a snapshot of the
canvas, had no dim in it: the first frame of a blend jumped from a mean
of 146.9 to 191.1 as an undimmed still landed over a dimmed frame. With
the dim in the pass the same seam reads 140.3 to 139.0. Anything that
grades the picture has to be inside the picture, or a seam will find it.

And a seam that covers the furniture can never be held in the picture's
own glass, because the glass is inside the canvas and the type is outside
it. So `everything` forces the DOM still on the three seams the picture
would otherwise dissolve for free (`blend`, `melt`, `dip`) and pays a
frame read-back for each. That is the whole cost of the tier, and it is
why it is opt-in rather than the default.

### 5.6 A seam is two numbers, and both halves read them

A seam used to be one image over everything: a JPEG of the outgoing frame
faded or swept by this document. That has three costs. This document
cannot choose its compositing space, so a crossfade mixes two DISPLAY
values and sRGB is a curve — the middle of a measured blend sagged 5.15 of
255 under the straight line between its two shots. It needs a frame
read-back and a decode per cut, which is why the cut has to be gated at
all. And because the still is the only thing covering the incoming type,
covering the type is all it can do.

So a seam is two halves of one gesture, and one progress drives both.

**Half one is the picture.** `Picture.seam(spec)` is written every frame
with a `SeamSpec` and `seam(null)` ends it; `freeze(true)` takes the frame
it holds. Without a `name` the picture runs the film's own law — `mix` of
the held frame over the live one, `veil` of `color` over both — and does
both mixes in LIGHT, which is the whole reason the seam moved in there.

**Half two is the furniture.** The film multiplies the type, the stamp,
the inserts and the clips by what the seam leaves over,
`1 - max(mix, veil)`. A caption is uncovered by the same gesture that
uncovers the shot behind it, rather than waiting for the seam or hiding
under a still.

The film owns the clock and the shape (`seamShape` in `joins.gts`); the
picture owns the compositing. The progress is a function of the film's
clock, so a seek through one of these has nothing to stand at a time.

Blend, melt and dip take this path. A wipe and an iris are SHAPES rather
than mixes — they need pixels to sweep and to clip — so they keep their
presentation and their still, and an app-brought presentation is
untouched.

|                     | worst sag | read-backs over 45 s | frames over 25 ms |
| ------------------- | --------- | -------------------- | ----------------- |
| the still, in sRGB  | −5.15     | 4                    | 6                 |
| the glass, in light | −3.01     | 0                    | 4                 |

#### A seam can be a shader

`PictureSpec.seams` declares the transitions a picture can run in its own
glass, by name, the way `adjustments` declares its knobs. A join naming
one is handed to `Picture.seam` with a `name` and its progress instead of
being drawn as an overlay here, and the film learns nothing about it but
its length:

```hbs
<IframePicture @register={{register}} @seams={{this.seamNames}} … />
…
<f.Join @presentation='ridged-burn' @secs={{0.9}} />
```

That is the same contract every shader transition in the wild already has
— two textures and a progress — and our glass already held both: the held
frame is the from-texture, the live render is the to-texture.

`@secs` counts for a named seam. It is how a seam the film does not know
gets its length, and it also lets a score retime one of the film's own.

The reel at `/_seams` is the proof: a picture that is five images rather
than a scene, declaring four seams after the shapes in hyperframes, and a
score reaching them exactly as it reaches a dip.

#### The wipe is an edge, not a moving box

Worth knowing because it was wrong for a long time. The wipe used to be a
box three frames wide carrying a masked still, with the image inside
counter-moving so the edge appeared to cross — and the travel was
hardcoded up-left while the gradient's angle followed the sun. Projected
onto the gradient axis, the sweep was 0.92 of its intended distance at one
rake, 0.16 at another, exactly 0 at −27°, and NEGATIVE past 0°, where the
outgoing frame grew back over the incoming one.

Nothing moves now. The element is the frame, the still fills it, and one
registered custom property sweeps the two gradient stops from before the
frame to past it. At p = 0 both stops are behind the frame, so it is
wholly opaque; at p = 1 both are past it, so it is wholly gone. True at
every angle, which the old one never was.

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
- **`seam(spec)`** and **`PictureSpec.seams`** (optional) are half of a
  seam — see §5.6. `seams` names the transitions this picture can run in
  its own glass; `seam` is written every frame with a `SeamSpec` and
  `seam(null)` ends it.
- **`freeze(on)`** (optional) holds the frame that is on screen in the
  picture's own glass. The film pins it for the few milliseconds a seam's
  still spends decoding: the still waits, but the BEAT does not — the
  hour, the build clock, the model and the weather land the instant the
  beat does, and without the pin the canvas showed the incoming world
  naked for two or three frames before the seam had anything over it. On
  a towers dip that was one full frame of a bright empty site in the
  middle of a night shot.
- **`wash(mode, paper)`**, **`cloud(k, rakeDeg)`** and **`dim(k)`**
  (optional) take the frame's dressing into the glass — see §5.5. A
  picture that offers them gets the paper wash, the passing cloud and the
  annotation dim as terms in its post pass, and the film stops drawing its
  own CSS layers; a picture that does not keeps them.
- **`dissolve(kind, ms, live): boolean`** does the freeze-blend inside
  the glass and returns `false` when the page cannot — WebGL1, or a
  dropped post pass — so the construct falls back to the DOM still
  without the film knowing.

  A note both pages carry, because it cost a day: the freeze capture
  renders the post quad INTO `filmFreezeRT` while `tFreeze` is a bound
  sampler on the same material. Pointing that sampler at the target being
  written is a framebuffer feedback loop, the driver rejects the draw, and
  the target is left on its clear — black on a GPU, white under
  SwiftShader. Whether the shader takes the `uMix > 0` branch is
  irrelevant; the binding is what the check looks at. The first seam of a
  session captured a real frame (`tFreeze` starts null) and every seam
  after it dissolved against an empty target, so every `blend` and `melt`
  read as a dip to black. `tFreeze` is unbound around the capture now, in
  `filmFreezeCapture` and in `filmABFrame`, in both pages. The console
  proves it: dozens of `GL_INVALID_OPERATION: Feedback loop formed between
Framebuffer and active Texture` per run before, none after.

---

## 6a · Rendering, as opposed to recording

An exact film is a pure function of one number, which is the whole claim
of `@seek='exact'`. So it should be possible to stand one at a time from a
script and read the frame back, rather than recording it in real time and
hoping — and it is, but the hook had to be reachable.

`<Film>` publishes itself on `window.__choreo[name]` while it is mounted:
`renderAt`, `seek`, `seconds()`, `runtime()` and whether it is `exact`.
`scripts/film-render.mjs` is the consumer. It never lets the film run: it
calls `renderAt(t)` for every frame in turn, forces the delivery size
through the debugger rather than inheriting the headless window's, and
writes one JPEG per frame.

```bash
node scripts/film-render.mjs 'http://localhost:4201/_seams?from=1' out reel 60 0 50 9540 1920x1080
```

The output is reproducible: the same URL and frame numbers give the same
pixels on any machine at any speed. A live capture gives whatever the
machine managed that second, which is the honest comparison to run when
you want to know whether the clock is what it claims.

### A render is not a scrub

The rule that a jump into a seam's window stands at the seam's END (§5.4)
is right for a scrub and wrong for a render. A seam is played forward over
a still of the frame that was on screen; a scrub has no such frame, and
re-making one costs a read-back per drag for a transition nobody asked to
watch. But `renderAt` is a jump too, and a film rendered frame by frame is
a jump on EVERY frame — so with that rule alone an exact film rendered
deterministically had no seams in it at all, which breaks the promise the
mode is named for.

So a render says so. `Film.rendering` is set for the duration of a
`renderAt`, and `inSeam` honours a jump while it is. Measured on the reel:

|                  | seams that play |
| ---------------- | --------------- |
| rendered, before | 7 / 12          |
| rendered, after  | 13 / 13         |
| live, same build | 12 / 13         |

The rendered seams land on exact beat boundaries — 6.00, 10.00, 14.00,
18.03, 22.03 — which is the clock being what it says. The live ones sit a
frame or two earlier and wander, which is what a real-time capture is.

## 7 · The two films, side by side

Both call the same component. What differs is the direction.

|             | Towers                                 | Sagrada Família                    |
| ----------- | -------------------------------------- | ---------------------------------- |
| route       | `/towers`                              | `/sagrada`                         |
| `@seek`     | `cut` — the hand-held lens             | `exact` — a function of one number |
| `@join`     | `wipe`                                 | `dip` (the default)                |
| `@rail`     | `false` — it keeps its own bar         | `true`, and it is a year rule      |
| `@clock`    | —                                      | a `FilmClock` over 1882–2034       |
| `:default`  | a cutting room, with live join buttons | none, by choice                    |
| the subject | one keep on one axis                   | a hundred metres with three fronts |

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
