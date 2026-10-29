---
status: proposed
date: 2026-10-20
scope:
  - packages/host/app/**/*motion*
  - packages/host/app/components/operator-mode/**
  - packages/host/app/components/search-sheet/**
  - packages/host/app/components/pill-menu/**
  - packages/host/app/services/operator-mode-state-service.ts
  - packages/host/app/services/search-sheet-state.ts
  - packages/host/app/services/playground-panel-service.ts
  - packages/host/app/lib/stack-item.ts
  - packages/base/card-api.gts
  - packages/base/field-component.gts
  - packages/base/contains-many-component.gts
  - packages/base/links-to-*.gts
  - packages/pretui/components/**
  - packages/pretui/internal/structure-morph.gts
  - packages/glimmer-motion/src/**
  - packages/choreo/src/**
---

# 007. Keep motion a reactive layer that application state never waits on

Motion in Boxel is a separate layer. It watches state changes and animates
them. Application state changes on its own, at full speed, and is never held
back or broken by an animation. Components declare how they could move and
how changes should move. One engine turns those declarations into animations
and owns all imperative control, using the browser's native animation
machinery wherever it can. Users author cards that run inside host, so motion
has to come from the platform's components, not from code woven through each
caller. This ADR sets the architecture and the quality bar any host motion
must meet.

## 1. Decision

### 1.1. State never depends on motion

A state change MUST have the same result whether or not an animation plays.
Examples are opening, closing or moving a card, changing a stack, and entering
a workspace.

Application and state code MUST NOT await an animation, schedule work after
one, or skip work because one is running.

State MUST NOT hold fields that exist only to serve an animation, such as a
flag that holds back a card's content until a flight ends.

A failed, cancelled or interrupted animation MUST NOT throw into a state
change, roll it back, or drop it.

Once motion settles, the app MUST be in the same state, with the same DOM, as
it is with motion off (in tests or an unsupported browser). Reduced motion
(§1.5) changes how a state change animates, not where it ends.

### 1.2. One engine reacts to state changes

A motion engine MUST produce host animations by observing rendered changes:
what was inserted, removed and kept, and where each element was before and
after.

Host application code, services and state code MUST NOT call imperative
motion methods to start, sequence or coordinate an animation.

A component MUST NOT change its behavior based on whether an animation is
running. It MUST NOT learn this from a motion service or from inspecting the
DOM.

The engine MUST own all imperative animation control: starting, retargeting,
cancelling and cleaning up, plus any temporary layers it needs, such as
snapshots and placeholders. This includes bitmap crossings, such as a View
Transition.

### 1.3. Components declare motion at two levels

Low-level components SHOULD declare how they could move. This covers their
identity, which of their parts may animate, and constraints such as "must not
deform". These are the components at card-api boundaries (`packages/base`
render and field components) and the semantically meaningful Pret UI
(`@cardstack/pretui`) components.

Screen-level components SHOULD declare how possible changes should move: which
change gets which motion, in what order, and with what timing.

A card's platform motion MUST come from the boundary components that render
the card. It MUST NOT require motion code in the card.

A card MAY animate inside its own template with any glimmer-motion API,
including its imperative ones. That motion MUST stay inside the card's own DOM
and MUST NOT read host motion state.

### 1.4. Native animation and libraries

The engine SHOULD hand playback to the browser's native mechanisms: the Web
Animations API, CSS transitions and animations, and View Transitions. Running
animations SHOULD be visible in the browser's developer tools. Host SHOULD NOT
build its own animation inspector or slow-motion control.

Host MAY use glimmer-motion and Choreo inside the engine and in low-level
declarations.

### 1.5. Motion quality

Each animation SHOULD have a purpose. It SHOULD show where something came from
or went, connect a cause to its effect, or confirm an action. Repeated,
high-frequency actions (typing, keyboard navigation in a list, saving) SHOULD
NOT animate beyond immediate feedback.

Under `prefers-reduced-motion: reduce`, spatial motion (movement, scaling,
zoom, parallax) SHOULD become an instant change or a short opacity fade.
Feedback that a state changed SHOULD stay.

A new state change during an animation SHOULD retarget the animation from its
current position. It SHOULD NOT wait behind the old animation.

Pointer, keyboard and focus input SHOULD stay live while an animation plays.
Focus SHOULD move when state changes, not when an animation ends.

Durations SHOULD be:

- 100–200 ms for small feedback: hover, press, toggles and fades.
- 200–300 ms for elements that enter, leave or move within a region.
- 300–500 ms for large spatial changes, such as a card opening into a stack or
  a workspace change.

A direct interaction SHOULD NOT animate for longer than 500 ms.

Entering elements SHOULD ease out (decelerate). Leaving elements SHOULD ease
in (accelerate). An element that moves between two on-screen positions SHOULD
use a standard ease-in-out. The release of a drag or gesture SHOULD use a
spring that starts from the gesture's velocity.

Durations and easings SHOULD come from shared motion tokens, not from literals
in components.

Animations SHOULD change only `transform` and `opacity`, plus `clip-path` or
`filter` where needed. A layout change SHOULD animate by measuring the before
and after positions and applying a transform (FLIP). It SHOULD NOT animate
`width`, `height`, `top`, `left` or `margin` frame by frame.

Text and card content SHOULD NOT scale during motion. Content that moves
between layouts SHOULD sit at its final layout while a frame or a snapshot
animates around it.

Motion SHOULD NOT hide latency. When data is not ready, the state change
happens and shows a loading state.

Motion that starts automatically and runs longer than five seconds SHOULD give
the user a way to pause it.

## 2. Rationale

The model is a game engine. Objects in the world go through their own state
changes, and a separate layer renders and animates them. That layer never
blocks a state change or breaks one when it goes wrong. Boxel needs this
separation more than most apps, because users author the cards that host
renders. Cards should feel like physical objects and keep that feeling in any
environment they render in. That can only work if the physicality lives low in
the platform, in the components that render card-api boundaries. Card authors
cannot be asked to coordinate with a host motion service.

When callers start animations themselves, motion concerns spread into every
caller. Components check a motion service or inspect the DOM to learn whether
an animation is running, and state gains fields that exist only for an
animation. A state change that runs inside an animation's update can be lost
when a second change starts mid-flight. §1.1 and §1.2 rule this out. When
animation cannot reach state, a broken animation can only look wrong. It
cannot leave the app in the wrong state.

Browser developer tools can inspect and slow native animations, so host
needs no animation tooling of its own. The browser also runs native animations
off the main thread where it can, which keeps motion smooth while cards
render.

The quality rules in §1.5 follow widely used guidance. WCAG 2.2 covers reduced
motion (2.3.3) and pausing automatic motion (2.2.2). The duration ranges and
easings are Boxel's own choice, informed by Material Design 3 and IBM Carbon.
They are stated here so that every surface draws on one scale. Interruptibility, live input
and immediate focus keep a productivity app fast, because people repeat its
actions many times a day.

## 3. Considered options

- **A reactive engine with declarative components (chosen).** State stays
  simple and testable. Card authors get motion for free. Motion failures stay
  cosmetic.
- **A central imperative motion service.** Callers ask a service to cross,
  begin or defer. It gives one place for policy. But every caller has to know about motion, state ends up waiting on
  animation, and user-authored cards cannot take part.
- **Each component animates itself, with no coordination.** This works for
  local effects. It cannot give continuity across regions, such as a card
  flying from a tile into a stack, unless components know about each other.
- **A View Transition for every navigation.** This is native and simple.
  But it freezes live content into bitmaps, and the state update has to run
  inside the transition's callback. That makes the state change part of
  playback.
- **Choreo as the engine.** Choreo already reacts to a region's render pass.
  But it declares motion per region and per screen. It has no low-level
  declarations of how a card could move. It stays a building block (§1.4).

## 4. Consequences

A View Transition needs the old frame captured before the DOM changes. So an
engine that uses one has to hook the render pass, not the state change. Where
it cannot, it uses live-DOM motion.

## 5. Remediation

- `packages/host/app/components/operator-mode/stack.gts` breaks §1.1: it
  awaits the closing animations before it closes the cards.
- `packages/host/app/components/operator-mode/stack-item.gts` breaks §1.2: it
  runs its own animations, tracks which one is playing, and changes its
  behavior on that.
- `packages/host/app/components/pill-menu/index.gts` breaks §1.1: the menu
  collapses only on `animationend`.
- `packages/pretui/components/toaster.gts` breaks §1.1: a toast is removed on
  `animationend`, so with motion off it is never removed by its timer.

## 6. Sources

- Edward Faulkner, 2026-10-02: the reactive-layer architecture, the
  two-level declarations, and native animation APIs.
- `.claude/skills/motion-pattern/SKILL.md`: View Transitions freeze live
  content.
- WCAG 2.2, Success Criteria 2.3.3 (Animation from Interactions) and 2.2.2
  (Pause, Stop, Hide): https://www.w3.org/TR/WCAG22/
- Material Design 3, easing and duration:
  https://m3.material.io/styles/motion/easing-and-duration
- IBM Carbon Design System, motion: https://carbondesignsystem.com/elements/motion/overview/
- MDN, View Transition API:
  https://developer.mozilla.org/en-US/docs/Web/API/View_Transition_API
