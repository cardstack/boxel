# Revisions — what each demo changed

> A running log. Every time an existing demo is read against the graph
> syntax, it gets a sketch in this folder and an entry here under three
> headings: **Syntax** (nodes and their shape), **Component library**
> (what the film package must ship), **Parameters** (arguments and what
> they take). The log is the spec growing; the sketches are the evidence.

## 2026-09-03 · Sagrada Família and Towers — the first cut

The two reference films, generated from their beat tables (`tograph.mjs`).

**Syntax**

- `<Film as |f|>` yields the vocabulary and the handle. `f.Spine` is a
  `c.Sequence` of items; `f.Chapter` a named sequence inside it; `f.Shot` a
  named composite step carrying only the camera facts; `f.Join` a sibling
  between two items; `f.Attach` a window on a base item's time over any
  region. Children of a shot are attachments with `@to` implied.
- A join into a shot is written **before** the shot. A shot that names no
  join gets the spine's `@join`.
- The gate and the end card are `f.Attach @to={{f.head}}` / `{{f.tail}}`
  with `@lane={{9}}`; the three named blocks go.

**Component library**

- Film-owned attachments: `f.Type`, `f.Voice`, `f.Air`, `f.Build`,
  `f.Mix`; world-anchored: `f.Stamp`, `f.Sky`, `f.Mark`, `f.Trace`.
- Regions the film does not own, placed with `f.Attach`: `Insert`,
  `Freeze`, `Video`, `Gate`, `EndCard`.
- `Player` is UI off the timeline: takes `@film={{f}}`, `@rail`, `@menu`.

**Parameters**

- `@picture={{hash src assets standing seat rigMid cityGlass cloudHaze}}`
  replaces seven arguments that were about the page behind the iframe.
- `Beat.kanji` / `Beat.romaji` become `f.Type @word` / `@reading`;
  `Beat.build` / `buildBy` / `style` become `f.Build @clock` / `@by` /
  `@subject`; `Beat.hoursOver` becomes `f.Air @over`.
- `f.Voice @read` names the measured read explicitly (`VO_SECS.id`).
- `f.Join @presentation` is a string for the twelve library seams and a
  component for an author's own; `@to` is the dip colour.

## 2026-09-03 · The six comparison shots — inheritance

**Syntax**

- `f.Sequence` inside a chapter is `c.Sequence` wearing the film's
  defaults: `@join`, and `@shot={{hash …}}` for shot facts (`cut`, `hold`,
  `bob`). Attachments placed directly under the group (`f.Type`, `f.Mix`)
  are in force for the group's window.
- Rule: a shot's own attachment of the same kind beats the group's field
  by field (the `generic` yield rule one level up); a shot fact set on the
  shot beats `@shot`; a join named inside the group beats `@join`.
- Rule: inheritance resolves at compile time. Every shot still asserts
  its complete state at run time, so exact mode's fold is untouched.

**Component library** — nothing new.

**Parameters** — `@shot` and `@join` on `f.Sequence` and, by the same
token, on `f.Chapter` and `f.Spine`.

## 2026-09-03 · Mockup — a phone, six apps, two lenses

`examples/mockup.gts`: a GLB phone whose screen is live DOM, six app
regions on it, a looping score of six scenes (an app opens, three
lock-ons, a tap, the app closes), one score driving a 3D orbit or a 2D
zoom. Read against the graph because a smooth sequence cannot jump-cut or
join, and a film can.

**Syntax**

- **`f.Cue`** — the third relationship from the memo, triggered not
  driven: a semantic command to an actor, folded through the clock
  (`c.Perform` underneath). `<f.Cue @action="open" @target="mail" />`,
  `<f.Cue @action="tap" @target="mail" @payload="Unread" />`. Attached to a
  shot it fires at the shot's head (`@at` to place it inside).
- **`f.Shot @by`** — a relative shot: its pose is applied over the pose in
  force. The hallway ("pull back far enough to see the home screen,
  whatever angle we are at") is `@by={{true}} @cam={{hash dolly=1.22 y=-0.03}}`.
- **Shots in seconds.** `@for={{2.2}}`; `@ticks` stays as the two films'
  sugar (`TICK = 2`). Every duration in Choreo is seconds and the shot
  should not be the exception.
- **Scenes are `f.Sequence`, not `f.Chapter`.** A chapter is a menu
  entry; the mockup has none. `f.Chapter` is optional; a spine of bare
  sequences and shots is a film.
- **The cut and the join arrive.** `@cut={{true}}` on the straightened
  read (the ACCENT beat) makes the press a jump cut; `f.Join` between apps
  replaces a hallway with an edit when the film wants one. Neither
  existed in the sequence, which was the point of the exercise.

**Component library**

- `f.Cue` (new). `Player` gains nothing; the segmented 2D/3D switch and
  the transport stay app chrome off the timeline.
- The apps stay ordinary regions with their own `<Choreo>` inside. A cue
  reaches them by **actor port** when they have one and by visible text
  (`@payload`, the composition doc's compatibility adapter) when they do
  not; the sketch says which with `@via="text"`.
- The icon→panel flight (named poses, never measured) stays the app's
  own presence animation; it is what `open` triggers, not a film node.

**Parameters**

- **`@picture` accepts a region, not only a page.** The mockup's picture
  is a CSS3D plane plus a GLB in the same document; its port is two
  calls, `pose(Camera3DState)` and `tint(hex)`. `Picture` becomes a
  minimal interface with optional members, and `@picture={{this.stage}}`
  hands in a component.
- **`@lens="2d" | "3d"`.** One score, two lenses: the same `f.Shot` poses
  drive `c.Camera3D` in 3D and `c.Camera` in 2D. The film decides which
  step a shot compiles to; the shots do not change.
- **`@tracks={{hash camera=this.cameraOn cues=this.syncOn}}`.** A muted
  track keeps its length (the mockup swaps each step for a Wait by hand,
  in the template, twice). The handle gains `f.mute('camera')` /
  `f.resume('camera')`. The demo's notes describe two switches (a drag
  mutes the camera, a tap mutes the cues); its code has since decided
  "stop means stop" and either gesture stops both and the film, because
  a muted track is still a clock ticking through a film nobody can see.
  Both readings fit `@tracks`; the sketch keeps the two switches and the
  policy is the app's. The self-tap guard (a cue's own click must not
  count as a touch) moves into the library.
- **`@end="loop"`.** The take bump (`{{motion id="clock"}}` widened by one
  pixel per lap so the region recompiles) is the loop spelled by hand.
- **`@autoplay`.** A gallery card does not run a film: the stage opens
  paused when there is no room.
- **`@onCueReset`** replaces `@onPerformReset`: a backward seek cannot
  un-execute a cue; the actor is told to reset and the prefix replays.

## 2026-09-03 · Long Take — one shot, two cameras, no cuts

`examples/long-take.gts`: a laptop whose screen holds a drawing that never
changes; a camera inside the screen (`c.Frame`, `c.Aim`, `c.Pan`,
`c.SlowZoom`) and a camera outside it (`c.Camera3D`) reading one list;
two regions kept in step by a rAF loop that seeks the inner run to the
outer when they drift past a thirtieth of a second. The opposite test to
the mockup: this film wants no cut and no join, so what the graph gives
it has to be something else.

**Syntax**

- **`f.Lane @in="region"`** — a `c.Sequence` that lives in a shot but
  plays in an attached region, on the shot's clock. It yields that
  region's constructs (`as |b|`), so the inner camera is written as
  `<b.Frame @of={{b.id "capsule"}} @padding={{0.58}} @duration={{2.0}} />`
  followed by `<b.SlowZoom @by={{1.05}} />`, whose duration is the rest of
  the shot when omitted. "One list, two cameras" stops being a rule the
  shot list enforces and becomes what a shot is.
- **A spine with no `@join`.** A boundary is where the next pose begins;
  the camera travels through it. The two films' `dip` and `wipe` were
  film choices and say so explicitly; the mockup's `cut` is the zero-length
  seam; the long take's absence is the third meaning, and it is the
  default.
- **An attachment for the whole film**: `f.Attach @to={{f.head}}
@for={{f.runtime}}` places the board once; `f.runtime` is the spine's
  total, read not declared.

**Component library**

- `f.Lane` (new). No inner-camera components are added to the film
  package: a lane yields the region's own `Frame`, `Aim`, `Pan`,
  `SlowZoom`, `Camera`, so the board's vocabulary stays the board's.
- `Board` loses its score, its `@playing`, its `@take` and its `@onRun`;
  it becomes what the demo's own header says it is — a drawing with
  stations that carry `motion` ids, and nothing that animates.
- The sync modifier, the slop band and the take counter are deleted, not
  moved: a driven run cannot drift from the clock that drives it.

**Parameters**

- **`@seek="exact"` is the natural mode here** and costs nothing: no
  changeset, no cue, no spring in the film. The demo already argued that
  every camera step is seekable by construction; that argument is the
  whole precondition for attaching a region, and it should be checked at
  compile time (a spring or an integrator inside an attached region under
  an exact film is a refusal).
- **`@lens="still"`** joins `"2d" | "3d"`: the picture is a photograph of
  itself at rest (`@still={{hash src width height}}`, the screen a
  transparent hole the attached board composites through), the film stands
  at its head, and the transport is not rendered. The memo's "a film's
  cheapest representation is a photograph of itself", as an argument.
- **The resume rule on the handle.** `f.play()` resumes the run standing
  there; `f.restart()` cuts a fresh one. The demo found the throb — a rapid
  double press stacking two films — and wrote the rule as a comment; the
  handle should make it the only way to press play. `@tracks={{hash
camera}}` is the one switch this film has.
- **`@ease`** on the film is the editorial curve every shot glides on
  unless it says otherwise (`GLIDE` in both this demo and the mockup).

## 2026-09-03 · Filters, and no `hash` — from the rationalisation

Two corrections from reading the four sketches together (`CONSTRUCTS.md`).

**Syntax**

- **No `hash`.** A parameter set is flat typed args, a typed child, a
  named block, or a contextual component the owner yields — never a bag.
  The shot's head pose is now its own arguments (`@dolly @yaw @pitch
@lookY @ox @fx @fz`), the tail pose is `<f.To …/>`, the eye-level walk
  is `<f.Eye @from @to @fov />`; the picture and the still are `<:picture>`
  and `<:still>` blocks; group defaults are flat (`<f.Sequence @cut
@hold @bob>`); `Player` takes `@title` and `@sub`; `@tracks` becomes
  `@mute={{array …}}`.
- **Filters replace `f.Air`, `f.Build`, `f.Mix`, `f.Lineup`.** An actor
  declares its parameter sets as typed components; the film yields them
  under the actor's name: `f.picture.Look / Weather / Sun / Winter /
Light / Set / Build`, `f.sound.Mix`. Object-valued knobs (`sun`,
  `winter`) became their own filters with flat args; `winter: null` is
  `<f.picture.Winter @off={{true}} />`.

**Component library**

- The package ships a `Filter` base class and nothing named after
  weather. `SagradaPage` and `TowersPage` (the iframe pictures, as
  components) declare their own filters and presets; `GRADES`, `LOOK_FX`,
  `LUT_AMOUNT`, `CITY_GLASS` leave the film and become the page's.
- `f.To`, `f.Eye` join the package as shot children.

**Parameters**

- `<Film>` loses `@picture`, `@grades`, `@lookFx`, `@lutAmount`,
  `@still`, `@tracks`. The picture's own knobs (`@standing`, `@seat`,
  `@rigMid`, `@cityGlass`, `@cloudHaze`, `@lutAmount`) are arguments of
  the page component inside `<:picture>`.

## 2026-09-03 · Sylva — the film that derives its shots

`sylva-stage.gts`: a moss world, four live cards hole-punched into it, a
camera that never stops (one `@through` spline over eleven waypoints),
presents clipped into the flight, hand-offs as cross-fades, a narration
lower third on the same beats, a lap that goes round again. Nobody typed
the reading poses: the scene derives each from the card's anchor and its
normal, and the swing either side of square-on is one rule applied four
times. The design record's "hand the construct a waypoint provider".

**Syntax**

- **A custom shot kind.** `class Read extends Shot` with `node()` — the
  composite-step contract at the film level, no library privilege. Five
  published handles (`@of`, `@swing`, `@push`, `@truck`, ticks); the pose
  is not an argument.
- **Picture anchors are 3D beacons.** `@of={{f.picture.anchor "moth"}}`
  is a query, the way a board shot's `@of={{b.id "capsule"}}` is: it
  returns the anchor's point and the reading pose the scene derives from
  its normal. The shot's `@look` takes a point (`{{array 0 0 0}}` for
  home). Yaw unwrapping between waypoints moves into the library.
- **`@tick` on the spine.** Sylva's uniform segment (31 s over eleven
  waypoints) is exactly the two films' `TICK = 2` rule — a shot's length
  is its waypoint count — so `ticks` stays and the tick becomes a spine
  parameter, not a constant. The spine's own args are the rest pose the
  lap opens from and returns to.
- **`f.Plane @name @z @policy`** — the compositor doc's plane, finally
  needed: two attachments on the same plane with `replace` means the
  newcomer's entrance is the leaver's exit (the mid-flight cross-fade).
  `@plane="cards"` on an attachment names it; `@until={{f.next "cards"}}`
  ends a window when the next thing on that plane arrives.
- **An anchor with an offset.** `{{at "moth" 0.5 -0.9}}`: a card is
  presented 0.9 s BEFORE the reading waypoint is crossed, airborne. `at()`
  gains a third argument.
- **`f.Type` takes `@plane`, `@at`, `@until`** like any attachment, so the
  narration swaps on the card's beat and holds across the travel.

**Component library**

- `Shot` is exported as a base class (as `StepComponent` is), with
  `this.shot({...})` building the segment. `Read` lives in the app.
- `FieldCard`: a region the film does not own, with a live button that
  reaches back into the world through `f.send` — the compositor's
  semantic action bus on the handle (`send(actor, action, payload)`),
  which is also what a dot uses to open a card and fly the hand-camera.
- `MossWorld` in `<:picture>` declares anchors (queries), actions
  (`fly`, `flush`, `burst`, `breeze`) and no filters; the wren's song is
  the sound actor's.

**Parameters**

- **`@chrome`**: `?film` strips the dots; `f.chrome` is readable so the
  app's own controls can hide with the film's.
- **`@lens="still"` by context**: the tile face is the poster, the same
  idea as the long take's photograph of itself.
- **`f.toggle`, `f.playing`, `f.pause`, `f.next(plane)`** on the handle.
- A visit is a seize (`f.pause()` then two `send`s); the film's own
  opens are cues folded through the clock, so a scrub back re-derives
  which card is up — `resetPerform` is the reset half of that contract.

## 2026-09-03 · "Adjustment", not "filter" — decided

Chris: rename the base to `Adjustment`; keep `Filter` for the frame ops.

**Syntax** — none; `f.picture.Weather` and `f.picture.Look` read the same.
What changed is what they are: `Weather`, `Sun`, `Winter`, `Light`, `Set`,
`Build`, `Mix` extend `Adjustment`; `Look` (grade, look, lut) extends
`Filter`, which extends `Adjustment`.

**Component library** — `Adjustment` and `Filter` are the two base
classes the package ships in place of `Filter` alone. A filter is the
kind of adjustment whose target is the frame, so the seam can freeze it
with the still and the package can order it after the values it reads.

**Parameters** — none. The precedents are in `CONSTRUCTS.md`
("Adjustments — what `f.Air` should have been").

## 2026-09-03 · Replate — is it an adjustment?

The Cursor agent's `examples/replate.gts` (uncommitted, in the
choreo-gallery checkout): a plate of Premiere; our clips warped onto the
program monitor through a keyframed keystone; his scrub read off the
timecode and stretched onto our composite; Film grades on the overlay
only. Seven still beats carrying nothing but `grade`.

**Verdict.** Not one thing. The grade is a **filter** (a frame op on one
attached clip — a clip filter, not an adjustment layer, since the plate is
untouched); the keystone is an **anchor** the picture publishes per frame;
the clock remap is the attachment's **time map**; the A/B/A/B is a
**reel**. One of the four is an adjustment, and it is the frame-op kind.

**Syntax**

- **`f.Attach @map`** — parent time → source time as a curve. Every tool
  in the survey has it (AE Time Remap, FCP `timeMap`, OTIO `LinearTimeWarp`,
  Lottie `tm`, Rive remap, Unreal's non-linear sequence transform) and the
  sketches' Attach only had its linear case (`@in @out @rate`). A map is a
  Value; the linear tuple is its special case.
- **Anchors that move.** `f.picture.anchor "monitor"` is a beacon the
  picture publishes per frame (four corners read off a table); an
  attachment `@to` an anchor is corner-pinned to it. Sylva's anchors were
  fixed; Replate's is keyframed. Same query.
- **Adjustments yielded per attachment.** `f.ours.Look` — the attached
  reel declares its own filter set the way the picture does, and the film
  yields it under the attachment's name. A chapter-level `f.ours.Look` is
  an adjustment layer over the overlay and not over the plate.
- **A reel of clips.** `<f.Spine>` inside an attachment, `<Video @in @out>`
  items; concatenation of media is the same node as concatenation of
  films.
- **Outputs on the handle.** `f.time` and `f.at "ours"` (an attachment's
  mapped time) are readable, so the two-clock panel reads them instead of
  listening for a `postMessage` from the page.

**Component library**

- `Video` as a spine item (`@src @in @out`), driven not played: the
  page's `seekVideo` is already this.
- `PremierePlate`: a video actor with one published anchor and two actions.
  Its `MONITOR` and `SCRUB` tables leave the page.

**Parameters**

- `@end="card"` — the memo's third end policy (loop, hold, card) named.
- The seven beats reduce to two chapters and two `Look`s; `@tick={{2}}`
  keeps their timing.

---

## The seam, revised twice while the films were watched

Not a demo entry: two revisions the reference films forced on the join
vocabulary after the rewrite landed, kept here because both are about
what a `Join` MEANS rather than how it is spelled.

**Syntax** — unchanged. `<f.Join @presentation @secs>` survived both.

**Component library**

- `Seam` (`film/seam.ts`) — the gate a join goes through before it plays.
  A join's still is a JPEG the browser has not decoded on the frame it is
  handed over, and the lens moves on that frame, so the seam played
  backwards: three frames of the incoming shot, then the freeze, then the
  transition. `Seam.hold(still, cut)` decodes first and holds the cut. It
  is not part of the graph vocabulary and is not yielded; a score never
  names it. It belongs in the library because every presentation that
  takes a `@still` inherits the problem, including one an app writes.
- A presentation contract that took a DECODED image rather than a data
  URL would push the gate into the type system. Worth considering when
  `Value` lands: `@still` as a resource with a ready flag reads better
  than a string plus a gate the film owns.

**Parameters**

- `cap` on the gate (120 ms) is the only new number. It is a failure
  budget, not a timing knob, and is not exposed on `Join`.
- The seam's LAYER is still owed a parameter. Chris asked for the
  incoming clip's type to enter from the start of the transition, which
  needs the seam above the type; tried once, it regressed. Whatever
  lands, it is a property of the join ("does this seam cover the
  furniture, or only the picture?") and belongs on `Presentation` beside
  `secs` and `still` — not on a stylesheet's z-index.

**Parameters, added after the comparison chapter was watched**

- `@over` on `Join`, `Spine`, `Chapter` and `Sequence` — `picture` (the
  default) or `everything`. The middle tier of the sketch, `frame`,
  turned out not to be a tier at all: the wash, the cloud and the dim
  moved into the picture's post pass, so the picture IS the frame and
  every seam covers it by construction. Two values, not three.
- `Presentation.over` — a brought presentation's own default depth. A
  curtain that drops in front of the picture and leaves the caption
  standing in front of it is not a curtain.
- The wash is `.cf-scrim-{lower,title,plate,point}`, a radial gradient in
  the scene's palette chosen by the shot's `mode`. It is the one piece of
  the frame's dressing that is neither in the shader nor in the seam, so
  it snaps on the cut frame while the picture dissolves. That is the bug
  Chris saw behind the black-freeze bug.

**Component library, after the move**

- Two optional port members, `wash(mode, paper)` and `cloud(k, rakeDeg)`.
  They are the film telling the picture about layers the PICTURE now
  draws, which is the same shape as `f.picture.*` adjustments: the actor
  owns the vocabulary, the film hands it values. A picture that does not
  offer them keeps the film's CSS layers, so this is additive.
- `.cf-scrim-*` and `.cf-cloud` survive in the stylesheet as the fallback
  path only. Nothing in a score names them either way.

**Parameters, after the tier landed**

- `@over="everything"` takes the incoming type's wait to zero. That is
  the point of it — the setting is under way when the sweep reveals it,
  not starting when the sweep is over — but it moves every beat's type
  ~1.6 s earlier in a film that turns it on at the spine, and `sayAt`
  derives from `typeAt`, so the line cues move with it. Towers runs on
  it, and so does Sagrada — Chris watched the towers cut and asked for
  it on both ("the transitions look much better").
- The cost, measured headless over 45 s of the blend chapter: 4 frame
  read-backs, 69 ms total, 17 ms worst, and 6 frames over 25 ms against
  4 without. `everything` cannot use the picture's own glass, so the
  three dissolves it would otherwise hold there take a still instead.

**A question worth recording, because the answer was not the obvious one**

Chris, on seeing the tier: "did you change the grading? looks much more
washed out." No — and the diff proves it. Across both picture pages, all
of today's work REMOVED exactly two lines, and both were replaced by
supersets; nothing in the grade, the LUT, the tone curve, the split tone,
the vignette, the lift or the grain was touched. Settled frames measure
the same on the branch and on main:

| shot | main mean / stdev | branch mean / stdev |
| ---- | ----------------- | ------------------- |
| 2    | 153.3 / 30.6      | 151.5 / 33.8        |
| 6    | 161.5 / 25.9      | 163.6 / 26.4        |
| 9    | 202.5 / 28.8      | 202.6 / 28.7        |

What actually changed is the film IN MOTION, and it is the black-freeze
fix. Over the same 18 s of the blend chapter, the darkest frame on main
has a mean of 33.2 and fourteen frames fall under 100; on the branch the
darkest is 110.3 and none fall under 100. Every crossfade used to punch
to near-black and climb back — twenty-odd times a run — and that darkness
was doing a lot of the film's perceived contrast. Take it away and the
film reads flatter, even though no frame of picture changed.

So if it now wants more contrast, the lever is the grade or the seam
length, not a regression to hunt.

**Three things Chris caught watching the tier, and what they were**

- _"a big white background word flashes before the first transition,
  after it already faded out."_ Real, and OLDER than any of this — the
  same log on origin/main. The sky word's opacity is `skyOn` times the
  beat's own in and out, and the out takes it to nothing by 68% of the
  beat; but when the next beat had no word the film handed the picture
  `skyOn` alone to fade from, a number still sitting at 0.92. So a word
  gone for five seconds snapped back to 92% on the frame after the cut.
  Now the film fades from what the word is actually wearing (`skyA`).
  Measured: `fade('chapter', 0.9201)` one frame after the cut on main,
  `fade('chapter', 0)` after the fix.
- _"the dip isn't super smooth. are there better curves?"_ Yes, and the
  reason is compositing space, not easing. See docs/film.md §5.5.
- And the tier's own regression, found while measuring the dip: the
  decode gate defers the CUT but not the BEAT, so the hour, the build
  clock and the model landed two or three frames before the seam had
  anything over them. On the towers dip that was one full frame of a
  bright empty site in the middle of a night shot. Fixed with
  `Picture.freeze(on)`: the picture pins its own last frame for the
  length of the gate. Nothing else could — the still is in the DOM and
  the world is in the canvas.

## The reel, and what a second picture proved

Not a demo revision: the transition reel (`/_seams`) is the first score
written against a picture that is not one of the two films, so it is the
first honest test of the vocabulary.

**Syntax** — nothing new was needed. `f.Spine`, `f.Chapter`, `f.Shot`,
`f.Join`, `f.Type`, `f.picture.*` all carried over to a picture made of
five images without a special case, which is the result worth recording.

**Component library**

- `f.Inset @x @y @w @radius @fade` — a picture in the picture as a LAYER,
  distinct from `f.Insert`, which is the editorial photograph in a paper
  card. Two objects, not one with a flag.
- `PictureSpec.seams` and `Picture.seam(SeamSpec)` — a picture declares
  the transitions it can run and the film reaches them by name, so the
  seam vocabulary is open on the GPU side the way it was already open on
  the DOM side.
- `Picture.freeze(on)` — pin the frame while a DOM seam's still decodes.
  The reel hit the same bug the films hit, in a brand-new picture, which
  is the argument for it being part of the contract rather than each
  picture's business.
- `window.__choreo[name]` and `scripts/film-render.mjs` — an exact film
  rendered rather than recorded.

**Parameters**

- `@secs` now counts for a NAMED join, not only for a brought component.
  It is how a picture-declared seam gets its length, and it lets a score
  retime one of the film's own.
- `@over` is unchanged and both films run on `everything`.
- `SeamSpec.params` is declared and unused. It is where a centre, a
  direction and a softness belong; theirs has no such channel at all and
  hardcodes those in the GLSL, so this is worth building rather than
  copying.

**The smell this turned up.** A beat carries ONE clip. Two `f.Inset`
children on a shot compile to one row and the second silently wins. Every
other attachment on a beat is plural or scalar for a reason; this one is
scalar by accident.
