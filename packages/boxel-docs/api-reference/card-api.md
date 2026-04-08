# Card API

The Card API (`https://cardstack.com/base/card-api`) is the core module that defines the card system. This reference covers all exported classes, functions, decorators, and types.

## Core Classes

### CardDef

The base class for all card definitions.

```typescript
class CardDef extends BaseDef {
  static displayName: string;
  static icon: ComponentLike;
  static headerColor: string;
  static prefersWideFormat: boolean;
  static isCardDef: true;

  // Render format templates
  static isolated: ComponentLike;
  static embedded: ComponentLike;
  static fitted: ComponentLike;
  static edit: ComponentLike;
  static atom: ComponentLike;

  // Special fields (always present)
  id: string;               // Card URL (after save)
  cardInfo: CardInfoField;  // Card metadata
  cardTitle: string;        // Computed display title
  cardDescription: string;  // Computed description
  cardThumbnailURL: string; // Computed thumbnail
}
```

**Usage:**
```typescript
export class MyCard extends CardDef {
  static displayName = 'My Card';
  @field title = contains(StringField);
}
```

### FieldDef

The base class for composite field definitions.

```typescript
class FieldDef extends BaseDef {
  static displayName: string;
  static isFieldDef: true;
  static configuration: object;  // Default configuration

  // Render format templates
  static embedded: ComponentLike;
  static edit: ComponentLike;
  static atom: ComponentLike;
  static fitted: ComponentLike;
}
```

**Usage:**
```typescript
export class Address extends FieldDef {
  @field street = contains(StringField);
  @field city = contains(StringField);
}
```

### BaseDef

The root base class (internal). All cards and fields inherit from this.

### Component

Glimmer component base class for card templates.

```typescript
class Component<T extends typeof CardDef | typeof FieldDef> {
  args: {
    model: InstanceType<T>;  // The card/field instance
    fields: FieldComponents; // Field rendering components
    format: string;          // Current render format
    displayContainer: boolean;
  };
}
```

## Decorators

### @field

Registers a field on a card or field class:

```typescript
function field: PropertyDecorator;
```

**Usage:**
```typescript
@field name = contains(StringField);
@field tags = containsMany(StringField);
@field company = linksTo(Company);
@field teammates = linksToMany(Person);
```

## Field Decorators

### contains(fieldType, options?)

Creates a single embedded field.

```typescript
function contains(
  fieldType: typeof FieldDef | typeof CardDef,
  options?: {
    description?: string;
    computeVia?: () => any;
    isUsed?: boolean;
    configuration?: object;
  }
): FieldDescriptor;
```

**Serializes to:** `data.attributes`

### containsMany(fieldType, options?)

Creates an array of embedded fields.

```typescript
function containsMany(
  fieldType: typeof FieldDef | typeof CardDef,
  options?: {
    description?: string;
    computeVia?: () => any[];
    isUsed?: boolean;
    configuration?: object;
  }
): FieldDescriptor;
```

**Serializes to:** `data.attributes` (as array)

### linksTo(cardType, options?)

Creates a single card reference.

```typescript
function linksTo(
  cardType: typeof CardDef | (() => typeof CardDef),
  options?: {
    description?: string;
    query?: Query;
    isUsed?: boolean;
  }
): FieldDescriptor;
```

**Serializes to:** `data.relationships`

### linksToMany(cardType, options?)

Creates an array of card references.

```typescript
function linksToMany(
  cardType: typeof CardDef | (() => typeof CardDef),
  options?: {
    description?: string;
    query?: Query;
    isUsed?: boolean;
  }
): FieldDescriptor;
```

**Serializes to:** `data.relationships` (as array)

## Serialization Functions

### serializeCard(model, opts?)

Converts a card instance to a JSON-API document.

```typescript
function serializeCard(
  model: CardDef,
  opts?: {
    includeComputeds?: boolean;
    includeUnrenderedFields?: boolean;
    useAbsoluteURL?: boolean;
    omitFields?: Array<typeof BaseDef>;
    omitQueryFields?: boolean;
  }
): LooseSingleCardDocument;
```

### createFromSerialized(resource, doc, relativeTo, loader)

Creates a card instance from a JSON-API resource.

```typescript
async function createFromSerialized<T extends typeof CardDef>(
  resource: LooseCardResource,
  doc: LooseSingleCardDocument,
  relativeTo: URL,
  loader: Loader
): Promise<InstanceType<T>>;
```

## Utility Functions

### getField(card, fieldName)

Get a field descriptor by name:

```typescript
function getField(
  card: typeof BaseDef | BaseDef,
  fieldName: string
): Field | undefined;
```

### getFields(card, options?)

Get all fields on a card:

```typescript
function getFields(
  card: typeof BaseDef | BaseDef,
  options?: {
    usedLinksToFieldsOnly?: boolean;
    includeComputeds?: boolean;
  }
): Map<string, Field>;
```

## Types

### CodeRef

Reference to a card class in a module:

```typescript
interface CodeRef {
  module: string;  // Module URL or path
  name: string;    // Export name
}
```

### Field

Field descriptor interface:

```typescript
interface Field {
  card: typeof BaseDef;
  name: string;
  fieldType: 'contains' | 'containsMany' | 'linksTo' | 'linksToMany';
  computeVia?: () => unknown;
  description?: string;
  configuration?: object;
  serialize(value: any): any;
  deserialize(value: any): Promise<any>;
  component(format: string): ComponentLike;
}
```

### Format

```typescript
type Format = 'isolated' | 'embedded' | 'fitted' | 'edit' | 'atom';
```

## Symbols

The card system uses symbols for internal operations:

| Symbol | Purpose |
|--------|---------|
| `[serialize]` | Custom serialization hook |
| `[deserialize]` | Custom deserialization hook |
| `[localId]` | UUID for unsaved cards |
| `[fields]` | Polymorphic field overrides |
| `[primitive]` | Marks primitive field types |
| `[fieldDecorator]` | Marks field descriptors |
| `[relativeTo]` | Base URL for URL resolution |
| `[meta]` | Card metadata (realm, info) |
| `[queryableValue]` | Value for search indexing |
| `[formatQuery]` | Query format transformer |

## Next Steps

- [Field Decorators](/api-reference/field-decorators) — Detailed decorator reference
- [Query API](/api-reference/query-api) — Search query syntax
- [Base Card Types](/api-reference/base-card-types) — Built-in types
