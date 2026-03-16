# Boxel CLI - Claude Code Integration

## GitHub Repository

**Official repo:** https://github.com/cardstack/boxel-cli

---

## How to Run Boxel Commands

After `npm install && npm run build`, use `npx boxel`:

```bash
npx boxel sync .
npx boxel history ./workspace
npx boxel profile add
```

Or use `boxel` directly after `npm link`.

**For development** (no rebuild needed after code changes):

```bash
npm run dev -- <command>
```

All documentation below shows `boxel <command>` for brevity.

---

## Auto-Activate Boxel Development Skill

**IMPORTANT:** When the user is doing ANY of the following, automatically read and follow `.claude/skills/boxel-development/SKILL.md`:

- Creating or editing `.gts` files (card definitions)
- Creating or editing `.json` card instances
- Asking about Boxel patterns, cards, or components
- "Vibe coding" or prototyping Boxel cards
- Working in a synced Boxel workspace (has `.boxel-sync.json`)
- Asking to create, build, or design anything in Boxel

**How to activate:** Read the skill file at the start of the task:

```
Read .claude/skills/boxel-development/SKILL.md
```

The skill contains comprehensive Boxel development guidance including CardDef/FieldDef patterns, templates, styling, and best practices.

---

**When a user opens this repo, check if they need onboarding first!**

## Onboarding Flow

When you detect a new user (no profile configured), guide them through setup:

### Step 1: Check Profile

```bash
npx boxel profile
```

If no profile exists, run the interactive setup:

### Step 2: Add a Profile

```bash
npx boxel profile add
```

This launches an interactive wizard that:

1. Asks for environment (Production or Staging)
2. Asks for username and password
3. Creates the profile in `~/.boxel-cli/profiles.json`

**Non-interactive option (CI/automation only):**

```bash
# Use environment variable to avoid exposing password in shell history
BOXEL_PASSWORD="password" npx boxel profile add -u @username:boxel.ai -n "My Prod Account"
```

> **Security Note:** Avoid passing passwords via `-p` flag as they appear in shell history and process listings. Use the interactive wizard or `BOXEL_PASSWORD` environment variable.

### Step 3: Verify & List Workspaces

```bash
npx boxel list
```

### Step 4: First Sync

Help them sync their first workspace:

```bash
npx boxel sync @username/workspace ./workspace-name
```

### Switching Between Profiles

```bash
npx boxel profile list              # See all profiles (★ = active)
npx boxel profile switch username   # Switch by partial match
```

---

## Local Workspace Organization

When syncing multiple workspaces locally, organize them by **domain/username/realm** to mirror the Matrix ID structure (`@username:domain`):

```
boxel-workspaces/
├── boxel.ai/                      # Production domain
│   └── acme-corp/                 # Username
│       ├── personal/              # Realm
│       ├── project-atlas/
│       └── inventory-tracker/
└── stack.cards/                   # Staging domain
    └── acme-corp/
        └── sandbox/
```

**Benefits:**

- Clear separation between production and staging environments
- Matches the `@username:domain` profile ID format
- Easy to identify which profile/environment a workspace belongs to
- Supports multiple users on the same machine

**First-time sync to this structure:**

```bash
# Production workspace
boxel pull https://app.boxel.ai/acme-corp/project-atlas/ ./boxel-workspaces/boxel.ai/acme-corp/project-atlas

# Staging workspace
boxel pull https://realms-staging.stack.cards/acme-corp/sandbox/ ./boxel-workspaces/stack.cards/acme-corp/sandbox
```

---

## Available Skills

Shared repo-local skills live in `.agents/skills/`.
`.claude/skills/` should be a symlink to that directory so Claude and Codex read the same files.

### `boxel-track` - Track Local Edits

Use this skill when starting `boxel track` for local file watching and checkpoints:

- Creates checkpoints as you save files in IDE
- Use `--push` flag to automatically push changes to server (batch upload)
- Without `--push`: Run `boxel sync . --prefer-local` to push to server

### `boxel-watch` - Smart Watch

Use this skill when starting `boxel watch` with context-aware timing:

- **Active development** (5s interval, 3s debounce): When editing files
- **Monitoring** (30s interval, 10s debounce): Background observation
- **Quick feedback** (10s interval, 5s debounce): Testing changes

### `boxel-restore` - Restore Checkpoint

Use this skill for the full restore workflow:

1. Shows history
2. Restores to checkpoint (properly deletes newer files)
3. Syncs deletions to server with `--prefer-local`
4. Optionally restarts watch

### `boxel-sync` - Smart Sync

Use this skill for context-aware bidirectional sync:

- After local edits or track → `--prefer-local`
- After server changes → `--prefer-remote`
- After restore → `--prefer-local` (essential for syncing deletions)

### `boxel-repair` - Realm Metadata/Card Repair

Use when workspaces show missing icon/background, wrong display name, or fail to open due to broken `index.json`/`cards-grid.json` links.

- Read `.claude/skills/boxel-repair/SKILL.md` for the step-by-step repair flow.
- `boxel repair-realm <url>` repairs one realm
- `boxel repair-realms` repairs all owned realms (excluding `personal` by default)
- Also reconciles Matrix account data (`app.boxel.realms`) unless disabled

### `software-factory-operations` - End-to-End Delivery Loop

Use this skill when the task is to break work into Boxel tickets, implement in an assigned realm, verify with Playwright, and keep knowledge plus progress checkpoints as durable factory memory.

---

## Commands Reference

### Status & Checking

```bash
boxel status .                    # Check sync status
boxel status --all                # Check all workspaces
boxel status . --pull             # Auto-pull remote changes
boxel check ./file.json --sync    # Check single file
```

### Pull, Push, Sync (Command Relationship)

| Command | Direction      | Purpose        | Deletes Local          | Deletes Remote        |
| ------- | -------------- | -------------- | ---------------------- | --------------------- |
| `pull`  | Remote → Local | Fresh download | with `--delete`        | never                 |
| `push`  | Local → Remote | Deploy changes | never                  | with `--delete`       |
| `sync`  | Both ways      | Stay in sync   | with `--prefer-remote` | with `--prefer-local` |

```bash
boxel sync .                      # Interactive sync
boxel sync . --prefer-local       # Keep local + sync deletions
boxel sync . --prefer-remote      # Keep remote
boxel sync . --prefer-newest      # Keep newest version
boxel sync . --delete             # Sync deletions both ways
boxel sync . --dry-run            # Preview only

boxel push ./local <url>          # One-way push (local → remote)
boxel push ./local <url> --delete # Push and remove orphaned remote files
boxel pull <url> ./local          # One-way pull (remote → local)
```

**Failed download cleanup:** When `sync` encounters files that return 500 errors (broken/corrupted on server), it will prompt you to delete them:

```
⚠️  3 file(s) failed to download (server error):
   - Staff/broken-card.json
   - Student/corrupted.json

These files may be broken on the server. Delete them from remote? [y/N]
```

> **Safety tip:** Before any destructive operation, create a checkpoint with a descriptive message:
>
> ```bash
> boxel history . -m "Before cleanup: removing broken server files"
> ```

### Track ⇆ (Local File Watching)

```bash
boxel track .                     # Track local edits, auto-checkpoint as you save
boxel track . --push              # Track AND push changes to server (batch upload)
boxel track . -d 5 -i 30          # 5s debounce, 30s min between checkpoints
boxel track . -q                  # Quiet mode
boxel track . -v                  # Verbose mode (debug output)
```

**Use track when:** Editing locally in IDE/VS Code. Creates checkpoints as you save files.
**Symbol:** ⇆ (horizontal arrows = local changes)
**With --push:** Real-time sync to server using batch upload via `/_atomic` endpoint.

### Watch ⇅ (Remote Server Watching)

```bash
boxel watch                       # Watch all configured realms (from .boxel-workspaces.json)
boxel watch .                     # Watch single workspace
boxel watch . ./other-realm       # Watch multiple realms simultaneously
boxel watch . -i 5 -d 3           # Active: 5s interval, 3s debounce
boxel watch . -q                  # Quiet mode
```

**Use watch when:** Others are editing in Boxel web UI. Pulls their changes and creates checkpoints.
**Symbol:** ⇅ (vertical arrows = remote server changes)

### Stop

```bash
boxel stop                        # Stop all running watch (⇅) and track (⇆) processes
```

**Multi-realm watching:** Useful when code lives in one realm and data in another. Each realm gets its own checkpoint tracking and debouncing.

### Realms (Multi-Realm Configuration)

```bash
boxel realms                      # List configured realms
boxel realms --init               # Create .boxel-workspaces.json
boxel realms --add ./path         # Add a realm
boxel realms --add ./code --purpose "Card definitions" --patterns "*.gts" --default
boxel realms --add ./data --purpose "Data instances" --card-types "BlogPost,Product"
boxel realms --llm                # Output LLM guidance for file placement
boxel realms --remove ./path      # Remove a realm
```

**File placement guidance:** The `--llm` output tells Claude which realm to use for different file types and card types.

### History & Restore

```bash
boxel history .                   # View checkpoints
boxel history . -r                # Interactive restore
boxel history . -r 3              # Quick restore to #3
boxel history . -r abc123         # Restore by hash
boxel history . -m "Message"      # Create checkpoint with custom message
```

### Skills

```bash
boxel skills --refresh            # Fetch skills from Boxel
boxel skills --list               # List all available skills
boxel skills --enable "Name"      # Enable a skill
boxel skills --disable "Name"     # Disable a skill
boxel skills --export ./project   # Export as Claude commands
```

### Profile (Authentication)

```bash
boxel profile                     # Show current active profile
boxel profile list                # List all saved profiles (★ = active)
boxel profile add                 # Interactive wizard to add profile (recommended)
# Non-interactive: use BOXEL_PASSWORD env var instead of -p flag for security
boxel profile switch <username>   # Switch profile (partial match OK)
boxel profile remove <profile-id> # Remove a profile
boxel profile migrate             # Migrate from old .env file
```

**Profile IDs:** Use Matrix format `@username:domain`

- Production: `@username:boxel.ai`
- Staging: `@username:stack.cards`

**Storage:** Profiles stored in `~/.boxel-cli/profiles.json` (permissions: 0600)

### Other

```bash
boxel list                        # List workspaces
boxel create endpoint "Name"      # Create workspace
boxel consolidate-workspaces .    # Move legacy local dirs into domain/owner/realm
boxel repair-realm <url>          # Repair one realm metadata/starter cards
boxel repair-realms               # Batch repair all owned realms
boxel pull <url> ./local          # One-way pull
boxel push ./local <url>          # One-way push
```

### Share & Gather (GitHub Workflow)

```bash
boxel share . -t /path/to/repo -b branch-name --no-pr   # Share to GitHub repo
boxel gather . -s /path/to/repo                          # Pull from GitHub repo
```

**Share** copies workspace state to a GitHub repo branch:

- Preserves repo-level files (package.json, LICENSE, README, etc.)
- Skips realm-specific files (.realm.json, index.json, cards-grid.json)
- Creates branch and commits changes

**Gather** pulls changes from GitHub back to workspace:

- Symmetric to share
- Preserves workspace's realm-specific files

**Pushing to GitHub:** Use GitHub Desktop to push branches (no CLI auth configured).
After share creates the branch locally, open GitHub Desktop and push.

### `/boxel-development` - Default Vibe Coding Skill

The **Boxel Development** skill is auto-enabled for vibe coding. It provides comprehensive guidance for:

- Card definitions (.gts files)
- Card instances (.json files)
- Boxel patterns and best practices

### `/boxel-file-structure` - File Organization Rules

Reference for local file organization:

- Directory naming: definitions (`kebab-case.gts`), instances (`PascalCase/`)
- Module paths: relative to JSON location (`../card` from subdirectory)
- JSON structure for card instances

### `boxel skills` - Manage Additional Skills

Fetch and manage AI instruction cards from Boxel:

```bash
boxel skills --refresh       # Fetch latest from Boxel
boxel skills --list          # See available skills
boxel skills --enable "X"    # Enable additional skills
boxel skills --export .      # Re-export to .agents/skills/ (shared with .claude/skills/)
```

---

## Key Workflows

### Local Development with Track (IDE/Agent Editing)

```bash
boxel track .                     # Start tracking local edits (auto-checkpoints)
# ... edit files in IDE or with Claude ...
# Track creates LOCAL checkpoints as you save

# IMPORTANT: When ready to push changes to Boxel server:
boxel sync . --prefer-local       # Push your local changes to server
```

**Remember:** Track does NOT sync to server automatically - it only creates local checkpoints. Always run `sync --prefer-local` when you want your changes live on the server.

### Real-Time Sync with Track --push

```bash
boxel track . --push              # Track AND auto-push to server
# ... edit files in IDE or with Claude ...
# Changes are checkpointed AND pushed to server automatically
```

**With --push:** Uses batch upload via `/_atomic` endpoint for efficient multi-file uploads. Definitions (.gts) are uploaded before instances (.json) to ensure proper indexing.

### Active Development Session (Watching Server)

```bash
boxel watch . -i 5 -d 3           # Active development settings
# ... edit in Boxel UI or locally ...
boxel sync .                      # Push/pull changes
```

### Undo Server Changes (Restore)

```bash
boxel history .                   # Find checkpoint
boxel history . -r 3              # Restore to #3
boxel sync . --prefer-local       # ESSENTIAL: sync deletions to server
```

### Share Milestone to GitHub

```bash
boxel share . -t /path/to/boxel-home -b boxel/feature-name --no-pr
# Then push via GitHub Desktop
```

**URL Portability:** Share automatically converts absolute realm URLs in `index.json` and `cards-grid.json` to relative URLs, making the content portable across different realms.

### Gather Updates from GitHub

```bash
boxel gather . -s /path/to/boxel-home
boxel sync . --prefer-local       # Push gathered changes to Boxel server
```

**URL Portability:** Gather includes `index.json` and `cards-grid.json`, transforming any absolute URLs to relative paths for portability.

Or simply:

```
consult boxel-restore and restore checkpoint 3
```

### Monitor Server While Working

```bash
boxel watch . -i 30 -d 10         # Monitoring settings
# Checkpoints created automatically
boxel history .                   # View what changed
```

### Multi-Realm Development

When working with multiple realms (e.g., code + data separation):

```bash
# Configure realms once
boxel realms --add ./code-realm --purpose "Card definitions" --patterns "*.gts" --default
boxel realms --add ./data-realm --purpose "Content instances" --card-types "BlogPost,Product"

# Watch all configured realms
boxel watch

# Check where to put a new file
boxel realms --llm
```

**File placement heuristics:**

- `.gts` files → realm with `*.gts` pattern (usually code realm)
- Card instances → realm configured for that card type
- Ambiguous → use the default realm

---

## Critical Patterns

### ⚠️ SAFETY FIRST: Checkpoint Before Destructive Operations

**Always create a checkpoint with a descriptive message before:**

- Deleting files from server (`--prefer-local`, `push --delete`)
- Restoring to an earlier checkpoint
- Bulk cleanup operations
- Removing card definitions or instances

```bash
boxel history . -m "Before cleanup: removing sample data and unused definitions"
# Now safe to proceed with destructive operation
boxel sync . --prefer-local
```

This ensures you can always recover if something goes wrong. The checkpoint message helps identify what state to restore to.

### 0. ALWAYS Write Source Code, Never Compiled Output

When editing `.gts` files, **always write clean idiomatic source code**:

```gts
// CORRECT - Clean source
export class MyCard extends CardDef {
  static fitted = class Fitted extends Component<typeof MyCard> {
    <template>
      <div class='container'>...</div>
      <style scoped>
        .container { ... }
      </style>
    </template>
  };
}
```

**NEVER** write or edit:

- Compiled JSON blocks (`"block": "[[[10,0]..."`)
- Base64-encoded CSS imports (`./file.gts.CiAg...`)
- Wire format template arrays

The server compiles source to these formats. If you see them, the file was pulled from server - rewrite it as clean source.

### 0.5. Edit Lock Before Modifying Files

When editing files locally while watch is running, use edit lock to prevent watch from overwriting your changes:

```bash
boxel edit . grammy-gallery.gts       # Lock file before editing
# ... make your edits ...
boxel sync . --prefer-local           # Push your changes
boxel touch . Instance/file.json      # Force re-index
boxel edit . --done grammy-gallery.gts  # Release lock
```

**Quick commands:**

```bash
boxel edit . --list                   # See what's locked
boxel edit . --clear                  # Clear all locks
boxel edit . --done                   # Release all locks
```

**Why:** Watch mode pulls remote changes which can overwrite local edits. Edit lock tells watch to skip those files.

### 0.5. Touch Instance After Remote .gts Update

When you update a `.gts` card definition file remotely (via sync/push), touch an instance file to force re-indexing:

```bash
boxel touch . CardName/instance.json  # Touch specific instance
boxel touch .                         # Or touch all files
```

**Why:** The realm server may not re-index the definition until an instance using it is touched.

### 1. Stop Watch Before Restore

Watch will re-pull deleted files if running during restore:

```bash
# Stop watch first (Ctrl+C or kill process)
boxel history . -r 3
boxel sync . --prefer-local
```

### 2. Always Use --prefer-local After Restore

This syncs local deletions to the server:

```bash
boxel history . -r 3              # Deletes files locally
boxel sync . --prefer-local       # Deletes files on server
```

### 3. Debouncing Groups Rapid Changes

Watch waits for changes to settle:

- Change detected → timer starts
- More changes → timer resets
- Timer expires → single checkpoint with all changes

### 4. Checkpoint Classification

- `[MAJOR]` - New files, deleted files, .gts changes, >3 files
- `[minor]` - Small updates to existing .json files
- `LOCAL` ⇆ - Changes from local edits (track command)
- `SERVER` ⇅ - External changes from web UI (watch command)

---

## File Structure

```
workspace/
├── .boxel-sync.json      # Sync manifest (hashes, mtimes)
├── .boxel-history/       # Git-based checkpoint history
├── .realm.json           # Workspace config
├── index.json            # Workspace index
├── *.gts                 # Card definitions
└── CardName/
    └── *.json            # Card instances
```

---

## Workspace References

Commands accept:

- `.` - Current directory (needs `.boxel-sync.json`)
- `./path` - Local path
- `@user/workspace` - e.g., `@username/personal`
- `https://...` - Full URL

---

## Understanding Boxel URLs (Card IDs)

When a user shares a URL like:

```
https://app.boxel.ai/tribecaprep/employee-handbook/Document/d8341312-f3a0-442b-a2e5-49c5cdd84695
```

**This is a Card ID, not a fetchable URL!**

### How to Parse Boxel URLs

| URL Part                | Meaning                     |
| ----------------------- | --------------------------- |
| `app.boxel.ai`          | Production server           |
| `tribecaprep`           | User/organization           |
| `employee-handbook`     | Realm/workspace name        |
| `Document/d8341312-...` | Card type and instance path |

### NEVER Use WebFetch on Boxel URLs

- Boxel realms are **usually private** and require Matrix authentication
- WebFetch will fail with 401/403 errors
- The user is referencing content **they expect you to have locally**

### Finding the Local Copy

If the user references a Boxel URL, the file is likely already synced to the local workspace:

1. **Parse the path**: `Document/d8341312-f3a0-442b-a2e5-49c5cdd84695` → local path is `Document/d8341312-f3a0-442b-a2e5-49c5cdd84695.json`

2. **Search the workspace**:

```bash
# Find by card ID
find . -name "d8341312-f3a0-442b-a2e5-49c5cdd84695*"

# Or search for the card type folder
ls ./Document/
```

3. **Read the local file** using the Read tool

### Example Workflow

User says: "Check the handbook at https://app.boxel.ai/tribecaprep/employee-handbook/Document/abc123"

**Do this:**

```
# Look for local file
Read ./Document/abc123.json
```

**NOT this:**

```
# This will FAIL - private realm
WebFetch https://app.boxel.ai/tribecaprep/employee-handbook/Document/abc123
```

---

## API Reference

| Endpoint   | Method | Purpose                 |
| ---------- | ------ | ----------------------- |
| `/_mtimes` | GET    | File modification times |
| `/<path>`  | GET    | Download file           |
| `/<path>`  | POST   | Upload file             |
| `/<path>`  | DELETE | Delete file             |
| `/_atomic` | POST   | Batch atomic operations |

Headers:

- `Authorization`: JWT from Matrix auth
- `Accept`: `application/vnd.card+source` or `application/vnd.api+json`

### Atomic Batch Operations

The `/_atomic` endpoint supports batch file operations that succeed or fail atomically:

```json
{
  "atomic:operations": [
    { "op": "add", "href": "./path/to/new.json", "data": { "data": {...} } },
    { "op": "update", "href": "./path/to/existing.gts", "data": { "data": { "type": "module", "attributes": { "content": "..." } } } },
    { "op": "remove", "href": "./path/to/delete.json" }
  ]
}
```

| Operation | Behavior                                    |
| --------- | ------------------------------------------- |
| `add`     | Create new file (fails 409 if exists)       |
| `update`  | Update existing file (fails 404 if missing) |
| `remove`  | Delete file                                 |

**Content-Type:** `application/vnd.api+json`

---

## Conflict Resolution

| Local     | Remote    | Action                          |
| --------- | --------- | ------------------------------- |
| Changed   | Unchanged | Push                            |
| Unchanged | Changed   | Pull                            |
| Changed   | Changed   | Conflict → use strategy         |
| Deleted   | Changed   | `--prefer-local` deletes remote |
| Changed   | Deleted   | `--prefer-remote` deletes local |

---

## Troubleshooting

### "Authentication failed"

- Check active profile: `boxel profile`
- Verify credentials: `boxel profile list`
- Verify you can log into Boxel web with same credentials
- For staging: ensure profile uses `@username:stack.cards`

### "No workspace found"

- Run `boxel list` to see workspaces
- Use full URL for first sync
- Ensure correct profile is active for the environment

### Files keep reverting after restore

- Stop watch before restoring
- Use `boxel sync . --prefer-local` after

### Watch not detecting changes

- Check interval setting
- Verify server URL
- Check active profile: `boxel profile`

### Switching environments (prod/staging)

- Add profiles for each environment
- Switch with: `boxel profile switch <username>`

### "500 Internal Server Error" on specific files

- These files are broken/corrupted on the server
- Sync will prompt you to delete them after completion
- Or use `boxel push . <url> --delete` to remove all orphaned remote files
- Check if card definitions have errors in Boxel web UI
