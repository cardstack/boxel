# Workspace Sync CLI

CLI tools for syncing files between local directories and Boxel workspaces.

## Installation

### Global Installation (Recommended)

```bash
npm install -g @cardstack/workspace-sync-cli
```

### Per-project Installation

```bash
npm install @cardstack/workspace-sync-cli
npx workspace-push --help
npx workspace-pull --help
```

### Development Installation

```bash
git clone https://github.com/cardstack/boxel.git
cd boxel/packages/realm-sync-cli
pnpm install
pnpm package
npm install -g ...
```

## Authentication

Both commands require Matrix credentials to authenticate with the workspace:

```bash
export MATRIX_URL="https://matrix.boxel.ai"
export MATRIX_USERNAME="your-username"
export MATRIX_PASSWORD="your-password"

# Optionally you can provide the realm's secret seed and the CLI will derive
# the matrix credentials from the workspace URL:
#   /<owner>/<endpoint>/  -> realm/<owner>_<endpoint>
#   /base/, /skills/, ... -> <slug>_realm
#   /published/<id>/      -> realm/published_<id>
export REALM_SECRET_SEED="super-secret-seed"
```

## Usage

### Push (Local → Workspace)

Uploads files from a local directory to a workspace.

```bash
workspace-push <LOCAL_DIR> <WORKSPACE_URL> [OPTIONS]
```

**Arguments:**

- `LOCAL_DIR` - The local directory containing files to sync
- `WORKSPACE_URL` - The URL of the target workspace (e.g., https://app.boxel.ai/demo/)

**Options:**

- `--delete` - Delete remote files that don't exist locally
- `--dry-run` - Show what would be done without making changes
- `--help, -h` - Show help message

**Examples:**

```bash
workspace-push ./my-cards https://app.boxel.ai/demo/
workspace-push ./my-cards https://app.boxel.ai/demo/ --delete --dry-run
```

### Pull (Workspace → Local)

Downloads files from a workspace to a local directory.

```bash
workspace-pull <WORKSPACE_URL> <LOCAL_DIR> [OPTIONS]
```

**Arguments:**

- `WORKSPACE_URL` - The URL of the source workspace (e.g., https://app.boxel.ai/demo/)
- `LOCAL_DIR` - The local directory to sync files to

**Options:**

- `--delete` - Delete local files that don't exist in the workspace
- `--dry-run` - Show what would be done without making changes
- `--help, -h` - Show help message

**Examples:**

```bash
workspace-pull https://app.boxel.ai/demo/ ./my-cards
workspace-pull https://app.boxel.ai/demo/ ./my-cards --delete --dry-run
```

## File Filtering

The sync commands automatically filter files based on several criteria to avoid syncing unwanted content:

### Automatic Filtering

- **Dotfiles**: All files and directories starting with a dot (`.`) are automatically ignored
  - Examples: `.DS_Store`, `.env`, `.git/`, `.vscode/`
- **`.gitignore` files**: Standard gitignore patterns are respected
- **Hierarchical**: Checks for `.gitignore` files in current directory and all parent directories
- **Standard patterns**: Supports all gitignore pattern syntax (wildcards, negation, etc.)

### Boxelignore Support

- **`.boxelignore` files**: Workspace-specific ignore patterns (same syntax as `.gitignore`)
- **Use case**: Exclude files from workspace sync while keeping them in git
- **Priority**: Applied in addition to `.gitignore` patterns
- **Hierarchical**: Works the same way as `.gitignore` files

### Example Ignore Files

**`.gitignore`** (standard git ignoring):

```
node_modules/
*.log
.env
```

**`.boxelignore`** (workspace-specific ignoring):

```
# Keep in git but exclude from workspace
docs/
test-data/
*.draft.gts
development-cards/
```

## Development

### Building

```bash
# Clean and build bundled executables
pnpm build
```

### Development Scripts

```bash
pnpm push <LOCAL_DIR> <WORKSPACE_URL> [OPTIONS]
pnpm pull <WORKSPACE_URL> <LOCAL_DIR> [OPTIONS]
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
workspace-push --help
```

## Features

- **Bundled executables** - Single-file binaries with all dependencies included
- **Recursive directory syncing** - Handles nested folder structures
- **Smart file filtering** - Respects `.gitignore` and `.boxelignore` patterns, skips dotfiles
- **Safe authentication** - Tests workspace access before destructive operations
- **Detailed logging** - Clear feedback on all operations
- **Dry-run mode** - Preview changes without making them

## Architecture

The package uses esbuild to create standalone executables that bundle all dependencies:

- **`workspace-push`** - Standalone executable for uploading files to workspaces
- **`workspace-pull`** - Standalone executable for downloading files from workspaces
- **Library API** - Programmatic access via `@cardstack/workspace-sync-cli`

### Components

- `WorkspaceSyncBase` - Abstract base class with common sync functionality
- `WorkspacePusher` - Implements push (local → workspace) synchronization
- `WorkspacePuller` - Implements pull (workspace → local) synchronization

Authentication is handled through the bundled `@cardstack/runtime-common` package using Matrix credentials.

## Requirements

- Node.js 18 or higher
- Matrix account with workspace access permissions

## License

MIT
