## What it is

One choice from a small set, with every option visible and labelled. Use it when the options need to be read and compared — payment method, shipping speed, a policy choice — or when there are three to seven of them. Below three, consider a **Switch** or **Checkbox**; above seven, use **Select**, which auto-enables search past that exact count. If the options are short enough to sit in a row and you want a compact control, **SegmentedControl**; if they are filters over data, **FilterChips**.

## The contract

```
@options: { value, label, disabled? }[]   (required)
@value?, @defaultValue?, @disabled?, @onValueChange?(value: string)
```

Hybrid controlled/uncontrolled, the kit-wide idiom. `@disabled` on the group and `disabled` on an option are OR'd, so you can grey the whole set or individual rows.

The `name` attribute is generated once per component instance from `guidFor(this)`. That is the load-bearing detail: **it is what makes these native radios a real group**, which in turn is what gives the component its keyboard behaviour for free. Two RadioGroups on a page never collide.

Each row is `<label>` wrapping `<input type="radio">` plus text — the same `.pretui-choice` row as **Checkbox**, so the two align pixel-for-pixel in a mixed form.

## Prior art

**Radix `RadioGroup`** composes `Root/Item/Indicator` with `value`/`defaultValue`/`onValueChange`, `name`, `required`, `orientation`, `dir` and `loop` (default true, controlling arrow wrap) — and reimplements roving tabindex and arrow navigation in JavaScript over `role="radio"` divs. **React Aria `useRadioGroup`** does the same, with RTL-aware Left/Right, a `getFocusableTreeWalker` filtered to `input[type=radio]`, and a `lastFocusedValue` so re-entry lands where you left. **Web Awesome `wa-radio-group`** renders a `<fieldset role="radiogroup">` with `aria-labelledby`/`aria-describedby`/`aria-errormessage`/`aria-orientation`, manages roving tabindex by hand, and stamps `data-wa-radio-first/inner/last` on children for styling.

Pretui does none of that work, and gets the same result: **native radios sharing a `name` already implement the APG Radio Group keyboard contract in the browser.** One tab stop for the group, Tab landing on the checked radio (or the first if none is checked), Up/Down/Left/Right moving _and_ selecting with wrapping, Space checking the focused radio. Every kit above rebuilds this in JS because they wanted custom markup; Pretui gets custom _appearance_ from `appearance: none` while keeping the native element, so there is nothing to rebuild and nothing to drift. This is the single best accessibility decision in the controls territory, and it is worth copying wherever the kit currently does not — **SegmentedControl**, notably, is the same widget with the semantics thrown away.

One deliberate visual delta, called out in the source: the checked dot is painted `--card` (white) with a hairline, not dark ink on a highlight, so it reads as the same "knob" language as the **Switch** thumb. boxel-ui paints it dark; Pretui diverges on purpose for one selected-state vocabulary across toggles.

## Accessibility

Governing pattern: APG **Radio Group**. `role="radiogroup"` is on the container, and the entire keyboard contract — single tab stop, roving focus, arrow wrap, selection-follows-focus — comes from the platform and is correct.

Gaps:

- **No accessible name on the group.** `role="radiogroup"` with no `aria-label` or `aria-labelledby` is announced as an unnamed group. Inside **Field** or **FormField** the visible label exists but is _not_ wired to the container — `Field` puts `for={{controlId}}` on its label, and RadioGroup does not accept a `@controlId`, so the association cannot be made at all through the public API. This is a genuine API hole, not just an omission: give the group an `@label`, or accept `@labelledBy`.
- **No `aria-orientation`**; the group is visually vertical (`flex-direction: column`) but nothing declares it, so arrow-key expectations are left to the browser's defaults, which is fine but undeclared.
- **No `@invalid` / `aria-invalid` / `aria-required`.** A required radio group cannot be marked as failing except by the surrounding `Field`'s visual dress, which announces nothing.
- **`disabled` uses the native attribute**, removing disabled options from the tab order entirely. APG prefers `aria-disabled` so disabled choices remain discoverable — a user should be able to learn that an option exists but is unavailable.
- **No visible focus ring is defined** on the `appearance: none` face; the UA outline is all there is, and it renders inconsistently over a custom-painted control. Likely WCAG 2.4.7 failure.
- `opacity: 0.45` for disabled will fail text contrast in most seasons.
- The 15px dot is below WCAG 2.5.8's 24×24 target minimum, but the whole `<label>` row is clickable, which satisfies it in practice.

## Theming

`--pretui-control-rest` (→ `--field`), `--pretui-control-border` (→ `--input`), `--primary` (checked fill), `--card` (the dot), `--border` (mixed into the checked hairline), `--pretui-edge-highlight`, `--text-ui-md`.

The 15px circle, 6px dot and 7px row gap are fixed. A season that sets `--card` close to `--primary` erases the dot; define them as a contrasting pair, exactly as with Checkbox's `--primary` / `--primary-foreground`.
