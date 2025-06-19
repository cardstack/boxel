# Realm Sync CLI

CLI tools for syncing files between local directories and Boxel realms.

## Installation

### Global Installation (Recommended)

```bash
npm install -g @cardstack/realm-sync-cli
```

### Per-project Installation

```bash
npm install @cardstack/realm-sync-cli
npx realm-push --help
npx realm-pull --help
```

### Development Installation

```bash
git clone https://github.com/cardstack/boxel.git
cd boxel/packages/realm-sync-cli
pnpm install
pnpm build
```

## Authentication

Both commands require Matrix credentials to authenticate with the realm:

```bash
export MATRIX_URL="https://matrix.cardstack.com"
export MATRIX_USERNAME="your-username"
export MATRIX_PASSWORD="your-password"
```

## Usage

### Push (Local → Realm)

Uploads files from a local directory to a realm.

```bash
realm-push <LOCAL_DIR> <REALM_URL> [OPTIONS]
```

**Arguments:**

- `LOCAL_DIR` - The local directory containing files to sync
- `REALM_URL` - The URL of the target realm (e.g., https://demo.cardstack.com/demo/)

**Options:**

- `--delete` - Delete remote files that don't exist locally
- `--dry-run` - Show what would be done without making changes
- `--help, -h` - Show help message

**Examples:**

```bash
realm-push ./my-cards https://demo.cardstack.com/demo/
realm-push ./my-cards https://demo.cardstack.com/demo/ --delete --dry-run
```

### Pull (Realm → Local)

Downloads files from a realm to a local directory.

```bash
realm-pull <REALM_URL> <LOCAL_DIR> [OPTIONS]
```

**Arguments:**

- `REALM_URL` - The URL of the source realm (e.g., https://demo.cardstack.com/demo/)
- `LOCAL_DIR` - The local directory to sync files to

**Options:**

- `--delete` - Delete local files that don't exist in the realm
- `--dry-run` - Show what would be done without making changes
- `--help, -h` - Show help message

**Examples:**

```bash
realm-pull https://demo.cardstack.com/demo/ ./my-cards
realm-pull https://demo.cardstack.com/demo/ ./my-cards --delete --dry-run
```

## File Filtering

The sync commands automatically filter files based on several criteria to avoid syncing unwanted content:

### Automatic Filtering

- **Dotfiles**: All files and directories starting with a dot (`.`) are automatically ignored
  - Examples: `.DS_Store`, `.env`, `.git/`, `.vscode/`

### Gitignore Support

- **`.gitignore` files**: Standard gitignore patterns are respected
- **Hierarchical**: Checks for `.gitignore` files in current directory and all parent directories
- **Standard patterns**: Supports all gitignore pattern syntax (wildcards, negation, etc.)

### Boxelignore Support

- **`.boxelignore` files**: Realm-specific ignore patterns (same syntax as `.gitignore`)
- **Use case**: Exclude files from realm sync while keeping them in git
- **Priority**: Applied in addition to `.gitignore` patterns
- **Hierarchical**: Works the same way as `.gitignore` files

### Example Ignore Files

**`.gitignore`** (standard git ignoring):

```
node_modules/
*.log
.env
```

**`.boxelignore`** (realm-specific ignoring):

```
# Keep in git but exclude from realm
docs/
test-data/
*.draft.gts
development-cards/
```

### Filtering Behavior

1. Files starting with `.` are always ignored
2. Files matching any pattern in `.gitignore` are ignored
3. Files matching any pattern in `.boxelignore` are ignored
4. Remaining files are synced

This allows fine-grained control over what gets synced to realms while maintaining your git repository structure.

## Development

### Building

```bash
# Build bundled executables
pnpm build

# Build with watch mode for development
pnpm build:watch

# Clean build artifacts
pnpm clean

# Clean rebuild
pnpm rebuild

# Analyze bundle size and dependencies
pnpm build:analyze
```

### Development Scripts

```bash
pnpm push <LOCAL_DIR> <REALM_URL> [OPTIONS]
pnpm pull <REALM_URL> <LOCAL_DIR> [OPTIONS]
```

### Testing

```bash
# Run all tests (lint + build)
pnpm test

# Test built executables
pnpm test:built

# Test global installation
pnpm test:install

# Type checking
pnpm type-check
pnpm type-check:watch
```

### Code Quality

```bash
# Linting
pnpm lint
pnpm lint:fix
```

### Publishing

```bash
# Version bumping
pnpm version:patch  # 0.1.0 -> 0.1.1
pnpm version:minor  # 0.1.0 -> 0.2.0
pnpm version:major  # 0.1.0 -> 1.0.0

# Publishing
pnpm publish:dry    # Dry run to see what would be published
pnpm publish:npm    # Publish to npm registry
```

### Testing Built Version

```bash
# Build and test locally
pnpm build
node dist/push.js --help
node dist/pull.js --help

# Test as installed package
npm pack
npm install -g ./cardstack-realm-sync-cli-0.1.0.tgz
realm-push --help
```

## Features

- **Bundled executables** - Single-file binaries with all dependencies included
- **Zero dependencies** - No need to install additional packages
- **Cross-platform** - Works on Windows, macOS, and Linux
- **Recursive directory syncing** - Handles nested folder structures
- **Smart file filtering** - Respects `.gitignore` and `.boxelignore` patterns, skips dotfiles
- **Safe authentication** - Tests realm access before destructive operations
- **Detailed logging** - Clear feedback on all operations
- **Dry-run mode** - Preview changes without making them
- **Robust URL handling** - Works with or without trailing slashes

## Architecture

The package uses esbuild to create standalone executables that bundle all dependencies:

- **`realm-push`** - Standalone executable for uploading files to realms
- **`realm-pull`** - Standalone executable for downloading files from realms
- **Library API** - Programmatic access via `@cardstack/realm-sync-cli`

### Components

- `RealmSyncBase` - Abstract base class with common sync functionality
- `RealmPusher` - Implements push (local → realm) synchronization
- `RealmPuller` - Implements pull (realm → local) synchronization

Authentication is handled through the bundled `@cardstack/runtime-common` package using Matrix credentials.

## Requirements

- Node.js 18 or higher
- Matrix account with realm access permissions

## License

MIT
