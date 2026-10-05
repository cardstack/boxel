## What it is

**EmptyState** under the name shadcn and Ant use. The export is the same class — `import { Empty } from './empty';` resolves to EmptyState — so the tile exists for a port of a shadcn `Empty` block or an agent whose first guess is the shorter word. The contract and the depth are on **EmptyState**; this page maps the shadcn parts onto it. A page-level 404 or success scene is **Result**; a missing linked card is **BrokenLink**; a region that is _loading_ is **Skeleton**, not empty.

## The contract

```
@title           — required; the absence is always named
@message?        — the explanation, kept to a 34ch measure
@texture?        — the tinted radial behind the title (default true)
@separator?      — the word between two actions (default 'or')
@size?           — 's' for the compact well inside a card section, 'm' (default) for a page section
<:default>       — the message with markup in it; wins over @message
<:action>  <:altAction>
```

**`@title` is required.** shadcn lets `EmptyTitle` be omitted; here an empty state that does not say what is missing is not accepted.

## Prior art

**shadcn `Empty`** is a composition of parts — `Empty`, `EmptyHeader`, `EmptyMedia` (with an `icon` variant), `EmptyTitle`, `EmptyDescription`, `EmptyContent` — styled as a dashed, centred well. **Ant `Empty`** takes `image` (with two built-in illustrations), `description` and children for the action.

Where this is better: nothing to compose for the common case, a required title, and a generated texture in place of stock illustration so the state reads as designed with zero assets. The `<:altAction>` block gives the second honest path equal billing, which neither kit models.

Where it is thinner: there is no media slot, so shadcn's `EmptyMedia` and Ant's `image` have nowhere to land. There are two sizes, the compact well (`@size='s'`) and the page-section default.

## Accessibility

EmptyState's. No APG pattern governs it. The title is a `<div>` styled as a heading, not an `<h*>`, so it does not structure the region; nothing announces the transition to empty, so a filter that clears a table does so silently — a `role='status'` on the caller's container is the fix. The action is an ordinary tab stop, which is right. If the state replaces a `<tbody>`, the table's semantics go with it; render inside the table instead.

## Theming

EmptyState's tokens: `--canvas` (the recess, deliberately not `--card`), `--primary` (the texture tint), `--font-serif` and `--text-heading` (title), `--muted-foreground` and `--text-ui-md` (message), `--radius-surface`, `--space-2`, `--space-3`, `--space-6`, `--space-9` (at `@size='s'` the padding is a fixed `1rem` and the title reads `--boxel-font-size`). A season must define `--font-serif` and keep `--canvas` distinguishable from `--card`. Nothing is themed under an Empty name.

## React ecosystem

| shadcn / Ant                             | Pretui                                                |
| ---------------------------------------- | ----------------------------------------------------- |
| `<EmptyTitle>`                           | `@title`                                              |
| `<EmptyDescription>` / Ant `description` | `@message`, or `<:default>` when it carries markup    |
| `<EmptyContent>` / Ant children          | `<:action>`, and `<:altAction>` for the second path   |
| `<EmptyMedia>` / Ant `image`             | no equivalent; the texture stands in for art          |
| `<EmptyHeader>`                          | no equivalent; title and message are laid out for you |
