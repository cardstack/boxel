# Code mode navigation and patch latency audit

Date: 2026-08-01

## Scope

This compares the current sandbox/HMR branch with `main` for three paths:

1. navigating the Code mode file tree;
2. opening **Choose a skill file to add**;
3. applying an AI search/replace block and updating a mounted preview.

The goal is to preserve the new explicit sandbox boundary while recovering the
host-owned UI responsiveness users expect from `main`.

## Why the main file tree feels fast

### 1. It lists directory metadata, not cards

The Code mode tree uses `DirectoryResource`. It asks the realm for a directory
listing (`Accept: application/vnd.card+directory`) and sorts only the returned
names and kinds. It does not load CardDefs, hydrate cards, inspect schemas,
classify a sandbox tier, or compile a preview.

Emulation status: retained. The current tree still uses this resource. File
navigation must continue to be treated as a host metadata operation.

### 2. It is lazy by open directory

Only the root and expanded directories have a `DirectoryResource`. A large
realm does not have to be searched, flattened, and recursively sorted before
the first rows appear.

Emulation status: retained. Do not replace the Code mode tree with the indexed
chooser tree. A next improvement is a small session cache of directory listing
responses, invalidated only by add/remove events for that directory.

### 3. Navigation and preview readiness were effectively one cheap shared-loader path

On `main`, the selected path eventually feeds one shared loader and its warm
module cache. The sandbox branch additionally owns source generations,
classification, a private volatile loader, module analysis, and preview
rehydration. Those are valid secondary consumers, but none may block selection
or Monaco.

Emulation status: partly restored. `updateCodePath` now commits the path before
the source request (and removes `main`'s extra blocking canonicalization HEAD),
Monaco stays mounted, and source intent is prefetched. The remaining rule is:
only the preview/inspector may show sandbox loading; the tree, selected filename,
and editor shell must never await it.

## Why the skill-file chooser looked blank

The skill chooser is not the Code mode file tree. It mounts
`IndexedFileTree`, which starts a realm-wide `_federated-search`, filters on
`MarkdownDef` plus `kind = skill`, builds a complete path tree from every
result URL, and recursively sorts it. Before this audit, the same click also
started `loadCardDef` to discover upload MIME types. The UI had no distinct
settled-empty state, so initial loading and “this realm has no matching skill
files” were visually ambiguous.

Implemented here:

- the modal is opened before `acceptTypes` CardDef introspection; that optional
  upload enhancement starts after the render boundary;
- the indexed-tree resource covers the render-to-task gap in `isLoading`;
- the chooser now renders an explicit loading state and an explicit
  “No matching files in this workspace” state;
- a populated result stays visible during index refreshes.

Implemented here: indexed file queries now use a bounded, session-scoped LRU
cache keyed by the realm and a canonicalized query. The skill menu prewarms the
exact `MarkdownDef + kind = skill` query when it opens. Matching index echoes
acknowledge an already displayed local write without throwing away the cached
tree; unrelated index events remain filtered out.

## Why Apply diff was slow

The local search/replace itself is cheap. The previous critical path was:

1. obtain source;
2. apply the search/replace;
3. POST the entire source to the realm `_lint` endpoint and await autofix;
4. publish the volatile preview generation;
5. persist the source;
6. re-upload/reconcile enabled skills and tools;
7. build AI context (which can include code-semantics work);
8. send and await Matrix result events.

Steps 3 and 6–8 are network/receipt work, not prerequisites for displaying a
coherent local preview.

Implemented here: the coherent search/replace result is published to mounted
SES/iframe previews before remote lint. The tool request enters an explicit
locally-applied state at that boundary, while linting, persistence, indexing,
and Matrix acknowledgement continue asynchronously. If lint changes the text,
one follow-up generation advances the same volatile module; unchanged lint
output does not create a redundant generation. Persistence remains canonical.

## Five changes for the fastest possible preview update

Ordered by user-visible impact:

1. **Keep local apply ahead of all network work.** Patch the active
   `FileResource`/Monaco buffer and publish its volatile generation in the same
   interaction turn. Lint, POST, indexing, and Matrix receipts are background
   acknowledgements. The first half is implemented in this audit.

2. **Split local applied state from remote acknowledged state.** Change the
   button to `Applied locally` as soon as the patch is in the buffer/preview.
   Track `saving`, `linting`, and `reported to room` separately. Today
   This is implemented: the request stops presenting as actively applying as
   soon as the coherent source is in the volatile preview, while the command's
   promise still owns lint, save, index, and Matrix completion.

3. **Make server echoes generation-aware no-ops.** Carry the module generation
   and `clientRequestId` through save/index/SSE. If an index event echoes the
   locally displayed hash/generation, acknowledge it without replacing the
   component, store instance, loader, file resource, or indexed file tree. This
   is implemented for store, search, file, and file-tree subscribers. A
   newer/different hash alone advances the preview.

4. **Compile/classify once per source hash, off the interaction frame.** Store
   classification and transpilation on the volatile generation; parse
   content-tag once. This is implemented with a bounded source-hash analysis
   cache shared by classification and compilation. A completed displayed diff
   prewarms both promises before Apply uses the cached result.

5. **Preserve the rendered island and stylesheet identity.** Keep the sandbox,
   component island, model, and DOM mounted across generations and format
   switches. Update only the template/module generation and ref-counted
   stylesheet entry. Flash once when canonical becomes volatile, never again
   for that module's edit session; remount only when classification changes the
   required sandbox tier or HMR declares the update incompatible. This is
   implemented with a stable render envelope updated after Glimmer's render
   transaction and acquire-before-release stylesheet updates.

## Verification

- `Integration | tools | patch-code`: 8/8 pass, including a test that holds
  remote lint open and observes the new source in the preview before releasing
  lint.
- `Integration | file-tree-from-index resource`: 4/4 pass, including the
  initial-loading versus settled-empty distinction.
- `Unit | Service | file-tree-query-cache`: 1/1 pass, covering canonical query
  identity, forced refresh, and session reset.
- `Unit | Realm sandbox runtime lifecycle`: 2/2 pass, including bounded
  source-hash classification/transpilation reuse.
- `Unit | realm-sandbox-styles`: 1/1 pass, covering shared stylesheet identity.
- `Acceptance | code submode | sandbox live reload`: 2/2 pass for SES and
  iframe. Both keep the renderer boundary mounted across a Monaco generation;
  the stable render envelope update is deferred until after render to avoid
  Glimmer backtracking.
- Focused ESLint and template lint pass for all files changed by this audit.
- The larger AI skill-picker integration test did not finish in a standalone
  prebuilt run and produced no test output before being stopped. The lower
  resource/UI boundaries are covered, but that end-to-end assistant test still
  needs profiling under the normal test-services stack; its setup includes
  Matrix room state, skill uploads, and indexing beyond the chooser itself.
