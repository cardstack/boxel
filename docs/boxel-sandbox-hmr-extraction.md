# Sandbox HMR extraction dossier

Extraction analysis of the frozen reference branch
`codex/code-preview-instant-reload`'s HMR / instant-reload system for
sandboxed (iframe) card rendering, targeting this branch's seams:
`sandbox-runtime-process.ts`, `sandbox-render-transport.ts`,
`sandbox-module-authority.ts`, `boxel-execution-engine.ts`. Written to
un-defer RP-17.1's "HMR/source volatility (generations, DOM adoption,
acknowledgements)" for the Sandbox tier, honoring RP-15.3 (a live iframe is
never re-parented; placeholder retained as last-known-good).

Read alongside [boxel-rendering-protocol.md](boxel-rendering-protocol.md) and
the freeze rules in
[boxel-execution-runtime-architecture.md](boxel-execution-runtime-architecture.md):
tests, fixtures, policies, and hard-won edge cases port aggressively;
orchestration code does not.

## 1. Inventory (frozen branch)

Core mechanism:

| Path                                                                     | Lines | Role                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------ | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app/services/realm-sandbox.ts`                                          | 6348  | Monolithic Host-side owner. Load-bearing pieces: iframe render-envelope identity (`iframeRenderFor`, `envelopeKey`/`capsuleKey`, ~L2634–2710); dynamic module-fetch authorization grown as imports are observed (`isIframeFetchAllowed`, `recordModuleSourceClassification`, ~L2738–2850); explicit "Reload Card" (`reloadCard`, L1232); external-vs-local invalidation arbitration (L3578–3760, L3927–3990). |
| `app/lib/code-preview-sandbox.ts`                                        | 568   | `VolatileModuleRegistry` (90s time-leased local-edit buffer), `CodePreviewAnalysisCache`, and `CodePreviewSandbox` — the generation state machine (`idle→draft→evaluating→rendered→persisting→persisted→acknowledged`/`failed`) with last-known-good tracking and stale-callback rejection. Richest single file for this work.                                                                                |
| `app/lib/realm-iframe-sandbox-protocol.ts`                               | 431   | Versioned, runtime-validated parent↔child wire protocol (`connect`/`draft`/`render`/`permissions`/`ready`/`resize`/`surface-presentation`/`fetch-request`/`fetch-response`/`card-update(-result)`), every shape guarded with bounded-length checks.                                                                                                                                                           |
| `app/components/realm-sandbox-iframe.gts`                                | 564   | Parent component. `connectFrame` creates iframe + `MessageChannel` exactly once; `syncDraft`/`syncPresentation`/`syncPermissions` push updates over the persisted port without touching iframe identity. Prerendered last-known-good placeholder while `status==='loading'`.                                                                                                                                  |
| `app/templates/realm-sandbox-frame.gts`                                  | 707   | Child-side route inside the iframe. `scheduleDraft` (revision-gated, serialized single-flight re-render), invalidates only the edited module in a detached `Loader`, re-derives the card from the same document object, keeps last valid card visible on error, posts `ready{revision, error?}`.                                                                                                              |
| `app/lib/realm-iframe-height-service.ts`                                 | 100   | Child `ResizeObserver`+`MutationObserver` intrinsic-size measurement, debounced, reports only genuine deltas.                                                                                                                                                                                                                                                                                                 |
| `app/lib/realm-iframe-media-bridge.ts`                                   | 172   | Child declarative `<img>` hydration through the bounded media capability; per-image generation token; resolves relative media against the nearest ancestor card's ID (fix `165ffee01c`).                                                                                                                                                                                                                      |
| `app/lib/realm-sandbox-iframe-origin.ts`                                 | 116   | Nonce-subdomain allocation. `realmSandboxIframeCapsuleKey(codePreviewID, reloadRevision)` is the identity deciding iframe reuse vs. remint (only explicit Reload Card mints).                                                                                                                                                                                                                                 |
| `app/routes/realm-sandbox-frame.ts`                                      | 85    | Child route model — format/field/component deliberately kept out of the iframe URL so they change over the port without re-navigating.                                                                                                                                                                                                                                                                        |
| `app/lib/realm-sandbox-source-policy.ts`                                 | 609   | `classifyCardSourceForSandbox` — re-run per draft so an edit can promote/demote tiers live.                                                                                                                                                                                                                                                                                                                   |
| `app/lib/realm-sandbox-runtime-registry.ts`                              | 102   | Refcounted idle-eviction registry (Capsule side).                                                                                                                                                                                                                                                                                                                                                             |
| `sandbox-renderer-worker/*`                                              | small | Worker proxying nonce-subdomain origins; why one origin serves a whole editing session.                                                                                                                                                                                                                                                                                                                       |
| `app/lib/realm-sandbox-boundary.ts`                                      | 315   | Store-side boundary record; includes the `included`-resource filtering fix from `3a51b51039`.                                                                                                                                                                                                                                                                                                                 |
| `app/{modifiers,services}/realm-sandbox-styles.ts`                       | 47+62 | Capsule-tier-only stylesheet refcounting across generations (Host-shared document). Not applicable to the iframe tier.                                                                                                                                                                                                                                                                                        |
| `app/components/realm-sandbox-template-island.gts` + isolated-render lib | 329   | Capsule-tier DOM adoption across two SES component programs — what RP-17.1's "DOM adoption" names. Out of scope for iframe HMR (see §2 note).                                                                                                                                                                                                                                                                 |

Tests (the gold):

| Path                                                                                                                            | Lines | Content                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/acceptance/code-submode/sandbox-live-reload-test.gts`                                                                    | 1586  | `[HMR-02]` metadata follows draft; `[HMR-05]` failure → last-known-good + floating overlay + recovery; `[HMR-06]` explicit Reload Card remounts; `[NAV-07][IFR-01][IFR-02]` iframe survives format switches; `[COLD-INTERACT-*]`/`[CORPUS-*]` fixtures. |
| `tests/unit/realm-sandbox-acknowledgement-test.ts`                                                                              | 150   | Local-edit vs server-event races: exact-source ack doesn't swallow sibling invalidations; card JSON saves are never HMR acks; external invalidation can't overwrite an active local generation; saving an active draft renews an expired lease.         |
| `tests/unit/code-preview-sandbox-test.ts`                                                                                       | 410   | `[HMR-01]` 90s volatile lease; `[HMR-05]` generation guard incl. "a late callback from an older draft cannot roll the state backward"; bounded caches.                                                                                                  |
| `tests/unit/realm-sandbox-iframe-draft-test.ts`                                                                                 | 495   | Loader/MessageChannel idempotency; private Monaco buffer served only for its exact URL; cross-realm read denial; declared-dependency-only grants.                                                                                                       |
| `tests/unit/lib/realm-iframe-sandbox-protocol-test.ts`                                                                          | 298   | Wire-protocol validator conformance.                                                                                                                                                                                                                    |
| `tests/unit/lib/realm-iframe-media-bridge-test.ts`                                                                              | 142   | Media hydration incl. linked-card relative-URL fix.                                                                                                                                                                                                     |
| `tests/integration/components/realm-sandbox-iframe-test.gts`                                                                    | 526   | Component-level iframe lifecycle.                                                                                                                                                                                                                       |
| `tests/acceptance/realm-sandbox-navigation-soak-test.gts`                                                                       | 235   | `[SOAK-04]` repeated navigation releases runtimes/styles/iframes/channels.                                                                                                                                                                              |
| `tests/unit/realm-sandbox-runtime-lifecycle-test.ts`                                                                            | 190   | Idle-eviction refcounting.                                                                                                                                                                                                                              |
| policy-layer unit tests (`-boundary`, `-source-policy`, `-import-policy`, `-iframe-origin`, `-runtime-registry`, `-url-policy`) | ~1100 | Supporting coverage.                                                                                                                                                                                                                                    |

## 2. Mechanism walkthrough

- **Change detection.** No SSE/poll for local edits: Monaco / AI edits call
  `CodePreviewSandbox.update(sourceURL, source)`, freezing an immutable
  `CodePreviewDraft{sourceURL, source, revision}`. Server SSE invalidations
  are handled separately and arbitrated against in-flight local generations
  (`realm-sandbox.ts:3578-3760`).
- **Generation identity.** Monotonic per-module integer
  (`VolatileModuleRegistry.publish`: `revision = (previous?.revision ?? 0) + 1`).
  That revision is the only identity threaded through draft message, child
  staleness guard, and `ready.revision` ack.
- **Iframe survival (RP-15.3).** Confirmed satisfied: `connectFrame` creates
  iframe + channel once; ordinary edits flow over the existing port and never
  touch `iframe.src`. Envelope identity (`envelopeKey`/`capsuleKey`,
  `realm-sandbox.ts:2634-2644`) deliberately excludes draft revision; only
  `reloadRevision` (explicit Reload Card) changes it and mints a new nonce
  origin. Tests `[HMR-06]`, `[NAV-07][IFR-01][IFR-02]`.
- **Module invalidation.** Surgical: `loader.invalidateModule(draft.sourceURL)`
  (`realm-sandbox-frame.gts:566`), then re-derive the card from the same
  document object — card data state survives; only module/component identity
  changes.
- **In-flight renders.** `scheduleDraft` (`realm-sandbox-frame.gts:550-593`):
  drop `revision <= latestDraftRevision` on arrival; serialize re-renders
  through one promise chain; re-check staleness after each await so a
  superseded draft never posts a stale `ready`.
- **Failure → last-known-good.** Two layers: child keeps the previous card
  mounted on failed deserialize; parent retains `lastKnownGoodRevision` and
  overlays the error as a floating panel over the still-mounted preview
  (`[HMR-05]`). Late callbacks from older drafts are no-ops via object-identity
  draft comparison.
- **Acknowledgement.** Child posts `{type:'ready', revision, error?}` after
  every draft, success or failure. Parent applies only when the outstanding
  generation matches. Persistence acknowledgement (save → SSE) is separately
  arbitrated: exact-source match consumes only that URL from a mixed
  invalidation event (`realm-sandbox.ts:3927-3990`).
- **Sizing stability.** `heightMode: 'intrinsic' | 'allocated'`; intrinsic
  clamped to [40, 2400]px; height service reports only genuine deltas, so an
  HMR re-render with identical layout emits zero resize messages.
- **Placeholder.** Prerendered inert placeholder only during initial connect
  (`status==='loading'`), never re-entered for an ordinary draft push; its
  cache key includes the reload-bearing URL so a forced reload cannot revive a
  stale prerender row (`realm-sandbox.ts:2263-2264`).
- **DOM adoption is Capsule-only.** The iframe child is one persistent Glimmer
  application; HMR re-render is ordinary reactivity — DOM diffing is free.
  The Sandbox tier needs no DOM-adoption primitive; that machinery
  (`realm-sandbox-template-island.gts`) matters only if Capsule HMR is
  tackled later, as its own dossier.

## 3. Hard-won edge cases (must be honored)

1. **Linked-card media resolution** (`165ffee01c`): resolve relative
   `<img src>` against the nearest `[data-boxel-card-id]` ancestor, not the
   root module; clear `src` before dispatching the bounded fetch so the
   browser's own failed relative request can't permanently break components
   that latch onto the first error.
2. **Rapid successive edits:** drop stale-on-arrival, serialize re-renders,
   re-check staleness post-await. The current branch's render queue serializes
   but has no generation field to reject out-of-sequence requests.
3. **Local edit vs server/index round-trip race:** exact-source ack must not
   swallow co-invalidated siblings; card-data JSON saves are never module HMR
   acks; external invalidation must not overwrite an active local generation.
4. **Lease expiry mid-save:** a save completing after the volatile lease TTL
   must renew the lease, not flash back to canonical source.
5. **Editor metadata follows the unsaved draft** without opening a commit
   generation for the read (`[HMR-02]`).
6. **Compile-time and render-time failures both retain last-known-good**, both
   recover, and the failed and last-good generations are simultaneously in the
   DOM — synchronize tests on content, not element presence (`[HMR-05]`).
7. **Explicit "Reload Card" is a separate path:** the only thing that changes
   capsule/iframe identity, and it must also invalidate placeholder/prerender
   caches keyed on the old identity (`[HMR-06]`).
8. **New imports added mid-session must be admitted** through the same
   observe()-grown mechanism as initial load — per-edit `allowModules()`
   re-seed or confirmation that `SandboxModuleAuthority.observe()` suffices;
   never widen beyond the literal reachable graph.
9. **Document-declared relationship modules must be re-granted per edit** if
   the edit changes which linked-card types are referenced
   (`documentDeclaredModules` already exists on this branch).
10. **Stylesheet replacement is a non-issue for the iframe tier** (own
    document; idempotent scoped-CSS registry). Capsule refcounting machinery
    must not be re-derived here.
11. **Focus preservation falls out of** (a) never recreating the iframe and
    (b) reusing the same document object across edits. No dedicated code —
    preserve those two invariants.

## 4. Portability verdicts

| Item                                                 | Verdict                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Wire shapes `draft`/`ready{revision,error}`/`resize` | RE-IMPLEMENT on `SandboxRuntimeControl`/render request-response — do not copy as a parallel protocol module |
| `CodePreviewSandbox` generation state machine        | RE-IMPLEMENT as a standalone class beside `BoxelExecutionSession`                                           |
| `scheduleDraft` gate + single-flight queue           | RE-IMPLEMENT in the child render dispatch                                                                   |
| observe()-grown authorization                        | Already present on this branch; port only the mid-session-new-import test                                   |
| Envelope-key-excludes-draft-revision policy          | RE-IMPLEMENT as a stated invariant (~10 lines)                                                              |
| `RealmIframeHeightService`                           | PORT-AS-IS                                                                                                  |
| `RealmIframeMediaBridge` (incl. linked-card fix)     | PORT-AS-IS                                                                                                  |
| connectFrame/sync\* modifier split                   | RE-IMPLEMENT against the current renderer's sandbox slot                                                    |
| Explicit Reload path                                 | RE-IMPLEMENT (small, after ordinary HMR)                                                                    |
| Runtime registry                                     | DISCARD (superseded by `SandboxRuntimeProcess` lifecycle)                                                   |
| SSE/commit acknowledgement arbitration               | RE-IMPLEMENT later, once a Sandbox-tier save path exists                                                    |
| Capsule DOM adoption + stylesheet refcounting        | DISCARD for this scope                                                                                      |
| `realm-sandbox.ts` as a unit                         | DISCARD (orchestration)                                                                                     |
| The test suites listed in §1                         | PORT AGGRESSIVELY, adapted to new APIs                                                                      |

## 5. Extraction plan (ordered)

1. **[S]** Add monotonic `generation` to `SandboxRenderRequest`/`Response`
   (echoed back), with bounds-checked validators matching the file's style.
2. **[M]** Child-side generation-gated invalidate-and-rerender: drop
   `generation <= latest` on arrival; `loader.invalidateModule(url)` on the
   edited-module hint; keep promise-chain serialization; re-check generation
   post-await; never clear the previous successful render on failure.
3. **[S]** Module-authority growth per edit: re-call
   `allowModules([...newModuleGraph, ...documentDeclaredModules(request)])`
   before each HMR render; test that observe() admits imports introduced only
   by the edited source.
4. **[M]** Parent-side generation state object
   (`{phase, generation, lastKnownGoodGeneration, error}`), transitions only
   on matching echoed generation.
5. **[S]** Last-known-good retention on the render slot: a failed generation
   updates error state alongside the still-mounted previous render.
6. **[S]** Explicit hard-reload signal distinct from ordinary HMR, changing
   render-envelope identity and invalidating placeholder caches.
7. **[L]** Port tests: `[HMR-05]` state machine; the module-authority draft
   tests; the media-bridge regression test; plus new conformance statements
   for the RP-17.1 un-deferral: monotonic/stale-rejected `generation`
   cross-tier, iframe `contentWindow` identity unchanged across a generation,
   request/response generation echo. Defer the SSE-arbitration suite until a
   Sandbox-tier save path exists.

Sizing: steps 1–3, 5, 6 ≈ 150–250 lines total on existing seam files; step 2
and 4 ≈ 150–250 lines each; step 7 is the largest but is adaptation of
already-written assertions, not new design.
