# Field Decorators

This reference covers every field decorator in detail, including their behavior, serialization, rendering, and edge cases.

## Overview

| Decorator | Cardinality | Storage | Serialized In |
|-----------|-------------|---------|---------------|
| `contains` | Single | Embedded | `attributes` |
| `containsMany` | Array | Embedded | `attributes` |
| `linksTo` | Single | Reference | `relationships` |
| `linksToMany` | Array | Reference | `relationships` |

## `contains(fieldType, options?)`

### Signature

```typescript
function contains<T extends typeof FieldDef | typeof CardDef>(
  fieldType: T,
  options?: ContainsOptions
): FieldDescriptor;

interface ContainsOptions {
  description?: string;
  computeVia?: (this: any) => any;
  isUsed?: boolean;
  configuration?: ConfigurationInput;
}
```

### Behavior

- Stores the value directly in the parent card's `attributes`
- Creates a new instance on first access (empty value)
- For primitive types: stores the raw value (string, number, etc.)
- For composite types: stores a nested object

### Serialization

```json
// Primitive
{ "attributes": { "name": "Alice" } }

// Composite (FieldDef)
{ "attributes": { "address": { "street": "123 Main", "city": "NYC" } } }
```

### Rendering

| Parent Format | Field Renders As |
|--------------|-----------------|
| `isolated` | `embedded` |
| `embedded` | `embedded` |
| `edit` | `edit` |
| `atom` | `atom` |

### Examples

```typescript
// Primitive field
@field name = contains(StringField);

// Composite field
@field address = contains(Address);

// With description
@field email = contains(StringField, {
  description: 'Primary email address'
});

// Computed
@field fullName = contains(StringField, {
  computeVia: function(this: Person) {
    return `${this.firstName} ${this.lastName}`;
  }
});

// With configuration
@field notes = contains(MarkdownField, {
  configuration: { maxLength: 500 }
});
```

## `containsMany(fieldType, options?)`

### Signature

```typescript
function containsMany<T extends typeof FieldDef | typeof CardDef>(
  fieldType: T,
  options?: ContainsManyOptions
): FieldDescriptor;

interface ContainsManyOptions {
  description?: string;
  computeVia?: (this: any) => any[];
  isUsed?: boolean;
  configuration?: ConfigurationInput;
}
```

### Behavior

- Stores an array of values in the parent card's `attributes`
- Returns a `WatchedArray` for reactive mutations
- Supports polymorphic items (different types in same array)
- Empty value: empty `WatchedArray`

### Serialization

```json
// Primitive array
{ "attributes": { "tags": ["typescript", "boxel"] } }

// Composite array
{
  "attributes": {
    "addresses": [
      { "street": "123 Main", "city": "NYC" },
      { "street": "456 Oak", "city": "LA" }
    ]
  }
}
```

### Rendering

- In `edit` mode on a CardDef: renders an editable list
- In `embedded` mode on a FieldDef: renders as read-only list
- Items render in `atom` format by default within FieldDef

### Examples

```typescript
// Array of primitives
@field tags = containsMany(StringField);

// Array of composites
@field phoneNumbers = containsMany(PhoneNumber);

// Computed array
@field uppercaseTags = containsMany(StringField, {
  computeVia: function(this: Article) {
    return (this.tags ?? []).map(t => t.toUpperCase());
  }
});
```

## `linksTo(cardType, options?)`

### Signature

```typescript
function linksTo<T extends typeof CardDef>(
  cardType: T | (() => T),
  options?: LinksToOptions
): FieldDescriptor;

interface LinksToOptions {
  description?: string;
  query?: QueryWithInterpolations;
  isUsed?: boolean;
}
```

### Behavior

- Stores a URL reference to another card
- The referenced card exists independently
- Lazy loading: returns `NotLoadedValue` until fetched
- Cannot link to FieldDef (throws error)
- Supports self-referential links via thunks

### Serialization

```json
{
  "relationships": {
    "company": {
      "links": { "self": "./company/acme-corp" }
    }
  }
}
```

### Lazy Loading

When a linked card hasn't been fetched:

```typescript
// The field returns NotLoadedValue
{
  type: 'not-loaded',
  reference: 'https://my-realm.boxel.ai/company/acme-corp'
}
```

The UI can render a placeholder while loading.

### Rendering

| Parent Format | Field Renders As |
|--------------|-----------------|
| `isolated` | `embedded` (the linked card) |
| `embedded` | `embedded` |
| `edit` | `LinksToEditor` (card picker) |
| `atom` | `atom` |

### Examples

```typescript
// Simple link
@field company = linksTo(Company);

// Self-referential (use thunk)
@field parent = linksTo(() => Category);

// With query (auto-populate)
@field latestPost = linksTo(() => BlogPost, {
  query: {
    filter: { type: { module: './blog-post', name: 'BlogPost' } },
    sort: [{ by: 'publishDate', direction: 'desc' }],
    page: { size: 1 }
  }
});
```

## `linksToMany(cardType, options?)`

### Signature

```typescript
function linksToMany<T extends typeof CardDef>(
  cardType: T | (() => T),
  options?: LinksToManyOptions
): FieldDescriptor;

interface LinksToManyOptions {
  description?: string;
  query?: QueryWithInterpolations;
  isUsed?: boolean;
}
```

### Behavior

- Stores an array of URL references to other cards
- Returns a `WatchedArray` of card instances
- Lazy loading for unresolved items
- Supports query-based auto-population

### Serialization

```json
{
  "relationships": {
    "teammates": {
      "links": { "self": null },
      "data": [
        { "type": "card", "id": "./person/alice" },
        { "type": "card", "id": "./person/bob" }
      ]
    }
  }
}
```

### Examples

```typescript
// Array of links
@field tags = linksToMany(Tag);

// Self-referential
@field children = linksToMany(() => TreeNode);

// Query-based (auto-populated)
@field myTasks = linksToMany(() => Task, {
  query: {
    filter: {
      every: [
        { type: { module: './task', name: 'Task' } },
        { eq: { 'assignee.id': '$this.id' } }
      ]
    },
    sort: [{ by: 'dueDate', direction: 'asc' }]
  }
});
```

## Summary Table

| Feature | `contains` | `containsMany` | `linksTo` | `linksToMany` |
|---------|-----------|----------------|----------|---------------|
| Cardinality | Single | Array | Single | Array |
| Storage | Embedded | Embedded | Reference | Reference |
| JSON location | `attributes` | `attributes` | `relationships` | `relationships` |
| Supports FieldDef | Yes | Yes | No | No |
| Supports CardDef | Yes | Yes | Yes | Yes |
| Supports computed | Yes | Yes | Via query | Via query |
| Lazy loading | No | No | Yes | Yes |
| Thunk support | No | No | Yes | Yes |
| WatchedArray | No | Yes | No | Yes |

## Next Steps

- [Card API](/api-reference/card-api) — Core API reference
- [Base Card Types](/api-reference/base-card-types) — Built-in types
- [Cards & Fields](/core-concepts/cards-and-fields) — Conceptual guide
