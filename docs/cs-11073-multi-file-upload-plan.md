# CS-11073 — Uploading multiple files in code mode should work

> Scratch planning doc — to be removed in a pre-merge commit.

## Context

The "Upload File…" menu in code mode lets a user push a file into the current realm, but only **one** file at a time. The Linear ticket title is the entire spec ("Uploading multiple files in code mode should work"), with no description or comments. The user wants to be able to select N files from the OS picker once and have all of them written to the realm.

### Why it's broken today

`packages/host/app/services/file-upload.ts` builds a single-file native picker:

- `_openNativeFilePicker()` creates `<input type="file">` with **no `multiple` attribute** and reads `input.files?.[0]` only.
- `FileUploadTask` is structurally one-file-per-task — a single `_fileDeferred: Deferred<File | null>` and a single `_resultDeferred: Deferred<FileDef | undefined>`.
- Caller `code-submode.gts` `triggerUploadFile` spawns exactly one task and navigates to that one `fileDef.url` on completion.

So even if a user could select multiple files at the OS layer, every layer downstream is single-file.

### Why we're not redesigning the service

`FileUploadService.activeUploads` is already an array, and `choose-file-modal.gts` plus the Matrix room flow (`room.gts`) both rely on the one-task-per-file model. The fix is to add a **fan-out at the entry point** — one picker call, N tasks — rather than reshape `FileUploadTask` into a multi-file abstraction.

## Changes

### 1. `packages/host/app/services/file-upload.ts`

Add a multi-file picker entry without touching the existing single-file API (`uploadFile`, `uploadProvidedFile`, `pickLocalFile` stay).

- New private `_openNativeFilePickerMulti(acceptTypes?: string): Promise<File[]>` — same as `_openNativeFilePicker` but `input.multiple = true` and resolves with `Array.from(input.files ?? [])`. Empty array on cancel.
- New public `pickLocalFiles(opts?: { acceptTypes?: string }): Promise<File[]>` — mirrors `pickLocalFile` but plural; in `isTesting()` shifts one batch off a new `queuedLocalFileBatchesForTesting: File[][]` queue and returns it (defaults to `[]`).
- New test seam `__queueLocalFileBatchForTesting(files: File[])` — pushes one batch onto the queue.

No changes to `FileUploadTask`, `uploadFile`, `uploadProvidedFile`, or `_processUpload`.

### 2. `packages/host/app/components/operator-mode/code-submode.gts`

Rewrite `triggerUploadFile` to:

1. `let files = await this.fileUpload.pickLocalFiles({})`.
2. If `files.length === 0`, return (user cancelled).
3. For each file, call `this.fileUpload.uploadProvidedFile({ realmURL, file })` — collect tasks.
4. `await Promise.all(tasks.map(t => t.result))`.
5. Navigate to the first successfully-uploaded file's URL via `operatorModeStateService.updateCodePath(new URL(firstSuccess.url))`. If all failed, do nothing.

`uploadProvidedFile` already enqueues into `activeUploads`, so the file-tree and any progress UI keep working.

### 3. `packages/host/tests/acceptance/code-submode/create-file-test.gts`

Migrate the two existing upload tests to the batch seam, and add a multi-file test:

- `can upload a file via the New menu` — queue one file via `__queueLocalFileBatchForTesting`, click "Upload File…", assert editor navigates to that file.
- `cancelling upload file picker does not cause errors` — queue an empty batch, click "Upload File…", assert URL bar still shows `index.json`.
- New: `can upload multiple files via the New menu` — queue two files, click "Upload File…", wait for `activeUploads.length === 0`, assert both files exist in the realm and URL bar shows the first.

## Out of scope

- Drag-and-drop into the code-mode file tree (no DnD entry point exists in code-submode today).
- Changes to `choose-file-modal` (still single-file by design).
- Matrix room attachment flow (already supports multi-file).
- Folder upload (`webkitdirectory`).
- Duplicate-filename handling.

## Verification

1. `pnpm test -p host -f "can upload multiple files via the New menu"` — new test passes.
2. `pnpm test -p host -f "can upload a file via the New menu"` — migrated single-file test still passes.
3. `pnpm test -p host -f "cancelling upload file picker"` — migrated cancel test still passes.
4. Full `code-submode/create-file-test.gts` file passes.
5. Open a draft PR with `gh pr create --draft` once the branch is pushed.
6. Manual smoke in browser via `pnpm start` in `packages/host`:
   - Open code mode, click `+` → "Upload File…", select two files; both appear in the file tree, editor opens the first.
   - Single-file selection still navigates to that file.
   - Cancel the OS dialog → no error, URL bar unchanged.
   - One file without extension among valid ones → that one errors, others succeed.
