# System Overview

Boxel is a full-stack platform with multiple interconnected services. This page maps how all the pieces fit together.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         User / AI Agent                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │     Host App         │
                    │   (Ember.js SPA)     │
                    │                      │
                    │  ┌────────────────┐  │
                    │  │ Operator Mode  │  │
                    │  │  - Interact    │  │
                    │  │  - Code        │  │
                    │  │  - Host        │  │
                    │  └────────────────┘  │
                    │  ┌────────────────┐  │
                    │  │ AI Assistant   │  │
                    │  │  Panel         │  │
                    │  └────────────────┘  │
                    └──────┬──────┬───────┘
                           │      │
              ┌────────────▼┐    ┌▼────────────┐
              │ Realm Server │    │  Matrix      │
              │  (Koa/Node)  │    │  (Synapse)   │
              │              │    │              │
              │ ┌──────────┐ │    │  Real-time   │
              │ │ Realms   │ │    │  messaging   │
              │ │ - Base   │ │    │  Auth/ID     │
              │ │ - Catalog│ │    └──────┬───────┘
              │ │ - User   │ │           │
              │ └──────────┘ │    ┌──────▼───────┐
              │ ┌──────────┐ │    │   AI Bot     │
              │ │ Workers  │ │    │  (OpenAI/    │
              │ │ - Index  │ │    │   OpenRouter) │
              │ │ - Queue  │ │    └──────────────┘
              │ └──────────┘ │
              │ ┌──────────┐ │
              │ │Prerender │ │
              │ │(Puppeteer)│ │
              │ └──────────┘ │
              └──────┬───────┘
                     │
              ┌──────▼───────┐
              │  PostgreSQL   │
              │              │
              │ - boxel_index│
              │ - modules    │
              │ - jobs       │
              │ - users      │
              │ - permissions│
              └──────────────┘
```

## Component Breakdown

### Host App (Frontend)

The **Host App** is an Ember.js single-page application that provides the primary user interface:

- **Operator Mode** — Development IDE with three submodes:
  - **Interact** — Browse and use cards in a stack-based UI
  - **Code** — Edit card definitions with Monaco editor
  - **Host** — View published realms
- **AI Assistant Panel** — Chat interface powered by Matrix
- **Card Rendering Engine** — Renders cards in all five formats
- **Store Service** — Client-side card caching and lifecycle management
- **38 Services** — Authentication, state management, file handling, etc.

**Technology**: Ember.js 6.10, Glimmer, TypeScript, Scoped CSS, Monaco Editor

### Realm Server (Backend)

The **Realm Server** is a Node.js/Koa HTTP server that manages card storage and serving:

- **Realm Management** — Create, delete, publish realms
- **Card CRUD** — Read, write, delete card files
- **Content Negotiation** — Serve cards as JSON, HTML, or executable modules
- **Indexing Engine** — Build searchable indexes via workers
- **Federated Search** — Query across multiple realms
- **Prerendering** — Server-side rendering via Puppeteer
- **Job Queue** — PostgreSQL-backed async task processing
- **Authentication** — JWT tokens with Matrix-based identity

**Technology**: Node.js, Koa.js, TypeScript, PostgreSQL, Puppeteer

### Matrix (Communication Layer)

**Matrix/Synapse** provides the real-time infrastructure:

- **Authentication** — User identity and session management
- **Event Broadcasting** — Realm changes broadcast as Matrix events
- **Chat** — AI assistant conversations in Matrix rooms
- **Session Rooms** — Per-realm rooms for real-time sync

**Technology**: Synapse (Python), matrix-js-sdk

### AI Bot

The **AI Bot** is a Matrix client that processes AI commands:

- **Message Processing** — Listens for user messages in Matrix rooms
- **LLM Integration** — Sends prompts to OpenAI/OpenRouter
- **Command Execution** — Executes card commands on behalf of users
- **Skill Cards** — Loads skill definitions for specialized behaviors

**Technology**: Node.js, matrix-js-sdk, OpenAI SDK

### PostgreSQL (Data Layer)

PostgreSQL stores all persistent data:

| Table | Purpose |
|-------|---------|
| `boxel_index` | Card index (search documents, HTML, metadata) |
| `modules` | Compiled module cache |
| `realm_versions` | Version tracking per realm |
| `realm_user_permissions` | Access control |
| `published_realms` | Publishing state |
| `jobs` / `queues` | Background job processing |
| `users` | User accounts |
| `subscriptions` | Billing plans |
| `credit_balance_events` | AI credit tracking |

## Data Flow

### Card Creation Flow

```
User creates card in Host App
    ↓
Host App sends PUT to Realm Server
    ↓
Realm Server writes .json file to disk
    ↓
File change triggers incremental index
    ↓
Worker processes index job
    ↓
Prerenderer generates HTML
    ↓
IndexWriter stores in PostgreSQL
    ↓
Matrix event broadcast to subscribers
    ↓
Host App receives event, updates UI
```

### Search Flow

```
User types search query
    ↓
Host App sends POST to /_federated-search
    ↓
Realm Server checks permissions for each realm
    ↓
Query engine translates to SQL
    ↓
PostgreSQL executes against boxel_index
    ↓
Results combined and returned as JSON-API
    ↓
Host App renders results
```

### AI Interaction Flow

```
User sends message in AI Assistant
    ↓
Message sent to Matrix room
    ↓
AI Bot receives message
    ↓
Bot sends prompt to LLM (OpenAI/OpenRouter)
    ↓
LLM responds with text or command requests
    ↓
Bot executes commands (create/modify cards)
    ↓
Results posted back to Matrix room
    ↓
Host App displays response
```

## Service Dependencies

```
Host App
  ├── depends on → Realm Server (cards, modules)
  ├── depends on → Matrix (auth, messaging)
  └── depends on → PostgreSQL (via Realm Server)

Realm Server
  ├── depends on → PostgreSQL (storage, indexing)
  ├── depends on → Matrix (events, auth tokens)
  └── depends on → Prerender (HTML generation)

AI Bot
  ├── depends on → Matrix (messaging)
  ├── depends on → OpenAI/OpenRouter (LLM)
  └── depends on → Realm Server (card operations)
```

## Deployment Modes

| Mode | Description |
|------|-------------|
| **Development** | All services local, hot reload, file watching |
| **Staging** | AWS S3 distribution, staging infrastructure |
| **Production** | CloudFront + S3, production infrastructure |
| **Environment Mode** | Parallel environments with Traefik reverse proxy |

## Next Steps

- [Runtime Architecture](/architecture/runtime) — Deep dive into the runtime
- [Card Lifecycle](/architecture/card-lifecycle) — A card's journey through the system
- [Data Flow](/architecture/data-flow) — Detailed data flow analysis
