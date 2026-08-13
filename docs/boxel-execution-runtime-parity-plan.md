# Execution runtime parity plan: Capsule (SES) and Sandbox (iframe)

## Who this is for and how to use it

This is a work order for a coding agent continuing
`codex/boxel-execution-runtime-architecture`. It supersedes ad hoc
hypothesis-chasing (the H1–H11 log in
[boxel-execution-runtime-suite-parity.md](boxel-execution-runtime-suite-parity.md))
with a slice-ordered plan derived from a first-principles audit of the branch
at `c630781d61`.

Read first, in this order:

1. [boxel-execution-runtime-architecture.md](boxel-execution-runtime-architecture.md)
   — the target design. It is authoritative for ownership, naming, and
   boundary rules.
2. This document — the diagnosis, the work slices, and the working agreements.
3. [boxel-execution-runtime-suite-parity.md](boxel-execution-runtime-suite-parity.md)
   — the behavioral log so far (Opening Night green through Capsule; Track and
   Playlist red through Sandbox).

Rules of engagement:

- Every slice has exit criteria. Do not start slice N+1 features while slice N
  exit criteria are red, except where a slice explicitly marks parallelizable
  items.
- The frozen reference branch `codex/code-preview-instant-reload` (local; last
  commit `3a51b51039 "Fix persistent hosted iframe capsules"`) is an oracle
  for behavior and proven algorithms, never a source of orchestration code.
- The staging suite realm
  `https://realms-staging.stack.cards/ctse/execution-runtime-suite/` is the
  exploratory oracle. CI fixtures are the deterministic layer; the realm is
  not a substitute for CI, and CI is not a substitute for looking at the
  realm.

## Diagnosis: why the recent work feels like patching holes

The H1–H11 fixes were individually reasonable, but ten of eleven are symptoms
of three root causes. Fixing symptoms without the root causes guarantees an
unbounded stream of H12, H13, … Each root cause below names the hypotheses it
explains and the slice that retires it.

### Root cause 1 — there is no single canonical projection (H1, H3, H4, H7, H8, H10)

The architecture's central promise is one `BoxelRenderRecord` assembled by one
pure pipeline and consumed identically by every tier. What exists is **three
competing projection builders** that each reverse-engineer the record:

- Direct's builder in `packages/host/app/lib/direct-boxel-runtime.ts`
  (linked values as `{$boxel:{id,type}}` references; real merged
  `resolvedConfiguration`; formats from the real prototype chain);
- Capsule's `snapshotFromResource` path in
  `packages/host/app/lib/capsule-boxel-runtime.ts` (linked values fully
  expanded from `included`; `resolvedConfiguration` always `null`;
  `presentation` a different shape; formats from a hard-coded 7-format
  fallback list);
- a third mutating pass, `projectTrustedBoxelSemantics` (~210 lines in
  `packages/host/app/services/boxel-execution.ts:561-772`), that rewrites the
  request document in place before either runtime sees it.

Every relativeTo/cardInfo/getter/currency/absolute-URL hypothesis was a place
where two of these three disagreed. There is no test that renders the same
card through Direct and Capsule and diffs the records, so each disagreement is
discovered visually on staging and patched at the symptom site.

### Root cause 2 — the Capsule Card API facade has no conformance oracle (H8, H9, plus the currency shim)

`cardAPIFacade()` in `packages/host/app/lib/capsule-module-evaluator.ts`
(~1676–2105) is a from-scratch reimplementation of CardDef/FieldDef/field
decorators with no serializer, no `queryableValue`, no `computeVia` string
form, and inert trusted Base field types. Nothing pins it to real Card API
behavior, so every divergence surfaces as a rendering bug and gets a bespoke
patch. The tell is `packages/runtime-common/currency-code-symbol-map.ts`: 179
lines of vendored ISO currency data added so one Base getter's output could be
reproduced — precisely what the architecture forbids ("The Host never
attempts to copy the function or rediscover field-specific statics such as
currency symbols"). The architecture's actual answer (H8 got halfway there):
**trusted Base semantics are materialized Host-side by the Direct runtime and
cross the boundary as data; the facade only ever needs authored semantics.**
The `esm.run/currency-code-symbol-map` loader shim in
`boxel-loader-compatibility.ts` is separately fine (it host-owns a data-only
package that deployed realms import); the vendored map's use as a semantic
substitute is not.

### Root cause 3 — no CI rendering path through any tier (H11 and every future H)

`BoxelExecutionRenderer` — the component every tier flows through — is never
rendered by any test. There is no Capsule DOM-output test (only bundle-shape
tests), no Sandbox child test at all (bootstrap handshake, child shell, slot
modifier: zero coverage). That is why H11 is being debugged by hand on
staging, and why the prime suspect below could sit invisible in a
one-line modifier. The reactive fix loop is a direct consequence: with no
executable conformance layer, "fix" means "make the staging page look right."

### The H11 prime suspect (verify first, then fix)

Static reading of the code identifies a concrete ordering defect that produces
exactly the reported symptom (iframe mounts, no authored DOM, no error):

1. `createSandbox()` parents the iframe into a hidden **parking div**
   (`services/boxel-execution.ts:373-376`) before
   `sandbox-runtime-process.ts:339` sets `src`.
2. The child boots there, hands over `port2`, and the parent removes its
   bootstrap listener permanently (`sandbox-runtime-process.ts:335`).
3. `getRenderSlot()` awaits `renderClient.render(...)` — the child paints
   inside the 0×0 parking div and replies `ok: true`.
4. Only then does the renderer set `state.slot`, mounting the slot `<div>`,
   and `BoxelSandboxSlotModifier` runs
   `element.replaceChildren(slot.iframe)`
   (`modifiers/boxel-sandbox-slot.ts:20`).
5. **Re-parenting an `<iframe>` destroys its browsing context and reloads the
   document.** The painted DOM is discarded, `port2` dies with the old
   window, the reloaded child re-announces `listening` forever
   (`sandbox-runtime-host.ts:69-72`) to a parent that stopped listening, and
   nothing reports an error because `render()` already resolved.

`parkSandboxIframe` repeats the same re-parent on teardown. This is a
hypothesis from code reading, not observation: falsify it first (one probe:
log child `load` events and port closure around the `replaceChildren` call),
then fix it at the level of the **iframe lifetime model** (slice 3), not with
a re-handshake patch.

## What is sound — do not rebuild

The audit found real engineering worth protecting. Keep, and treat as the
spine:

- `BoxelRuntime` interface + handle registry (`lib/boxel-runtime.ts`) — no
  leakage, faithful to the doc.
- `CapsuleComponentManager` / `_CapsuleComponent`
  (`lib/capsule-component.ts`) — textbook public custom component manager,
  `capabilities('3.13', {destructor, updateHook})`, no private Glimmer APIs.
- The template-capture mechanism: SES compartment with
  `@ember/template-factory` / `@ember/component` facades, inert descriptors,
  wire-data validation, one `setComponentTemplate()` per definition. This is
  the designed mechanism, genuinely working.
- `BoxelExecutionSession` generation discipline
  (`lib/boxel-execution-engine.ts:144-263`) — atomic swap,
  obsolete-generation rejection, last-known-good retention; tested.
- The Sandbox transports (`sandbox-boxel-runtime-{client,server}.ts`,
  `sandbox-render-transport.ts`, `sandbox-fetch-transport.ts`,
  `sandbox-module-authority.ts`) — careful validation, fail-closed, tested.
- `capsule-css-policy.ts`, `SurfaceService`, `RetainedRuntimeRegistry`.
- The Loader's pluggable `moduleEvaluator` / `invalidateModule` seam.

## Slice 0 — stop the line: safety, dead code, and the missing feedback loop

Small, independent, all landable in days. Nothing later makes sense without
0.3.

- [ ] **0.1 Fix the eval-visibility regression in the trusted loader.**
      `runtime-common/loader.ts`'s `evaluateModuleInCurrentRealm` replaced the
      original "attach locals to a function object so the bundler cannot drop
      them" pattern with `let define = ...; void define; eval(source)` and
      deleted the explanatory comment. A production Rollup/Vite build that
      drops the local breaks every trusted module load. Restore the
      bundler-safe pattern and its comment; add a build-mode test if feasible.
- [ ] **0.2 Delete dead code** (each is zero-referenced or test-only):
      `components/trusted-base-format.gts`; `lib/surface-client.ts`
      (`LocalSurfaceClient`) **or** the DOM-`CustomEvent` dispatch path in
      `modifiers/surface-element.ts` — decide one transport for Direct/Capsule
      surface calls and delete the other (recommendation: keep the modifier
      path, delete the unused client); evaluator dead exports
      (`installFormatOnlyImport`, `trustedTestShimComponent`,
      `hasModuleExport`, `templateFor`); the classifier's unconsumed
      `formatOnlyImports` analysis (~135 lines in
      `lib/boxel-source-classifier.ts:411-546`).
- [ ] **0.3 Stand up the tier-conformance rendering harness in CI.** One
      integration-test entry that renders a fixture card through
      `BoxelExecutionRenderer` with `@execution` forced to each tier, in a
      real DOM, and asserts: mounted `data-boxel-execution` value, visible
      text, and the cloneable `BoxelRenderRecord`. Sandbox runs its child in a
      real iframe inside the test browser. This harness is the falsifier for
      H11 and the regression net for everything after. (The engine-level test
      with three mock runtimes does not count.)
- [ ] **0.4 Close the suite's boundary lane.** The Host already emits
      `data-boxel-execution` on every mount; the staging suite's
      `ExpectedRoute.observedTier` adapter was never written, so every
      boundary row — and therefore every case verdict — is `pending` by
      design. Write the small adapter in the suite realm (per
      [boxel-execution-runtime-suite-harness.md](boxel-execution-runtime-suite-harness.md),
      "ExpectedRoute — the seam"). This turns the five built cases into live
      pass/fail signal for all remaining work. (Realm-side change: follow the
      realm-mirror workflow, not monorepo edits.)
- [ ] **0.5 Record the baseline.** With 0.3 and 0.4 in place, snapshot the
      current green/red matrix (CI harness + suite cases 1–5) before touching
      projection code, so slice 1 has a before/after.

Exit: CI renders at least one fixture in all three tiers; suite cases 1–3
report observed tiers; loader eval regression fixed; dead code gone.

## Slice 1 — one canonical projection (retires root cause 1)

Goal: `BoxelRenderRecord` and `ResolvedField` have exactly one shape,
produced by exactly one Host pipeline, with Direct as the executable oracle
and a record-diff conformance test enforcing it.

- [ ] **1.1 Specify the record.** Decide and document (in the protocol
      module, as types + TSDoc) the single answer for each divergence:
      linked values are **references** (`{$boxel:{id,type}}`), never expanded
      object graphs; `resolvedConfiguration` is the real merged configuration
      in every tier; one `presentation` shape; `writable` has one semantic
      (per-field write grant intersection, not `purpose ===
    'interactive-edit'`); `formats` come from declared inventory + trusted
      fallback discovery, not a hard-coded list. Bump
      `BOXEL_EXECUTION_PROTOCOL_VERSION`.
- [ ] **1.2 Collapse the three builders into one pipeline.** Extract
      `projectTrustedBoxelSemantics` and friends out of
      `services/boxel-execution.ts` into a pure `lib/` projection module
      invoked by `buildBoxelRenderRecord()`. It must not mutate the request
      document. Direct's builder becomes the reference implementation;
      Capsule's `snapshotFromResource` conforms to it or is deleted in favor
      of consuming the shared pipeline's output.
- [ ] **1.3 Trusted-Base materialization is Host-side, once.** Trusted Base
      getters (currency symbol, relationship summaries, defaults) are
      evaluated by the Direct runtime over the canonical instance during
      projection; results cross as data. Then **delete
      `currency-code-symbol-map.ts` as a semantic source** (keep the loader
      shim only if deployed realms still import the esm.run package —
      verify, and record the answer either way).
- [ ] **1.4 Record-diff conformance test.** For each fixture in the CI
      harness: render through Direct and Capsule (and Sandbox where
      classified), deep-diff the `BoxelRenderRecord`s modulo declared
      tier-specific fields (there should be almost none). A diff is a CI
      failure. This test is the permanent replacement for H-style visual
      debugging of projection bugs.
- [ ] **1.5 Make the protocol version and features real.** Consumers check
      `protocolVersion` on `BoxelDescription`/`BoxelRenderRecord` (today it
      is stamped and never read); `requiredFeatures` is populated by
      producers and rejected-when-unknown by consumers, failing closed with
      last-known-good per the architecture. Same for
      `BOXEL_SURFACE_PROTOCOL_VERSION`.
- [ ] **1.6 Type the template bundle's dependency vocabulary.** Replace the
      flat `CapsuleScopeReference` `'trusted-export'` catch-all with the
      architecture's typed union (`TrustedComponentReference`,
      `TrustedHelperReference`, `SafeModifierReference`, block/sandbox refs),
      add `protocolVersion` to the bundle, and reject unknown kinds at
      validation time. This also absorbs the `cssVar` special case: `cssVar`
      becomes an entry in the declared safe-helper vocabulary instead of a
      module+name string match duplicated in `capsule-component.ts` and the
      evaluator.
- [ ] **1.7 Extract `SafeEvent` into the protocol module** as an exported,
      versioned type (today it is an untyped record built by a private
      function).

Exit: record-diff conformance green across tiers for the slice-0 fixtures;
`projectTrustedBoxelSemantics` no longer exists in the service; currency map
retired as a semantic source; version/feature checks enforced and tested.

## Slice 2 — Capsule to parity on the canonical contract (retires root cause 2)

- [ ] **2.1 Pin the facade to an oracle.** Write a facade-conformance suite:
      the same authored fixtures evaluated by real card-api (Direct) and by
      `cardAPIFacade` (Capsule), asserting agreement on field metadata,
      inheritance, enum variants, `computeVia` (including the string form —
      currently missing), configuration merge, and default values. Grow the
      facade only against a red conformance case, never against a staging
      screenshot. Where a semantic is out of facade scope by design (e.g.
      serialization stays Host-side), record that as an explicit exclusion in
      the suite, not silence.
- [ ] **2.2 Preserve authored component state across arg updates.**
      `DefaultCapsuleComponentRuntime.updateComponent`
      (`capsule-component-runtime.ts:178-206`) destroys and re-creates the
      authored component when the projected argument signature changes,
      discarding `@tracked` state — contradicting the Phase 2 ledger claim.
      Update args in place through the Host-owned cells; destroy only on
      definition change.
- [ ] **2.3 Wire invalidation.** `Loader.invalidateModule`,
      `CapsuleModuleEvaluator.invalidateModule`, and
      `BoxelExecutionService.invalidate` all exist and have **zero callers**;
      render slots are cached by `module#name:format` with no source-hash
      key, so a source edit today can never invalidate a Capsule render.
      Connect source-change events to invalidation, key caches by source
      hash, and add one test: edit source → next render uses the new
      generation; failed generation retains last-known-good. (Full HMR/DOM
      adoption stays in Phase 4; this is only correctness of staleness.)
- [ ] **2.4 Replace string-matching with module identity.**
      `isCardAPIImport`/`isBaseEnumImport`/`isHostCommandImport` pathname
      regexes, and the classifier's `esm.sh` version fixups, become
      resolutions against canonical URLs from the resolved import graph.
- [ ] **2.5 Rebuild the classifier on structure, not text.**
      `boxel-source-classifier.ts` (835 lines) decides the security-relevant
      Capsule/Sandbox routing with ~15 regexes over source text and compiled
      Glimmer wire opcodes plus a hand-written comment masker. Re-derive
      classification from the transpiler's AST/import graph (the pipeline
      already parses everything), keep the module-based rule (one
      browser-global import sandboxes every format of that module), keep
      fail-closed-to-Sandbox for unresolvable modules but emit a diagnostic
      naming the unresolvable import. Preserve the existing classifier unit
      tests as the spec; they are good.
- [ ] **2.6 Justify or tighten lockdown.** `ensureCapsuleLockdown()` calls
      SES `lockdown()` process-wide, lazily, with five compatibility escapes
      (`evalTaming:'unsafe-eval'`, `consoleTaming/errorTaming/localeTaming:
    'unsafe'`, `overrideTaming:'severe'`). Move lockdown to a deliberate
      app-boot point, and document each escape with the concrete dependency
      that requires it — or remove it. An undocumented escape is a future
      security-review finding.
- [ ] **2.7 Fix the handle leak** in `readComponentProperty`'s fallback
      branch (`capsule-module-evaluator.ts:997-1008`): it instantiates a
      component whose handle is never released.

Exit: facade conformance suite green for every semantic the five suite cases
exercise; source edit invalidates Capsule output in a test; no
pathname-regex module identification remains; suite cases 1–3 remain green
with observed tiers matching expected.

## Slice 3 — Sandbox to parity (fixes H11 at the model level)

- [ ] **3.1 Falsify, then fix, the iframe lifetime model.** Confirm the
      re-parenting reload (see diagnosis). Then choose the model and make it
      an invariant: **a live iframe is never re-parented.** Recommended
      shape: the renderer mounts the slot element first; the process creates
      the iframe directly inside it (prerender placeholder shows until
      ready); retention across unmounts keeps the iframe in a persistent
      Host-owned layer and shows/positions it without moving it in the DOM —
      consult the frozen reference branch's proven approach (`3a51b51039
    "Fix persistent hosted iframe capsules"`) for the retained-child
      technique, porting the algorithm, not the orchestration. Delete
      `parkSandboxIframe`'s re-parenting or rebuild it under the invariant.
      DOM custody moves out of `BoxelExecutionService` into the component /
      modifier that owns the element (the service holding a raw
      `HTMLIFrameElement` parking lot is the RealmSandboxService shape
      re-forming).
- [ ] **3.2 Give the child the provider wiring `CardRenderer` has.** The
      child shell (`components/boxel-sandbox-runtime.gts`) provides one
      context; `CardRenderer` consumes five and provides two. Inside the
      child document, provide child-local, protocol-backed equivalents:
      `CardContextName` (child-local `cardComponentModifier`, brokered
      `getCard`/`getCards`/`getCardCollection` limited to the granted
      included graph), `CardURLContextName`, permissions,
      `@displayContainer`, and CRUD functions that either broker to typed
      Host capabilities or are explicitly absent-with-diagnostic — never
      silently `undefined`. Child-local Base rendering of the subtree is by
      design (the child owns its Glimmer and Base); what must not happen is
      Base falling back to no-op context functions and rendering empty.
- [ ] **3.3 Post-render failure is a first-class signal.** Today a Glimmer
      throw after `render()` resolves `ok:true` is invisible. Add a child →
      parent render-status message (ready / error with bounded diagnostic)
      after paint; parent shows the standard error presentation and retains
      the prerender placeholder as Sandbox last-known-good (currently the
      slot just disappears). Readiness also gates removing the placeholder.
- [ ] **3.4 Harden the child transport edges.** Scope the brokered fetch
      handler to module/asset reads instead of mounting on the child app's
      global `VirtualNetwork`; add timeout and port-closed detection to
      `SandboxFetchClient.fetch` (today a lost request hangs forever).
- [ ] **3.5 Negotiate layout instead of hard-coding it.**
      `sandbox-runtime-process.ts` assumes `fitted → allocated, else
    intrinsic`; route this through `surfaceLayout` so the child reports
      intrinsic size and the parent allocates, matching Direct/Capsule
      semantics.
- [ ] **3.6 Sandbox CI coverage.** Extend the slice-0 harness: bootstrap
      handshake test, child renders authored DOM with visible text, nested
      Base field renders real values (not the no-op-context blanks),
      post-render error propagates, teardown closes ports and removes the
      iframe. The record-diff conformance test from 1.4 runs against Sandbox
      for sandbox-classified fixtures.

Exit: suite case 4 (Track / music player) and case 5 (Playlist) green on
staging with observed tier `sandbox`; all six 3.6 CI tests green; no
`replaceChildren`-style iframe moves anywhere.

## Slice 4 — service decomposition and cross-tier acceptance

- [ ] **4.1 Decompose `BoxelExecutionService` (797 lines) before it becomes
      `RealmSandboxService`.** After 1.2 (projection out) and 3.1 (DOM
      custody out), move source fetching + classification invalidation
      behind the classifier/loader seam, and field-portal construction into
      its own lib module. The service should end as thin orchestration:
      session creation, engine lifetime, tier policy. Also resolve the name
      collision: `services/direct-boxel-runtime.ts` wraps
      `lib/direct-boxel-runtime.ts` under the same class name — rename the
      service wrapper.
- [ ] **4.2 Update the architecture doc's target-module table** to name the
      real module inventory (evaluator, classifier, engine, transports,
      renderer, portals — ~7,000 implemented lines currently live in modules
      the table doesn't name). The table is the review contract; keep it
      true.
- [ ] **4.3 Deterministic suite subset in CI.** Port a representative
      fixture per suite case 1–5 into Host test fixtures (the composition
      suite doc's stated intent) so the cross-tier matrix runs in CI, with
      the staging realm remaining the exploratory superset. Include the
      "known-red baseline" discipline from the harness doc: expected reds
      are declared, anything else is a failure.
- [ ] **4.4 Suite progression: cases 6–8** (Rich LinerNotes; ReleaseEditor —
      requires slice 5; PosterBoard) per
      [boxel-execution-runtime-composition-suite.md](boxel-execution-runtime-composition-suite.md).

Exit: service under ~300 lines of orchestration; CI cross-tier matrix green
for cases 1–5 equivalents; architecture doc table current.

## Slice 5 — mutation (Phase 3 of the architecture)

`serializeCardPatch()` exists on all runtimes with **zero production
callers**, and none of the mutation protocol's records exist. Implement per
[boxel-execution-runtime-mutation-protocol.md](boxel-execution-runtime-mutation-protocol.md),
in its step order: intent/write-grant/request/result records first, then wire
`serializeCardPatch` behind them (Capsule's must gain Direct's
computed-field rejection), edit-session + generation identity, optimistic
overlay, structured rejection, Store PATCH, acknowledgement. The five open
design decisions recorded in that doc need answers before coding the
affected steps — surface them for review rather than choosing silently.

## Slice 6 — HMR and source volatility (Phase 4)

On top of 2.3's correctness wiring: source generations, compatible-update DOM
preservation via captured-template signatures, incompatible-update deliberate
remount, SSE/index acknowledgement (never restoring an older generation),
Code/Interact parity. Use the frozen reference branch's HMR behavior as the
oracle. Reserved slots to honor while getting here: `buildBoxelRenderRecord`
must grow its `authorizationProjection` parameter (Phase 6's seam — reserve
it in slice 1 if cheap).

## Working agreements (how to not regrow the hole-patching)

1. **Diagnose in the open, fix behind a test.** The H-hypothesis format
   (evidence → prediction → probe → result) was good practice — keep it in
   the parity doc. But a "Result: confirmed and fixed" entry is only valid
   when the probe landed as a CI test. No fix without its falsifier in the
   suite or CI.
2. **No new special case without a vocabulary entry.** Any module-name,
   export-name, package-name, or format-name string match must be an entry
   in a declared, typed vocabulary (dependency kinds, safe helpers, trusted
   providers) — never an inline regex or `switch` at the use site.
3. **Symptom fixes must name their root cause.** Before patching a
   projection or facade bug, state which of the three root causes it
   belongs to; if the root-cause slice is already done, the conformance
   test that should have caught it gets extended in the same change.
4. **One record shape.** Any change to `BoxelRenderRecord`,
   `ResolvedField`, or the bundle types happens in the protocol module with
   a version bump and lands with record-diff conformance updates across all
   three tiers in one change.
5. **Ownership per the architecture.** New modules get a row in the
   architecture doc's target table in the same PR. A service accreting a
   second concern is a review blocker, not a follow-up.
6. **The suite stays honest.** A case is green only when semantic, visual,
   interactive, and boundary lanes are all answered — a mounted-but-blank
   iframe, raw JSON, or `pending` route is never a pass.

## Status snapshot backing this plan (as of `c630781d61`)

- Direct + Capsule: representative composition parity on Opening Night
  (suite cases 1–3 visually green; boundary lanes pending until 0.4).
- Sandbox: bootstrap, transport, classification, and exact-graph fetch
  authorization complete; child paints no authored DOM (H11; prime suspect
  above); cases 4–5 red.
- Mutation protocol: 0/10 steps; authorization projection: 0/10 steps
  (both docs are explicitly "proposed").
- Surface capabilities: `surfacePresentation`, `surfaceLayout`,
  `surfaceObserve` real end-to-end; the other 11 in the ledger are design
  only; the coverage audit's capability ledger and the shipped API have
  drifted (audit lists deleted `safeModifier`, omits shipped
  `surfaceLayout`).
- The coverage audit (`boxel-execution-runtime-coverage-audit.md`) describes
  the **frozen POC branch**; every "exact automated" test citation in it
  dangles on this branch. Treat it as the POC's evidence ledger, not this
  branch's.
- Tests: ~2,500 lines, strongest at the compartment/bundle and transport
  layers; zero coverage of `BoxelExecutionRenderer`, Capsule DOM output, or
  any Sandbox child behavior.
