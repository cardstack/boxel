---
name: boxel-sync-workspace
description: Pull, push, sync, watch, status, history, milestone, and search realms via boxel-cli. Manage workspace state including .boxel-sync.json manifest and checkpoints in .boxel-history.
boxel:
  kind: skill
---

# /boxel-sync-workspace

## Use When

- The user wants to pull a realm down for local development.
- They've edited files locally and want to push back.
- Bidirectional sync with conflict resolution.
- Inspect/restore checkpoints, mark milestones.
- Watch a directory and auto-sync on change.
- Federated search across realms.
- The user mentions `boxel-cli`, "pull", "push", "sync", "status", "watch", "checkpoint", "history", "milestone", "search realms".

## Inputs

- Realm URL (e.g. `https://realms-staging.stack.cards/ctse/foo/`).
- Local directory path (the local mirror of the realm — the relative path typically mirrors the realm URL's host + path).
- The operation (pull / push / sync / status / watch / history / milestone / search / list).
- Operation-specific flags (see Procedure).

## Read

1. `skills/boxel-environment/SKILL.md` (for the host-side context).
2. `skills/boxel/references/lint-workflow.md` (mandatory lint gate for `.gts` work).
3. `skills/boxel-patterns/references/integration-surfaces.md` §10 (full boxel-cli surface).
4. The target realm's `.boxel-sync.json` (file → md5 manifest) and `.boxel-history/` (per-realm git history) if inspecting state.

## Procedure

> **Note on versions.** If `/usr/local/bin/boxel --help` shows a smaller surface (just `realm create/pull/push/sync` + `profile` + `run-command`), that's a stale install. The full set below comes from the source at `~/Projects/boxel/packages/boxel-cli`. Rebuild + relink to get all commands.

### A. Pull a realm down

```sh
npx boxel realm pull <realm-url> <local-dir>
```

Flags: `--delete` (also remove locals not in remote), `--dry-run`.

Creates `.boxel-sync.json` (manifest) + `.boxel-history/.git/` (checkpoint history) inside the local dir.

### B. Push local edits back

```sh
npx boxel realm push <local-dir> <realm-url>
```

Flags: `--delete` (also remove remotes not in local — destructive, confirm), `--force` (re-upload everything), `--dry-run`.

After pushing GTS changes, run real installed npm `boxel` lint and render validation. Do not treat `npx boxel check <file>` as lint; it only reports sync state.

### C. Bidirectional sync

```sh
npx boxel realm sync <local-dir> <realm-url> --prefer-newest
```

Flags: `--prefer-local`, `--prefer-remote`, `--prefer-newest` (one required), `--delete`, `--dry-run`.

### D. Check status (real subcommand)

```sh
npx boxel realm status <local-dir>
```

Classifies each file as added/modified/deleted relative to the manifest. No flags needed for the basic view.

### E. Watch for changes and auto-sync

```sh
npx boxel realm watch start <local-dir>
npx boxel realm watch stop                    # stops the watcher for this workspace
```

Watch acquires a lock via `.boxel-sync.json` so only one watcher runs per workspace. Use `stop` (without args) to halt the running one. Logs go to a per-workspace location.

### F. Inspect / restore checkpoints

```sh
npx boxel realm history <local-dir>                          # list recent checkpoints
npx boxel realm history <local-dir> --limit 50               # extend the listing
npx boxel realm history <local-dir> --restore <id|hash>      # restore a specific checkpoint
npx boxel realm history <local-dir> --message "Pre-refactor" # create a manual checkpoint
```

Checkpoints are git commits inside `.boxel-history/.git`. Each pull/push/sync creates one automatically with source-tagging (`local`, `remote`, or `manual`).

### G. Mark milestones (named checkpoints)

```sh
npx boxel realm milestone <local-dir> --mark <id|hash> --name "v1.0"   # name a checkpoint
npx boxel realm milestone <local-dir> --remove <id|hash>                # remove the milestone tag
```

Milestones are git tags on the underlying checkpoint commits. Useful for "go back to before I broke X".

### H. List / wait / cancel / remove

```sh
npx boxel realm list                                              # realms in current profile
npx boxel realm list --all-accessible                             # include hidden/cross-org
npx boxel realm wait-for-ready --realm <url> --timeout 60000      # block until reachable
npx boxel realm cancel-indexing --realm <url>                     # cancel running indexing
npx boxel realm cancel-indexing --realm <url> --cancel-pending    # also drop queued jobs
npx boxel realm remove <realm-url>                                # remove a realm (destructive)
```

### I. Federated search across realms

```sh
npx boxel search '<query-json>' --realms <url1>,<url2>
```

Hits the `/_federated-search` endpoint. Supports the full Boxel `Query` shape (`filter` / `on` / `sort`). Server JWT handled by the active profile.

### J. File ops on a realm (no full sync needed)

```sh
npx boxel file read <realm-url-or-path>
npx boxel file write <path> < content.txt
npx boxel file list <realm-url-or-path>
npx boxel file touch <path>            # force a re-index for one file
npx boxel file delete <path>
```

Useful for surgical realm edits without pulling the whole thing locally.

### J1. Lint Boxel source

Use the installed npm `@cardstack/boxel-cli` 0.2.0+ lint surface, not `npx boxel check`.

```sh
npx boxel file lint <realm-relative-path> --realm <realm-url> --file <absolute-local-file>
npx boxel lint <realm-relative-path> --realm <realm-url>
npx boxel lint --realm <realm-url>
```

Clean lint is the human output `No lint issues found` or JSON with an empty `messages` array. `ok: true` with messages is not clean.

> ⚠️ **Lint plus render.** Lint catches compile/syntax/import/template-scope problems; render validation still matters after a push:
>
> 1. **After push** of a `.gts` change, hit `/_search-prerendered` to confirm the realm successfully prerendered the supported formats (`embedded`, `fitted`, `atom`, `head`). A 200 with rendered HTML means the card compiles + serializes; a 5xx with an indexing error means the file is broken.
> 2. **For isolated format**, prerender doesn't cover it — open the card in the live app (`/boxel-preview-card`) or render via a `run-command` invocation. Isolated-only errors won't show up in `_search-prerendered`.
> 3. If the lint command is genuinely unavailable, record the CLI gap and use render validation as a fallback. That fallback is not a clean lint.

> ⚠️ **Manifest compatibility bug observed 2026-05-21.** `npx boxel check <file>` can crash before doing any useful check when `.boxel-sync.json` contains `realmUrl` but no `workspaceUrl`:
>
> `TypeError: Cannot read properties of undefined (reading 'endsWith')`
>
> This is another reason not to treat `npx boxel check` as a lint gate. If this happens, record it in the CLI improvements log and continue with installed npm `boxel` lint plus server-side render validation.

### Escape hatch when `npx boxel realm push` hangs

`npx boxel realm push` sometimes hangs at "Testing realm access..." for a realm whose previous push triggered a runtime indexing error. The realm is reachable (HTTP 200 to its `_info` endpoint) but the CLI's pre-push check spins. When this happens, upload individual files directly via the realm-server source API:

```bash
JWT=$(jq -r '.profiles."@ctse:stack.cards".realmTokens."https://realms-staging.stack.cards/<your-realm>/"' ~/.boxel-cli/profiles.json)

curl -sS -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/vnd.card+source" \
  --data-binary @path/to/local/file.gts \
  "https://realms-staging.stack.cards/<realm>/<path/to/file.gts>" \
  -w "%{http_code}\n"
```

A `204` response means success. Verify the upload by re-fetching the source:

```bash
curl -sS -H "Authorization: Bearer $JWT" -H "Accept: application/vnd.card+source" \
  "https://realms-staging.stack.cards/<realm>/<path>" | grep <unique-string-from-your-change>
```

The token path key in `profiles.json` is the full realm URL with trailing slash. Same approach works for JSON instances (just point at the `.json` path and the realm reindexes it).

### K. Run a host command from CLI

```sh
npx boxel run-command @cardstack/boxel-host/tools/get-card-type-schema/default \
  --realm <realm-url> \
  --input '{"codeRef":{"module":"./project","name":"Project"}}' \
  --json
```

Routes through the realm prerenderer. Useful for scripted reindexing, schema introspection, batch operations.

### L. Consolidate multiple workspaces

```sh
boxel consolidate-workspaces
```

Merge multiple watched workspaces (advanced — interactive prompts).

### M. Profile management

```sh
boxel profile list
boxel profile use <name>
boxel profile create <name> [--realm-server-url <url>] [--user-id <id>]
boxel profile delete <name>
```

Each profile holds a different realm-server URL + auth context. Useful when working against staging vs prod.

## Done Criteria (self-verify)

- [ ] If the operation was destructive (`--delete`, `--force`, `remove`, `milestone --remove`), the user explicitly confirmed before invocation.
- [ ] For `sync`: one of `--prefer-local`, `--prefer-remote`, `--prefer-newest` was specified.
- [ ] After pull/sync: `.boxel-sync.json` exists in the local directory.
- [ ] After push/sync: `npx boxel realm status <dir>` returns clean (no pending changes).
- [ ] After GTS push/sync: installed npm `boxel` lint was clean for each changed `.gts` file (`npx boxel file lint ... --file <local-file>` before push and `npx boxel lint <path> --realm <url>` after push). `npx boxel check` alone is **not** enough — it only reports sync state.
- [ ] After GTS push/sync: a `_search-prerendered` hit confirmed the realm accepted the file for `embedded`/`fitted`/`atom`/`head`, AND at least one affected card was opened in the live app to exercise `isolated`.
- [ ] The workspace root `.gitignore` continues to exclude `realms-staging.stack.cards/`, `app.boxel.ai/`, `stack.cards/` — realm content stays out of the workspace repo.

## Failure Recovery

- **"directory is not a Boxel realm sync target"** → no manifest. Start with `npx boxel realm pull`.
- **Sync conflict with no preference flag** → re-run with `--prefer-local|remote|newest`, or pull first and resolve by hand.
- **Push rejected "remote has newer version"** → pull/sync first, OR use `--force` (overwrites remote — confirm).
- **Watch won't start ("locked")** → another watcher is running. `npx boxel realm watch stop` first.
- **Realm not reachable** → `npx boxel realm wait-for-ready --realm <url>` to block until ready.
- **Indexing stuck** → `npx boxel realm cancel-indexing --realm <url>` to clear the queue.
- **Installed CLI missing commands** → `/usr/local/bin/boxel` may be stale. Rebuild from `~/Projects/boxel/packages/boxel-cli` and re-link.

## Hand-off

- After a successful pull/sync, the next step is usually `/boxel-preview-card` to confirm the live app renders correctly.
- After push, `/boxel-preview-card` confirms the realm server indexed the change.
- If a push surfaced a runtime error, switch to `/boxel-debug-runtime`.
- For federated cross-realm search, `npx boxel search` is also reachable via host command `SearchCardsByQueryCommand` from inside the app (see `/boxel-search-cards`).
