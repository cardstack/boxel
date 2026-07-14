## Use Boxel-UI Components

**Important**: When using a boxel-ui component imported from `@cardstack/boxel-ui/components`, ALWAYS READ THE API. This will make sure you're using the correct variable names and values.

Always prefer boxel-ui components over raw HTML elements. Import from `@cardstack/boxel-ui/components`:

```gts
import {
  Button,
  CardContainer,
  FieldContainer,
  Header,
  Input,
  KanbanPlane,
  Pill,
  // ... other components as needed
} from '@cardstack/boxel-ui/components';
```

### Component Reference

**Layout & Containers:**
- `CardContainer` — wraps card content with correct border/shadow/padding. all cards are already wrapped in this.
- `GridContainer` — responsive grid layout
- `Container` — generic container
- `ResizablePanelGroup` — resizable panel layouts
- `KanbanPlane` — lane-based drag/drop board with pointer + keyboard reordering, insertion gaps, ghost rendering, collapsed/hidden columns, and WIP limit display. Use pattern `layout-kanban-drag-drop`.

**Headers & Navigation:**
- `Header` — page/section headers
- `TabbedHeader` — headers with tabs
- `CardHeader` — card-specific header with icon, title, actions

**Inputs & Forms:**
- `Input` — most inputs
- `EmailInput` / `PhoneInput` — specialized inputs
- `Select` / `MultiSelect` — dropdowns
- `RadioInput` — radio buttons
- `Switch` — toggle switch
- `FieldContainer` — wraps a label + input with consistent spacing (use `@vertical={{true}}` for vertical)
- `Label` — standalone label
- `DateRangePicker` — date range selection

**Buttons & Actions:**
- `Button` — primary action button (use `@kind` for primary/secondary/muted/destructive/text-only; use `@size` for `auto, base, extra-small, small, tall, touch)
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
- `EntityIconDisplay` / `EntityThumbnailDisplay` — entity visuals
- `RealmIcon` — realm icon display
- `FilterList` — filterable list
- `SortDropdown` — sort controls
- `ViewSelector` — view mode toggle
- `Menu` — dropdown menu
- `Modal` — overlay dialogs
- `Dropdown` — dropdown container
- `Message` — chat/message bubbles
- `ColorPalette` / `ColorPicker` — color selection
- `KanbanPlane` — preferred drag-and-drop interface for boards. Do not hand-roll pointer drag in card templates unless no boxel-ui component exists for the interaction.

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
