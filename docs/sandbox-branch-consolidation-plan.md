# Sandbox branch consolidation plan

## Goal

Turn `codex/code-preview-instant-reload` from a broad research branch into a
reviewable production change that:

- isolates user-authored card code by realm and execution tier;
- preserves the navigation, rendering, and editing behavior supported on
  `main`;
- keeps trusted Base/host loaders immune from user-module invalidation;
- retains responsive Code and Interact previews through targeted HMR;
- replaces implicit executable-object access with explicit boundary APIs; and
- leaves spike/demo infrastructure outside the production change.

The existing `codex/realm-isolation-ses-spike` branch preserves the original
realm-isolation harness and worker experiments while this branch is reduced.

Reviewers should use
[the realm sandbox reviewer guide](realm-sandbox-reviewer-guide.md) before
reading the aggregate diff. It builds the implementation from Loader graph and
authority concepts through SES, the explicit card boundary, iframe escalation,
stable Glimmer islands, and Code-preview generations, then maps each layer to
its production files and tests. The
[follow-up plan](realm-sandbox-follow-up-plan.md) separates work required
before review, work required before merge, later architecture cleanup, and
security hardening.

## Current branch size

Relative to local `main`, the consolidated working tree currently changes 141
tracked files with approximately 16,595 insertions and 929 deletions. The
working directory contains 144 changed paths when untracked tests, production
helpers, and diligence documents are included. Compared with the starting
point for this pass, spike removal and consolidation removed roughly 6,600
net inserted lines and 36 changed paths.

This is too broad to review as one undifferentiated sandbox change.

## Change partitions

### A. Core sandbox boundary

Keep in the core production change:

- SES compartment module runtime and explicit import/source policies;
- opaque host record and card-type metadata boundary;
- boundary-aware delegated card rendering;
- trusted/Base loader separation;
- targeted module invalidation;
- scoped style transport and registry;
- stable render envelopes and renderer-owned loading/error surfaces;
- typed iframe protocol and parent renderer for eligible DOM-heavy formats;
- explicit materialization purpose (`host-record` versus `realm-execution`).

Primary locations:

- `packages/base/card-api.gts`
- `packages/runtime-common/loader.ts`
- `packages/host/app/lib/realm-compartment-module-runtime.ts`
- `packages/host/app/lib/realm-sandbox-*.ts`
- `packages/host/app/services/realm-sandbox.ts`
- `packages/host/app/services/card-type-service.ts`
- `packages/host/app/services/loader-service.ts`
- `packages/host/app/services/store.ts`
- `packages/host/app/components/card-renderer.gts`
- `packages/host/app/components/realm-sandbox-*.gts`

### B. Code preview HMR and UX parity

Keep, but review as a distinct layer over the core boundary:

- volatile module generations;
- acknowledgement and last-known-good state;
- Monaco and AI patch publication;
- source-hash classification/transpilation caches;
- stable SES preview islands and persistent iframe sessions;
- immediate file-tree/editor navigation independent of preview loading;
- default Base template fast paths;
- new-file and broken-source recovery.

Primary locations:

- `packages/host/app/lib/code-preview-sandbox.ts`
- `packages/host/app/resources/interactive-code-preview.ts`
- `packages/host/app/services/code-source-cache.ts`
- `packages/host/app/services/file-tree-query-cache.ts`
- Code submode/editor/file resources and patch tools.

### C. Compatibility migrations

Keep only when the old spelling crosses the new opaque boundary:

- migrate official `instance.constructor.getComponent(instance)` calls to
  `getComponent(instance)`;
- tunnel card metadata such as theme and `prefersWideFormat` through the
  explicit card-type API;
- use the definition loader explicitly during deserialization;
- keep Base fallback templates in the trusted host path.

Each compatibility edit must have a focused regression test or an existing
test that demonstrably exercises the behavior.

### D. Tests and diligence documents

Keep:

- all pre-existing test files and assertions unless product behavior changed
  intentionally and the replacement assertion is stronger;
- the NAV/HMR/IFR/ERR/LDR/CACHE acceptance matrix;
- explicit boundary, invalidation, iframe protocol, style, and lifecycle tests;
- compatibility and architecture audit documents that describe remaining
  limitations without overstating security.

No `.only` or `.skip` markers may be introduced. Full host CI remains the
authoritative broad regression run because the repository explicitly forbids
running the complete host suite locally.

### E. Spike/demo work to remove from the production diff

Preserve on `codex/realm-isolation-ses-spike`, but remove from this branch's
final diff:

- `/_realm-isolation-spike` route and 3,000-line presentation template;
- editorial recipe/article/comment harness data and assets;
- spike-only security probe card/component;
- worker demonstrations not consumed by the production tier selector;
- spike-only tests and fixture constants after reusable fixtures are moved next
  to the focused runtime tests.

### F. Separate development-infrastructure change

Do not mix into the core sandbox review. Preserve as a separate commit or PR:

- staging-backed local host launcher;
- configurable host port;
- local certificate/iframe-origin development wiring;
- Vite config-meta refresh workaround;
- README instructions for the staging preview build.

These changes are useful for manual testing but are not part of the runtime
security boundary.

### G. Generated and local artifacts

Remove from the branch:

- `.pnpm-store/`;
- transient logs, screenshots, test output, and locally generated caches;
- staging realm data or copied card fixtures that are not repository tests.

## Structural consolidation

`RealmSandboxService` currently owns policy selection, realm runtime lifetime,
opaque-card materialization, template capture, Code-preview HMR, iframe fetch
brokering, security-probe behavior, styling, metrics, and invalidation. The
service should remain the Ember-facing facade, but cohesive state machines
should live in small framework-independent collaborators:

1. **Realm runtime registry** — principal-keyed SES runtimes, retention, idle
   eviction, and exact module invalidation.
2. **Preview generation coordinator** — volatile generations,
   acknowledgement, last-known-good state, analysis cache, and source
   publication.
3. **Template registry** — per-template revisions, stable render envelopes,
   stylesheet identities, and bounded caches.
4. **Iframe broker** — target-origin policy, typed messages, fetch capability,
   size limits, height updates, and lifecycle metrics.

Extraction must preserve existing public call sites and focused tests. Avoid a
large naming/refactoring pass while behavior is still being stabilized.

## Diligence gates

Before asking for merge:

1. `git diff --check` is clean and there are no focused/skipped tests.
2. Modified packages pass lint except for explicitly documented pre-existing
   failures.
3. Focused unit/integration/acceptance suites covering every acceptance-matrix
   row pass against a freshly rebuilt host bundle.
4. Existing tests changed by the branch are audited for removed assertions,
   longer waits that conceal regressions, and trusted-loader shims that bypass
   the real boundary.
5. Manual staging-backed checks cover representative existing cards, rapid
   file navigation, format switching, Monaco edits, AI/out-of-band patches,
   invalid source recovery, iframe height, and explicit Reload Card.
6. A long cross-realm navigation run checks runtime/cache eviction and browser
   memory growth.
7. Hosted iframe, CSS network, and server execution limitations remain called
   out as follow-up security work rather than being described as solved.

## Diligence log

### Existing-test preservation audit

- Compared every statically named host test on local `main` with the current
  tree, normalizing the new NAV/HMR/IFR tags.
- `main` has 3,385 statically named host tests; the current tree has 3,471.
- No pre-existing named test disappeared. The sole unmatched name,
  `automatic Accept All spinner appears in Act mode for multiple patches`, was
  deliberately replaced by `Act auto-applies multiple patches without
requiring Accept` when Act-mode product behavior changed from approval to
  immediate application.
- No test file was deleted for the production behavior retained on this
  branch. The deleted `realm-isolation-spike-test.ts` covered the removed
  demonstration harness, which remains on `codex/realm-isolation-ses-spike`.
- No `.only` or `.skip` marker was introduced.
- The only removed assertion in a retained test changed from one save after
  one block to exactly two saves after two streamed blocks. The replacement is
  stronger and matches the deliberate per-completed-block patch contract.
- Added waits were inspected. They wait on newly asynchronous source,
  sandbox, iframe, and index state; no large timeout was added to hide a known
  performance failure.

### Production-scope reduction

- Removed the spike route, 3,000-line template, harness data, fixture image,
  security-probe component, spike worker runtime, and spike-only test from the
  production branch.
- Removed the unused Worker-based card-template renderer. The product tier
  selector has only `compartment` and `iframe`; the Worker implementation was
  unreachable and is not the future command-worker design.
- Replaced the production editorial fixture imported by the SES runtime test
  with a small test-local GTS source that preserves the exact scoped-template
  assertion.
- Removed the untracked local `.pnpm-store/` cache.

### Structural extraction

- `RealmSandboxRuntimeRegistry` now owns canonical per-principal SES runtime
  sharing, consumer retention, idle eviction, and destruction. The Ember
  service retains policy and cache cleanup through a single eviction callback.
- `CodePreviewAnalysisCache` now owns the bounded source-hash LRU and shares
  classification/transpilation promises. The Ember service only records cache
  metrics and consumes its results.
- `assertURLWithinRealm` now lives in a small production URL-policy module with
  direct same-origin and realm-path tests. Production fetch validation no
  longer depends on the deleted spike harness.
- `RealmSandboxService` was reduced from 3,563 to 3,254 lines in
  this pass. It still needs a later iframe-broker/template-registry extraction,
  but those should not be mixed with behavior changes before CI is green.

### Focused verification completed

- A fresh host development build completed successfully after the structural
  extraction and again after the URL-policy move.
- Host JavaScript and template lint pass. Host type checking reaches only ten
  pre-existing failures outside this consolidation: seven `Array.at` target-lib
  failures and three AI-message call-signature failures.
- `runtime-common` JavaScript/type lint and `realm-server` JavaScript/type lint
  pass.
- Boxel UI addon and test-app JavaScript/template/type lint pass, and the test
  app production build succeeds. The focused `safe-modifier` browser test is
  not claimed as passing locally: its separate Testem launcher failed to
  connect Chrome within its configured 120-second window. Host browser tests
  launch normally in the same environment, so this remains a runner-specific
  verification gap for CI.
- Focused host tests pass for:
  - principal-keyed runtime registry (3 tests);
  - compartment module runtime (15 tests);
  - Code-preview sandbox generations and analysis cache (12 tests);
  - production realm URL policy (1 test);
  - runtime eviction and source-hash reuse (2 tests);
  - trusted-loader targeted invalidation (1 test);
  - iframe protocol validation and size limits (2 tests);
  - ref-counted sandbox styles (1 test);
  - code-source cache identity and bounds (2 tests);
  - filtered file-tree query cache (1 test);
  - incremental file-tree invalidation (4 tests); and
  - import-resource error preservation (1 test).
- The six-test `sandbox live reload` group now passes together. The original
  Reload Card failure was a real acknowledgement-test gap: the preceding
  broken-source recovery proved an optimistic local render but ended before
  the repair had autosaved, indexed, and been acknowledged. That could leave
  the cached test realm serving the deliberately broken generation. Recovery
  now waits through persistence before teardown; no test was reordered and no
  timeout was lengthened.
- The passing acceptance log still includes mock-Matrix teardown retries and
  negative Store reference-count diagnostics. These no longer obscure the HMR
  result, but should be triaged separately instead of being normalized as clean
  test output.
- Acceptance testing found a real extraction regression: a destroyed SES
  template still closed over the removed service-local runtime variable. The
  template now captures its canonical runtime, and the ordinary SES HMR,
  iframe HMR, warm-format, and compile/runtime recovery paths pass.
- `git diff --check` passes and the retained-test audit found no focused or
  skipped tests.

### Proposed review and commit sequence

Do not preserve the current three historical research commits as the final
review shape. Rebuild the branch as the following dependency-ordered commits
or stacked PRs, keeping each commit buildable and its focused tests adjacent:

1. **Explicit sandbox boundary and trusted loader immunity**
   - Base/runtime-common boundary symbols, materialization purpose, loader
     evaluator/invalidation APIs, source/import/URL policies, opaque records,
     and direct unit tests.
   - No Code-mode UI, staging launcher, or iframe presentation changes.
2. **SES runtime and stable render slots**
   - compartment runtime, principal runtime registry, delegated rendering,
     template/style registries, card renderer integration, and lifecycle/style
     tests.
   - Include only official-card compatibility migrations required for the new
     explicit boundary.
3. **Iframe renderer for eligible DOM-heavy formats**
   - typed protocol, isolated frame route/template, parent renderer, fetch and
     height capabilities, persistent presentation updates, and protocol/HMR
     tests.
   - Keep iframe policy reviewable independently from SES.
4. **Code-preview volatility and HMR**
   - generation/acknowledgement/last-known-good coordinator, analysis/source
     caches, Monaco and out-of-band publication, stable preview islands, format
     LRU, and Reload Card.
5. **Navigation and authoring UX parity**
   - immediate file/recent-file navigation, file-tree query cache, new-file and
     broken-source recovery, Base fallback fast paths, and AI patch flow.
6. **Compatibility migrations and acceptance matrix**
   - remaining official Base/workspace `getComponent` migrations and focused
     compatibility tests. Keep audit documents with the behavior they explain.
7. **Staging-backed local preview infrastructure (separate PR)**
   - README, host staging environment/configuration, Vite launcher changes,
     certificate/origin instructions, and `scripts/start-host.sh`.

`docs/realm-program-tool-spec.md` is unrelated local work and must not enter
any sandbox commit. `docs/realm-isolation-ses-spike.md` should either remain on
the spike branch or be explicitly marked archival after its durable lessons
are distilled; it currently names files removed from this production branch.

### Remaining merge gates

1. Run the focused Boxel UI safe-modifier test in CI or a working test-app
   browser runner.
2. Run CI Host using the unchanged broad suite and triage with
   `pnpm ci:failures`; do not alter old assertions merely to make the branch
   green.
3. Triage the background mock-Matrix retry and negative Store-reference logs
   visible between otherwise passing acceptance rows.
4. Complete a staging-backed manual matrix: existing official card, user SES
   card, iframe-required card, all formats, rapid navigation, Monaco edit,
   out-of-band patch, invalid-source recovery, height, and Reload Card.
5. Complete a long cross-realm navigation/memory run. Unit tests prove idle
   eviction semantics, but they do not prove app-lifetime heap stability.
6. Split/rebuild the history according to the sequence above before requesting
   human review. The current 141-file aggregate is still too broad even though
   the code and test surface is substantially cleaner.
