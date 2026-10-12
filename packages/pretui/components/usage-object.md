## What it is

The object argument row of a **FreestyleUsage** page — `Args.Object`. Docs lens: a table row. Property lens: the value rendered as an inspectable JSON tree. Use it for any structured argument — an options array, a config bag, a record — that the simpler knobs cannot express. For a plain string, **UsageString**; a list of strings, **UsageArray**; a value with no manipulable form at all, **UsageArgument**.

## The contract

```
@mode? 'doc' | 'prop'
@name?, @description?, @defaultValue?, @required?, @optional?, @hideControls?
@value?: unknown
```

**Note what is absent: there is no input callback.** Every other typed knob in the family round-trips a value; this one **displays** and does not edit. That is the honest boundary — a generic structured editor is a component in its own right, and inventing a half one inside a documentation row would produce a knob that can corrupt the example it is demonstrating.

**`@value` is `unknown`**, the widest type in the family, and goes straight to `JsonTree`, which takes plain JSON-safe data. A circular structure is not handled.

**`@mode` is the lens.** The `<:api>` block is authored once and rendered twice — property list (`prop`) and API table (`doc`).

This is where **the kit's most common array argument lands**: an options list of `{ value, label }`, taken by **Select**, **MultiSelect**, **RadioGroup**, **SegmentedControl**, **FilterChips** and **SortDropdown**, is documented here rather than by **UsageArray**, which is `string[]` only.

## Prior art

**ember-freestyle's `Freestyle::Usage::Object`** is the upstream; the invocation surface is verbatim.

**Storybook's `object` control** is the analogue and it _does_ edit — a JSON textarea that parses on change, plus a tree view. That is more capability and it is genuinely useful for exploring a data-driven component; it is also the control most likely to leave a story in a broken state after a typo, which is presumably why the port stopped short.

Where the Pretui version is better: **a real tree view rather than a blob of JSON text.** `JsonTree` gives collapsible nodes, so a reader inspecting a fifty-row options array sees its shape rather than scrolling a wall. Storybook's editing textarea makes you read the raw serialization.

Where it is behind: no editing (above). `JsonTree` rows do copy their path and value from the keyboard (Ctrl/Cmd+Shift+C and Ctrl/Cmd+C).

## Accessibility

No pattern of its own; it renders a JSON tree plus a table row.

The tree is where the accessibility questions are, and they are worth checking rather than assuming, because JSON viewers are routinely built as nested `<div>`s with click handlers:

- **A collapsible tree should be the APG Tree View pattern** — `role="tree"`, `role="treeitem"`, `aria-expanded` on branches (and **absent**, not `false`, on leaves), `aria-level`/`aria-posinset`/`aria-setsize`, a roving tabindex so the tree is one tab stop, and Right/Left/Up/Down/Home/End. `JsonTree` implements it: `role="tree"` and `treeitem`, `aria-level`/`aria-posinset`/`aria-setsize`, `aria-expanded` on branches and a roving tabindex.
- **If it is not a tree, it is at minimum a set of disclosure buttons**, each needing `aria-expanded` and a name that says what expands.
- **A large object is a lot of announced text.** Deep JSON read linearly is close to unusable; the collapsed-by-default state is the accessibility feature, and expanding should be the user's choice.
- **Punctuation-heavy content** — braces, brackets, quotes, colons — is announced inconsistently and often verbosely. A tree with structural nesting instead of visible punctuation reads far better.
- **`@required`** adds a visually hidden "(required)" beside the asterisk, in the property row and the doc row.
- **Nothing is editable**, so there is no invalid state to announce — which is one genuine upside of the read-only decision.

## Theming

`JsonTree`'s tokens for the tree (mono voice, key and value inks, the disclosure affordance), **Table**'s for the doc row, and the property rail's mono label. The knob caps the tree at 7.5rem tall and sets its indent to `--boxel-sp-sm`; rows keep JsonTree's own height.

The key/value ink distinction is the thing to check in each theme: a JSON tree is read by scanning for keys, and if `--foreground` and `--muted-foreground` converge, the structure flattens into an undifferentiated block of mono text.
