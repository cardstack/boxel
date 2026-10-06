## What it is

A selectable, keyboard-navigable, load-aware row collection: `<ul>`/`<li>` semantics, one tab stop with arrows within, the same `DataSource` selection model **DataTable** uses, and the same loading, empty and error chrome. It is what a **DataTable** becomes when the pane is too narrow for columns — the same rows, one **Item** per `<li>`.

The kit has other things that draw rows, and none of them is this. **Feed** is `role='feed'`: a stream of independently authored articles with PageUp/PageDown paging and no selection. **Grid** wraps boxel-ui's tile container, a layout with no keyboard model. **DataGrid** is a table. **Masonry** is a column-major wall. **Item** is the row atom this component puts inside each `<li>`; it also stands alone.

## The contract

```
@items? | @options? | @dataSource?     — the collection (any spelling); OR
@load?, @loadKey?                       — an async loader, re-run when the key changes
@key?                                   — (row, index) => RowKey
@label?                                 — the list's accessible name (default 'List')
@size?                                  — xs|s|m|l|xl; sm/md/lg accepted
@selectionMode?                         — none|single|multi
@selected?, @defaultSelected?, @onSelectionChange?
@onActivate?                            — (row, index): Enter on the focused row
@rowLabel?                              — (row, index) => the row's accessible name
@divided? (default true), @bordered?
@busy? | @loading?                      — aria-busy without replacing the rows
@itemNoun?, @emptyTitle?, @emptyMessage?, @loadingLabel?, @skeletonRows?
<:item as |row index api|>              — api is { index, selected, active, toggle }
<:header> <:footer>                     — inside the frame
<:empty> <:loading> <:error>            — replace DataShell's defaults
```

**Selection is controlled or uncontrolled by the same rule as DataTable:** pass `@selected` and the component stops keeping its own copy; leave it out and it keeps state and still calls `@onSelectionChange`. In `multi` mode the control is a checkbox; in `single` it is a radio, and every radio shares one `name` so the browser enforces the single choice.

**Keys are handled only when the row itself has focus.** ArrowDown/ArrowUp move the cursor, Home/End jump to the ends, Space toggles selection, Enter calls `@onActivate`. A caret in a text field inside a row still gets Home/End and Space types a space, because the handler checks that the event target is the `<li>`.

**`@onActivate` is not a link.** A row with one obvious destination should carry a real `<a>` inside `<:item>` (**Item** has an `href` arg for exactly this); the activate callback is for rows whose action is not navigation.

**`@rowLabel` defaults to "Row N".** That is honest and poor. Pass it: it names the selection control and there is nothing else to name it.

## Prior art

**Ant `List`** takes `dataSource`, `renderItem`, `loadMore`, `pagination`, `bordered`, `split` and `size`, and pairs with `List.Item` and `List.Item.Meta`. **MUI `List`** is `List` + `ListItem` + `ListItemButton` + `ListItemText`, with no data contract. **Mantine `List`** is typographic. **React Aria `GridList`** is the accessibility reference for a selectable list and takes on `role='grid'` with row-level focus. **shadcn** has no list; its `Item` is the row atom.

Where this is better: **one tab stop and a roving cursor**, which none of Ant, MUI or Mantine provide — their lists are either static or a Tab per row. **Selection state lives on a real control with a real name**, not on the row's class. **Load, empty and error states are built in** through **DataShell**, with `@busy` keeping the rows in place rather than swapping them for a spinner. **The `<:item>` block yields a row API**, so a row can render its own selected or active treatment without re-deriving it.

Where it is thinner: **no `role='grid'` and no arrow-key travel into a row's controls** — React Aria's `GridList` does both; here the row is the focus stop and its contents are reached by Tab. **No `loadMore` and no built-in paging** (Ant has both; the kit's answer is **InfiniteScroll**, a stub, or paging in the caller). **No drag-reorder** (**Reorder** is the kit's). **No `itemLayout='vertical'`**; the row's shape is **Item**'s.

Ant's `List.Item.Meta` hard-codes an `<h4>` for every row title. The row here is **Item**, which emits a `<span>` and leaves headings to the caller.

## Accessibility

Governing pattern: a native list. `role='listbox'` is deliberately not claimed, and the test file asserts the `<ul>` carries no role: an option's children are presentational, so a row holding a link, a button or a named avatar would lose all of it, and the realm's `require-presentational-children` lint reports exactly that in the caller's file. A list of rich rows is a list.

What the component does, from its rendered markup and its tests:

- **The `<ul>` is named** from `@label`.
- **Exactly one `<li>` is in the tab sequence** (`tabindex='0'`, the rest `-1`), and the stop roves with ArrowDown, ArrowUp, Home and End. Focus arriving by click or by Tab from outside is followed rather than stolen.
- **Selection is a real `<input type='checkbox'>` or `<input type='radio'>`** with an `aria-label` from `@rowLabel`; radios share one `name`. Space on the focused row toggles it, and the row carries `data-selected` for CSS.
- **Enter on the focused row calls `@onActivate`** and does not select.
- **An empty collection renders the EmptyState**, not an empty `<ul>`.
- **`@busy` sets `aria-busy`** on the root and dims it without unmounting the rows.

The caller's failures to avoid: a row whose only action is a click handler on the `<li>` is not reachable as a link and does not announce as one — put an `<a>` in the row; a row with no `@rowLabel` has selection controls named "Row 1", "Row 2"; and selection is shown by a background tint plus a rule down the inline start, so a season that removes the rule leaves colour as the only signal.

## Theming

Consumed directly: `--foreground`, `--muted-foreground`, `--card`, `--border`, `--primary`, `--primary-foreground`, `--ring`, `--radius-surface`, `--hover`, `--input`, `--field`, `--text-ui-md`, `--text-ui-sm`, `--track-ui`, `--space-3`, `--space-4`, `--pretui-shadow-hairline`, `--pretui-control-rest`, `--pretui-control-border`, `--pretui-edge-highlight`, `--pretui-selected`.

The selection control is drawn by the same declarations **DataTable** uses (15px, 5px radius, `--primary` fill with a `--primary-foreground` check), so a season that retunes `--pretui-control-rest` and `--pretui-control-border` retunes both listings' checkboxes together. Density is one axis through `@size` on the root `font-size`. Coarse pointers get a 44px row floor and 20px controls without changing the fine-pointer rhythm.

Each `<li>` is `container-type: inline-size`, which is what lets an **Item** inside it wrap its trailing meta under the body at 22rem.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| React | Pretui |
| --- | --- |
| `dataSource` / `items` / `options` | `@items` (all three spellings land) |
| `renderItem` | `<:item as \|row index api\|>` |
| `loadMore` | not built; see **InfiniteScroll** |
| `bordered` / `split` | `@bordered` / `@divided` |
| `size` | `@size` |
| `selectionMode` / `selectedKeys` (React Aria) | `@selectionMode` / `@selected` |
| `onAction` (React Aria) | `@onActivate` |
| `isPending` (React Aria) | `@busy` |
