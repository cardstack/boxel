# Drift — a car you tune while you are driving it

**Status:** built. The stage is `test-app/app/components/examples/drift.gts`,
the model is `test-app/app/lib/drift.ts`, and the panel grew the folders and
presets this note said it needed. What follows is the note as written, with a
section at the end recording the four places the build proved it wrong.

Hang got a dial over it because it had two hand-tuned numbers and nowhere
honest to put them. Two numbers is enough to prove the seam works and not
enough to prove the seam is worth having: you can hold `damping: 28` and
`stiffness: 100` in your head, and a panel over them is a convenience.

A top-down drift car cannot be held in your head. Three spring pairs, a grip
model, and a handful of scalars that only make sense in combination — and,
crucially, **the combination is the thing being designed**. You do not tune a
drift car by finding the right damping. You tune it by driving, feeling that it
pushes wide, moving one number, and driving again. That is the loop a dial panel
exists for, and nothing else in the gallery has it.

## Why this one and not another

The four tests in `demos-as-applications.md` are about whether a stranger wants
to touch the stage. Drift passes all of them and adds the one Hang cannot:

- **The want** is instant and needs no text. It is a car.
- **The second click** is not a click at all — it is a continuous input you
  never let go of, so the interruption doctrine is under load the entire time
  rather than once per throw.
- **The keep** is the tune. You leave with a car that handles the way you
  decided it should, and `persist` means it is still there tomorrow.
- And the new one: **the panel changes the feel, not the look.** Every other
  demo of a control panel in the wild moves a box around. This one changes what
  it is like to be driving.

## The honest part, before anyone builds it

A drift is not a spring, and the demo must not pretend otherwise.

Motion's springs are **scalar interpolators toward a target**. They are the
right tool for anything with a rest position the value is chasing:

- **Steering angle** — the wheel returns to centre. A spring, legitimately.
- **Body yaw / visual lean** — the chassis rotation lagging the heading. A
  spring, legitimately, and the most satisfying one to tune.
- **Camera settle** — see below.

They are the wrong tool for the part that makes it a drift game:

- **Grip.** Lateral slide is a velocity decomposition — forward and sideways
  components of the car's velocity relative to its heading, with the sideways
  component bled off at some rate. That rate is a friction coefficient, not a
  stiffness, and no spring produces it.
- **Traction loss and recovery.** A threshold on the sideways component, with
  hysteresis so the car does not chatter in and out of a slide.

So: the demo writes a small rAF integrator. Position, heading, velocity,
per frame, by hand. That is fifty lines and it is not Choreo's job. Anyone
picking this up should budget for it up front rather than discovering halfway
in that `@spring` will not make the car slide.

Saying this plainly is the point of the note. A demo that implies springs are a
physics engine teaches the wrong thing about the library, which is exactly the
failure `demos-as-applications.md` is written against.

## What Choreo is actually for here

The driving loop is not a Choreo score. What sits around it is:

- **The chase camera.** `c.Camera` with `c.Tether` / `c.Aim` — the camera
  follows the car, leads into the corner, and pulls back with speed. This is
  the single best argument for the camera API that the gallery does not
  currently make: `Camera` is demoed on a static plan, where "the camera moved"
  is indistinguishable from "the content moved".
- **Skid marks.** Each mark is inserted while the car is sliding and removed
  when it ages out — `c.inserted` / `c.removed` over a list nobody clicked to
  build. A changeset driven by physics rather than by a button.
- **The lap replay.** `run.time` under a transport, over a recorded lap. Scrub
  back to the corner you blew. This is the honest playhead demo that
  `demos-as-applications.md` wanted from Cone, on content the person made by
  driving rather than by filling in a form.

## The four personalities are presets, and the store already has them

The handling characters from the design — as `stiffness / damping`:

| Name   | Pair   | What it feels like                           |
| ------ | ------ | -------------------------------------------- |
| Floaty | 70 / 8 | slow to respond, slow to settle; a boat      |
| Drifty | 120/12 | breaks away early and stays out              |
| Snappy | 220/16 | immediate, twitchy, punishes over-correction |
| Stable | 220/28 | immediate and planted; hard to lose          |

These are not four sets of numbers to paste into the source. `dialkit/store`
carries presets itself — `savePreset(panelId, name)`, `loadPreset`,
`getPresets`, `getActivePresetId`, and a `persist: { presets: true }` option —
all on `DialStoreClass`, none of it in the React layer. So the personalities are
seeded presets, the player picks one, and then _edits it_, which is the whole
arc: start from a character, discover what one number does, end up with yours.

Semantic controls sit over the raw pairs by lerp — a single "Looseness" slider
that moves grip, yaw stiffness and steering return together along the line the
four personalities trace. Raw pairs stay available underneath, in a folder.
That is the standard two-tier tuning UI and it needs nothing new from the store.

## What the spike does not do yet

Two gaps, both known, both small, and both wanted by this demo specifically:

**Folders.** `ControlMeta` already carries `type: 'folder'` and
`children?: ControlMeta[]` — the store hands out a tree. `DialPanel` flattens it
away: `get sliders()` filters `controls` to `type === 'slider'` and never looks
at `children`. Hang's config is two flat numbers so this cost nothing. Drift's
config is nested by construction (steering / yaw / grip), so the panel has to
walk the tree and render a collapsible group. dialkit's stylesheet already has
the classes — `.dialkit-folder-inner` is in use in the spike today, it just
never has more than one of them.

**Presets.** No UI at all. The store API above is the whole backend; what is
missing is a row of buttons and a save affordance.

Also worth having, and cheap once folders exist: `type: 'spring'`, which
dialkit models as `{ stiffness, damping, mass, visualDuration, bounce }` —
the same shape Choreo's `@spring` takes. Three spring pairs is three spring
controls, not six sliders.

## The panel

```
Drift
  [ Floaty ] [ Drifty ] [ Snappy ] [ Stable ]     ← presets
  Looseness  ──────●──────                        ← the semantic control
  ▸ Steering    spring
  ▸ Yaw         spring
  ▸ Grip        slider ×2 (bite, release)
```

Presets on top because that is where you start. The semantic slider next
because that is the second thing anyone touches. The raw folders closed by
default, because they are the third.

## Order

After the panel grows folders and presets — those are prerequisites, not
follow-ups, and they are the reason to do this next rather than to do it
eventually. The integrator is independent of both and can be written first
against hardcoded numbers, which is also the fastest way to find out whether
the car is fun before any of the tuning surface exists.

## What the build changed

Six corrections, kept because each one was an argument this note made
confidently and got wrong.

**`c.Tether` is not a camera.** This note proposed the chase camera as
"`c.Camera` with `c.Tether` / `c.Aim`". `c.Tether` draws a wire between two
sprites (`steps.gts`: `@path` receives both endpoints' boxes and returns path
data) and has nothing to do with the shot. `c.Aim` and `c.Frame` are the camera
steps.

**The chase camera is not a Choreo camera at all.** `c.Camera` is a seekable
CUE — a shot change with a duration, compiled into a score, reconstructible
under random access. A chase camera is a target that moves every frame and a
lens that never arrives. Compiling a region sixty times a second to say that
would be a misuse of the score. The shot is a spring in the same loop as the
car, and the split — a score for the scene change, a loop for the simulation —
turned out to be the most useful thing the stage teaches.

**`type: 'spring'` is not cheap, and it is not called that.** dialkit's store
emits `type: 'transition'` for a `SpringConfig` (store `index.js:552`), whose
value is the whole spring object plus a companion `path.__mode` switching
between an easing curve, a two-number "simple" form and a five-number
"advanced" one. Folders of ordinary sliders get the same nesting for none of
that. See `notes/dialkit.md` for the full account of the second pass.

**The skid marks are a canvas.** The note wanted them as `c.inserted` /
`c.removed` over a list nobody clicked to build. A mark is laid every few world
pixels of slide, which at speed is twenty a second — and a changeset twenty
times a second is a render loop wearing a changeset's clothes. Choreo's
business here is the lap board: one tracked write per lap, an entry inserted,
the rows under it moved because it pushed them, and the slowest lap gone.

**The four personalities are not four spring pairs.** The table above gives
each character a `stiffness / damping`, as though the springs were what
distinguishes them. They are not, or not mostly. What decides whether a car
drifts is a pair in the GRIP model, and the two pull in opposite directions:
`release` is the slip fraction at which the tyres let go — LOW breaks traction
easily — and `bite` is how hard the sideways component is bled off while they
still have hold — HIGH catches the car once it comes back under the threshold.
Low release with high bite is the drift-car recipe: it steps out at the smallest
provocation and hooks up hard the moment the angle comes off. The first cut had
it backwards and produced a car that would not slide and, when it finally did,
would not stop.

**The springs still matter, for a reason the table does not give.** They are
what lets a car hold POWER. Drifty went from lapping cleanly to managing one lap
in ninety seconds when its engine went up by 15%, and the fix was damping 12 →
20 on both springs rather than any change to grip. More engine needs more
damping; dropping the power back would have been the easy answer and the wrong
one, since a drift car with no power cannot get the tail out in the first place.

## The thing the note did not anticipate at all

**The demo needs a driver.** Tuning a car you are also driving is not a
measurement: a worse car and a better driver arrive together, you adapt inside
one lap, and you conclude the slider did nothing. `autopilot` in `lib/drift.ts`
hands the wheel to something that never adapts, and it is the stage's most
useful control.

Getting it to drive well took four structural fixes, and the order they arrived
in is the useful part:

1. **Brake on signed forward speed, not on `speedOf`.** Braking was negative
   throttle, which pushes the forward component through zero — and a car
   reversing at 300 has a `speedOf` of 300, so the controller saw a car still
   too fast and braked harder. It accelerated backwards at full lock for ninety
   seconds. The brake is now its own pedal and cannot do that.
2. **Catch the slide before aiming at the gate.** Past a drift angle the car is
   spinning, and a controller that keeps aiming asks for lock in the direction
   it is already rotating. Blended, not switched — a hard threshold makes the
   bot twitch on the boundary.
3. **Let the model say when the car is stuck.** `car.pinned` is set where the
   wall clamps the position, because the geometry is already in hand there. The
   autopilot had been inferring it from a heading-error threshold and missing
   every car wedged at an angle rather than square on.
4. **Give it a racing line.** This was the big one. Aiming at the next gate is
   not a line — it is a sequence of points, some of them behind the car — and
   every symptom of the bot driving badly came from not having one. It follows a
   spline through the gates now, pure-pursued with a speed-scaled lookahead, and
   brakes on the line's curvature against the model's own turn rate rather than
   on a hand-rolled guess at how square the corner is.

Its gains were swept rather than chosen, and the ranking took three attempts:
on total laps it picks a driver that is brilliant in a planted car and cannot
hold a loose one; on laps alone it picks one that brakes to a crawl and never
slides, which on this stage is the same as failing. Ranked on the worst
character's lap count first, then on speed carried and time spent sideways, it
gets every character round without touching a wall.

## What is worth stealing from this

- **`car.walled` exists to be counted.** "Does this tune put the car in the
  barriers" is the cheapest useful proxy for "is this drivable", and it is not
  something a lap time can tell you — a car can reach a good lap time by
  bouncing off things.
- **A boolean cannot report a difference of degree.** The claim that looseness
  makes the car slide more was measured as the fraction of the lap over the
  traction threshold, and it saturated the moment the defaults got loose enough
  to be worth shipping: 74% against 71%, while the two cars plainly looked
  nothing alike. Mean drift angle says it properly.
- **Measure a property of the car with a fixed input.** The same claim measured
  through the autopilot came out backwards, because the bot catches slides and
  therefore saves a looser car sooner. Both numbers were true; neither was about
  the car.
