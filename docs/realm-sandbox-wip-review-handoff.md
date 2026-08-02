# Realm Sandbox WIP Review Handoff

## Post-review implementation status (2026-08-02)

The independent review in
[`realm-sandbox-wip-review-findings.md`](realm-sandbox-wip-review-findings.md)
has now been applied to the working tree. F-1 through F-16 and F-18 through
F-20 have concrete fixes and focused regression coverage. F-17 is reduced but
not closed: volatile sources and error metrics are bounded, while the complete
runtime/template/cache eviction policy still needs a long navigation soak.
F-21, F-23, and F-24 remain explicit follow-ups. Hosted iframe deployment,
hostile-CSS confinement, and server-side availability isolation remain
production gates and must not be represented as complete.

Current local verification: Host build passes; runtime-common, realm-server,
and Host JavaScript/template lint pass. The seven-row `sandbox live reload`
acceptance group and the focused loader, acknowledgement, SES, iframe,
preview, patch-code, and invalidation suites pass. Host typecheck reaches only
seven `Array.at` target-library errors that are also present on `origin/main`.
A separate new-card-definition acceptance row remains unverified because the
local Base prerender manager timed out before the test reached a product
assertion; that result is recorded as an environment risk, not a pass.

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
- Host typecheck currently reports seven existing `Array.at` target-library
  errors. The one changed test containing `.at(-1)` is unchanged from
  `origin/main`; the other six affected files are outside this branch's diff.
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
- The Boxel UI safe-modifier browser test has not been verified in a reliable
  local browser runner.
- Long cross-realm navigation and memory-growth testing remains outstanding.
- Hosted iframe security and hostile CSS confinement are unfinished and must
  not be represented as production-complete.

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
- a parser-grade hostile CSS sanitizer/confinement design — production security
  follow-up unless the current implementation makes an unsafe claim.

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
