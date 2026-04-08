# Serialization & JSON-API

Cards are serialized to JSON for storage and transport using the [JSON-API](https://jsonapi.org/) specification. Understanding this format is key to working with card instances.

## JSON-API Document Structure

Every card instance is a JSON-API document:

```json
{
  "data": {
    "type": "card",
    "id": "https://my-realm.boxel.ai/blog/hello-world",
    "attributes": {
      "title": "Hello World",
      "body": "Welcome to Boxel!",
      "author": "Alice"
    },
    "relationships": {
      "company": {
        "links": { "self": "./company/acme-corp" }
      }
    },
    "meta": {
      "adoptsFrom": {
        "module": "./blog-post",
        "name": "BlogPost"
      }
    }
  }
}
```

### Top-Level Fields

| Field | Description |
|-------|-------------|
| `data.type` | Always `"card"` |
| `data.id` | Card URL (set after saving; absent for unsaved cards) |
| `data.attributes` | Embedded field values (`contains`, `containsMany`) |
| `data.relationships` | Linked card references (`linksTo`, `linksToMany`) |
| `data.meta.adoptsFrom` | Code reference to the card class |

## How Fields Serialize

### `contains` → `attributes`

Simple contained fields become attributes:

```typescript
@field title = contains(StringField);
@field age = contains(NumberField);
```

```json
{
  "attributes": {
    "title": "Hello",
    "age": 30
  }
}
```

### `contains` (Composite) → Nested Attributes

Composite `FieldDef` fields serialize as nested objects:

```typescript
@field address = contains(Address);  // Address is a FieldDef
```

```json
{
  "attributes": {
    "address": {
      "street": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "zip": "62704"
    }
  }
}
```

### `containsMany` → Array Attributes

```typescript
@field tags = containsMany(StringField);
@field addresses = containsMany(Address);
```

```json
{
  "attributes": {
    "tags": ["typescript", "boxel", "cards"],
    "addresses": [
      { "street": "123 Main St", "city": "Springfield" },
      { "street": "456 Oak Ave", "city": "Shelbyville" }
    ]
  }
}
```

### `linksTo` → Single Relationship

```typescript
@field company = linksTo(Company);
```

```json
{
  "relationships": {
    "company": {
      "links": {
        "self": "./company/acme-corp"
      }
    }
  }
}
```

### `linksToMany` → Multiple Relationships

```typescript
@field teammates = linksToMany(Person);
```

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

## The `adoptsFrom` Code Reference

Every card declares its type via `meta.adoptsFrom`:

```json
{
  "meta": {
    "adoptsFrom": {
      "module": "./blog-post",
      "name": "BlogPost"
    }
  }
}
```

| Field | Description |
|-------|-------------|
| `module` | Relative or absolute path to the `.gts` module |
| `name` | The exported class name |

The base realm URL is `https://cardstack.com/base/`, so base types reference:
```json
{
  "module": "https://cardstack.com/base/card-api",
  "name": "CardDef"
}
```

## URL Resolution

URLs in card JSON are resolved relative to the card's own URL:

```
Card URL:    https://my-realm.boxel.ai/blog/hello-world
Relative:    ./blog-post          → https://my-realm.boxel.ai/blog-post
Relative:    ../contact/alice     → https://my-realm.boxel.ai/contact/alice
Absolute:    https://cardstack.com/base/string  (unchanged)
```

## Serialization Functions

### `serializeCard(model, opts?)`

Converts a card instance to a JSON-API document:

```typescript
import { serializeCard } from '@cardstack/runtime-common';

const doc = serializeCard(myCard, {
  includeComputeds: true,    // Include computed field values
  useAbsoluteURL: false,     // Use relative URLs
});
```

### Options

| Option | Description |
|--------|-------------|
| `includeComputeds` | Include computed fields in output |
| `includeUnrenderedFields` | Include all fields, even unused ones |
| `useAbsoluteURL` | Use absolute URLs instead of relative |
| `omitFields` | Fields to exclude |

## Deserialization

Cards are deserialized by:

1. Parsing the JSON-API document
2. Resolving `meta.adoptsFrom` to load the card class
3. Creating an instance of the class
4. Populating `contains` fields from `attributes`
5. Resolving `linksTo` fields from `relationships`

### Lazy Loading with NotLoadedValue

When a `linksTo` relationship hasn't been fetched yet, it uses a `NotLoadedValue` placeholder:

```typescript
{
  type: 'not-loaded',
  reference: 'https://my-realm.boxel.ai/company/acme-corp'
}
```

This allows cards to render before all relationships are resolved.

## Included Resources

Related cards can be side-loaded in the `included` array:

```json
{
  "data": {
    "type": "card",
    "id": "./blog/hello",
    "relationships": {
      "author": {
        "links": { "self": "./person/alice" }
      }
    }
  },
  "included": [
    {
      "type": "card",
      "id": "./person/alice",
      "attributes": {
        "name": "Alice Johnson"
      },
      "meta": {
        "adoptsFrom": { "module": "./person", "name": "Person" }
      }
    }
  ]
}
```

## Next Steps

- [Computed Fields](/core-concepts/computed-fields) — How computed values work
- [Card API](/api-reference/card-api) — Programmatic card operations
- [Queries & Search](/core-concepts/queries-and-search) — Searching serialized cards
