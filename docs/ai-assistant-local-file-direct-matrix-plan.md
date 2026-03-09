# AI Assistant Local File Direct-to-Matrix Plan

## Goal

Add a third attachment source in the AI Assistant panel so the plus menu offers:

- `Attach a Card`
- `Attach a File (Workspace)`
- `Attach a File (Your Computer)`

and support a direct local-disk-to-Matrix media path for `Attach a File (Your Computer)`.

For local files, metadata extraction must match realm indexing behavior:

- resolve `FileDef` subclass via extension map
- run `extractAttributes` for that subclass (with fallback behavior)
- send the resulting `FileDef` JSON inline in attachment payloads

## Execution Plan (Actual)

### Phase 0: Tracking and Scope Alignment

- [x] Create/move Linear issue in `linear_cardstack` (not `linear_yapp`)
- [ ] Link this plan doc in the correct Linear issue
- [ ] Confirm acceptance criteria:
  - plus menu has exactly `Attach a Card`, `Attach a File (Workspace)`, `Attach a File (Your Computer)`
  - local file path does not upload file bytes to realm
  - local file path uploads file bytes to Matrix and includes serialized `FileDef` in message payload
  - local file extraction behavior matches realm indexing semantics

### Phase 1: Core Upload Contract

- [x] Add `FileDefManager.prefetchLocalFileContent(...)`
- [x] Add local-source guardrails in `uploadFiles(...)`:
  - error when synthetic local source has no prefetched bytes
- [x] Add/adjust tests for these contract changes

### Phase 2: Local FileDef Extraction Parity

- [x] Add reusable extractor path that mirrors realm indexing:
  - extension -> subclass via `resolveFileDefCodeRef(...)`
  - extraction via `extractAttributes(...)` with same fallback semantics
- [x] Use extractor for local-computer attach flow
- [x] Add parity tests against representative file types

### Phase 3: Attachment UI + Service Plumbing

- [x] Update plus menu labels and actions:
  - `Attach a Card`
  - `Attach a File (Workspace)`
  - `Attach a File (Your Computer)`
- [x] Add local picker API that returns native `File` without realm upload
- [x] Wire room component to:
  - build synthetic-source local `FileDef`
  - prefetch local bytes into matrix/file manager
  - call existing eager upload/send path

### Phase 4: Validation and Cleanup

- [x] Add integration coverage for:
  - menu rendering + labels
  - local attach happy path
  - no realm upload for local files
  - Matrix bytes upload for local files
- [x] Run `pnpm lint` in touched package(s)
- [ ] Run targeted tests for touched package(s)
- [ ] Remove dead code / tighten types / finalize error copy

## Current Progress Snapshot

- Completed:
  - `packages/base/file-api.gts` keeps canonical `FileDef` serialization as attachment payload
  - `packages/host/app/lib/file-def-manager.ts` local prefetch API and local upload handling
- Remaining:
  - Full targeted test execution in local env (blocked in sandbox by `ember test` runtime/port permissions)
  - Link plan doc in Linear issue

## Current Behavior

Today, local disk files are first uploaded to a workspace realm, then attached and uploaded again to Matrix:

1. Local disk -> realm file URL
2. realm file URL -> Matrix media URL

We want to keep (2) for workspace files, but allow local files to skip (1).

## Proposed Behavior

### Attach Menu

- Keep existing card attachment flow.
- Keep existing workspace file picker flow unchanged.
- Add a dedicated local-computer picker flow.

### Data Flow by Attachment Type

- `Attach a File (Workspace)`: unchanged
  - choose realm file metadata
  - prefetch from realm URL
  - eager Matrix upload
- `Attach a File (Your Computer)`: new
  - pick native `File`
  - resolve `FileDef` subclass via extension mapping
  - run `extractAttributes` to build typed file metadata
  - create `FileDef` from extracted attributes with synthetic non-realm `sourceUrl`
  - store picked bytes in prefetch cache immediately
  - eager Matrix upload using cached bytes
  - include serialized `FileDef` JSON inline in message attachments
  - do not POST file bytes to realm

## Design Details

### 1. UI and Component API

Update the attachment picker plumbing to support two file actions:

- `chooseWorkspaceFile(file: FileDef)` (existing behavior)
- `chooseLocalFile()` (new behavior)

This keeps attach-button generic and avoids coupling it to upload services.

### 2. Synthetic Source URL for Local Files

Create local file `FileDef` objects with a synthetic source URL (for identity only), for example:

- `boxel-local://<stable-id>/<filename>`

Requirements:

- Must not include local filesystem paths.
- Must be unique/stable enough to support remove/retry/upload state keys.
- Must not be treated as realm URL for fetch.

### 3. FileDef Extraction Parity (Required)

Local file attachments must use the same file-type resolution and extraction rules
as indexed realm files:

- use `resolveFileDefCodeRef(...)` for extension -> `FileDef` subclass mapping
- use `extractAttributes(...)` for the resolved class, with fallback behavior
  equivalent to `FileDefAttributesExtractor`
- preserve extracted attributes (for example: `contentType`, `contentHash`,
  `contentSize`, and subclass-specific attributes)

Implementation note:

- Prefer introducing a reusable helper that accepts `(fileURL, bytes)` and
  executes the same extract chain used by file-meta extraction today, instead of
  duplicating logic inside the room component.

### 4. Matrix Upload Contract for Local Files

For each local-computer attachment, upload raw file bytes as today and keep the
typed `FileDef` serialization as the attachment JSON payload in the message.
No extra sidecar metadata upload is needed.

### 5. FileDefManager Prefetch API

Extend prefetch support to allow injecting bytes directly (not only fetching from realm URLs):

- Keep `prefetchFileContent(fileDef)` for workspace path.
- Add `prefetchLocalFileContent(fileDef, bytes, contentType)` (or equivalent API name).

`uploadFiles()` should:

- prefer prefetched bytes when available
- only fallback to realm fetch for normal workspace URLs
- provide a clear error if a local synthetic source URL has no prefetched bytes

### 6. Matrix Service Surface

Add service/client passthrough for local prefetch injection so room component can:

1. build local `FileDef`
2. pre-seed prefetch bytes
3. reuse existing eager upload and send flow

### 7. Prompt and Command Expectations

No special prompt format changes are required for initial support.

- Local attachments will appear as normal attachments with synthetic `sourceUrl`.
- `read-file-for-ai-assistant` is realm-file-oriented and will not resolve synthetic local URLs.
- This keeps local-computer attachments context-only/read-only from command perspective.

## Implementation Steps

1. **Attach menu and callback wiring**
- Add `Attach a File (Workspace)` and `Attach a File (Your Computer)` menu items.
- Add new callback arg(s) through attachment picker index/usage.

2. **Local file selection API**
- Add a `file-upload` service method for picking a local file without uploading to realm.
- Return `File | undefined`.

3. **Build local FileDef via extract pipeline**
- In room component, implement `chooseLocalFile` action.
- Resolve subclass using `resolveFileDefCodeRef` with the selected filename.
- Run `extractAttributes` (with fallback semantics) on local bytes.
- Create typed `FileDef` from extracted attributes with a synthetic source URL.

4. **Prefetch/upload bytes**
- Store bytes via new matrix/file-def-manager local prefetch API.
- Add to `filesToSend` and call existing `startFileUpload`.

5. **Client/service plumbing**
- Extend matrix sdk loader proxy + `ExtendedClient` + mock client for new method(s).
- Keep existing workspace flow behavior unchanged.

6. **Guardrails and error handling**
- If local file bytes are missing at upload time, show upload error state and retry affordance.
- Ensure `removeFile` cleanup works for synthetic source URLs.

## Target Files

- `packages/host/app/components/ai-assistant/attachment-picker/attach-button.gts`
- `packages/host/app/components/ai-assistant/attachment-picker/index.gts`
- `packages/host/app/components/ai-assistant/attachment-picker/usage.gts`
- `packages/host/app/components/matrix/room.gts`
- `packages/host/app/services/file-upload.ts`
- `packages/host/app/services/matrix-service.ts`
- `packages/host/app/services/matrix-sdk-loader.ts`
- `packages/host/app/lib/file-def-manager.ts`
- `packages/host/app/utils/file-def-attributes-extractor.ts`
- `packages/runtime-common/file-def-code-ref.ts`
- `packages/base/file-api.gts`
- `packages/host/tests/helpers/mock-matrix/_client.ts`

## Test Plan

### Integration tests

- Attachment menu shows three options with exact labels.
- Local file pick attaches a file pill and starts eager upload.
- Sending message with local file works with no realm upload.
- Local file extraction picks the same subclass as realm indexing for the same extension.
- Local file metadata extraction uses `extractAttributes` and includes subclass-specific attributes.
- Matrix upload includes file bytes, while message attachments include serialized `FileDef`.

### Service/unit tests

- `FileDefManager.uploadFiles()` uses injected prefetched bytes for local files.
- Missing prefetched bytes for synthetic local URL yields actionable error.

### Regression coverage

- Workspace file attach behavior remains unchanged.
- Existing binary dedupe tests continue to pass.

## Risks and Mitigations

- **Risk:** synthetic source URL collides
  - **Mitigation:** include stable id + filename (and optionally size/mtime/hash).
- **Risk:** accidental realm upload in local flow
  - **Mitigation:** explicit no-realm branch + tests asserting no realm POST.
- **Risk:** drift from realm indexing extraction semantics
  - **Mitigation:** share extraction helper/path and add parity tests against known file types.
- **Risk:** UI dedupe behavior changes
  - **Mitigation:** dedupe key policy documented and tested.

## Rollout

- Ship behind existing UI flow without feature flag if scope is contained.
- If needed, add temporary feature flag only around the new local menu option.
