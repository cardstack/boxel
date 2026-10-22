# Proof Case: Render the Glimmer Motion Demo Reel with HyperFrames

**Status:** Playhead vertical slice rendered and verified; full demo reel proposed  
**Output:** A verified 10-worker Playhead MP4, then a reel containing every demo  
**Purpose:** Prove that unmodified HyperFrames can render a Glimmer UI whose
motion and overlays are authored with `glimmer-motion` and Choreo

## Goal

Build one real vertical slice rather than attempting a general HyperFrames
port first:

> Render a showcase video of all 31 demos in the `glimmer-motion` gallery.
> Every demo remains a live Glimmer component. Titles, transitions, progress,
> framing, and other overlays are also Glimmer components. Choreo and
> `glimmer-motion` produce the visual movement. Unmodified
> HyperFrames owns the clock, deterministic frame capture, media, and final
> video render through its native awaited seek event.

This proves the intended product architecture with a demanding composition:
real application UI, interactive state changes, layout measurement, springs,
drag and pointer behavior, scroll, cross-region motion, camera moves, and
seekable Choreo scores.

## Success Artifact

The proof produces:

- one HyperFrames composition rendered to MP4;
- all 31 entries from `test-app/app/lib/catalog.ts` shown at least once;
- a Glimmer title transition introducing each demo;
- the actual demo component mounted in each scene, not a screen recording or
  rasterized capture of it;
- Glimmer-rendered overlays throughout;
- deterministic scripted interaction for demos that normally require a
  pointer, click, drag, scroll, or playhead;
- direct seek to any frame in preview;
- matching preview and producer frames at selected checkpoints; and
- no GSAP requirement for the Glimmer UI or its scene transitions.

The first version does not need narration. A restrained music bed is optional
and remains a standard HyperFrames audio clip if added.

## Why This Is the Right Proof

A title-card-only composition would show that Glimmer can boot, but it would
not test why Choreo is valuable. The gallery covers the full range of the
library:

- value animation and keyframes;
- presence and enter/exit behavior;
- layout and shared-layout movement;
- reorder and drag interactions;
- pointer and gesture input;
- scroll and parallax;
- Choreo sequences, interruption, beacons, far matching, subdivision, camera,
  wires, and presentation behavior; and
- a seekable Choreo playhead.

If HyperFrames can render this reel deterministically, it can credibly host
ordinary Glimmer product UI and Choreo animation.

## Ownership Boundary

HyperFrames remains responsible for:

- composition duration and canonical frame rate;
- play, pause, seek, and playback rate;
- frame quantization;
- producer capture and encoding;
- audio and video synchronization;
- render readiness and completion barriers; and
- the final MP4 artifact.

Glimmer remains responsible for:

- mounting the real demo components;
- rendering the reel shell and scene chrome;
- rendering titles, counters, API labels, and overlays;
- updating tracked application state for scripted demo actions; and
- changing which demo scene is active.

`glimmer-motion` and Choreo remain responsible for:

- title and overlay animation;
- scene entrances and exits;
- layout animation inside each demo;
- ordered multi-element transitions;
- measured flights and camera movement; and
- producing the visual state for a supplied composition time.

HyperFrames owns **time and capture**. Glimmer owns **UI and state**. Choreo
owns **visual movement**.

## Proposed Composition

Create a dedicated reel route or entry point in the test app, separate from the
interactive gallery. Conceptually:

```gts
<DemoReelComposition
  @catalog={{catalog}}
  @time={{this.hyperframesTime}}
  @mode="render"
/>
```

The rendered DOM retains the HyperFrames composition contract:

```hbs
<main
  data-composition-id='glimmer-motion-demo-reel'
  data-duration={{this.duration}}
  data-fps='30'
>
  <DemoReelShell>
    <DemoStage @entry={{this.activeEntry}} />
    <DemoTitleOverlay @entry={{this.activeEntry}} />
    <DemoProgressOverlay
      @current={{this.activeIndex}}
      @total={{this.entries.length}}
    />
  </DemoReelShell>
</main>
```

All elements above are rendered by Glimmer. The mounted demo is the catalog's
real `entry.Example` component.

## Reel Structure

The first proof should favor coverage and legibility over marketing polish.
A reasonable shape is approximately 90–120 seconds:

1. **Opening — 3–4 seconds**
   - `glimmer-motion` / Choreo title
   - one-line premise: “Motion for Glimmer, composed as scenes”
   - transition into the gallery frame

2. **Six group chapters**
   - Animate
   - Layout
   - Drag
   - Scroll
   - Choreo
   - Timeline

3. **Every catalog demo — roughly 2–4 seconds each**
   - title and group enter;
   - one representative interaction plays;
   - the result gets a short hold;
   - the scene transitions to the next demo.

4. **Closing — 3–4 seconds**
   - compact mosaic or fast recap;
   - package name and repository callout;
   - final resolved frame.

The exact duration should be derived from the scripted actions rather than
forcing every demo into an identical slot. A simple Enter animation may need
two seconds; Presentation or Playhead may need five or six.

## Glimmer Overlay System

The reel shell should use a small set of reusable Glimmer components:

- `<DemoReelShell>` — background, safe area, and stage frame;
- `<DemoStage>` — mounts and resets the active catalog example;
- `<DemoTitleOverlay>` — demo title, group, lede, and API chips;
- `<DemoProgressOverlay>` — `07 / 31` and chapter progress;
- `<ChapterTransition>` — group-level transition;
- `<DemoCursor>` — deterministic oversized pointer for scripted actions; and
- `<ReelEndCard>` — final package lockup.

These should be ordinary `.gts` components. Their animation should use
`{{motion}}`, `<Presence>`, layout animation, or `<Choreo>` according to the
smallest appropriate pattern.

The overlay is part of the composition DOM. It must not be added later by an
NLE or baked into captured footage.

## Title and Scene Transition

Use one consistent transition grammar so 31 demos feel like one film:

1. the prior demo settles;
2. its title and API chips leave;
3. the stage shifts or masks through a short transition;
4. the next real demo component mounts and is allowed to measure;
5. the new title and group arrive; and
6. the scripted demo action begins.

A Choreo sequence is the natural authority because title, stage, and demo
action must agree on order. The transition should expose named anchors such as:

```text
title-in -> demo-action -> result-hold -> title-out -> scene-out
```

The visual treatment can be refined later. The proof only requires a coherent,
repeatable transition that exercises Choreo ordering and remains seekable.

## Deterministic Demo Direction

The gallery components are interactive. A rendered composition cannot depend
on a human clicking at the right moment. Each demo therefore needs a small
director that maps composition-local time to deterministic actions and state.

Conceptually:

```ts
interface DemoDirector {
  duration: number;
  reset(): void;
  renderAt(localTime: number): void | Promise<void>;
}
```

The director should use the real public interaction path where practical:

- invoke the same component action a button uses;
- set the same tracked state a drag or scroll handler ultimately updates;
- drive an exposed Choreo run's `time` for score-based demos; and
- dispatch deterministic pointer events only when event behavior itself is
  what the demo proves.

It must not use `setTimeout`, wall-clock time, unseeded randomness, or sleeps.
Calling `renderAt(2.2)` directly must produce the same UI as playing from the
start to 2.2 seconds.

### Interaction classes

The 31 demos can be handled through a few reusable director types:

- **State toggle:** choose/open/add/remove/reorder by setting the same tracked
  state as a real control.
- **Choreo transport:** pause the run and assign its local time.
- **Pointer path:** sample a fixed path from local time and update the pointer
  and target interaction deterministically.
- **Drag path:** map local time to position and velocity, including release.
- **Scroll path:** assign a deterministic scroll progress or container offset.
- **Scripted clicks:** fire named controls at score boundaries, with state
  reconstructed when seeking past them.

Each director also supplies the oversized Glimmer cursor overlay with its
position, pressed state, and visibility.

## HyperFrames Integration: No Fork Required

The Playhead proof uses HyperFrames 0.8.14 as published. No producer, runtime,
or core change is required.

### Load a Glimmer composition application

HyperFrames must be able to render a composition page that boots a compiled
Glimmer application rather than relying only on hand-authored static HTML.
Preview and producer must load the same built assets.

This can initially be a dedicated composition URL or HTML shell pointing at
the test app's compiled JavaScript and CSS.

### Bind the native seek barrier

`choreo-player/hyperframes` exports one browser-protocol helper:

```ts
const disconnect = bindHyperframes({
  renderAt: (time) => composition.renderAt(time),
});
```

The helper listens for `hf-seek`, passes the composition's promise to
`event.detail.waitUntil()`, propagates failures, and returns cleanup. On each
seek the composition:

1. derives the active reel scene and its local time;
2. updates the reel's Glimmer state;
3. waits for the Glimmer render pass;
4. seeks the active title, transition, demo, and cursor Choreo runs;
5. waits for motion-dom and layout values to settle; and
6. resolves so HyperFrames can capture the frame.

The package does not import HyperFrames, discover components, emulate a GSAP
timeline, or claim that every composition is parallel-safe.

### Make HyperFrames time authoritative

During interactive gallery use, components may keep their existing real-time
behavior. In reel render mode, independent animation clocks must pause.
HyperFrames supplies the single composition time used by:

- the reel scene scheduler;
- title and transition Choreo runs;
- demo directors;
- cursor movement; and
- any time-derived Glimmer state.

### Wait for Glimmer readiness

The promise passed to `waitUntil()` must remain pending until:

- the Glimmer app has booted;
- the catalog and reel component have rendered;
- fonts and layout-critical assets are ready;
- Choreo participants and runs are registered; and
- the composition can render the requested time.

## `choreo-player` v1 Boundary

The first player is a separate workspace package built around Choreo's public
run contract. It requires no changes to `glimmer-motion` or Choreo core.

The Glimmer composition explicitly supplies the run yielded by each
`<Choreo>` region through a `runs()` provider. There is no global registry, so
one player cannot accidentally seize another demo's transport. The player uses
the existing public controls only:

- `pause()` prevents the run's clock from advancing during a render seek;
- assigning `run.time` places the score at composition time;
- `run.speed` applies the transport playback rate; and
- `play()` returns preview playback to Choreo.

After a time assignment, `renderAt()` waits for two animation frames. That
matches Choreo's existing two-frame still reconciliation without adding an
awaitable method to core. A Glimmer/HyperFrames host can replace this with a
stronger `settle` callback that also waits for Glimmer rendering, fonts,
assets, and motion-idle state.

The optional `bindHyperframes()` export connects the application's complete
`renderAt(time)` transaction to HyperFrames' native capture barrier. It has no
HyperFrames runtime dependency. HyperFrames is installed and pinned only in
the video project that previews or renders the composition.

Remaining proof-case concerns belong around the library:

1. **Run binding** — the Glimmer host's explicit provider returns only the
   current externally owned run.
2. **Composition state** — the reel director reconstructs active demo and UI
   state for an arbitrary time before asking the player to seek.
3. **Deterministic inputs** — demo directors use seeded data and explicit
   pointer, drag, or scroll paths.
4. **Render context** — the reel app distinguishes interactive preview from
   producer capture without duplicating demo UI.

## Implementation Phases

### Phase 1: Static Glimmer reel

- Add the reel route/entry point.
- Render the real catalog components one at a time.
- Build the Glimmer shell, title, progress, and end-card components.
- Give every catalog entry a duration and deterministic reset path.
- Confirm HyperFrames preview can load the compiled Glimmer page unchanged.

**Gate:** HyperFrames sees the composition duration and can capture a static
frame from each demo scene.

### Phase 2: One seekable scene

- Add the Glimmer/Choreo adapter.
- Make one simple demo and its title transition externally clocked.
- Support direct seeks in arbitrary order.
- Compare preview and producer frames at several timestamps.

**Gate:** frame `t` is identical whether reached through playback or direct
seek.

### Phase 3: Interaction director library

- Implement state-toggle, pointer, drag, scroll, and scripted-click directors.
- Add the oversized Glimmer cursor.
- Port one representative demo from each interaction class.
- Verify reset and backward seeking.

**Gate:** each interaction class is deterministic without timers or sleeps.

### Phase 4: All 31 demos

- Add a director for every catalog entry.
- Tune each scene's duration around one legible action.
- Add chapter transitions for the six catalog groups.
- Verify every demo is mounted from the catalog rather than copied.

**Gate:** a complete preview plays from opening to end card with no manual
input.

### Phase 5: Render and parity

- Run HyperFrames lint and browser checks for the composition shell.
- Capture fixed-frame snapshots across simple, layout, drag, scroll, Choreo,
  and timeline demos.
- Compare preview and producer output.
- Render the final MP4.
- Watch the complete artifact for clipping, stale state, pointer mismatch,
  unreadable titles, and transition discontinuities.

**Gate:** the full rendered video contains all demos and matches preview at the
selected parity frames.

## Acceptance Criteria

The proof succeeds when:

- the final video is rendered by HyperFrames;
- all 31 catalog entries appear;
- every visible demo is its real Glimmer component;
- all titles, transitions, chrome, progress, and cursor overlays are Glimmer
  components;
- Choreo or the appropriate `glimmer-motion` primitive drives all UI motion;
- no human input is required during render;
- no `setTimeout`, sleep, `Date.now()`, or unseeded randomness affects a frame;
- HyperFrames can seek directly to arbitrary frames;
- backwards and repeated seeks reproduce the same visual state;
- preview and producer agree at representative checkpoints;
- pointer, drag, and scroll demonstrations remain understandable;
- the composition renders from a clean build; and
- the existing interactive gallery continues to work normally.

## Non-Goals for the First Proof

- Rewriting the HyperFrames player, producer, media system, or Studio.
- Removing support for existing GSAP or non-Glimmer compositions.
- Designing the final general-purpose Glimmer composition SDK.
- Porting all HyperFrames registry components to Glimmer.
- Adding narration, captions, localization, or a full marketing storyline.
- Perfecting every demo's cinematic treatment before deterministic parity is
  proven.

## Conclusion

The proof is intentionally end-to-end:

> Unmodified HyperFrames records a real Glimmer application as a
> deterministic video composition. The composition mounts every existing
> `glimmer-motion` demo, and Glimmer components provide all titles,
> transitions, overlays, and cursor direction. Choreo supplies the visual
> sequencing while HyperFrames supplies the authoritative clock and renderer.

This artifact will answer the architectural question more convincingly than a
standalone runtime experiment. It demonstrates whether HyperFrames can remain
the video system while Glimmer and Choreo become its UI and animation stack.
