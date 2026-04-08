# Introduction to Boxel

## What is Boxel?

**Boxel** is a runtime platform for building and deploying **cards** — modular, interactive components that unify data, UI, and behavior into a single composable unit. Think of cards as smart documents that can be created, linked, searched, rendered in multiple formats, and operated on by both humans and AI agents.

Boxel is not just a UI framework. It is a **full-stack application runtime** that includes:

- A **card definition system** with a rich type hierarchy, inheritance, and relationships
- A **realm server** that stores, indexes, and serves cards via HTTP
- A **host application** providing a rich IDE-like development environment
- An **AI integration layer** built on the Matrix protocol for agent-card interaction
- **Developer tools** including a CLI, VS Code extension, and custom linting

## Why Boxel?

Traditional web applications separate data models, API endpoints, and UI components across multiple layers. Boxel collapses these into **cards** — self-describing entities that carry their own schema, rendering templates, and behavior.

### The Card Paradigm

```
┌─────────────────────────────────────┐
│              Card                     │
│                                       │
│  📋 Schema    — Fields & types        │
│  🎨 Templates — Multiple render modes │
│  🔗 Relations — Links to other cards  │
│  ⚡ Behavior  — Computed fields,      │
│                 commands              │
│  📦 Data      — Serialized as JSON    │
│  🔍 Indexed   — Searchable & queryable│
└─────────────────────────────────────┘
```

### Key Benefits

| Feature | Description |
|---------|-------------|
| **Composability** | Cards contain and link to other cards, forming rich object graphs |
| **Multi-format rendering** | One card definition renders as full page, embed, thumbnail, editor, or chip |
| **Type-safe inheritance** | Cards extend other cards with full TypeScript support |
| **AI-native** | Cards are structured data that AI agents can read, create, and modify |
| **Real-time** | Built on Matrix protocol for live collaboration and event broadcasting |
| **Federated search** | Query across multiple realms with a powerful filter/sort API |
| **Developer experience** | Hot reload, VS Code integration, visual debugging |

## How It Works — High Level

```
Developer defines cards (.gts files)
        ↓
Cards stored in a Realm (file system)
        ↓
Realm Server indexes & serves cards
        ↓
Host App renders cards in browser
        ↓
AI agents interact via Matrix + Skills
```

### 1. Define a Card

Cards are defined as TypeScript/Glimmer classes in `.gts` files:

```typescript
import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { Component } from 'https://cardstack.com/base/card-api';

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';

  @field title = contains(StringField);
  @field body = contains(StringField);
  @field author = contains(StringField);

  static isolated = class Isolated extends Component<typeof BlogPost> {
    <template>
      <article>
        <h1><@fields.title /></h1>
        <p class="author">By <@fields.author /></p>
        <div class="body"><@fields.body /></div>
      </article>
    </template>
  };
}
```

### 2. Create Instances

Card instances are JSON documents:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "title": "Hello World",
      "body": "Welcome to Boxel!",
      "author": "Alice"
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

### 3. Query and Render

Cards are automatically indexed and searchable:

```typescript
const results = await search({
  filter: {
    type: { module: './blog-post', name: 'BlogPost' },
    eq: { author: 'Alice' }
  },
  sort: [{ by: 'title', direction: 'asc' }]
});
```

## Platform Components

| Component | Purpose |
|-----------|---------|
| **Host App** | Ember.js web application — the primary UI for creating and viewing cards |
| **Realm Server** | Node.js HTTP server — stores, indexes, and serves cards |
| **Runtime Common** | Shared card runtime — serialization, module loading, query engine |
| **Base Package** | Core card and field definitions — the foundation of the type system |
| **AI Bot** | Matrix-based AI agent — processes commands and generates cards |
| **Boxel UI** | Ember component library — reusable UI building blocks |
| **Boxel CLI** | Command-line tool — workspace sync, profile management |
| **VS Code Extension** | IDE integration — browse workspaces, sync files, load skills |

## Who Is This For?

- **Application developers** who want to build data-driven applications with a composable architecture
- **AI engineers** who want to create structured, agent-operable interfaces
- **Product teams** who need a flexible, extensible platform for domain-specific tools
- **Contributors** who want to understand and extend the Boxel platform itself

## Next Steps

- [Quick Start](/guide/quick-start) — Get Boxel running in minutes
- [Cards & Fields](/core-concepts/cards-and-fields) — Understand the fundamental building blocks
- [Your First Card](/guide/first-card) — Build your first card step by step
- [Architecture](/architecture/system-overview) — Deep dive into how Boxel works
