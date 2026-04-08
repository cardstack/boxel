# Runtime Architecture

The Boxel runtime is the engine that loads, compiles, renders, and manages cards. It spans both the browser (Host App) and server (Realm Server), with shared logic in `runtime-common`.

## Runtime Common

The `runtime-common` package contains the shared core that runs on both client and server:

```
runtime-common/
├── card-api.gts           # Core card/field system (re-exports from base)
├── loader.ts              # Module loading and resolution
├── module-syntax.ts       # AST analysis for .gts files
├── index-query-engine.ts  # Query execution
├── query.ts               # Query DSL definition
├── commands.ts            # Command framework
├── expression.ts          # SQL expression builder
├── search-index.ts        # Search index interface
├── card-ref.ts            # Card reference utilities
├── code-ref.ts            # Code reference utilities
└── ...                    # 150+ shared modules
```

## The Loader

The **Loader** is the module resolution system that loads card definitions at runtime.

### Module States

```
fetching → registered → registered-completing-deps →
  registered-with-deps → preparing → evaluated
```

Each module goes through this state machine. Circular dependencies are detected and handled.

### How It Works

```typescript
// Import a card definition module
const module = await loader.import('https://my-realm.boxel.ai/blog-post');

// The loader:
// 1. Fetches the .gts file from the realm
// 2. Transpiles it (GTS → JS via Babel)
// 3. Resolves all imports recursively
// 4. Evaluates the module
// 5. Returns the exports
```

### Module Resolution

The loader supports multiple resolution strategies:

1. **URL-based**: `https://cardstack.com/base/string` → fetches from base realm
2. **Relative**: `./blog-post` → resolves relative to current module
3. **Package prefix**: `@cardstack/boxel-ui/...` → maps to registered package

### Middleware Stack

The loader uses a middleware stack for fetch operations:

```
Auth Middleware → Scoped CSS Middleware → Error Middleware → Network Fetch
```

Each middleware can intercept, modify, or cache requests.

## Card Compilation

### GTS to JavaScript

`.gts` files (Glimmer Template Syntax) are compiled through Babel:

```typescript
// Input: card.gts
export class MyCard extends CardDef {
  static isolated = class extends Component<typeof MyCard> {
    <template>
      <h1>{{@model.title}}</h1>
    </template>
  };
}
```

```javascript
// Output: compiled JavaScript
import { precompileTemplate } from '@ember/template-compilation';

export class MyCard extends CardDef {
  static isolated = class extends Component {
    // Template compiled to Glimmer bytecode
  };
}
```

### Babel Transforms

Key transformations applied during compilation:

| Transform | Purpose |
|-----------|---------|
| GTS → JS | Convert template tags to Glimmer bytecode |
| AMD conversion | Convert ESM to AMD for Ember's loader |
| Scoped CSS | Process `<style scoped>` into scoped stylesheets |
| Field decorators | Process `@field` decorators |

## Rendering Pipeline

### Browser Rendering

```
Card Instance (JSON)
      ↓
Loader imports card class
      ↓
Create card instance (deserialize)
      ↓
Determine format (isolated/embedded/...)
      ↓
Get template component for format
      ↓
Glimmer renders component with:
  - @model: the card instance
  - @fields: field rendering helpers
      ↓
Scoped CSS applied
      ↓
DOM updated
```

### Server-Side Prerendering

```
Card Instance (JSON)
      ↓
Puppeteer loads card URL
      ↓
Host App renders in headless Chrome
      ↓
HTML extracted for each format
      ↓
Stored in boxel_index
      ↓
Served via Content Negotiation
```

## Store Service

The **Store** is the client-side data management layer:

```typescript
class StoreService {
  // Load a card by URL
  async get(url: string): Promise<CardDef>

  // Save a card (create or update)
  async save(card: CardDef): Promise<void>

  // Patch specific fields
  async patch(card: CardDef, fields: Partial<...>): Promise<void>

  // Delete a card
  async delete(url: string): Promise<void>

  // Search for cards
  async search(query: Query): Promise<CardDef[]>
}
```

### Card Lifecycle in the Store

```
get(url) → Check cache → Fetch from realm → Deserialize → Cache → Return
    ↓
save(card) → Serialize → PUT to realm → Update cache → Notify subscribers
    ↓
delete(url) → DELETE to realm → Remove from cache → Notify subscribers
```

### Garbage Collection

The Store implements reference-based garbage collection:

- Cards are tracked by reference count
- When all UI components release a card, it's eligible for GC
- GC runs periodically to free memory
- Prevents memory leaks in long-running sessions

## Reactivity System

Boxel uses Glimmer's **autotracking** for reactive updates:

```typescript
// TrackedWeakMap stores field values
const cardTracking = new TrackedWeakMap<BaseDef, Map<string, unknown>>();

// When a field is set:
cardTracking.set(card, { ...existing, [fieldName]: newValue });
// → Glimmer detects the change
// → Components using this field re-render
```

### How It Works

1. **Read**: Accessing `card.firstName` installs a tracking tag
2. **Write**: Setting `card.firstName` dirties the tag
3. **Invalidate**: Glimmer detects dirty tags during the render cycle
4. **Re-render**: Only affected components update

This is **pull-based reactivity** — components pull values, and the system only recomputes what's needed.

## WatchedArray

For `containsMany` and `linksToMany` fields, Boxel uses `WatchedArray`:

```typescript
class WatchedArray<T> extends Array<T> {
  // All mutating methods (push, splice, etc.) trigger
  // reactive notifications:
  push(...items: T[]): number {
    const result = super.push(...items);
    this.notify();
    return result;
  }
}
```

This ensures array mutations are tracked by the reactivity system.

## Content Negotiation

The runtime uses HTTP content negotiation to serve appropriate responses:

```
Request Accept Header          → Response
────────────────────────────────────────────
application/vnd.card+json      → JSON-API document
application/vnd.card+source    → Source code (.gts)
application/vnd.api+json       → Directory listing
text/event-stream              → Server-Sent Events
text/html                      → Rendered HTML
*/*                            → Transpiled JS module
```

## Next Steps

- [Card Lifecycle](/architecture/card-lifecycle) — Full card journey
- [Module Resolution](/architecture/module-resolution) — Deep dive into loading
- [Data Flow](/architecture/data-flow) — End-to-end data paths
