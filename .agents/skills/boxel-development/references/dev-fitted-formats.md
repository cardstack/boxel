# Fitted Format — Container-Query Standard

Distilled from the boxel-workspaces `container-query-fitted-layout.md`
standard (the full 1000-line guide with worked examples). Everything here
is CSS-only — no JS modifiers, no ResizeObserver.

## The contract: the parent owns the cell size

A fitted card never imposes its own size. The host wraps every fitted
template in `.field-component-card.fitted-format` with
`width: 100%; height: 100%; overflow: hidden; container-type: size;
container-name: fitted-card`.

**Query the host's `fitted-card` container. NEVER create your own
container on the root.** (An older version of this reference prescribed a
local `container-type: size` wrapper — that is WRONG and superseded: a
container cannot be styled by its own queries, so grid-template/padding
switches on your root silently stop working.)

The template root is a single `.fit` grid that fills the host wrapper:

```css
.fit {
  width: 100%; /* the ONE sanctioned sizing declaration on the root */
  height: 100%;
  display: grid;
}
@container fitted-card (max-height: 80px) {
  .fit {
    grid-template-rows: auto;
  } /* queries against the HOST container style your root fine */
}
```

Keep OFF the root: fixed/min/max dimensions, `border`, `border-radius`,
`box-shadow`, `container-type`, `container-name` — the host owns all of
them. Background/foreground pairing from the theme is fine
(`background-color: var(--card); color: var(--card-foreground)`).

## Prefer `<FittedCard>` for standard compositions

For the standard composition — image/placeholder + eyebrow + title +
subtitle + meta + footer + badges — use the `FittedCard` component from
`@cardstack/boxel-ui/components` instead of hand-rolling. It implements
this whole standard internally (host-container queries, aspect-ratio
layout switching) and exposes `--fc-*` custom properties for tuning:

```gts
import { FittedCard } from '@cardstack/boxel-ui/components';

<FittedCard @imageUrl={{@model.imageUrl}} @imageAlt={{@model.title}}>
  <:placeholder><BookOpen width='24' height='24' /></:placeholder>
  <:eyebrow>Non-fiction</:eyebrow>
  <:title><@fields.cardTitle /></:title>
  <:subtitle><@fields.cardDescription /></:subtitle>
  <:meta><span>150 mins</span></:meta>
  <:footer><span>320 pages</span><span>2024</span></:footer>
</FittedCard>
```

No-media card types: omit `@imageUrl`, `:image`, AND `:placeholder` — the
image column disappears and content switches to its no-image layout.
Tune with `--fc-*` variables and `@container fitted-card (...)` overrides
from your scoped CSS; don't fork the layout.

**Hand-roll only special templates** (a dark terminal ticker, a ticket
stub, a boarding pass with an SVG flight path) — then follow the rest of
this reference.

## Size classification — plan content per quantum BEFORE writing CSS

Height quanta (what the host uses each size for):

| Quantum | Range     | Visible regions                    | Host usage              |
| ------- | --------- | ---------------------------------- | ----------------------- |
| h40     | ≤50px     | head only                          | badges, inline mentions |
| h65     | 50–80px   | head + meta                        | chooser dropdowns       |
| h105    | 80–130px  | head + body + meta                 | strips, search results  |
| h170    | 130–200px | head + body + [tags] + meta        | tiles                   |
| h275    | 200–320px | hero + head + body + [tags] + meta | large tiles, cards      |
| h445    | >320px    | all, spacious                      | expanded cards          |

Width classes:

| Class  | Range     | Behavior                                                       |
| ------ | --------- | -------------------------------------------------------------- |
| narrow | ≤170px    | hide tags, clamp meta to 1 line, hide subhead at small heights |
| medium | 170–260px | hide tags, clamp meta to 1 line                                |
| wide   | >260px    | show tags; horizontal thumbnails at h40/h65/h105               |

Tags hide below 260px because wrapping pills consume unpredictable
height. Write the **content matrix first** — for each quantum, decide
which fields appear — then implement it as `@container fitted-card`
rules. A fitted view that only looks right at one size is a defect.

```css
@container fitted-card (max-height: 50px) {
  /* h40: head only */
}
@container fitted-card (min-height: 50.1px) and (max-height: 80px) {
  /* h65 */
}
@container fitted-card (min-height: 80.1px) and (max-height: 130px) {
  /* h105 */
}
@container fitted-card (min-height: 130.1px) and (max-height: 200px) {
  /* h170 */
}
@container fitted-card (min-height: 200.1px) {
  /* h275+: hero appears */
}
@container fitted-card (max-width: 260px) {
  .r-tags {
    display: none;
  }
}
```

## Overflow discipline (every region, no exceptions)

- Body/content rows: `minmax(0, 1fr)` — never `auto` (auto rows grow
  with content and blow the cell).
- `overflow: hidden` on every region.
- Text clamps: `display: -webkit-box; -webkit-box-orient: vertical;
-webkit-line-clamp: N; overflow: hidden`.
- `min-height: 0` on any nested flex/grid child that must shrink.

## Container-query units caveat

`cqw`/`cqh`/`cqmin` only resolve against an actual container. Inside a
fitted template they resolve against the host's `fitted-card` container —
fine. On other surfaces (isolated/embedded) they silently fall back to
the VIEWPORT unless you establish a container on that surface with
`container-type: inline-size` first.

## Parent-side note

When a parent embeds fitted children (`<@fields.x @format='fitted' />`),
the parent sizes the cell (e.g. a grid of `160px × 180px` tiles) and may
need `@displayContainer={{false}}` to suppress double chrome — see
`dev-delegated-rendering.md`.

## Media fields (cardinal rule, applies to ALL formats)

An image on a card is `@field image = linksTo(() => ImageDef)` (or
FileDef) pointing at a real realm file — write the binary into the
workspace and reference it. NEVER design a field that stores
`data:`/base64/blob strings in JSON attributes, not even "just a
placeholder" — inline media bytes in instance JSON are a hard rule
violation that corrupts diffs, bloats the index, and breaks the file's
identity. No-media-yet instances leave the link empty and the template
renders a placeholder block/icon.
