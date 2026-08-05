# Realm sandbox follow-up plan

## Objective

Move `codex/code-preview-instant-reload` from a working research branch to a
reviewable, honestly verified sandbox change without hiding regressions or
expanding the core PR indefinitely.

The architecture is coherent enough to review. The remaining work is to make
the review approachable, reduce the diff into dependency-ordered units, prove
UX compatibility, and separate known security follow-ups from claims made by
the core change.

## Guiding constraints

- Keep the Store canonical for card data.
- Keep trusted Base module identity shared and immune to user-module churn.
- Keep sandbox selection owned by host policy and CardRenderer.
- Prefer an explicit boundary API over card-specific compatibility exceptions.
- Preserve existing tests and their intent; do not weaken assertions to make
  the branch green.
- Treat UX parity with `main` as part of correctness.
- Do not describe main-thread SES as CPU/memory isolation.
- Do not block the core boundary indefinitely on separable hosted-infrastructure
  or defense-in-depth work.

## Phase 1: make the review approachable

These items should be completed before requesting broad human review.

- [x] Integrate a roughly 20-minute review path into the main narrative of the
      [reviewer guide](realm-sandbox-reviewer-guide.md), without maintaining a
      separate short-guide section.
  - [x] State the core security invariant in one paragraph.
  - [x] Include a compact architecture flow.
  - [x] Name the five most load-bearing files.
  - [x] Name the three highest-risk review questions.
  - [x] Give the smallest focused test command set.
- [ ] Keep the full reviewer guide as the authoritative deep reference rather
      than shortening away its library explanations, complete flows, or security
      limitations.
- [ ] Rebuild the branch into dependency-ordered commits or stacked PRs:
  1. Loader evaluator, explicit boundary, and trusted-loader immunity.
  2. SES runtime, delegated rendering, styles, and stable render slots.
  3. Iframe renderer and typed capability protocol.
  4. Volatile Code-preview generations and HMR.
  5. Navigation, new-file, broken-source, and AI-patch UX parity.
  6. Compatibility migrations and the acceptance matrix.
  7. Staging-backed local preview infrastructure as a separate change.
- [ ] Keep each commit buildable and place focused tests beside the behavior
      they prove.
- [ ] Remove unrelated local work and generated artifacts from every sandbox
      commit.

### Phase 1 completion signal

A reviewer can understand the security boundary without opening
`RealmSandboxService`, and can review each commit without mentally separating
unrelated infrastructure or UX changes.

## Phase 2: required diligence before merge

### Automated verification

- [x] Run `git diff --check` and confirm no `.only` or `.skip` was introduced.
- [x] Run lint in every modified package. Host JavaScript and template lint
      pass; the primary checkout's type run reaches only the seven documented
      parent-`node_modules` `Array.at` diagnostics and the detached CI-shaped
      checkout passes.
- [x] Run the focused Loader, SES runtime, opaque-boundary, iframe-protocol,
      stylesheet, lifecycle, rehydration, generation-state, file-tree, new-file,
      and patch-flow tests from a freshly built host.
- [x] Get the Boxel UI safe-modifier browser test running in CI or a working
      local test-app runner.
- [ ] Push the review branch and run the full existing Host CI suite.
- [ ] Triage CI with `pnpm ci:failures`; classify every failure as introduced,
      pre-existing, flaky, or an intentional product change.
- [ ] Audit changes to old tests for removed assertions, hidden delays, relaxed
      timing, or mocks that bypass the real boundary.

### Manual compatibility matrix

- [ ] Test an official Base card on the trusted fast path.
- [ ] Test an existing user-authored SES card in Interact mode.
- [ ] Test isolated, embedded, edit, fitted, atom, head, and markdown formats.
- [ ] Test MarkdownField and delegated nested-card rendering across realm
      boundaries.
- [ ] Test a DOM-heavy/Three.js-style card in the iframe tier.
- [ ] Confirm intrinsic iframe height for embedded, atom, edit, and isolated;
      confirm fitted receives an allocated viewport and child measurements do
      not override Host sizing.
- [ ] Rapidly switch preview formats and verify the warm two-format SES cache.
- [ ] Rapidly navigate the file tree and Recent Files; Monaco must not wait for
      schema or preview loading.
- [ ] Edit text and CSS repeatedly in Monaco and verify only the first
      canonical-to-volatile transition may flash.
- [ ] Apply AI patches and verify completed blocks publish through the same
      volatile generation path.
- [ ] Modify a displayed GTS through Boxel CLI and verify the external write
      uses targeted HMR without resetting unrelated loaders.
- [ ] Introduce invalid GTS, confirm last-known-good UI remains visible with an
      actionable error, then repair it.
- [ ] Create a new stub GTS and confirm source, schema, Base fallback preview,
      saving, indexing, and instance navigation behave like `main`.
- [ ] Use Reload Card and verify it deliberately remounts only the selected
      card while preserving Store identity and unrelated runtimes.

### Lifetime and performance verification

- [x] Run an automated 4,096-principal cross-realm lifecycle soak in Chrome.
- [x] Record principal runtime count before, during, and after idle eviction.
- [x] Confirm settled compartment-load promises do not accumulate.
- [x] Confirm stylesheet registry entries return to their expected ref counts.
- [x] Confirm Code-preview analysis/source caches remain within their bounds.
- [ ] Compare file navigation, format switching, first render, and repeated HMR
      against `main` and deployed staging.
- [x] Measure forced-GC heap across the automated principal/runtime/style soak;
      the current result is 0.00 MiB growth after warm-up, with zero remaining
      runtimes, loads, templates, or sandbox stylesheets.
- [ ] Run a long route-level UI session with SES and iframe cards and inspect
      detached DOM nodes, retained iframe ports, and render drops. The
      deterministic service soak and the 128-navigation real-router acceptance
      soak do not substitute for a CDP retainer snapshot of a long interactive
      session.

### Phase 2 completion signal

The focused matrix and existing CI suite pass without weakening old regression
coverage, and manual testing shows the sandbox is secondary to ordinary Boxel
navigation rather than a new global loading dependency.

## Phase 3: core architecture cleanup

Do this only after the behavior above is stable. Avoid mixing a second broad
refactor into the initial correctness pass.

- [ ] Extract an iframe broker from `RealmSandboxService`.
  - Own target-origin validation.
  - Own MessageChannel lifecycle.
  - Own request/response bounds and fetch capabilities.
  - Own iframe loader/height metrics.
- [ ] Extract a template registry from `RealmSandboxService`.
  - Own per-template revisions.
  - Own stable render envelopes.
  - Own stylesheet identities.
  - Own settled-load cleanup and bounded caches.
- [ ] Keep `RealmSandboxService` as the Ember-facing policy/orchestration
      facade, not the owner of every state machine.
- [ ] Add direct collaborator tests before moving behavior out of the service.
- [ ] Remove transitional shims once all official callers use explicit
      card-type and delegated-render APIs.

### Phase 3 completion signal

The main service explains policy and coordinates collaborators. Runtime
lifetime, iframe transport, template identity, and preview generations can each
be understood and tested without reading the entire service.

## Phase 4: security follow-ups

These are real limitations and must remain visible. They should be separate,
reviewable hardening projects unless a focused review finds an immediate
boundary escape.

### Conditional production gates

The architectural PR may be reviewed before all Phase 4 work is finished, but
the affected capability must not be enabled or described as secure in a hosted
environment without its gate:

- **Hosted iframe gate:** keep iframe execution disabled outside the supported
  local/test environment until the dedicated sandbox origin, exact
  parent/child origin checks, CSP/frame policy, and broker integration tests are
  deployed. A localhost iframe is a compatibility proof, not a production
  security boundary.
- **CSS confinement gate:** shared-document SES styles now pass both decoded
  raw-source checks and browser CSSOM validation. Every selector target must
  retain its compiler scope; network-bearing values, document-global at-rules,
  named layers, view-transition names, and declarative top-layer entry points
  fail closed. The host render slot is also a layout/style/paint containment
  and isolated stacking context in every SES format, including atom. This
  closes the supported shared-document CSS selector/network/global-registration
  and visual-overlay paths. It does not provide CPU or memory isolation, and it
  does not make arbitrary resource-bearing HTML markup a brokered capability.

If the core change would enable either capability broadly in production, its
corresponding gate moves from follow-up to pre-merge work.

### Hosted iframe deployment

- [ ] Deploy iframe rendering on a dedicated uncredentialed sandbox origin.
- [ ] Decide whether isolation is per deployment, principal, realm, or iframe
      instance, and document the threat model behind that choice.
- [ ] Configure exact parent/child origin validation and `targetOrigin`.
- [ ] Add CSP, frame headers, referrer policy, and cookie/storage policy for the
      sandbox origin.
- [ ] Add hosted-environment integration tests; localhost success is not an
      adequate deployment test.

### Brokered network authority

- [ ] Replace broad same-realm fetch permission with an explicit endpoint,
      method, header, redirect, and response-size policy.
- [ ] Ensure credential values never enter iframe or SES-visible data.
- [ ] Decide how realm permissions and delegated card capabilities combine.
- [ ] Add negative tests for encoded path escapes, redirects, oversized
      bodies/headers, unsupported methods, and cross-realm URLs.

### Sandbox-scoped Store authorization

- [ ] Define an immutable sandbox execution principal that binds the user
      session, app/module identity, app installation, and sandbox instance.
- [ ] Add a scoped Store facade whose effective authority is the intersection
      of user permissions, app/sandbox policy, explicit grants, and operation.
- [ ] Keep installed apps confined to their granted app realm by default.
- [ ] Add a trusted Host chooser for granting exact cross-realm cards or
      resources, analogous to selected-photo rather than whole-library access.
- [ ] Make grants revocable and time/session bounded by default; persist them
      only through an explicit app-install permission flow.
- [ ] Enforce grants inside Store load, search, relationship-hydration, and
      mutation paths before documents, metadata, or result counts materialize.
- [ ] Add negative tests for guessed URLs, arbitrary ids, forward/reverse
      relationship traversal, global search, stale grants, and user-permission
      revocation.
- [ ] Verify iframe origin and `prefersFullSandbox` never act as data-access
      credentials; they are execution/transport properties only.

### CSS confinement

- [x] Replace regex-only network checks with parsed CSS validation plus a
      decoded-source preflight for grammar that CSSOM may discard.
- [x] Define policy for `@import`, `url()`, fonts, images, cursor URLs, and
      source maps.
- [x] Reject global at-rules and named cascade layers that survive selector
      rewriting.
- [x] Reject view-transition naming and declarative popover/dialog command
      attributes, because browser top-layer rendering bypasses ancestor paint
      containment.
- [x] Add cross-card selector, escaped-grammar, global-registration, and
      network-exfiltration regression tests, including a real compiled GTS
      stylesheet crossing the SES template boundary.
- [x] Define a host-owned paint/layout boundary for shared-document SES cards:
      every sandbox CardContainer is a layout/style/paint containment and
      isolated stacking context, so oversized and unusual paint is clipped,
      and atom cards retain a shrink-to-fit principal box so the boundary is
      not defeated by `display: contents`. Compiled-selector, network, and
      global-registration validation remain independently fail-closed.

### Availability and server execution

- [ ] Design Worker/process isolation for non-DOM commands with CPU, memory,
      time, and cancellation budgets.
- [ ] Treat server prerender as its own trust boundary.
- [ ] Add per-render resource limits, network policy, lifecycle cleanup, and
      origin isolation to headless-browser rendering.
- [ ] State clearly which server-rendered sources are trusted until that work
      is complete.

### Phase 4 completion signal

Hosted iframe and server execution have deployable origin/resource policies,
CSS is validated structurally, and the product can state its confidentiality
and availability guarantees without relying on browser-process assumptions.

## Decisions that should trigger design review first

Stop and request architectural feedback instead of adding a local shim when a
change would:

- expose a live card constructor, Store, Loader, service, component, or DOM
  Element to user realm code;
- make sandbox tier controllable by card source data or URL state;
- share a user-module Loader across unrelated principals;
- make fitted/atom/head/markdown depend on an iframe;
- create a second canonical card-data store for sandbox rendering;
- replace the whole host Loader to apply one volatile module edit;
- turn the iframe broker into unrestricted authenticated fetch; or
- claim main-thread SES prevents infinite loops or memory exhaustion.

## Suggested issue split

1. **Reviewability:** add the 20-minute path and reconstruct the commit stack.
2. **CI and regression diligence:** run/triage the broad suite without weakening
   existing assertions.
3. **Manual UX and lifetime matrix:** staging parity, long navigation, and
   memory/resource evidence.
4. **Service decomposition:** iframe broker and template registry.
5. **Hosted iframe security:** origin, CSP, protocol, and fetch policy.
6. **CSS security:** parser-based resource/global-rule policy.
7. **Command and server availability isolation:** Worker/process budgets and
   prerender policy.

Issues 1–3 gate the core branch. Issues 4–7 are follow-ups unless diligence
finds a concrete correctness or security escape that must be fixed before
merge. Hosted iframe and hostile-CSS support also obey the conditional
production gates above: incomplete hardening means the capability remains
disabled or explicitly restricted, not that the risk is silently accepted.
