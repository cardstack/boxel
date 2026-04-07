# Realm Search Query Reference

How to use the `search_realm` tool to query cards in a realm. The query object follows the Boxel realm search API format.

## Basic Structure

```json
{
  "filter": { ... },
  "sort": [ ... ],
  "page": { "size": 10 }
}
```

All top-level fields are optional. An empty query `{}` returns all cards.

## Filter by Card Type

Use `type` with a `{ module, name }` CodeRef to filter by card type. The `module` must be the full absolute URL of the module that defines the card.

```json
{
  "filter": {
    "type": {
      "module": "http://localhost:4201/software-factory/darkfactory",
      "name": "Project"
    }
  }
}
```

This returns all cards that adopt from (or extend) the specified type. Do NOT use wildcards (`*`) in module or name — they are not supported.

## Filter by Field Value (eq)

Use `eq` to match exact field values. You must specify `on` to scope the field to a card type:

```json
{
  "filter": {
    "on": {
      "module": "http://localhost:4201/software-factory/darkfactory",
      "name": "Ticket"
    },
    "eq": { "ticketStatus": "in_progress" }
  }
}
```

Multiple fields in `eq` are ANDed:

```json
{
  "filter": {
    "on": { "module": "...", "name": "Post" },
    "eq": { "cardTitle": "Card 1", "cardDescription": "Sample post" }
  }
}
```

### Nested Fields

Use dot paths for nested fields (e.g., fields inside a `contains` relationship):

```json
{
  "filter": {
    "on": { "module": "...", "name": "Post" },
    "eq": { "author.firstName": "Carl" }
  }
}
```

### Null / Missing Values

Use `null` to find cards where a field is empty or missing:

```json
{
  "filter": {
    "on": { "module": "...", "name": "TypeExamples" },
    "eq": { "stringField": null }
  }
}
```

## Substring Search (contains)

Use `contains` for case-insensitive substring matching:

```json
{
  "filter": {
    "contains": { "cardTitle": "sticky" }
  }
}
```

Scoped to a type:

```json
{
  "filter": {
    "on": { "module": "...", "name": "Person" },
    "contains": { "cardTitle": "note" }
  }
}
```

## Range Filters

Use `range` with `gt`, `gte`, `lt`, `lte` for numeric, date, or string comparisons:

```json
{
  "filter": {
    "on": { "module": "...", "name": "Post" },
    "range": {
      "views": { "lte": 10, "gt": 5 },
      "author.posts": { "gte": 1 }
    }
  }
}
```

## Combining Filters

### AND (every)

All conditions must match:

```json
{
  "filter": {
    "on": { "module": "...", "name": "Post" },
    "every": [
      { "eq": { "cardTitle": "Card 1" } },
      { "not": { "eq": { "author.firstName": "Cardy" } } }
    ]
  }
}
```

### OR (any)

At least one condition must match. Can combine different types:

```json
{
  "filter": {
    "any": [
      {
        "on": { "module": "...", "name": "Article" },
        "eq": { "author.firstName": "Cardy" }
      },
      {
        "on": { "module": "...", "name": "Book" },
        "eq": { "author.firstName": "Cardy" }
      }
    ]
  }
}
```

### NOT (negation)

```json
{
  "filter": {
    "on": { "module": "...", "name": "Article" },
    "not": { "eq": { "author.firstName": "Carl" } }
  }
}
```

## Sorting

Sort results using the `sort` array. Each entry needs `by` (field path) and `on` (card type):

```json
{
  "sort": [
    {
      "by": "author.lastName",
      "on": { "module": "...", "name": "Article" }
    }
  ],
  "filter": {
    "type": { "module": "...", "name": "Article" }
  }
}
```

Descending order:

```json
{
  "sort": [
    {
      "by": "author.firstName",
      "on": { "module": "...", "name": "Article" },
      "direction": "desc"
    }
  ]
}
```

## Pagination

```json
{
  "filter": { "type": { "module": "...", "name": "Project" } },
  "page": { "size": 10 }
}
```

## Discovering Available Fields

You can only filter/sort on fields that exist on the card type. To find which fields a card type has:

1. Use `run_command` to fetch the JSON schema for a card type:

```json
{
  "command": "@cardstack/boxel-host/commands/get-card-type-schema/default",
  "commandInput": {
    "codeRef": {
      "module": "http://localhost:4201/software-factory/darkfactory",
      "name": "Ticket"
    }
  }
}
```

2. The result contains `attributes.properties` listing all searchable fields (e.g., `ticketStatus`, `summary`, `priority`).

3. Use those field names in your `eq`, `contains`, `range`, or `sort` with the matching `on` type.

The card tools (`update_project`, `update_ticket`, `create_knowledge`, `create_catalog_spec`) also have dynamic JSON schemas in their parameters that list available fields.

### Inheritance

Filtering on a base card type's fields matches all cards that inherit from it. For example, filtering on `CardDef` fields like `cardTitle` or `cardDescription` finds cards of any type. Filtering on a `Ticket` field like `ticketStatus` finds only Ticket cards (and any subtypes of Ticket).

### Searching Through Relationship Fields

You can filter on fields inside `linksTo` and `linksToMany` relationships, as long as those relationship fields are rendered in an embedded or fitted template. Rendering makes them indexable by the query engine.

For example, if a `Friend` card has `@field friend = linksTo(Dog)` and Dog's `firstName` field is rendered in an embedded template:

```json
{
  "filter": {
    "on": { "module": "...", "name": "Friend" },
    "eq": { "friend.firstName": "Mango" }
  }
}
```

### Searching by CodeRef Fields

Some cards have CodeRef fields (e.g., `ref` on the Spec card). You can search by matching the full CodeRef:

```json
{
  "filter": {
    "on": {
      "module": "https://cardstack.com/base/spec",
      "name": "Spec"
    },
    "eq": {
      "ref": {
        "module": "http://localhost:4201/my-realm/sticky-note",
        "name": "StickyNote"
      }
    }
  }
}
```

If a relationship field is NOT rendered in any embedded/fitted template, the query engine cannot index it and searches against it will fail.

## Common Mistakes

- **Do NOT use wildcards** (`*`) in `module` or `name` — the query engine does not support them. Use `type` with a specific CodeRef.
- **Do NOT use field names without `on`** — fields like `title`, `status`, etc. are specific to a card type. Without `on`, the query engine doesn't know which type's fields to search. The exception is `cardTitle` and `cardDescription` which exist on the base `CardDef`.
- **Use full absolute module URLs** — not relative paths, not bare package names.
- **Nested field paths use dots** — `author.firstName`, not `author/firstName` or `author[firstName]`.
