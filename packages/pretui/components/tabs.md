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

**The active underline is not painted by the tab.** It is a single shared `<SlidingHighlight @variant='underline' @thickness={{2}} @radius={{0}} />` driven by `motion-core`'s `slidingHighlight` modifier on the rail. The modifier reads the `data-state='active'` attribute the styling already used, so nothing had to hand over its DOM or thread an index through. The selection _travels_ between tabs rather than cross-fading, and — the actual reason — the measuring code, first-paint suppression and reduced-motion fallback live in exactly one place for Tabs, SegmentedControl, and anything that adopts the primitive next.

## Prior art

**Radix `Tabs`** composes `Root/List/Trigger/Content` with `value`/`defaultValue`/`onValueChange`, `orientation`, `dir`, `activationMode` (`automatic`|`manual`), `List loop` (default true), and `Content forceMount`. **Web Awesome `wa-tab-group`** has `active`, `placement` (top/bottom/start/end), `activation` (`auto`|`manual`, default auto), `without-scroll-controls`, arrow axis following placement, wrapping, disabled-tab skipping and Home/End. **React Aria** exposes `keyboardActivation: 'automatic' | 'manual'` and implements the APG panel rule precisely.

Pretui trades composition for a data API: `@options` is an array, so a tab strip is one line and is trivially derived from a model. The cost is that a tab cannot carry an icon, a count badge, or a close affordance — all of which the three kits above support.

Genuinely better: the underline is a _shared measured primitive_, not a per-tab `::after`. Radix and Web Awesome both leave the indicator to CSS on the active trigger, which cross-fades; getting a traveling underline in those kits means writing the measuring code yourself. Here it is one component and one modifier, reused.

## Accessibility

Governing pattern: APG **Tabs**. This is where the component is weakest, and the gaps are structural rather than cosmetic:

- Present: `role="tablist"` on the strip, `role="tab"` and `aria-selected` (explicitly `'true'`/`'false'`, which is correct — APG requires `false` on the unselected ones) on each trigger, `role="tabpanel"` on the panel.
- **Missing `aria-controls` on the tabs and `id`/`aria-labelledby` on the panel.** Nothing connects a tab to its panel, so a screen-reader user is told "tab, 2 of 4, selected" and then has to find the panel by reading order.
- **Missing roving tabindex.** Every tab is a native `<button>` and therefore its own tab stop. APG is explicit that a tab list is _one_ tab stop, with Tab moving from the active tab into the panel.
- **Missing arrow-key navigation.** Left/Right (with wrapping) is mandatory in the pattern; there is no `keydown` handler at all. Home/End likewise absent.
- **Missing `tabindex="0"` on the panel** when its content holds nothing focusable — APG's rule, and the one React Aria implements exactly via `useHasTabbableChild`. A panel of plain text here cannot receive focus and cannot be scrolled by keyboard.
- **No `aria-orientation`**, and no vertical mode, so the horizontal default is at least honest.
- **Activation is implicitly automatic** (click selects). That matches APG's recommendation for preloaded panels, which is the case here — but with no arrow keys there is no focus-versus-activation distinction to get wrong yet.

Practically: it is clickable and Tab-reachable, and it is not a conformant tab list. Closing this is the highest-value accessibility work in the controls territory, and it would also fix **SegmentedControl** and **FilterChips**, which share the shape.

## Theming

`--muted-foreground` (rest ink), `--foreground` (hover and active ink), `--border` (the 1px rail), `--text-ui-md`, `--pretui-ease-snap`, `--space-4` (panel top padding), plus whatever **SlidingHighlight** consumes for the 2px accent bar. Tab height (34px) and the 22px gap are fixed.

A season must keep `--muted-foreground` and `--foreground` separable, since inactive-versus-active is carried entirely by ink weight plus the underline — there is no background change to fall back on.

## React ecosystem

| React                        | Pretui               |
| ---------------------------- | -------------------- |
| Tabs (content switcher)      | this tile            |
| Segmented / SegmentedControl | **SegmentedControl** |
| ToggleGroup                  | **ToggleGroup** stub |
| BottomNavigation             | **BottomNav** stub   |
| `value` / `onValueChange`    | same / accept alias  |
| `orientation`                | same                 |
