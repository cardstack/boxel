# Queries & Search

Boxel provides a powerful query engine for searching across card instances. Queries support type filtering, field-level predicates, sorting, and pagination — and work across multiple realms.

## Query Structure

A query is a JSON object with these fields:

```typescript
interface Query {
  filter?: Filter;
  sort?: Sort[];
  page?: {
    number?: number;
    size: number;
  };
  realm?: string;    // Single realm
  realms?: string[]; // Multiple realms
}
```

## Filter Types

### Type Filter

Find cards of a specific type (including subtypes):

```json
{
  "filter": {
    "type": {
      "module": "./blog-post",
      "name": "BlogPost"
    }
  }
}
```

### Equality Filter (`eq`)

Match exact field values:

```json
{
  "filter": {
    "eq": {
      "status": "published",
      "author": "Alice"
    }
  }
}
```

### Range Filter

Compare with `gt`, `gte`, `lt`, `lte`:

```json
{
  "filter": {
    "range": {
      "price": { "gte": 10, "lte": 100 },
      "publishDate": { "gt": "2024-01-01" }
    }
  }
}
```

### Contains Filter

Check if a string field contains a substring:

```json
{
  "filter": {
    "contains": {
      "title": "boxel"
    }
  }
}
```

### In Filter

Match against a set of values:

```json
{
  "filter": {
    "in": {
      "status": ["draft", "review"]
    }
  }
}
```

### Logical Combinators

#### `every` (AND)

All conditions must match:

```json
{
  "filter": {
    "every": [
      { "type": { "module": "./post", "name": "Post" } },
      { "eq": { "status": "published" } },
      { "range": { "views": { "gte": 100 } } }
    ]
  }
}
```

#### `any` (OR)

At least one condition must match:

```json
{
  "filter": {
    "any": [
      { "eq": { "status": "draft" } },
      { "eq": { "status": "review" } }
    ]
  }
}
```

#### `not` (Negation)

Invert a condition:

```json
{
  "filter": {
    "not": {
      "eq": { "status": "archived" }
    }
  }
}
```

## Sorting

Sort results by one or more fields:

```json
{
  "sort": [
    {
      "by": "publishDate",
      "direction": "desc",
      "on": {
        "module": "./blog-post",
        "name": "BlogPost"
      }
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `by` | Field name to sort by |
| `direction` | `"asc"` or `"desc"` |
| `on` | Optional CodeRef for field disambiguation |

### General Sort Fields

In addition to card fields, you can sort by these general fields:

- `createdAt` — Card creation time
- `updatedAt` — Last modification time
- `title` — Card title

## Pagination

```json
{
  "page": {
    "number": 0,
    "size": 25
  }
}
```

Pages are zero-indexed. The response includes pagination metadata.

## Nested Field Queries

Access fields on linked cards using dot notation:

```json
{
  "filter": {
    "eq": {
      "company.name": "Acme Corp"
    }
  }
}
```

## The `on` Clause

When a field name is ambiguous (exists on multiple card types in the hierarchy), use `on` to specify the card type:

```json
{
  "filter": {
    "eq": {
      "status": "active"
    },
    "on": {
      "module": "./crm-task",
      "name": "CRMTask"
    }
  }
}
```

## HTTP API

### Single Realm Search

```
POST /_search
Content-Type: application/json

{
  "filter": { ... },
  "sort": [ ... ],
  "page": { "size": 10 }
}
```

### Federated Search (Multi-Realm)

```
POST /_federated-search
Content-Type: application/json

{
  "realms": [
    "https://realm-a.boxel.ai/",
    "https://realm-b.boxel.ai/"
  ],
  "filter": { ... }
}
```

## Query Interpolation

In `linksToMany` fields with queries, you can use `$this` to reference the current card's values:

```typescript
@field myTasks = linksToMany(() => Task, {
  query: {
    filter: {
      every: [
        { type: { module: './task', name: 'Task' } },
        { eq: { 'assignee.id': '$this.id' } }
      ]
    }
  }
});
```

The `$this.fieldName` syntax is replaced with the current card's field value at runtime.

Special tokens:
- `$this.fieldName` — Value of a field on the current card
- `$thisRealm` — URL of the current realm

## Query Examples

### Find all published blog posts by Alice, sorted by date

```json
{
  "filter": {
    "every": [
      { "type": { "module": "./blog-post", "name": "BlogPost" } },
      { "eq": { "author": "Alice", "status": "published" } }
    ]
  },
  "sort": [{ "by": "publishDate", "direction": "desc" }],
  "page": { "size": 20 }
}
```

### Find contacts at companies in the tech industry

```json
{
  "filter": {
    "every": [
      { "type": { "module": "./contact", "name": "Contact" } },
      { "eq": { "company.industry": "Technology" } }
    ]
  }
}
```

### Find cards updated in the last week

```json
{
  "filter": {
    "range": {
      "updatedAt": {
        "gte": "2024-03-01T00:00:00Z"
      }
    }
  },
  "sort": [{ "by": "updatedAt", "direction": "desc" }]
}
```

## Next Steps

- [Indexing](/core-concepts/indexing) — How the search index is built
- [Query API](/api-reference/query-api) — Complete query reference
- [Realm Server API](/api-reference/realm-server-api) — HTTP endpoints
