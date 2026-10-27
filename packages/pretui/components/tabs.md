## What it is

A horizontal strip of labels that switches which panel of content is showing. Use it when the sections are peers, all belong to the same object, and only one is relevant at a time. If the choice is a _value_ rather than a view — a filter, a unit, a mode you are setting — use **SegmentedControl**; if the sections should all be readable at once, use **Accordion**; if there are more than about six, use a **Select** or a side nav, because a tab strip that scrolls has lost its one advantage.

## The contract

```
@options: { value, label }[]   (required)
@value?, @defaultValue?, @onValueChange?(value: string)
<:default as |value|>          (optional — the panel)
```

Hybrid controlled/uncontrolled, the kit-wide idiom: `@value ?? @internal`, defaulting to `@defaultValue ?? options[0].value`. The block is optional — you can use Tabs purely as a control and render panels elsewhere.

**Only one panel exists.** The block is yielded the active value and renders once; there is no per-tab panel, no `forceMount`, no keep-alive. This is why panel state resets on switch, and it is the right default for a card kit — but it means an expensive panel re-renders on every switch.

**The active underline is not painted by the tab.** It is a single shared `<SlidingHighlight @variant='underline' @thickness={{2}} @radius={{0}} />` driven by the `slidingHighlight` modifier (`components/sliding-highlight.gts`) on the rail. The modifier reads the `data-state='active'` attribute the styling already used, so nothing had to hand over its DOM or thread an index through. The selection _travels_ between tabs rather than cross-fading, and — the actual reason — the measuring code, first-paint suppression and reduced-motion fallback live in exactly one place for Tabs, SegmentedControl, and anything that adopts the primitive next.

## Prior art

**Radix `Tabs`** composes `Root/List/Trigger/Content` with `value`/`defaultValue`/`onValueChange`, `orientation`, `dir`, `activationMode` (`automatic`|`manual`), `List loop` (default true), and `Content forceMount`. **Web Awesome `wa-tab-group`** has `active`, `placement` (top/bottom/start/end), `activation` (`auto`|`manual`, default auto), `without-scroll-controls`, arrow axis following placement, wrapping, disabled-tab skipping and Home/End. **React Aria** exposes `keyboardActivation: 'automatic' | 'manual'` and implements the APG panel rule precisely.

Pretui trades composition for a data API: `@options` is an array, so a tab strip is one line and is trivially derived from a model. The cost is that a tab cannot carry an icon, a count badge, or a close affordance — all of which the three kits above support.

Genuinely better: the underline is a _shared measured primitive_, not a per-tab `::after`. Radix and Web Awesome both leave the indicator to CSS on the active trigger, which cross-fades; getting a traveling underline in those kits means writing the measuring code yourself. Here it is one component and one modifier, reused.

## Accessibility

Governing pattern: APG **Tabs**, with automatic activation.

- `role="tablist"` on the strip, `role="tab"` on each trigger with `aria-selected` set explicitly to `'true'` or `'false'`, and `role="tabpanel"` on the panel.
- **One tab stop.** The active tab is in the tab sequence and the rest are `tabindex="-1"` (the kit's `rovingTabindex`), so Tab moves from the active tab into the panel. When `@value` matches no option, the first tab holds the stop.
- **Arrow keys, Home and End.** Left and Right move to the previous and next tab, wrapping at the ends, and swap under `dir="rtl"`; Home and End jump to the first and last. Moving selects as well as focuses, which APG recommends when panels render without a fetch, as the single yielded panel does here. A key held with Alt, Ctrl, Meta or Shift is left alone, so Alt+Left still goes Back. When a controlled `@value` refuses the change, focus stays on the selected tab. Enter and Space select through the native `<button>`, as does a plain DOM `click()`.
- **Tab-to-panel wiring.** When there is a panel, every tab has `aria-controls` pointing at it, and the panel is `aria-labelledby` the active tab. With no block there is no panel, so the tabs carry no `aria-controls`.
- **The panel is always focusable** (`tabindex="0"`, as Radix sets it), so a panel of plain text can be reached and scrolled from the keyboard. A panel that starts with its own control costs one extra Tab stop; APG drops the panel's stop in that case, and React Aria tracks it with `useHasTabbableChild`.
- **No `aria-orientation`** and no vertical mode; the strip is horizontal only.

SegmentedControl and FilterChips share the strip's shape but none of this keyboard model.

## Theming

`--muted-foreground` (rest ink), `--foreground` (hover and active ink), `--border` (the 1px rail), `--text-ui-md`, `--pretui-ease-snap`, `--space-4` (panel top padding), plus whatever **SlidingHighlight** consumes for the 2px accent bar. Tab height (34px) and the 22px gap are fixed.

A theme must keep `--muted-foreground` and `--foreground` separable, since inactive-versus-active is carried entirely by ink weight plus the underline — there is no background change to fall back on.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| React                        | Pretui               |
| ---------------------------- | -------------------- |
| Tabs (content switcher)      | this tile            |
| Segmented / SegmentedControl | **SegmentedControl** |
| ToggleGroup                  | **ToggleGroup** stub |
| BottomNavigation             | **BottomNav** stub   |
| `value` / `onValueChange`    | same / accept alias  |
| `orientation`                | same                 |
