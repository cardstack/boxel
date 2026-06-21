# Boxel CLI

CLI tools for Boxel workspace management.

## Installation

### Global Installation (Recommended)

```bash
npm install -g @cardstack/boxel-cli
```

### Per-project Installation

```bash
npm install @cardstack/boxel-cli
npx boxel --help
```

### Development Installation

```bash
git clone https://github.com/cardstack/boxel.git
cd boxel/packages/boxel-cli
pnpm install
pnpm build
```

## Usage

```bash
boxel --help
boxel --version
```

### Environment variables

These are read by `boxel profile add`:

- `BOXEL_PASSWORD` — password for non-interactive profile creation. Preferred over `-p/--password`, which exposes the password in shell history and process listings.
- `BOXEL_ENVIRONMENT` — env-mode slug (typically a branch name) for per-branch local dev. Interpreted like `scripts/env-slug.sh`: the value is slugified (lowercased, `/` → `-`, other chars stripped) and URLs are derived as `https://matrix.<slug>.localhost` and `https://realm-server.<slug>.localhost/`. Overridden by `--matrix-url` / `--realm-server-url` if those flags are provided. Values that slugify to empty (e.g. `!!!`) exit with an error.

Example — create a profile for a branch running in env mode:

```bash
BOXEL_PASSWORD=… BOXEL_ENVIRONMENT=cs-10998-my-branch \
  boxel profile add -u @alice:cs-10998-my-branch.localhost
```

Example — create a profile against a custom realm server:

```bash
BOXEL_PASSWORD=… boxel profile add \
  -u @alice:my.server \
  --matrix-url https://matrix.my.server \
  --realm-server-url https://realms.my.server/
```

## Development

### Building

```bash
# Clean and build bundled executable
pnpm build
```

### Development Script

```bash
# Run from TypeScript source (no build step required)
pnpm start
```

### Local Development

Run directly from TypeScript source without building:

```bash
cd packages/boxel-cli
pnpm start -- <command> [args]

# Examples:
pnpm start -- --help
pnpm start -- sync .
pnpm start -- profile list
```

No build step needed — changes to source are reflected immediately.

### Local Development with `npm link`

To use the `boxel` command globally during development:

```bash
# From packages/boxel-cli
npm link

# Now you can use `boxel` anywhere — no build required
boxel --help
boxel sync .
```

The linked command runs `dist/index.js`, so build the CLI first (`pnpm --filter @cardstack/boxel-cli build`). The TypeScript source isn't run directly.

To unlink:

```bash
npm unlink -g @cardstack/boxel-cli
```

### Code Quality

```bash
# Linting
pnpm lint
pnpm lint:fix

# Type checking
pnpm lint:types
```

### Testing

```bash
# Run tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run integration tests
pnpm test:integration
```

#### Integration test prerequisites

`pnpm test:integration` requires:

1. **Docker** — for the test Postgres container (started automatically by
   the test runner script).
2. **Dev stack running** — host app on `:4200`, base realm on
   `:4201/base/`, prerender service on `:4221`, prerender manager on
   `:4222`, worker-base, and dev Postgres on `:5435`. Some integration
   tests (currently `search.test.ts`) pass `useRealPrerenderer: true`
   to `startTestRealmServer()` so card indexing exercises the real
   Chrome prerenderer. Without the dev stack up, those tests fail
   their `beforeAll` with a clear "host unreachable" message; the rest
   of the suite still passes with a noop prerenderer.

   The simplest way to start everything for local dev is from the
   repo root:

   ```bash
   mise run dev-all
   ```

   This starts the host app first, waits for it to be ready, then
   starts the realm server and supporting services (see the repo
   root README's "ember-cli Hosted App" section for details). Leave
   it running in another terminal, then run `pnpm test:integration`
   from `packages/boxel-cli/`.

   For a lighter setup (skips experiments / catalog / homepage /
   submission realms), use the two-step recipe instead:

   ```bash
   # in one terminal
   pnpm start                                  # from packages/host/

   # in another, after host is up
   mise run dev-minimal                        # from repo root
   ```

   To match CI exactly (production-style host serve, no live reload),
   build the host first and then run the matrix test-services task:

   ```bash
   # one-time, from repo root
   pnpm --filter @cardstack/host build

   # then, from packages/realm-server/
   mise run test-services:matrix
   ```

   `mise run test-services:matrix` brings up host-dist, base realm,
   prerender service, prerender manager, icons, worker-base, and dev
   Postgres — the minimum needed for real card indexing. It expects
   the host dist to already exist on disk; that's what the build step
   above (or the CI's `test-web-assets` artifact) provides.

In CI, the `boxel-cli-test` job downloads the pre-built `test-web-assets`
artifact (host + icons dist) and then runs `mise run test-services:matrix`
in the background before the integration suite (see
`.github/workflows/ci.yaml`).

### Publishing

```bash
# Version bumping
pnpm version:patch  # 0.0.1 -> 0.0.2
pnpm version:minor  # 0.0.1 -> 0.1.0
pnpm version:major  # 0.0.1 -> 1.0.0

# Publishing
pnpm publish:dry    # Dry run to see what would be published
pnpm publish:npm    # Publish to npm registry
```

### Testing Built Version

```bash
# Build and test locally
pnpm build
node dist/index.js --help

# Test as installed package
npm pack
npm install -g ./cardstack-boxel-cli-0.0.1.tgz
boxel --help
```

## Architecture

The package uses esbuild to create a standalone executable that bundles all dependencies:

- **`boxel`** - Standalone executable for Boxel workspace management

## Requirements

- Node.js 18 or higher

## License

MIT
