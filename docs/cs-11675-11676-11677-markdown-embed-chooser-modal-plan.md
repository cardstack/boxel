# CS-11675 / CS-11676 / CS-11677 — Combined Chooser, Edit Modal, Toolbar Wiring

## Context

The "Markdown Editing UI" project lets a user pick a card/file from inside the markdown editor and embed it as a BFM directive (`:card[URL]` inline / `::card[URL | size]` block). Foundation already on `main`:

- `MiniCardChooser` — `packages/host/app/components/card-chooser/mini/index.gts` (PR #5288, merged)
- `MiniFileChooser` — `packages/host/app/components/file-chooser/mini/index.gts` (PR #5298, merged)
- BFM parsing / serialization in `packages/runtime-common/bfm-card-references.ts`
- `CardChooserModal` / `FileChooserModal` give the canonical `Deferred<…>`-based modal pattern.

PR #5303 (merged as `dd7cdf8f71`) added:

- `MarkdownEmbedPreviewPane` — `packages/host/app/components/markdown-embed-chooser/pane.gts`. Signature today: `{ target: CardDef | FileDef; refType: 'card' | 'file'; onInsert: (bfm: string) => void }`. Owns format dropdown, W×H inputs, Inline/Block toggle; serializes its own BFM via `serializeBfmRef` + `serializeBfmSizeSpec`.
- `MarkdownEmbedPreview` — the pure render component the pane uses.

This worktree picks up where #5303 left off: glue the mini choosers to the pane in a tabbed modal, support an edit variant of the same shell, and wire it into the CodeMirror toolbar.

## Branch / PR strategy

- Worktree branch off latest `origin/main` (already includes #5303). Suggested name: `cs-11675-11676-11677-markdown-embed-chooser-modal`.
- **One combined draft PR** for all three tickets (per user decision). Three commits inside it, one per ticket, so reviewers can scan ticket-by-ticket. Stays a draft until promoted (`feedback_open_drafts_not_prs`).
- Plan doc lives at `docs/cs-11675-11676-11677-markdown-embed-chooser-modal-plan.md`; deleted before merge (`feedback_plan_doc_not_in_merged_branch`).

---

## CS-11675 — Combined chooser modal

All new files under `packages/host/app/components/markdown-embed-chooser/`.

- **`modal.gts` — `MarkdownEmbedChooserModal`**. Mirrors `card-chooser/modal.gts`: holds a `Deferred<{ refType, url, bfm } | { remove: true } | undefined>`, renders a `ModalContainer` with focus trap, owns the tab state and the current target per tab.
- **`tabs.gts`** — internal tabbed shell. Two tabs ("Cards" / "Files"). Both panels stay mounted (CSS-hidden when inactive) so left-panel state (search query, highlighted item, scroll, W×H) is preserved across tab switches. State lives on the modal component, not in the inactive child via `{{#if}}`.
- **`tab-panel.gts`** — pairs one mini chooser with the preview pane. Cards panel: `MiniCardChooser` + pane with `refType='card'`. Files panel: `MiniFileChooser` + pane with `refType='file'`. Clicking a row in the mini chooser sets that tab's `selectedTarget`; the pane re-renders with the new `@target`.

**New service**: `packages/host/app/services/markdown-embed-chooser.ts` — exposes `chooseCardOrFile({ defaultTab })` and `editEmbed({ url, refType, sizeSpec })`. Same request-queue pattern as `card-chooser/modal.gts`. Composed into `operator-mode/container.gts` next to the existing chooser modals.

**Pane changes** (`pane.gts`): teach it to render when `@target` is `undefined` (empty preview, matching Zeplin 02). The format/W×H controls remain visible (disabled / no-op CTA) so layout doesn't jump when a row is picked.

**Acceptance**: matches the 5 bullets on the ticket. Verify with a new integration test at `packages/host/tests/integration/components/markdown-embed-chooser-modal-test.gts` + the existing freestyle host page.

---

## CS-11676 — Edit mode of the same modal

Per user decision + Zeplin 08B screenshot: the edit modal is the _same combined chooser modal_ with the same tabs. The only change is that the active tab's **left panel** swaps from the search/chooser view to a "current target" view.

**Per-tab left-panel state** lives in each `tab-panel.gts` instance:

- `mode: 'choose'` (default) — renders the mini chooser (`MiniCardChooser` / `MiniFileChooser`).
- `mode: 'current'` (edit mode initial) — renders a single tile for the placed target with two buttons:
  - **Replace Card / Replace File** → flips that tab's `mode` back to `choose` and exposes the mini chooser. Picking a new row sets the new target.
  - **Remove Card / Remove File** → resolves the modal's Deferred with `{ remove: true }` and closes.

**Modal changes** (`modal.gts`):

- Accept an optional `initialTarget: { refType, url, sizeSpec }` on the request.
- When present: open on the matching tab, set that tab's `mode` to `current` with the resolved target, and preload the pane with the parsed `sizeSpec`. Switching to the other tab still works (Zeplin 08B note: "TOGGLING TO FILES WILL DISPLAY FILE CHOOSER UI") — the inactive tab starts in `choose` mode.

**Pane extension** (`pane.gts`) — required for preload + dirty tracking:

```ts
// New args:
initialFormat?: OptionValue;
initialWidth?: number | string;
initialHeight?: number;
initialKind?: 'inline' | 'block';
onDirtyChange?: (dirty: boolean) => void;
ctaLabelOverride?: string;  // 'DONE' / 'ACCEPT' for edit mode
```

Inbound `BfmSizeSpec` → `OptionValue` mapping mirrors `selectFormat` + `syncVariantFromSize`. Dirty = the serialized current BFM differs from the initial BFM. In edit mode the parent passes `ctaLabelOverride = dirty ? 'ACCEPT' : 'DONE'`, and the CTA is always active (per Zeplin 08B note 2).

**Acceptance**: matches the 5 ticket bullets. The modal's caller (CS-11677 wiring) does the actual in-place text replacement once `ACCEPT` resolves the Deferred with the new BFM string.

---

## CS-11677 — Toolbar + cursor-aware Edit

Per user decision: drop the standalone "dimensions overlay chip on every inline preview" sub-piece. The W×H readout lives inside `MarkdownEmbedPreviewPane` (already there via the W/H inputs in #5303), so the user sees dimensions when picking / editing — no separate editor-side overlay required.

Two pieces remain.

### (a) Toolbar item — Add a card / Add a file

Per the third screenshot: a single toolbar trigger that opens a popover with two items, **Add a card** and **Add a file**. Each calls into the host to open the combined modal with `defaultTab: 'cards'` or `'files'`.

In `packages/base/codemirror-editor.gts` around line 418 (`toolbarButtons`), insert a new entry left of the formatting group. The toolbar item type already supports inline toggles + dividers; add a new variant (or a dedicated popover button beside the array) for the dropdown trigger. Each menu item calls a new host-supplied callback (the editor lives in `packages/base/`, a card-definition surface, and surfaces hooks rather than importing host services — same pattern as existing toolbar actions). The host wires that callback to `markdownEmbedChooser.chooseCardOrFile({ defaultTab })`.

On resolution with `{ bfm }`: dispatch a CodeMirror transaction at the current selection. Insert pattern at `codemirror-editor.gts:580–594`. For block embeds, surround the directive with the newline-padding rules already used there.

### (b) Cursor-aware Edit button

A new BFM-range tracker, two layers:

1. **New helper** in `packages/runtime-common/bfm-card-references.ts`:

   ```ts
   export function extractBfmRefRanges(markdown: string): Array<{
     kind: 'inline' | 'block';
     from: number;
     to: number;
     refType: 'card' | 'file';
     url: string; // unresolved, as written in the source
     sizeSpec?: string;
   }>;
   ```

   Pure string scan reusing the block (line 288) and inline (line 290) regexes already in the file. No URL resolution — cheap to run on every doc change.

2. **CodeMirror extension** wired in `packages/host/app/lib/codemirror-context.ts`: a `ViewPlugin` that recomputes ranges on `update.docChanged`, then on `update.selectionSet` tests `update.state.selection.main.head` against the ranges. Surface the result via a tracked value on the editor's controller — same channel `EditorView.updateListener` uses around lines 1120–1146.

When `currentRef` is non-null, the toolbar swaps the "Add embed" item for an Edit pencil; click opens `markdownEmbedChooser.editEmbed({ refType, url, sizeSpec })`.

On the modal's resolution:

- `{ bfm }` (ACCEPT) → dispatch a transaction replacing the original `[from, to]` range with the new BFM string.
- `{ remove: true }` → dispatch a transaction deleting `[from, to]` (and the surrounding newlines for block).
- `undefined` (DONE / cancel) → no-op.

### Acceptance

Matches the remaining ticket bullets except the dimensions-overlay one (descoped per user). Verify via a new integration test at `packages/host/tests/integration/components/codemirror-embed-toolbar-test.gts` + the freestyle host page + the live dev stack walk-through below.

---

## Verification

Per-ticket integration tests above + the existing `markdown-embed` suite from #5303 continue to pass.

End-to-end in the dev stack (`feedback_boxel_run_dev_all`, `feedback_faster_dev_stack_split`):

```
mise exec -- pnpm -C packages/host start    # one terminal
mise run dev                                 # another
```

Then at `https://localhost:4200/tests` or the dev host:

1. Open a markdown file in code mode → toolbar shows the Add embed control.
2. Add a card → modal opens on the Cards tab → pick a card → pane updates → click "Insert as …" → directive inserted at cursor and renders inline/block per the toggle.
3. Switch tabs mid-session → verify the other tab's search query / W×H survive.
4. Place the cursor inside the inserted ref → toolbar swaps to the Edit pencil.
5. Click Edit → modal reopens preloaded with the current target + size. Change the format → CTA label flips to ACCEPT. Click ACCEPT → ref is replaced in place.
6. Open Edit again → click Remove → ref disappears.

## Critical reused utilities

- `Deferred` (`packages/runtime-common/deferred.ts`) — same modal-resolution pattern as `card-chooser/modal.gts`.
- `serializeBfmRef`, `serializeBfmSizeSpec`, `parseBfmSizeSpec` — `packages/runtime-common/bfm-card-references.ts` (last two on `main`, first on #5303 branch).
- `MarkdownEmbedPreviewPane` — `packages/host/app/components/markdown-embed-chooser/pane.gts` (extended in CS-11676).
- `MiniCardChooser`, `MiniFileChooser` — composed verbatim inside each tab.
- CodeMirror selection-listener pattern at `packages/host/app/lib/codemirror-context.ts:1120–1146`; insert-at-cursor pattern at `packages/base/codemirror-editor.gts:580–594`.
