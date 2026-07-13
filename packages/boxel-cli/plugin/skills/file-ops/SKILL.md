---
description: Single-file operations against a Boxel realm. Use when the user wants to read, write, list, delete, lint, or touch (force-reindex) one file in a realm by URL — without a full sync.
---

# File operations

Wraps the `boxel file` subcommands that operate on a single path inside a realm. Prefer these over `realm sync` / `realm push` when only one or two files need to move.

## When the user asks to...

The realm URL is always passed via `--realm`, the realm-relative path is positional.

| Ask                                           | Run                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------ |
| "read a file from the realm"                  | `boxel file read <path> --realm <realm-url>`                                   |
| "write / upload one file"                     | `boxel file write <path> --realm <realm-url>` (content from stdin or `--file`) |
| "list files in a realm"                       | `boxel file list --realm <realm-url>`                                          |
| "delete a file from the realm"                | `boxel file delete <path> --realm <realm-url>`                                 |
| "lint a card definition" / "check for errors" | `boxel file lint <path> --realm <realm-url>`                                   |
| "force re-index this file"                    | `boxel file touch <path> --realm <realm-url>`                                  |
| "force re-index everything"                   | `boxel file touch --all --realm <realm-url>` (use sparingly)                   |

## `touch` — when it matters

`boxel file touch` is the escape hatch for "the realm has the right file but wrong derived state." Common cases:

- A `.gts` definition was updated remotely but instances using it still show the old shape — touch one instance to force re-indexing.
- A linked card was renamed and dependents haven't picked up the new path.

Touch is cheap. Reach for it when you suspect indexing didn't pick up a recent change.

## `lint` — what it checks

`boxel file lint` runs the realm's lint endpoint against a file. It catches Boxel-specific issues that generic TypeScript linters miss (bad `adoptsFrom` paths, wrong `linksTo` vs `contains`, missing fitted format). Use it before pushing new card definitions.

<!-- generated:commands:start -->

## Commands

_Generated from the boxel-cli Commander tree by_ `pnpm build:plugin`. _Edit prose outside the generated block — never inside it._

### `boxel file read <path>`

Read a file from a realm

**Arguments:**

- `<path>` — Realm-relative file path (e.g., hello-world.json, Cards/my-card.gts), or a full @cardstack/ identifier (e.g., @cardstack/catalog/hello.gts) in which case --realm is omitted

**Options:**

- `--realm <realm-url>` — The realm URL or @cardstack/<realm>/ identifier to read from (required unless <path> is a full @cardstack/ identifier)
- `--realm-secret-seed` — Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)
- `--json` — Output raw JSON response

### `boxel file write <path>`

Write a file to a realm (reads content from STDIN or --file)

**Arguments:**

- `<path>` — Realm-relative file path (e.g., hello.gts, Cards/my-card.json)

**Options:**

- `--realm <realm-url>` — The realm URL to write to
- `--file <filepath>` — Read content from a local file instead of STDIN
- `--realm-secret-seed` — Administrative auth: prompt for a realm secret seed and mint a JWT locally instead of using a Matrix profile (env: BOXEL_REALM_SECRET_SEED)
- `--json` — Output raw JSON response

### `boxel file list`

List all files in a realm

**Options:**

- `--realm <realm-url>` — The realm URL to list files from
- `--json` — Output raw JSON response

### `boxel file delete <path>`

Delete a file from a realm

**Arguments:**

- `<path>` — Realm-relative file path to delete

**Options:**

- `--realm <realm-url>` — The realm URL to delete from
- `--json` — Output raw JSON response

### `boxel file lint <path>`

Lint a file in a realm using the realm lint endpoint

**Arguments:**

- `<path>` — Realm-relative file path to lint (e.g., my-card.gts)

**Options:**

- `--realm <realm-url>` — The realm URL to lint against
- `--file <local-filepath>` — Read source from a local file instead of fetching from the realm
- `--json` — Output raw JSON response
- `--fix` — Write auto-fixed output back to the source

### `boxel file touch [paths]...`

Force realm re-indexing of one or more files by making a semantically-neutral edit. --all touches every .json/.gts in the realm without confirmation; use with care.

**Arguments:**

- `[paths]` — Realm-relative file path(s) to touch (omit when using --all)

**Options:**

- `--realm <realm-url>` — The realm URL to touch files in
- `--all` — Touch every .json and .gts file in the realm
- `--dry-run` — Print files that would be touched without writing
- `--json` — Output raw JSON response

<!-- generated:commands:end -->

## Pitfalls

- `boxel file write` reads content from stdin by default. Pipe in or use `--file` — don't expect interactive prompting.
- File paths are realm-relative (e.g., `BlogPost/my-post.json`), not absolute URLs. The realm URL goes in `--realm`.
- `delete` is unrecoverable from the CLI. Confirm intent before running, especially against production realms.
