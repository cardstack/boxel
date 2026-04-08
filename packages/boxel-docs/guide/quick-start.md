# Quick Start

Get Boxel up and running locally in minutes.

## Prerequisites

- **Node.js 20+** (managed via [mise](https://mise.jdx.dev/))
- **pnpm** (managed via mise)
- **Docker** (for PostgreSQL and Matrix services)
- **Git**

## 1. Clone and Install

```bash
git clone https://github.com/cardstack/boxel.git
cd boxel

# Install tool versions (Node.js, pnpm)
mise install

# Install all dependencies
pnpm install
```

## 2. Build Core Packages

```bash
# Build the Boxel UI addon
cd packages/boxel-ui/addon
pnpm build
cd ../../..

# Rebuild icons
cd packages/boxel-icons
pnpm rebuild
cd ../..

# Build the host application
cd packages/host
pnpm build
cd ../..
```

## 3. Start Services

The simplest way to start all services:

```bash
cd packages/realm-server
DISABLE_MODULE_CACHING=true pnpm start:all
```

This starts:
- **PostgreSQL** on port 5435
- **Matrix Synapse** on port 8008
- **Realm Server** on port 4201
- **Host App** on port 4200

## 4. Register Users

Register Matrix users for development:

```bash
# Register admin user
cd packages/matrix
node scripts/register-user.js admin admin123

# Register a test user
node scripts/register-user.js testuser testpass123
```

## 5. Access the App

Open your browser to **http://localhost:4201/**

1. Register an account using your Matrix credentials
2. Validate your email (check the mail UI at http://localhost:5001)
3. You're ready to create cards!

## Alternative: Using mise Tasks

For a more granular setup, use the mise task system:

```bash
# Start infrastructure only
mise run start:pg          # PostgreSQL
mise run start:synapse     # Matrix Synapse
mise run start:smtp        # SMTP server

# Start application services
mise run start:realm       # Realm server
mise run start:host        # Host application

# Or start everything at once
mise run dev
```

## Development Mode with Hot Reload

For active development with live reload:

```bash
# Start with module caching disabled (picks up code changes)
DISABLE_MODULE_CACHING=true mise run dev
```

## Verify Installation

After starting services, verify everything works:

| Service | URL | Expected |
|---------|-----|----------|
| Host App | http://localhost:4200 | Boxel login/workspace screen |
| Realm Server | http://localhost:4201 | Card content |
| Matrix Admin | http://localhost:8080 | Synapse admin console |
| Mail UI | http://localhost:5001 | SMTP testing interface |
| PostgreSQL | localhost:5435 | Database connection |

## Next Steps

- [Your First Card](/guide/first-card) — Create a card from scratch
- [Project Structure](/guide/project-structure) — Understand the monorepo layout
- [Installation & Setup](/guide/installation) — Detailed setup instructions
