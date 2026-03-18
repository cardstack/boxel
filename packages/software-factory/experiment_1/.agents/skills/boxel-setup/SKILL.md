---
name: boxel-setup
description: Use for Boxel CLI onboarding, profile setup, verifying login, listing workspaces, switching profiles, or helping a new user perform their first sync.
---

# Boxel Setup

Guide new users through Boxel CLI setup.

## Trigger
Run this automatically when:
- User first opens the repo
- No profile is configured (`npx boxel profile` shows nothing)
- User asks about setup or getting started

## Flow

### 1. Check Current State
```bash
npx boxel profile
```

If no profile exists, proceed with setup.

### 2. Add a Profile

**Option A: Interactive (recommended)**
```bash
npx boxel profile add
```

This wizard will:
1. Ask for environment (Production or Staging)
2. Ask for username and password
3. Create the profile automatically

**Option B: Non-interactive (CI/automation)**

Ask the user for:
- **Environment**: Production (app.boxel.ai) or Staging (realms-staging.stack.cards)
- **Username**: Their Boxel handle (e.g., `aallen90`, `ctse`). Found in Account panel as `@username:stack.cards` or in workspace URLs like `app.boxel.ai/username/workspace-name`
- **Password**: Same as Boxel web login

Then run (using environment variable for security):

**Production:**
```bash
BOXEL_PASSWORD="password" npx boxel profile add -u @username:boxel.ai -n "Production"
```

**Staging:**
```bash
BOXEL_PASSWORD="password" npx boxel profile add -u @username:stack.cards -n "Staging"
```

> **Security Note:** Avoid passing passwords via `-p` flag as they appear in shell history.

### 3. Verify
```bash
npx boxel list
```

### 4. First Sync
Help them sync a workspace:
```bash
npx boxel sync @username/workspace ./workspace-name
```

## Profile Management

**List profiles:**
```bash
npx boxel profile list
```

**Switch profile:**
```bash
npx boxel profile switch <username>
```

**Migrate from old .env:**
```bash
npx boxel profile migrate
```

## Success Message
```
Setup complete! You can now:
- `npx boxel list` - See your workspaces
- `npx boxel sync @username/workspace` - Sync a workspace
- `npx boxel watch .` - Monitor for changes
- `npx boxel history .` - View/restore checkpoints

Profile management:
- `npx boxel profile` - Show active profile
- `npx boxel profile list` - List all profiles
- `npx boxel profile switch <name>` - Switch profiles

For AI-assisted development, try:
- `boxel-watch` - Smart watch with auto intervals
- `boxel-sync` - Context-aware sync
- `boxel-restore` - Undo changes
```
