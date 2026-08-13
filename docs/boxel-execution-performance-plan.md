# Boxel Execution Runtime — Performance Audit and Prioritized Plan

**Status:** Phase 0 instrumentation implemented; focused live baseline captured,
full corpus pending. Revised
2026-08-11 on
`codex/boxel-execution-runtime-architecture` after checkpoint `652dabe7a8`.
Line references were measured against the audit working tree and will drift.
No optimization in this document is authorized until Phase 0 records a green
correctness-qualified baseline.

**Scope:** the three execution tiers (Direct, Capsule/SES, Sandbox/iframe), the
orchestration layer that feeds them, and the store/projection/search layer beneath.
Direct, Capsule, and Sandbox stay consistent and share the `BoxelRuntime` API
throughout — nothing here changes tier semantics, isolation, or the protocol's
observable behavior. Per R5, no item de-escalates isolation: caches hold bytes and
derived pure artifacts; authority checks stay per-process.

## The lens

The first version of this runtime is a **reference implementation**: the code should
read like protocol documentation. Some performance fixes hide intent behind machinery;
others make the code state its intent _better_ than it does today. Every item below is
graded on three axes:

- **Legibility** — **A**: the fix improves intent legibility. **B**: about the same.
  **C**: the fix trades clarity for speed.
- **LOC** — net signed estimate of lines changed (negative is a reduction).
- **Perf** — quantitative estimate plus what the cost scales with. All numbers are
  pre-measurement estimates; measure before and after.

The scoring produced a finding worth stating up front: **the biggest wins are mostly
A-class, because the slowest paths are slow precisely where the code contradicts its
own stated intent.** The Capsule computes a full projection and then discards it
against the adopted Host projection; the Sandbox child keeps measuring renders the
parent has already said it ignores; `reloadSandbox()` documents a clean authority
slate but does not replace `resourceAuthority`; the GC sweep dedupes with a `WeakSet`
in one phase and forgets to in the other. Fixing those _can_ be spec work, but only
after the relevant ownership and identity rule is made explicit. The genuinely
C-class speedups (delta sync, warm pools, speculative boot, handshake-loading)
cluster at the bottom on all three axes for a v1 and are deferred deliberately.

## Correctness is the first performance gate

A fast result is not a sample when it rendered stale data, retained a prerender
placeholder, selected the wrong execution tier, dropped an interaction, crossed an
authority boundary, or leaked a child process. Every baseline and every before/after
comparison must pass these gates before its timing is admitted:

1. **Semantic parity:** required text, computed values, relationships, cardInfo,
   presentation, and delegated formats match the staging reference.
2. **Visual and interaction parity:** required DOM primitives exist; images decode;
   scrolling, text entry, media controls, drag/drop, and navigation work where the
   case declares them.
3. **Execution truth:** Direct, Capsule, and Sandbox labels match policy; a prerender
   placeholder is not counted as an interactive Sandbox.
4. **Authority truth:** module and resource grants are exact, principal-scoped, and
   generation-scoped. Cache hits never bypass a fresh authorization decision.
5. **Identity truth:** two simultaneous occurrences of the same card remain distinct;
   compatible rerenders retain identity; format switches and back-navigation do not
   accidentally share one DOM/process occurrence.
6. **Lifecycle truth:** errors retain last-known-good output where promised; explicit
   reload replaces the intended generation; close/teardown leaves no iframe, pending
   RPC, observer, timer, style, or retained authority beyond its documented TTL.

The existing browser smoke runner already enforces most of gates 1–3 and part of 6.
The graph tests and focused transport tests enforce 4–5. A performance change must
strengthen missing assertions before relying on the path they cover; it must never
weaken an assertion to improve a number.

## The cost model

Three multipliers dominate, and they compound:

1. **Per-property-read (Capsule).** Every authored `this.args.x` read crosses the
   membrane via `cloneIntoCompartment(jsonClone(value))`, and `cloneIntoCompartment`
   is `compartment.evaluate('JSON.parse("…escaped…")')` — a full SES compile of a
   fresh source string per read
   (`packages/host/app/lib/capsule-module-evaluator.ts:2564`). The host side of the
   same read calls the uncached `getFields` and deep-expands linked subtrees per read
   (`packages/host/app/lib/boxel-projection.ts:170`).
2. **Per-card-render (all tiers).** `requestFor` performs an uncached network fetch of
   the module source, a full `serializeCard({withIncluded, includeUnrenderedFields})`,
   and a whole-graph `settleHostProjection` fixpoint per renderer instance
   (`packages/host/app/services/boxel-execution.ts:319`) — and there is one renderer
   per card _and per field portal_. A 30-tile grid of one card type fetches the same
   source 30+ times and serializes 30 full documents. The Direct tier — the majority
   of renders — pays all of this and then uses `canonicalCard` natively.
3. **Per-boot (Sandbox).** The iframe does not start loading until two serial network
   phases finish (request build, then a strictly sequential depth-first classification
   walk, one fetch per module, up to 256). The child then boots the full host Ember
   app, then ~6 sequential round-trips
   (`listening → connect → ready → createFromSerialized → buildRenderRecord → render → diagnostic`),
   every RPC costing 3 messages instead of 2, the child re-fetching the whole module
   graph one round-trip at a time through the parent — each response blocked on a
   parent-side main-thread `TextDecoder` + `es-module-lexer` parse the child then
   repeats for itself.

---

## Phase 0 — correctness-qualified baseline

This phase changes instrumentation and documentation only. It does not add a cache,
pool, shortcut, parallel graph walk, or altered execution semantic.

### Fixed environments

Measure two environments separately:

- the uniquely named, staging-backed development Host at
  `https://host.codex-execution-runtime.localhost`, started through
  `scripts/start-host.sh staging`; and
- a production preview build once one exists.

Use `https://realms-staging.stack.cards` as the behavioral reference. The reference
does not run the branch's Sandbox and therefore cannot supply an iframe-handoff
number; it supplies semantic/visual/interaction parity and an unsandboxed latency
control. Never label an authentication screen as a renderer sample. The local Host
must show the staging identity providers (including **Continue with Google**) before
staging credentials or timings are accepted.

Do not build Host/QUnit assets while collecting a staging-backed browser run: a build
can regenerate environment modules and silently switch a running Vite Host back to
local services. Finish focused builds first, restart the staging launcher, verify the
identity provider, then measure.

### Fixed corpus

Run one tab sequentially; never start multiple media cards concurrently.

| Cohort                                                        | What it proves                                                                                                                                                 |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Six-card commit gate in `execution-runtime-browser-smoke.mjs` | Direct edit transition, representative Capsule composition, two real Sandboxes, interactions, teardown                                                         |
| `FormatPreviewBatchOne/sample`                                | 35 delegated format boundaries and repeated trusted portals                                                                                                    |
| `RecipeGallery/home`                                          | query readiness, relationship results, navigation, and scrolling                                                                                               |
| `TierList/national-fast-food-ranking`                         | image/resource projection, retained Sandbox lifecycle, and mutation UI                                                                                         |
| `Release/opening-night`                                       | deeply nested computed values, trusted Base portals, edit scrolling, and theme                                                                                 |
| FileDef live subset: PDF, GLB, MIDI, DOCX, XLSX               | scalar and relationship resource authority, canvas/media/Office/data adapters; XLSX remains a known authored `DataFilePreview` correctness blocker until fixed |
| Same-document navigation soak                                 | retention, teardown, DOM/style growth, and back-navigation                                                                                                     |
| Two simultaneous occurrences of one card                      | occurrence identity and non-aliasing                                                                                                                           |
| Same card under two distinct grants/principals                | cache isolation and fresh authority checks                                                                                                                     |

Do not expand the timed cohort merely for breadth. The broader 50-card and 44-case
FileDef matrices remain correctness smoke; promote a case into the timed cohort only
when it represents a new multiplier or boundary.

### Samples and metrics

For each admitted case collect five cold and five warm samples. Preserve raw samples;
report median and p95 rather than only a single aggregate. A cold Sandbox sample uses
a newly minted child while keeping the signed-in Host document alive. A warm sample
reuses only the lifecycle the protocol promises to retain—never a hidden speculative
pool.

The existing browser runner records total semantic readiness, Direct edit readiness,
and Sandbox prerender-to-interactive handoff. Add named marks around the existing
runtime stages so the same run also records:

- request construction, source fetch count/bytes/cache status, classification, and
  graph size/depth;
- serialization, projection-settle duration/pass count, and projection bytes;
- Capsule evaluation, membrane read/clone counts, render-record construction, and
  first visible output;
- Sandbox child navigation, listening, connect, ready, create, build-render-record,
  render acknowledgement, and first interactive output;
- MessagePort request/response counts, pending-map high-water marks, and timeouts;
- DOM nodes, style elements, live iframes, retained runtimes, and JS heap before load,
  after cold load, after warm load, after close, and after idle eviction.

Instrumentation must be passive: stable names, monotonic timestamps, counters, and
sizes. It must not add awaits, graph traversal, serialization, or production-visible
authority. Keep detailed events behind the existing debug/test diagnostics gate.

### Baseline runbook

Use the persistent in-app Browser and the existing runner:

```js
let smoke =
  await import('/Users/chris/Projects/boxel/packages/host/scripts/execution-runtime-browser-smoke.mjs');
let result = await smoke.runExecutionRuntimeBrowserSmoke({
  browser,
  candidateOrigin: 'https://host.codex-execution-runtime.localhost',
  candidateTab,
  referenceOrigin: 'https://realms-staging.stack.cards',
  referenceTab,
  performanceRepeats: 5,
  timeoutMs: 30_000,
});
let summary = smoke.summarizeExecutionRuntimeSmokeRun(result);
```

Run correctness first. If either origin drifts, authentication is required, a declared
interaction fails, execution differs, or Sandbox teardown fails, stop and diagnose;
do not publish timing rows for that case. Save the raw result as JSON and append the
qualified summary to `boxel-execution-runtime-cold-start-baseline.md`, recording the
commit, browser/build mode, environment origin, date, cache state, and repeat count.

### Initial budgets and stop conditions

The first run establishes distributions, not aspirational SLAs. Until two comparable
runs exist, use only regression guardrails:

- no Direct or Capsule median regression greater than 5% without an explained common
  Host variance;
- no Sandbox median or interactive-handoff regression greater than 10%;
- no new request, clone, projection pass, live iframe, pending RPC, DOM/style, or heap
  growth after the final warm/close cycle;
- any correctness, authority, identity, or teardown regression is an immediate stop,
  regardless of latency improvement.

After the baseline, choose one optimization whose measured segment dominates and
whose correctness proof is already present. Do not implement a whole phase at once.

### Baseline implementation patch

Prepare the baseline as one reviewable, instrumentation-only patch:

1. Add a small typed stage recorder at the execution-engine boundary. It accepts a
   stable operation id, occurrence id, execution tier, stage name, monotonic start/end
   time, and inert numeric counters. It must not receive card instances, grants,
   loaders, services, DOM nodes, or source text.
2. Place marks at the existing orchestration seams rather than wrapping internals
   with new control flow: request/classification/materialization in
   `boxel-execution-engine.ts`; projection settlement in `services/boxel-execution.ts`;
   Capsule evaluation and cloning in `capsule-boxel-runtime.ts` and
   `capsule-module-evaluator.ts`; Sandbox lifecycle and RPC in
   `sandbox-runtime-process.ts` and the existing clients.
3. Expose a bounded snapshot through the existing debug/test diagnostics surface.
   Production behavior remains unchanged when diagnostics are disabled. Reading the
   snapshot must not reset runtime state or trigger work.
4. Extend `execution-runtime-browser-smoke.mjs` to capture the snapshot immediately
   after declared semantic readiness and after close/idle. Keep its existing
   correctness assertions, execution labels, teardown checks, and sequential tab use.
5. Add focused tests for recorder ordering, exactly-once completion, bounded storage,
   disabled-mode no-op behavior, and operation/occurrence separation. Do not add
   timing assertions to QUnit; the Browser run owns distributions and budgets.
6. Run the fixed corpus, save raw JSON outside the product bundle, append the
   qualified summary to `boxel-execution-runtime-cold-start-baseline.md`, and only
   then select an optimization.

This patch is deliberately disposable infrastructure: stable enough to compare
commits, small enough to delete or replace, and incapable of becoming a second
execution protocol.

### Phase 0 implementation status — 2026-08-11

The first instrumentation slice is implemented in the working tree:

- a bounded, data-only recorder that is inert until explicitly enabled;
- operation and occurrence correlation without card, source, authority, service, or
  DOM references;
- request, source, serialization, Card API, projection settlement, classification,
  materialization, runtime creation, render-record, and generation spans;
- projection-pass, included-resource, source-size, module-graph, field, and format
  counters;
- per-tier/stage median and p95 aggregation in the existing sequential browser smoke
  runner, with recorder reset between occurrences; and
- focused recorder and aggregation tests.

The development build, focused recorder QUnit tests, smoke-runner Node tests, ESLint,
and template lint pass. Full Host type lint is still blocked by the working tree's
pre-existing `.at()` target-library errors and the existing missing Sandbox `context`
argument; none originates in the instrumentation files.

Chrome DevTools MCP now controls an authenticated staging-backed tab at the custom
`.localhost` origin. A correctness-qualified, five-sample focused baseline for
`Release/opening-night` was admitted on 2026-08-11 and used to evaluate optimization
#1. The full fixed corpus and the resource/lifecycle snapshots after close and idle
eviction remain pending, so Phase 0 is not complete. Add deeper Capsule clone and
Sandbox RPC substage marks only where the coarse spans cannot identify the dominant
segment; do not widen the runtime protocol merely for diagnostics.

---

## Tier 1 — A-class legibility, small or negative LOC, large perf

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Legibility                                                                                                                                                   | LOC           | Perf estimate                                                                                                                            |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Capture `JSON.parse` from the compartment once (`this.compartmentParse = compartment.evaluate('JSON.parse')`) instead of a per-read `compartment.evaluate` of an escaped source string; the 4-pass escape gauntlet becomes unnecessary. `capsule-module-evaluator.ts:2564`                                                                                                                                                                                                                                                                                                                                              | **A**                                                                                                                                                        | **−20**       | ~100–1000× per membrane read (SES compile → function call); 10–100 ms per interactive Capsule render                                     |
| 2   | Split adopted projection work by semantic owner. Seed declared field values from the Host projection, but continue to execute every authored semantic the protocol assigns to Capsule—including `computeVia`, getters, and action-derived values—and merge only those results. Do **not** simply skip `projectionFor()`: the current contract explicitly says Capsule owns authored execution. `capsule-boxel-runtime.ts:167,189`                                                                                                                                                                                       | **A after the ownership split is specified and tested**                                                                                                      | +20–40        | Avoids rebuilding Host-owned declared values while preserving authored computation; estimate only after projection-stage instrumentation |
| 3   | Clone-once discipline: delete the duplicate `cloneJSONRecord`s on the render-record path, the `structuredClone` of an already-hardened bundle, and `validateTemplateDescriptor`'s throwaway `JSON.parse`; memoize `fieldsFor`'s clone per instance. The same field array is deep-cloned 3× and the projection 3× per Capsule materialize. `capsule-boxel-runtime.ts:133,182,197,364`, `boxel-render-record.ts:37,52`, `capsule-component.ts:265`                                                                                                                                                                        | **A** — "cloned once at the trust boundary, immutable thereafter" is a protocol statement; triple clones leave the reader unsure which copy is authoritative | **−25**       | ms–tens of ms per materialize (MB-scale clones on large cards); scales with card size                                                    |
| 4   | Validate, then ungate the `getFields` memo for the live app. The cache exists, is instance-keyed and validity-tokened, but is bypassed unless the prerender context global is set. Before changing it, prove invalidation for inheritance, polymorphic overrides, relationship changes, field configuration, compute passes, and live Monaco/AI edits. `packages/base/field-support.ts:416`                                                                                                                                                                                                                             | **A only after conformance proof**                                                                                                                           | **−3**        | Potentially large projection win. **Own PR — `packages/base`, changes main's behavior too**                                              |
| 5   | Principal- and generation-scoped source/classification memo. Dependencies are re-fetched and re-classified per distinct entry card. Cache inert bytes/pure classification by principal or equivalent authorization partition + canonical URL + source generation/ETag + compiler/classifier version + draft generation. Every hit still performs the current authority decision; `invalidate()` removes dependent entries. Never cache evaluated exports, grants, instances, DOM, or services. `boxel-source-classifier.ts:660`, `services/boxel-execution.ts:1148`, `card-service.ts:247`                              | **A** — removes entry/dependency asymmetry without weakening authority                                                                                       | +25–40        | Grid of N same-type tiles: N× fetch/classify → 1× per authorized generation; measure request and Babel counters                          |
| 6   | Split lifecycle truth into independently testable changes: (a) replace resource authority on explicit generation/reload/destroy, not blindly on retained unmount; (b) add deadlines and cancellation to every pending transport; (c) stop child diagnostics after the parent has acknowledged first interactive output unless debug diagnostics are enabled; (d) fan out Surface observations only with observers; (e) stabilize `capsuleContextProjection` identity for an unchanged Host context. `sandbox-runtime-process.ts`, `sandbox-*-transport.ts`, `boxel-sandbox-runtime.gts`, `boxel-execution-renderer.gts` | **A**                                                                                                                                                        | +30–50        | Reliability/security first; then removes steady-state messages, forced measurements, and spurious Capsule rerenders                      |
| 7   | One Babel pass instead of two per classified module; hoist the 19 per-call `RegExp`s to named module constants; make ContentTag's `Preprocessor` a singleton. `boxel-source-classifier.ts:388,436,341,410,184`                                                                                                                                                                                                                                                                                                                                                                                                          | **A** — the named constants document what classification looks for, in one place                                                                             | **−10**       | Halves per-module classification (~10–50 ms → 5–25 ms)                                                                                   |
| 8   | Evaluate `content-visibility: auto` + `contain-intrinsic-size` on fitted/gallery tiles only, with explicit exclusions for intrinsic-height Sandbox surfaces, animated/media cards, accessibility discovery, ElementTracker, and screenshot/prerender paths. Add height and offscreen-interaction tests first.                                                                                                                                                                                                                                                                                                           | **B until those semantics are proven**                                                                                                                       | +15 CSS/tests | Potentially large layout win on offscreen galleries; not safe as a universal execution-slot rule                                         |
| 9   | Group-commit equivalent sync fan-out: settle/serialize once per instance generation **and authorization-equivalent projection key** (principal, grants/policy, protocol version, format-relevant projection), then deliver that immutable document to matching views. Different grants never share a document. `services/boxel-execution.ts:557`                                                                                                                                                                                                                                                                        | **A after the equivalence key is explicit**                                                                                                                  | +10–25        | k equivalent views: k× settle+serialize → 1×; measure projection passes and bytes                                                        |
| 10  | Keep transport lanes independently owned unless profiling shows dispatch overhead. A central dispatcher may improve teardown legibility, but it is not currently a measured performance lever and can turn typed, bounded capabilities into one broad switch.                                                                                                                                                                                                                                                                                                                                                           | **B/neutral**                                                                                                                                                | ~0            | Expected latency win is negligible; defer from the performance path                                                                      |

## Tier 2 — B-class or modest scope; after Tier 1

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Legibility                                                  | LOC      | Perf estimate                                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 11  | Use a bounded classifier work queue with an in-flight promise memo per canonical module. Do not use raw `Promise.all` over the existing `visited` set: converging branches can observe “visited” before classification resolves and incorrectly treat the shared dependency as Capsule-safe. Preserve graph limits, deterministic diagnostics, cancellation, and propagation semantics. `boxel-source-classifier.ts:697`                                                                             | B+                                                          | +30–50   | Wall time approaches graph depth rather than node count without a policy race; concurrency limit is selected from baseline data |
| 12  | Open a compute pass around each projection (`beginComputePass`/`endComputePass`), so repeated `computeVia` executions within one settle pass collapse to one each. Only the prerender route opens one today. `field-support.ts:164`, `routes/render/meta.ts:261`                                                                                                                                                                                                                                     | B+ — states the snapshot semantics explicitly               | +6       | Large across the up-to-32-pass `settleHostProjection` loop                                                                      |
| 13  | Remove duplicated module parsing only after proving the authority ordering. The child must not receive executable bytes early enough to request or evaluate a dependency before the parent has admitted that exact edge. Prefer returning bytes with an already-observed dependency manifest, or let the child parse while the parent keeps subsequent fetches closed until observation commits. `sandbox-fetch-transport.ts:329`, `sandbox-module-authority.ts:46`, `boxel-sandbox-runtime.gts:361` | B− until the ordering proof exists                          | +10–30   | Can remove 1–10 ms × modules from the boot path; any authority race is a stop                                                   |
| 14  | CSS memoization: `confineCapsuleStylesheet` reuses the sheet `validateCapsuleStylesheet` already parsed (one CSSOM parse instead of two); content-keyed bounded LRU for `validateCapsuleInlineStyle` (the `cssVar` helper re-validates per render per invocation). `capsule-css-policy.ts:74`, `capsule-component.ts:68`                                                                                                                                                                             | A for the sheet reuse, B for the LRU                        | −5 / +10 | O(rows×updates) CSSOM parses → O(distinct declaration strings); 10–100 ms on list re-renders                                    |
| 15  | Per-key invalidation in the Capsule component runtime: consume the `changed` keys the action-result update already computes and currently ignores, instead of one shared `@tracked revision`. `capsule-component-runtime.ts:78,96,34`                                                                                                                                                                                                                                                                | B+ — computed-and-ignored data is an intent smell           | +25      | One action stops re-running every getter through SES + `jsonClone`; 1–10 ms/action                                              |
| 16  | Membrane read memo keyed by the instance version cell: `{version, value}` per property, re-project only when the cell bumped. `capsule-module-evaluator.ts:2314`, `services/boxel-execution.ts:746`                                                                                                                                                                                                                                                                                                  | B — expresses RP-20.2's "stable until the instance changes" | +15      | N reads of one property per render → 1 per version bump                                                                         |
| 17  | Split the store's global mutation counter per instance so an edit invalidates only the searches whose membership it can affect (already ticketed: CS-11419). `services/store.ts:251`, `resources/search.ts:535`                                                                                                                                                                                                                                                                                      | A — declares the real dependency                            | +40      | Any-edit-invalidates-every-search → affected rows only; 10–100 ms/keystroke with large result sets                              |
| 18  | GC sweep: add the visited-set dedupe to the graph builders (the sweep's own mark phase already uses one — uniformity), and skip the sweep when nothing changed since the last one. Instances are keyed under both local and remote ids, so the builders currently do everything twice. `gc-card-store.ts:1232,1254`                                                                                                                                                                                  | A / B                                                       | +10      | Halves+ the 2-minute background jank; scales with store size                                                                    |
| 19  | `preconnect`/`dns-prefetch` for the sandbox origin in `index.html` (currently absent); `modulepreload` for the child's own boot bundle in the child document head                                                                                                                                                                                                                                                                                                                                    | B — declarative hints                                       | +3       | ~1 RTT (20–100 ms) off cold boot                                                                                                |
| 20  | Add deadlines, abort/close rejection, and teardown assertions to every pending client map (`SandboxFetchClient`, `SandboxSurfaceClient`, view-card, write, render, and Boxel-runtime requests). A lost response must settle exactly once and remove its entry.                                                                                                                                                                                                                                       | **A; move to the correctness-first slice**                  | +25–40   | Prevents permanent promises/map leaks and converts hangs into typed lifecycle failures                                          |
| 21  | Stable **occurrence** retention keys: principal + authorization partition + stable stack/surface occurrence, with card/module generation as compatibility metadata. Do not key only by card/module family: two simultaneous occurrences must receive distinct DOM/process identity. Revisit can reclaim the same inactive occurrence within TTL; concurrent mounts cannot alias it. `services/boxel-execution.ts:169`, `boxel-runtime-router.ts:70`, `retained-runtime-registry.ts:22`               | B+ after occurrence semantics are tested                    | +25–40   | Eliminates a full Sandbox boot on compatible revisit without process aliasing                                                   |

## Tier 3 — big-LOC or C-class; hold until the reference implementation is stable, then measure first

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Legibility                                                                                                                              | LOC                   | Perf estimate                                                                                                          |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 22  | Slim child entry bundle: Glimmer + Loader + the Sandbox runtime shell, one route—no Matrix/realm/telemetry/operator-mode; delete stub/gate initializers that exist only because the child boots everything. Instrument this in Phase 0: prior local evidence attributes about 4.5 s of a 5.3 s Sandbox startup to the full child app boot. If the new baseline confirms that dominance, promote this into its own immediate workstream rather than waiting behind fine-grained reactivity. `routes/boxel-sandbox-runtime.ts`, `instance-initializers/stub-matrix-service-for-sandbox.ts` | **A** — states what the child _is_; "boot everything, stub the rest" is the anti-spec                                                   | +150 net (build work) | Potentially the dominant Sandbox win; target must come from production-preview and development measurements separately |
| 23  | Admitted module-graph snapshot: after classification and authorization, transfer an immutable graph of bytes + canonical dependency metadata to the child instead of N discovery-driven round-trips. Every edge is admitted before delivery and the snapshot is scoped to principal, generation, and compiler identity.                                                                                                                                                                                                                                                                  | B — unifies grant-of-authority with delivery-of-content, but adds a lane                                                                | +100                  | Re-evaluate after scoped memoization, bounded classification, Deck delivery, and the slim child; may be unnecessary    |
| 24  | `materializeAndRender` combined wire op (`createFromSerialized` → `buildRenderRecord` → `render` are always issued back-to-back with no parent-side decision between them). Keep the engine's three steps; collapse only the Sandbox wire                                                                                                                                                                                                                                                                                                                                                | B — names the real operation                                                                                                            | +60                   | ~10–50 ms (port RTTs are cheap; the win is deadline simplification)                                                    |
| 25  | Handshake-loaded initial render (0-RTT analog: the `connect` message carries the initial document/format/permissions)                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **C** — complicates the bootstrap protocol's clean phases                                                                               | +80                   | Modest once #24 exists                                                                                                 |
| 26  | JSON-Patch delta sync on the instance lanes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **C** — full-state push is _the_ self-healing story ("every push carries full current state; a missed one self-heals"); deltas break it | +100+                 | 1–10 ms/push; bandwidth only                                                                                           |
| 27  | Warm pool / speculative boot / hidden cache-warm boot                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **C** — all three contradict "born in place; classification decides"                                                                    | +40–150 each          | Seconds on first visit; the honest subset (stable retention keys) is already Tier 2 #21                                |
| 28  | Worklist-based `settleHostProjection` (reproject only dirty nodes per fixpoint pass)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | **C** — the 8-line "repeat until stable" loop is clearer                                                                                | +40                   | Mostly obsoleted by #4 + #12                                                                                           |
| 29  | Classifier in a Worker (it is pure: string in, plain object out)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | B− — mechanical, but adds indirection                                                                                                   | +60                   | Main-thread responsiveness, not latency; partly obsoleted by #7 + #11                                                  |

## Recommended order

### Phase 0 — measure a green system

Execute the baseline runbook above and land only the passive timing/counter marks
needed to decompose the observed critical path. The output is one raw JSON record and
one appended Markdown summary. Do not combine this commit with an optimization.

### Correctness-first slice — smallest risk, required regardless of latency

1. Add deadlines, close/abort rejection, and exactly-once cleanup to all pending
   transport requests (#20/#6b).
2. Make resource/module authority replacement explicitly generation-scoped and test
   reload, retained unmount/remount, card replacement, and denial after revocation
   (#6a). Do not clear retained authority accidentally and do not let it accumulate
   across incompatible generations.
3. Gate idle Surface/diagnostic observation and stabilize unchanged Capsule context
   identity (#6c–e), with message/reflow counters proving the removed churn.

These changes are reliability/spec work. They may improve steady state, but they do
not need a latency claim to justify themselves.

### First measured optimization — one change at a time

Prefer the first item whose segment is dominant in Phase 0 and whose correctness proof
already exists. The lowest-risk/high-payoff candidates are:

1. **#1 captured compartment `JSON.parse`**—local implementation, no cache, no
   identity change, easy before/after membrane microbenchmark plus full Capsule smoke.
2. **#3 clone-once render records**—make boundary immutability explicit; assert input
   objects remain unchanged and all Direct/Capsule/Sandbox records stay equivalent.
3. **#7 one classifier parse/Babel pass**—pure string-in/data-out work; snapshot every
   existing classification signal before removing the duplicate pass.
4. **#5 scoped source/classification memo**—only after the baseline proves repeated
   fetch/classify work is material and the principal/generation/draft key has denial,
   invalidation, and concurrent-request tests.

Land and remeasure each separately. Keep it only when the intended counter falls, the
qualified cohort remains green, and Direct/Capsule/Sandbox guardrails hold. This is
the initial implementation queue; #2, #4, #9, #11, #13, and #21 are not part of the
first slice because each changes semantic ownership, authority equivalence,
concurrency, or identity.

**Provisional first choice: #1, captured compartment `JSON.parse`.** It changes only
how an already-authorized JSON value enters the same compartment; it adds no cache,
does not alter projection ownership, does not change execution-tier selection, and
does not affect occurrence or lifecycle identity. Prepare its focused benchmark and
Capsule conformance test now, but do not land the implementation unless Phase 0 shows
membrane evaluation is material. If it is not, follow the measured critical path
rather than defending this choice.

**Implemented and retained on 2026-08-11.** Three independent benchmark runs on a
2,412-byte representative value measured a 3.88–4.22× speedup and a 74.2–76.3%
reduction in the clone operation. Five full pre/post Release loads remained
correctness-green and kept navigation within the 5% guardrail (+3.2% median), but
their coarse render-record spans were inconclusive because the post-change Host
request median was 51% slower. The claim is therefore limited to the measured
boundary operation; no page-level latency win is claimed.

**Second measured batch implemented and retained on 2026-08-11.** Three
semantics-preserving slices from the queue were small enough to assess together:

- #3 now passes the Capsule projection directly to the shared render-record
  assembler, which remains the sole output clone boundary. A focused mutation test
  proves the returned record cannot mutate runtime-owned projection data. The more
  invasive bundle/field/template-parser parts of #3 remain unimplemented.
- #7 combines executable global and DOM-method collection into one Babel traversal,
  hoists the signal patterns, and reuses ContentTag's preprocessor. The existing
  classification matrix plus a combined `document`/`getContext` case remains green.
- the A-class half of #14 makes validation return its parsed CSSOM sheet to
  confinement. The bounded inline-style LRU remains unimplemented.

The higher-iteration focused benchmark measured the classifier at 3,389.96 →
1,556.67 µs/operation (**2.18×, −54.1%**) and the representative render-record
assembly at 216.86 → 151.42 µs/operation (**1.43×, −30.2%**). ContentTag constructor
reuse was median-neutral (55.59 → 56.63 µs) under the same run, so no latency claim
is attached to that subchange. A Chrome-native 80-rule stylesheet benchmark measured
validation-plus-confinement at 1,320 → 902 µs/operation (**1.46×, −31.7%**) with
identical serialized CSS.

Five authenticated Release loads remained semantic-parity green, Capsule-only, with
zero iframes and zero dropped records. Root render-record median improved from the
previous 655.9 ms to 586.2 ms (**−10.6%**), while root request median worsened from
356.0 ms to 413.8 ms (**+16.2%**) and one render outlier lifted p95 to 1,113.7 ms.
The 20.9 s page-navigation median was dominated by current Host/staging delay and is
not comparable to the earlier run. The retained claim is therefore the focused work
reduction plus the improved render-record median, not a whole-page latency win.

**Safe lifecycle batch implemented and retained on 2026-08-11.** The low-risk parts
of #6 are now explicit protocol behavior:

- fetch and Surface requests have a 10 s deadline, closed-state rejection,
  exactly-once settlement, timer cleanup, and harmless late responses;
- Sandbox Surface observation is subscribed across the port only while the child
  has a listener, and the Host installs DOM observers only while the service has a
  subscriber;
- after the first visible render the parent acknowledges the diagnostic and removes
  that listener, while the child stops DOM measurement and posts; explicit
  performance diagnostics keep the lane enabled, and runtime-error reporting remains
  independent and live; and
- Capsule context projection preserves object identity across fresh Host context
  wrappers until one of the two projected presentation capabilities changes.

A Chrome-native alternating benchmark measured unchanged Capsule context projection
at 3.1 → 0.2 ms per 100,000 accesses (**−93.5%**) and 100,000 → 1 facade allocations.
The lifecycle gates have stronger exact work counters than timing claims: after
first-paint acceptance, 1,000 simulated post-paint diagnostics perform 0 DOM
measurements/posts instead of 1,000; an attached surface with no subscribers creates
0 observers and performs 0 initial layout reads instead of two observers and one
read. A silent fetch or Surface request now lives for at most 10 s instead of
unbounded time.

Three warmed authenticated `Release/opening-night` loads remained parity-green with
all five semantic signatures, Capsule-only execution, nine headings, zero iframes,
zero dropped records, and 946–957 DOM nodes. Medians were 26.18 s readiness, 241.2 ms
root request, and 612.9 ms root render-record. Relative to the prior retained run,
request was 41.7% lower, render-record was 4.6% higher, and readiness was 25.3%
higher; this contradictory movement is treated as Host/staging variance, so no
page-level latency claim is attached to the batch.

**Compatible Sandbox format-switch batch implemented and retained on
2026-08-11.** A same-card `isolated` ↔ authored-`edit` toggle now keeps one
component-owned execution session and transfers the already-mounted Sandbox slot
between resource generations. `switchSandboxFormat()` repeats policy admission
against the retained source classification; if the destination is not Sandbox, or
the card or base-template identity changed, it returns to the ordinary full-update
path.

For an admitted switch, the retained path asks the existing child card handle for
the new format's render slot. It does not repeat Host request construction, source
preparation, classification, serialization, projection settlement, child
materialization, or iframe boot. Instance-sync and lifecycle listeners are
reconnected for the new resource generation, and the `format-switch` performance
stage records the remaining child-render work.

Focused engine coverage asserts one child materialization, no child-card disposal,
and one retained semantic generation across the round trip. Integration coverage
toggles `isolated → edit → isolated → edit → isolated` and asserts exact iframe DOM
identity after every switch. These exact work and identity assertions justify the
retained implementation; comparable before/after browser samples were not captured,
so no page-level or format-switch latency improvement is claimed here.

### Sandbox boot decision

The existing 2026-08-09 development record attributes about 4.46 s of a 5.31 s
Sandbox startup to child Vite/Ember boot and only about 440 ms to first module
materialization. Repeat that decomposition on the current checkpoint and on a
production preview. If child boot still dominates, promote #22 (the slim child) into
its own architecture workstream before fine-grained reactivity. Do not spend months
making a 440 ms segment perfect while retaining a multi-second child boot.

Only after the slim-child decision should we consider bounded classifier concurrency
(#11), authority-ordered parse deduplication (#13), or an admitted graph snapshot
(#23). Deck/Realm Server immutable delivery may remove enough network cost that those
features are unnecessary.

### Later measured reactivity

Items #12, #14–18, and occurrence-safe #21 follow only when profiles show steady-state
projection, CSS parsing, broad invalidation, GC, or revisit boot as the limiting path.
Item #4 remains a separate Base change with its full invalidation conformance suite.
Item #8 remains a fitted/gallery experiment, not a universal execution-slot rule.

Everything C-class stays out of v1 deliberately. The full-state protocol, explicit
bootstrap phases, and born-in-place execution identity are more valuable than small
bandwidth or first-visit wins until measured evidence says otherwise.

## Borrowed patterns referenced above

For the record, the cross-domain patterns each item draws on: compartment-function
capture (#1) is standard membrane practice; per-module memoization (#5) is query-based
incremental compilation (salsa / rust-analyzer); group commit (#9) is the database
write-coalescing pattern; bounded graph walk (#11) is worklist fan-out with in-flight
deduplication from dataflow analysis; admitted graph snapshot (#23) is an immutable
content-addressed deployment artifact, not a broad authority cache; handshake loading
(#25) is TLS 1.3 0-RTT; delta sync (#26) is video-codec I-frame/P-frame; pooling (#27)
is game-engine object pooling; occurrence-safe retention (#21) is cache keying by
stable UI occurrence plus compatibility metadata rather than card family alone—the
same derivation-over-authority stance as the Deck name ruling.
