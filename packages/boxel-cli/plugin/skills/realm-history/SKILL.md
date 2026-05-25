---
description: Local checkpoint history plus realm-indexing control. Use when the user wants to view / restore / create checkpoints in `.boxel-history/`, wait for a realm to finish indexing, or cancel a running indexing job.
---

# Realm history & indexing control

Two related concerns under one skill:

- **`boxel realm history`** — manage **local** checkpoints stored in `.boxel-history/` inside the synced workspace directory. Checkpoints are created automatically by `boxel realm sync` and can be created manually. Restore rolls the local working tree back to a checkpoint.
- **`boxel realm wait-for-ready`** / **`boxel realm cancel-indexing`** — observe and steer the realm-server's indexing pipeline.

## When the user asks to...

| Ask | Run |
|---|---|
| "show me the checkpoint history" | `boxel realm history <local-dir>` |
| "create a manual checkpoint" | `boxel realm history <local-dir> -m "Before risky change"` |
| "restore to checkpoint #3" | `boxel realm history <local-dir> -r 3` |
| "wait until indexing finishes" / "is it done indexing?" | `boxel realm wait-for-ready --realm <realm-url>` |
| "cancel the current indexing job" / "stop the index" | `boxel realm cancel-indexing --realm <realm-url>` |

## Typical sequencing

Before a destructive sync, snapshot the local state so you can roll back:

```bash
boxel realm history ./local-dir -m "Before bulk delete"
boxel realm sync ./local-dir https://app.boxel.ai/owner/realm/ --prefer-local --delete
boxel realm wait-for-ready --realm https://app.boxel.ai/owner/realm/
# verify; if bad:
boxel realm history ./local-dir -r 1
boxel realm sync ./local-dir https://app.boxel.ai/owner/realm/ --prefer-local
```

`wait-for-ready` is the right call before any read that should see the latest writes — including `boxel search` and `boxel file read` against newly-pushed content.

`cancel-indexing` is rarely needed. Use it when an indexing job is wedged on bad input and the user wants to clear the queue before pushing a fix.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel realm history <local-dir>`

View, restore, or create local checkpoints stored under .boxel-history/

**Arguments:**

- `<local-dir>` — The local workspace directory

**Options:**

- `-r, --restore <ref>` — Restore the workspace to a checkpoint (1-based index, short hash, or full hash)
- `-m, --message <message>` — Create a manual checkpoint with the given message
- `-y, --yes` — Skip the interactive confirmation prompt before --restore
- `--limit <n>` — Maximum number of checkpoints to list or consider for --restore (default: 100)

### `boxel realm wait-for-ready`

Poll a realm readiness-check endpoint until it responds OK or the timeout is reached

**Options:**

- `--realm <realm-url>` — The realm URL to check
- `--timeout <ms>` — Timeout in milliseconds (default: 30000)

### `boxel realm cancel-indexing`

Cancel running indexing jobs for a realm (use --cancel-pending to also cancel queued jobs)

**Options:**

- `--realm <realm-url>` — URL of the realm to cancel indexing for
- `--cancel-pending` — Also cancel queued/pending indexing jobs (default: cancel running only)
- `--json` — Output raw JSON response

<!-- generated:commands:end -->

## Pitfalls

- `boxel realm history` operates on a **local** directory (its `.boxel-history/`), not a realm URL. Don't pass a URL.
- `wait-for-ready` polls. On a healthy realm it returns in seconds; on a stuck realm it can hang. If it doesn't return within a minute or two, check the realm-server logs.
