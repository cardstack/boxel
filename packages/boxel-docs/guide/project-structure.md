# Project Structure

Boxel is organized as a pnpm monorepo with 27 packages spanning the full stack — from core runtime to UI components to developer tools.

## Repository Layout

```
boxel/
├── packages/
│   ├── host/                    # Main Ember.js web application
│   ├── realm-server/            # Node.js card server
│   ├── runtime-common/          # Shared card runtime
│   ├── base/                    # Core card & field definitions
│   │
│   ├── boxel-ui/                # UI component library
│   │   ├── addon/               # Ember addon source
│   │   └── test-app/            # Component explorer
│   ├── boxel-icons/             # Icon component library
│   ├── boxel-motion/            # Animation library
│   │
│   ├── catalog-realm/           # Production card catalog
│   ├── catalog/                 # External catalog (future)
│   ├── experiments-realm/       # Example & experimental cards
│   ├── skills-realm/            # AI skill cards
│   ├── openrouter-realm/        # AI model definitions
│   ├── boxel-homepage-realm/    # Landing page cards
│   │
│   ├── ai-bot/                  # Matrix AI bot service
│   ├── bot-runner/              # Bot execution framework
│   ├── matrix/                  # Matrix/Synapse configuration
│   │
│   ├── postgres/                # Database migrations & utils
│   ├── billing/                 # Stripe integration
│   │
│   ├── boxel-cli/               # CLI tools
│   ├── vscode-boxel-tools/      # VS Code extension
│   ├── eslint-plugin-boxel/     # Custom ESLint rules
│   ├── eslint-plugin-cardstack-host/
│   ├── template-lint/           # Template linting rules
│   │
│   ├── software-factory/        # Internal tooling
│   ├── workspace-sync-cli/      # Legacy sync CLI
│   └── local-types/             # Shared TypeScript types
│
├── docs/                        # Internal documentation
├── scripts/                     # Development scripts
├── mise-tasks/                  # mise task definitions
├── vendor/                      # Custom vendor packages
│
├── .mise.toml                   # Tool version pinning
├── pnpm-workspace.yaml          # Workspace configuration
├── package.json                 # Root package
└── README.md                    # Setup guide
```

## Package Categories

### Core Runtime

These packages form the heart of Boxel:

| Package | Description |
|---------|-------------|
| **`base`** | Defines `CardDef`, `FieldDef`, all built-in field types, the card API, and default templates. This is the foundation every card builds upon. |
| **`runtime-common`** | Shared utilities for card serialization, module loading, query execution, Babel transforms, and the indexing engine. Used by both server and browser. |
| **`host`** | The main Ember.js application. Provides Operator Mode (development IDE), Host Mode (published card viewing), card rendering, and Matrix integration. |
| **`realm-server`** | Node.js/Koa HTTP server. Stores cards in the file system, indexes them in PostgreSQL, serves them via content negotiation, and manages authentication. |

### UI Layer

| Package | Description |
|---------|-------------|
| **`boxel-ui`** | Ember addon with reusable Glimmer components — buttons, inputs, cards, modals, etc. Has a component explorer at port 4220. |
| **`boxel-icons`** | Code-generated icon components from SVG files. Rollup-based v2 addon. |
| **`boxel-motion`** | Animation library with sprite management and context-based transitions. |

### Card Realms

Realms are directories of card definitions and instances:

| Realm | Description |
|-------|-------------|
| **`base`** | Core card types — always loaded first. Contains `CardDef`, `FieldDef`, `StringField`, `NumberField`, etc. |
| **`catalog-realm`** | Production catalog with real-world cards — CRM, blog, playlists, and 130+ other card types. |
| **`experiments-realm`** | Experimental cards for testing new features and patterns. |
| **`skills-realm`** | AI skill cards that define behaviors for the AI assistant. |
| **`openrouter-realm`** | AI model configuration cards for OpenRouter integration. |

### Infrastructure

| Package | Description |
|---------|-------------|
| **`postgres`** | Database migrations (node-pg-migrate) and initialization scripts. |
| **`matrix`** | Docker setup for Synapse server, user registration, Playwright tests. |
| **`billing`** | Stripe subscription management and credit system. |
| **`ai-bot`** | Matrix client that processes AI commands via OpenAI/OpenRouter. |

### Developer Tools

| Package | Description |
|---------|-------------|
| **`boxel-cli`** | CLI for workspace sync (`boxel push/pull`), profile management. |
| **`vscode-boxel-tools`** | VS Code extension for browsing realms, syncing files, loading skills. |
| **`eslint-plugin-boxel`** | Custom rules for card development (no CSS `position: fixed`, no literal realm URLs, etc.). |

## Technology Stack

### Frontend
- **Ember.js 6.10** with Glimmer components
- **TypeScript** with `.gts` (Glimmer Template Syntax) files
- **Scoped CSS** via glimmer-scoped-css
- **Monaco Editor** for code editing
- **Embroider** (Ember build system)

### Backend
- **Node.js 20+** with TypeScript
- **Koa.js** HTTP framework
- **PostgreSQL 16** (primary database)
- **SQLite** via WASM (browser indexing)
- **Puppeteer** for server-side rendering

### Infrastructure
- **Docker** for PostgreSQL, Synapse, SMTP
- **Matrix/Synapse** for real-time messaging
- **Traefik** for reverse proxy (environment mode)
- **GitHub Actions** for CI/CD

## Build System

The monorepo uses **pnpm workspaces** with the following key tools:

- **pnpm** — Package management with workspace linking
- **mise** — Task runner and tool version management
- **Rollup** — Addon builds (boxel-ui, boxel-icons)
- **Embroider + Webpack** — Host app build
- **esbuild** — CLI and tool builds
- **Babel** — AST transforms for card compilation

## Configuration Files

| File | Purpose |
|------|---------|
| `.mise.toml` | Pinned Node.js and pnpm versions |
| `pnpm-workspace.yaml` | Package workspace definitions |
| `.eslintrc.js` | Global ESLint config |
| `.prettierrc.js` | Code formatting rules |
| `.mcp.json` | Model Context Protocol servers |

## Next Steps

- [System Overview](/architecture/system-overview) — How the pieces fit together
- [Runtime Architecture](/architecture/runtime) — Deep dive into the runtime
- [Realm Server API](/api-reference/realm-server-api) — HTTP API documentation
