## What it is

A draggable grip on a two-dimensional surface: the dot on a gradient bar, the point on a picking plane, the corner of a crop box.

It is the primitive the spatial controls in this territory are built from, and it is a `<button>` — which is where its keyboard path comes from.

## The contract

```
@x?, @y?     — position within the parent surface, 0–100 (percentages)
@shape?      — 'point' (default) the round dot | 'bar' the vertical stop marker
               a gradient bar uses | 'square' a resize grip
@index?      — index a parent uses to identify which handle a drag grabbed
@step?       — percent moved by one arrow press before modifiers. Default 1
@selected?, @disabled?
@label?      — REQUIRED accessible name: "Start point", "Stop 2", "Origin"
@hitArea?    — extra invisible hit area in px on every side. Default 6
@valueText?  — current value announced to a screen reader ("32%, 60%")
@onNudge?    — arrow-key movement; dx/dy in PERCENT of the surface, already
               multiplied by the modifier keys held
@onActivate? — Enter/Space, and a plain click that did not become a drag
```

**`@onNudge` receives deltas already multiplied by the modifiers held**, so a parent implements one move function rather than re-deriving what Shift means. The modifiers are passed along too, for a parent that wants to distinguish them.

**`@hitArea` is invisible padding on every side**, defaulting to 6px — figui3's hit-area, simplified to one number. A 10px dot with no hit area is a control most people miss.

**`@onActivate` fires on Enter, Space, and a click that did not become a drag** — so selecting a handle and dragging it are different outcomes of the same gesture.

**`@label` and `@valueText` are both required in practice.** A surface of five identical handles with no names is unusable; a handle whose position is never announced is unusable in a different way.

## Prior art

figui3's handles.

Where Pretui is better: it is a `<button>`, so focus, activation and the tab order are the platform's rather than re-implemented on a div. That is the difference between a handle a keyboard user can reach and one they cannot.

Where it is thinner: no rotation or scale handles, no snapping — a parent implements that in its nudge handler — and no multi-handle selection.

## Accessibility

- **It is a real `<button>`**, which is the whole design. Every spatial control in this territory is keyboard-operable because its handles are buttons.
- **`@label` is what distinguishes handles from each other.** "Stop 2" and "Stop 3" are navigable; two unnamed dots are not.
- **`@valueText` is how position is announced.** A handle without it tells a reader it moved but never where to.
- **Arrow keys nudge in percent of the surface**, so movement is proportional rather than absolute — the same key travels the same visual distance on a small pad and a large one.
- **`@hitArea` is a motor-accessibility affordance**, not a convenience: a larger target is easier for everyone and materially easier for anyone with a tremor.
- **`@selected` is a state a parent sets**, and it needs to be perceivable beyond colour in whatever surface hosts it.

## Theming

The handle takes the kit's control and ring tokens, with `@shape` switching geometry rather than palette.

Keeping all three shapes on one token set is what makes a gradient stop, a picking-plane thumb and a crop grip read as the same family of object — they are different shapes of the same affordance.
