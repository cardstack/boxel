## What it is

The one-axis layout atom: a flex row or column with a gap on the kit scale and logical alignment. It is the component a React-trained agent reaches for first — Mantine `Stack` / `Group` / `Flex`, Chakra `VStack` / `HStack`, MUI `Stack`, Ant `Space` — shipped as one component with an orientation rather than three names. A `Group` is a horizontal Stack.

Use **Grid** when items align on two axes, **FormLayout** for label/field columns, **ButtonGroup** when buttons should read as one joined control, and **Toolbar** for a keyboard-navigable action row. **StackDivider** (in `stack-divider.gts`) is the hairline to drop between free-form children; **Divider** stays the canonical reading-territory rule.

## The contract

```
@orientation? | @direction? (default vertical)
@gap? (default m), @gapLength?
@align? (default stretch vertical, center horizontal), @justify? (default start)
@wrap?, @inline?
@items?, @dividers?
<:default>          — free-form children
<:item as |item i|> — one per item, when @items is passed
Element: HTMLDivElement
```

**Two forms, chosen by `@items` alone.** Without `@items`, Stack yields its default block and lays out whatever the caller wrote. With `@items`, it renders one authored cell per item and yields `<:item>` with the item and its index; the default block is not rendered in that form, so passing `@items` with only free-form children renders an empty stack. `T` flows from `@items` into `<:item>`, so the block param is typed.

**`@dividers` and the overflow fix only exist in the items form.** A component can only style elements it authored — scoped CSS stamps the component's own hash on the last compound of every selector, so a rule like `.pretui-stack > * + *` never matches a caller's children. In the items form the cell is authored here: it carries `min-inline-size: 0` (the flex-child overflow fix) and the rule between cells is an element this component renders, exactly n−1 of them. In the free-form form `@dividers` is inert, and a caller who wants a rule drops **StackDivider** between their children.

**The gap is a scale, not a length.** `@gap` takes `none | xs | s | m | l | xl` and the `sm`/`md`/`lg`/`default` aliases. `@gapLength` accepts a raw CSS length for the case where the scale is genuinely wrong; it is validated by the kit's caller-value guard and written to `--pretui-stack-gap` in the root's `style`. A rejected value is dropped whole and the scale gap applies.

**Alignment defaults follow the axis.** A vertical stack stretches its children across the column; a horizontal one centres them on the row. `@justify` takes `start | center | end | between | around | evenly`. `@direction` is an alias for `@orientation` and also accepts `row` / `column`.

`@wrap` sets `flex-wrap: wrap`; `@inline` renders `inline-flex`. `...attributes` reaches the root, and a caller `class` composes with `pretui-stack` rather than replacing it.

## Prior art

**Chakra `Stack`** interleaves its `separator` by walking `Children.toArray(children).filter(isValidElement)` — which silently discards string and number children — and then drops `gap` from the container, re-creating spacing as margins on the separator, so `gap` and `separator` interact in a way the API never states. **MUI `Stack`** defaults `useFlexGap` to false, spacing children with `& > :not(style) ~ :not(style) { margin-top }`, which breaks under wrapping, under `row-reverse` and whenever a child is a fragment. **Mantine** splits the idea across `Stack`, `Group` and `Flex`, with `gap` as a free CSS length or theme key. **Ant `Space`** has `size`, `direction`, `align`, `wrap` and `split` (a divider between items). Tailwind is `flex flex-col gap-2`.

Where Pretui is better:

- **One spacing mechanism in both forms.** `gap` is the only spacing, with or without dividers; the rule is a flex item with its own size, not a margin trick.
- **The divider cannot miscount.** Glimmer has no children array to walk, so the honest port is to take the items: `@items` + `<:item>` renders n cells and n−1 rules, typed, with no dropped text children.
- **The overflow fix is built in.** Every source leaves a flex child at `min-width: auto`, so one long unbroken label blows the row out of its container. Items-form cells carry `min-inline-size: 0`.
- **Logical throughout.** No `row-reverse`, no `left` / `right`; RTL costs nothing.
- **The gap re-rhythms with the season.** A scale value maps to `--space-*`, so retuning the spacing tokens moves every Stack at once, where Mantine's raw lengths do not.

Where it is thinner:

- **No reverse direction.** MUI and Chakra accept `row-reverse` / `column-reverse`; here there is none.
- **No responsive props.** MUI's `direction={{ xs: 'column', sm: 'row' }}` and Chakra's responsive arrays have no analogue; the orientation does not flip at a container width.
- **No grow / shrink.** Mantine `Group`'s `grow` and per-child `flex` are absent; a child that should fill needs its own style.
- **No divider in the free-form form.** Chakra and Ant draw one between any children; here that needs the items form or a hand-placed **StackDivider**.
- **No separate row and column gaps.** Mantine `Flex` takes `rowGap` / `columnGap`; a wrapping Stack uses one gap for both.
- **The items form wraps every item in a cell**, so a child that expects to be a direct flex item of the stack (for `flex: 1`, say) gets a wrapper in between.

## Accessibility

No APG pattern — Stack is layout and renders a plain `<div>` with no role.

- **Items-form rules are decorative.** Each rule is a `<span aria-hidden="true">` with no role; the tests assert both. A stack rule separates layout, not sections, and a `separator` role for every hairline would clutter the tree.
- **StackDivider is decorative by default and semantic on request.** It renders `aria-hidden="true"` and no role; with `@semantic={{true}}` it drops `aria-hidden` and renders `role="separator"` with `aria-orientation` (asserted). Its `@orientation` names the _stack's_ axis, not the line's: `horizontal` draws a vertical 1px line for a row. `aria-orientation` echoes that value, which is the opposite of the line as drawn, so a semantic divider in a row announces `horizontal` for a vertical rule. `aria-orientation` reads only `@orientation`; a divider oriented through its `direction` alias falls back to `vertical`.
- **Visual order is source order.** Nothing reorders, so reading order and tab order match what is drawn — the reason there is no reverse direction.
- **Grouping is the caller's.** A Stack of related controls is not a group to assistive tech; add `role="group"` and a label through `...attributes`, or use **ButtonGroup** / **Toolbar** where the semantics are the point.
- **Truncation is the caller's half of the overflow fix.** The cell lets text shrink; ellipsis on the text itself is still the caller's job, and truncated text needs its full value reachable some other way.

## Theming

`--pretui-stack-gap` overrides the scale gap for every value of `@gap`, and is what `@gapLength` writes. Because a custom property inherits, setting it on an ancestor — or passing `@gapLength` to an outer Stack — also overrides every nested Stack's gap unless the inner one passes its own `@gapLength`. `--pretui-stack-rule-color` colours both the items-form rule and **StackDivider** (default `--border`).

The scale maps to `--space-1` (xs), `--space-2` (s), `--space-4` (m), `--space-6` (l) and `--space-8` (xl); `none` is `0`. A season re-rhythms every Stack by retuning those spacing tokens.

Fixed: the rule's 1px thickness, and the root's `min-inline-size: 0`. Stack sets no colour, font or surface of its own — it inherits font-size and is invisible except for its rules.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                                      | Give them                                   |
| ------------------------------------------------ | ------------------------------------------- |
| `Stack` / `VStack` / `Flex direction="column"`   | `<Stack>`                                   |
| `Group` / `HStack` / `Flex` / Ant `Space`        | `<Stack @orientation='horizontal'>`         |
| `gap` / `spacing` / Ant `size`                   | `@gap` (scale), `@gapLength` (raw length)   |
| `align` / `justify` / `wrap`                     | the same names                              |
| Chakra `separator` / MUI `divider` / Ant `split` | `@items` + `@dividers`, or **StackDivider** |
| `Separator` / `Divider` between children         | **StackDivider**                            |
| A two-axis layout                                | **Grid**                                    |
