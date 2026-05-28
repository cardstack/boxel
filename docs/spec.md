# Spec Component Documentation

## What is a Spec?

A Spec is a comprehensive documentation and metadata container for code within the Boxel ecosystem. It serves as a blueprint for code, providing a self-describing documentation system that combines code references, examples, and narrative documentation in a single, structured format.

At its core, a Spec links to an exported definition in modules via **Code Ref** - the foundational element that connects the documentation to its actual implementation. A Code Ref looks like this:

```typescript
{
  module: string;  // Path to the module file (e.g., './my-component.gts')
  name: string;    // Export name (e.g., 'MyComponent')
}
```

When a module is edited (for example, if a definition is renamed), the spec might potentially become outdated.

## Why We Need Specs

- **Search for instance creation** - Enable discovery and instantiation of available components. Code refs are not searchable unless wrapped inside a card instance (a spec) which is then indexed and can benefit from all search capabilities. This makes field definitions searchable as well.
- **Packaging of listings** - Code packaging in bundles occurs via linksToMany specs. The installation process looks for modules and code refs to copy during installation. 
- **Link to examples** - Provide interactive demonstrations and usage patterns
- **Documentation for code** - Maintain up-to-date, validated documentation connected to implementation

## Different Spec Types

Code categorization is endless, so we focus on a subset of exported code that interests us within the Boxel ecosystem. 

The Boxel ecosystem supports five distinct spec types:

- **`card`** 
- **`field`** 
- **`component`** 
- **`app`** 
- **`command`** 

Each spec type has specific characteristics and use cases:

### 1. Card Specs (`specType: 'card'`)

**Purpose**: Document card definitions - the ultimate sharing unit of the Boxel ecosystem.

**Characteristics**:
- Can have multiple view templates (isolated, fitted, embedded, edit)
- Often contain fields and computed properties
- May extend other cards through inheritance
- Support `linkedExamples` 

**Example Use Cases**:
- `Author` - Author profile card with bio and social links
- `Contact` - Contact information card for CRM systems
- `BlogPost` - Blog post card with content and metadata
- `CalendarEvent` - Event card with date, time, and location

### 2. Field Specs (`specType: 'field'`)

**Purpose**: Document field definitions used within cards.

**Characteristics**:
- Only support `containedExamples` (embedded within the spec)
- May be primitive (string, number, boolean) or composite
- TBD: display of primitive contained examples 
- May extend other fields through inheritance

**Example Use Cases**:
- `SocialMediaLink` - Composite field for social platform data
- `MaybeBase64Field` - String field with base64 encoding capabilities
- `TextAreaField` - Multi-line text input field
- `GeoPointField` - Coordinate field for maps

### 3. Component Specs (`specType: 'component'`)

**Purpose**: Document reusable UI components that don't represent data, so AI agents and developers can discover them by searching the catalog instead of needing a per-component skill.

**Characteristics**:
- Only when it extends Glimmer Component
- Potentially includes reactive data loading resources from ember-resources
- API documentation, an example, and CSS variables live in the `readMe` markdown field
- `cardDescription` is the keyword-rich one-liner the agent matches against — keep it concrete (e.g. "Form text input with validation states") rather than abstract

**Example Use Cases**:
- `CardsGrid` - Responsive grid layout component for card collections
- `FilterDropdown` - Multi-select dropdown component for filtering
- `Pill` - Badge component for displaying tags and statuses
- `LinksToEditor` - Component for editing card relationships

#### Boxel-UI Component Specs

All `@cardstack/boxel-ui` components ship a generated Spec card. The
generator (`packages/boxel-ui/addon/bin/generate-component-specs.mjs`)
walks each component's `usage.gts` file, extracts the `FreestyleUsage`
metadata (arguments, description, example, CSS variables), and emits a
Spec JSON with:

- `ref: { module: '@cardstack/boxel-ui/components', name: ComponentName }`
- `cardTitle: ComponentName`
- `cardDescription`: the top-level `@description` attribute on the
  primary `<FreestyleUsage>` tag, or the first sentence of its
  `<:description>` block. **For agent discoverability, add a
  keyword-rich `@description` attribute to the primary
  `<FreestyleUsage>` block in `usage.gts` whenever the synthesized
  description is generic.**
- `readMe`: a markdown body with the API table, a usage example, and the
  CSS-variable table.

##### Developer workflow

The generated specs are **not committed anywhere** — neither to the
boxel repo nor to `cardstack/boxel-catalog`. They're treated as build
artifacts of `boxel-ui` and regenerated fresh at realm-server deployment
time. The inputs (`usage.gts`) in boxel are the source of truth; the
deployed catalog content is whatever the generator produces against
the deployed commit.

1. Edit the component's `usage.gts`. Make sure the primary
   `<FreestyleUsage>` block has a `@description='…'` attribute and
   complete `<Args.X>` documentation.
2. (Optional, but recommended) Run
   `pnpm --dir packages/boxel-ui/addon generate:component-specs` locally
   to inspect the resulting spec content and have your local
   realm-server reindex it. Requires
   `pnpm --dir packages/catalog catalog:setup` to have run at least
   once (clones `cardstack/boxel-catalog` into
   `packages/catalog/contents/`, which is gitignored from boxel).
   Output: `packages/catalog/contents/Spec/boxel-ui-<slug>.json`.
3. Commit only your `usage.gts` change to your boxel PR — no spec JSON
   needs to land in any repo.
4. On deploy, the realm-server's `setup:catalog-in-deployment` script
   pulls latest `boxel-catalog`, then runs the generator against the
   deployed `usage.gts` files, then rsyncs the merged tree into
   `/persistent/catalog/`. The deployed catalog is full-indexed at
   startup.

##### Gotchas

- `packages/catalog/contents/` is its own git repo (clone of
  `cardstack/boxel-catalog`), gitignored from boxel. The generator
  drops `boxel-ui-*.json` files into that working tree locally. Treat
  those as transient — running `pnpm --dir packages/catalog catalog:update`
  will stash them automatically if a `git pull` would conflict.
- Because the generator regenerates fresh on every deploy, there is
  no in-boxel-repo drift-detection step. If you change `usage.gts`
  but don't run the generator locally to eyeball the result, the
  deployed catalog still ends up correct — but you only see what the
  agent will read at runtime after the next deploy. Running the
  generator locally before pushing is the recommended habit.

### 4. App Specs (`specType: 'app'`)

**Purpose**: Document application-level cards that serve as entry points, typically when other cards are queried within them.

**Characteristics**:
- Extends AppCard which displays in a wide view 
- Often contain more than one query 
- Often use navigation components like tabs or sidebars 
- Support `linkedExamples` 

**Example Use Cases**:
- `BlogApp` - Blog content management system
- `PreschoolCRMApp` - Customer relationship management for preschools
- `SprintPlanner` - Sprint planning applications

### 5. Command Specs (`specType: 'command'`)

**Purpose**: Document executable commands within the system.

**Characteristics**:
- Represent actions within a command palette 
- Imperative code that doesn't depend on data loading in a component
- Have access to host code via boxel-host commands 

**Example Use Cases**:
- `GenerateReadmeSpecCommand` - Generate documentation for spec cards
- `SearchCardsByQueryCommand` - Advanced card search with filtering
- `PatchCardInstanceCommand` - Update card instance data
- `OneShotLlmRequestCommand` - AI-powered content generation
- `ReadTextFileCommand` - File reading and module loading commands
