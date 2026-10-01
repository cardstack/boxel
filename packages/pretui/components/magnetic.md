## What it is

A control that leans toward an approaching pointer, wrapped in a halo that *shows* where the pull starts.

The halo is the point. Upstream magnetics attach a document-level pointer listener and spring the element within an invisible pixel range — nothing on screen says where the attraction begins, and a still frame is just a button. Here the range is real layout: the wrapper reserves it as padding, so one local listener replaces the global one **and** the reach zone can be drawn.

## The contract

```
@range?     — reach in px, reserved as real padding around the control. Default 56
@intensity? — how far the control leans, as a fraction of the falloff-scaled offset, 0–1. Default 0.35
@halo?      — draw the reach zone. Default true
@hue?       — any CSS colour for the halo; defaults to --primary

<:default> — the control being magnetized; keeps all of its own events
```

**`@range` is layout, not a threshold.** It becomes padding on the wrapper, which is what makes a local `pointermove` sufficient — the pointer is genuinely inside the element before anything happens, so no document listener is needed.

**The halo is the resting state.** It is a picture of the control's true, enlarged hit area, and it brightens with proximity, so affinity is legible before anything moves. Turning it off makes the component invisible in a still frame — do that only when a neighbouring affordance already shows the target.

**Touch gets the halo but no lean.** Pulling a control out from under a fingertip is hostile.

**The wrapped control keeps all of its own events.** This wraps rather than replaces — the button inside is still the button.

## Prior art

**motion-primitives' Magnetic** and **react-bits' Magnet/MagnetLines**.

Where Pretui is better: **the reach is visible and the listener is local.** Both upstreams need a document-level `mousemove` precisely because their range is imaginary; making it real padding removes that need and makes the behaviour explicable. The lean is also falloff-scaled rather than linear, so the pull grows as you approach instead of snapping on at the boundary.

Where it is thinner: no spring physics — the return is an eased transition rather than momentum — no axis constraint, and no `MagnetLines` field-grid variant, which is RAF-bound upstream and out of reach here.

## Accessibility

- **The halo is `aria-hidden`.** It is decoration over a control that carries its own semantics.
- **This component adds no interaction, so it adds no keyboard surface.** The wrapped control is reached and operated exactly as it would be unwrapped — which also means the lean is invisible to anyone navigating by keyboard.
- **The reserved range is real hit area**, which is a genuine motor-accessibility gain: the target is larger than it looks, in the direction the pointer is coming from. That is the one part of this component that helps rather than decorates.
- **Reduced motion should stop the lean**; the halo, being the resting state, is what remains.
- **Nothing is conveyed by the lean alone.** It is affinity, not state.

## Theming

`--pretui-magnetic-range` (from `@range`), `--pretui-magnetic-intensity` (from `@intensity`), `--pretui-magnetic-hue` (from `@hue`, defaulting to `--primary`), `--pretui-magnetic-halo-radius`, plus the shared pointer channel `--pretui-px` / `--pretui-py` / `--pretui-nx` / `--pretui-ny` / `--pretui-dx` / `--pretui-dy` that every component in this module writes.

That shared channel is why the pointer components compose: a **Spotlight** and a **Magnetic** in the same surface read the same pointer position from the same custom properties rather than each installing its own listener.
