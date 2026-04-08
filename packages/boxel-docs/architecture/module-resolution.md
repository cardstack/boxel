# Module Resolution

Boxel has a custom module resolution system that loads, compiles, and evaluates card definitions from realm URLs. This system bridges the gap between URL-based card references and executable JavaScript modules.

## How Modules Are Identified

Every card module is identified by its URL:

```
https://cardstack.com/base/string          → StringField
https://cardstack.com/base/card-api        → CardDef, FieldDef, etc.
https://my-realm.boxel.ai/blog-post        → BlogPost
./contact                                   → relative to current module
```

## The Loader

The `Loader` class (`runtime-common/loader.ts`) manages all module loading:

```typescript
class Loader {
  // Import and evaluate a module
  async import<T>(moduleURL: string): Promise<T>

  // Register a pre-built module
  shimModule(moduleURL: string, module: object): void

  // Check if a module is loaded
  isModuleLoaded(moduleURL: string): boolean

  // Get module dependencies
  getConsumedModules(moduleURL: string): string[]

  // Identify an export's source module
  identify(value: any): { module: string; name: string } | undefined
}
```

### Module State Machine

Each module transitions through states:

```
fetching
  ↓ (HTTP fetch completes)
registered
  ↓ (begin resolving imports)
registered-completing-deps
  ↓ (all imports resolved)
registered-with-deps
  ↓ (begin evaluation)
preparing
  ↓ (evaluation complete)
evaluated
```

If any step fails, the module enters a **broken** state with the exception recorded.

## Resolution Process

### Step 1: Fetch

The loader fetches the module source:

```
GET https://my-realm.boxel.ai/blog-post
Accept: */*
```

The realm server responds with transpiled JavaScript.

### Step 2: Parse and Register

The source is parsed and its imports are extracted:

```javascript
// blog-post.gts imports:
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
```

### Step 3: Resolve Dependencies

Each import is recursively loaded:

```
blog-post
├── https://cardstack.com/base/card-api
│   ├── ... (base dependencies)
│   └── ...
└── https://cardstack.com/base/string
    └── https://cardstack.com/base/card-api (already loaded)
```

### Step 4: Evaluate

Once all dependencies are resolved, modules are evaluated bottom-up:

```
1. Evaluate base/card-api (no unresolved deps)
2. Evaluate base/string (depends on card-api ✓)
3. Evaluate blog-post (depends on card-api ✓, string ✓)
```

## GTS Compilation

`.gts` files go through Babel transformation before evaluation:

### Template Extraction

```typescript
// Input
static isolated = class extends Component<typeof MyCard> {
  <template>
    <h1>{{@model.title}}</h1>
  </template>
};
```

```javascript
// Output
static isolated = class extends Component {
  static {
    setComponentTemplate(
      precompileTemplate(`<h1>{{@model.title}}</h1>`),
      this
    );
  }
};
```

### Scoped CSS Processing

```typescript
<style scoped>
  .my-class { color: red; }
</style>
```

Becomes a unique, scoped stylesheet that doesn't leak to other components.

## Module Caching

Compiled modules are cached in the `modules` PostgreSQL table:

```sql
-- Cache entry
url:          '/my-realm/blog-post'
cache_scope:  'realm'
auth_user_id: 'user123'
definitions:  '{"BlogPost": {"type": "card", "fields": [...]}}'
deps:         ['base/card-api', 'base/string']
```

### Cache Invalidation

Caches are invalidated when:
- The module source changes
- Any dependency changes
- The compiler version changes
- `DISABLE_MODULE_CACHING=true` is set

## ModuleSyntax

The `ModuleSyntax` class (`runtime-common/module-syntax.ts`) provides static analysis of `.gts` files without full compilation:

```typescript
class ModuleSyntax {
  // Find possible card/field exports
  possibleCardsOrFields: Declaration[]

  // Get all import declarations
  imports: ImportDeclaration[]

  // Add a field to a card definition
  addField(opts: AddFieldOptions): void

  // Remove a field
  removeField(cardURL: string, fieldName: string): void
}
```

This is used by:
- The code editor to understand card structure
- The indexer to extract card metadata without evaluation
- The field editor to modify card definitions

## Middleware Stack

The loader uses a middleware stack for its fetch operations:

### Auth Middleware
Adds JWT tokens to requests for authenticated realms.

### Scoped CSS Middleware
Intercepts CSS module requests and returns pre-processed scoped stylesheets.

### Error Handling Middleware
Catches and normalizes fetch errors.

## Shimmed Modules

Some modules are "shimmed" — provided directly without fetching:

```typescript
loader.shimModule('https://cardstack.com/base/card-api', cardApiModule);
loader.shimModule('@glimmer/component', glimmerComponent);
```

This is used for:
- Base packages available at startup
- Third-party libraries
- Test fixtures

## URL Patterns

| Pattern | Example | Resolution |
|---------|---------|------------|
| Absolute URL | `https://cardstack.com/base/string` | Direct fetch |
| Relative path | `./blog-post` | Resolve against current module URL |
| Package prefix | `@cardstack/boxel-ui/...` | Map to registered package URL |
| Realm-relative | `../contact` | Resolve against realm URL |

## Next Steps

- [Runtime Architecture](/architecture/runtime) — Full runtime overview
- [Card Lifecycle](/architecture/card-lifecycle) — How modules are used
- [Styling Cards](/card-development/styling) — Scoped CSS details
