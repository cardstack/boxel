## What it is

One row of a listing: a leading slot, a title, a description, a trailing meta column and an actions column. It is the media object every kit ships, and it renders a `<div>`, never an `<li>`, so **List** owns the `<li>` and Item can also stand alone inside a card, a **Panel**, or a **DataTable**'s `<:expanded>` block.

If the row represents a record with an avatar and a name, **EntityDisplay** is the display-only pair. If it is a card in a fitted grid, **FittedCard**. If it is a pill naming a record, **RecordPill**. If it is a step in a sequence, **StepList**. Item is the general row: whatever goes at the start, a name, a line under it, something at the end.

## The contract

```
@title?, @description?      — strings; the <:title> and <:description> blocks win over them
@href?                      — makes the title a real <a>
@size?                      — xs|s|m|l|xl; sm/md/lg accepted
@alignStart?                — leading slot to the first line instead of the block centre
<:leading> <:title> <:description> <:trailing> <:actions>
<:default>                  — free body content under the title and description
```

**The title is a `<span>`, never a heading.** If this row is genuinely a heading in your document, put a real `<h3>` in `<:title>`; the component will not guess a level for you.

**`@href` makes the title a link, not the row.** A row with one obvious destination should have an anchor; a click handler on the row is not a link and does not announce as one.

**Title and description truncate to one line** with all four declarations (`min-width: 0`, `overflow`, `text-overflow`, `white-space`), because `min-width: 0` on its own hard-clips instead of ellipsising. The default block does not truncate.

**The narrow-width wrap is a container query on the nearest ancestor container.** Inside **List** that is the row, which is already one. Standalone, give the box that holds the Item `container-type: inline-size` or the trailing slot never wraps under the body.

## Prior art

**shadcn `Item`** is the newest name for this and the one an agent will type: `ItemMedia`, `ItemTitle`, `ItemDescription`, `ItemActions`, `asChild` for a link. **MUI `ListItem`** composes `ListItemAvatar`, `ListItemText` (primary/secondary) and `ListItemSecondaryAction`. **Ant `List.Item`** takes `actions` and `extra`, with `List.Item.Meta` for avatar, title and description. **React Aria `GridListItem`** is the selectable row inside a grid list.

Where this is better: **no heading hazard.** Ant's `List.Item.Meta` hard-codes an `<h4>` for every row title, so a list injects h4s into whatever outline it lands in; MUI wraps titles in `<Typography>` with no heading semantics at all, which is the opposite failure for a list of section headings. The title here is a `<span>` and the `<:title>` block is where a real heading goes. **The flex-overflow bug is closed.** Both Ant and MUI let a long title push the trailing meta off the end of the row; here the body is `min-width: 0` and the text truncates. **Actions are a flex row**, not Ant's `<ul>` of `<li>`s with `<em>` separators.

Where it is thinner: **no selection or press state of its own** — that is **List**'s job, through the row API it yields; **no `asChild`** and so no way to make the whole row the link (the title is the link); **no `extra`** distinct from `<:trailing>`; **no dense-vs-comfortable padding axis** beyond `@size`, and no divider of its own (the hairline is **List**'s `@divided`).

## Accessibility

No APG pattern: an Item is a `<div>` of text and slots and carries no role. Its accessibility is composition.

What the component does, from its rendered markup and its tests:

- **No heading is emitted** for `@title`, and no `<li>` — the row is a `<div>`.
- **`@href` renders a real `<a href>`** around the title text, with a visible focus ring.

The caller's failures to avoid, and they are most of the story: a row whose only action is a handler on the outer `<div>` is not keyboard-reachable — put a link in the title or a button in `<:actions>`; a `<:leading>` avatar with no name or `alt` announces nothing, which is fine only when the title already names the thing; controls in `<:actions>` sit inside the row and, inside **List**, after the row's own selection control in Tab order; and truncation is visual only, so a title that matters in full needs a `title` attribute or a detail view. The trailing column is `--muted-foreground` at 0.94em with tabular numerals; a value that carries meaning must not rely on that colour.

## Theming

Consumed directly: `--foreground`, `--muted-foreground`, `--ring`, `--text-ui-md`, `--text-ui-sm`, `--track-ui`, `--space-2`, `--space-3`, `--space-4`.

Its own knob: `--pretui-item-gap` (default `--space-4`) is the gap between the slots. Density is `@size` on the root `font-size`; everything inside is `em`. The title is weight 500; the description and trailing meta are 0.94em in `--muted-foreground`; the trailing column has `font-variant-numeric: tabular-nums` so a column of prices in a **List** lines up.

Fixed: the 2px gap between title and description, the one-line truncation, the 22rem wrap breakpoint.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| React | Pretui |
| --- | --- |
| `ItemMedia` / `ListItemAvatar` / `Meta.avatar` | `<:leading>` |
| `ItemTitle` / `ListItemText.primary` / `Meta.title` | `@title` or `<:title>` |
| `ItemDescription` / `ListItemText.secondary` / `Meta.description` | `@description` or `<:description>` |
| `ItemActions` / `ListItemSecondaryAction` / Ant `actions` | `<:actions>` |
| Ant `extra` | `<:trailing>` |
| `asChild` + `href` | `@href` (the title is the link) |
| `dense` | `@size='s'` |
| `alignItems='flex-start'` | `@alignStart` |
