---
description: Manage saved boxel-cli profiles (credentials for users / environments). Use when the user wants to list profiles, add a new profile, switch the active profile, remove a profile, or migrate from a legacy .env file.
---

# Profiles

Wraps `boxel profile`, which manages credentials for different users and environments. Profiles live in `~/.boxel-cli/profiles.json` (mode 0600).

## When the user asks to...

| Ask | Run |
|---|---|
| "what profiles do I have?" / "who am I logged in as?" | `boxel profile list` |
| "log in" / "add a new account" | `boxel profile add` (interactive — preferred) |
| "switch to my staging account" | `boxel profile switch <username-or-fragment>` |
| "remove that old profile" | `boxel profile remove <profile-id>` |
| "import from my old .env" | `boxel profile migrate` |

## Profile IDs

Profiles use the Matrix ID format: `@username:domain`.

- Production: `@username:boxel.ai`
- Staging: `@username:stack.cards`
- Local dev: `@username:<env-slug>.localhost`

`switch` accepts a partial match — `boxel profile switch sarah` is enough if there's only one profile matching `sarah`.

## Adding profiles non-interactively

For automation, set `BOXEL_PASSWORD` in the environment instead of passing `-p`:

```bash
BOXEL_PASSWORD="..." boxel profile add -u @sarah:boxel.ai -n "Sarah - Prod"
```

`-p` works but exposes the password in shell history and process listings. Prefer `BOXEL_PASSWORD`.

## Custom matrix / realm-server URLs

For ephemeral environments (PR previews, branch deploys), `BOXEL_ENVIRONMENT` derives URLs from a slug:

```bash
BOXEL_ENVIRONMENT=my-branch boxel profile add -u @sarah:my-branch.localhost
# → matrix at http://matrix.my-branch.localhost
# → realm-server at http://realm-server.my-branch.localhost/
```

Override individually with `--matrix-url` / `--realm-server-url` if needed.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel profile [subcommand] [arg]`

Manage saved profiles for different users/environments

**Arguments:**

- `[subcommand]` — list | add | switch | remove | migrate
- `[arg]` — Profile ID (for switch/remove)

**Options:**

- `-u, --user <matrixId>` — Matrix user ID (e.g., @user:boxel.ai)
- `-p, --password <password>` — Password (for add command)
- `-n, --name <displayName>` — Display name (for add command)
- `-m, --matrix-url <url>` — Matrix server URL (for add command with non-standard domains)
- `-r, --realm-server-url <url>` — Realm server URL (for add command with non-standard domains)

<!-- generated:commands:end -->

## Pitfalls

- A fresh machine has no profiles. `boxel profile list` returns empty until `boxel profile add` is run at least once.
- The active profile is per-shell — switching doesn't propagate to other open terminals automatically.
- `migrate` is a one-shot operation for users coming from the old `.env` storage. New users don't need it.
