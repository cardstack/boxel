---
name: indexing-operations
description: Realm reindexing and indexing-job control commands.
boxel:
  kind: skill
  tools:
    - codeRef:
        module: '@cardstack/boxel-host/tools/invalidate-realm-identifiers'
        name: default
        requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/reindex-realm'
        name: default
        requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/full-reindex-realm'
        name: default
        requiresApproval: false
    - codeRef:
        module: '@cardstack/boxel-host/tools/cancel-indexing-job'
        name: default
        requiresApproval: false
---

# Indexing Operations

Indexing reads realm content and updates the search/query index used by Boxel.

## Invalidate Specific Resource Identifiers

Use this when a user wants specific files re-indexed for a realm. The user may ask that the card be refreshed or reloaded when they want a card to be re-indexed.

### Preconditions

- User has `write` access to the target realm.
- `realmIdentifier` is known.
- `resourceIdentifiers` contains the specific file or card identifiers that should be re-indexed.

### Behavior

- Triggers incremental indexing for the specified resource identifiers.
- Use this to target specific files instead of canceling or starting broader indexing work.
- The command accepts multiple resource identifiers in one request.

### Command Call Template

```json
{
  "name": "invalidate-realm-identifiers_xxxx",
  "payload": {
    "description": "Trigger indexing for specific files in this realm",
    "attributes": {
      "realmIdentifier": "<realmIdentifier>",
      "resourceIdentifiers": ["<resourceIdentifier1>", "<resourceIdentifier2>"]
    }
  }
}
```

## Reindex Realm

Use this when a user wants to reindex a realm using the normal, lighter/default mode.

### Preconditions

- User has `write` access to the target realm.
- `realmUrl` is known.

### Behavior

- Republishes a from-scratch indexing job in the lighter/default mode.
- Use this when the user wants to pick up normal recent changes or refresh a realm.
- This is broader than invalidating specific URLs and lighter than a full reindex.

### Command Call Template

```json
{
  "name": "reindex-realm_xxxx",
  "payload": {
    "description": "Reindex this realm using the default mode",
    "attributes": {
      "realmUrl": "<realmUrl>"
    }
  }
}
```

## Full Reindex Realm

Use this when a user wants a full rebuild of a realm index.

### Preconditions

- User has `write` access to the target realm.
- `realmUrl` is known.

### Behavior

- Forces a full realm reindex so every file is revisited.
- Use this when the user suspects indexing drift, stale results, or wants a deep/full refresh.
- This is heavier than the normal reindex command.

### Command Call Template

```json
{
  "name": "full-reindex-realm_xxxx",
  "payload": {
    "description": "Force a full reindex of this realm",
    "attributes": {
      "realmUrl": "<realmUrl>"
    }
  }
}
```

## Cancel Running Indexing Job

Use this when a user asks to stop indexing for a specific realm.

### Preconditions

- User has `write` access to the target realm.
- `realmUrl` is known.

### Behavior

- Cancels currently running jobs in concurrency group `indexing:<realmUrl>`.
- Includes both from-scratch and incremental indexing jobs.
- Does not cancel pending indexing jobs.
- Endpoint response is `204 No Content`, including no-op cases.

### Command Call Template

```json
{
  "name": "cancel-indexing-job_xxxx",
  "payload": {
    "description": "Cancel the currently running indexing job for this realm",
    "attributes": {
      "realmUrl": "<realmUrl>"
    }
  }
}
```

## Post-push verification gate

After any multi-file push, verify that the realm actually indexed the cards — **push success does not mean index success.** The `/_atomic` endpoint will write files to disk and return ok while silently dropping some indexing jobs.

Sample command from the shell:

```sh
# Expected card instances under a kit (skip .gts modules, _learnings, Theme JSON)
expected=$(find <kit-dir> -name "*.json" -not -path "*/Theme/*" -not -name "_*" | wc -l)
# Currently indexed CardDef instances
indexed=$(npx boxel search --realm <url> --query \
  '{"filter":{"type":{"module":"https://cardstack.com/base/card-api","name":"CardDef"}}}' --json \
  | jq '.data | length')
echo "$indexed / $expected indexed"
```

Sample at 30-second intervals for 5 minutes. Rising count = just slow, leave it alone. Flat count = stuck. Far below expected = jobs were dropped.

## The `/_atomic` batch trap

Pushing 30+ files via `npx boxel realm push <dir>` uses the `/_atomic` HTTP endpoint. Observed failure modes (institutional-meerkat, 2026-05-22):

- **351 files at once** → 500 Internal Server Error; push reports failure.
- **30-44 files per atomic batch** → push reports success, but a fraction of indexing jobs are silently dropped. Cards land on disk but never index.
- **Per-file `npx boxel file write`** → reliably enqueues an index job per file.

**Recommended push cadence for a fresh realm with > 50 instances:**

1. Push one CardDef family at a time (its `.gts` modules + Theme + a small batch of instances).
2. Verify with the post-push gate above before pushing the next.
3. Use `npx boxel realm sync` instead of `push` when in doubt — sync acks per file.
4. Fall back to `npx boxel file write <path>` for the last few stragglers a batch may have dropped.

## Don't reach for `cancel-indexing`

`cancel-indexing` interrupts work the realm is actively doing. `--cancel-pending` is sharper — it discards the realm's queued TODO list. Both leave the index in a worse state when used to "recover from slow."

**Default behavior:** don't call `cancel-indexing` (with or without flags). Slow is not stuck. Sample the indexed count for 5+ minutes; rising = leave it alone.

If the count is genuinely flat for 10+ minutes with no progress at all:

1. First try `npx boxel file touch <one card>` to nudge a single card through. If that one indexes, the queue is alive.
2. Only after that fails should you consider `cancel-indexing` — base form only, never `--cancel-pending`.
3. `full-reindex-realm` is the right way to rebuild from scratch — it doesn't need `cancel-indexing` first.

## Inspecting indexer errors

The realm stores per-card indexer error state in postgres `boxel_index.error_doc`. Endpoints + tools:

| Need                                 | How                                                                                                                                                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compile errors per .gts              | `npx boxel file lint <path> --realm <url> --file <local-path>`                                                                                                                              |
| Try to load a card TYPE              | `npx boxel run-command @cardstack/boxel-host/tools/instantiate-card/default --realm <url> --input '{"moduleIdentifier":"<module-url>","cardName":"<ClassName>","realmIdentifier":"<url>"}'` |
| Force reindex of one card            | `npx boxel file touch <path> --realm <url>`                                                                                                                                                 |
| Force reindex of whole realm         | `npx boxel run-command @cardstack/boxel-host/tools/full-reindex-realm/default --realm <url> --input '{"realmIdentifier":"<url>"}'`                                                          |
| Authoritative error_doc list (admin) | `GET <realm>/_publishability` — requires `authedRealmFetch`; no CLI subcommand yet                                                                                                          |

### Postgres `\u0000` symptom

If a card URL returns 500 with `code: "22P05"` and `detail: "\u0000 cannot be converted to text"`, the indexer crashed mid-process and cached an error message containing invalid UTF-8 bytes into the postgres JSON column. The card's JSON file is usually clean — the bad bytes came from a downstream resolver (FileDef fetch, compiled-module cache, error-message serialization). Recovery escalation:

1. `npx boxel file touch <the-card-path>` — forces a fresh reindex of that card.
2. `npx boxel file write <the-card-path> --realm <url> --file <local>` — re-pushes the local file.
3. `npx boxel file touch <the-card's-.gts-module>` — forces recompile of the type.
4. Full realm reindex.

Upstream fix needed: realm-server should sanitize indexer error messages (strip 0x00–0x1F control chars) before persisting them, or store error blobs as bytea. Without this, a single bad byte in any error path can stick a card in error state permanently.

## Verification hierarchy — lint vs index vs render

`npx boxel file lint` and `npx boxel lint --realm` are advisory only. Declaring "kit shipped" based on lint-clean has caused full-kit indexing failures to be reported as success. **The truth source for indexing state is `npx boxel search`.**

| Check                                                    | Validates                                             | Does NOT validate                                |
| -------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------ |
| `npx boxel file lint <path> --realm <url> --file <path>` | Local JSON/GTS structure, basic syntax                | Module evaluation, indexing, render              |
| `npx boxel lint <path> --realm <url>`                    | TypeScript / boxel static checks against realm config | Module evaluation at runtime, indexing           |
| `npx boxel run-command get-card-type-schema`             | **Module evaluation** — does the .gts actually load?  | Whether instances index, whether rendering works |
| `npx boxel search --realm <url> --query '{}'`            | **Truth.** What the realm has actually indexed        | Whether the visual render is correct             |
| Loading the card in the host UI                          | Render output                                         | (this is the final truth)                        |

A schema can pass every static check and still fail to load at runtime. A module can load and still produce zero indexed instances. **Only `npx boxel search` reads the truth state of the realm.**

Required gate before declaring "kit shipped":

```sh
REALM="<realm-url>"

# 1. Module load probe — exercise every CardDef
for mod in style material designer client project quote; do
  npx boxel run-command @cardstack/boxel-host/tools/get-card-type-schema/default \
    --realm "$REALM" \
    --input "{\"codeRef\":{\"module\":\"${REALM}${mod}\",\"name\":\"<ClassName>\"}}" \
    --json | grep -E "status|error"
done

# 2. Index population — count actual indexed cards per type. ABSOLUTE URLs only.
for type_pair in "style:Style" "material:Material" "project:Project"; do
  mod="${type_pair%:*}"
  name="${type_pair#*:}"
  count=$(npx boxel search --realm "$REALM" \
    --query "{\"filter\":{\"type\":{\"module\":\"${REALM}${mod}\",\"name\":\"${name}\"}}}" \
    --json | python3 -c "import json,sys;raw=sys.stdin.read();s=raw.find('[');e=raw.rfind(']')+1;print(len(json.loads(raw[s:e])))")
  echo "$name: $count"
done

# 3. fs vs index parity — every file on disk should be indexed
diff <(ls Project/*.json | wc -l) <(... search count ...)
```

If any module returns error from step 1 OR if step 2 returns 0 anywhere there should be instances, **the kit is NOT shipped** regardless of what lint says.

### Why lint can pass while indexing fails

Module load failures happen at JavaScript module evaluation time inside the realm-server. Lint runs static checks on local files OR boxel-specific checks against realm config. Neither runs the module's `<static_initializer>` blocks (which decorate fields, declare types, and execute thunks). Common failures that lint misses:

- Named import where the module exports only a default (`import { DateField } from '.../date'` → DateField is undefined → cardOrThunk error)
- Default-import from a module whose default is a DIFFERENT class (`import ImageDef from '.../base/image'` → actually gets `ImageCard`)
- Thunk references a class that itself fails to load (cycle, wrong import, missing dependency)
- `computeVia` or `get`-method that throws at module-evaluation time
- A bare `linksTo(X)` without thunk in a kit with back-edges — X is not yet evaluated when the field decorator runs

Each passes `npx boxel file lint` clean. Each makes `npx boxel search` return empty for that type.

### Error-decoder — common runtime errors and their upstream cause

| Symptom                                                            | Where                                               | Cause                                                                                                                                                                                     |
| ------------------------------------------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cardOrThunk was undefined. There might be a cyclic dependency...` | `get-card-type-schema` output, or indexer error_doc | A thunk dereferenced undefined. Either a named import doesn't exist on the source module, OR a cycle prevented the target class from being defined in time.                               |
| `Unexpected token (1:0)` from acorn's `parseExprAtomDefault`       | Host (browser) loading a transpiled module          | The realm couldn't compile the `.gts`; it returned HTML 500; the host's JS parser hit `<` at byte 0. Same upstream cause as cardOrThunk. Use `get-card-type-schema` to find which module. |
| `Export "X" not found in module "Y"`                               | `get-card-type-schema` probing a named export       | The module doesn't export X (named). Probably a default-only export — switch to `import X from 'Y'`.                                                                                      |
| `Cannot resolve bare package specifier "X/Y"`                      | `LinksTo.deserialize` in card-api                   | An instance's `links.self` is a bare path. Must start with `./`, `../`, or be a full URL.                                                                                                 |
| `Instance ... is not a card resource document`                     | Indexer error_doc                                   | Almost certainly: `linksToMany` written as an array under `links.self` instead of indexed-key shape.                                                                                      |
| 403 Access Denied (XML body) from `boxel-icons.boxel.ai`           | Host load                                           | A phantom icon — present in workspace source files but never deployed. CDN-verify with curl before assigning.                                                                             |

## Moving `.gts` files strands existing instances

When you rename or move a `.gts` file mid-session (e.g. `architecture-plan.gts` → `plan/architecture-plan.gts`), every existing instance that adopts from it still points at the OLD location via `meta.adoptsFrom.module`. The instances are stranded:

- Lint passes (the local JSON is structurally fine).
- Indexer fails silently — module resolves to a 404, instance never indexes as the expected type.
- `npx boxel search --query '{}'` shows the instance URL but with `adoptsFrom` pointing nowhere useful.
- A type-filtered search returns 0 even though instances appear to exist on disk.

The discipline: **before any `.gts` move or rename, grep `adoptsFrom.module` across instance JSONs in the realm and rewrite them atomically as part of the same change.**

```sh
# Find every instance referencing the about-to-be-moved module
grep -rl "\"module\":\s*\"\.\./architecture-plan\"" --include='*.json' .

# Rewrite atomically (example: move from root to plan/)
find . -name '*.json' -exec sed -i.bak \
  -e 's|"module": "../architecture-plan"|"module": "../plan/architecture-plan"|g' {} \;
```

Auto-generated stub instances (created by host "+ New" clicks, named with UUID) are common collateral here — they're in `<ClassName>/<uuid>.json` folders and easy to miss. Delete or rewrite them along with the move.

## Realm creation — local folder is NOT a realm

Creating a directory at `<realm-server>/<owner>/<slug>/` does NOT create a realm on the server. The server has no idea that path exists. Pushing files into it via `npx boxel file write` may appear to succeed (write to local mirror) but the realm doesn't index anything because there's no realm registered for that path.

**To create a realm:**

```sh
npx boxel realm create <slug> "<Display Name>"
```

This registers the realm with the user's Matrix account, creates the server-side database entry, and bootstraps the realm config. THEN local folders + file pushes make sense.

A clue that a realm doesn't exist: `npx boxel search --realm <url> --query '{}'` returns auth errors or empty results consistently. A clue that it DOES exist but is empty: the search returns just the `realm` config card.

## Host-only commands that can't run from the CLI

Some host commands require a browser context with a Matrix client to persist their results. Notable examples:

- **`generate-thumbnail`** — generates a card thumbnail image. From the CLI it runs, returns a base64 blob, but cannot persist it because there's no browser-side Matrix client to write the resulting file/relationship to the realm. Run these from the Boxel host UI ("Generate Thumbnail" button on the card), not via `npx boxel run-command`.
- Any command whose docstring mentions "saves the card" or "uploads to realm" with a browser-only auth dependency.

CLI-friendly commands (no browser dependency): `get-card-type-schema`, `full-reindex-realm`, `invalidate-realm-identifiers`, `search-cards`, `instantiate-card` for read-only schema introspection.
