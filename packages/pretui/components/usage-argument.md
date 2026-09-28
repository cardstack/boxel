## What it is

The base argument row of a **FreestyleUsage** page — `Args.Base` in the yielded hash. It documents an argument that has **no interactive control**: a component reference, an action, a yielded block, or any type a knob cannot represent. Reach for the typed siblings (**UsageString**, **UsageBool**, **UsageNumber**, **UsageArray**, **UsageObject**, **UsageCssVariable**) when the value _can_ be manipulated; reach for this when it cannot, or when you only want documentation.

## The contract

```
@mode? 'doc' | 'prop'   (default 'doc')
@name?, @type?, @typeLabel?, @description?, @defaultValue?
@required?, @optional?, @hideControls?
<:default>
```

**`@mode` is the lens, and it is the architecture of the whole family.** A usage page authors its `<:api>` block **once**; `FreestyleUsage` renders it twice — as a right-hand **property list** (`prop`) and as an **API table** (`doc`) below. Every Usage component therefore knows both presentations. **`UsageArgument` renders a table row in `doc` and nothing at all in `prop`**, because there is no control to show. That asymmetry is what makes the dual-lens trick work: components with knobs appear in both, components without appear only in the docs.

**The sigil is derived from `@type`.** Yields print as `{{name}}`, CSS variables print bare (their names already carry `--`), and ordinary args print as `@name`. So a reader can tell an argument from a block from a token at a glance, without the page author annotating it.

`@typeLabel` overrides the displayed type when the real type is unreadable — a long union, a generic.

## Prior art

**ember-freestyle's `Freestyle::Usage::Base`** is the upstream, and the invocation surface here is verbatim: same block, same arg names, so a usage page written for ember-freestyle works unchanged.

**Storybook's `argTypes`** is the closest analogue in the wider ecosystem, and it works the other way round: Storybook _derives_ the docs table from TypeScript types and lets you override, so the table is generated and the controls are inferred. That is less authoring, and it produces the well-known Storybook failure mode of a controls panel full of arguments nobody meant to expose, typed as `object` because the inference gave up.

**The Pretui/freestyle bet is that documentation is authored, not derived** — and the dual-lens rendering is what makes that affordable. You write one row and get both the knob and the doc, so the cost of authoring is roughly the cost of the docs alone.

Where it is behind Storybook: no type inference, no linking to the component's source, and no validation that the documented args match the real signature — a renamed arg leaves a stale row and nothing notices.

## Accessibility

No pattern governs it; it is a table row in one lens and nothing in the other.

Gaps, and most belong to the page rather than the row:

- **The `doc` lens renders into `Table`**, so it inherits that component's contract — real `<th>`/`<td>` markup, and everything **Table**'s note says: no `scope`, no caption, no `aria-sort`, all supplied by the caller. Here the caller is **FreestyleUsage**, so the API table's header semantics are its responsibility to get right.
- **The required marker** (`@required` / `@optional`) must reach the accessible name of the row, not just render an asterisk. **FormField** in this kit made exactly that fix — a visually-hidden "(required)" inside the label — and a docs table has the same obligation.
- **The sigil is decorative typography carrying meaning.** `{{name}}` versus `@name` versus a bare token name is a real distinction, conveyed by punctuation that screen readers announce inconsistently (or spell out). The `@type` value is presumably in its own column, which mitigates it.
- **`@description` is prose in a table cell**, so it is announced only when the reader traverses to that cell — which is correct for a table and means the description is not part of the argument's name.
- **The `prop` lens renders nothing**, so an argument documented with `Base` is invisible in the property list. That is intended; it does mean a reader working from the knobs alone will not know the argument exists.

## Theming

**Table**'s tokens for the row (`--card`, `--border`, `--stripe`, `--hover`, the mono eyebrow header voice) plus **Token**'s treatment for the type and default value, and `--muted-foreground` for the description.

Nothing of its own. The type and default cells should use the mono voice — machine values as jewelry, Law 3 — so a reader can distinguish `'md'` the default from _md_ the prose.
