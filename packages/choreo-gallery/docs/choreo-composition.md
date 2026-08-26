# Choreo Compositor

**Choreo Compositor** is the name of the higher-level capability described in
this document. It does not need to become a second animation engine. Most of
its useful primitives belong in Choreo core because they are equally valuable
in live interactive applications. The compositor can remain a small optional
assembly of those primitives for directed, recorded, and editorial work.

## Vision

Use Choreo for all browser composition and playback. Glimmer, HTML video/audio,
SVG, canvas, and Three.js remain native browser sources under Choreo control.
HyperFrames drives deterministic capture and produces the final encoded media;
it receives one completely composed visual frame plus the media decisions made
by Choreo.

Choreo Compositor is not a track-based NLE. It is an interactive scene and
event graph: reusable assets activate as behavior instances, render through
semantic planes, communicate through events, and accept non-destructive
automation and editorial overrides.

Time is a consequence of behavior and causality—not a row of clips positioned
on V1, V2, and V3.

Most Choreo applications are live and interactive. Sometimes the same runtime
is driven by an authored event graph to produce a cutscene. Sometimes a real
interactive session is captured as an event journal and replayed as recorded
gameplay. Both are deterministic operating modes of the interactive engine,
not the architecture's center.

## Interactive first, cutscene capable

The game-engine analogy is fundamental. A game does not normally arrange UI,
cameras, particles, world objects, and HUD elements on editing tracks. It has
a scene graph, actors, semantic rendering planes, events, state, animation
controllers, and reusable blueprints. A cutscene temporarily drives those
same objects with a controlled sequence of events.

Choreo should work the same way:

```text
Live interaction              Authored cutscene             Recorded gameplay
──────────────────────────    ──────────────────────────    ──────────────────────────
input emits events            director emits events         journal re-emits input
triggers activate behavior    same triggers activate it     same triggers activate it
planes compose the screen     same planes compose frames    same planes compose frames
state is open-ended           graph may have a fixed end    replay ends with the journal
clock follows real time       external clock seeks graph    external clock seeks replay
```

The shared concepts are useful without any movie timeline:

| Concept           | Interactive use                                                                     | Cutscene use                                                              |
| ----------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| **Plane**         | Compose HUD, world, menus, pointers, titles, or Three.js surfaces with local policy | Compose those same surfaces deterministically into each output frame      |
| **Actor**         | Persistent addressable object responding to state and input                         | Object controlled by recorded events or a director blueprint              |
| **Trigger**       | React to click, state, network, gesture, collision, readiness, or completion        | React to recorded events, markers, and prior completion                   |
| **Cue**           | Request a behavior now: present a notice, focus a camera, open a menu               | Drive the planned progression of a scene without absolute track placement |
| **Sequence**      | Describe what one activated behavior does                                           | Describe a repeatable cutscene beat                                       |
| **Blueprint**     | Reusable interactive controller with inputs and outputs                             | Reusable shot, title, transition, or scene controller                     |
| **Automation**    | Smooth a value after a trigger or continuously map state to presentation            | Reconstruct a parameter exactly at an external time                       |
| **Override**      | Apply modes, accessibility, focus, interruption, or temporary presentation policy   | Apply non-destructive editorial changes                                   |
| **Event journal** | Optional debugging, replay, undo, testing, and collaboration                        | Required deterministic input for recording and random access              |

Only a few concepts are primarily cutscene/editorial concerns: bounded
duration, trim/slip, fixed in/out points, offline media readiness, and final
frame capture. They should extend the runtime without distorting its
interactive model.

Recorded gameplay adds one important requirement beyond a cutscene: the
journal must capture every nondeterministic input needed to reconstruct the
session—pointer/keyboard events, choices, random seeds, asynchronous data, and
relevant clock values. Long sessions may use deterministic state checkpoints
so seeking does not require replaying from the beginning. The replay still
drives the original actors and blueprints; it is not converted into a baked
video until final capture.

## Why planes

A layer usually means a stacking implementation such as CSS `z-index`. A
**plane** is a compositing world with its own behavior.

In the initial implementation, planes are logical regions of **one shared
DOM**, not separate documents, canvases, or renderer layers. Normal Glimmer
components remain live inside them. A sequence can cause a popup to appear in
another plane, finish, and leave that popup fully interactive because the
result is still ordinary application state and DOM.

A plane can own:

- a coordinate system, viewport, projection, or camera;
- an internal stacking or depth policy;
- crop, mask, matte, bounds, opacity, and blending;
- DOM/Glimmer, SVG, canvas, Three.js, or media rendering;
- safe areas, placement, collision, and layout policy;
- event routing and accepted clip types;
- child planes and nested composition.

The plane contract is renderer-neutral. Anything the browser can render can be
a plane source or actor. Choreo controls when it exists, where it composites,
how it is cropped, which camera affects it, and which events or parameters
drive it.

A plane needs only a compact contract:

- a stable name and DOM root;
- an ordering relationship and local containment/crop policy;
- conversion between compositor, plane-local, and viewport coordinates;
- a camera and viewport;
- target discovery/hit testing; and
- cross-plane signal delivery.

That coordinate contract is what makes drag and drop work across planes. The
pointer remains captured by the dragged component, the component moves in
shared compositor space, target-plane hit testing converts through the plane's
camera, and the final state reparents it into the destination plane. Existing
Choreo identity and crossing/layout behavior can preserve visual continuity at
the ownership change. Planes do not need separate DOMs or a second drag engine.

HTML media remains live rather than being baked into a special editor asset:

```text
Video actor: source, currentTime, rate, paused, volume, crop, fit, opacity
Audio actor: source, currentTime, rate, paused, gain, pan, mute, ducking
Three.js plane: scene, renderer, camera, texture output, parameters, events
Canvas plane: draw source, viewport, parameters, readiness, frame event
```

This makes popup graphics and picture-in-picture ordinary plane composition.
A video actor can play in the Demo plane while a title blueprint activates in
the Lower-thirds plane and a HUD plane responds to its playback events.

Typical composition:

```text
Composition
├── Background plane     Three.js texture or generated field
├── Demo plane           live Glimmer component + Choreo camera
├── Lower-thirds plane   placement, queueing, and collision policy
├── HUD plane            viewport-anchored status and controls
└── Pointer plane        cursor, taps, and interaction feedback
```

Relationships such as `over`, `under`, `inside`, `matte`, `texture`, and
`attachedTo` form a small render graph. A driver may implement them with CSS
stacking contexts, offscreen canvases, or render passes; those are not the
authoring API.

## The second primitive: camera

The other meaningful engine expansion is to turn the existing `c.Camera` into
a plane camera rather than adding an editing timeline. It should retain the
current seekable step semantics while growing from 2D `x`/`y`/`zoom` into a
complete camera state:

- perspective or orthographic projection;
- position `x`/`y`/`z` and orientation or `lookAt` target;
- distinct dolly, optical zoom/focal length, pan/truck, orbit, and roll;
- viewport, crop, padding, and safe-area constraints;
- automatic framing of one target or a target set from measured bounds;
- aim, follow, and reframe behaviors; and
- direct random-access sampling at any external time.

The public API should make common direction concise. `slowZoom`, `pan`, `aim`,
`frame`, `follow`, and `reveal` are presets that expand into the same camera
step, not new runtime primitives. Targeting should reuse Choreo's existing
IDs, roles, beacons, queries, and measured bounds.

For DOM content this is a CSS 3D camera over flat or transformed DOM objects.
For a Three.js plane, an adapter supplies world-space bounds and applies the
same camera intent to the Three.js camera. HUD or lower-third planes remain
unaffected unless their own camera is addressed.

## What else is actually required

The third author-facing primitive is a **clock cue**: attach a semantic event
or action to a point on the current sequence's local clock. It is the bridge
between choreography and application behavior.

```gts
<c.Perform
  @time={{4.2}}
  @target={{c.plane "info"}}
  @action="product.present"
  @payload={{hash productId="p42"}}
/>

<c.Perform
  @at={{after "video-intro" 0.3}}
  @target={{c.id "compose-button"}}
  @action="inbox.compose"
/>
```

`@time` addresses absolute time on the enclosing run. `@at` reuses Choreo's
existing named-step anchors, so the cue can move with the behavior it follows.
The target receives the same semantic action that a real click, tap, key, or
application event would produce; the cue should not depend on remembered
screen coordinates. A raw DOM `.click()` can exist as a compatibility adapter,
but it is not the durable recording format.

A clock cue has stricter semantics than an ordinary callback:

- during forward playback it dispatches once when the local clock crosses it;
- seeking directly past it must include its resulting state;
- seeking before it must exclude or undo that state;
- repeated and backward seeks must be idempotent; and
- an action that mounts a component may start a new Choreo run whose local
  time is `parentTime - cueTime`.

Therefore cues are semantic commands folded through time, not arbitrary side
effects. `lightbox.open` is seek-safe; `lightbox.toggle` is not. The simplest
correct implementation resets controlled composition state and folds every
cue through `t`; checkpoints are only a later optimization. This gives a
popup both deterministic appearance in a recording and normal interactivity
after it appears.

Two small supporting protocols complete the model:

1. **Signals.** A run, component, media source, or plane can emit a typed name
   and payload; another plane or the master sequence can react. Completion is
   already represented by `run.finished`. This should extend normal Choreo
   events rather than introduce a trigger-graph engine.
2. **Frame readiness.** Under an external clock, a plane can report when its
   DOM, video frame, canvas, or Three.js render is ready. `choreo-player` waits
   for those barriers before HyperFrames captures. This is a protocol, not an
   authored sequence construct.

Everything else should first be expressed with what already exists:

```text
clip                 = a timed window and local-clock mapping over one sequence activation
blueprint             = Glimmer component + sequence factory
popup/lower third     = component inserted into a named plane
cross-plane trigger   = signal/state causes that insertion
video marker          = media signal consumed by the master sequence
timed appearance       = clock cue performs a semantic `present` action
recorded click         = clock cue replays the resolved semantic action
automation            = seekable Choreo step or camera preset
drag between planes   = shared pointer + coordinate conversion + state move
recording             = semantic signals/parameters captured against the clock
```

## Core model

### Composition

The root scene controller. It owns the plane graph, active behavior instances,
event routing, and nested Choreo runs. In a live application it follows real
time and input. In recording mode it additionally owns a deterministic event
journal and `renderAt(t)` transaction.

### Plane

A semantic compositing surface and controller. A lower-thirds plane, for
example, decides whether simultaneous titles replace, queue, or stack; it is
not merely “z-index 40.”

### Clip

An activated instance and **time window** over a reusable sequence. The source
sequence owns its natural behavior and duration; the clip owns when that
behavior is visible, which portion is used, and how parent time maps to the
sequence's local clock.

For example, a logo component may contain a natural two-second Choreo
sequence. A quick cut can use only its first half-second without changing the
logo component or sequence:

```gts
<c.Clip
  @name="logo-hit"
  @at={{after "build-order"}}
  @sourceIn={{0}}
  @sourceOut={{0.5}}
  @end="remove"
>
  <LogoAnimation />
</c.Clip>
```

While active, the mapping is:

```text
source local time = sourceIn + (parent local time - clip start) × rate
clip duration      = (sourceOut - sourceIn) / rate
```

The minimum clip contract is:

- activation by clock cue, event, or application state;
- destination plane;
- `sourceIn` and `sourceOut` trim points;
- playback `rate`;
- end policy: `remove`, `hold`, or `freeze`; and
- identity plus completion signal.

Trim changes the visible window. Slip moves `sourceIn`/`sourceOut` together
without moving or resizing the output window. Retime changes the mapping rate.
A hard cut needs no transition primitive; overlapping two clips and animating
their plane/component opacity expresses a dissolve.

### Clip transition

A clip transition is a Choreo sequence evaluated across an edit boundary.
`Crossing` is the most important example, but a transition could also be a
dissolve, camera handoff, wipe, or custom composite sequence.

The transition's endpoints are the **edited samples**, never the natural
finals of the source sequences:

```text
outgoing transition state = sample clip A at A.sourceOut
incoming transition state = sample clip B at B.sourceIn
```

If a two-second logo sequence is trimmed at `0.5s`, Choreo samples the logo at
exactly `0.5s`. A half-finished spring, partially drawn path, current opacity,
camera position, bounds, and transforms all become the outgoing transition
state. The engine must not finish the logo's sequence or substitute its
two-second resting state.

For a Crossing, the compositor keeps that outgoing cut sample available,
mounts and samples the incoming clip at its own `sourceIn`, and gives both
states to Choreo's normal identity/bounds matching. The transition then owns a
separate window on the parent clock:

```text
clip A source ───────────────● sourceOut sample
                              ╲
                               ╲ Crossing on parent clock
                                ╲
clip B source                    ● sourceIn sample ─────────────►
```

Seeking into the middle of the transition reconstructs both boundary samples
directly and samples the transition at its progress. It does not play clip A
to its natural end, replay either source from zero, or require the preceding
browser frame.

Whether source clocks remain frozen at their cut samples during the transition
or advance into hidden handles is an explicit transition policy. **Freeze at
the edited boundary** is the safe default and requires no media outside the
declared clip windows. A later `handles` policy can allow both sources to keep
advancing under the transition.

Direct seek remains arithmetic rather than playback simulation. Before the
clip starts it is absent; inside its window its child run is mounted and set to
the mapped source time; after its window the end policy applies. If
`sourceIn > 0`, internal source cues before `sourceIn` are folded as needed to
reconstruct source state, while outward events from the invisible discarded
portion are suppressed.

A clip is closer to a spawned game actor or running ability than an NLE track
rectangle. It is attached by a trigger or causal relationship, not necessarily
placed on a global editing track.

### Actor

An addressable object inside a clip or plane. Existing Choreo `id`, `role`, and
beacon identities provide the first addressing system.

### Trigger and event

`Sequence` answers what happens after a behavior starts. A trigger answers why
and when it starts.

Events include clip/sequence completion, markers, state transitions, camera
arrival, media readiness, and recorded user input. Combinators include
`after`, `all`, `any`, `race`, conditions, and cancellation.

### Cue

A semantic request sent to an actor, plane, or blueprint: `present`, `focus`,
`dismiss`, `celebrate`, `transition`, or an application-defined command. A cue
may activate a sequence, change state, or emit further events. It is useful in
ordinary interactive UI and becomes the director's vocabulary during a
cutscene.

### Input actions and parameters

Recording should preserve interaction intent, not mouse hardware. A game-style
input map converts DOM, pointer, keyboard, touch, controller, or network input
into named actions and continuous parameters before it enters the journal.

```text
raw input                         recorded semantic input
──────────────────────────────    ─────────────────────────────────────
click at (1174, 642)              lightbox.open { photo: "halo" }
click the Compose button          inbox.compose
drag from pixel A to pixel B      card.position = curve(...)
mouse delta (24, -8)              camera.orbit { yaw, pitch }
wheel delta -136                  demo.scrollProgress = 0.42
pointer down/move/up              scrubber.seek = parameter curve
```

The journal stores a stable actor/plane address, action or parameter name,
semantic value, local time, and causal metadata. Continuous movement is
recorded as a sampled and simplified automation curve, preferably normalized
or expressed in the target plane's local coordinate system—not viewport
pixels.

Playback injects those actions and parameters through the same input ports the
live application uses. It should not dispatch a synthetic click at a remembered
screen coordinate.

An asset can participate through:

- explicit action/parameter ports exposed by its blueprint;
- existing Choreo IDs/roles plus a sidecar interaction adapter;
- a capture-time hit test that resolves a raw click to a stable semantic target;
- raw DOM replay only as a clearly marked compatibility fallback.

This makes a recording resilient to resolution, camera framing, layout,
responsive design, and later editorial recomposition.

### Automation

An engine-neutral parameter channel made from preset curves, Béziers, springs,
steps, plotted points, or event-relative envelopes. It can compile to Motion,
WAAPI, CSS `linear()`, or direct still sampling.

Automatable values include plane transforms and opacity, crop/mask geometry,
camera, effects, clip speed/local time, parameters, and override weight.

### Editorial override

A separate, non-destructive edit applied over authored behavior. An override
can replace, add, multiply, mix, mute, freeze, retime, hide, or fade the
influence of an existing animation without changing its source code or data.

Universal clip controls work for opaque assets. Semantic internal control
requires an existing Choreo identity, an exposed parameter/event, or a sidecar
adapter that maps stable targets without modifying the asset.

### Blueprint

A reusable package of planes, clips, internal sequences, parameters, triggers,
input events, output events, and defaults—the equivalent of a game-engine
prefab plus animation blueprint.

## Typical use cases

### Triggered lower third

When a product demo finishes opening, emit `demo.ready`. The lower-thirds plane
receives a title clip, applies its placement policy, runs the clip's own
entrance/hold/exit sequence, then emits `title.completed`.

The director specifies the relationship, not an absolute timestamp:

```gts
<c.On @event={{c.complete "demo.opening"}}>
  <c.Send
    @to={{c.plane "lower-thirds"}}
    @event="present"
    @payload={{hash asset="feature-title"}}
  />
</c.On>
```

### Interactive demo as a reusable asset

Mount the existing Glimmer demo unchanged in the Demo plane. Replay a recorded
click event, let its native Choreo behavior run, and use the outer plane camera
to reframe it. The component remains interactive in the gallery and becomes a
deterministic clip in the composition.

### Recorded gameplay

Record a real session as semantic actions, continuous parameter curves,
application events, random seeds, and periodic state checkpoints. Replay that
journal through the original interactive scene, then add camera direction,
titles, HUD suppression, and editorial overrides non-destructively. Choreo
still renders the live scene graph; HyperFrames only captures the directed
replay and produces the media file.

### Non-destructive editorial change

During a title, fade the Demo plane to 55%, freeze one internal animation, and
temporarily suppress the HUD. When the title completes, automate the override
weights back to zero and restore the authored behavior.

### Mixed-renderer scene

Render a Three.js background plane, a live Glimmer UI plane, an SVG pointer
plane, HTML video picture-in-picture, and a policy-driven title plane. Choreo
controls every source and produces the final screen; HyperFrames captures and
encodes the result.

### Browser-native media orchestration

Use an HTML video actor as a plane source. A playback marker triggers a popup
graphic, camera reframe, or picture-in-picture transition. Choreo automates the
video crop, position, rate, and volume alongside normal component animation.
The same graph works interactively in the browser and under an external clock.

### Three-minute trigger-driven film

Compose the film from scenes and reusable blueprints. Each scene emits markers
and completion events. Those activate the next scene, camera move, title, HUD
change, or interaction. A derived timing map can aid inspection, but the
authored structure remains a causality graph.

## Non-negotiable runtime law

Every construct must produce the same frame under:

- uninterrupted forward playback;
- monotonically increasing external-clock seeks;
- direct random-access seek;
- backward seek and repeated seek.

In recording/replay mode, at time `t`, the composition folds its deterministic
event journal through `t`, resolves active behaviors and their local times,
samples every Choreo run and automation channel, and composites every plane.
No recordable construct may depend on having painted the preceding browser
frame.

The current camera-seek finding is the first concrete test of this law.

## Principal challenges

### Value ownership

Asset animation, scene choreography, interaction, and editorial overrides may
all target the same value. Choreo needs explicit authority and blend rules,
not accidental CSS specificity or last-writer-wins behavior.

### Deterministic events

Authored completion events can derive their time from known behavior. Clicks,
network data, randomness, and pointer input must be captured in an event
journal before they can be replayed or sought.

### Semantic input capture

A browser reports pixels, deltas, buttons, and keys; the replay needs actions,
targets, and parameters. The input map must resolve a click to stable intent,
record movement in the correct plane coordinate space, simplify high-frequency
samples without visible drift, preserve velocity where springs need it, and
remain valid when the layout or camera changes.

Opaque components are the hard case. If an interaction is only expressed as a
private DOM listener, Choreo needs a sidecar adapter or must fall back to DOM
replay. Truly semantic playback cannot be inferred reliably from pixels alone.

### Opaque assets

Plane-level transform, opacity, crop, visibility, and time controls are always
possible. Reaching into an asset safely requires stable identities or a
sidecar adapter; arbitrary DOM selectors are only a brittle fallback.

### Mixed renderers

DOM, canvas, Three.js, SVG, masks, and video do not share identical clipping,
color, depth, or blend semantics. The initial contract must be deliberately
small and testable.

### Deterministic media seeking

Setting an HTML media element's `currentTime` is asynchronous and does not mean
the requested decoded frame is ready to paint. Recording needs a media adapter
that awaits seek completion and the correct video frame before releasing the
frame barrier. Audio needs an equally explicit path: either a deterministic
Web Audio/offline mix or an exported automation description that HyperFrames
can mux without changing Choreo's editorial decisions.

### Lifecycle and readiness

Long compositions need clip mounting, pre-roll, media readiness, memory
release, nested clocks, and deterministic font/asset loading without keeping
the entire film live in the DOM.

### Debuggability

A trigger graph can hide timing more easily than a track view. The system must
explain why a clip is active, which event caused it, which plane owns it, and
which automation or override currently controls each value.

## Scope decisions (2026-08-26 review)

A review of this document against the shipped C0/C1 work re-prioritized the
workstream. The vision sections above stand as vision; the build order below
is the plan of record, and nothing outside it starts until the 15-second
piece is at gallery quality.

**Two laws, added to the non-negotiables:**

1. **`play()` is GPU; `renderAt(t)` is a still.** Live preview plays runs on
   their own clock so the WAAPI camera path composites off-thread; the
   still-sampling transaction exists for an armed recorder, never as the
   default render path. A preview that pauses and assigns `run.time` every
   frame has shipped the capture path as the demo.
2. **Value ownership is decided, not discovered.** Plane transform and
   opacity belong to the compositor; sprite motion belongs to the asset's
   own choreography; an editorial override is a weighted mix whose winner at
   weight 1 is documented where the override is declared. Last-writer-wins
   is a bug, not a policy.

**Build order** — each step ships with tests before the next begins:

1. Live play stays on WAAPI; capture still-samples; a recorder arms the
   still path by arriving (demo-recording.md's rule, applied to the host).
2. Semantic ports on the reel's demos (`lightbox.photo.open`,
   `inbox.compose`, Build Order `scrub`) so no path synthesizes clicks.
   The host's cue fold is the composition-side proof the C4 `Perform`
   gate requires — the core step waits for it.
3. The lower-third plane as an ordinary Glimmer/Choreo region whose fade
   is a normal tween on the plane root — which is also the experiment
   that keeps the addressable control channel unbuilt until it fails.
4. Clip as parent→source time mapping, proven in the reel with one hard
   cut and one Crossing frozen at the edited samples.
5. Camera presets (`frame`/`aim`/`pan`/`slowZoom`/`follow`) as sugar over
   the existing seekable step — after Clip, not before.

**Deferred until the film is the quality bar:** event journals and recorded
gameplay, the 3D/film camera expansion, Three.js planes, Blueprint/Director
tooling, and any compositor package. The pointer plane waits for the first
drag demo to join the reel. Parameter channels stay sampled pass-through
ports — they must not grow curves, easing, or a fourth interpolator.

## Minimal product

### Package map

The smallest architecture is **one Choreo sequence, one tiny transport, and a
few headless composition conventions**. Product UI is deliberately outside all
three. Boxel cards can provide inspectors, editors, asset browsers, control
surfaces, and derived timeline views without becoming an engine dependency.

A master sequence can already perform the whole edit: show a real component,
move its camera, wait for or emit an event, present another component, animate
a lower third, and finish on a build order. We should not add parallel engine
concepts merely to rename those operations “clips” or “shots.”

| Place                              | Add only                                                                                                                                                                                                                                                           | Explicitly do not add                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| **Choreo core (`glimmer-motion`)** | Planes; expanded camera; a seek-safe clock-cue/`Perform` step; deterministic random access for every step; one small addressable control-channel API only if ordinary parameters cannot express overrides                                                          | Clips, edit documents, journals, media libraries, product UI, or another scheduler                |
| **`choreo-player`**                | Keep the existing transport: `play`, `pause`, rate, duration, `renderAt(t)`, preparation/settling, and the HyperFrames seek bridge                                                                                                                                 | Scene graph, planes, events, automation, assets, or editorial policy                              |
| **Choreo Compositor**              | `Clip` as a trim/retime/lifecycle window over a sequence; clip transitions sampled at edited boundaries (including Crossing); named planes; semantic commands/parameters; optional event recording/replay; media readiness; and a serializable inspection snapshot | Animation engine, track-based timeline engine, renderer, fixed editor, asset browser, or Boxel UI |
| **Boxel cards**                    | All authoring, inspection, asset, workflow, and derived timeline experiences                                                                                                                                                                                       | Runtime animation semantics                                                                       |
| **HyperFrames**                    | Deterministic browser driving, frame capture, encoding, audio/video muxing, and final files                                                                                                                                                                        | Screen composition or camera/edit decisions                                                       |

**Packaging decision:** do not create a `choreo-compositor` package yet.
“Choreo Compositor” is initially the capability and architecture name. Build
the first proof from core Choreo, Glimmer components, and `choreo-player`. If a
small reusable API falls out of two real compositions, ship it as an optional
`glimmer-motion/compositor` subpath. It can remain part of the same package and
release while staying out of the main import and tree-shaking away for normal
interactive applications.

The dependency direction stays one-way:

```text
Boxel product cards ───────────────► public inspection + command APIs
                                         │
Choreo Compositor ────────────────► Choreo core primitives
        │                                ▲
        └── presents a seekable run ─────┼──► choreo-player ──► HyperFrames
```

Planes do not initially require a core engine type. A plane can be a named
Glimmer component or nested Choreo region with an ordinary DOM/canvas/Three.js
surface, local CSS containment, and a camera. A clip is the one additional
Compositor object: an activation plus a source-time window over a sequence. A
“blueprint” can be a component plus its sequence factory. A
trigger can be application state or an event that causes that sequence to be
rendered. Promote one of these conventions into core only after two different
implementations prove that engine support is necessary.

The one likely core addition beyond seek correctness is a very small
**addressable control channel**. It would let an external director address an
existing `id`/`role` and temporarily set or mix a named value without editing
the component's source. This is the irreducible mechanism behind editorial
override; the compositor can build recording, curves, and Boxel controls on
top of it.

`choreo-player` should not grow a scene model. Its current narrow purpose is
correct: transport one or more public Choreo runs under either a real-time or
external clock. If the compositor presents a single run-compatible object, the
player does not need to know that planes, clips, media, or journals exist.

### Headless API surface

The engine should expose data and commands, not prescribe UI:

```ts
interface Compositor {
  readonly run: SeekableRun;
  readonly snapshot: CompositionSnapshot;

  send(action: SemanticAction): void;
  setParameter(target: Address, name: string, value: ParameterValue): void;

  startRecording(): RecordingSession;
  loadJournal(journal: EventJournal): void;
}
```

`CompositionSnapshot` is read-only, serializable inspection data: the master
run, named planes and actors, parameters, recent events, media readiness, and
errors. Boxel can render that snapshot as cards, graphs, property panels, or a
derived timeline and invoke the same commands. Those representations may
change without changing engine behavior.

## Implementation plan: Compositor workstream

This workstream builds **around** Choreo. It does not modify Choreo core or
`glimmer-motion` as an incidental implementation detail. Any core change named
below is a separate, evidence-backed proposal and review gate.

### Current foundation

- `choreo-player` already provides the narrow transport and external-clock
  bridge. Keep it transport-only.
- A composition can already reuse live Glimmer demos and drive their Choreo
  runs rather than recreating them as screen recordings.
- A master Choreo sequence can already express the directed narrative.
- HyperFrames can receive that composition as one visual clip and handle final
  frame capture, audio/video work, encoding, and muxing.
- Absolute camera seeking is a prerequisite. The external-clock camera
  handoff must be resolved and verified before the compositor claims
  random-access correctness.

### Workstream boundary

The Compositor owns the scene-level model:

```text
Composition
├── plane registry and plane policies
├── clip activation and local-clock mapping
├── semantic actions, parameters, and triggers
├── transitions at edited clip boundaries
├── recording/replay journal
├── media/frame readiness
└── serializable inspection snapshot
```

It consumes public Choreo runs and presents one `SeekableRun`-compatible object
to `choreo-player`. The player must not learn about planes, clips, journals,
assets, or edit policy. HyperFrames must not learn about screen composition.

### Phase C0 — deterministic transport gate

Before introducing a compositor abstraction, establish one parity suite for an
existing Choreo composition:

- uninterrupted playback, sequential `renderAt(t)`, direct seek, backward
  seek, and repeated seek produce equivalent state;
- camera transforms are applied on the same browser turn as the requested
  external time;
- capture waits for Choreo, Glimmer render, layout, and plane readiness;
- frame `n` at 60fps is always sampled as `n / 60`, never inferred from wall
  time or a preceding browser frame.

This phase may consume a separately approved camera fix. It adds no compositor
API and no player scene model.

### Phase C1 — headless composition host

Build the first composition host as application-side code using public Choreo
and ordinary Glimmer components:

```ts
interface Compositor {
  readonly run: SeekableRun;
  readonly snapshot: CompositionSnapshot;

  send(action: SemanticAction): void;
  setParameter(target: Address, name: string, value: ParameterValue): void;
}
```

The first host provides:

- a stable composition clock and duration;
- registration and lookup of active runs;
- stable addresses for components and behaviors;
- a semantic action bus;
- `renderAt(t)` as one preparation, sampling, readiness, and commit
  transaction; and
- a read-only snapshot for tests and future Boxel cards.

Do not publish a compositor package in this phase. The proof should be small
enough to move or delete while the contract is still being learned.

### Phase C2 — planes as shared-DOM composition

Add a small `PlaneRegistry` and Glimmer plane host. A plane initially needs:

- stable name and DOM root;
- explicit `over`, `under`, and containment relationships;
- crop/overflow and input policy;
- compositor ⇄ local ⇄ viewport coordinate conversion;
- an optional attached Choreo camera; and
- readiness plus target discovery.

All planes remain in one DOM. A Lower-thirds plane may queue titles and a HUD
plane may ignore the Demo camera, but those are component policies rather than
new engine concepts. Cross-plane drag uses shared pointer capture and
coordinate conversion; it does not add another drag engine.

Prove this with at least a Demo plane, Lower-thirds plane, and Pointer/HUD
plane. Mount existing interactive demo components as the assets.

**Core review gate:** only propose a public core `Plane` primitive after two
different compositions demonstrate behavior that nested Glimmer regions plus
the registry cannot express cleanly.

### Phase C3 — Clip as the one new compositor object

Implement `Clip` as a pure parent-time → source-time mapping over an activated
sequence:

```ts
interface Clip {
  id: string;
  plane: string;
  sourceIn: number;
  sourceOut: number;
  rate: number;
  end: 'remove' | 'hold' | 'freeze';
}
```

The implementation must reconstruct `absent`, `active`, `held`, or `frozen`
state directly from time. It must not play from zero to discover the state at
`t`. Cues before `sourceIn` may be folded to reconstruct private source state,
but discarded outward events must not escape the clip.

Required tests cover trim, slip, rate, non-zero `sourceIn`, end policies,
backward seek, repeated seek, and direct entry into the middle of a clip.

### Phase C4 — semantic actions, triggers, and parameter ports

Add the smallest game-style control surface:

- `send({ target, action, payload })` for discrete intent;
- `setParameter(target, name, value)` for continuous control;
- typed output events for completion, markers, readiness, and application
  state; and
- trigger combinators built from ordinary state and events: `after`, `all`,
  `any`, condition, and cancellation.

Timed actions are stored as semantic commands on the composition clock and
folded through `t`; do not store `.click()` calls or viewport coordinates. Use
idempotent commands such as `lightbox.open`, never time-sensitive toggles such
as `lightbox.toggle`.

**Core review gate:** propose a seek-safe `c.Perform` step only after the
composition-side command fold proves the public semantics. Propose an
addressable override/control channel only when ordinary component arguments,
IDs, roles, and sidecar adapters cannot reach a demonstrated value.

### Phase C5 — camera direction and autoframing

Keep shot direction in Choreo sequences. The compositor supplies targets,
plane bounds, crop, and safe-area information; camera presets expand to normal
seekable Choreo camera steps.

The first preset vocabulary is deliberately small:

- `frame(target | targets, padding)`;
- `aim(target)`;
- `pan(from, to)`;
- `slowZoom(scale | framing)`; and
- `follow(target, constraints)`.

Start with the current DOM camera. Perspective, orbit, dolly, focal length,
and Three.js camera adapters are a later core-camera proposal, not a condition
for the first compositor release.

### Phase C6 — edited boundaries and transitions

Add hard cuts first, then one transition contract. A transition receives
live, reconstructed samples at `A.sourceOut` and `B.sourceIn`; it must never
substitute either source sequence's natural final state.

Crossing is the first proof because it exercises identity, bounds, two mounted
clip samples, and direct seek into the transition. Freeze both source clocks
at their edited samples during the transition. Hidden handles can be added
only after the frozen policy is correct.

### Phase C7 — semantic recording and replay

Record actions and parameters at their stable actor/plane addresses:

- resolve clicks/taps to actions at capture time;
- record movement as normalized or plane-local parameter samples;
- simplify curves without losing endpoints or material velocity;
- preserve random seeds and nondeterministic application inputs; and
- inject replay through the same ports used by live interaction.

Raw DOM event replay is a labelled compatibility adapter, not the durable
journal format. Add checkpoints only when a long replay proves that folding
from the beginning is too expensive.

### Phase C8 — browser-native media and frame barriers

Add HTML video/audio only after the DOM proof is deterministic. Media adapters
own seek, decoded-frame readiness, playback state, gain/volume, crop, fit, and
rate. Canvas and Three.js planes expose an equivalent ready-for-frame barrier.

The compositor chooses media state and placement. `choreo-player` waits for the
barrier. HyperFrames captures the resulting visual frame and performs
audio/video encoding and muxing.

### First vertical slice

The acceptance composition is a 15-second, 60fps piece that:

1. mounts three existing demos as interactive Glimmer assets;
2. directs close-up framing with the Choreo camera;
3. performs at least one semantic interaction on each asset;
4. uses a reusable title/lower-third in its own plane;
5. uses one hard cut and one Crossing sampled at edited clip boundaries;
6. ends on the existing Build Order sequence; and
7. is handed to HyperFrames as one visual clip for final rendering.

Source demos remain unchanged except for stable public action/parameter ports
or test hooks where demonstrably necessary. The reusable runtime PR contains
no reel-specific design or content; the proof composition lives in the test
app or a video project.

### Verification and shipping gates

- A frame-state manifest agrees for forward play, sequential seek, direct
  seek, backward seek, and repeated seek at the beginning, middle, and end of
  every clip and transition.
- Tests use fixture-scoped selectors, `animationsSettled()`, readiness
  barriers, and deterministic clock positions. They do not use fixed sleeps
  or depend on catching a lucky `requestAnimationFrame` sample.
- Existing interactive demos still behave normally outside the composition.
- `choreo-player` remains usable without importing compositor code.
- Normal `glimmer-motion` consumers do not pay for compositor code unless an
  eventual compositor subpath is imported.
- Boxel consumes only snapshots and command APIs; no product UI enters the
  runtime package.
- Any core change is isolated, documented, and explicitly approved before
  implementation.

### Packaging checkpoint

After the first vertical slice, build a second composition with different
plane policies and assets. Extract `glimmer-motion/compositor` only if both use
the same `Clip`, plane registry, action/parameter, readiness, and snapshot
contracts. Until then, **Choreo Compositor is a workstream and capability, not
a package**.

## Open-source precedents

No single small JavaScript engine provides Choreo's full combination of live
Glimmer composition, semantic planes, animation sampling, and replay. Several
open-source engines provide useful structural precedents:

### Targeted naming audit

| Choreo name             | Prior art                                                                                                                                                                                                                                                              | Decision                                                                                                                                                                                                                                                             |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Plane**               | Excalibur uses `CoordPlane.World` and `CoordPlane.Screen` for camera-sensitive versus screen-fixed coordinates. KAPLAY's `Layer` is only a globally ordered list.                                                                                                      | Keep **Plane**. It correctly implies coordinate/camera semantics beyond stacking; do not rename it Layer.                                                                                                                                                            |
| **Camera**              | Excalibur has composable `CameraStrategy` objects such as lock, elastic follow, radius, and bounds. melonJS has `Camera2d`/`Camera3d`, `Frustum`, `fov`, `near`, `far`, `pitch`, `yaw`, `roll`, `followOffset`, multiple viewport cameras, and world/local conversion. | Keep **Camera**. Use `projection`, `frustum`, `viewport`, `safeArea`, `aim`, `follow`, `frame`, `dolly`, and `orbit`. Choreo presets must remain directly sampleable rather than mutable update strategies.                                                          |
| **Clock cue / Perform** | Excalibur sequences can `callMethod`; KAPLAY timers can `wait(time, action)`.                                                                                                                                                                                          | Do not copy callback semantics: neither reconstructs state under random seek. Keep **Perform** for the public step and restrict it to semantic, foldable actions. Avoid public `Cue` because Choreo already uses `Cue` internally for compiled animation deliveries. |
| **Clip**                | These engines use “clip” mainly for render clipping, not an editorial window over a behavior.                                                                                                                                                                          | Keep **Clip**, but define it precisely as a source-time window over a Sequence: `sourceIn`, `sourceOut`, `rate`, and end policy. It is not a renderer clip or another Sequence.                                                                                      |
| **Clip transition**     | Excalibur's Director accepts separate `sourceOut` and `destinationIn` transitions. Its `Transition` has duration, direction, progress, completion, and input policy. Its CrossFade captures a screenshot of the previous scene.                                        | Keep **Transition** as a relationship at a Clip boundary and reuse Choreo sequences such as Crossing. Adopt explicit duration/progress and optional input policy. Do **not** copy screenshot handoff; reconstruct live edited boundary samples.                      |
| **Director**            | Excalibur's `Director` owns scene routing, loading, and transitions.                                                                                                                                                                                                   | Useful product-language precedent, but no new runtime object is needed: the master Choreo Sequence already directs the composition. Boxel may call an authoring card a Director.                                                                                     |

KAPLAY's `animation.seek(time)` and serializable animation channels independently
support Choreo's insistence that source behavior be sampleable. Its mutable
timers, and Excalibur's elapsed-time action queues, are not suitable models for
clock cues or direct export seeking.

### Excalibur.js — actors, scenes, and action lifecycles

[Excalibur.js](https://github.com/excaliburjs/excalibur) is a BSD-licensed
TypeScript 2D engine. Its actors are ECS entities inside scene-local worlds;
actors own action components; actions compose into sequences and parallel
groups; and actions emit start/completion events. Its screen/world coordinate
planes and scene cameras are also a useful minimal precedent.

Choreo should emulate the separation:

```text
Excalibur                         Choreo
Actor                             Actor / addressable component
Scene-local ECS world             Composition / Plane scope
ActionsComponent                  Choreo behavior controller
ActionSequence / ParallelActions  Sequence / Parallel
actioncomplete event              typed completion event
Camera strategy                   Plane camera behavior
```

Do not adopt Excalibur's canvas renderer or game loop. Choreo already has
Glimmer, Motion, and its own external-clock requirements.

### KAPLAY — semantic buttons and virtual input

[KAPLAY](https://github.com/kaplayjs/kaplay) is an MIT-licensed JavaScript/
TypeScript engine built from game objects, components, scenes, and events. Its
Buttons API is the closest precedent for semantic interaction recording:
keyboard, mouse, and gamepad inputs bind to names such as `jump`, while
`pressButton("jump")` and `releaseButton("jump")` inject the same action
virtually for simulation or cutscenes.

Choreo should generalize that model:

```text
raw device input → named Action → actor/blueprint behavior
continuous input → named Parameter → automatable value curve
replay journal   → inject the same Action or Parameter port
```

KAPLAY's object-scoped custom events and component lifecycle are also useful
references. Its rendering and global-style API are not needed.

### melonJS — action-name input mapping

[melonJS](https://github.com/melonjs/melonJS) is an MIT-licensed, actively
maintained 2.5D engine. Its input API binds physical keys to user-defined action
names and can map pointer buttons through the same binding system. This
independently validates keeping physical input outside the semantic behavior
contract. Its renderer abstraction and frame-texture effects are useful future
research for non-DOM planes, but are too large a dependency for Choreo core.

### boardgame.io — command journal and time travel

[boardgame.io](https://github.com/boardgameio/boardgame.io) is an MIT-licensed,
view-layer-independent state engine. Games are changed by semantic move
functions; the engine keeps logs and supports time travel. It is turn-based,
not an animation engine, but its command-log boundary is the right precedent
for Choreo's deterministic event journal and checkpoints.

### Recommendation

Use these as architectural references, not runtime dependencies:

- **Excalibur** for actor-local behavior, sequence lifecycle, and typed
  completion events.
- **KAPLAY** for action maps, virtual action injection, object components, and
  object-scoped events.
- **boardgame.io** for semantic command journals, replay, and checkpoints.
- **melonJS** as later research for GPU/render-plane composition.

Code-reuse policy:

- Reimplement the small semantic action-map core in Choreo's vocabulary. The
  KAPLAY shape is useful, but its implementation is coupled to KAPLAY's input
  devices, application state, and game-object lifecycle.
- Do not port Excalibur's action runner. It is a mutable `update(elapsed)`
  queue, whereas Choreo actions must support direct random-access sampling.
- Do not port boardgame.io's reducer. Its useful idea is the semantic command
  log; the implementation carries turn, multiplayer, Redux, plugin, undo, and
  authorization concerns Choreo does not need.
- If a small implementation fragment is eventually copied rather than
  independently implemented, preserve the upstream MIT/BSD copyright and
  license notice and add focused compatibility tests.

The first small proof should implement a KAPLAY-shaped action map over one
existing Glimmer demo: record a semantic click and a continuous parameter
curve, replay both through the same ports at a different resolution, and then
seek the replay directly under `choreo-player`.

## Stretch goals

- Three.js/WebGL planes rendered directly or supplied as textures to others.
- Track mattes, displacement, shader effects, depth-aware plane composition,
  and offscreen render passes.
- Physics and procedural animation that remain deterministic under seeking.
- Live data recorded as reproducible event streams.
- Directed gameplay replays with checkpoints, alternate cameras, overlays,
  highlights, and non-destructive editorial overrides.
- Action-map authoring and automatic curve simplification for mouse, touch,
  stylus, controller axes, camera movement, and drag gestures.
- Branching or interactive films rendered from different event journals.
- Multiplayer or collaborative event sources feeding the same composition.
- A visual Blueprint editor for triggers, conditions, parameters, and plane
  routing—without turning the product into a Premiere-style track editor.
- Export of the derived edit/event graph as a portable, versioned composition
  document.

## Product boundary

Choreo owns browser truth: components, HTML video/audio playback, Three.js,
canvas, planes, cameras, clips, triggers, automation, and composition.

HyperFrames owns deterministic browser driving and output infrastructure: frame
capture, any required media extraction/proxying, audio/video encoding and mux,
and final file production. It does not decide the screen layout, media timing,
camera, crop, popup, or picture-in-picture behavior.

The result is an interactive game-engine-style compositor that can also direct
and record cutscenes—not an NLE timeline that happens to render web
components.
