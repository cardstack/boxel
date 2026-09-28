## What it is

The array argument row of a **FreestyleUsage** page — `Args.Array`. Docs lens: a table row. Property lens: a control for editing a list of strings bound to the example. Use it for `string[]` arguments — a set of options, a list of tick labels, a column list. For structured data (an array of objects), **UsageObject**; for a single string, **UsageString**.

## The contract

```
@mode? 'doc' | 'prop'
@name?, @description?, @defaultValue?, @required?, @optional?, @hideControls?
@value?: string[]
@onInput?(value: string[])
```

**It is `string[]` only.** Not `unknown[]`, not generic. That is the honest boundary: a text-based knob can round-trip a list of strings and cannot round-trip a list of objects without inventing a serialisation. Arrays of anything else go to **UsageObject**, which shows them as JSON.

**`@mode` is the lens.** The `<:api>` block is authored once and rendered twice — property list (`prop`) and API table (`doc`).

The practical consequence of the string-only decision: the most common array argument in this kit is an options list of `{ value, label }` — **Select**, **MultiSelect**, **RadioGroup**, **SegmentedControl**, **FilterChips** and **SortDropdown** all take one — and **none of them can use this component's knob.** They document their options with **UsageObject** or **UsageArgument** instead. Worth knowing before reaching for `Args.Array`: it fits fewer of this kit's arguments than its name suggests.

## Prior art

**ember-freestyle's `Freestyle::Usage::Array`** is the upstream; the invocation surface is verbatim.

**Storybook's `array` control** is the analogue and takes the same shape — a comma-or-newline-separated text field producing a string array — with the same limitation and the same escape (`object` for anything richer).

So neither system solves the structured-array case with a knob, and both are honest about it. The Pretui port's contribution is the same as the rest of the family: **the control is the kit's own**, so the documentation surface dogfoods what it documents.

Where both are behind what would actually help: no per-item add/remove/reorder. A list knob that lets you drag a fourth item into an options array would make **Select**'s and **Tabs**' usage pages genuinely explorable, and **DuelingPicklist** is right there in the kit as a model.

## Accessibility

No pattern of its own; it renders a text-based control plus a table row.

Gaps:

- **The separator convention is invisible.** A text field holding a list needs to say how items are separated — comma, newline, semicolon — and there is no visible instruction and no `aria-describedby`. That is a **WCAG 3.3.2 Labels or Instructions** gap, and it is worse here than in a normal form because the reader is learning the component, not filling in a known field.
- **A malformed entry produces a silently wrong array.** Typing `a, b,` yields three items with an empty third, and nothing flags it — no `aria-invalid`, no message (**WCAG 3.3.1**).
- **The control's accessible name** depends on the property rail actually wiring a `<label for>`; verify, since the underlying **Input** generates no name of its own.
- **The current item count is not announced.** After editing, a screen-reader user has the raw text and no confirmation of how many items the component parsed — which is exactly the ambiguity the separator convention creates.
- **Changing the knob re-renders the example silently** — no live region.
- **`@required` must reach the accessible name** in the docs lens rather than only rendering an asterisk.

## Theming

**Input**'s tokens for the control, **Table**'s for the doc row, plus the property rail's label voice and **Token**'s treatment for the default value in the docs table.

Nothing of its own. The docs table's default-value cell is where an array default (`['sm', 'md', 'lg']`) is rendered, and it should be in the mono voice — Law 3, machine values as jewelry — so a reader can distinguish the literal from prose describing it.
