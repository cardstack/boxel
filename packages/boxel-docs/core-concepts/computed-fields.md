# Computed Fields

Computed fields derive their values from other fields automatically. They enable powerful data transformations while keeping your card definitions clean and reactive.

## Basic Computed Fields

Use the `computeVia` option on any field decorator:

```typescript
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Person extends CardDef {
  @field firstName = contains(StringField);
  @field lastName = contains(StringField);

  @field fullName = contains(StringField, {
    computeVia: function (this: Person) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ');
    },
  });
}
```

## Key Characteristics

| Property | Behavior |
|----------|----------|
| **Evaluation** | Eager — computed on every access |
| **Caching** | Never cached — always fresh |
| **Reactivity** | Triggers re-render when dependencies change |
| **Mutability** | Read-only — cannot be set directly |
| **Serialization** | Optionally included (via `includeComputeds`) |
| **Rendering** | Always rendered as `embedded` format (never `edit`) |

## Supported Field Types

Computed fields work with all relationship types:

### `contains` (Computed)

```typescript
@field itemCount = contains(NumberField, {
  computeVia: function (this: ShoppingCart) {
    return this.items?.length ?? 0;
  },
});
```

### `containsMany` (Computed)

```typescript
@field uppercaseTags = containsMany(StringField, {
  computeVia: function (this: Article) {
    return (this.tags ?? []).map(t => t.toUpperCase());
  },
});
```

### `linksToMany` (Query-Based)

Instead of `computeVia`, link-type fields use `query`:

```typescript
@field recentPosts = linksToMany(() => BlogPost, {
  query: {
    filter: {
      type: { module: './blog-post', name: 'BlogPost' },
    },
    sort: [{ by: 'publishDate', direction: 'desc' }],
    page: { size: 10 },
  },
});
```

## Reactivity

Computed fields participate in Glimmer's reactivity system:

```
firstName changes → fullName recomputes → template re-renders
```

The tracking happens automatically. When you access `this.firstName` inside a `computeVia` function, Glimmer records that dependency. When `firstName` changes, `fullName` is invalidated.

## Patterns

### Aggregation

```typescript
@field totalPrice = contains(NumberField, {
  computeVia: function (this: Invoice) {
    return (this.lineItems ?? []).reduce(
      (sum, item) => sum + (item.price ?? 0) * (item.quantity ?? 1),
      0
    );
  },
});
```

### Conditional Display

```typescript
@field statusLabel = contains(StringField, {
  computeVia: function (this: Task) {
    if (this.completedAt) return 'Completed';
    if (this.startedAt) return 'In Progress';
    return 'Not Started';
  },
});
```

### Formatted Output

```typescript
@field duration = contains(StringField, {
  computeVia: function (this: Playlist) {
    const songs = this.songs;
    if (!songs || songs.length === 0) return '0m';
    const totalMinutes = Math.round(songs.length * 3.5);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
  },
});
```

### Derived Identity

```typescript
@field shortId = contains(StringField, {
  computeVia: function (this: Ticket) {
    return this.id ? this.id.split('/').pop()?.substring(0, 8) : '';
  },
});
```

## Error Handling

Computed fields should handle edge cases gracefully:

```typescript
@field safeComputed = contains(StringField, {
  computeVia: function (this: MyCard) {
    try {
      return this.someField?.nested?.value ?? 'Default';
    } catch (e) {
      console.error('Computation failed:', e);
      return 'Error';
    }
  },
});
```

## Computed Fields in the Index

During indexing, computed fields are evaluated and stored in the search document. This means you can search and sort by computed field values:

```typescript
const results = await search({
  filter: {
    eq: { fullName: 'Alice Johnson' }
  },
  sort: [{ by: 'fullName', direction: 'asc' }]
});
```

## Limitations

1. **Cannot use `this.id` reliably** — ID may not be set for unsaved cards
2. **No async computation** — `computeVia` must be synchronous
3. **Cannot write to computed fields** — they are read-only by design
4. **Always re-evaluated** — no caching, so keep computations lightweight

## Next Steps

- [Queries & Search](/core-concepts/queries-and-search) — Searching computed values
- [Cards & Fields](/core-concepts/cards-and-fields) — Field system overview
- [Field Types Reference](/card-development/field-types) — All built-in fields
