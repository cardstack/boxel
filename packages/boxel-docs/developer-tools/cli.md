# Boxel CLI

The Boxel CLI is a command-line tool for managing Boxel workspaces — syncing files between local directories and remote realms, managing profiles, and tracking changes.

## Installation

```bash
npm install -g @cardstack/boxel-cli
```

## Core Commands

### `boxel sync`

Interactively sync a local directory with a remote realm:

```bash
boxel sync ./my-workspace
```

This opens an interactive session that:
- Compares local and remote files
- Shows diffs for conflicts
- Lets you choose which version to keep
- Supports `--prefer-local`, `--prefer-remote`, or `--prefer-newest`

### `boxel push`

Push local changes to a remote realm:

```bash
boxel push ./my-workspace
```

Uploads all local changes to the remote realm.

### `boxel pull`

Pull remote changes to local:

```bash
boxel pull ./my-workspace
```

Downloads all changes from the remote realm to local.

### Sync Strategies

| Flag | Behavior |
|------|----------|
| `--prefer-local` | Local files always win conflicts |
| `--prefer-remote` | Remote files always win conflicts |
| `--prefer-newest` | Most recently modified version wins |
| (none) | Interactive conflict resolution |

## Profile Management

Manage connection profiles for different Boxel servers:

```bash
# List profiles
boxel profile list

# Set active profile
boxel profile use staging

# Add a new profile
boxel profile add production --url https://boxel.ai
```

## File Watching

### `boxel watch`

Monitor a local directory for changes:

```bash
# Watch with default interval
boxel watch ./my-workspace

# Watch with custom interval
boxel watch ./my-workspace --interval 5000
```

### `boxel track`

Track changes with automatic checkpointing:

```bash
# Track changes
boxel track ./my-workspace

# Track and auto-push
boxel track ./my-workspace --push
```

## Workspace Structure

When you sync a workspace, the CLI creates metadata files:

```
my-workspace/
├── .boxel-realm.json    # Realm metadata (URL, name, etc.)
├── card-definition.gts  # Card definitions
├── instances/
│   └── card-1.json      # Card instances
└── assets/
    └── image.png        # Static assets
```

### `.boxel-realm.json`

```json
{
  "realmUrl": "https://my-workspace.boxel.ai/",
  "name": "My Workspace",
  "lastSynced": "2024-03-15T10:30:00Z"
}
```

## Workflow

### Development Workflow

```bash
# 1. Pull the latest from remote
boxel pull ./my-workspace

# 2. Make local changes (edit .gts/.json files)
# ... edit files ...

# 3. Push changes back
boxel push ./my-workspace

# Or: Watch for changes and auto-sync
boxel track ./my-workspace --push
```

### Team Workflow

```bash
# Alice pushes her changes
boxel push ./workspace --prefer-local

# Bob pulls latest
boxel pull ./workspace

# Conflict resolution
boxel sync ./workspace  # Interactive mode
```

## Next Steps

- [VS Code Extension](/developer-tools/vscode-extension) — IDE integration
- [ESLint Plugin](/developer-tools/eslint-plugin) — Linting rules
- [Realms](/core-concepts/realms) — How realms work
