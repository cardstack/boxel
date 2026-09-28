## Use Boxel-UI Components

**Important**: When using a boxel-ui component imported from `@cardstack/boxel-ui/components`, ALWAYS READ THE API. This will make sure you're using the correct variable names and values.

Always prefer boxel-ui components over raw HTML elements. Import from `@cardstack/boxel-ui/components`:

```gts
import {
  Button,
  CardContainer,
  FieldContainer,
  Header,
  BoxelInput,
  KanbanPlane,
  Pill,
  // ... other components as needed
} from '@cardstack/boxel-ui/components';
```

### Component Reference

**Layout & Containers:**
- `CardContainer` — wraps card content with correct border/shadow/padding. all cards are already wrapped in this.
- `FittedCard` — **the preferred starting point for `fitted` templates.** Slot-fill layout (`:placeholder`, `:badgeLeft`/`:badgeRight`, `:badgeRow`, `:eyebrow`, `:title`, `:subtitle`, `:meta`, `:footer`, `:image`, `:background`) that queries the host's `fitted-card` container internally and adapts across all 16 fitted sizes; tune via `--fc-*` custom properties. Hand-roll per `boxel/references/container-query-fitted-layout.md` only when the slot model can't express the design. Named blocks must be direct children of `<FittedCard>` — Glimmer rejects a `<:eyebrow>` wrapped in `{{#if}}`, so put the conditional inside the block (`<:eyebrow>{{#if @model.level}}<@fields.level />{{/if}}</:eyebrow>`) (an empty section collapses via the component's `:empty` rule). Leave a section out by not writing its block; `--fc-<section>-display: none` (image, subtitle, meta, footer, badge slots) hides one you do provide, typically per breakpoint.
- `GridContainer` — responsive grid layout
- `BoxelContainer` — generic container
- `ResizablePanelGroup` — resizable panel layouts
- `KanbanPlane` — lane-based drag/drop board with pointer + keyboard reordering, insertion gaps, ghost rendering, collapsed/hidden columns, and WIP limit display. Use pattern `layout-kanban-drag-drop`.

**Headers & Navigation:**
- `Header` — page/section headers
- `TabbedHeader` — headers with tabs
- `CardHeader` — card-specific header with icon, title, actions

**Inputs & Forms:**
- `BoxelInput` — most inputs
- `EmailInput` / `PhoneInput` — specialized inputs
- `BoxelSelect` / `BoxelMultiSelect` — dropdowns (single and multi-value; `BoxelMultiSelectBasic` for the unstyled multi-select)
- `RadioInput` — radio buttons
- `Switch` — toggle switch
- `FieldContainer` — wraps a label + input with consistent spacing (use `@vertical={{true}}` for vertical)
- `Label` — standalone label
- `DateRangePicker` — date range selection

**Buttons & Actions:**
- `Button` — primary action button. `@kind` for primary/secondary/muted/destructive/text-only/primary-dark **and the chromeless link kinds `link`/`link-primary`/`link-muted`** (no background, no border, no min-height — the right choice for text that should read as a link, not a control). `@size` for `auto, base, extra-small, small, tall, touch`. `@as` picks the rendered element: `'button'` (default), `'anchor'` (+ `@href`), or `'link-to'` (+ `@route`/`@models`/`@query`).
- `IconButton` — icon-only button (use `@variant` for primary/secondary/muted/destructive/text-only, `@size` for `auto, base, extra-small, small, tall, touch)
- `ContextButton` — contextual action button (`@icon` for add, edit, close, delete, context-menu, context-menu-vertical; `@variant` for highlight, highlight-icon, ghost, destructive, destructive-icon)
- `CopyButton` — copy-to-clipboard

**Feedback & Status:**
- `Alert` — informational alerts (use `@type` for warning/error)
- `LoadingIndicator` — loading spinner
- `CircleSpinner` — compact spinner
- `ProgressBar` — linear progress
- `ProgressRadial` — circular progress
- `SkeletonPlaceholder` — loading skeleton
- `Tooltip` — hover tooltips

**Display & Data:**
- `Accordion` — collapsible sections
- `Pill` — inline status/badge (`@variant` for primary, secondary, accent, muted, destructive; use `@kind='button'` to make it a button)
- `Swatch` — color swatch display
- `Avatar` — user/entity avatar
- `EntityDisplayWithIcon` / `EntityDisplayWithThumbnail` — entity visuals
- `RealmIcon` — realm icon display
- `FilterList` — filterable list
- `SortDropdown` — sort controls
- `ViewSelector` — view mode toggle
- `Menu` — dropdown menu
- `Modal` — overlay dialogs
- `BoxelDropdown` — dropdown container
- `Message` — chat/message bubbles
- `ColorPalette` / `ColorPicker` — color selection
- `KanbanPlane` — preferred drag-and-drop interface for boards. Do not hand-roll pointer drag in card templates unless no boxel-ui component exists for the interaction.

### Don't neutralize a component — pick the variant

If styling a boxel-ui component requires cancelling its own defaults, you picked the wrong component or the wrong variant. The tell is a `<style scoped>` block that zeroes out what the component brought:

**Wrong** — `Pill` stripped down to plain text, then re-styled from scratch:
```gts
<Pill class='meta-link' @tag={{if @model.url.length 'a'}} href={{@model.url}}>
  <:default><@fields.label /></:default>
</Pill>
<style scoped>
  .meta-link {
    padding: 0;          /* fighting the component */
    background: none;    /* fighting the component */
    border: none;        /* fighting the component */
    color: var(--boxel-500);
    font-size: 0.75rem;
  }
</style>
```

**Right** — a variant that already has no chrome, leaving only genuinely bespoke declarations:
```gts
<Button class='meta-link' @as='anchor' @kind='link-muted' @size='extra-small' @href={{@model.url}}>
  <@fields.label />
</Button>
<style scoped>
  .meta-link {
    font-family: var(--font-mono);
    text-transform: uppercase;   /* nothing the component already provides */
  }
</style>
```

Each cancelling declaration is invisible coupling to the component's current internals: it rots silently when the component changes, and it hides the fact that a purpose-built variant exists. Read the component's API first (see the top of this file) and look through `@kind` / `@variant` / `@size` before writing a single override.

**Component args are not portable between components.** `@as` and `@href` are `Button`'s args. `Pill` has no `@as` — it takes `@tag` (a raw HTML tag name) and receives `href` as a plain attribute through `...attributes`. Never carry one component's arg names to another; check the signature.

### Drag/drop quality bar

For kanban/status/deal/task boards:

- Use `KanbanPlane` from `@cardstack/boxel-ui/components`.
- Persist placements by stable card id + column key + sort order, not by array index.
- Render child cards via `@fields` at fitted format so navigation, permissions, and field chrome remain intact.
- Include empty states, column counts, hidden/collapsed-column behavior, and WIP limits when the domain has limits.
- If changing the reusable component, require pure engine tests and live component tests.

### When a component is missing from boxel-ui

If no existing component satisfies your need, write a self-contained Glimmer component in the same file (or a co-located file) that is structured so it could be contributed to the boxel-ui library later:

- Give it a clear, generic name (e.g. `StatusBadge`, `SectionHeader`, `AvatarGroup`)
- Declare a typed `interface Signature` block
- Use only design tokens — no hardcoded colors
- Use `<style scoped>` so styles do not leak
- Keep component arguments minimal and semantic

Add a TODO comment noting it should be moved to `@cardstack/boxel-ui/components` when it matures.
