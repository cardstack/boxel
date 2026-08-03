# Realm Sandbox WIP Review Handoff

## Post-review implementation status (2026-08-02)

The final pre-CI diligence pass was run from a fresh Host build. The existing
single-realm Code-submode regression group passes 42 tests with its one
pre-existing skip; the sandbox data-update acceptance row, the seven
isolated-render rows, two opaque-method serialization rows, and six existing
RichMarkdown rows all pass. The data-update coverage now proves both that a
trusted Base field portal receives the new Store snapshot and that its authored
DOM node retains identity across the update. Host JavaScript/template lint,
Base lint, runtime-common lint/typecheck, and `git diff --check` pass. The full
Host lint reaches only the seven already-documented local `Array.at`
target-library diagnostics and no changed source line.

The lifetime and hostile-style checks were also repeated against this source:
128 real route navigations alternating SES and iframe cards ended with zero
active compartments and iframe connections and no measured forced-GC heap
growth; the 4,096-principal service lifecycle soak ended with zero active
runtimes, loads, templates, and styles; and all six hostile-CSS rows pass,
including scoped selectors, network-bearing values, global registrations, and
compiler-namespaced keyframes. These are strong bounded-lifecycle regression
checks, but they do not replace the still-open long CDP retainer inspection or
the full GitHub Host CI run.

The independent review in
[`realm-sandbox-wip-review-findings.md`](realm-sandbox-wip-review-findings.md)
has now been applied to the working tree. F-1 through F-20 have concrete fixes
and focused regression coverage. F-17's bounds and eviction are exercised by a
4,096-principal Chrome lifecycle soak: forced-GC heap growth after warm-up is
0.00 MiB and the run ends with zero runtimes, loads, templates, or stylesheets.
F-21 and F-24 remain explicit follow-ups. F-23 is clarified in the findings:
the mounted file-tree resource, rather than the session cache, owns filtered
Realm-index subscriptions. Hosted iframe deployment, visual hostile-CSS paint
containment, and server-side availability isolation remain production gates
and must not be represented as complete. The shared-document selector,
network, and global-rule CSS boundary is now structurally enforced.

The latest compatibility pass also closes an implicit component-API gap found
by the existing Host Mode suite. SES receives a write-only `viewCard` effect
recorder, never the host callback; the host accepts URL/string/card-like
targets only after same-realm validation. Component actions update the existing
serialized Glimmer island in its renderer transaction, retaining authored DOM,
hot-replacement markers, and component state across stack operations. The
host-owned rerender capability is deliberately omitted from compartment args.
URL and URLSearchParams values use safe prototypes so native instance
constructor chains cannot recover host Blob-URL statics. Overlapping async
component actions are serialized per instance so their effect records cannot
be mixed; ordinary synchronous actions keep synchronous return behavior.

Current local verification: the Host build passes in both development mode and
the exact `BOXEL_ENVIRONMENT=ci SKIP_CATALOG=true` CI configuration;
runtime-common, realm-server, Host JavaScript/template, Base,
experiments-realm, and Boxel UI lint
pass. The complete Boxel UI browser suite passes 408/408, including the safe
modifier coverage. The seven-row `sandbox live reload` acceptance group and
the focused loader, acknowledgement, SES, iframe, preview, patch-code, and
invalidation suites pass. The latest compatibility groups pass 19/19 Host Mode,
26/26 prerender HTML, 17/17 compartment protocol, 7/7 sandbox live reload,
6/6 serialized-island behavior, and the cross-realm navigation rejection row.
Host typecheck passes in an isolated detached checkout after the same Boxel
Icons type-build prerequisite used by CI. The primary checkout reaches only
seven `Array.at` target-library errors because TypeScript also discovers a
parent `/Users/chris/Projects/node_modules/@types/node`; it reports no other
diagnostics. Software Factory
Node tests pass 591/592 locally; the sole failure is an unchanged IPv4/dual-
stack port-allocation assertion whose behavior differs on macOS from the Linux
CI runner. A separate new-card-definition acceptance row remains unverified
because the local Base prerender manager timed out before the test reached a
product assertion; an exact CI-mode stack retry was then blocked by local
service bootstrap conflicts on worker/prerender ports 4210, 4211, and 4222.
Neither result is counted as a product pass.
The branch-specific AMD gate, AMD trip test, and realm performance gate pass.
The latest successful `main` CI Lint run also confirms that Host typechecking
runs and passes in GitHub with Node 24.17.0, pnpm 11.0.9, and TypeScript 5.9.3;
that is the same pinned toolchain used here. The detached branch reproduction
passes too, so the seven primary-checkout diagnostics are retained as a local
module-resolution discrepancy instead of being silenced with unrelated source
changes. The latest service-backed aggregate realm-sandbox run passes 29/29.
A prior CI-namespace retry reported a global setup failure because its Base
realm was unavailable; it did not reach a product assertion and is not counted
as a test failure. The narrower runtime suite covering the final URL and
action-isolation changes passes 17/17.

## Assignment

Review commit `6cbbf8174d` on branch
`codex/code-preview-instant-reload` and provide concrete recommendations for
turning the checkpoint into a focused, reviewable pull request.

This is intentionally a WIP checkpoint. Do not judge its commit shape as the
proposed final history. The review should determine whether the implementation
is directionally sound, identify correctness or compatibility risks, and
recommend the smallest safe path from this checkpoint to a mergeable series.

The product goal is to run user-authored cards inside an explicit security
boundary without requiring changes to existing card source. Trusted Base code
may run through a shared trusted loader. Ordinary user code runs in an SES
realm compartment. DOM-heavy code that cannot function under SES may use an
iframe sandbox for eligible formats. Card data remains canonical in the host
Store; the sandbox controls which module implementation and capabilities can
operate on that data.

The implementation must retain the responsiveness and compatibility of the
existing Host UI, particularly:

- opening cards from a workspace;
- switching between card formats;
- navigating the file tree and recent files;
- opening Monaco before the card preview has finished loading;
- editing GTS source with stable, low-flash live preview updates;
- receiving out-of-band source changes without invalidating unrelated loaders;
- rendering default Base templates without unnecessary sandbox startup;
- preserving card identity and last-known-good output across invalid drafts;
- delegated rendering of fields and nested cards;
- iframe intrinsic-height updates for isolated, embedded, and edit formats.

## Start Here

Read these documents in order:

1. `docs/realm-sandbox-reviewer-guide.md` — the integrated conceptual and code
   walkthrough.
2. `docs/interact-code-navigation-loader-comparison.md` — comparison with the
   behavior on `main`.
3. `docs/pr-5663-compatibility-audit.md` — compatibility and existing-test
   audit.
4. `docs/pr-5663-sandbox-architecture-review.md` — architecture risks and
   recommendations already identified.
5. `docs/sandbox-branch-consolidation-plan.md` — proposed reduction of blast
   radius and dependency-ordered commit series.
6. `docs/realm-sandbox-follow-up-plan.md` — known production and security
   follow-ups.

Then inspect the implementation in approximately this order:

1. `packages/host/app/lib/realm-sandbox-boundary.ts`
2. `packages/host/app/lib/realm-sandbox-source-policy.ts`
3. `packages/host/app/services/loader-service.ts`
4. `packages/host/app/services/realm-sandbox.ts`
5. `packages/host/app/components/card-renderer.gts`
6. `packages/host/app/components/realm-sandbox-render.gts`
7. `packages/host/app/components/realm-sandbox-iframe.gts`
8. `packages/host/app/components/card-island.gts`
9. `packages/host/app/lib/code-preview-sandbox.ts`
10. `packages/host/app/resources/interactive-code-preview.ts`
11. `packages/host/app/resources/file.ts`
12. `packages/host/app/tools/patch-code.ts`

The central question is whether the code establishes a coherent explicit
boundary, or merely recreates old implicit APIs through a larger collection of
special cases.

## Review Rubric

For every concern, classify the recommendation using this rubric:

1. **Fix now:** easy, low-risk, and appropriate for the core sandbox series.
2. **Change the supported behavior:** an implicit feature should be removed or
   narrowed; explain the user and card compatibility implications.
3. **Architecture proposal:** fixing it safely requires a new design. Describe
   the contract, migration path, and tradeoffs before proposing implementation.
4. **Follow-up:** valid work that should not enlarge the core PR. State the
   production gate or milestone that makes it necessary.

Please prioritize findings as P0 through P3 and cite exact files and lines.
Favor correctness, authority confinement, and compatibility over stylistic
preferences.

## Questions the Review Must Answer

### Boundary and authority

- Can a sandboxed card obtain ambient host authority through an endowed value,
  imported module, delegated renderer, modifier, component, Store object, or
  error path?
- Are trusted Base/catalog imports recognized by canonical module identity,
  rather than by a user-controlled URL resemblance?
- Does realm authorization constrain every fetch and write, including iframe
  broker requests and CSS asset loads?
- Are opaque card records and host capabilities passed across the boundary in
  a way that prevents child code from inspecting parent state?
- Is the URL query parameter fully removed as an authority for selecting a
  weaker sandbox?

### Loader lifecycle and invalidation

- Are trusted, realm, volatile-preview, and iframe loaders separated at the
  right granularity?
- Does changing one volatile module avoid invalidating stable workspace and
  card modules?
- Are template revisions targeted rather than global?
- Can app-lifetime runtime, classification, stylesheet, promise, or template
  caches grow without bound?
- Do module generations, server acknowledgements, and SSE/index echoes form a
  deterministic state machine, or can an old acknowledgement replace a newer
  local generation?

### Rendering and compatibility

- Does the explicit delegated-render API cover legitimate historical uses of
  `getComponent(instance)` without reopening ambient authority?
- Are `prefersWideFormat`, themes, CSS variables, default templates, icons,
  realm writability, format selection, and nested field rendering tunneled
  explicitly and consistently?
- Are render-slot, component, stylesheet, and DOM identities stable across
  compatible HMR generations and format switches?
- Does invalid source preserve the last-known-good preview and expose the
  normal error/Fix with AI UI?
- Can a newly created GTS file render its schema/default template before an
  instance exists, rather than producing a transient 404?
- Do iframe formats preserve height and overflow behavior without requiring
  the authored card or field to know about iframe messaging?

### Host UX and performance

- Is file-tree navigation independent of module analysis and sandbox startup?
- Can Monaco display as soon as source is available while schema and preview
  continue loading?
- Are recent-file and file-tree queries cached and invalidated narrowly?
- Is classification/transpilation performed once per source hash?
- Does a locally applied patch update the preview before linting, persistence,
  indexing, Matrix acknowledgement, and matching server echoes finish?
- Is there any reactive loop or identity churn that can make navigation hang,
  flash read-only state, or remount the preview unnecessarily?

### Server and iframe paths

- Is server prerender genuinely isolated enough for the authority it receives,
  including resource limits and network policy?
- Does the hosted iframe design require a dedicated, opaque origin per sandbox
  instance, strict CSP, origin validation, and a narrow MessageChannel broker?
- Does the current code accidentally imply hosted iframe security that is only
  implemented for localhost?
- Is CSS confined well enough that SES-authored styles cannot affect the Host
  document or other cards?

## Known State: Do Not Rediscover Without New Evidence

The checkpoint has already established the following:

- `git diff --check` passes.
- Runtime-common lint passes.
- Realm-server lint passes.
- Host JavaScript and template lint pass.
- Host typecheck passes in an isolated checkout that matches GitHub module
  resolution. The primary checkout reports seven `Array.at` target-library
  errors only because it sees parent-directory Node types outside this repo;
  the branch's changed files produce no additional diagnostics.
- The Base and experiments-realm parser errors reported by the earlier
  checkpoint were subsequently addressed. They are no longer part of the
  current lint/typecheck result, but package lint must still be rerun after any
  further edits.
- Focused unit tests for runtime registry, SES runtime, preview generation and
  caching, URL policy, lifecycle, loader invalidation, iframe protocol, styles,
  source cache, file-tree caching/invalidation, and import errors have passed.
- The seven-test `sandbox live reload` acceptance group has passed.
- The existing-test audit found no broad deletion or weakening of the old Host
  suite, apart from an intentional Act-mode behavior change documented in the
  audit.
- Full Host CI has not been run for this checkpoint.
- The exact AMD performance gate, its synthetic failure-mode trip test, and the
  realm performance gate pass locally.
- The complete Boxel UI browser suite passes 408/408 locally, including the
  safe-modifier row that was previously blocked by the browser runner.
- The deterministic 4,096-principal cross-realm runtime/style soak passes with
  0.00 MiB forced-GC heap growth after warm-up. A 32-navigation route-level
  soak also passes while checking real SES DOM, iframe browsing contexts,
  MessageChannel lifetimes, authored stylesheets, and runtime/template counts.
- Hosted iframe security is unfinished and must not be represented as
  production-complete. Shared-document CSS now fails closed on selector,
  network, document-global, view-transition, and declarative top-layer escape
  paths, and every SES format has a host-owned paint/layout boundary. This is
  confinement, not CPU or memory isolation.

If a known statement appears wrong, supply the contradicting command output or
code path rather than repeating it as an unverified concern.

## Scope Discipline

The checkpoint is large because it preserves the research state. The desired
review series should be reconstructed in this dependency order:

1. explicit boundary contracts and immunity for trusted loaders;
2. SES runtime and stable render slots;
3. iframe renderer for explicitly eligible DOM-heavy formats;
4. code-preview volatility, generation tracking, and HMR;
5. file navigation and authoring UX parity;
6. compatibility migrations and acceptance tests;
7. staging-backed local preview infrastructure in a separate change.

Do not recommend another broad refactor merely to make the checkpoint prettier.
Extraction is valuable only where it makes an authority boundary testable,
reduces invalidation coupling, or materially improves reviewability.

Keep these items outside the core implementation series unless they are needed
to make the tests run:

- `docs/realm-program-tool-spec.md` — unrelated local work and intentionally
  excluded from commit `6cbbf8174d`;
- staging-only ports, certificates, and launcher changes — separate supporting
  change;
- hosted iframe deployment and dedicated-origin provisioning — production
  security follow-up;
- arbitrary resource-bearing HTML and shared-main-thread resource exhaustion —
  separate security follow-ups; parser-grade CSS validation, top-layer denial,
  and visual paint/layout containment are implemented in the core boundary.

## Suggested Verification

Use the pinned `mise`/pnpm toolchain. Do not run the entire Host suite locally;
the repository guidance says it crashes. Capture all Host test output to files.

At minimum:

```sh
git diff main...6cbbf8174d --check

cd packages/runtime-common
pnpm lint

cd ../realm-server
pnpm lint

cd ../host
pnpm lint
pnpm exec ember test --path dist --filter "sandbox live reload" \
  2>&1 | tee /tmp/host-sandbox-live-reload-review.log
```

Inspect the eight Base/experiments parser errors directly. Determine whether
the delegated-render migration produced invalid class syntax, whether the
files require a different explicit API, or whether the content-tag parser has
hit one of its documented GTS lexer limitations.

For CI after a review branch is pushed:

```sh
pnpm ci:failures -- --branch <review-branch> --workflow "CI Host"
```

Manual validation should cover one trusted Base card, one ordinary SES card,
one iframe-required Three.js/3MF card, all preview formats, quick format
switching, file navigation, Monaco edits, out-of-band code writes, invalid
source recovery, create-file behavior, iframe intrinsic height, and explicit
Reload Card behavior.

## Requested Deliverable

Produce a review containing:

1. a one-paragraph verdict on whether the architecture is viable;
2. a prioritized findings list with file/line evidence;
3. a table classifying each finding as fix now, behavior change, architecture
   proposal, or follow-up;
4. a proposed minimal commit/PR series and any files that should be dropped;
5. compatibility implications for existing user-authored cards;
6. security claims the PR may safely make and claims it must avoid;
7. the three highest-value tests still missing;
8. a clear recommendation: proceed with consolidation, revise the boundary,
   or stop and redesign.

Be candid. This review is meant to prevent a large WIP from becoming a large
and opaque PR, while preserving the progress that justified the experiment.
