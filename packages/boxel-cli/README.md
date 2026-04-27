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

The linked command automatically uses `dist/index.js` if built, or falls back to running TypeScript source via `ts-node`.

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
2. **Dev stack running** — host app on `:4200` and base realm on
   `:4201/base/`. Some integration tests (currently `search.test.ts`)
   pass `useRealPrerenderer: true` to `startTestRealmServer()` so card
   indexing exercises the real Chrome prerenderer. Without the dev
   stack up, those tests fail their `beforeAll` with a clear
   "host unreachable" message; the rest of the suite still passes
   with a noop prerenderer.

   Start the dev stack from `packages/realm-server/`:

   ```bash
   mise run test-services:matrix
   ```

   This brings up the host dist, base realm, prerender service,
   prerender manager, icons, worker-base, and dev Postgres — the
   minimum needed for real card indexing. Leave it running in another
   terminal and then run `pnpm test:integration` from
   `packages/boxel-cli/`.

   Alternatively, `pnpm start` from the repo root brings up the full
   dev stack and works equivalently.

In CI, the `boxel-cli-test` job runs `mise run test-services:matrix`
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
