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
5. `skills/boxel-environment/references/fresh-realm-push-integrity.md` before the first deployment to a new or reset realm.

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

After pushing GTS changes, run the installed npm lint and render-validation gates. The current monorepo CLI has no `npx boxel check`; use `npx boxel file lint` / `npx boxel lint`.

### C. Bidirectional sync

```sh
npx boxel realm sync <local-dir> <realm-url> --prefer-newest
```

Flags: `--prefer-local`, `--prefer-remote`, `--prefer-newest` (one required), `--delete`, `--dry-run`.

> **Fresh-realm ordering:** do not send definitions and instances as one mixed first push when instances contain nested realm-defined fields. Push `.gts` definitions, wait for their schemas to report ready, then write `.json` instances. A mixed push can preserve card counts while silently replacing nested leaf values with `null`. See `fresh-realm-push-integrity.md`.

### D. Check status (real subcommand)

```sh
npx boxel realm status <local-dir>
```

Classifies each file as added/modified/deleted relative to the manifest. No flags needed for the basic view.

### E. Watch for server-side changes

```sh
npx boxel realm watch start <local-dir>
npx boxel realm watch stop                    # stops the watcher for this workspace
```

Watch pulls server-side realm changes into the local workspace; it is not a local auto-push loop. It acquires a lock via `.boxel-sync.json` so only one watcher runs per workspace. Use `stop` (without args) to halt the running one. Logs go to a per-workspace location.

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

### H1. Publish to host mode

```sh
npx boxel realm publish <source-realm-url> <published-realm-url>
npx boxel realm publish <source-realm-url> <published-realm-url> --no-wait
npx boxel realm unpublish <published-realm-url>
```

Publishing creates an anonymously readable host-mode copy. A readiness-poll timeout does not prove that publication failed; probe the published URL before retrying. See `link-host-mode-paths` for `realm.json` routing.

### H2. Diagnose indexing failures

```sh
npx boxel realm indexing-errors --realm <url>
```

Use this before scraping search responses when a push leaves cards unindexed. If the installed CLI predates the subcommand, inspect the realm's indexing diagnostics through the environment workflow instead.

### I. Federated search across realms

```sh
npx boxel search '<query-json>' --realms <url1>,<url2>
```

Hits the `/_federated-search` endpoint. Supports the full Boxel `Query` shape (`filter` / `on` / `sort`). Server JWT handled by the active profile.

For typed render validation, prefer the installed CLI as the compatibility layer: run `npx boxel search --realm <url> --query '<json>' --json` and inspect `relationships.html`. Direct `/_search-prerendered` and `/_search-v2` routes vary by deployment. If `/_search-prerendered` is exposed, it requires HTTP `QUERY`; a `GET`, 404, or method error is an endpoint failure, not an empty successful search.

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

Use the installed npm `@cardstack/boxel-cli` lint surface. The current monorepo CLI has no `npx boxel check`.

```sh
npx boxel file lint <realm-relative-path> --realm <realm-url> --file <absolute-local-file>
npx boxel lint <realm-relative-path> --realm <realm-url>
npx boxel lint --realm <realm-url>
npx boxel parse [path]                    # local Glint + JSON document validation
```

Clean lint is the human output `No lint issues found` or JSON with an empty `messages` array. `ok: true` with messages is not clean.

> ⚠️ **Lint plus render.** Lint catches compile/syntax/import/template-scope problems; render validation still matters after a push:
>
> 1. **After push** of a `.gts` change, run a typed `npx boxel search --json` and inspect its HTML relationships to confirm the realm successfully prerendered the supported formats. Use direct `/_search-prerendered` only when that deployment exposes it.
> 2. **For isolated format**, prerender doesn't cover it — open the card in the live app (`/boxel-preview-card`) or render via a `run-command` invocation. Isolated-only errors won't show up in `_search-prerendered`.
> 3. If the lint command is genuinely unavailable, record the CLI gap and use render validation as a fallback. That fallback is not a clean lint.

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
npx boxel consolidate-workspaces
```

Merge multiple watched workspaces (advanced — interactive prompts).

### M. Profile management

```sh
npx boxel profile list
npx boxel profile add [-u <matrix-id>] [--matrix-url <url>] [--realm-server-url <url>]
npx boxel profile switch <profile-id>
npx boxel profile remove <profile-id>
npx boxel profile migrate
```

The namespaced CLI uses `add` / `switch` / `remove`, not the legacy standalone `create` / `use` / `delete`. Profile switching changes the global active profile; record the previous profile and restore it after a temporary environment switch.

If a saved profile has credentials but no Matrix access token, re-run `profile add` with the password supplied through `BOXEL_PASSWORD` from a secure source. Never print the password or place it in committed shell history.

## Done Criteria (self-verify)

- [ ] If the operation was destructive (`--delete`, `--force`, `remove`, `milestone --remove`), the user explicitly confirmed before invocation.
- [ ] For `sync`: one of `--prefer-local`, `--prefer-remote`, `--prefer-newest` was specified.
- [ ] After pull/sync: `.boxel-sync.json` exists in the local directory.
- [ ] After push/sync: `npx boxel realm status <dir>` returns clean (no pending changes).
- [ ] After GTS push/sync: installed npm `boxel` lint was clean for each changed `.gts` file (`npx boxel file lint ... --file <local-file>` before push and `npx boxel lint <path> --realm <url>` after push).
- [ ] After GTS push/sync: a typed CLI search returned the expected HTML relationships for prerendered formats, AND at least one affected card was opened in the live app to exercise `isolated`.
- [ ] After the first push to a fresh realm: definitions were ready before instances were written, and at least one nested compound-field instance was read back and compared with local source.
- [ ] The workspace root `.gitignore` continues to exclude `realms-staging.stack.cards/`, `app.boxel.ai/`, `stack.cards/` — realm content stays out of the workspace repo.

## Failure Recovery

- **"directory is not a Boxel realm sync target"** → no manifest. Start with `npx boxel realm pull`.
- **Sync conflict with no preference flag** → re-run with `--prefer-local|remote|newest`, or pull first and resolve by hand.
- **Push rejected "remote has newer version"** → pull/sync first, OR use `--force` (overwrites remote — confirm).
- **Watch won't start ("locked")** → another watcher is running. `npx boxel realm watch stop` first.
- **Realm not reachable** → `npx boxel realm wait-for-ready --realm <url>` to block until ready.
- **Indexing stuck** → `npx boxel realm cancel-indexing --realm <url>` to clear the queue.
- **Installed CLI missing commands** → `/usr/local/bin/boxel` may be stale. Rebuild from `~/Projects/boxel/packages/boxel-cli` and re-link.
- **Profile has no stored Matrix access token** → re-run `npx boxel profile add` for that identity with `BOXEL_PASSWORD` supplied securely, then restore the previously active profile after the task.
- **Fresh realm has the right card count but blank nested content** → stop debugging CSS. Read the stored JSON, wait for schemas to become ready, then force `npx boxel file write` for every affected instance. `realm sync` can skip them because local hashes did not change.

## Hand-off

- After a successful pull/sync, the next step is usually `/boxel-preview-card` to confirm the live app renders correctly.
- After push, `/boxel-preview-card` confirms the realm server indexed the change.
- If a push surfaced a runtime error, switch to `/boxel-debug-runtime`.
- For federated cross-realm search, `npx boxel search` is also reachable via host command `SearchCardsByQueryCommand` from inside the app (see `/boxel-search-cards`).
