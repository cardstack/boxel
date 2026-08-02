# Interact and Code Navigation / Loader Comparison

**Status:** working analysis for review; tests intentionally deferred
**Branch analyzed:** `codex/code-preview-instant-reload`
**Baseline:** current branch compared with `main` as of 2026-08-01

## Purpose

This document compares equivalent navigation paths in Interact and Code modes,
then traces what each path does to:

- browser/query-param state;
- the canonical Store card or file record;
- source and module loaders;
- SES realm runtimes and private code-preview runtimes;
- iframe sandboxes;
- rendered component, DOM, stylesheet, and scroll identity;
- live-reload and realm-index invalidation behavior.

The immediate goal is to expose behavioral gaps. This is not yet a test plan or
an assertion that every difference should be removed.

## Executive summary

Interact and Code mode currently navigate through different primary identities:

| Concern                          | Interact                                                                      | Code                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Primary navigation identity      | A `StackItem` in `state.stacks`                                               | `state.codePath`, export/field selection, and the derived preview instance                               |
| Primary content load             | `Store.get(card/file id)`                                                     | `FileResource` source load, module analysis, then a Store-backed preview instance                        |
| Identity intentionally preserved | Existing `StackItem`, `StackItem` component, and `CardRenderer` when possible | Host Monaco/editor shell and one private `CodePreviewSandbox` per mounted Code submode                   |
| Ordinary user-code runtime       | Canonical SES realm runtime, shared by cards from the same realm/principal    | Private preview runtime for the selected volatile module; canonical runtime for unrelated stable modules |
| Browser-dependent user code      | Iframe for eligible formats after source classification                       | The same classifier, but only eligible preview formats enter the iframe                                  |
| Volatility trigger               | An external/AI edit to an already displayed module                            | The first local source mutation, or an external/AI edit to an already displayed module                   |
| Canonical data                   | Store card/file data                                                          | The same Store card/file data; source volatility changes executable module selection, not data ownership |

The branch deliberately makes Code navigation source-first and non-blocking:
the URL, editor shell, and Monaco selection advance before module analysis and
preview rendering finish. Interact remains card-first: its new `StackItem`
cannot render until Store materialization has resolved.

The most important consequence is that “same card” does not imply “same render
identity.” Interact is keyed by stack item and card. Code is keyed by module,
export, selected instance, format, preview generation, and sandbox tier. A
navigation can reuse the Store instance and compiled template but still remount
authored DOM.

## Terms and invariants

### Canonical Store state

The Store remains the source of truth for card instance data in both modes. For
user-authored card types, the host may materialize an opaque record rather than
the executable `CardDef` subclass. Schema, format, theme, and type information
cross the sandbox through explicit introspection metadata.

Changing source chooses which executable module generation renders the Store
data. It must not create a second data model inside the sandbox.

### Loader is not render identity

This analysis distinguishes four levels of reuse:

1. **Source reuse** — the file response is already in `CodeSourceCacheService`.
2. **Module reuse** — a Loader or compartment already evaluated the module.
3. **Template/envelope reuse** — the sandbox has the compiled format template
   and stable render envelope.
4. **DOM reuse** — the same mounted component/island/iframe document remains.

A path can preserve levels 1–3 and still fail level 4.

### Current loader topology

| Loader/runtime                | Scope                                      | Used for                                                           | Reset consequence                                                                                        |
| ----------------------------- | ------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `baseLoader`                  | App/session-wide                           | Official Base modules across all realms                            | Replaced by a broad loader reset today                                                                   |
| Host/general loader           | App/session-wide                           | Host and legacy/trusted paths                                      | Replaced by a broad loader reset                                                                         |
| Trusted realm loader          | One per explicitly trusted realm           | Catalog/configured trusted realm code; delegates Base imports      | All trusted realm loaders are cleared by a broad reset                                                   |
| Canonical SES runtime         | Realm + principal                          | Stable opaque user code shown in Interact or non-volatile previews | Retained while consumed; idle eviction after release                                                     |
| Private code-preview runtime  | One per mounted `CodePreviewSandbox`       | Volatile Monaco, AI, or external source generations                | Reused across compatible generations; released with Code submode/consumer                                |
| Interact live-preview runtime | One per displayed module, consumer-counted | HMR for AI/CLI/out-of-band changes while a card is visible         | Retained until the last displayed consumer unloads                                                       |
| Iframe child loader           | One per iframe document                    | DOM/global-dependent modules in eligible formats                   | Recreated if iframe URL/document identity changes; source drafts can cross the existing `MessageChannel` |

The ordinary Loader topology is implemented in
[`loader-service.ts`](../packages/host/app/services/loader-service.ts). The
opaque-card and sandbox decision is implemented in
[`realm-sandbox.ts`](../packages/host/app/services/realm-sandbox.ts) and Store
materialization in [`store.ts`](../packages/host/app/services/store.ts).

## Navigation state: side by side

| Navigation concern | Interact mode                                         | Code mode                                                                                  | Consequence                                                                           |
| ------------------ | ----------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| Persisted state    | Nested `stacks`, each containing ordered `StackItem`s | `codePath`, `codeSelection`, `fieldSelection`, `moduleInspector`, and `cardPreviewFormat`  | Both serialize into `operatorModeState`, but restore different identity graphs.       |
| Browser history    | Stack mutations schedule query-param persistence      | Code path/selection mutations schedule query-param persistence; redirects replace history  | Back/forward can restore either graph without sharing a single navigation object.     |
| Current realm      | Usually inferred from the active stack/card           | Initially inferred from `codePath`; corrected after `FileResource` learns the owning realm | Code can show the editor shell before realm metadata is final.                        |
| “Current thing”    | Top item in each stack; rightmost/topmost is primary  | Open source file plus selected declaration and preview instance                            | A `.gts` file is not itself the preview card; Code must choose or create an instance. |
| Component lifetime | One component subtree per stack item                  | One persistent Code submode/editor shell with changing file and preview state              | File navigation should not wait for the preview loader.                               |

## Equivalent navigation patterns

### Opening and moving between cards/files

| User action                                    | Interact behavior                                                                                                     | Code behavior                                                                                                       | Loader/render consequence                                                                                                              | Gap or deliberate difference                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Open a card URL directly                       | Route resolution calls Store, canonicalizes the id/type, and initializes a stack                                      | Normally represented as a `.json` `codePath`; source loads through `FileResource`, then preview uses the Store card | Interact waits for card materialization. Code commits navigation immediately and can mount Monaco before preview                       | Direct route load remains more blocking than Code file navigation.          |
| Open a realm/workspace index                   | Adds or restores the realm index card as a stack root                                                                 | Opens `index.json` or source chosen from the file tree                                                              | Interact consumes canonical realm runtime for the index card. Code can use cached source and private preview runtime                   | Equivalent visible destination, different lifetime and loading order.       |
| Follow a card/relationship link                | `viewCard` pushes a `StackItem`, targets an adjacent/rightmost stack when requested, and records relationship context | Preview/module-inspector `viewCard` converts the target to `.json` and calls `updateCodePath`                       | Interact keeps the parent card mounted beneath/adjacent to the child. Code replaces the active file/preview while keeping editor shell | Code loses the visual stack relationship unless it switches to Interact.    |
| Follow a link to the card already on the stack | Changes the existing item back to isolated in place                                                                   | Navigates to the target `.json`; equality/caches may make it cheap, but it is still file navigation                 | Interact intentionally preserves `StackItem` and renderer identity. Code re-derives selected declaration and preview                   | Interact has the stronger explicit DOM-preservation contract.               |
| Search result                                  | Default replaces the rightmost stack; directional actions add/shift a stack                                           | Opens result `.json` in the editor                                                                                  | Interact may tear down the replaced stack subtree. Code preserves Monaco shell and changes source/preview                              | Search semantics are not structurally equivalent.                           |
| Card overlay action                            | Uses the same Interact stack navigation and relationship metadata                                                     | Code preview overlays call the Code `viewCard` callback                                                             | Same target can either retain parent DOM (Interact) or replace preview selection (Code)                                                | Explicitly test parent/child navigation in both modes later.                |
| Card URL bar                                   | Resolves as a card target and updates stack navigation                                                                | Calls `updateCodePath` for the entered URL                                                                          | Code source request can redirect/canonicalize after navigation; Interact Store load canonicalizes before render                        | Error and redirect UX can diverge.                                          |
| File tree click                                | Not an Interact navigation primitive                                                                                  | Immediately changes `codePath`; pointer intent prefetches source                                                    | Host Monaco shell is independent of sandbox load. Source cache may eliminate network wait                                              | This is intentionally Code-only and should stay preview-independent.        |
| Recent file click                              | Not an Interact navigation primitive (recent cards are separate)                                                      | Immediately changes `codePath`, using realm metadata without waiting for a realm wrapper                            | Same consequences as file tree navigation                                                                                              | Recent files and recent cards remain separate histories.                    |
| Definition/schema/inheritance link             | Usually opens a card through stack navigation                                                                         | Updates `codePath` and `codeSelection`; local export changes only selection/cursor                                  | Same-module selection should reuse source/module and only change derived preview                                                       | Cross-module and local-export paths need distinct performance expectations. |

### Switching modes and opening templates

| User action                      | Interact behavior                                                                                | Code behavior                                                                                    | Loader/render consequence                                                                                                                      | Gap or deliberate difference                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Interact → Code                  | Uses the last card in the rightmost stack; cards become `<id>.json`, FileDefs keep their file id | Sets `codePath`, then activates Code mode/coding skill                                           | Existing Interact stacks remain serialized. Code creates/uses its private preview sandbox                                                      | The two render trees can coexist during transition; verify runtime consumers are released correctly. |
| Code → Interact from mode switch | Clears `codePath`; existing stacks remain and become visible                                     | N/A                                                                                              | Code preview sandbox is released when Code submode unmounts; Interact resumes its stack identities                                             | It does not automatically open the Code preview selection unless invoked through “Open in Interact.” |
| “Open in Interact” from preview  | Clears stacks, adds realm index, then selected card in isolated format                           | Invoked from Code preview                                                                        | Destroys prior Interact stack identity by design, then uses canonical Store card and canonical runtime                                         | This is a replacement/navigation command, not a handoff of the private preview DOM.                  |
| “Edit Template”                  | Edit action changes the existing card stack item to edit; “standard view” sets `useBaseTemplate` | Explicit type introspection resolves the defining `.gts`, prefetches it, then changes `codePath` | Interact may reuse the CardRenderer and use trusted Base fallback. Code keeps editor shell and loads source; preview instance is derived again | These buttons have different meanings: edit card data versus edit template source.                   |
| Toggle standard/base edit view   | Mutates `useBaseTemplate` on the same stack item                                                 | Synthetic `form` format pins the preview to `baseCardRef`                                        | Base fallback runs as trusted host code and avoids SES/iframe load                                                                             | This is a desirable fast path, but must not conceal a broken custom edit template.                   |

### Card-definition and instance selection

Navigating to `SwimMeet.gts` in Code mode requires two independent choices:

1. select the `SwimMeet` export from the source module;
2. select a Store instance whose type is that export.

The current selection order is:

1. a persisted module/export selection, if the card still exists;
2. matching recent card/file ids across recent realms, ordered by recency;
3. an expanded search across readable realms, ordered by `lastModified`;
4. create a new instance when no instance exists.

Field definitions instead use `Spec.containedExamples`; FileDefs search file
metadata instances. The algorithm lives in
[`playground-panel.gts`](../packages/host/app/components/operator-mode/code-submode/playground/playground-panel.gts),
with persisted selection state in
[`playground-panel-service.ts`](../packages/host/app/services/playground-panel-service.ts).

| Selection change                          | Interact consequence                                   | Code consequence                                                              | Identity expectation                                                         |
| ----------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Select another instance of same type      | Opens/pushes that card id as a new/existing stack item | Keeps source module/export and swaps Store preview instance                   | Module/template should be reused; card/envelope and authored DOM may change. |
| Select another export in same module      | No direct equivalent; navigation is card-centric       | Keeps source file, changes declaration selection and re-derives instance/spec | Monaco model and source should remain; preview may change template/card.     |
| Navigate from instance JSON to its `.gts` | Code-only through Edit Template                        | Uses explicit `CardTypeService.introspect(...).typeRef`                       | Avoids reading `card.constructor` across the opaque boundary.                |
| Navigate from `.gts` back to instance     | Open in Interact or select/open instance JSON          | Instance chooser supplies the selected Store card                             | Must preserve persisted selection without an extra search flash.             |

The recent/expanded selection algorithm is materially the same as `main`.
The earlier apparent “lost instance selection” was a downstream sandbox render
identity loop, not removal of this algorithm.

### Format navigation

| Format action                                  | Interact behavior                                                                            | Code behavior                                                                             | Sandbox/DOM consequence                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| isolated ↔ edit on same card                   | Mutates `StackItem.format` in place                                                          | Changes `cardPreviewFormat` for the derived preview                                       | Interact preserves outer item/renderer. Code preserves preview owner but selects a different format template/envelope.                                 |
| isolated ↔ embedded                            | Usually renders through a new/updated CardRenderer context                                   | Reuses module/instance and changes preview format                                         | SES templates are cached per format, but only the active format DOM is mounted. Iframe receives a different document/URL identity when tier is iframe. |
| fitted/atom/markdown/head                      | Available where definition supports them                                                     | Preview chooser/gallery may render multiple instances                                     | These formats are forced to SES/host paths; iframe is disallowed so fitted galleries remain composable                                                 | This is a deliberate policy difference, not automatic source capability parity.     |
| custom edit template requiring browser globals | Interact’s edit path currently prefers trusted Base fallback when standard view is requested | Current iframe renderer returns no iframe render for edit because edit falls back to Base | A genuinely custom browser-dependent edit template is a policy/design gap.                                                                             |
| embedded/isolated iframe height                | Parent CardContainer receives child `resize` messages                                        | Same protocol in Code preview                                                             | Existing iframe document reports intrinsic height; parent clamps it to 40–2400 px                                                                      | Isolated CSS can still choose full-height behavior; embedded uses intrinsic height. |

SES template caches are per module/export/format/generation. Returning to a
recently used format can avoid source evaluation and compilation, but the
current design does not keep every format’s authored DOM mounted offscreen.

## Mutation and reload patterns

| Event                                                 | Interact behavior                                                        | Code behavior                                                                                 | Loader/Store consequence                                                                             | User-visible expectation                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Edit card data                                        | Store card is mutated/saved; renderer observes canonical data            | JSON editor/preview uses the same Store identity and save pipeline                            | No executable loader reset should be needed                                                          | Data updates should not be treated as module HMR.                                                           |
| First Monaco source mutation                          | If same module is also visible in Interact, its live preview is notified | Marks module volatile, publishes a new generation to the private preview sandbox              | Store data stays canonical; executable module switches to private volatile runtime                   | One transition flash at most when entering volatility; later compatible changes should keep the island/DOM. |
| Subsequent Monaco mutation                            | Displayed consumers of that module receive the generation                | Classification/transpilation can start from draft; last-known-good template remains available | Matching module/template caches update by source hash/generation                                     | No wholesale preview blanking for compatible SES changes.                                                   |
| AI patch in Code                                      | Same shared volatile-module publication if card is displayed             | Patch publishes as soon as a completed search/replace block is applied                        | Same private preview pipeline as Monaco; save/lint/index acknowledgement is later                    | “Applied locally” should precede server acknowledgement.                                                    |
| AI patch while in Interact                            | Displayed module’s interactive preview becomes/continues volatile        | If Code is mounted on same module, it receives the same source generation                     | Avoids resetting unrelated realm runtimes                                                            | Act mode is not the volatility trigger; source mutation is.                                                 |
| CLI/other-tab realm write to displayed module         | External invalidation fetches source into the displayed module preview   | Same if selected/displayed                                                                    | If every executable invalidation is displayed, event is handled as HMR and avoids broad loader reset | Visible card updates once; realm echo is acknowledgement, not a second reload.                              |
| Realm write to non-displayed executable module        | No private displayed consumer                                            | No private displayed consumer                                                                 | Falls through to coalesced broad loader/Store rebuild when loaded code is affected                   | This can replace Base, host, and trusted realm loader graphs today.                                         |
| Mixed invalidation: displayed + non-displayed modules | HMR optimization cannot exclusively claim the event                      | Same                                                                                          | Current all-or-nothing decision can force broad rebuild                                              | Candidate for per-module partitioning.                                                                      |
| Matching server/index echo after local save           | Commit acknowledgement is consumed                                       | Same                                                                                          | Must not republish old source or reload preview                                                      | Prevents “fast local update, then snap back.”                                                               |
| Lint/runtime error in draft                           | Keeps prior installed template and records error                         | Same private preview behavior                                                                 | Failed generation must not replace last-known-good; canonical source may remain server version       | Show error/Fix with AI without blanking the last-known-good preview.                                        |
| Manual “Reload Card”                                  | Drops that card’s stable render envelope and increments manual revision  | Same action in Code preview context                                                           | Store identity remains; authored component/DOM intentionally remounts                                | Explicit escape hatch after long HMR sessions.                                                              |
| Unload displayed card/module                          | Releases consumer; external volatility remains only while consumed       | Unmounting Code releases private preview sandbox                                              | Idle canonical runtimes can be evicted; interactive preview timer/consumer is cleared                | No app-lifetime leak from abandoned volatile modules.                                                       |

The invalidation split is implemented in
[`store.ts`](../packages/host/app/services/store.ts) and volatile module
coordination in
[`realm-sandbox.ts`](../packages/host/app/services/realm-sandbox.ts).

## Render paths by trust and format

| Card/source category              | Interact                                                                                                                     | Code preview                                                     | Consequence                                                                       |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Official Base                     | Direct trusted render through shared Base loader                                                                             | Direct trusted render; Base source is read-only                  | Fastest path; no sandbox boundary.                                                |
| Configured trusted/catalog realm  | Direct/trusted realm loader                                                                                                  | Direct/trusted realm loader unless preview policy says otherwise | Loader shared within trusted realm, not per card.                                 |
| User card, SES-compatible         | Opaque Store record + canonical SES realm runtime                                                                            | Opaque Store record + private preview runtime when volatile      | Explicit metadata and delegated render boundary; no card source changes required. |
| User card needing browser globals | Iframe for eligible isolated/embedded renders; the format allowlist includes edit but the current edit fast path bypasses it | Same policy; a volatile draft crosses MessageChannel             | Separate origin/process boundary; iframe document/height lifecycle matters.       |
| User fitted/atom/markdown/head    | SES or host head wrapper                                                                                                     | SES or host head wrapper                                         | Never iframe under current policy.                                                |
| Base/default edit fallback        | Trusted host template                                                                                                        | Trusted host template via synthetic `form`/base ref              | Avoids unnecessary sandbox startup.                                               |

`CardRenderer` selects these paths in
[`card-renderer.gts`](../packages/host/app/components/card-renderer.gts). SES
render envelopes are consumed by
[`realm-sandbox-render.gts`](../packages/host/app/components/realm-sandbox-render.gts),
and iframe lifecycle/height/draft messages by
[`realm-sandbox-iframe.gts`](../packages/host/app/components/realm-sandbox-iframe.gts).

## Identity and cache lifecycle

| Identity/cache               | Interact navigation                                                                 | Code navigation                                                                       | Current invalidators                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Query-param state object     | Mutated through stack service methods                                               | Mutated through code-path/selection methods                                           | Browser restore or explicit reset                                         |
| `StackItem`                  | Preserved for in-place format/view/edit changes                                     | Not used as preview identity                                                          | Stack replace/trim/mode command that clears stacks                        |
| Store card                   | Reused by id and live references                                                    | Reused as preview data model                                                          | Data invalidation/reload; broad Store reset reestablishes live references |
| Monaco model/editor shell    | N/A                                                                                 | Intended to remain mounted across file changes                                        | Leaving Code mode or editor teardown                                      |
| Source cache                 | Indirect                                                                            | Reused on tree intent, recent files, return navigation, and newly created file seed   | Cache policy/changed source URL                                           |
| Module analysis              | Indirect                                                                            | Recomputed per selected module/source generation; obsolete work has generation guards | File/source identity change                                               |
| Canonical SES realm runtime  | Shared by displayed stable user cards                                               | Used for stable non-private renders                                                   | Last consumer + idle TTL, or broad reset                                  |
| Private Code preview runtime | Interact can observe its published module generation but does not own it            | One per mounted Code submode                                                          | Code submode teardown or incompatible tier/runtime change                 |
| Interactive preview runtime  | One per displayed module with multiple card consumers                               | Can coexist with Code private preview for same module                                 | Last displayed consumer unloads                                           |
| Stable render envelope       | Keyed by card, format, component/template, preview identity, manual reload revision | Same, plus private preview generation                                                 | Incompatible template/card/format/tier change or manual reload            |
| SES stylesheet registry      | Ref-counted by authored stylesheet content/identity                                 | Same                                                                                  | Last rendered consumer releases it                                        |
| Iframe document              | Owned by iframe component                                                           | Same                                                                                  | URL/document/sandbox identity change or component teardown                |
| Scroll state                 | Stack/card component dependent                                                      | Preview panel persists scroll per module/selection                                    | Preview identity change or explicit state reset                           |

## Differences from `main`

The relevant `main` behavior was intentionally changed in the following ways:

| Area                          | `main`                                                   | Current branch                                                               | Intended benefit                                          |
| ----------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| User CardDef materialization  | Executable class materialized through the main loader    | Opaque Store record + explicit sandbox metadata                              | Realm isolation without changing card source.             |
| Card renderer                 | Calls component from the card constructor/direct runtime | Chooses trusted, SES, or iframe delegated render path                        | Explicit authority boundary.                              |
| Loader topology               | One primary loader graph                                 | Base, host, trusted-realm, canonical SES, private preview, and iframe graphs | Isolate user code and keep trusted code reusable.         |
| Code file navigation          | Canonicalizing HEAD request before committing path       | Commit `codePath` immediately; canonicalize on source response               | Monaco/file navigation is not blocked by network/preview. |
| Code editor mount             | Coupled more closely to loaded file/module state         | Persistent editor call site with source-loading state inside                 | Faster file switches and stable editor.                   |
| Code introspection            | Often reads constructor/static APIs directly             | `CardTypeService` explicit metadata/introspection                            | Works across opaque/iframe boundaries.                    |
| Code preview                  | Uses main loader/card constructor                        | Owns one private preview sandbox and publishes draft generations             | HMR without resetting realm loader.                       |
| Interact external code update | Loader reset/reload                                      | Displayed module gets an interactive volatile preview                        | HMR for AI/CLI changes in Interact.                       |
| New file                      | Navigate then wait for realm to return file              | Seed newly created source into open-file/cache before navigation             | Avoid transient `.gts not found` preview.                 |
| Edit template                 | Resolve from executable constructor                      | Resolve from explicit type ref and prefetch                                  | Opaque-boundary compatibility and lower latency.          |
| File tree/recent files        | Could wait on realm/file state and show masking loaders  | Navigate immediately; intent prefetch and cached source                      | Keep host navigation independent of preview.              |

The branch retains the spirit of `main` where it is observable: stack semantics,
instance-selection order, recent-file intent, format choice, default edit
fallback, and Store-backed card data. It replaces implicit executable-object
access with explicit boundary APIs where user code is opaque.

## Gaps and review questions

### Concrete behavioral gaps

1. **Direct `.gts` route and Code `.gts` navigation are different products.** A
   direct route is resolved through Store/route semantics; a Code `codePath`
   selects source, export, and a derived instance. We need to decide whether a
   direct `.gts` URL should enter Code mode or remain a FileDef-style route.
2. **Custom browser-dependent edit templates are ambiguous.** The policy says
   iframe may serve edit, but the fast Base edit fallback currently bypasses
   iframe rendering. We must distinguish “standard edit form” from “custom edit
   template requiring iframe.”
3. **Code → Interact mode switch and “Open in Interact” differ.** The former
   resumes existing stacks; the latter clears them and opens realm index + card.
   The UI should communicate that distinction or unify it.
4. **Code relationship navigation loses parent-stack context.** A link replaces
   the active file/preview rather than building the Interact stack relationship.
5. **Code preview now retains two SES format islands.** The active and most
   recently used formats preserve authored DOM; selecting a third evicts the
   least-recently used island. `[NAV-07]` asserts node identity.

### Loader and invalidation risks

1. **Broad reset scope was too large.** The sandbox branch now invalidates the
   exact executable module and preserves Base, host, and unrelated trusted
   loader graphs. `[LDR-01]` locks this down.
2. **Mixed invalidation events were all-or-nothing.** They are now partitioned
   per module: displayed volatile modules take the HMR path, while only the
   remaining modules take canonical targeted invalidation. `[HMR-04]` covers
   both sides of the partition.
3. **Two preview runtimes can exist for one module.** Code owns a private
   preview while Interact has a consumer-counted interactive preview. Source
   publication is coordinated, but ownership/release behavior needs a direct
   cross-mode test.
4. **Trust bypasses can hide sandbox regressions in tests.** Tests that shim or
   pre-load modules may accidentally exercise the trusted path rather than
   actual opaque SES/iframe behavior.
5. **Some creation paths still deserve boundary review.** Any remaining
   `loadCardDef(... loaderService.loader)` call for arbitrary user-selected
   types can reintroduce constructor-based introspection outside the explicit
   boundary.

### Identity and UX risks

1. A stable template/envelope does not prove stable authored DOM. We need
   explicit DOM-node identity observations for HMR and compatible format
   changes.
2. Iframe source drafts reuse the `MessageChannel`, but any iframe URL/document
   identity change remounts the child document.
3. Route restore, Code source redirect, and persisted selection can each update
   query state. Equality guards are essential to prevent restore loops and
   selection flashes.
4. Error fallback currently means “previous successfully installed template.”
   We should specify when that must be the last server-confirmed source versus
   an earlier local draft.
5. Store live-reference reestablishment after broad reset can preserve logical
   card identity without preserving component/DOM identity.

## Navigation and HMR acceptance coverage

These IDs are embedded in test names so CI failures map directly back to this
comparison. Browser workflows are acceptance tests. Boundary invariants that
do not require a routed application remain focused integration or unit tests
instead of being duplicated through UI selectors.

| ID       | Scenario                                                | Executable coverage                                                                                                                                                      |
| -------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| NAV-01   | Direct card URL in Interact versus same `.json` in Code | `acceptance/code-submode-test.ts` — canonical card preview and format selection                                                                                          |
| NAV-02   | `.gts` with several exports and existing instances      | `acceptance/code-submode/card-playground-test.gts` — same-file export changes preserve the correct instance choice                                                       |
| NAV-03   | Interact → Code → Interact                              | `acceptance/operator-mode-acceptance-test.gts` — stacks survive both transitions                                                                                         |
| NAV-04   | Code “Open in Interact”                                 | `acceptance/code-submode-test.ts` — selected instance and stack transition                                                                                               |
| NAV-05   | Edit Template and standard edit fallback                | `acceptance/code-submode-test.ts` — custom edit discovery and Base fallback                                                                                              |
| NAV-06   | Rapid file-tree/recent-file navigation                  | `acceptance/code-submode/file-tree-test.ts` — a stale source response cannot win                                                                                         |
| NAV-07   | Rapid same-module export and format switching           | `acceptance/code-submode/sandbox-live-reload-test.gts` — two-slot SES LRU preserves authored nodes                                                                       |
| NAV-08   | Same user module visible in Interact and Code           | `integration/tools/patch-code-test.gts` — first mutation allocates one private preview and following generations reuse it                                                |
| HMR-01   | Repeated Monaco text/CSS edits and 90-second lease      | `acceptance/code-submode/sandbox-live-reload-test.gts` covers persistence/SSE identity; `unit/code-preview-sandbox-test.ts` fixes the quiet-period minimum at 90 seconds |
| HMR-02   | AI patch in Interact and Code                           | `acceptance/code-patches-test.gts` and `integration/tools/patch-code-test.gts` — local generation precedes persistence and reuses the preview                            |
| HMR-03   | CLI write to displayed module                           | `integration/tools/patch-code-test.gts` — successive external writes keep one preview until unload                                                                       |
| HMR-04   | Mixed displayed/non-displayed invalidation event        | `integration/tools/patch-code-test.gts` and `integration/store-test.gts` — per-module partition plus Store identity                                                      |
| HMR-05   | Invalid draft then correction                           | `acceptance/code-submode/sandbox-live-reload-test.gts` and `unit/code-preview-sandbox-test.ts` — monotonic generations and last-known-good UI                            |
| HMR-06   | Manual Reload Card                                      | `acceptance/code-submode/sandbox-live-reload-test.gts` — one deliberate authored-DOM replacement                                                                         |
| IFR-01   | Iframe isolated/embedded height and repeated drafts     | `acceptance/code-submode/sandbox-live-reload-test.gts` plus `unit/lib/realm-iframe-sandbox-protocol-test.ts` — persistent frame/port and validated resize messages       |
| IFR-02   | Browser-dependent custom edit template                  | `acceptance/code-submode/sandbox-live-reload-test.gts` — isolated, embedded, and custom edit reuse one iframe; standard Base edit stays in the host                      |
| LDR-01   | Non-displayed user module invalidation                  | `unit/services/loader-service-invalidation-test.ts` — exact invalidation preserves Base and unrelated trusted loaders                                                    |
| HIST-01  | Navigation away and restoration across source redirects | `acceptance/markdown-file-def-test.gts` — Code navigation intentionally uses replacement history and restores the prior source without stale embeds                      |
| ERR-01   | New `.gts`, missing `.gts`, and broken `.gts`           | `acceptance/code-submode/create-file-test.gts`, `code-submode-test.ts`, and sandbox live reload — seeded source, normal error UI, and last-known-good recovery           |
| CACHE-01 | Repeated classification/transpilation of one draft      | `unit/realm-sandbox-runtime-lifecycle-test.ts` — source-hash analysis and transpilation are shared                                                                       |

One hosted-browser check remains environmental rather than a missing contract
test: a deployed iframe origin must exercise this persistent protocol under
the production CSP/origin policy. The local acceptance runner uses an inert
iframe origin because Testem does not boot a second application context.

## Source map

The most relevant implementation entry points are:

- Interact stack navigation:
  [`interact-submode.gts`](../packages/host/app/components/operator-mode/interact-submode.gts)
- Shared stack and Code path state:
  [`operator-mode-state-service.ts`](../packages/host/app/services/operator-mode-state-service.ts)
- Mode switching:
  [`submode-layout.gts`](../packages/host/app/components/operator-mode/submode-layout.gts)
- Persistent Code editor and preview ownership:
  [`code-submode.gts`](../packages/host/app/components/operator-mode/code-submode.gts)
- File source/cache/redirect behavior:
  [`file.ts`](../packages/host/app/resources/file.ts) and
  [`code-source-cache.ts`](../packages/host/app/services/code-source-cache.ts)
- Module/export/instance selection:
  [`playground-panel.gts`](../packages/host/app/components/operator-mode/code-submode/playground/playground-panel.gts)
- Code preview controls and explicit Edit Template lookup:
  [`preview-panel/index.gts`](../packages/host/app/components/operator-mode/preview-panel/index.gts)
- Loader topology:
  [`loader-service.ts`](../packages/host/app/services/loader-service.ts)
- Store invalidation and live-reference rebuild:
  [`store.ts`](../packages/host/app/services/store.ts)
- Sandbox policy, stable envelopes, volatility, and explicit metadata:
  [`realm-sandbox.ts`](../packages/host/app/services/realm-sandbox.ts)
- SES and iframe renderer boundaries:
  [`realm-sandbox-render.gts`](../packages/host/app/components/realm-sandbox-render.gts)
  and
  [`realm-sandbox-iframe.gts`](../packages/host/app/components/realm-sandbox-iframe.gts)
- Card-level renderer selection and interactive preview consumer:
  [`card-renderer.gts`](../packages/host/app/components/card-renderer.gts)

## Review decisions to make before writing tests

1. Should direct `.gts` navigation mean a FileDef-style Interact card, Code
   source navigation, or a route-level redirect into Code mode?
2. Should Code relationship navigation preserve a parent trail/stack, or is
   replacing the active preview correct?
3. Which format transitions promise DOM identity, versus only module/template
   reuse?
4. Should mixed invalidation events be partitioned per module before any broad
   reset?
5. Is “last known good” the latest successful local generation, the latest
   server-confirmed generation, or both with an explicit status?
6. How should a custom browser-dependent edit template opt into iframe without
   slowing the trusted Base/default edit form?
7. Should Base and trusted realm loaders be immune to all user-realm code
   invalidations?
