## What it is

An editable JSON document: **JsonTree**'s treegrid with editing, undo, and a strict rule about what reaches the caller.

## The contract

```
@json?   — starting document as text. Parsed once; the editor owns it afterwards
@value?  — starting document as a plain JavaScript value
@label?  — accessible name for the grid
@expandAll?, @query?, @pageSize? — as JsonTree
@indent? — spaces per indent level in the emitted text. Default 2; 0 is compact
@historyLimit? — undo depth. Default 200
@readonly? — nothing can be edited; the grid still navigates and copies
@onChange? — fires after every committed edit, ALWAYS with a valid document
@onIssue?  — fires when an edit is rejected or degraded

<:empty>
```

**`@onChange` always carries a valid document** — the serialised text _and_ the plain value — and never fires for a pending or rejected edit. That is the contract's centre: **a caller can persist the payload unconditionally**, with no "is this parseable yet" check at the boundary.

**Invalid state is surfaced, never resolved by coercing the data.** An unreadable number, a duplicate property name, a lossy type change all go to `@onIssue` for the caller to render. The editor does not quietly make the document valid, because the quiet fix is how a value silently changes meaning.

**The document is owned after parsing.** `@json` and `@value` are starting points; later changes to them do not push into a live editor.

**`@readonly` keeps navigation and copying.** A read-only JSON view is still a view you want to move around in.

## Prior art

Built on the kit's own **JsonTree**, which is itself modelled on JsonTree.js as a specification.

Where Pretui is better: the valid-only change channel. Most JSON editors are a text area with syntax highlighting, which means every keystroke is a potentially invalid document and the caller owns the parsing. A structured editor that only emits valid documents moves that problem out of every consumer.

Where it is thinner: no schema validation, no JSON Pointer navigation, no diff or merge, and no text mode — this is structural editing only, so a reader who wants to paste a document wholesale has to go through `@json` at mount.

## Accessibility

- **Everything JsonTree provides**: `role='treegrid'`, `aria-level` per row, one tab stop with arrow navigation.
- **Treegrid is the right pattern precisely because rows have controls.** An editable JSON tree where the edit affordance is unreachable by keyboard would be a read-only editor for a lot of people.
- **Rejected edits are reported rather than silently reverted**, which is the difference between "that did not work" and nothing happening.
- **Undo is bounded at `@historyLimit`** and is the recovery path for an edit that was accepted but wrong.
- **`@pageSize` truncation applies here too**, and an editor showing 100 of 10,000 children is editing a partial view — a reader who is not told is being misled.

## Theming

Inherited from **JsonTree** — `--pretui-json-indent`, `--pretui-json-row-height`, `--pretui-json-max-height`, `--pretui-destructive-ink` for rejected edits.

`@indent` here is a different thing from the tree's indent token: it is spaces in the _emitted text_, not pixels on screen. Both exist because one is a serialisation choice and the other is a display one.
