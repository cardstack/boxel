# Drift — a car you tune while you are driving it

**Status:** a note, not a build. This is the next demo.

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

| Name   | Pair   | What it feels like                          |
| ------ | ------ | ------------------------------------------- |
| Floaty | 70 / 8 | slow to respond, slow to settle; a boat      |
| Drifty | 120/12 | breaks away early and stays out              |
| Snappy | 220/16 | immediate, twitchy, punishes over-correction |
| Stable | 220/28 | immediate and planted; hard to lose          |

These are not four sets of numbers to paste into the source. `dialkit/store`
carries presets itself — `savePreset(panelId, name)`, `loadPreset`,
`getPresets`, `getActivePresetId`, and a `persist: { presets: true }` option —
all on `DialStoreClass`, none of it in the React layer. So the personalities are
seeded presets, the player picks one, and then *edits it*, which is the whole
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
