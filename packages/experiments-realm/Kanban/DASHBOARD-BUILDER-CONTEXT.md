# Dashboard Builder — Context & Handoff Document

> **Purpose:** Give the next assistant everything it needs to build a CSS Grid dashboard builder that reuses the existing Surface/frame infrastructure from the infinite canvas.

---

## What We're Building

A **dashboard layout builder** that lets users:

1. **Prototype on a 2D canvas** — drag cards around freely on the infinite canvas (existing behavior)
2. **Switch to grid mode** — snap the free-form layout into a CSS Grid dashboard
3. **AI-assisted conversion** — an AI looks at the 2D arrangement and proposes a CSS Grid layout

The dashboard builder lives on a **separate realm** from the canvas (helpful-slug). It imports and reuses the Surface engine components.

---

## Existing Codebase: What You Can Reuse

### Surface Engine (4 files in `Surface/`)

These are the reusable building blocks. They are **realm-local** right now but can be imported cross-realm.

| File | What It Does | Key Exports |
|------|-------------|-------------|
| `Surface/rig.gts` | Camera engine — pan, zoom, momentum physics | `RigState` (tracked state: worldX, worldY, magnify), `SurfaceRig` (event handlers, momentum), `MIN_ZOOM`, `MAX_ZOOM` |
| `Surface/plane.gts` | Viewport component — renders the pannable/zoomable area with grid dots, HUD, help panel | `Plane` component (yields `:canvas` and `:hud` blocks) |
| `Surface/frames.gts` | Frame interaction manager — drag, resize, snap guides, multi-select, marquee, layer ordering, culling | `FrameManager` class, `TileRect`, `TileOverride`, `RESIZE_HANDLES` |
| `Surface/card-format.gts` | Format configs — min/max sizes, overflow, interactivity per format | `CARD_FORMATS`, `FormatFrameConfig`, `getFrameConfig()`, `withViewTransition()` |
| `Surface/split-panel.gts` | Left/right split layout with draggable divider | `SplitPanel` component |

### How the Pieces Connect

```
InfiniteCanvasCard (or DashboardCard)
  └─ SplitPanel
       ├─ :main → Plane (viewport)
       │    └─ :canvas → positioned card frames
       │         └─ FrameManager handles interaction
       └─ :panel → sidebar (settings, properties)
```

**Data flow:**
- `RigState` holds camera position (worldX, worldY, magnify)
- `SurfaceRig` translates pointer/wheel events into RigState mutations
- `Plane` renders the viewport with `transform: scale(magnify) translate(worldX, worldY)`
- `FrameManager` tracks frame positions (`TileRect[]`), handles drag/resize/snap
- The host card (InfiniteCanvas, Screenshot, etc.) owns the card data and format state

### Coordinate System

```
Client (screen px) → World (canvas px)
  x_world = (x_client - viewport.left) / magnify - worldX
  y_world = (y_client - viewport.top)  / magnify - worldY
```

Zoom range: 0.2 – 5.0. Grid dots at 24px spacing.

### Frame Interaction Model

| Action | How |
|--------|-----|
| **Move** | pointerdown on frame → drag → snap guides appear → pointerup commits |
| **Resize** | pointerdown on handle → drag → respects format min/max → commits |
| **Select** | Click = single select. Shift+click = toggle multi-select |
| **Marquee** | Click+drag on background = box selection |
| **Pan** | Middle-click, Space+drag, or Shift+click on background |
| **Zoom** | Ctrl/Cmd+scroll. Anchors to mouse position |
| **Snap** | 8px threshold for axis alignment. Gap-matching between frames |
| **Layer** | `bringToFront()`, `sendToBack()`, `moveUp()`, `moveDown()` |

### Card Formats

| Format | Height | Overflow | Interactive | Use Case |
|--------|--------|----------|-------------|----------|
| `fitted` | Fixed (40–600px) | hidden | No (snapshot) | Dashboard tiles |
| `embedded` | Auto (content) | visible | No (preview) | Expanding cards |
| `isolated` | Fixed or auto | scroll/visible | Yes (full card) | Editing, detail view |

**For the dashboard builder, `fitted` is the primary format** — dashboard tiles are snapshot-like cards at fixed sizes.

### Persistence Pattern

Frame state is stored as a `containsMany(FrameSettingsField)` array on the card:

```typescript
export class FrameSettingsField extends FieldDef {
  @field frameIndex = contains(NumberField);
  @field sourceIndex = contains(NumberField);  // for duplicates
  @field x = contains(NumberField);
  @field y = contains(NumberField);
  @field width = contains(NumberField);
  @field height = contains(NumberField);
  @field format = contains(StringField);       // fitted | embedded | isolated
  @field isolatedMode = contains(StringField);
  @field isolatedZoom = contains(NumberField);
  @field zOrder = contains(NumberField);
  @field hidden = contains(StringField);       // "true" if hidden
}
```

Saved via debounced (2s) mutation of the FieldDef instances, which triggers Boxel auto-save.

### Default Layout (4-column grid)

```typescript
const BASE_TILE_WIDTH = 280;
const BASE_TILE_HEIGHT = 364;
const TILE_STEP_X = 312;  // 280 + 32 gap
const TILE_STEP_Y = 404;  // 364 + 40 gap

defaultTileRect(index) {
  let column = index % 4;
  let row = Math.floor(index / 4);
  return { x: 120 + column * TILE_STEP_X, y: 120 + row * TILE_STEP_Y,
           width: BASE_TILE_WIDTH, height: BASE_TILE_HEIGHT, zIndex: 1 };
}
```

---

## The Dashboard Builder: Design

### Two Modes

1. **Canvas Mode** (existing) — free-form 2D surface. Users drag cards anywhere, resize freely. This is the "whiteboard" for prototyping layouts.

2. **Grid Mode** (new) — CSS Grid dashboard. Cards snap into grid cells. The grid is explicit: rows and columns with configurable sizes. Cards can span multiple cells.

### CSS Grid Model

The dashboard grid should be a real CSS Grid on a container element:

```css
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(var(--cols, 4), 1fr);
  grid-template-rows: repeat(var(--rows, 3), minmax(200px, 1fr));
  gap: var(--grid-gap, 16px);
  padding: var(--grid-padding, 24px);
}
```

Each card occupies a grid area:

```css
.dashboard-cell {
  grid-column: span var(--col-span, 1);
  grid-row: span var(--row-span, 1);
}
```

### GridPlacement Field (New)

Extends FrameSettingsField with grid-specific data:

```typescript
export class GridPlacementField extends FieldDef {
  @field frameIndex = contains(NumberField);
  @field sourceIndex = contains(NumberField);
  // Canvas mode (free-form)
  @field canvasX = contains(NumberField);
  @field canvasY = contains(NumberField);
  @field canvasWidth = contains(NumberField);
  @field canvasHeight = contains(NumberField);
  // Grid mode
  @field gridColumn = contains(NumberField);     // 1-based start column
  @field gridRow = contains(NumberField);        // 1-based start row
  @field colSpan = contains(NumberField);        // columns to span (default 1)
  @field rowSpan = contains(NumberField);        // rows to span (default 1)
  // Shared
  @field format = contains(StringField);
  @field zOrder = contains(NumberField);
  @field hidden = contains(StringField);
}
```

### Grid Settings Field (New)

```typescript
export class DashboardGridSettings extends FieldDef {
  @field columns = contains(NumberField);      // e.g., 4
  @field rows = contains(NumberField);         // e.g., 3
  @field gapPx = contains(NumberField);        // e.g., 16
  @field paddingPx = contains(NumberField);    // e.g., 24
  @field rowHeight = contains(StringField);    // e.g., "200px" or "1fr" or "minmax(200px, 1fr)"
  @field columnSizing = contains(StringField); // e.g., "1fr" or "300px 1fr 1fr 300px"
}
```

### Canvas → Grid Conversion (AI-Assisted)

The conversion algorithm analyzes the free-form 2D positions and maps them to grid cells:

1. **Quantize positions** — find natural rows/columns from the card positions
2. **Determine spans** — cards wider/taller than one cell span multiple
3. **Resolve overlaps** — if two cards claim the same cell, use z-order priority
4. **Propose layout** — return a `GridPlacement[]` array

The AI can also look at the card types and content to make smart layout decisions (e.g., a chart card should be wider, a KPI card should be smaller).

### Interaction in Grid Mode

| Action | Behavior |
|--------|----------|
| **Drag** | Swap grid positions (or move to empty cell) |
| **Resize** | Change col-span / row-span (snap to grid lines) |
| **Add column/row** | Button in grid settings panel |
| **Remove column/row** | Collapse cards, warn about overflow |
| **Toggle mode** | Canvas ↔ Grid preserves both sets of coordinates |

### Rendering in Grid Mode

```handlebars
<div class="dashboard-grid" style={{this.gridStyle}}>
  {{#each this.gridPlacements as |placement|}}
    <div class="dashboard-cell" style={{this.cellStyle placement}}>
      {{#let (get @fields.sampleCards placement.sourceIndex) as |CardField|}}
        <CardField @format={{placement.format}} />
      {{/let}}
    </div>
  {{/each}}
</div>
```

The grid mode does NOT use the Plane/FrameManager — it's a separate rendering path. But the card data (`sampleCards` via `linksToMany`) is shared.

---

## File Structure for the New Realm

```
dashboard-realm/
├── .realm.json
├── index.json
├── dashboard-builder.gts           # Main card definition
├── dashboard-grid-settings.gts     # Grid config FieldDef
├── grid-placement.gts              # Per-card grid placement FieldDef
├── grid-engine.ts                  # Pure functions: quantize, convert, resolve overlaps
├── grid-interaction.ts             # Grid-mode drag/resize/swap handler
├── Surface/                        # COPIED or imported from helpful-slug
│   ├── rig.gts
│   ├── plane.gts
│   ├── frames.gts
│   ├── card-format.gts
│   └── split-panel.gts
├── Dashboard/                      # Instances
│   └── *.json
└── Theme/                          # If using themes
    └── *.json
```

---

## Key Patterns to Follow

### 1. CardDef / FieldDef Patterns

```typescript
// Card definition
export class DashboardCard extends CardDef {
  static displayName = 'Dashboard';
  @field title = contains(StringField);
  @field sampleCards = linksToMany(CardDef);
  @field gridSettings = contains(DashboardGridSettings);
  @field placements = containsMany(GridPlacementField);
  @field mode = contains(StringField);  // 'canvas' | 'grid'

  // Computed title
  @field cardTitle = contains(StringField, {
    computeVia: function (this: DashboardCard) {
      return this.title ?? 'Untitled Dashboard';
    },
  });

  static isolated = class Isolated extends Component<typeof DashboardCard> { ... };
  static fitted = class Fitted extends Component<typeof DashboardCard> { ... };
}
```

### 2. Imports (Boxel Card API)

```typescript
import { CardDef, FieldDef, Component, field, contains, containsMany, linksToMany } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import NumberField from 'https://cardstack.com/base/number';
import BooleanField from 'https://cardstack.com/base/boolean';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn, get } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';
```

### 3. Template Syntax (GTS / Glimmer)

- `{{#each array as |item|}}` for loops
- `{{#if condition}}` for conditionals
- `{{on 'event' handler}}` for events
- `{{fn method arg}}` for partial application
- `{{get object key}}` for dynamic property access
- `<:blockName>` for named blocks / yield slots
- `<style scoped>` for component-scoped CSS

### 4. Boxel UI Components Available

```typescript
import { BoxelButton } from '@cardstack/boxel-ui/components';
import { IconPlus, IconTrash } from '@cardstack/boxel-ui/icons';
```

### 5. State Management

- Use `@tracked` properties on Component classes
- Mutations to FieldDef instances trigger Boxel auto-save
- Debounce saves (2s) to avoid excessive writes
- Use `withViewTransition()` for smooth visual mode switches

---

## What the AI Conversion Needs

When converting canvas → grid, the AI receives:

```json
{
  "canvasTiles": [
    { "index": 0, "cardType": "StockTickerCard", "x": 120, "y": 120, "width": 280, "height": 364 },
    { "index": 1, "cardType": "NewsCard", "x": 432, "y": 120, "width": 592, "height": 364 },
    { "index": 2, "cardType": "HotelRoomCard", "x": 120, "y": 524, "width": 280, "height": 200 }
  ],
  "canvasWidth": 1200,
  "canvasHeight": 800
}
```

And returns:

```json
{
  "gridSettings": { "columns": 4, "rows": 3, "gapPx": 16 },
  "placements": [
    { "index": 0, "gridColumn": 1, "gridRow": 1, "colSpan": 1, "rowSpan": 1 },
    { "index": 1, "gridColumn": 2, "gridRow": 1, "colSpan": 2, "rowSpan": 1 },
    { "index": 2, "gridColumn": 1, "gridRow": 2, "colSpan": 1, "rowSpan": 1 }
  ]
}
```

---

## Critical Rules

1. **Always write source code** — never write compiled JSON blocks or base64 CSS
2. **`contains` for value types, `linksTo`/`linksToMany` for card references** — this is the cardinal rule
3. **Touch instances after uploading .gts** — `boxel touch . CardType/instance.json` forces re-indexing
4. **Scoped styles** — always use `<style scoped>` in templates
5. **No bare `this.args.model.field` in templates** — use `@model.field` or `@fields.field`
6. **Read the boxel-development skill** — run `Read .claude/commands/boxel-development.md` for the full pattern guide

---

## Open Questions for the Builder

- [ ] Should grid mode support named grid areas (e.g., `grid-template-areas: "header header" "sidebar main"`)?
- [ ] Should the grid be editable in the fitted format (mini dashboard preview)?
- [ ] How should the grid respond to viewport resizing? (Fixed columns vs responsive breakpoints)
- [ ] Should users be able to define multiple grid layouts (e.g., desktop vs mobile)?
- [ ] Should the AI conversion be a Boxel Command or inline in the card?
