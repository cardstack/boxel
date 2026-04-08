# Query API

The Query API defines the search and filter syntax for finding cards across realms.

## Query Structure

```typescript
interface Query {
  filter?: Filter;
  sort?: Sort[];
  page?: {
    number?: number;  // Zero-indexed page number
    size: number;     // Results per page
    realmVersion?: number;
  };
  realm?: string;     // Search single realm
  realms?: string[];  // Search multiple realms (XOR with realm)
  asData?: boolean;   // Return raw data vs card instances
  fields?: SparseFieldsets;  // Sparse field selection
}
```

## Filter Types

### CardTypeFilter

Match cards by type (includes all subtypes via adoption chain):

```typescript
interface CardTypeFilter {
  type: CodeRef;
  // e.g., { module: './blog-post', name: 'BlogPost' }
}
```

```json
{ "type": { "module": "./blog-post", "name": "BlogPost" } }
```

### EqFilter

Exact equality on one or more fields:

```typescript
interface EqFilter {
  eq: Record<string, string | number | boolean>;
  on?: CodeRef;  // Disambiguate field source
}
```

```json
{ "eq": { "status": "published", "author": "Alice" } }
```

### RangeFilter

Comparison operators:

```typescript
interface RangeFilter {
  range: Record<string, {
    gt?: string | number;
    gte?: string | number;
    lt?: string | number;
    lte?: string | number;
  }>;
  on?: CodeRef;
}
```

```json
{
  "range": {
    "price": { "gte": 10, "lte": 100 },
    "createdAt": { "gt": "2024-01-01T00:00:00Z" }
  }
}
```

### ContainsFilter

Substring match:

```typescript
interface ContainsFilter {
  contains: Record<string, string>;
  on?: CodeRef;
}
```

```json
{ "contains": { "title": "boxel" } }
```

### InFilter

Match against a set of values:

```typescript
interface InFilter {
  in: Record<string, Array<string | number>>;
  on?: CodeRef;
}
```

```json
{ "in": { "status": ["draft", "review", "published"] } }
```

### AnyFilter (OR)

At least one sub-filter must match:

```typescript
interface AnyFilter {
  any: Filter[];
}
```

```json
{
  "any": [
    { "eq": { "status": "published" } },
    { "eq": { "featured": true } }
  ]
}
```

### EveryFilter (AND)

All sub-filters must match:

```typescript
interface EveryFilter {
  every: Filter[];
}
```

```json
{
  "every": [
    { "type": { "module": "./post", "name": "Post" } },
    { "eq": { "status": "published" } },
    { "range": { "views": { "gte": 100 } } }
  ]
}
```

### NotFilter (Negation)

Invert a filter:

```typescript
interface NotFilter {
  not: Filter;
}
```

```json
{
  "not": { "eq": { "status": "archived" } }
}
```

## Sort

```typescript
interface Sort {
  by: string;               // Field name or general sort field
  direction?: 'asc' | 'desc';  // Default: 'asc'
  on?: CodeRef;             // Disambiguate field source
}
```

### General Sort Fields

| Field | Description |
|-------|-------------|
| `createdAt` | Card creation timestamp |
| `updatedAt` | Last modification timestamp |
| `title` | Card title (from cardTitle) |

### Examples

```json
[
  { "by": "publishDate", "direction": "desc" },
  { "by": "title", "direction": "asc" }
]
```

Sort with type disambiguation:

```json
[
  {
    "by": "priority",
    "direction": "desc",
    "on": { "module": "./task", "name": "Task" }
  }
]
```

## Pagination

```typescript
interface Page {
  number?: number;  // Zero-indexed (default: 0)
  size: number;     // Results per page (required)
  realmVersion?: number;  // For consistent pagination
}
```

**Response includes pagination meta:**

```json
{
  "data": [...],
  "meta": {
    "page": {
      "total": 150,
      "realmVersion": 42
    }
  }
}
```

## The `on` Clause

When a field name exists on multiple card types in the hierarchy, use `on` to specify which type's field to query:

```json
{
  "filter": {
    "eq": { "priority": "high" }
  },
  "on": { "module": "./task", "name": "Task" }
}
```

## Nested Field Access

Query fields on linked cards using dot notation:

```json
{
  "filter": {
    "eq": { "company.industry": "Technology" }
  }
}
```

## Query Interpolation

In card definitions, queries support `$this` interpolation:

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

### Interpolation Tokens

| Token | Resolves To |
|-------|-------------|
| `$this.fieldName` | Current card's field value |
| `$thisRealm` | Current realm URL |

## HTTP Usage

### URL Query Parameters

Queries can be serialized as URL query parameters using the `qs` library format:

```
GET /_search?filter[type][module]=./post&filter[type][name]=Post&sort[0][by]=title
```

### POST Body

For complex queries, use POST with JSON body:

```http
POST /_federated-search
Content-Type: application/json

{
  "realms": ["https://realm-a.boxel.ai/"],
  "filter": {
    "every": [
      { "type": { "module": "./post", "name": "Post" } },
      { "eq": { "status": "published" } }
    ]
  },
  "sort": [{ "by": "publishDate", "direction": "desc" }],
  "page": { "size": 10 }
}
```

## Validation

Queries are validated at runtime using `assertQuery()`. Invalid queries receive error responses:

```json
{
  "errors": [{
    "status": "400",
    "title": "Invalid Query",
    "detail": "Filter must include a 'type' or field filter"
  }]
}
```

## Complete Example

Find all high-priority tasks assigned to Alice in the tech department, sorted by due date:

```json
{
  "realms": [
    "https://work.boxel.ai/",
    "https://personal.boxel.ai/"
  ],
  "filter": {
    "every": [
      {
        "type": { "module": "./task", "name": "Task" }
      },
      {
        "eq": {
          "priority": "high",
          "assignee.name": "Alice"
        }
      },
      {
        "eq": {
          "department.name": "Engineering"
        }
      },
      {
        "not": {
          "eq": { "status": "completed" }
        }
      }
    ]
  },
  "sort": [
    { "by": "dueDate", "direction": "asc" },
    { "by": "priority", "direction": "desc" }
  ],
  "page": { "size": 25, "number": 0 }
}
```

## Next Steps

- [Realm Server API](/api-reference/realm-server-api) — HTTP endpoints
- [Queries & Search](/core-concepts/queries-and-search) — Conceptual guide
- [Indexing](/core-concepts/indexing) — How search works
