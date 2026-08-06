# Frozen-branch parity audit

What the frozen reference branch (`codex/code-preview-instant-reload`,
63527035d3..3a51b51039: 242 files, +42.5k/−1.4k) contains beyond this
branch, filtered by one question: **does our Capsule/Sandbox system
necessitate this change for existing users and cards to keep working?**
Everything here was verified against the frozen branch's actual diffs, not
its file names. The sandbox/HMR core mechanism is inventoried separately in
[boxel-sandbox-hmr-extraction.md](boxel-sandbox-hmr-extraction.md); the
frozen branch's own partition of production-vs-spike is
`docs/sandbox-branch-consolidation-plan.md` on that branch.

The stance: this branch deliberately re-implements the runtime better than
the frozen branch did. Frozen work is **redone here only when parity
requires it**, never ported for its own sake.

## Necessitated for a mergeable PR

Ranked by what blocks real usage soonest.

### N1. Card-type introspection shim (`cardTypeService.introspect()`)

The single invariant behind most frozen-branch host changes: **an
interactive card may have no executable constructor.** Main's UI reads
`card.constructor` in eleven places, all of which break the moment a card
renders via Capsule or Sandbox:

- `preview-panel/index.gts` — `identifyCard(card.constructor)` for Edit
  Template navigation; `hasCustomEditTemplate` for the format chooser
- `playground-panel.gts` — `hasCustomEditTemplate`, `prefersWideFormat`
- `stack-item.gts` — `prefersWideFormat`, `cardTypeDisplayName` (header
  type and "Untitled X" stripping)
- `detail-panel.gts` — `getCardType(… constructor)`, duplicate-instance
  display name
- `host-mode/{content,stack-item}.gts` — `prefersWideFormat`
- `interact-submode.gts` — `identifyCard(card.constructor)` for the
  recent-cards type list (dedupe must move from CodeRef reference equality
  to `internalKeyFor`, since boundary-crossing refs are clones)

The frozen fix: a synchronous
`introspect(card) → {typeRef, displayName, hasCustomEditTemplate, hasCustomIsolatedTemplate, prefersWideFormat}`
on `card-type-service`, backed by the runtime for boundary cards and by the
real class otherwise. **Our branch already computes every one of these in
`capsule-module-evaluator.ts` (metadata block)** — the redo is a small
service surfacing existing data, plus the eleven call-site edits.

### N2. `getComponent(instance)` migration (12 call sites)

`constructor.getComponent(instance)` bypasses the boundary; the imported
`getComponent(instance)` from card-api is boundary-aware. Mechanical edits
in `packages/base` (`cards-grid`, `workspace`, `commands/search-card-result`)
and `packages/experiments-realm`. The frozen branch's compatibility audit
records a corpus card going 15/28 → 28/28 tests on this alone. Same family:
`fitted-format-gallery.gts` needs the service-level component lookup.

### N3. Prerender assertion compat (realm-server)

One helper (`stripGlimmerSerializationMarkers` + wrapper unwrap in
`realm-server/tests/helpers/index.ts`) unblocks every realm-server
prerender assertion the moment our runtime emits any wrapper or Glimmer
serialization marker. Highest leverage per line in the whole delta.

### N4. Search correctness over boundary cards

`instance-filter-matcher.ts` optional `isInstanceOf` /
`resolveQueryablePath` hooks (host-supplied, `undefined` falls back to the
ordinary card-api walk) plus `Loader.registerIdentity` for synthesized
facades. Without these, live client-side search **silently returns wrong
results** for any card without a walkable constructor chain — a correctness
bug with no error message.

### N5. Base-realm context capabilities for isolated Glimmer roots

Required the moment a trusted Base field component (markdown editor,
CodeMirror, code-ref edit view) renders inside an isolated root; the
symptom is a permanently stuck loading state, not a crash:

- `CardContext.requestRender?()` — isolated roots have no host rerender
  loop; async-completing Base components must poke one
- `CardContext.trustedUI` — CodeMirror/KaTeX/Mermaid loaders as an
  explicit capability sandboxed code never receives
- `CardContext.validateCodeRef?()` — code-ref's edit view must stop
  `import()`ing user modules into the trusted graph to validate a field

Already on our branch (no redo needed): native-`instanceof` honoring in
`instanceOf()`, `static prefersFullSandbox` on `CardDef`.

### N6. Store materialization split

The frozen branch's CI collapse (19/20 host shards, all realm-server
shards, from one `could not identify card: OpaqueRealmCard` indexing
failure) is the evidence that "indexing needs the executable class" and
"interactive UI must not have it" must be distinct store paths. Our
`MaterializationPurpose` already models this (the minimality review's F10
flagged it unproduced — the frozen branch is the proof it is
protocol-reserved, not dead); the redo is routing `createFromDocument` /
`updateFromDocument` by purpose when the Sandbox tier reaches the store.

### N7. Loader hardening under invalidation

- Two epoch-token races in `advanceToState` (stale in-flight fetch writes
  back source/deps after `invalidateModule` replaced the entry) — real
  data corruption that appears exactly under live-preview-speed
  invalidation; prerequisite for HMR (task #8)
- `statusText` sanitization for the synthetic 500 (multiline compiler
  errors throw inside `new Response`)
- `isModuleShimmed()` provenance — what lets main's live-class test
  fixtures survive under a source-based evaluator

### N8. CI compat patterns (test edits, not production)

- Boundary waits: tests that assumed route settlement implied module
  readiness need explicit waits (frozen `playground.ts` helper pattern)
- Rebuild counting: hooking `resetLoader` call counts is wrong once
  invalidation is targeted; hook store reset instead
- Do **not** port the `Array.prototype.at` rewrites — a TS lib-target
  artifact of the frozen branch's config, unrelated to sandboxing.

### N9. Trivial extraction

`runtime-common/{environment,executable-extensions}.ts` — breaks the
barrel-import cycle so `loader.ts` is importable from a compartment. No
behavior change.

## Explicitly not ported (deferred or superseded)

| Frozen work                                                                                                                                     | Status                                                                                                                                                                                                                                         |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card-island trio + `isolated-render` serialize/rehydrate/suspend + host-mode DOM adoption                                                       | Deferred — only needed for server-prerender → client handoff without remount; our placeholder mechanism covers today's need. Note: there is **no host-mode HMR** on the frozen branch; host-mode changes are rehydration + introspection only. |
| `realm-compartment-module-runtime.ts` (2,200 lines) + worker evaluator                                                                          | Superseded by our `capsule-module-evaluator` family. One item to verify before closing: the SES HTML-comment-token escape (`<!--`/`-->` split) that fixed the RichMarkdownField corpus regression.                                             |
| `code-source-cache`, `file-tree-query-cache`, navigation/analysis decoupling, `InitialFileContent`/404-retry file plumbing                      | Code-mode UX latency work; valuable, independently portable, its own PR.                                                                                                                                                                       |
| Plural loader topology (`baseLoader` / `loaderForTrustedRealm` / service-level invalidation fan-out) + `clearFetchCacheFor`                     | Owned by the HMR/volatile slice (tasks #8/#9), which redesigns this per [boxel-volatile-execution-plan.md](boxel-volatile-execution-plan.md); don't pre-port.                                                                                  |
| `safe-modifier`, `MenuItem.status`, `CardHeader @isLoading`, `field-component` `@fieldType`/`@fieldName`, surface-presentation strictness delta | Small additive surface; port when the corresponding UI affordance lands.                                                                                                                                                                       |
| `realm-program-tool-spec.md`, surface playback fabric, SES spike doc                                                                            | Orthogonal proposals; leave on the frozen branch.                                                                                                                                                                                              |

Frozen docs worth mining when their subject comes up: the PR-5663
compatibility audit (empirical regression ledger + root-cause chains), the
consolidation plan (production-vs-spike partition), the reviewer guide
(dependency-ordered narrative for a 200-file diff), the CI compatibility
suite contract table.

## LOC budget

Current branch vs main: **+12.8k production, +6.3k tests, +8.0k docs.**

| Delta                                                                                  | Production lines |
| -------------------------------------------------------------------------------------- | ---------------- |
| Minimality-review diet ([response plan](boxel-execution-runtime-minimality-review.md)) | −800 to −950     |
| Necessitated parity redo (N1–N9 above)                                                 | +1,000 to +1,300 |
| Sandbox HMR slice (mechanism only; transport/authority exist)                          | +800 to +1,200   |
| Volatile promotion mode                                                                | +300 to +500     |
| **Projected production total**                                                         | **≈ 14–15k**     |

Slightly above the architecture doc's 9–14k guardrail at the top of the
range — the diet commits and the config-extraction tables are what keep it
honest. Tests grow deliberately (RP suites + ported frozen gold tests +
parity fixtures): expect ~10–12k test lines at the end. Docs are already
written as we go.
