## What it is

A compact row of mutually exclusive options, all visible, with a pill that slides to the selected one. Use it for two to five short choices where seeing the alternatives is part of the value — a view mode, a date range, a unit. It sets a **value**; if it switches which panel of content is showing, that is **Tabs**. If the options are long, numerous, or need descriptions, use **RadioGroup**. If the options are filters over a data set and can carry counts, use **FilterChips**.

## The contract

```
@options: { value, label }[]   (required)
@value?, @defaultValue?, @onValueChange?(value: string)
```

Hybrid controlled/uncontrolled: `@value ?? @internal`, initialised from `@defaultValue ?? options[0].value`. Unlike RadioGroup there is no empty state — a segmented control always has a selection, which is the semantic difference from a set of toggle buttons.

**The selected segment's face is not painted by the segment.** It is one `<SlidingHighlight @variant='pill' />` that travels, driven by `motion-core`'s `slidingHighlight` modifier on the rail. The modifier reads the `data-state='active'` attribute the styling already used, so the control did not have to hand over its DOM or thread an active index through. This is the kit's Law 5 second canonical mechanism, and adopting the shared primitive rather than keeping a local copy means the measuring code, first-paint suppression and reduced-motion fallback exist once for SegmentedControl, Tabs and whatever adopts it next.

## Prior art

**Apple HIG** is the origin: a segmented control is a value picker, and HIG is explicit that segments should be similar in width and content type, and that segmented controls are for _selecting_ rather than _acting_. **React Spectrum** does not ship one; the closest is `ToggleButtonGroup` with `selectionMode="single"`. **Radix** likewise has no segmented control — `ToggleGroup` with `type="single"` is the analogue, and it exposes `rovingFocus` and `loop`. **shadcn** implements it as `Tabs` styled as a pill strip, which is exactly the mistake described below.

Pretui's improvement is the shared traveling highlight. shadcn's Tabs-as-segmented and most in-house versions cross-fade a background on the active item; getting the pill to _travel_ means writing measuring code, and here it is a component plus a modifier reused across the kit.

## Accessibility

This is the component's weak point, and it is worth being blunt: **the roles are wrong.**

The rail carries `role="tablist"`, but its children are plain `<button>`s with **no `role="tab"` and no `aria-selected`** — only a `data-state` attribute for styling. A `tablist` whose children are not `tab`s is an invalid ARIA structure; assistive tech is told "tab list, 3 items" and then finds three ordinary buttons, none of which reports selection. A screen-reader user cannot tell which segment is active at all.

Compounding it, `role="tablist"` is the wrong pattern even if the children were fixed: nothing here controls a tab panel. The APG guidance is direct — do not use `tablist` unless it actually swaps panels.

The correct shape is one of two:

- **Radio group** (recommended, because this is a value choice): `role="radiogroup"` with an accessible name on the container, `role="radio"` + `aria-checked` on each segment, roving tabindex so the group is one tab stop, and Left/Right/Up/Down moving _and_ selecting with wrapping.
- **Toolbar**: `role="toolbar"`, roving tabindex, arrows move focus only and activation is separate — appropriate if segments were actions, which they are not.

Other gaps, secondary to the above:

- **No arrow-key navigation** and **no roving tabindex** — each segment is its own tab stop.
- **No accessible name** on the group.
- **No disabled support** on individual options, unlike RadioGroup.
- No visible focus ring is defined; the control relies on the UA outline over a custom face.

**RadioGroup in this same file gets all of this right for free** by using native `<input type="radio">` with a shared `name`. Rebuilding SegmentedControl's semantics on the same foundation — native radios, visually hidden, with the labels as the faces — would close every gap above without touching the sliding highlight. That is the fix, and it is not a large one.

## Theming

Rail and segments consume `--muted-foreground` and `--foreground` for inactive/active ink and `--text-ui-md` for type; the pill itself is **SlidingHighlight**'s, so its fill, radius and shadow are that component's tokens. The 2px inter-segment gap and the rail's `inline-flex` metrics are fixed.

Because active state is carried by the traveling pill plus an ink shift, a season that makes the pill low-contrast against the rail leaves the control reading as four equal buttons. Check the pill fill against the rail background, not against the page.
