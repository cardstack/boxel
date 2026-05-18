---
description: Move files between local disk and a Boxel realm. Use when the user wants to push local changes up, pull a realm down, do a bidirectional sync, watch a realm for continuous remote-to-local mirroring, create or remove a realm, or list realms accessible to the active profile.
---

# Realm sync

Wraps the `boxel realm` subcommands that move data between a local directory and a realm on the realm server. Pick the right verb for the direction:

- **`push`** — local → remote. Deploy local edits to the realm.
- **`pull`** — remote → local. Download a realm into a directory.
- **`sync`** — bidirectional. Reconcile both sides; needs a `--prefer-*` flag when there are conflicts.
- **`watch`** — remote → local, continuous. Long-running poller; pulls remote changes into the local directory as they happen. Locally-edited files are *not* overwritten by default — the watcher skips downloads when the local copy diverges from the sync manifest, logs a warning, and keeps polling. Pass `--overwrite-local` to opt back into the unconditional mirror behavior.
- **`create`** — provision a new realm on the realm server.
- **`remove`** — delete a realm and unlink it from the active profile.
- **`list`** — see realms the active profile can access.

## When the user asks to...

| Ask | Run |
|---|---|
| "push my changes" / "deploy" | `boxel realm push <local-dir> <realm-url>` |
| "download a realm" / "pull it locally" | `boxel realm pull <realm-url> <local-dir>` |
| "sync" / "keep them in lockstep" | `boxel realm sync <local-dir> <realm-url> --prefer-newest` (or `--prefer-local` / `--prefer-remote`) |
| "watch the realm" / "live-mirror remote changes locally" | `boxel realm watch start <realm-url> <local-dir>` |
| "stop watching" / "kill the watcher" | `boxel realm watch stop <local-dir>` |
| "make a new realm" | `boxel realm create <realm-name> <display-name>` |
| "delete this realm" / "remove a realm" | `boxel realm remove <realm-url>` |
| "what realms do I have access to" | `boxel realm list` |

## Prerequisites

A profile must be active. If `boxel profile list` shows none, the user has to run `boxel profile add` first — see `/boxel-cli:profile`.

## Conflict resolution flags

`sync` accepts conflict-resolution flags (one at a time):

- `--prefer-local` — local content wins on conflict.
- `--prefer-remote` — remote content wins on conflict.
- `--prefer-newest` — pick whichever side has the newer mtime. Usually the safest "stay in sync" choice.
- `--delete` — propagate deletions both ways (destructive — pair with a checkpoint).
- `--dry-run` — preview without writing. Good for first-time runs.

`push` and `pull` have their own `--delete` and `--dry-run` flags but no `--prefer-*` flags (they're one-directional). When in doubt, dry-run first.

`watch` protects local edits without a flag: by default any file whose local hash differs from the sync manifest is skipped (with a yellow `⚠ skipped …` line) instead of overwritten. The warning re-fires on every poll until the user reconciles via `boxel realm sync …` (e.g. `--prefer-newest`) or rerun watch with `--overwrite-local` to accept the remote.

If `watch` is starting in a directory that already mirrors the realm but has no `.boxel-sync.json` (e.g. populated by hand, by `git clone`, or by a different tool), run `boxel realm pull` first. Without a manifest every existing file looks "diverged" and the first poll warns about each one until reconciled.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel realm sync <local-dir> <realm-url>`

Bidirectional sync between a local directory and a Boxel realm

**Arguments:**

- `<local-dir>` — The local directory to sync
- `<realm-url>` — The URL of the target realm (e.g., https://app.boxel.ai/demo/)

**Options:**

- `--prefer-local` — Resolve conflicts by keeping local version
- `--prefer-remote` — Resolve conflicts by keeping remote version
- `--prefer-newest` — Resolve conflicts by keeping newest version
- `--delete` — Sync deletions both ways
- `--dry-run` — Preview without making changes
- `--realm-secret-seed` — Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)

### `boxel realm watch start <realm-url> <local-dir>`

Start watching a Boxel realm for server-side changes and pull them into a local directory

**Arguments:**

- `<realm-url>` — The URL of the realm to watch (e.g., https://app.boxel.ai/demo/)
- `<local-dir>` — The local directory to write changes into

**Options:**

- `-i, --interval <seconds>` — Polling interval in seconds
- `-d, --debounce <seconds>` — Seconds to wait after a burst of changes before applying them
- `--realm-secret-seed` — Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)
- `--overwrite-local` — Overwrite local files when the remote changes. Default: skip + warn when the local copy diverges from the sync manifest.

### `boxel realm watch stop`

Stop all running boxel realm watch processes

### `boxel realm push <local-dir> <realm-url>`

Push local files to a Boxel realm

**Arguments:**

- `<local-dir>` — The local directory containing files to sync
- `<realm-url>` — The URL of the target realm (e.g., https://app.boxel.ai/demo/)

**Options:**

- `--delete` — Delete remote files that do not exist locally
- `--dry-run` — Show what would be done without making changes
- `--force` — Upload all files, even if unchanged
- `--realm-secret-seed` — Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)

### `boxel realm pull <realm-url> <local-dir>`

Pull files from a Boxel realm to a local directory

**Arguments:**

- `<realm-url>` — The URL of the source realm (e.g., https://app.boxel.ai/demo/)
- `<local-dir>` — The local directory to sync files to

**Options:**

- `--delete` — Delete local files that do not exist in the realm
- `--dry-run` — Show what would be done without making changes
- `--realm-secret-seed` — Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)

### `boxel realm create <realm-name> <display-name>`

Create a new realm on the realm server

**Arguments:**

- `<realm-name>` — realm name (lowercase, numbers, hyphens only)
- `<display-name>` — display name for the realm

**Options:**

- `--background <url>` — background image URL
- `--icon <url>` — icon image URL

### `boxel realm remove <realm-url>`

Remove a realm — deletes server-side files and unlinks it from your realm list

**Arguments:**

- `<realm-url>` — realm URL to remove

**Options:**

- `-y, --yes` — Skip the interactive confirmation prompt
- `--dry-run` — Preview the change without writing to Matrix

### `boxel realm list`

List realms accessible to the active profile

**Options:**

- `--json` — Output JSON
- `--all-accessible` — Show all accessible realms, including hidden ones
- `--hidden` — Show only realms not in the user's UI realm list

<!-- generated:commands:end -->

## Pitfalls

- `boxel realm push --delete` will remove remote files that don't exist locally. Confirm the user intends destructive sync before adding the flag.
- The `<realm-url>` argument is the realm's *base URL* (`https://app.boxel.ai/owner/realm/`), not a card URL inside the realm. If the user pastes a card URL, strip the path back to the realm root.
- Newly created realms need indexing before they're usable. After `boxel realm create`, follow up with `boxel realm wait-for-ready` (see `/boxel-cli:realm-history`).
