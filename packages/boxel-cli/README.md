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
- `BOXEL_ENVIRONMENT` — env-mode slug (typically a branch name) for per-branch local dev. Interpreted like `scripts/env-slug.sh`: the value is slugified (lowercased, `/` → `-`, other chars stripped) and URLs are derived as `http://matrix.<slug>.localhost` and `http://realm-server.<slug>.localhost/`. Overridden by `--matrix-url` / `--realm-server-url` if those flags are provided. Values that slugify to empty (e.g. `!!!`) exit with an error.

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
```

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
