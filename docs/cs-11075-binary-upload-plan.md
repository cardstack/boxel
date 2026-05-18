# CS-11075 — Ensure binary file uploads work reliably via boxel-cli

Linear: https://linear.app/cardstack/issue/CS-11075
Branch: `cs-11075-ensure-that-uploading-binary-files-to-realm-works-reliably`

## Context

`boxel-cli`'s realm-sync code reads every file off disk with `'utf8'` encoding and writes every downloaded file back with `'utf8'`. For text (`.gts`, `.json`, `.md`) this is fine; for binary assets (PNG, JPEG, PDF, fonts, etc.) it silently corrupts bytes — invalid UTF-8 sequences round-trip through `String`/`JSON.stringify` and get replaced with `U+FFFD` or truncated. The realm-server already has a working binary endpoint (`Content-Type: application/octet-stream` → `upsertBinaryFile` at `packages/runtime-common/realm.ts:3282`, routed at `realm.ts:928-932`), and the Ember host package already uses it correctly. boxel-cli simply never takes that path.

This ticket fixes the upload + download + watch flows in boxel-cli so a folder containing images / PDFs / fonts pushed via `boxel workspace push` lands in the realm intact, and the same bytes come back through `pull` / `sync` / `watch`.

## Current behavior

- `packages/boxel-cli/src/lib/realm-sync-base.ts:399` — `uploadFile` does `fs.readFile(localPath, 'utf8')` and POSTs with `Content-Type: text/plain;charset=UTF-8`, `Accept: SupportedMimeType.CardSource`.
- `packages/boxel-cli/src/lib/realm-sync-base.ts:454` — `uploadFilesAtomic` does `fs.readFile(localPath, 'utf8')` and embeds the string inside `data.attributes.content` of an `application/vnd.api+json` payload to `/_atomic`. Binary cannot survive this JSON serialization.
- `packages/boxel-cli/src/lib/realm-sync-base.ts:562-567` — `downloadFile` reads `response.text()` and writes with `fs.writeFile(localPath, content, 'utf8')`. Same corruption on the way back.
- `packages/boxel-cli/src/commands/file/write.ts:109` — single-file `boxel file write` does `readFileSync(opts.file, 'utf-8')`.
- `packages/boxel-cli/src/lib/sync-manifest.ts:42` — `computeFileHash` already reads as a `Buffer` (no encoding). No change needed.
- `packages/boxel-cli/tests/integration/*` — no binary fixtures, no PNG/PDF/font/JPEG coverage.

## Reuse — the canonical pattern is in this repo

We mirror what `packages/host` does today, not invent a new wire format.

- Detect binary by filename extension via `isBinaryFilename(filename)` at `packages/runtime-common/infer-content-type.ts:23`. Treats SVG as text (XML), and `image/*`, `font/*`, `application/pdf`, and `.eot` as binary.
- Upload binary with `POST <realm-url>/<path>` carrying `Content-Type: application/octet-stream` and raw bytes as the body — see `packages/host/app/services/file-upload.ts` and `packages/host/app/commands/write-binary-file.ts`.
- Download with `Accept: application/vnd.card+source` (the realm serves the bytes back regardless) but consume `response.arrayBuffer()` instead of `response.text()` and write the resulting `Uint8Array` with no encoding argument.
- Keep `/_atomic` as a text-only batch endpoint. Binary files in a push batch are split out and POSTed per-file alongside the atomic call for the text files.

## Approach

Add a single decision point — `isBinaryFilename(relativePath)` — at each upload/download site, and branch into a `Buffer`/`Uint8Array` path that mirrors the host's request shape. No realm-server changes.

### Files modified

1. `packages/boxel-cli/src/lib/realm-sync-base.ts`
   - `uploadFile`: if `isBinaryFilename(relativePath)`, read as `Buffer` and POST with `Content-Type: application/octet-stream`. Otherwise the existing utf-8 path is unchanged.
   - `uploadFilesAtomic`: partition entries into text and binary. Text rides the atomic JSON batch; binary rides per-file `application/octet-stream` POSTs in parallel. Failures are merged into the existing `perFile` error shape.
   - `downloadFile`: if `isBinaryFilename(relativePath)`, consume `response.arrayBuffer()` and write with no encoding.
   - Factor the per-file binary POST into a shared private helper.

2. `packages/boxel-cli/src/commands/file/write.ts`
   - When `opts.file` is provided and `isBinaryFilename(opts.file)`, read it as a `Buffer` and POST as `application/octet-stream`. Stdin stays utf-8 (out of scope).

3. `packages/boxel-cli/src/commands/file/read.ts`
   - Mirror the download change: if the requested URL path is a binary filename, write the bytes verbatim to disk instead of stringifying.

4. `packages/boxel-cli/src/lib/sync-logic.ts` / `realm-pull.ts` / `realm-sync.ts` / `realm-watch.ts`
   - All flow through `RealmSyncBase`'s primitives; no extra changes expected. Verified via test runs.

### Reused helpers (no new code)

- `isBinaryFilename(filename: string): boolean` — `packages/runtime-common/infer-content-type.ts:23`
- `SupportedMimeType.OctetStream` — `packages/runtime-common` (used by the realm router at `realm.ts:930`)

## Tests

Runner: vitest. Tests under `packages/boxel-cli/tests/integration/` against a real in-process realm-server (`tests/helpers/integration.ts`).

Inline PNG fixture: a 67-byte 1×1 transparent PNG as `Buffer.from([...])` at the top of the test file — non-UTF-8 bytes guaranteed, no fixture files committed.

Added roundtrip tests:

1. `tests/integration/realm-push.test.ts` — pushes a PNG and reads it back byte-identical via `authedRealmFetch` + `arrayBuffer()`.
2. Same file — mixed batch of `.gts` + `.png` in one push call; verifies the binary file is carved out into a per-file POST while the text file still rides `/_atomic`, both byte-identical on the server.
3. `tests/integration/realm-pull.test.ts` — seed the realm with PNG bytes, pull, read local file as Buffer, assert byte equality.
4. `tests/integration/realm-sync.test.ts` — push-then-pull bidirectional binary test.
5. `tests/integration/realm-watch.test.ts` — modify a watched binary file, assert mirrored remote bytes match.
6. `tests/integration/file-write.test.ts` + `file-read.test.ts` — single-file commands roundtrip a PDF (or PNG) byte-identically.

Assertions use `Buffer.equals` / `new Uint8Array(...).toEqual(...)` — never `.toString()` comparisons that would hide corruption.

## Verification

1. `cd packages/boxel-cli && pnpm install && pnpm build`
2. `cd packages/boxel-cli && pnpm test` — full suite green.
3. Start a local realm-server (`cd packages/realm-server && pnpm start:all`).
4. Scratch folder with a real PNG, PDF, `.woff2`, and `.gts` file.
5. `boxel workspace push <scratch-folder> --realm <local-realm-url>`
6. In a browser, hit the realm: PNG renders, PDF opens, font downloadable; `.gts` still readable as text.
7. Delete local copies, `boxel workspace pull --realm <local-realm-url>`, `shasum -a 256` against originals — all match.
8. Edit one binary file under `boxel workspace sync --watch`; remote bytes update and `curl` round-trips byte-identically.

## Out of scope

- Larger-than-default `realm.write` size limits — 413 stays as-is.
- Streaming uploads for very large binaries — match host's in-memory buffering.
- Base64-in-/_atomic — host doesn't do it; per-file fallback is simpler with no server change.
- Binary content piped via stdin to `boxel file write` — stdin stays utf-8.
