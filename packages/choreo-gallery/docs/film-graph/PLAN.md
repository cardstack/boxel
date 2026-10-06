# Making the graph the baseline

> Status: proposed, 2026-09-03. The question was "are you comfortable
> with this refactor, and what does it take to make it the baseline —
> engine, sample code, documentation?" This is the honest answer: where
> the confidence is, where it is not, and the work in order.

## Comfort, stated exactly

**Confident, and would build on it now:**

- The model: a spine of items, everything else attached, three
  relationships (contained / attached / triggered), and the rule that the
  film is a pure function of one clock under `exact`. Six sketches from
  six different demos all fit it without a special case, and every
  mechanism in it has a precedent in a shipping tool.
- The rationalisation to **two engine constructs**. Attach's first face
  is already running in production: `Plate @grab` plus the exact-mode
  time write is the driven run, spelled privately. Value's invariants are
  already enforced for `c.Follow`. Neither needs a new idea, only a public
  name and a contract.
- Adjustments and filters as components the actor declares. This is the
  change with the best cost/benefit: it deletes four package nodes, moves
  vocabulary to the page that owns it, and gives Glint the types.
- The beat table as a compiler input. The two films' data does not
  change, so the migration risk for the shipping films is low and
  measurable.

**Not yet confident — each needs a spike before its phase is committed:**

1. **`f.Lane @in` (Attach's second face).** Registering steps from a
   parent into a child region's `collect()` is plausible through the
   registry's `WeakMap<Element, Provider>`, but nobody has done it. The
   child's queries (`b.id "capsule"`) must resolve in the child's
   changeset while the cue sits on the parent's clock, and a parent
   re-render must not replay the child's pass every frame (the tracked
   write → replay loop the build-order transport documents). One demo
   proves or kills it: the long take.
2. **Seams under attachments in exact mode.** Today `refreeze` stands the
   page at the previous beat's tail, snapshots, then applies the incoming
   beat. With attachments driven from the same clock, the order in which
   a seek re-derives the picture, the still and the attached windows has
   to be pinned, or a seek into a seam shows an attachment from the wrong
   side of the cut.
3. **The picture as an actor across an iframe.** `f.picture.Weather` in
   the sketches is an Ember component, but both pictures are separate
   documents. The honest shape is a wrapper component (`SagradaPage`,
   `TowersPage`) that owns the iframe and declares the adjustments in
   Ember, forwarding to the port. That is work on two pages, and it means
   the port stays a method list underneath for now.
4. **Value / Bind / ports.** Designed twice, built never. It is the only
   piece that can hurt what works today, which is why it is last and why
   it is not on the path to "baseline".
5. **Three of the twelve joins are not presentations.** `blend`, `melt`
   and `dip` run in the page's GL (`Picture.dissolve`) and only fall back
   to a DOM still. A Join is therefore a presentation _or_ a cue to the
   picture, and the composite has to carry both.

**One prerequisite that is not design.** The main checkout carries an
uncommitted restructure moving the test app into `packages/choreo-gallery`
(the Cursor agent's work, where Replate lives). Every path in this plan
assumes `test-app/`. Land that restructure or drop it before Phase 1,
or the migration is rebased twice.

## What "baseline" means, concretely

Three things have to be true at the end, and each is testable:

- **Engine:** `Attach` and `Value` are in `packages/choreo/src`
  with contract tests; `mute`, `bias` and path names are on blocks; the
  run has `loop` / `hold` / a resuming `play()`.
- **Sample code:** every film and film-shaped demo — Sagrada, Towers, the
  Mockup, the Long Take, Sylva, Replate — is written the way its sketch
  in this folder is written, and the old `FilmSignature` with its
  thirty-five arguments is gone.
- **Documentation:** `docs/film.md` describes the graph; `docs/choreo-constructs.md`
  §3 lists Attach and Value with the other constructs; this folder's
  memo, sketches and revisions log become the design record.

The invariant that makes the whole migration safe to attempt: **the cue
table and the camera path are the film.** Dump them once from the
current engine and every phase must reproduce them to the frame.

## The phases

### Phase 0 — Ground truth (one PR, no behaviour change)

> **Landed 2026-09-03** (this branch). The restructure was parked on
> `wip/choreo-gallery-restructure` and main reset to `origin/main`. The
> schedule — `totalSecs`, `secsBefore`, `beatStart`, `cues`,
> `chapterHeads`, `contents`, `joinInto`, `tailFor`, `waypoints` — is
> `packages/choreo/src/film/schedule.ts`, pure, and `film.gts`
> delegates to it. Both films' data moved to `test-app/app/lib/films/`
> (no Ember in them). `scripts/film-fixtures.mjs` writes
> `test-app/tests/fixtures/film/{sagrada,towers}.json` headless on
> Node's type stripping (`--check` for CI); `tests/unit/film-schedule-test.ts`
> asserts the schedule equals them to the digit. Sagrada: 29 beats,
> 170 waypoints, 340 s. Towers: 26 beats, 137 waypoints, 274 s. Both
> glints and the full test-app suite pass.
>
> **Both spikes done** the same day, on `spike/lane` — results in
> `SPIKES.md`. Spike 1 passes on all four claims with a twenty-line
> additive door (`contribute`, `choreoHostById`); spike 2 pins the fold's
> order as picture → still → seam → driven runs, which it already has, and
> adds one rule: adjustments are picture state the fold asserts, so
> `refreeze` grades the still. Phase 1 is unblocked.

- Settle the choreo-gallery restructure (above).
- **Golden fixtures.** A test-only export from `film.gts` that serialises,
  for each film: `beatStart(i)` for every beat, the camera waypoint
  list with cut splices, the cue table (action, target, delay), every
  clip window, and the seam kinds. Write them to
  `test-app/tests/fixtures/film/{sagrada,towers}.json`. This is the
  regression harness for everything below; today there is exactly one
  film unit test (`film-clips-test.ts`).
- Spikes 1 and 2 above, as throwaway branches with a written result each — done, see `SPIKES.md`.

Touches: `film.gts` (an export), two fixture files, two spike notes.

### Phase 1 — Attach, first face (engine + film, two PRs)

> **Landed 2026-09-03** (this branch, one commit): `AttachStep` /
> `c.Attach` in the engine (`types.ts`, `compile.ts`, `steps.gts`,
> `run.ts`, `registry.ts`, `choreo.gts`) with five contract tests
> (`tests/integration/choreo/attach-test.gts`): driven equals seeked, hold,
> remove, the exact refusal (once, loudly, never driven), and several
> windows on one region resolved to one governing window per evaluate.
> The film's plate, insert and clip are windows in the score; `@grab`,
> `plateCtx`, `plateRun` and the fold's plate write are gone. Golden
> fixtures unchanged. **Deferred to Phase 2**, where `f` exists: the gate
> and the end card as attachments at `f.head`/`f.tail`; `bias` as a
> number; the first-pass compile for regions with contributors.

**Engine.** In `choreo/types.ts` a new node kind, `attach`: a block whose
children are the child region's compiled score, with the edge tuple
(`to`, `at`, `for`, `in`, `out`, `rate`, `map`, `end`, `lane`, `bias`).
In `compile.ts`, an attach contributes its extent to the parent's flow
(measured from the child unless `for` says otherwise) and its names as
`attachment/name`. In `run.ts`, on every evaluate the parent writes
`child.run.time = map(t)` through `resolveClip`'s window arithmetic,
which already exists and is already tested. `bias: number` replaces
`generic: boolean` (generic becomes 0). Contract tests: driven equals
seeked at every `t`; the three end policies; a spring inside an attached
region under `exact` is a compile-time refusal; names across nesting.

**Film.** `<Plate>`, `<Insert>` and `<Clip>` re-attached through the new
node from the film's template; `@grab`, `clipState` and the exact-mode
`plate.time` write deleted. The gate and the end card become attachments
at `f.head` / `f.tail`; the three named blocks go. **Golden fixtures must
not change.**

Touches: `types.ts`, `compile.ts`, `run.ts` (~300 lines new), `film.gts`
(net deletion), `plate.gts`, `clip.gts`, `titles.gts`.

### Phase 2 — The film package on the graph (the big one, three PRs)

> **Steps 1 and 2 landed 2026-09-03.** `film/graph/`: `compile.ts` (pure:
> a tree of plain nodes → `Beat[]`, `Chapter[]`, `voSecs`, `voGain`,
> the default join), `nodes.gts` (markers walked in document order:
> Spine / Chapter / Sequence / Shot / To / Eye / Join / Type / Voice /
> Stamp / Sky / Mark / Trace / Lineup / Attach around Insert / Freeze /
> Video), `adjust.gts` (`Adjustment`, `Filter`, and the iframe picture's
> set yielded as `f.picture.*`, `f.sound.Mix`), `host.gts` (`FilmGraph`,
> which yields the vocabulary and compiles a frame after render).
> `<Film>` wraps its default block in one and reads the graph when no
> table is given; the default block is given `FilmContext = FilmHandle &
FilmVocabulary`. Both films' scores were GENERATED from their tables
> (`components/films/*-score.gts`, `tograph.mjs` with `PREFIX='@f.'`),
> `tests/integration/film/graph-test.gts` asserts each compiles to its
> table row for row, and both film components now render the score
> instead of handing in `@beats`. Fixtures unchanged. Step 3 (the page
> wrappers, joins as presentations, the argument surface) is next.
>
> **Chris's first watch of the migrated films (2026-09-03):** "works;
> some positioning of text is a bit different, wipes are a little less
> smooth." Two causes found and fixed the same day: (1) the graph host
> was a `div` in the film page's flex column — now `display: contents`;
> (2) `c.Attach` seeked its children every frame even while the parent
> PLAYED, turning the plate's natively-played entrance into per-frame
> seeks — now **play when playing, seek when seeking**: a playing parent
> lets the child play (corrected past 1/30 s of drift, speed = parent ×
> rate), a paused or scrubbed one holds and writes; `pause()` and the
> end hold what they drove; a run seeked back inside itself un-ends. The
> drive had also been wired into `restill` rather than `evaluate`, so a
> playing tick never drove at all. Remaining 2% to chase with Chris
> after step 3: whether the text position is old behaviour or new.
>
> **Step 3, the picture (2026-09-03):** `film/picture.gts` — `PictureSpec`
> and `IframePicture`, a component in the film's `<:picture>` block that
> registers its spec a frame after render and declares `f.picture.*`.
> Sixteen picture-side arguments left `FilmSignature` (`src`, `assets`,
> `title`, `standing`, `seat`, `rigMid`, `cityGlass`, `cloudHaze`,
> `lutAmount`, `grades`, `lookFx`, `worldType`, `accent`, `gradeLum`,
> `poster`, `srcdoc`); what remains is about the edit: `name`, `menuTitle`,
> `menuSub`, `build`, `seek`, `join`, `clock`, `rail`, `embed`, `voGain`,
> `voSecs`, `onAir`, `onBeat`, and the compiled-form `beats`/`chapters`.
> Both films migrated. **Decided:** the gate and the end card stay named
> blocks — a named block is one of the four idiomatic parameter forms and
> the door is exactly a block of matter the film hosts; the memo's
> `f.Attach @to={{f.head}}` sketch is withdrawn. **Deferred, with reason:**
> joins as presentations — the seams are the part Chris is watching for
> smoothness, and a rewrite of `joins.gts` belongs after parity is
> confirmed, not before.
>
> **Parity, measured (2026-09-03).** origin/main served on :4202 and
> film/graph on :4201; the same `?embed&from=N` peeked headless on both
> (`scripts/film-peek.mjs`) and the PNGs read side by side: Sagrada apse
> (from=1), Gaudí plate (from=7), Towers Azuchi plate (from=2) and the
> timber stage (from=6). **The type sits on the same pixels in every
> pair**; the lens differs by a few pixels, which is the cut-mode chaser
> — a spring whose state is its history — doing what it always did, and
> it moves every world-anchored word (stamp, sky, mark) with it. That is
> the honest answer to "text positioned a bit different": old behaviour,
> the film's own hand. The comparison also found two REAL regressions,
> both from rows arriving a frame late: `?from=N` clamped against zero
> rows at construction (every deep link became −1) and the film booted
> before it had a first shot to stand on, so an embed sat at 0:00 for
> ever. Both fixed: the deep link clamps when read, the boot waits for
> rows (the mount modifier reads them, so it re-installs when they land).
>
> **The joins rewrite (2026-09-03), after Chris confirmed the wipes.**
> `joins.gts`: the twelve as presentation components on one contract
> (`PresentationSignature`), a `PRESENTATIONS` registry with lengths and
> whether a still is needed, `<Joins>` rendering whichever the kind names;
> `JOIN_SECS` and `STILL_JOINS` derived from it. A score brings its own
> with `<f.Join @presentation={{Curtain}} @secs>`: the compiler names it
> `presentation:N`, the film merges it into its registry, `JoinName`
> widens `Beat.join`. Proof: `join-presentation-test.gts`. One behaviour
> changed on Chris's direction and stands: a seek into a seam stands at
> its END instead of re-freezing (`refreeze` deleted, the read-back per
> scrub gone). A second — lift the seam layer above the type so the
> incoming clip's type animates from the START of the transition rather
> than after it — was tried, regressed on Chris's screen ("visible gap,
> repeated janky, extra copies of building") and was reverted at the
> time. It LANDED later as `@over="everything"`, once the still was made
> to match the frame it froze; the earlier attempt failed because it was
> sweeping a still that did not. Both films run on it.
>
> **The freeze frame was one frame late (2026-09-03).** Chris filmed it
> (`one-frame-early.mov`, 60 fps): at the title→shiro wipe, three whole
> frames of the INCOMING close-up, then the still of the outgoing wide
> shot, then the wipe. Read frame by frame the seam played backwards.
> Cause: the still is a full-resolution JPEG data URL, and a JPEG handed
> to the DOM is not paintable on the frame it is handed over — Chrome
> decodes it off the main thread — while `pose({snap})` moves the lens on
> that same frame. Fix: `Film.whenDecoded` (film.gts) decodes the frame
> into the memory cache FIRST and holds the whole seam — the lens snap,
> the overlay, the iris projection — until it is ready, so the DOM image
> paints from that decode on the frame it is inserted; a seam overtaken
> by the next one never runs, and a decode that never returns is not
> waited on past 120 ms. Both `applyBeat`'s seam and `seamExact` go
> through it. Measured over CDP at the towers wipe: the lens now moves
> 42 ms after the read-back instead of 33 ms (the read-back's own cost),
> the extra being the decode. The flash itself does NOT reproduce
> headless — SwiftShader renders the incoming camera slowly enough that
> the still always wins the race — so this one needs Chris's own eyes on
> a GPU at retina scale.
>
> A separate, older oddity the frame-by-frame comparison turned up, on
> BOTH builds and unchanged by any of this: the still is not quite the
> frame that was on screen. At the same wipe the live outgoing frame
> shows the tower on its stone base; the still one frame later shows it
> hazed out, differing by the same amount (~13/255 mean) on main and on
> this branch. `Picture.snapshot` re-renders the scene itself
> (`renderer.render(scene, camera)`) rather than reading back the frame
> the post chain composited, which is the likely reason. Not chased.

1. **`Film` yields `f`.** `Spine`, `Chapter`, `Sequence`, `Shot`, `To`,
   `Eye`, `Join`, `Attach`, `Cue`, `Type`, `Voice`, `Stamp`, `Sky`,
   `Mark`, `Trace`, `Plane`, plus `head`, `tail`, `runtime`, `chapters`,
   `send`, `next`, `time`. `Shot` is exported as a base class with
   `node()` and `this.shot({...})`, the way `StepComponent` is.
   Inheritance (`@join`, shot defaults, group adjustments) resolves in
   the package's compiler before nodes are built.
2. **The table compiler.** `<f.Shots @table={{beats}}>` turns a `Beat[]`
   into the same nodes the template would. The two films migrate first by
   switching to it with their tables untouched — fixtures unchanged —
   and then by running `tograph.mjs` once as a migration tool to produce
   the templates in this folder. Delete the table path only when both
   films are on templates and the fixtures still pass.
3. **Adjustments, joins, chrome.** `Adjustment` and `Filter` base
   classes; `SagradaPage` and `TowersPage` wrapper components declaring
   `Look`, `Weather`, `Sun`, `Winter`, `Light`, `Set`, `Build` and
   forwarding to the port; `GRADES`, `LOOK_FX`, `LUT_AMOUNT`, `CITY_GLASS`
   move into them. `joins.gts` rewritten as nine DOM presentations on the
   crossing contract plus three picture cues, the enum deleted, one custom
   presentation written in the test-app as the proof. `Player` takes
   `@film`, `@title`, `@sub`. `FilmSignature` shrinks to `name`, `title`,
   `seek`, `clock`, `voGain`, `embed`, `lens`, `mute`, `ease`, `end`,
   `autoplay`, `chrome`, `tick`.

Touches: all of `src/film` (a rewrite of the template and the argument
surface; the engine class — the score, the chaser, the voice, the
transport — moves mostly intact), the two film components (regenerated),
`sagrada-page.gts` / `towers-page.gts` (new), the type harness.

### Phase 3 — Attach, second face, and the demos (four PRs, one per demo)

- **Long take:** `f.Lane @in`, the sync modifier and take counter
  deleted, `Board` loses its score. The proof of spike 1.
- **Mockup:** `f.Cue`, `@by`, seconds, `@lens`, `@mute`, `@end="loop"`;
  the two hand-swapped Waits deleted.
- **Sylva:** `Read extends Shot`, `f.picture.anchor`, `@tick`, `f.Plane`
  with `replace`, `at(name, p, offset)`, `@until`, `f.send`. Yaw
  unwrapping moves into `Camera3D @through`.
- **Replate:** `@map` on Attach, a moving anchor, `Video` as a spine item,
  `f.ours.Look`.

Each PR replaces the demo's notes (`components/notes/*.gts`) with the
sketch's own explanation and keeps its catalog sample honest.

### Phase 4 — Value (last, separately argued)

`Value`, `Bind`, declared ports, `n.Anchor` on the projector; the stamp,
sky word, mark and trace re-cut on it; the rail's head and readout; a
panel generated from the declaration (`dialkit.md`); one automation demo
(a value in one reel driving an input in another). Behind its own
contract tests: purity, scrub round-trip, ordering, cycle refusal, no
layout writes. Not on the path to "baseline"; the first three phases
are useful without it.

### Documentation, alongside each phase

- `docs/film.md` rewritten as the as-built reference for the graph
  (Phase 2), keeping its §4 clock section verbatim — the load-bearing
  TICK offset does not change.
- `docs/choreo-constructs.md` §3 gains Attach and Value; §4 gains the
  driven-run and value contracts (Phases 1 and 4).
- `docs/step-vocabulary.md` gains the `Shot` base class beside
  `StepComponent` (Phase 2).
- This folder moves to `docs/film-graph/` as the design record: the memo,
  `CONSTRUCTS.md`, `REVISIONS.md`, the six sketches (Phase 2).
- The skills (`choreo-scene`, `motion-pattern`) point at the graph
  vocabulary once Phase 2 lands.

## Sizes, honestly

| phase | new engine code                                      | film / demo code                                                         | risk                                                            |
| ----- | ---------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------- |
| 0     | none                                                 | an export, fixtures                                                      | none; it is the safety net                                      |
| 1     | ~300 lines in three files, with tests                | net deletion in the film                                                 | low: the mechanism exists privately today                       |
| 2     | none                                                 | the largest: `src/film` re-templated, two page wrappers, joins rewritten | medium: it is a rewrite of the surface, guarded by the fixtures |
| 3     | Lane (~150 lines), anchors with offsets, `@map`      | four demos                                                               | spike 1 decides the long take; the rest are straightforward     |
| 4     | Value (~400 lines, the derive machinery generalised) | stamps, traces, rail, a panel                                            | high: the only phase that can break what works                  |

What I would not do: start Phase 2 before the fixtures exist, or start
Phase 3's long take before spike 1 has a written result. What I would do
first, this week: Phase 0 and the two spikes, because they turn every
"probably" above into a yes or a no.

## The constraint that is now lifted (2026-09-03)

Every change on this branch was measured against `origin/main` frame by
frame, and a visual difference was a regression to explain or revert.
Chris ended that after watching the tier:

> ok as you work on example, okay to update the film to use the current
> techniques. and okay to change how crossfade work so that our engine is
> consistent, even if it means film will look slightly different. the
> film acting as behavioral reference have largely done their jobs.

So the two films may be modernised as the Phase 3 demos are worked
through, and an engine-level fix may land even when it moves their look.

**The fixtures are not covered by that.** They pin the SCHEDULE — beats,
waypoints, running time — which is timing rather than look, and they stay
the safety net for every phase after this one.

**The first thing it unblocks, and the tension in it.** A crossfade
composited in sRGB sags in the middle: measured on a towers blend, the
frame mean runs 140.3, 137.1, 135.1, 133.7, 132.9, 133.4, 135.2 between
endpoints of 140.3 and about 135, so the midpoint sits about 4.6 of 255
under the straight line between them. The fix is to mix in linear light,
and the only place that can happen is the picture's own glass, because a
DOM overlay's compositing space is not ours to choose.

But `@over="everything"` forces the DOM still precisely so the seam can
cover the type — and that takes the glass out of the path. The two wants
are in tension, and the way to have both is to stop putting a still in
the DOM at all: let the PICTURE crossfade in its glass, and give the
furniture layer the seam's own reveal — a matching alpha for a dissolve,
a matching `clip-path` for a wipe. The seam becomes two halves of one
gesture rather than one image over everything. It also deletes the frame
read-back the tier currently pays for. Worth doing before Phase 3's
demos, because they will all inherit whichever answer this gets.

## Status, end of 2026-09-03

Everything below landed on `film/graph` after the freeze-frame fix above.
CI is green on the branch head.

**The seam became two halves.** `Picture.seam` takes two numbers a frame —
how much of the held frame is over the live one, how much of a colour is
over both — and composites them in LIGHT; the film reveals the incoming
furniture with what they leave over. One progress, a pure function of the
clock, drives both. Measured on a blend: the mid-transition sag fell from
5.15 of 255 to 3.01, and the frame read-back the `everything` tier was
paying went from four per 45 s to none. Blend, melt and dip take that
path; a wipe and an iris are shapes and keep their still.

**Gap 1 and gap 3 closed** (see GAPS.md). A picture declares the seams it
can run and a join reaches one by name, which is how a transition can be a
shader at all. `f.Inset` places a layer in percent of the frame with its
own fade.

**The reel** (`/_seams`) is a second picture and a deliberately different
one: five plates and a WebGL quad, no scene, answering thirty-eight
required port members with about eight real ones. It exists to test the
seam system outside the two films it was lifted from, and it found four
bugs nothing else had — a length that never reached a named join, a freeze
that was captured but not pinned, a wipe that could sweep BACKWARDS at
some sun angles, and an exact film with no seams when rendered.

**Rendering is now a thing the engine does**, not something done to it.
`window.__choreo[name]` publishes `renderAt`, `scripts/film-render.mjs`
drives it frame by frame at a forced delivery size, and `Film.rendering`
distinguishes a render from a scrub so a rendered seam plays. The sample
reel renders at 1920×1080/60 in 3000 frames, reproducibly.

**Measured against hyperframes** (TRANSITIONS.md): we mix in light where
none of their fourteen do, our endpoints are computed where theirs are
assumed, and we correct aspect where one of theirs does. They are ahead on
breadth, and four of their ideas were taken — real rotated-octave noise, a
three-ring edge glow, the `p(1-p)` envelope on additive terms, and a
radial rather than lateral chromatic split.

**What is next, in the order I would take it.** The architecture note
Chris sent — Picture capabilities, then a filter stack above any picture,
then tracks, then the join compositor made explicit, then domain clocks.
Gap 2 (an adjustment on a clip) is the filter stack and is what the reel
cannot demonstrate. Gap 3's plural — one clip per beat — is the insert
track. Phase 3's four demos and Phase 4's Value are unchanged and still
behind all of that.
