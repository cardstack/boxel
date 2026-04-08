# Installation & Setup

This guide covers the complete development environment setup for Boxel, including all services, database configuration, and optional components.

## System Requirements

| Requirement | Version | Purpose |
|-------------|---------|---------|
| Node.js | 20+ | Runtime |
| pnpm | 9+ | Package manager |
| Docker | Latest | PostgreSQL, Matrix, SMTP |
| mise | Latest | Tool version management |
| Git | 2.30+ | Source control |

## Tool Management with mise

Boxel uses [mise](https://mise.jdx.dev/) to manage tool versions. The `.mise.toml` file in the repo root pins exact versions:

```bash
# Install mise (macOS)
brew install mise

# Install mise (Linux)
curl https://mise.jdx.dev/install.sh | sh

# Install pinned tool versions
mise install
```

This installs the correct Node.js and pnpm versions automatically.

## Dependency Installation

```bash
# Install all workspace packages
pnpm install
```

The monorepo uses pnpm workspaces. All 27 packages are linked together.

## Database Setup

### PostgreSQL

Boxel uses PostgreSQL for card indexing, job queues, user management, and billing.

```bash
# Start PostgreSQL via Docker
docker run -d \
  --name boxel-pg \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=boxel \
  -p 5435:5432 \
  postgres:16

# Run migrations
cd packages/postgres
pnpm migrate up
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `PGHOST` | `localhost` | Database host |
| `PGPORT` | `5435` | Database port |
| `PGUSER` | `postgres` | Database user |
| `PGPASSWORD` | `postgres` | Database password |
| `PGDATABASE` | `boxel` | Database name |

### SQLite (Browser)

For in-browser card indexing during development, Boxel uses SQLite via WASM. The schema is auto-generated from the PostgreSQL schema.

## Matrix Server Setup

Boxel uses [Matrix](https://matrix.org/) (Synapse) for real-time collaboration, authentication, and AI agent communication.

```bash
# Start Synapse via Docker
cd packages/matrix
docker-compose up -d

# Register admin user
node scripts/register-user.js admin admin123
```

**Default ports:**

| Service | Port |
|---------|------|
| Synapse | 8008 |
| Admin Console | 8080 |
| SMTP (smtp4dev) | 5001 |

## Building Packages

Build the core packages in order:

```bash
# 1. Build Boxel UI components
cd packages/boxel-ui/addon && pnpm build && cd ../../..

# 2. Build icon library
cd packages/boxel-icons && pnpm rebuild && cd ../..

# 3. Build host application
cd packages/host && pnpm build && cd ../..
```

## Running the Development Server

### Option 1: Full Stack (Recommended)

```bash
cd packages/realm-server
DISABLE_MODULE_CACHING=true pnpm start:all
```

### Option 2: mise Tasks

```bash
# Start everything
mise run dev

# Or start services individually
mise run start:pg
mise run start:synapse
mise run start:smtp
mise run start:realm
mise run start:host
```

### Option 3: Against Staging

Connect to the staging environment instead of running services locally:

```bash
scripts/start-host.sh staging
```

## Environment Variables

### Core Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DISABLE_MODULE_CACHING` | Live reload for card modules | `false` |
| `HOST_URL` | Override host app URL | `http://localhost:4200` |
| `BOXEL_ENVIRONMENT` | Environment slug | — |
| `REALM_SERVER_SECRET_SEED` | JWT secret for realm auth | — |

### Scaling Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PRERENDER_COUNT` | Number of prerender servers | `1` |
| `WORKER_HIGH_PRIORITY_COUNT` | High-priority workers | `1` |
| `WORKER_ALL_PRIORITY_COUNT` | All-priority workers | `1` |
| `FROM_SCRATCH_JOB_TIMEOUT_SEC` | Indexing timeout (seconds) | `3600` |
| `PG_POOL_MAX` | Max PostgreSQL connections | — |

### Feature Flags

| Variable | Description | Default |
|----------|-------------|---------|
| `SKIP_CATALOG` | Skip catalog realm initialization | `false` |
| `BOXEL_TURBO` | High-parallelism development mode | `false` |

## Port Assignments

| Port | Service |
|------|---------|
| 4200 | Host app (ember-cli) |
| 4201 | Realm server (base realm) |
| 4202 | Test realms |
| 4205 | Isolated realm server (matrix tests) |
| 4206 | Boxel icons HTTP server |
| 4210 | Development Worker Manager |
| 4220 | Boxel UI component explorer |
| 4221 | Prerender server |
| 4222 | Prerender manager |
| 5001 | Mail UI (SMTP) |
| 5435 | PostgreSQL |
| 8008 | Matrix Synapse |
| 8080 | Matrix admin console |

## Verifying the Setup

```bash
# Check all services are running
curl http://localhost:4201/  # Realm server
curl http://localhost:4200/  # Host app (if running separately)

# Check database
psql -h localhost -p 5435 -U postgres -d boxel -c "SELECT count(*) FROM boxel_index;"

# Check Matrix
curl http://localhost:8008/_matrix/client/versions
```

## Optional: Payment Setup

For billing features, configure Stripe:

```bash
export STRIPE_API_KEY=sk_test_...
export STRIPE_WEBHOOK_SECRET=whsec_...
```

## Optional: AI Bot

To run the AI assistant:

```bash
cd packages/ai-bot
pnpm start
```

Requires OpenAI/OpenRouter API key configuration.

## Troubleshooting

### Common Issues

**Port conflicts**: Check if services are already running on the required ports.

```bash
lsof -i :4201  # Check realm server port
```

**Docker not running**: Ensure Docker daemon is started.

```bash
docker info  # Should show Docker details
```

**Database connection failures**: Verify PostgreSQL is accepting connections.

```bash
pg_isready -h localhost -p 5435
```

**Missing dependencies**: Re-run install after pulling changes.

```bash
pnpm install
```

## Next Steps

- [Your First Card](/guide/first-card) — Create your first card
- [Project Structure](/guide/project-structure) — Navigate the monorepo
- [System Overview](/architecture/system-overview) — Understand the architecture
