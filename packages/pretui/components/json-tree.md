## What it is

JSON rendered as a real APG treeview: expandable containers, type-coloured scalars, child counts, and a copy-path affordance on every node.

## The contract

```
@json?     — the document as text; takes precedence over @value when both are set
@value?    — the document as a plain JavaScript value
@label?    — accessible name for the tree. Defaulted, so nothing is required
@defaultExpanded? — container paths open on first render, as pathKey strings ('$' is
             the root). Ignored once the reader expands anything themselves
@expandAll? — open every container on first render
@query?    — case-insensitive filter over property names and scalar values
@pageSize? — children rendered per container before truncating. Default 100
@hideToolbar? — hide the name, match count and expand/collapse-all controls
@onSelect? — fires with the node and its path on Enter, Space or click
@onParseError? — fires when @json could not be parsed

<:empty> — replaces the default empty state
```

**`@defaultExpanded` stops applying the moment the reader expands anything.** A caller's opening state is a starting point, not a policy that fights the person using it.

**`@onParseError` reports half-typed input too**, and the diagnostics carry `isIncomplete` — so a live editor can tell "not finished" from "wrong" and avoid shouting at someone mid-keystroke.

**`@pageSize` truncates children per container**, which is what keeps a document with a ten-thousand-element array from rendering ten thousand rows.

## Prior art

**JsonTree.js**, used as a specification rather than as a runtime.

Where Pretui is better: it is an actual APG treeview. Most JSON viewers are nested `<div>`s with click handlers, which means no roles, no levels, no keyboard model, and nothing a screen reader can navigate structurally. Building to the pattern gives all of that for free. The incomplete-versus-invalid distinction in the parse diagnostics is the second difference, and it is what makes the component usable in an editor.

Where it is thinner: read-only — there is no editing — no JSON Pointer or JSONPath query beyond the substring filter, no schema awareness, and no diff view.

## Accessibility

- **`role='tree'` with `role='treeitem'` rows carrying `aria-level`**, which is the pattern's core: a reader can tell depth without seeing indentation.
- **One tab stop for the whole tree**, with arrow-key navigation inside it — expand, collapse, move by sibling, move by level.
- **The tree is named**, with a sensible default so a caller who supplies nothing still gets a named region.
- **Match counts are text**, so filtering reports how much it found rather than only changing what is visible.
- **Parse problems are announced with a mark that is `aria-hidden` and text that is not**, so the condition is read rather than shown as a symbol.
- **Truncation at `@pageSize` needs to be perceivable**; a container showing 100 of 10,000 children is a partial view, and a reader who is not told is being misled about the document.

## Theming

`--pretui-json-indent` (depth step), `--pretui-json-row-height` (density), `--pretui-json-max-height` (the scroll ceiling), `--pretui-destructive-ink` (parse errors), `--pretui-shadow-hairline`, `--pretui-dur-snap` / `--pretui-ease-snap` for expansion.

Indent as a token rather than a fixed value is what lets a dense inspector and a roomy document view share one component — and because depth is also carried by `aria-level`, tightening the indent for space never costs a reader the structure.
