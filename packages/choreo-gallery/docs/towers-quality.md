# Towers — the quality pass

The film at `/_towers` is the integration test for Choreo as a medium:
interactive storytelling on the web platform over a 3D engine. This is
the record of one pass over it — what was measured, what changed, in
which layer, and what the engine should take from it. Branch
`towers/quality`, cuts 8 and 9.

## The dimensions

A film on this stack can fail in more ways than a web page or a game
alone, because it is both. These are the axes the pass was run on, in the
order they were found to matter.

1. **Frame cost and heat.** Pixels through every pass — backbuffer MSAA,
   shadow map size and filter, post-pass sample count, device pixel
   ratio. On a laptop, heat is frame cost integrated over the runtime, so
   a frame that holds 60 fps at twice the necessary cost is still a
   failure.
2. **Compositor layers.** A CSS `filter`, `backdrop-filter` or
   `mix-blend-mode` on a full-viewport element is a second render pass
   the GPU runs every frame the picture moves, which in a film is every
   frame. Count them; the number should be zero while nothing is happening.
3. **Seam cost.** What the machine does at a cut. A synchronous readback
   of the drawing buffer is the single worst frame in the film, and it
   lands exactly where the eye is most sensitive.
4. **Idle behaviour.** A hidden tab, a still end card, a poster: the
   loops must stop, not draw the finished building into a frame nobody
   composites.
5. **Lifecycle and leaks.** Timers, listeners, media elements, GPU
   targets and geometry across a 4:48 loop that a visitor may leave
   running.
6. **Audio as an edit, not an asset.** Entrances, barge-ins, ducking,
   level matching, and whether a read fits its beat. "Clipping" as an
   editor means a line cut off; as an engineer it means a peak over 0
   dBFS. Check both.
7. **Type on the glass.** Entrances and exits as one vocabulary, one block
   at a time, never two settings dissolving through each other; a leaver
   that keeps its own layout while it fades.
8. **Camera language.** Cuts, dissolves, whips, dips, holds — the
   vocabulary of an editing room, and the move should be nameable in it.
9. **Tooling honesty.** A hidden pane starves `requestAnimationFrame`;
   an occluded window is hidden; a pane that reports `document.hidden`
   even when fronted. Every timing reading must say where it was taken.

## What was measured

Real numbers, foreground Chrome tab on the LG 4K display, 1432×678 CSS
viewport, cut-9, opening chapter:

|                                                      |                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------- |
| frame time p50 / p95 / worst                         | 16.7 / 17.4 / 17.7 ms                                          |
| dropped frames (>25 ms) in 10 s                      | 0                                                              |
| long tasks in 10 s                                   | 0                                                              |
| JS heap drift over 10 s                              | 84.6 → 84.3 MB                                                 |
| device pixel ratio the budget settled on             | 1.25 (of 2)                                                    |
| full-viewport filter / blend / backdrop layers, host | 0 / 0 / 0                                                      |
| full-viewport blend layers, page                     | 1 before, 0 after (the lightning flash, now hidden when unlit) |

The budget settling on 1.25 is the honest number: at this viewport the
frame does not make 16.7 ms at DPR 2 with everything on. It holds 60 fps
by spending resolution, which under grain is invisible. There is no
before-figure from the same machine; the profiler is in the session
scratchpad (`towers-profile.js`) and runs from the console.

## What changed, by layer

### The page (`public/towers.html`, film mode only — `?host`)

- No backbuffer antialiasing; the post pass's 4× multisampled target is
  the only AA (was 8× on top of a multisampled backbuffer).
- PCF shadows at 2048² (was PCFSoft at 3072²).
- The twelve-mood **grade moved from three CSS layers into the post
  shader**: saturate → contrast → brightness → sepia → hue (YIQ), a
  soft-light split-tone along the sun's rake, and the graded vignette,
  eased on a one-pole filter on the page's own clock (τ ≈ 0.42 s).
- **The dissolve moved into the glass.** `__film.dissolve(kind)` copies
  the post pass's last output into its own target — the scene render that
  fed it is still in `P.rt`, so the capture is one quad, not a readback
  — and eases a mix uniform. `blend` (520 ms, 5.5 % push) and `melt`
  (1900 ms) are GPU-side; the DOM stills remain for wipe, iris, luma, dip,
  blur, and as the fallback when the pass is off.
- **A frame budget.** `filmBudget(dt)` steps the pixel ratio down 0.25
  when the frame-time EMA passes 19 ms, and back up after four seconds
  holding the vsync; the level that last failed is not retried for
  twenty seconds. The budget is the only owner of the pixel ratio —
  `layout()` used to reset it on every resize.
- **Idle.** `__film.idle(true)` and `document.hidden` stop the loop;
  `?awake` overrides for tooling.
- The lightning flash plane is `visibility: hidden` when unlit.

### The host (`tower-film.gts`)

- `FilmApi` gained `grade`, `dissolve`, `quality`, `perf`, `idle`.
- The grade and the rake are sent as targets when they change, not per
  frame; the page eases them.
- The frame loop stops on a hidden document and once the end card is up.
- Every VO line now **rises in over 70 ms at its own level** (`VO_GAIN`,
  from `ffmpeg volumedetect`: the reads sit −24.6 to −31.9 dB mean, no
  peak above −3.8 dBFS). The **next line is primed a beat early**. A line
  that has been talked over drops its `src` after its fade, so its
  decoder goes with it.
- Every read fits its beat (tightest slack: `timber`, 1.2 s of 14).

## What was ruled out

- **Stacked, never-leaving text.** Seen in the preview pane and in an
  occluded Chrome tab; not reproducible in a foreground tab, where blocks
  arrive and leave on the score's vocabulary. It was `requestAnimationFrame`
  starvation — the exit passes never ran. Not a Choreo bug, but see
  below: it is a Choreo _robustness_ question.
- **Per-frame allocation in the host loop.** One small object spread per
  frame, custom properties for the playhead, tracked state written once a
  second. Clean.
- **Traces and textures on the page.** Disposed on replace and on clear.

## What the engine should take from this

These are the improvements the film argues for in `packages/glimmer-motion`
and its neighbours. None are built yet.

1. **A freeze-blend is a library step.** `docs/choreo-splices.md` names the
   WebGL problem: a crossfade needs both frames, and a canvas has one. The
   answer that works is _the source keeps the freeze_ — the host asks for a
   dissolve by kind and duration and the glass does it. Choreo's junction
   vocabulary (`cut`, `wipe`, `whip`, `blend`, `dip`) should be able to
   delegate the picture half of a join to a surface that can hold a frame,
   and fall back to a DOM still when it cannot. That is the contract
   `__film.dissolve(kind, ms): boolean` sketches.
2. **A clock that is honest about being starved.** Two false diagnoses
   came from rAF not firing: hidden pane, occluded window. A Choreo region
   could expose _why_ time is not advancing (`document.hidden`, a stalled
   rAF), and a leaver whose exit pass cannot run should still be removed
   at some horizon, so a tab that comes back does not show three chapters
   of type.
3. **A frame budget as a Choreo concern.** The film's budget is twenty
   lines in the page. The pattern — measure the frame, step a quality
   knob, remember what failed — belongs beside the region's clock so any
   3D-backed scene can borrow it, with `perf()` as the readout.
4. **Audio as steps.** Prime, rise, fade, duck, barge-in: five small
   functions on the host that every narrated Choreo piece will write
   again. They want to be a track: `n.Voice` / `n.Bed` with `@at` and
   `@duck`, paced against the measured read the way the type already is
   (`sayAt`).
5. **Vocabulary.** The film's beat fields are film-room words already
   (`cut`, `dissolve`, `dipTo`, `hold`, `lead`, `join`). Two are not:
   `bob` (the sway is _breathing_, a steadicam term) and `build` (a
   game-engine word for the same thing an editor calls a _reveal_). Not
   worth a rename in the film; worth knowing when the library names its
   own.
6. **Tooling flags are part of the API.** `?awake`, `?debug`, `?from=N`,
   `?embed`, `__film.perf()`, `__film.quality(k)`. A demo that can be
   driven, measured and pinned from the console is a demo an agent can
   keep honest.

## Open

- Listen. The level trim and the rise-in were set from measurements, not
  ears; the duck's return (slow, on `ended`) may still pump under a short
  line followed by a long gap.
- A before/after on the same machine, with the profiler, from `main`
  and from this branch.
- The end card leaves the clock at 4:46 of 4:48.
- The `-plain` VO variants on disk (`koran-plain`, …) are not referenced
  by any beat.
