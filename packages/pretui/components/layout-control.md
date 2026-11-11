## What it is

A toolbar row that fits its controls to its own width. Each control sits in a `Slot` that lists the forms it can take, richest first (a search field → a shorter field → an icon). The bar measures its inline size with a `ResizeObserver`, picks one form per slot, and renders only that form. A slot whose last form is `'menu'` can fold into one ⋯ overflow menu at the end of the row.

It lays out and chooses; it paints nothing. It is not a page header (no title slot) and not a selection bar. `ActionBar` also has an overflow menu, but it keeps a fixed number of actions visible (`maxVisible`); LayoutControl decides from the measured width, and steps each control down through its own forms before folding anything.

## The contract

```gts
<LayoutControl @label='Directory' as |lc|>
  <lc.Slot @id='add' @priority={{0}} @forms={{ADD_FORMS}} as |form|>
    {{#if (eq form 'icon')}}<IconButton @label='Add employee' … />{{else}}<Button>…</Button>{{/if}}
  </lc.Slot>
</LayoutControl>
```

| Arg              | On   | Meaning                                                                                                                                                                                                                                                          |
| ---------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@label`         | bar  | accessible name of the `role='group'` row (default `'Toolbar'`)                                                                                                                                                                                                  |
| `@controlHeight` | bar  | any CSS length; sets `--pretui-row-h` (and `--control-height`) on the bar so every control that reads it shares one height (default: none set, so each control keeps its own height, unless an ancestor sets one)                                                |
| `@overflowLabel` | bar  | name of the ⋯ button (default `'More options'`)                                                                                                                                                                                                                  |
| `@id`            | Slot | stable id, unique in the bar                                                                                                                                                                                                                                     |
| `@priority`      | Slot | 0 = most important; larger steps down sooner (default 1)                                                                                                                                                                                                         |
| `@forms`         | Slot | `{ name, minWidth }[]`, richest first. **`minWidth` is in rem**, converted with the root font size, so the chooser follows the user's text size                                                                                                                  |
| `@label`         | Slot | the slot's name: its ⋯ section heading, the `'@label…'` item text, and the fallback panel's accessible name (default `@id`)                                                                                                                                      |
| `@menuItems`     | Slot | native ⋯ items while folded: `LayoutControlChoice[]` — `{ label, value, checked?, group?, onSelect? }`, a `menuitemradio` when `group` is set, a `menuitemcheckbox` otherwise — or kit `MenuEntry[]` (passed through, the earlier shape). Grouped under `@label` |
| `@pinned`        | Slot | never folds into ⋯ (its `'menu'` form is ignored); still steps down its other forms. The primary action is `@pinned`                                                                                                                                             |

**Folding.** A folded slot with `@menuItems` becomes a labelled section of native items in the ⋯ `Menu`. Without them it becomes one item, `'@label…'`; choosing it opens the slot's richest form in the kit `Popover`, anchored to ⋯. When the viewport is under 40rem (640px) it opens in the kit `Drawer` at `placement='bottom'` (a bottom sheet) instead. Focus moves to the first control inside; Esc or a click outside closes it, and focus returns to ⋯. The content is the slot's own block, moved with `in-element`, so it keeps its state and wiring. A resize that unfolds the slot closes the panel.

**LayoutControl-ready checklist.** A component is ready to sit in a slot when:

- [ ] it reads `--pretui-row-h`, or LayoutControl maps it onto a height knob the component has (see Equal height);
- [ ] it has a `@display`-style arg for its smaller forms, or the author swaps components per form in the slot block;
- [ ] every form the slot lists declares a `minWidth` (rem) that covers its widest real content;
- [ ] it supplies `@menuItems` when it should fold to native menu items; otherwise it folds to the `'@label…'` fallback, so its full form must work inside a popover or sheet;
- [ ] the primary action is `@pinned`.
- [ ] a kit `Menu` placed in a slot wires its trigger: `<:trigger as |open toggle|>` and `{{on 'click' toggle}}` on the button. Menu adds `aria-haspopup`, `aria-expanded` and arrow keys, but does not open on click by itself.

The bar yields `{ Slot, overflow: { active, folded } }`; each Slot yields the chosen form name.

**The chooser** (`chooseForms`, exported and pure):

1. Every slot starts at its richest form.
2. While the summed `minWidth`s plus gaps (plus the ⋯ button, once anything folds) exceed the width, step one slot down.
3. The slot that steps is the one that has stepped least, so the row degrades evenly.
4. Ties go to the least important slot (highest `@priority`, then the later one).
5. `'menu'` is the last form: the slot leaves the row and its `@menuItems` appear in the ⋯ menu.
6. A slot without a `'menu'` form, or with `@pinned`, never folds. That is how the primary action stays visible.
7. Stepping down happens at the exact width; stepping back up needs 16px of spare room (`HYSTERESIS_PX`), so a boundary width doesn't flicker.

**Measuring: the row never wraps.** The bar is `flex-wrap: nowrap` and each slot `white-space: nowrap`. A declared `minWidth` is only the first guess. One animation frame after each choice renders, the bar measures every visible slot (the boxes of its rendered children, since a slot is `display: contents`):

- a slot taller than 1.25 control heights has wrapped inside (FilterChips wraps its chips); its width × line count is recorded as that form's width, which steps it down;
- a slot that fits records its real width;
- if the row still overflows (`scrollWidth > clientWidth`), the deficit is charged to the least important slot that can still step.

Real widths (from renders that fit) are cached per slot + form and replace `minWidth`. A form that wrapped or overflowed is remembered only for bar widths below the one it failed at; once the bar is 16px wider than that, the form is tried again and re-measured, so growing the bar always returns to the richer forms. Each resize gets at most 8 measure-and-step frames, so a bad guess costs a frame or two and can't loop. A slot whose content grows later (new chips, longer labels), or whose `@forms` change, is re-measured on the next resize, not at once. Children are not restyled: a component that wraps internally simply gets stepped to its next form.

Only the chosen form is rendered. Alternatives are never hidden with CSS, so they never reach the accessibility tree or the tab order.

An `icon` form must still do the job of the richer form. For a search slot that means `<SearchInput @display='collapsed' />`: the square opens the field over the row with focus in it, and Escape or leaving collapses it and returns focus. Hold the text in your own state (`@value` + `@onInput`), since changing form remounts the control and an uncontrolled field would lose it.

Limit: the opened field is 15rem wide (`--pretui-search-open-w`) and lies over the row, but the row clips its overflow. When the bar is narrower than the field, or the slot sits within 15rem of the bar's inline end, the field is partly or wholly clipped.

## Prior art

| System                                                 | What it does                                                                                           | Where we differ                                                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| React Spectrum `ActionGroup` `overflowMode='collapse'` | Measures, moves trailing actions into a "…" menu; `buttonLabelBehavior='collapse'` hides labels first  | Same two stages (shrink, then fold), but per slot with any number of forms, not one label/icon switch for the group |
| MUI / Ant Design toolbars                              | No built-in fit; apps use breakpoints (`useMediaQuery`, `Grid` breakpoints) or Ant `Menu` overflow `…` | Container width, not viewport; a toolbar in a narrow pane adapts even on a wide screen                              |
| WordPress block toolbar                                | Collapses groups into a "More" dropdown as width shrinks                                               | Same idea; ours keeps the primary action out of the fold by declaration, not position                               |

What we leave out: no per-item `isHidden` breakpoints, no CSS `display: none` variants, no up-front measuring (forms declare a `minWidth` as the first guess; the bar replaces it with measured widths once a form has rendered).

## Accessibility

- The row is `role='group'` with `@label`. Each control keeps its own tab stop; it is not an APG toolbar (no roving tab stop or arrow keys), which would conflict with the text input a row often holds.
- The ⋯ trigger is an `IconButton` (required label → `aria-label` and `title`) inside the kit `Menu`, which gives the APG menu-button contract: `aria-haspopup`, live `aria-expanded`, arrow keys, Escape and focus return.
- Folded slots with `@menuItems` appear as `role='group'` sections named by `@label`; choices with `group` are `menuitemradio`, without are `menuitemcheckbox`, each with `aria-checked`.
- The fallback popover is `role='dialog'` named by `@label`; the bottom sheet is a modal native `<dialog>`. Both take focus on open and hand it back to ⋯ on Esc.
- The section label renders in the kit Menu's group-label style (sentence case). Caps would need a knob on `menu-panel.gts`, which this change does not touch.
- A form change keeps state in the caller (the value lives in the parent), so shrinking a field to an icon loses nothing. Focus inside a form that is swapped out is lost; resizing is rarely done while typing.

## Theming

| Knob                                                              | Default                                            | Effect                                                      |
| ----------------------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------- |
| `--control-height` (via `@controlHeight`, or set by any ancestor) | the theme's `2.5rem` in a themed scope, else unset | row min-height; also the ⋯ button size the chooser reserves |
| `--pretui-row-h` (via `@controlHeight`)                           | unset                                              | the height a control that reads it takes                    |
| `--pretui-lc-gap`                                                 | `var(--boxel-sp-xs)`                               | gap between slots; the chooser reads the computed gap       |

**Equal height.** `@controlHeight` sets `--pretui-row-h` on the root, beside `--control-height`. The theme defines `--control-height` for every themed scope, so a control reads the row-scoped `--pretui-row-h`, which only a sized row sets. SegmentedControl, FilterChips, Select, Button, IconButton, Input and the typed inputs built on it (not Textarea), SearchInput and InputGroup take it as the first link of their height chain (`--pretui-row-h`, then the control's own knob, then its default), so custom properties inherit and no `:deep()` or `!important` is needed. A control that doesn't read it keeps its own height and renders its default form; the bar still measures it, so the chooser works either way. The contract is for single-line controls.

A control joins by adding, in its own component:

- its height read as `var(--pretui-row-h, var(--pretui-<name>-h, <current height>))`, so a sized row sets it;
- a `@display` arg for its smaller forms (so a slot block can pass `@display={{form}}` instead of swapping components);
- a documented `minWidth` (rem) per form.

No colour, border or radius of its own. Separators or a band are the caller's.
