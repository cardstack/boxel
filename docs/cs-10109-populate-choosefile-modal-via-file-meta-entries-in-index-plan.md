# CS-10109 Plan: Populate ChooseFile modal via file-meta index entries

## Goals
- Drive the Choose File modal list from indexed `file-meta` entries instead of directory listings.
- Ensure selected files use `file-meta` data (so metadata like name/contentType is available).
- Preserve realm selection and update behavior when index changes.

## Assumptions / Open Questions
- We likely need to add search/query support for `file-meta` entries before the UI can consume them.
- UI should remain as-is (keep the directory tree experience and file list styling).
- For selection, return a FileDef instance created from file-meta (via store `get(..., { type: 'file-meta' })`) rather than constructing a minimal FileDef from URL.

## Plan
1. Add search/query support for `file-meta` entries in the realm index/search API (define query filter and result shape).
2. Update the underlying data source for `FileTree`/`Directory` to be driven by file-meta index entries for the selected realm (still rendered as a tree).
3. Keep `ChooseFileModal` UI unchanged, but wire selection to resolve the chosen file via `store.get(fileUrl, { type: 'file-meta' })`.
4. Ensure index updates (e.g., `index` events) re-render the tree and keep selection stable when possible.

## Target files
- `packages/host/app/components/operator-mode/choose-file-modal.gts`
- `packages/host/app/components/editor/file-tree.gts` (update data flow if needed)
- `packages/host/app/components/editor/directory.gts` (update listing source to file-meta index)
- `packages/host/app/resources/` (add or adjust resource for file-meta index lookup)
- `packages/runtime-common/` (search/query support for file-meta)
- Possibly `packages/host/app/resources/` if a new resource is needed

## Testing notes
- Add or update an integration test under `packages/host/tests/integration/` to assert the modal uses file-meta results and returns a FileDef with expected metadata.
- Run `pnpm lint` in `packages/host`.
- Run a focused Ember test in `packages/host` if feasible; avoid full host suite.

## Example queries
Filter for all FileDef-backed file-meta entries in a realm:
```json
{
  "filter": {
    "type": {
      "module": "https://cardstack.com/base/file-api",
      "name": "FileDef"
    }
  }
}
```

Filter for a specific file by URL:
```json
{
  "filter": {
    "on": {
      "module": "https://cardstack.com/base/file-api",
      "name": "FileDef"
    },
    "eq": {
      "url": "https://example.com/realm/files/sample.txt"
    }
  }
}
```
