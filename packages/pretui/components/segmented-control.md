## What it is

A compact row of mutually exclusive options, all visible, with a pill that slides to the selected one. Use it for two to five short choices where seeing the alternatives is part of the value — a view mode, a date range, a unit. It sets a **value**; if it switches which panel of content is showing, that is **Tabs**. If the options are long, numerous, or need descriptions, use **RadioGroup**. If the options are filters over a data set and can carry counts, use **FilterChips**.

## The contract

```
@options?: { value, label }[]   (or @items, the same list)
@value?, @defaultValue?, @onValueChange?(value: string)   (or @onChange)
@label?       — the group's accessible name
@disabled?    — disables every segment
```

Hybrid controlled/uncontrolled: `@value ?? @internal`, initialized from `@defaultValue ?? options[0].value`. Unlike RadioGroup there is no empty state — a segmented control always has a selection, which is the semantic difference from a set of toggle buttons.

**The selected segment's face is not painted by the segment.** It is one `<SlidingHighlight @variant='pill' />` that slides between segments, driven by the `slidingHighlight` modifier (`components/sliding-highlight.gts`) on the rail, which reads each label's `data-state='active'`. The measuring code, first-paint suppression and reduced-motion fallback live once in that primitive, for SegmentedControl, Tabs and whatever adopts it next.

## Prior art

**Apple HIG** is the origin: a segmented control is a value picker, and HIG is explicit that segments should be similar in width and content type, and that segmented controls are for _selecting_ rather than _acting_. **React Spectrum** does not ship one; the closest is `ToggleButtonGroup` with `selectionMode="single"`. **Radix** likewise has no segmented control — `ToggleGroup` with `type="single"` is the analogue, and it exposes `rovingFocus` and `loop`. **shadcn** implements it as `Tabs` styled as a pill strip, which gives a value picker tab semantics: a tablist must control panels, and this controls a value.

Pretui's improvement is the shared traveling highlight. shadcn's Tabs-as-segmented and most in-house versions cross-fade a background on the active item; getting the pill to _travel_ means writing measuring code, and here it is a component plus a modifier reused across the kit.

## Accessibility

**A radiogroup of native radios.** The rail is `role="radiogroup"`, named by `@label`; pass it whenever no visible heading names the control. Each segment is a visually hidden `<input type="radio">` sharing one `name`, with its `<label>` as the visible face, so the browser supplies the APG radio contract: the group is one tab stop, arrow keys move and select, the checked state is exposed, and the value takes part in a form. There is no keyboard code of our own.

- **Focus** draws a 2px `--ring` outline on the label of the focused radio (`:has(:focus-visible)`), since the radio itself is visually hidden.
- **Disabled** dims the whole rail; there is no per-option disabled, unlike **RadioGroup**.
- **The selected label is bold**, and a hidden bold copy of each label (`visibility: hidden`, so it never reaches the accessible name) reserves that width, so selection never shifts the segments.
- **A controlled `@value` that rejects a change** puts the radio back; focus stays on the radio the reader moved to.

## Theming

The rail is an `--inset` surface with `--foreground`, edged in `--border`. Labels are set in the ui-label role (`--boxel-ui-label-*`) in `--muted-foreground`; the selected one takes `--card-foreground`, since it sits on the pill's `--card` face, at weight 600 (`--pretui-seg-active-weight`). The pill itself is **SlidingHighlight**'s: `--card` with a `--border-strong` edge and `--shadow-sm`. `--pretui-seg-radius` (Button's corner, `--radius` less 2px) rounds the segments and the pill, and `--pretui-seg-inset` (`--boxel-sp-6xs`) sets the rail's gap, its padding and the radius it adds on top, which keeps the pill's corner concentric with the rail's.

Because the selection is carried by the pill, the ink shift and the weight, a theme whose `--card` and `--inset` are close leaves the pill's edge doing the work. Check the pill against the rail background, not against the page.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.
