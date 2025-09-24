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

**Purpose**: Document reusable UI components that don't represent data.

**Characteristics**:
- No support for examples 
- Only when it extends Glimmer Component  
- Potentially includes reactive data loading resources from ember-resources

**Example Use Cases**:
- `CardsGrid` - Responsive grid layout component for card collections
- `FilterDropdown` - Multi-select dropdown component for filtering
- `Pill` - Badge component for displaying tags and statuses
- `LinksToEditor` - Component for editing card relationships

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
