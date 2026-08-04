# PR #5663 compatibility audit

This is the durable working log for reviewing
[`cardstack/boxel#5663`](https://github.com/cardstack/boxel/pull/5663) against the
behavior and tests on `main`. It is intentionally kept in the repository so the
investigation can resume without relying on chat history or a live network
connection.

## Compared revisions

- `main`: `0cd1d7a237bee57a2f18d0e94cd8f44e37a7b458`
- PR CI head: `5b09fa4e1aa78d891e2101026f0773bf98b46103`
- current local branch: `codex/code-preview-instant-reload`
- current local head at audit start: `a6c4e14729844e7a453122101e9e620223eeb60b`

The local branch is ahead of the PR CI head. Results must say which revision
they apply to; a green local check does not retroactively make the recorded PR
run green.

## Decision rubric

Every compatibility gap belongs in one of these buckets:

1. **Explicit boundary API** — behavior is still required, but previously
   crossed a JavaScript object/loader/DOM boundary implicitly. Add the smallest
   typed, capability-scoped API and test native, SES, and iframe consumers where
   applicable. Low-risk fixes may be implemented directly.
2. **Drop the implicit feature** — behavior is not worth exposing across the
   boundary. Record the user-visible and card-authoring implications before
   removal.
3. **Architecture decision** — preserving the behavior needs a broader security
   or runtime design. Write a proposal, alternatives, and migration impact and
   get product/maintainer feedback before implementation.

## CI baseline

The PR's recorded CI run has widespread failures: 19 of 20 host shards, all 6
realm-server shards, all 3 Matrix shards, CLI tests, two Software Factory
shards, performance, and memory. Lint, previews, Boxel UI tests, and several
other checks pass.

The failures are not presently independent. Dominant early failures are:

```text
ancestor_level 0 does not exist
bug: could not identify card: OpaqueRealmCard
```

The realm performance benchmark and card endpoints name `OpaqueRealmCard`
directly. That indexing/materialization failure causes cards not to enter the
index and then fans out into empty searches, missing embedded cards, 500
responses, missing operator-mode cards, relationship failures, incomplete CLI
ingest graphs, Matrix timeouts, and timeout/memory noise. Those downstream
symptoms should not be classified separately until the root indexing failure is
fixed and the suites are rerun.

## Regression ledger

| Cluster                                                                                                              | Evidence                                                                                                                                                                                                                                                                     | Classification                              | Current decision/status                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Realm indexing and prerender materialization receives an opaque host facade instead of an executable card definition | PR CI repeatedly reports `ancestor_level 0 does not exist` and `could not identify card: OpaqueRealmCard`; downstream searches return zero cards and card endpoints return 500.                                                                                              | 1 — explicit boundary API                   | Fixed locally with an explicit `CardMaterializationPurpose`: ordinary host stores use `host-record`; `RenderStoreService` opts into `realm-execution`. Existing store search/index tests pass 10/10 with 2 instances and 5 files indexed per fixture.                                                                                                                                                                                                    |
| Host UI consumes user-realm instances without evaluating their constructors                                          | Security requirement of the branch; covered by opaque-card boundary unit tests.                                                                                                                                                                                              | 1 — explicit boundary API                   | Keep. Data, identity, persistence, and rendering must cross explicit boundary services rather than constructor introspection.                                                                                                                                                                                                                                                                                                                            |
| Command/tool validation needs real `Field.validate()` behavior                                                       | Software Factory CI reports that a non-array `containsMany` value unexpectedly passes. The instantiate-card tool used `__dangerousCreateFromSerialized`, but ordinary Store deserialization substituted an opaque facade before validation.                                  | 1 — explicit boundary API                   | Fixed locally: `__dangerousCreateFromSerialized` explicitly requests `realm-execution`. Existing `Integration                                                                                                                                                                                                                                                                                                                                            | tools | instantiate-card` test went from 2/3 to 3/3. This restores compatibility, but executing user definitions for validation should eventually move behind the command-worker boundary rather than expanding ambient host authority. |
| Rich Markdown embedded-card rendering and canonical references                                                       | After indexing was fixed, existing `RichMarkdownField` tests passed only 15/28. `MarkdownTemplate` calls Base `getComponent(instance)` for linked cards, but user-realm query results are intentionally opaque.                                                              | 1 — explicit boundary API                   | Fixed locally without a paired Base deployment. The Host-created opaque type exposes `RealmSandboxDelegatedRender` through the ordinary authored static format slot (`isolated`, `embedded`, and so on) that existing Base `getComponent()` already reads. No symbol, sandbox service, or executable realm constructor crosses into Base or card code. Full existing module now passes 28/28.                                                            |
| Trusted Base/workspace code calls `instance.constructor.getComponent(instance)`                                      | This bypasses the boundary-aware exported `getComponent(instance)` API and fails when a search or relationship returns an opaque user-realm record. The pattern existed in Base Workspace, CardsGrid, command result UI, experiments, host CardRenderer, and fitted preview. | 1 — explicit boundary API                   | Migrated Base and experiment call sites to imported `getComponent`. Interactive host consumers now use `RealmSandboxService.componentFor()`, which delegates opaque records and preserves ordinary trusted-card rendering. Server prerender's `render/html` route remains a deliberate realm-execution-only constructor call because it selects an ancestor `componentCodeRef` from a real executable instance.                                          |
| Existing integration fixtures install realm modules as live `Loader.shimModule()` class objects                      | SES needs source text, so the compartment reported `Compartment did not capture the isolated template for ArticleCard`; these fixtures predate source-based sandbox execution and test unrelated features.                                                                   | Test-harness compatibility, not product API | Fixed locally. `Loader.isModuleShimmed()` now preserves provenance for both locally registered and fetch-adapter-provided shims. Under `isTesting()` only, the compartment may render that already-loaded live fixture component. Network source still requires normal SES template capture.                                                                                                                                                             |
| Authored plain `<style>` elements in SES templates                                                                   | `glimmer-scoped-css` rewrites `<style scoped>` selectors and extracts the CSS dependency, but a plain `<style>` remains a literal Glimmer element. Reconstructing that template in the shared host document applies its selectors globally.                                  | 1 — explicit renderer boundary              | Fixed locally. Source classification selects iframe for an unscoped template style where the requested format permits iframe rendering. Independently, SES template capture rejects every surviving literal `<style>` before reconstruction, so fitted/atom/head/markdown and incomplete classification fail closed. Authors can migrate to `<style scoped>`. Global-name at-rules and CSS network-bearing values remain separate open CSS-policy risks. |
| AI/tool card lookup and mutation                                                                                     | Several PR host failures return missing cards or 500s after failed indexing.                                                                                                                                                                                                 | Unclassified                                | Rerun after the indexing fix. Existing explicit tool boundaries should remain the preferred design.                                                                                                                                                                                                                                                                                                                                                      |
| Performance and memory checks                                                                                        | Failed in the same run as widespread indexing errors and retries.                                                                                                                                                                                                            | Unclassified                                | Do not infer sandbox overhead yet. Re-measure after functional failures collapse, separating cold loader startup from steady-state rendering.                                                                                                                                                                                                                                                                                                            |
| Code-mode template replacement remounts authored DOM                                                                 | The earlier test only asserted identity of `.realm-sandbox-render`, while every SES revision created a new generated Glimmer component class.                                                                                                                                | 1 — explicit renderer boundary              | Fixed locally with a shared serialized `CardIsland` primitive. Compatible replacement programs adopt marker-bearing DOM; incompatible programs replace the stable island contents. The acceptance test now asserts exact authored-node identity and adoption status after a Monaco keystroke.                                                                                                                                                            |
| Host Mode discards prerendered isolated HTML during boot                                                             | Server HTML and live `CardRenderer` previously had no explicit shared program boundary, so Host Mode could only tear down prerender output and mount again.                                                                                                                  | 1 — explicit renderer boundary              | Fixed locally. Server render and Host Mode share a versioned `CardIsland` contract with card URL, format, and Glimmer markers. Compatible islands rehydrate; missing/mismatched contracts safely replace contents and report a reason.                                                                                                                                                                                                                   |

## Boundary rule established by the first cluster

There are two different consumers currently represented by one deserialization
method:

- **Realm indexing/prerender execution** needs the real card class, inheritance
  chain, fields, and templates. It runs with the render store and the explicitly
  selected definition loader.
- **Interactive host UI state** must not receive an executable constructor for
  user-realm code. It receives an opaque card record and delegates rendering,
  mutation, and introspection through sandbox services.

Using the same object shape for both consumers is the implicit API that caused
the first regression. The local fix now names the purpose explicitly as
`'realm-execution' | 'host-record'`; callers no longer infer security semantics
from the `RenderStoreService` subclass name. `RenderStoreService` selects
`realm-execution` once, while the narrowly named dangerous validation method
opts in for its single call. The ordinary Store default remains `host-record`.

## Verification log

- 2026-07-31: keep the documented staging-backed host at
  `https://localhost:4200` (iframe origin `https://127.0.0.1:4200`). A failed
  two-port experiment proved two Vite hosts from one worktree share generated
  config/cache state: the staging page began requesting local icons and local
  Matrix. Concurrent staging/local hosts therefore require separate Git
  worktrees, not only distinct ports. `scripts/start-host.sh staging` now
  delegates to the staging-safe launcher.

Add every command with its revision and outcome here. Host tests must remain
focused and their complete output must be captured under `/tmp` as required by
the repository instructions.

- PR CI inspection: run `30639676805` (`CI Host`) shows the dominant
  `ancestor_level 0 does not exist` fan-out described above.
- PR CI inspection: run `30639677731` (`CI`) shows realm performance and
  endpoint failures explicitly naming `OpaqueRealmCard`. Realm indexing then
  returns zero instances; CLI ingest omits instance files; Matrix cannot find
  cards and times out. Raw summarized output is saved locally at
  `/tmp/pr-5663-ci-core.log`.
- Local `a6c4e14729`: existing host module
  `Integration | store search public API` passes 10/10. Each fixture indexes 2
  card instances and 5 files with zero errors. Full output:
  `/tmp/pr-5663-host-store-search.log`.
- Local `a6c4e14729`: the first realm-server `card-endpoints-test` attempt is
  **invalid as a compatibility result**. The pre-existing shared Synapse rejects
  `node-test_realm-server` with HTTP 403 during every test setup, before a card
  request runs. It reports 0/61, all from the same stale local Matrix credential
  problem. Full output: `/tmp/pr-5663-realm-card-endpoints.log`. Rerun in an
  isolated Boxel environment rather than deleting the user's shared Matrix
  state.
- Local `a6c4e14729`: an isolated `BOXEL_ENVIRONMENT=pr5663-audit` stack was
  brought to healthy readiness, but running the suite in environment mode is
  also invalid as a product signal. The test bootstrap deliberately deletes
  `REALM_SERVER_TLS_CERT_FILE` and `REALM_SERVER_TLS_KEY_FILE` for its in-process
  HTTP/1 fixture servers, while `RealmServer.createListener` requires TLS/HTTP2
  whenever `BOXEL_ENVIRONMENT` is set. All 61 tests therefore fail before card
  execution with `HTTP/2 requires a TLS cert/key`. This is a pre-existing local
  harness incompatibility, not a #5663 regression. Full output:
  `/tmp/pr-5663-realm-card-endpoints-isolated.log`.
- Local working tree after the explicit materialization-purpose patch: existing
  host module `Integration | tools | instantiate-card` passes 3/3, including
  rejection of a non-array value for a `containsMany` field. Before the patch,
  the same module passed 2/3 and reproduced the Software Factory CI failure.
  Full outputs: `/tmp/pr-5663-host-instantiate-before.log` and
  `/tmp/pr-5663-host-instantiate-after.log`.
- Local working tree after the explicit materialization-purpose patch: existing
  host module `Integration | store search public API` passes 10/10. Every
  fixture indexes 2 instances and 5 files with zero indexing errors. Full
  output: `/tmp/pr-5663-host-store-search-after.log`.
- Local working tree before delegated rendering/test-shim compatibility:
  existing host module `Integration | RichMarkdownField` passes 15/28. The 13
  failures cover relative reference identity, linked-card atom/embedded/fitted/
  isolated rendering, loading placeholders, and one edit-path component error.
  Full output: `/tmp/pr-5663-host-rich-markdown.log`.
- Local working tree after the explicit delegated render component and the
  `isTesting()`-only live-shim rule: existing host module
  `Integration | RichMarkdownField` passes 28/28. Full output:
  `/tmp/pr-5663-host-rich-markdown-after.log`.
- Local working tree after the materialization-purpose fix: existing host
  module `Integration | linksTo sentinel serialization round-trip` passes 6/6.
  Full output: `/tmp/pr-5663-host-linksto-sentinel.log`.
- Local working tree after the materialization-purpose fix: existing host
  module `Integration | tools | apply-markdown-edit` passes 6/6. This invalidates
  the matching PR-CI failure as indexing fallout rather than a missing field
  mutation boundary. Full output:
  `/tmp/pr-5663-host-apply-markdown-edit.log`.
- Local working tree after opaque metadata and explicit host-mode introspection:
  the existing default-width host-mode acceptance test passes 1/1, including
  workspace background, card rendering, and width selection. The fetched-shim
  provenance tests pass 2/2. Full outputs:
  `/tmp/pr-5663-host-mode-default-width-final-review.log` and
  `/tmp/pr-5663-host-loader-shim-tests-final.log`.
- The full `Acceptance | host mode tests` module was attempted twice. Both
  attempts passed the first six tests and then stopped producing progress in
  the local Testem harness; the process was interrupted rather than reported
  green. Full output from the final attempt:
  `/tmp/pr-5663-host-mode-module-final.log`.
- The code-mode live draft acceptance test now reflects the SES-first product
  policy: ordinary source keeps the same SES renderer boundary and atomically
  shows the newest valid draft; DOM-heavy isolated source keeps its dedicated
  iframe boundary and receives revisions over MessageChannel. Its first post-policy run
  passed the iframe case but exposed that `.gts` Monaco URLs did not match the
  loader's extensionless module identity, making SES appear one revision
  behind. That comparison is fixed and covered by the 4/4 CodePreviewSandbox
  unit module. A subsequent full acceptance rerun connected Chrome but stalled
  in the local Testem settling path before emitting either assertion, so this
  document did not report the rewritten acceptance module green at that point.
  The subsequent shared-island implementation now passes the focused ordinary
  case both in Testem and interactively in the in-app browser. The test types a
  Monaco keystroke, observes the new text, asserts exact authored-node identity,
  and requires `data-realm-sandbox-island-update="adopted"` (5/5 assertions).
  Logs: `/tmp/pr-5663-host-ses-first-live-reload.log`,
  `/tmp/pr-5663-testem-debug.log`, and `/tmp/host-test-sandbox-hmr.log`.
- The shared isolated-render replacement-program unit test passes 1/1 and
  proves that the exact button node survives while its text and click behavior
  move to the new Glimmer program. A server-produced CardIsland-to-Host-Mode
  acceptance test also passes 1/1 and asserts exact authored-node identity on
  the successful `rehydrated` path. The Host Mode incompatible-island fallback,
  isolated prerender protocol metadata, and indexed-island marker tests each
  pass 1/1. Logs: `/tmp/host-test-rehydration-hmr.log`,
  `/tmp/host-test-host-mode-compatible-rehydration.log`,
  `/tmp/host-test-host-mode-rehydration.log`,
  `/tmp/host-test-prerender-island.log`, and
  `/tmp/host-test-index-card-island.log`.
- Host Mode now preserves a prerendered island only when its normalized card URL
  matches the current primary card. The stale-route regression test passes 1/1
  and proves a mismatched island is removed before the requested card renders.
  Full output: `/tmp/host-test-host-mode-stale-island.log`.
- The final iframe revision-boundary acceptance case passes 1/1. The final Host
  development build, JavaScript lint, and template lint pass; Realm Server lint
  and type-check pass. Host type-check reports only the same ten documented
  baseline errors and no island/sandbox errors. Logs:
  `/tmp/host-test-iframe-hmr.log`, `/tmp/host-build-rehydration-final.log`,
  `/tmp/host-lint-js-rehydration-final.log`,
  `/tmp/host-lint-hbs-rehydration-final.log`,
  `/tmp/host-lint-types-rehydration-final.log`, and
  `/tmp/realm-server-lint-card-island.log`.
- The strict iframe protocol guard tests pass 2/2. Full output:
  `/tmp/pr-5663-host-iframe-protocol.log`.
- The rebuilt source-policy tests pass 8/8, including the format boundary and
  unscoped-style routing: both raw GTS and the realm server's compiled wire
  form request iframe isolation for a plain template `<style>`, while
  `<style scoped>` remains in SES. The SES compartment runtime tests pass 15/15,
  including a compiled-GTS regression proving that a surviving literal
  `<style>` is rejected before the host reconstructs the template. Full
  outputs: `/tmp/host-test-source-policy-style-boundary.log` and
  `/tmp/host-test-compartment-style-boundary.log`.
- The source-policy format boundary remains unchanged:
  iframe is available only to isolated, embedded, and edit; fitted, atom, head,
  and markdown remain SES and fail closed if the template requires an unscoped
  style.
- The host development build after the CSS boundary change passes, and Host
  JavaScript and template lint pass. Full host type lint continues to report
  only the ten recorded baseline errors (seven `Array.prototype.at` target-lib
  errors and three AI-message argument errors), with no sandbox-boundary type
  errors. Full outputs:
  `/tmp/host-build-ses-style-boundary.log` and
  `/tmp/host-lint-js-ses-style-boundary.log` and
  `/tmp/host-lint-after-style-boundary.log`.
- Final host development build passes. Base lint and Runtime Common lint/type
  checks pass. Host JavaScript and template lint pass. Full host type checking
  remains red only on ten baseline errors outside the sandbox diff: seven
  `Array.prototype.at` target-library errors and three existing AI-message
  component-argument errors. The sandbox-related Glint failures in
  `CardRenderer` and `FittedFormatGallery` were fixed. Logs:
  `/tmp/pr-5663-host-build-final-review.log`,
  `/tmp/pr-5663-base-lint.log`,
  `/tmp/pr-5663-runtime-common-lint.log`,
  `/tmp/pr-5663-host-lint-js-final.log`,
  `/tmp/pr-5663-host-lint-hbs-final.log`, and
  `/tmp/pr-5663-host-lint-after.log`.

## `getComponent(instance)` compatibility inventory

There are two similar-looking APIs with materially different boundary
semantics:

- `getComponent(instance)` imported from Base card-api is the supported,
  boundary-aware operation. For an ordinary trusted instance it uses the card
  class and cached Box component. For an opaque instance it consumes the
  trusted host's non-enumerable delegated-render component.
- `instance.constructor.getComponent(instance)` assumes the constructor is the
  executable authored card class. That is no longer valid in interactive host
  state, where an opaque record deliberately has no authored constructor.

The source audit found and migrated the latter pattern in Base Workspace,
CardsGrid, search-card command results, the experiments realm, CardRenderer,
and fitted-format preview. Copies exported under `boxel-workspaces/exports/`
still contain the old spelling; those generated/exported artifacts were noted
but not edited as source. The one remaining official direct call is
`host/app/routes/render/html.ts`: it belongs to the trusted realm-execution
prerender path and intentionally requests an ancestor template by
`componentCodeRef`.

The current delegated component is enough for callers that choose the render
format when invoking the returned component, including Markdown's atom,
embedded, fitted, and isolated modes. A future API is required if a trusted
caller needs to select an authored field component or ancestor
`componentCodeRef` for an opaque record. That API should pass a typed render
request to `RealmSandboxService` and return a component capability; it must not
expose the opaque record's constructor, field objects, loader, or sandbox
service. This is Category 1 if the request is only `{ format, fieldName,
componentCodeRef }`. Arbitrary callbacks or authored object access would be
Category 3 and needs a separate design review.

## Open architecture questions (feedback required before broad changes)

1. Should the render/index store remain a trusted in-process consumer of user
   card definitions, or should indexing eventually execute behind its own
   compartment protocol? The current narrow fix preserves existing indexing
   semantics; moving the indexer is a separate security architecture project.
2. Which static card-definition metadata must be transported as data for code
   mode and host chrome? The current explicit introspection API is the seed, but
   remaining main-test regressions will determine the complete compatibility
   surface.
3. Which DOM-dependent behaviors require the renderer iframe tier versus an SES
   compartment? Do not silently emulate arbitrary DOM access through powerful
   host callbacks; each callback must be an auditable capability.
4. Which CSS at-rules are valid at the shared-document boundary? Scoped
   selectors and keyframes receive generated names, but browser-global
   registrations such as `@font-face` and `@property` still need an explicit
   allow/rename/reject policy independent of ordinary selector scoping.
