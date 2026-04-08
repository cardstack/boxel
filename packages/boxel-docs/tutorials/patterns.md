# Patterns & Best Practices

Proven patterns from real-world Boxel applications, distilled from the catalog and experiments realms.

## Card Organization

### File Structure

```
my-realm/
├── index.json                    # Realm metadata
│
├── contact.gts                   # Main card definition
├── contact/
│   ├── components/               # Complex template components
│   │   ├── filter-panel.gts
│   │   └── detail-view.gts
│   └── fields/                   # Custom field types
│       ├── phone-number.gts
│       └── social-link.gts
│
├── contacts/                     # Card instances
│   ├── alice.json
│   └── bob.json
│
├── company.gts                   # Related card
└── companies/
    └── acme.json
```

### Naming Conventions

| Item | Convention | Example |
|------|-----------|---------|
| Card definitions | PascalCase class, kebab-case file | `BlogPost` in `blog-post.gts` |
| Field definitions | PascalCase class | `PhoneNumber` in `phone-number.gts` |
| Card instances | kebab-case file | `alice-johnson.json` |
| Directories | kebab-case plural | `blog-posts/`, `contacts/` |

## Composition Patterns

### Base Entity Pattern

Create a shared base for all domain cards:

```typescript
export class BaseEntity extends CardDef {
  @field name = contains(StringField);
  @field description = contains(StringField);
  @field createdAt = contains(DatetimeField);

  @field shortId = contains(StringField, {
    computeVia: function(this: BaseEntity) {
      return this.id?.split('/').pop()?.substring(0, 8) ?? '';
    }
  });
}

export class Product extends BaseEntity { /* ... */ }
export class Customer extends BaseEntity { /* ... */ }
```

### App Card Pattern

Build full applications as cards with tabs and data views:

```typescript
export class MyApp extends CardDef {
  static prefersWideFormat = true;

  // Data sources
  @field items = linksToMany(Item);

  // App template with routing, filters, views
  static isolated = class extends Component<typeof MyApp> {
    @tracked activeTab = 'all';
    @tracked searchQuery = '';
    @tracked viewMode = 'grid'; // 'grid' | 'list'

    get filteredItems() {
      let items = this.args.model.items ?? [];
      if (this.searchQuery) {
        items = items.filter(i =>
          i.name?.toLowerCase().includes(this.searchQuery.toLowerCase())
        );
      }
      return items;
    }

    // ... template with sidebar, tabs, grid
  };
}
```

### Enum Field Pattern

Create fields with predefined options:

```typescript
export class PriorityField extends FieldDef {
  static displayName = 'Priority';
  static values = [
    { index: 0, label: 'Low', color: '#22c55e' },
    { index: 1, label: 'Medium', color: '#eab308' },
    { index: 2, label: 'High', color: '#ef4444' },
  ];

  @field selectedIndex = contains(NumberField);

  get current() {
    return PriorityField.values[this.selectedIndex] ?? PriorityField.values[0];
  }

  static embedded = class extends Component<typeof PriorityField> {
    <template>
      <span
        class="priority"
        style="color: {{@model.current.color}}"
      >
        {{@model.current.label}}
      </span>
    </template>
  };
}
```

## Rendering Patterns

### Progressive Disclosure

Build templates from simple (atom) to detailed (isolated):

```
atom     →  "Alice Johnson"
embedded →  [Avatar] Alice Johnson - VP Engineering
fitted   →  [Avatar] Alice Johnson / VP Engineering / alice@acme.com
              (adapts to container size)
isolated →  Full profile page with all details, tabs, related cards
```

### Container Query Breakpoints

Standard breakpoints for the `fitted` format:

```css
/* Full content */
@container fitted-card (min-height: 275px) { /* all visible */ }

/* Compact: hide secondary info */
@container fitted-card (max-height: 180px) { .secondary { display: none; } }

/* Minimal: hide avatar/image */
@container fitted-card (max-height: 115px) { .avatar { display: none; } }

/* Tiny: title only */
@container fitted-card (max-height: 57px) { .meta { display: none; } }
```

## Data Patterns

### Computed Aggregations

```typescript
@field totalValue = contains(NumberField, {
  computeVia: function(this: Portfolio) {
    return (this.holdings ?? []).reduce(
      (sum, h) => sum + (h.value ?? 0), 0
    );
  }
});

@field itemCount = contains(NumberField, {
  computeVia: function(this: Collection) {
    return this.items?.length ?? 0;
  }
});
```

### Query-Based Relationships

Auto-populate related cards from search:

```typescript
// All tasks assigned to this person
@field assignedTasks = linksToMany(() => Task, {
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

// Recent items from this realm
@field recentItems = linksToMany(() => CardDef, {
  query: {
    sort: [{ by: 'updatedAt', direction: 'desc' }],
    page: { size: 10 }
  }
});
```

## Template Patterns

### Conditional Rendering

```typescript
<template>
  {{#if @model.coverImage}}
    <img src={{@model.coverImage}} alt="" />
  {{/if}}

  {{#if (gt @model.items.length 0)}}
    {{#each @model.items as |item|}}
      <ItemCard @model={{item}} />
    {{/each}}
  {{else}}
    <p class="empty">No items yet.</p>
  {{/if}}
</template>
```

### Layout with Named Blocks

```typescript
// layout.gts
export class TwoColumnLayout extends Component {
  <template>
    <div class="layout">
      <aside>{{yield to="sidebar"}}</aside>
      <main>{{yield to="content"}}</main>
    </div>
  </template>
}

// Usage
<TwoColumnLayout>
  <:sidebar>
    <FilterPanel />
  </:sidebar>
  <:content>
    <@fields.items />
  </:content>
</TwoColumnLayout>
```

## Anti-Patterns to Avoid

### Don't Use `position: fixed`

Cards must stay within their container. Use `position: absolute` with a positioned parent instead.

### Don't Hardcode Realm URLs

```typescript
// ❌ Bad
import StringField from 'http://localhost:4201/base/string';

// ✅ Good
import StringField from 'https://cardstack.com/base/string';
```

### Don't Use `px` Units

```css
/* ❌ Bad */
.card { padding: 16px; font-size: 14px; }

/* ✅ Good */
.card { padding: var(--boxel-sp); font-size: var(--boxel-font-size); }
```

### Don't Skip Error Handling in Computed Fields

```typescript
// ❌ Risky
computeVia: function() { return this.items.length; }

// ✅ Safe
computeVia: function() { return this.items?.length ?? 0; }
```

## Performance Patterns

### Lazy Loading with linksTo

`linksTo` fields load lazily — the referenced card is fetched only when accessed. This is automatically handled by the `NotLoadedValue` pattern.

### Pagination in Queries

Always use pagination for large result sets:

```typescript
@field items = linksToMany(() => Item, {
  query: {
    filter: { ... },
    page: { size: 25 }
  }
});
```

### Container Queries over Media Queries

Use `@container` queries (not `@media`) for responsive cards. Cards don't know their viewport — they only know their container size.

## Next Steps

- [Building a CRM](/tutorials/building-a-crm) — Complete tutorial
- [Defining Cards](/card-development/defining-cards) — Card reference
- [Styling Cards](/card-development/styling) — CSS guide
