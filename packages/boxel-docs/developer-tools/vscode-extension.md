# VS Code Extension

**Boxel Tools** is a VS Code extension for browsing, editing, and syncing Boxel workspaces directly from your IDE.

## Installation

Search for **"Boxel Tools"** in the VS Code Marketplace, or install from the command line:

```bash
code --install-extension cardstack.vscode-boxel-tools
```

## Features

### Workspace Browser

Browse and manage your Boxel realms:

- **Realm Tree View** — See all connected workspaces
- **File Watching** — Monitor remote changes
- **Push/Pull** — Sync files to and from realms

### Skills Integration (Cursor IDE)

Load AI skills for Cursor IDE integration:

- **Skills Panel** — Browse available skills from all realms
- **Checkbox Selection** — Activate/deactivate skills
- **`.cursorrules` Generation** — Auto-generate rules for Cursor

### Matrix Authentication

Authenticate against your Boxel server:

- **Login/Logout** — Matrix Synapse authentication
- **Session Management** — Persistent sessions
- **Multi-profile** — Support for staging/production

## Configuration

### Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `boxel-tools.matrixServer` | `https://matrix.boxel.ai/` | Matrix server URL |
| `boxel-tools.localStoragePath` | Extension storage | Local workspace storage path |

### Commands

Access these via the Command Palette (`Ctrl/Cmd + Shift + P`):

| Command | Description |
|---------|-------------|
| `Boxel Tools: Login` | Authenticate with Matrix |
| `Boxel Tools: Logout` | Clear authentication |
| `Boxel Tools: Sync from Remote` | Discover remote workspaces |
| `Boxel Tools: Pull from Remote` | Fetch workspace metadata |
| `Boxel Tools: Push Workspace` | Upload local changes |
| `Boxel Tools: Pull Workspace` | Download remote changes |
| `Boxel Tools: Enable File Watching` | Start watching for changes |
| `Boxel Tools: Disable File Watching` | Stop watching |
| `Boxel Tools: Check Connection` | Test Matrix server connectivity |

## Getting Started

### 1. Login

1. Open Command Palette → `Boxel Tools: Login`
2. Enter your Matrix credentials
3. The extension authenticates against Synapse

### 2. Discover Workspaces

1. Run `Boxel Tools: Sync from Remote`
2. The extension queries Matrix account data for realm URLs
3. Available workspaces appear in the Realm tree view

### 3. Add to Workspace

1. Select realms in the tree view
2. Run `Boxel Tools: Add Realms to Workspace`
3. Realm folders are added to your VS Code workspace

### 4. Edit and Sync

1. Edit `.gts` and `.json` files locally
2. Push changes: `Boxel Tools: Push Workspace`
3. Pull updates: `Boxel Tools: Pull Workspace`

## Skills for Cursor

### Loading Skills

1. Open the **Coding Skills** panel in the sidebar
2. Skills are loaded from Base, Catalog, Skills, and user realms
3. Check skills to activate them
4. A `.cursorrules` file is generated with active skill instructions

### How It Works

The extension:
1. Queries `/_search` with `method: QUERY` for Skill card types
2. Stores skill metadata in `.skills/skills_data.json`
3. Tracks toggle state in `.skills/skill_state.json`
4. Concatenates active skill instructions into `.cursorrules`

## Architecture

The extension consists of 6 TypeScript modules:

| Module | Lines | Purpose |
|--------|-------|---------|
| `extension.ts` | 654 | Main activation, command registration |
| `local-file-system.ts` | 1,475 | File sync and workspace management |
| `skills.ts` | 416 | Skills tree provider for Cursor |
| `synapse-auth-provider.ts` | 316 | VS Code auth provider |
| `realm-auth.ts` | 276 | Matrix authentication |
| `realms.ts` | 109 | Realm tree provider |

## Next Steps

- [Boxel CLI](/developer-tools/cli) — Command-line tools
- [ESLint Plugin](/developer-tools/eslint-plugin) — Code linting
- [Skills System](/ai-agents/skills-system) — AI skills
