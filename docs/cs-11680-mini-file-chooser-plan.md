# CS-11680 — Mini File Chooser

## Goal

Build `MiniFileChooser`: a compact, standalone, independently-mountable file picker
sized to match `MiniCardChooser` (CS-11672). It is the second primitive in the
Markdown Editing UI sequence and is consumed by the combined modal in a later ticket.

The design (Zeplin 09 / 09C) shows a **Workspace** dropdown, a **Choose File** label
over a bordered, scrollable file tree, and an **Upload…** button — plus a
drag-and-drop upload state.

## File-embed serialization decision (documented deliverable)

The ticket framed the choice as `:card[URL]` vs a plain markdown link `[name](URL)`
and said "do not add new BFM syntax." But BFM **already has a dedicated file syntax** —
inline `:file[URL]` and block `::file[URL]` — that resolves to `FileDef` instances and
is already rendered:

- `packages/host/app/lib/codemirror-context.ts` — `BLOCK_FILE_RE` / `INLINE_FILE_RE`, `refType: 'card' | 'file'`
- `packages/host/app/components/operator-mode/preview-panel/rendered-markdown.gts` — `extractFileReferenceUrls`, `RenderSlot.refType === 'file'`

**Decision: serialize file embeds as `:file[URL]` (block `::file[URL]`).** This is not
new syntax — it pre-exists and is the purpose-built path for files, strictly better
than `:card[URL]` (FileDef has dedicated file rendering) and better than a plain
`[name](URL)` link (renders as an anchor, not an embed). `MiniFileChooser` itself only
returns a URL via `onSelect`; downstream tickets apply the `:file[URL]` serialization.

## Approach

Mirror `MiniCardChooser`'s structure but back it with the file-tree path, not search.
Reuse — don't reimplement — the realm-dropdown, file-tree, and upload machinery
already proven in `ChooseFileModal`.

### New files

- `packages/host/app/components/file-chooser/mini/index.gts`
- `packages/host/app/components/file-chooser/mini/usage.gts`

### Modified files

- `packages/host/app/templates/host-freestyle.gts` — register `['MiniFileChooser', MiniFileChooserUsage]`

### New test

- `packages/host/tests/integration/components/mini-file-chooser-test.gts`

### Signature

```ts
Args: {
  onSelect: (url: string) => void;   // fired with selected/uploaded file URL
  initialRealmURL?: string;          // optional starting workspace (read once)
  selected?: string;                 // optional pinned-selection URL
}
```

### Reused building blocks

- `RealmDropdown` / `RealmDropdownItem` — `realm-dropdown.gts`
- `IndexedFileTree` — `editor/indexed-file-tree.gts` (`@realmURL`, `@onFileSelected`, `@onFileConfirmed`, `@selectedFile`, `@autoFocus`)
- `file-upload` service — `uploadFile`, `uploadProvidedFile`; `FileUploadTask`; `result: Promise<FileDef | undefined>`
- `realm.allRealmsInfo`, `RealmPaths(...).fileURL(path)`, `FileDef.sourceUrl`
- Drag-drop handlers lifted from `choose-file-modal.gts`

### Behavior

- Workspace dropdown defaults to `initialRealmURL` (or first known realm); switching it
  recreates the tree (nonce+realm render key).
- Picking a file (click or Enter) resolves its URL via `RealmPaths(realm.url).fileURL(path)`
  and calls `@onSelect`. No footer / Add / Cancel — the host owns confirmation.
- Upload (button → `uploadFile`, drag-drop → `uploadProvidedFile`); on completion the
  resolved `FileDef.sourceUrl` is passed to `@onSelect`. Inline picking/uploading/error states.
- `@selected` highlights the matching tree row.
- Fluid 100%-of-parent flex column matching `MiniCardChooser`'s envelope.

## Testing

- `cd packages/host && pnpm lint` + `pnpm glint` clean.
- `mini-file-chooser-test.gts`: render in a 360×480 container, assert tree rows render,
  clicking a file fires `onSelect` with the correct absolute URL, switching workspace
  re-renders the tree, and `@selected` highlights a row.
- Manual: host-freestyle → MiniFileChooser usage.
