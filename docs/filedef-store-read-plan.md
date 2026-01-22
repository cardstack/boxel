# Plan: Explicit Store read type for FileDef

## Background

- Project: First-class File Fields (FileDef) focuses on first-class file-backed "card-like" entities and JSON:API file-meta access.
- Current heuristic in `packages/host/app/services/store.ts` (`looksLikeFileURL`) decides when to load file-meta docs.
- Requirement: `peek`, `peekLive`, `peekError`, and `get` should accept a `type` argument that defaults to "card" and can be set to "file-meta" to explicitly load FileDef instances.
- New requirement: FileDef instances should participate in garbage collection and reference counting, which currently live inside `CardStoreWithGarbageCollection`.

## Goals

- Replace the file URL heuristic with an explicit `type` parameter.
- Preserve existing call sites with default `type="card"`.
- Update types so callers can express FileDef returns when `type="file-meta"`.
- Update any call sites that relied on the heuristic to pass `type="file-meta"`.
- Avoid introducing a new base class; `CardDef` and `FileDef` already extend `BaseDef`.
- Keep Store read APIs limited to persisted types; `FieldDef` extends `BaseDef` but is not loadable via Store.
- Ensure file-meta instances participate in GC and reference counting.
- Keep FileDef read-only behavior (no save/auto-save).

## Assumptions / questions to confirm

- Errors should be separated by read type (card vs file-meta) to avoid cross-contamination when the same URL is read in both modes.
- A dedicated `FileMetaResource` should be introduced (instead of overloading `CardResource`) to read file-meta instances.
- FileDef instances are read-only and cannot be persisted via Store APIs.

## Plan

1. Audit store read call sites
   - Search for `store.get`, `store.peek`, `store.peekLive`, `store.peekError` that may pass file URLs or expect FileDef values.
   - Identify locations that should switch to `type="file-meta"` (file chooser, file-specific UI, any FileDef-specific flows).

2. Update runtime-common Store types
   - Add a `StoreReadType` union (`"card" | "file-meta"`).
   - Add overloads on `Store` read methods so `type="file-meta"` returns `FileDef` and default returns `CardDef`.
   - If needed, introduce a shared `CardOrFileDef` alias to reduce duplication; avoid adding a new base class.
   - Files: `packages/runtime-common/index.ts`.

3. Expand CardStore for file-meta GC and reference counting
   - Update `CardStoreWithGarbageCollection` to accept both card and file-meta reference counts (or a unified map).
   - Track file-meta errors in a dedicated bucket (or via a typed key) to keep error separation while still centralizing storage.
   - Update `sweep()` to consider FileDef instances as GC candidates and roots when referenced; treat them as leaf nodes (no dependency graph).
   - Ensure `delete()` and `reset()` clear file-meta instances and errors consistently.
   - Files: `packages/host/app/lib/gc-card-store.ts`.

4. Update StoreService read APIs
   - Add `type?: StoreReadType` to `peek`, `peekLive`, `peekError`, `get`.
   - Thread `type` through `getInstance` and use explicit branches:
     - `type="file-meta"`: call `store.loadFileMetaDocument` and `api.createFromSerialized` to build a FileDef.
     - `type="card"`: load card source as before.
   - Remove or gate `looksLikeFileURL` so it is only used for validation (if at all), not as a decision mechanism.
   - Ensure in-flight caches (`inflightGetCards`) and identity lookups are keyed by `(id, type)` to avoid cross-type collisions.
   - Wire file-meta reference counts into `CardStoreWithGarbageCollection` so GC sees both card and file-meta roots.
   - Files: `packages/host/app/services/store.ts`.

5. Update consumers that need file-meta
   - Pass `type="file-meta"` where FileDef instances are expected (post-audit).
   - If any resource or helper (e.g., `CardResource`) is used for file-meta reads, add a typed option or new helper.
   - Files likely include `packages/host/app/resources/card-resource.ts` and any file-specific services/components discovered in step 1.

6. Add/adjust tests
   - Add a focused store test covering explicit file-meta reads:
     - `store.get(fileUrl, "file-meta")` returns a FileDef with expected metadata.
     - `store.peek(fileUrl, "file-meta")` uses cached FileDef.
     - Default `store.get(fileUrl)` attempts card read (expected error or non-file behavior).
   - Add GC/reference-count coverage for file-meta:
     - Create a FileDef, add a reference, run `sweep()` and ensure it is retained.
     - Drop references, run `sweep()` and ensure the FileDef instance is released.
   - Candidate file: `packages/host/tests/integration/store-test.gts`.

## Target files

- `packages/runtime-common/index.ts`
- `packages/host/app/lib/gc-card-store.ts`
- `packages/host/app/services/store.ts`
- `packages/host/app/resources/card-resource.ts` (if needed)
- Any audited call sites that rely on file-meta heuristics
- `packages/host/tests/integration/store-test.gts` (or another store-focused test file)

## Testing notes

- `cd packages/host && pnpm lint`
- `cd packages/realm-server && pnpm lint` (runtime-common change)
- Run a focused store test, e.g. `cd packages/host && ember test --path dist --filter "store"` (or a narrower filter once the test name is chosen)
