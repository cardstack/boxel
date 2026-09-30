# Demos as applications

**Status:** a plan, not a build. Nothing below exists yet.

The gallery has 42 stages and every one of them is named after the thing it
teaches. `Camera`, `Crossing`, `Jump`. A stranger opening `Jump`
sees a list, four buttons, and no reason to press any of them. They press one,
something scrolls, and they leave — having watched a feature rather than used
one.

The stages worth stealing from elsewhere are never named after their
mechanism. A Scrabble board is not called "drag and drop with snapping". A
kiln firing schedule is not called "editable timeline with interpolation".
They are named after what you are trying to DO, and the mechanism is what it
takes to do it. That is the whole difference, and it is not a presentation
problem — it changes what the demo is able to prove.

## Why this matters more here than for most libraries

A tween library can demo itself with a bouncing square, because a bouncing
square is the entire feature. Choreo's claim is about **scenes**: what leaves
before what flies, what a second click mid-flight does, what the motion tells
you that the DOM alone does not. None of that is observable in a stage with
one thing in it and no reason to touch it twice.

An application supplies, for free, the three things a demo has to fake:

- **A reason to act again before the last thing finished.** The interruption
  doctrine is the hardest thing in the library and the easiest thing in a
  game: you grab the next tile while the last one is still in the air, because
  you are playing, not evaluating.
- **State worth accumulating.** A changeset is only interesting when the
  change mattered to you. A board you built is a board you notice being
  wrong.
- **Motion that carries information.** In Scrabble, a tile flying to the
  square is the receipt for a move being accepted. Nobody has to be told the
  animation means something.

## The four tests

Before building a stage, put it through these. A stage that fails the second
one is teaching the wrong lesson no matter how well it animates.

1. **The want.** Can a stranger say, in three seconds and without reading,
   what they are trying to achieve? "Make a word." "Fire the kiln without
   cracking the pot." Not "observe the raise step".
2. **The receipt.** Freeze every animation. What information is lost? If the
   answer is "none, it just looks nicer", the motion is decoration — and a
   demo of decoration teaches people to use this library for decoration.
3. **The keep.** Does the state accumulate into something the person made?
   A stage you can leave in a state of your own making is a stage you are
   invested in.
4. **The finish.** Is there an end — a win, a completed firing, a printed
   ticket — inside a minute? A mini-application, not an application.

And one that is ours alone:

5. **The second click.** Is there a natural reason to act again mid-flight,
   that a person would do without being dared to? If yes, the stage is an
   interruption test that runs itself every time anyone plays with it.

## The slate

Each of these carries a cluster of the vocabulary, and each cluster is chosen
so the API is the RULE of the app rather than a flourish on it. The remaining
undemoed surface (see the audit in the session that added Grip / Release /
Jump) is distributed across them deliberately.

### Bingo — a rack, a board, and a word

Tiles drag from a rack onto a board; a real word scores, a bad one throws the
tiles home.

- `c.gesture` is the rule, not a garnish: a tile arrives at the speed you
  threw it, so a flick across the board feels different from a placement.
- `c.counterpart` — the rack tile leaves as the board tile arrives, one id,
  two elements.
- `c.beacon` — a rejected word flies back to the bag, which is a place, not
  an element.
- `c.Follow` — the running score rides the word while it settles.
- `c.still` — every square nobody played dims for the length of the flight.
- The second click: you are already reaching for the next tile.

**Superseded.** `Release` was deleted rather than absorbed — it duplicated
`Hang`, which was built later and makes the same argument about a throw's
velocity with a game attached. Bingo would still be worth building; it no longer
has a stage to retire.

### Cone — a kiln firing, scheduled and watched

A ramp/soak schedule you build, then fire, then read back.

- The schedule is a timeline; firing it is `run.time` under a transport, and
  scrubbing back through a firing is the honest version of the playhead.
- `c.Scroll @align` + `c.Raise` + `c.Hold @fill` — "jump to the segment that
  cracked it": the log entry lifts out of the list and STAYS marked, which is
  exactly the flash-versus-selection distinction `@fill` exists for.
- ReorderGroup for the segments.
- The want is legible to anyone: do not crack the pot.

Absorbs and retires the `Jump` stage.

### Split-flap — a departure board

The one place where character-by-character delivery is not a gimmick but the
literal mechanism of the object being simulated.

- `@by='character'`, `@order` (`forward` / `reverse` / `center` / `random`) —
  `@order` is currently demonstrated nowhere, and a flap board is the reason
  it exists.
- `stagger`, and the delivery windows.
- The want: the 14:32 to Marseille is delayed and you want to see the board
  admit it.

### Contact sheet — a darkroom that develops as you scroll

Photographs develop when they come into view and stop when they leave.

- The imperative surface, which no stage touches: `inView()`, `scroll()`,
  `scrollInfo()`, and the `InView` class with its `observe` modifier —
  the non-modifier half of the library.
- `onViewportLeave` alongside `onViewportEnter`.
- The want: see the whole roll.

### Still open after those

`toPage` / `appliedCamera`, `easeInAndOut`, `transformPagePoint` /
`transformViewBoxPoint` (drag inside an SVG viewBox or a scaled parent).
The SVG-drag pair wants a map or a seating chart — a plan you drag pins
around on, where the parent is scaled and the naive drag is visibly wrong.

Genuinely not demo material, and better as one documentation line each:
`snapshotAll`, `requestSettle`, `postRender`, `flushPendingMounts`,
`closestLayoutGroup`, `closestMotionConfig` — host-integration seams.
`useScroll` / `useInView` are deprecated React-name aliases.

## What does not change

The deep-dive notes stay exactly as they are. The application is the hook;
the notes under it are the tutorial, and they are the reason a stage is worth
more than the toy it looks like. The pattern is: **play with it for thirty
seconds, then scroll and find out why it was hard.**

Nor does the naming rule apply to the API chips on each stage — those stay
literal (`c.gesture`, `@fill`), because once someone wants to know how, they
want the real names immediately.

## What has happened since

`Drift` was built (see `drift.md`), and it is the first stage that passes all
five of these tests. It also adds a sixth that this doc did not have:

6. **Does anything about it change when the person changes something?** A demo
   with a control panel over it is only worth the panel if moving a number
   changes what the demo IS. Drift's panel changes what it is like to be
   driving; every other control panel in the gallery moves a box around, and you
   take its word for it that the number mattered.

`Release` was deleted, being duplicative of `Hang`. `Grip` and `Jump` still fail
these tests as written, and there is a worked revision for both in the session
that built Drift: `Grip` fails "the receipt" hardest — `dragSnapToOrigin` means
the drag has no consequence, so freezing every frame loses nothing — and wants a
scenario where the card's body genuinely needs the pointer for something else.
`Jump` is the cheaper of the two and survives as an in-place revision.

## The order to do it in

Bingo first. It is the one that most obviously fails the current gallery's
"why would I press this" problem, it absorbs a stage that already exists, and
its API cluster is the one whose value is hardest to see in the abstract —
nobody understands why a flight should inherit a throw's velocity until they
have thrown something.
