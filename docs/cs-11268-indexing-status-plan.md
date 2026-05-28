# CS-11268 — `boxel realm indexing-status` command

## Goal

Give agents (and humans) a one-call way to list every entry in a realm whose latest indexing attempt errored. Today the data only lives on `boxel_index.error_doc` rows; there is no HTTP surface for it. This ticket adds:

1. `GET /_indexing-errors` on the realm-server.
2. `boxel realm indexing-status --realm <url> [--json]` on the CLI.
3. A hand-authored plugin skill so agents can discover the command.

Out of scope: queue depth / running-job progress (later, same command name), filtering by error type, retry/clear, host UI.

## Assumptions

- `boxel_index` PK is `(url, realm_url)` (migration `1735832183444_add-boxel-index-working.js`) — the `realm_version` column is a row attribute, not part of the PK. The upsert in `index-writer.ts:755–774` overwrites the prior row, so a successful re-index after a failure replaces the error row. No staleness filter needed.
- All entry types (instance, module, file, etc.) with `has_error = TRUE` and not deleted should be reported. The publishability scan filters to `type = 'instance'` because *publishability* is an instance concept; the new endpoint is broader.
- Auth model mirrors `_publishability` / `_dependencies` — realm JWT carried by the router; no extra checks in the handler.
- CLI default output: `<url>  <title-or-message>` (one row per error, single line, truncated). `--json` emits the raw JSON-API document.

## Steps

1. **Server endpoint** (`packages/runtime-common/realm.ts`).
   - Register `.get('/_indexing-errors', SupportedMimeType.JSONAPI, this.indexingErrors.bind(this))` in the route table at `realm.ts:911+` (next to `_publishability` and `_dependencies`).
   - Add `private async indexingErrors(_request, requestContext)` near `publishability()` at `realm.ts:5614+`. SQL:
     ```
     SELECT url, error_doc, timing_diagnostics FROM boxel_index
     WHERE realm_url = $1
       AND has_error = TRUE
       AND (is_deleted IS NULL OR is_deleted = FALSE)
     ORDER BY url
     ```
     Return JSON-API: `{ data: rows.map(r => ({ type: 'indexing-error', id: r.url, attributes: { errorDoc: r.error_doc, timingDiagnostics: r.timing_diagnostics } })) }`.

2. **Realm-server integration test** (`packages/realm-server/tests/realm-endpoints/indexing-errors-test.ts`).
   - Modeled on `publishability-test.ts` "with error documents" module — same seed/UPDATE-into-`boxel_index` pattern.
   - Assert: 200, exactly one entry, `id` matches the broken card URL, `attributes.errorDoc.message` present, `attributes.timingDiagnostics` field present (may be null).
   - Second test: clean realm returns `data: []`.

3. **CLI command** (`packages/boxel-cli/src/commands/realm/indexing-status.ts`).
   - Mirror `wait-for-ready.ts` structure. Two interfaces (programmatic + CLI), a core async `indexingStatus(realmUrl, options)` returning a `Result`, a `registerIndexingStatusCommand(realm)`.
   - Three-branch output, like `cancel-indexing.ts:98–111`: `--json` → raw JSON via `cliLog.output`; default success → human-readable count + rows; transport error → `FG_RED` and `process.exit(1)`.

4. **Register** in `packages/boxel-cli/src/commands/realm/index.ts`.

5. **BoxelCLIClient method** (`packages/boxel-cli/src/lib/boxel-cli-client.ts`). Add `realmIndexingStatus(realmUrl)` that delegates to the core function (mirror the `waitForReady` delegation pattern at line 335).

6. **CLI integration test** (`packages/boxel-cli/tests/integration/realm-indexing-status.test.ts`). Mirror `realm-wait-for-ready.test.ts`. Seed an erroring card by UPDATEing the index after `fullIndex()`; assert default + `--json` shapes; assert error path.

7. **Plugin skill** (`packages/boxel-cli/plugin/skills/indexing-status/SKILL.md`). Hand-authored, matches the structure of `realm-history/SKILL.md`. Includes the generated-commands block; `pnpm build:plugin` fills it in.

## Target files (new)

- `packages/runtime-common/realm.ts` (modify)
- `packages/realm-server/tests/realm-endpoints/indexing-errors-test.ts` (new)
- `packages/boxel-cli/src/commands/realm/indexing-status.ts` (new)
- `packages/boxel-cli/src/commands/realm/index.ts` (modify)
- `packages/boxel-cli/src/lib/boxel-cli-client.ts` (modify)
- `packages/boxel-cli/tests/integration/realm-indexing-status.test.ts` (new)
- `packages/boxel-cli/plugin/skills/indexing-status/SKILL.md` (new)

## Testing

```
cd packages/realm-server && TEST_FILES=realm-endpoints/indexing-errors-test pnpm test
cd packages/boxel-cli && pnpm test
cd packages/runtime-common && pnpm lint
cd packages/realm-server && pnpm lint
cd packages/boxel-cli && pnpm lint
cd packages/boxel-cli && pnpm build:plugin   # confirm the generated commands block updates
```
