# Realm sandbox WIP review findings

Review of commit `6cbbf8174d` on `codex/code-preview-instant-reload`, against
the assignment in [the review handoff](realm-sandbox-wip-review-handoff.md).

Every claim below was verified against the code on the checked-out branch.
Where a claim contradicts the handoff's "Known State", the contradicting
command output is given.

## Implementation response (2026-08-02)

This document preserves the independent review at commit `6cbbf8174d`. The
working tree now contains the following response to that review:

- **Fixed in the core implementation:** F-1 through F-16 and F-18 through
  F-20. Trust is decided from canonical, realm-contained module identities;
  iframe reads are GET-only and limited to the root module, its declared graph,
  trusted modules, or public credentialless resources; the MessageChannel
  bootstrap is one-shot; acknowledgements partition mixed invalidations;
  opaque metadata is revisioned; CSS is browser-parsed and checked after CSS
  escape decoding; iframe envelopes are stable; persistence failures are
  visible; non-cloneable edits fail closed; invalidation reaches cross-realm
  consumers without replacing loader identities; local drafts win over stale
  external events; file writes capture their URL; stale in-flight fetches have
  an epoch guard; and cyclic dependency edges remain in the invalidation graph.
- **Compatibility closure after the review:** sandbox components now receive a
  write-only `viewCard` effect recorder instead of a host callback. The host
  validates the returned target against the card's realm before dispatch. Safe
  URL parsing is available inside SES without exposing Blob-URL authority,
  including through native-instance prototype constructor chains.
  Overlapping async actions are serialized per component instance so their
  returned effects cannot be mixed. Stateful components rerender their existing serialized Glimmer island inside
  the renderer transaction, preserving both authored DOM and replacement
  markers. The island compares only public args, so its private rerender
  capability cannot spuriously remount and reset component state.
- **Fixed with bounded-lifecycle evidence:** F-17. Volatile full-source
  generations, sandbox errors, source analyses, and themes are bounded;
  settled compartment loads are removed; idle principal eviction removes its
  runtime and template state. A 4,096-principal Chrome soak retains one mounted
  runtime/style at each checkpoint and finishes with zero runtimes, loads,
  templates, and stylesheets. Forced-GC heap growth after warm-up is 0.00 MiB.
  A route-level SES/iframe CDP retainer soak remains useful product diligence,
  but cache cardinality is no longer an unverified app-lifetime risk.
- **Clarified:** F-23. The cache intentionally has no Realm subscription. Each
  mounted `FileTreeFromIndex` resource owns one filtered subscription and
  force-refreshes the shared cached query after a relevant incremental index
  event; focused integration coverage verifies the invalidation filter. This
  keeps the cache session-scoped without creating a second event owner.
- **Intentionally deferred:** F-21 and F-24. Suspending effects in hidden
  format islands and rolling back a partially-built Glimmer transaction need
  framework-level designs; changing either here would enlarge the
  security-boundary series without being required to close it. F-22, the
  unrelated GPT-5.6 Luna
  model-list change and its tests, has been removed from this branch response
  so it can ship independently.
- **Verification:** the Host build succeeds in development mode and in the
  exact CI environment; runtime-common, realm-server, Host JavaScript/template,
  Base, experiments-realm, and Boxel UI lint succeed. The complete Boxel UI browser
  suite passes 408/408, including safe-modifier coverage. The latest focused
  Host run includes seven passing sandbox live-reload acceptance rows, all 19
  Host Mode rows, all 26 prerender-HTML rows, and passing loader, SES runtime,
  import-policy, iframe-protocol, CSS-boundary, acknowledgement, preview,
  render-service, patch-code, and invalidation suites. The explicit component
  protocol passes 17/17, serialized-island coverage passes 6/6, and the host
  navigation boundary rejects cross-realm effects. Host typecheck passes in a
  detached `/tmp` checkout of this branch after the same Boxel Icons type-build
  prerequisite used by CI. In the primary checkout it reports seven
  `Array.at` target-library failures because TypeScript also discovers
  `/Users/chris/Projects/node_modules/@types/node`, outside the repository; no
  other diagnostics are present. Software Factory Node tests pass 591/592
  locally; the single macOS dual-stack failure is in unchanged code. A
  separate new-card-definition row remains unverified because the local Base
  prerender manager timed out before the test reached a product assertion; it
  is not counted as passing.
- The exact AMD performance gate and its synthetic trip test pass. The realm
  performance gate passes all three scenarios. The latest successful `main`
  CI Lint run confirms that Host `ember-tsc --noEmit` runs successfully in
  GitHub using Node 24.17.0, pnpm 11.0.9, and TypeScript 5.9.3, the same pinned
  toolchain used by this checkout. The isolated branch reproduction also
  passes, so the seven primary-checkout diagnostics are recorded as parent
  `node_modules` contamination rather than fixed by changing unrelated source.
- The latest service-backed aggregate realm-sandbox run passes 29/29. A prior
  CI-namespace retry failed global setup when its Base realm was unavailable;
  that infrastructure result did not reach a product assertion and is not
  counted as a test failure. The narrower compartment runtime suite that
  covers the final URL and overlapping-action changes passes 17/17.

This response does **not** make hosted iframe isolation production-ready. A
dedicated hosted origin with CSP/origin validation remains a deployment gate.
Shared-document CSS now fails closed on unscoped targets, network grammar,
document-global rules, and named layers; visual paint/layout confinement and a
route-level SES/iframe retainer soak remain follow-ups.

## 1. Verdict

The architecture is viable and worth consolidating. The branch establishes a
real, mostly coherent explicit boundary: the Loader's evaluator seam is a clean
separation of module graph from evaluation; the opaque card record plus
explicit type metadata genuinely removes constructor introspection from host
UI; delegated rendering preserves Base's ergonomic `getComponent(instance)`
API without reopening ambient authority; targeted invalidation demonstrably
keeps Base and unrelated realm loaders immune; and the generation state machine
guards every transition by draft object identity rather than arrival order, so
a late acknowledgement provably cannot roll a newer draft backward. This is not
"old implicit APIs recreated as special cases" — the data-only crossings
(`jsonClone` at the compartment edge, template descriptors instead of live
components, handles instead of instances) are the right shape, and the acceptance
tests assert the properties that matter (exact authored-node identity, adoption
status, absence of read-only and loading flashes). However, the boundary is
**not currently closed**: the trusted-import decision is made on the raw,
unresolved specifier string on both sides of the compartment, and a card can
spell a path-traversal specifier that passes the prefix test and causes the
_trusted host loader_ to evaluate arbitrary user-realm source (F-1). That is a
full SES escape reachable from ordinary authored source, and it must be fixed
before the boundary can be described as a boundary at all. It is a small,
well-localized fix, not a design failure — which is why the recommendation is
consolidate-and-fix rather than redesign.

## 2. Prioritized findings

### P0

**F-1. Path traversal in a trusted import specifier escapes the compartment
into the trusted host loader.**

The trust decision is made twice on the _raw authored string_, never on a
resolved and normalized URL:

- [`realm-compartment-module-runtime.ts:409-417`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L409)
  — `this.isTrustedImport(dependency)` on the raw AMD dependency, then shims it
  with the token-minting Proxy facade
  ([`:556-587`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L556)).
- [`realm-sandbox-import-policy.ts:10-16,49-60`](../packages/host/app/lib/realm-sandbox-import-policy.ts#L10)
  — the policy is pure `startsWith`.
- [`realm-sandbox.ts:2874-2892`](../packages/host/app/services/realm-sandbox.ts#L2874)
  — the host re-checks the same raw string, then calls
  `this.network.loaderService.loader.import(reference.module)` on the **trusted
  host loader** and returns `module[reference.name]` directly into the Glimmer
  template scope. Same pattern at
  [`:2038-2045`](../packages/host/app/services/realm-sandbox.ts#L2038)
  (`resolveTrustedIcon`) and
  [`:2067-2092`](../packages/host/app/services/realm-sandbox.ts#L2067)
  (`resolveTrustedFieldType`).
- [`virtual-network.ts:66-77,116-126`](../packages/runtime-common/virtual-network.ts#L66)
  — the import map resolves `@cardstack/base/<rest>` as
  `new URL(rest, resolvedBaseRealmURL)`.

Failure scenario, with both mechanical steps verified by execution:

```
# 1. the raw specifier survives transpilation into the AMD dependency list
$ transpileAmd("import { Evil } from '@cardstack/base/../myrealm/evil.gts'; export const x = Evil;",
               { moduleId: 'http://localhost:4201/myrealm/card.gts' })
define("http://localhost:4201/myrealm/card.gts",
       ["exports","@cardstack/base/../myrealm/evil.gts"], ...)

# 2. it passes the prefix trust test and resolves outside the base realm
prefixTest = true
resolved   = http://localhost:4201/myrealm/evil.gts
```

A user-realm card writes that import and uses `<Evil />` in its template. The
compartment sees only an inert token, so nothing fails closed there. The token
reaches the host as `{kind:'trusted-export', module:'@cardstack/base/../myrealm/evil.gts'}`
([`:858-883`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L858)),
passes `isTrustedSandboxImport` a second time, and the host loader — which uses
the default direct-`eval` evaluator
([`loader.ts:124-144`](../packages/runtime-common/loader.ts#L124)) and carries
`authorizationMiddleware` — fetches and evaluates the attacker's module with
full host authority, then renders its export in the host document.

Fix: resolve and normalize the specifier _before_ the trust test, and assert the
resolved URL is inside the base/catalog realm (`assertURLWithinRealm` already
exists and is used correctly on the compartment fetch path at
[`:2643`](../packages/host/app/services/realm-sandbox.ts#L2643)). Apply at all
four sites above. This is a contained fix and belongs in the core series.

**F-2. The parent-brokered iframe fetch is an authenticated open GET proxy.**

[`realm-sandbox.ts:1018-1072`](../packages/host/app/services/realm-sandbox.ts#L1018)
validates only scheme
([`:1024-1026`](../packages/host/app/services/realm-sandbox.ts#L1024)) and
method ([`:1027-1030`](../packages/host/app/services/realm-sandbox.ts#L1027)).
`assertURLWithinRealm` is never called here — its only call sites are the two
compartment paths (`:2219`, `:2643`) — and `sandbox.principal` is available on
the envelope ([`:981`](../packages/host/app/services/realm-sandbox.ts#L981)) but
unused. The request goes through `this.network.authedFetch`
([`:1057`](../packages/host/app/services/realm-sandbox.ts#L1057)), and the full
body plus all response headers are returned to the child
([`:1063-1071`](../packages/host/app/services/realm-sandbox.ts#L1063)).

The code comment at
[`:1053-1056`](../packages/host/app/services/realm-sandbox.ts#L1053) is
factually wrong: it claims credentials are granted "only when the response is a
Boxel realm challenge", but
[`authorization-middleware.ts:27-30`](../packages/runtime-common/authorization-middleware.ts#L27)
sets `Authorization` on the _request_, before any response exists. The
challenge logic is only the re-auth retry. `credentials: 'omit'` suppresses
cookies, not this header.

Failure scenario: an iframe-tier card asks the broker for
`https://realm-b.example/private/notes.json`; the parent attaches the user's
realm-B token and hands the plaintext body to realm-A's code.

**F-3. Card code inside the iframe can capture a fresh broker MessagePort.**

[`realm-sandbox-iframe.gts:131-142`](../packages/host/app/components/realm-sandbox-iframe.gts#L131)
keeps `receiveBootstrap` registered for the component's lifetime and re-runs
`connect()` on _any_ `listening`-shaped message from `element.contentWindow`.
`connect()` transfers `port2` by `postMessage` into the child window
([`:113-129`](../packages/host/app/components/realm-sandbox-iframe.gts#L113)),
where every listener in that document receives it. Authored code does run with
full ambient authority in the child: `createDetachedLoader`
([`loader-service.ts:271-274`](../packages/host/app/services/loader-service.ts#L271))
calls `makeLoader` with no `moduleEvaluator`, i.e. the default direct-`eval`
evaluator — there is no SES in this tier. The child renderer's own `this.port`
guard ([`realm-sandbox-frame.gts:98-108`](../packages/host/app/templates/realm-sandbox-frame.gts#L98))
stops the _renderer_ re-accepting; it does nothing about other listeners.

Failure scenario: card code registers a `message` listener, posts
`{protocol, type:'listening'}` to `parent`, receives a live port, and issues
`fetch-request` messages directly. Combined with F-2 this is arbitrary
authenticated cross-realm read exfiltration. Nothing binds the port to the
bootstrap handshake — no nonce, session id, or sequence number.

**Scope note on F-2/F-3:** the iframe tier is fail-closed by default in a
hosted deployment — `iframeSandboxOrigin()` returns `undefined` for any host
that is neither `localhost` nor `127.0.0.1` unless `REALM_SANDBOX_IFRAME_ORIGIN`
is set ([`:1094-1108`](../packages/host/app/services/realm-sandbox.ts#L1094)),
and `iframeRenderFor` bails without an origin
([`:963-966`](../packages/host/app/services/realm-sandbox.ts#L963)). They are
nonetheless P0 because the documented staging workflow _does_ enable the tier
against real staging credentials:
[`staging-backend-env.js:80-81`](../packages/host/scripts/staging-backend-env.js#L80)
points the sandbox origin at `https://127.0.0.1:${hostPort}` — the same Vite
process serving the privileged host app. The comment there calls this
"process-isolated"; it is a second origin on the same server, not a separate
process.

### P1

**F-4. A commit acknowledgement swallows the entire realm event, not just the
acknowledged module.**
[`realm-sandbox.ts:1888-1897`](../packages/host/app/services/realm-sandbox.ts#L1888)
returns true if _any_ invalidation matches `commit.sourceURL`;
[`store.ts:1951-1967`](../packages/host/app/services/store.ts#L1951) then
returns before the partitioning block and before `#reloadInvalidatedInstances`.
Every other file in the same incremental event — dependent `.gts` consumers and
all invalidated `.json` instances — gets no invalidation and no store reload.
Editing `base-widget.gts` leaves `derived-card.gts` running pre-edit code in
every loader and SES runtime until an unrelated event or a page reload.

**F-5. Opaque card class and field metadata are never invalidated.**
`opaqueCardTypes`, `trustedFieldTypesByOpaqueType`, and
`fieldMetadataByOpaqueType`
([`:383-395`](../packages/host/app/services/realm-sandbox.ts#L383)) are written
once at [`:727-729`](../packages/host/app/services/realm-sandbox.ts#L727) and
read at [`:673-675`](../packages/host/app/services/realm-sandbox.ts#L673).
Nothing deletes them — not `invalidateCanonicalSandboxModule`
([`:1746-1766`](../packages/host/app/services/realm-sandbox.ts#L1746)), not
`willDestroy`. `loadCardTypeMetadata`
([`:2020-2033`](../packages/host/app/services/realm-sandbox.ts#L2020)) is called
only inside the `if (!OpaqueCard)` branch. Add a field or an `edit` template to a
sandboxed card and save: templates re-evaluate, but `authoredTemplateFormats`
stays stale so `usesInheritedBaseTemplate`
([`:1164-1174`](../packages/host/app/services/realm-sandbox.ts#L1164)) keeps
routing `edit` to the Base fallback, and new fields never appear in `fieldsFor`,
for the rest of the session. Also an unbounded app-lifetime map.

**F-6. `image-set()` defeats the CSS network sanitizer.**
[`realm-sandbox.ts:2936-2943`](../packages/host/app/services/realm-sandbox.ts#L2936)
claims "Network-bearing CSS is denied so a card cannot turn url() or @import
into an exfiltration channel". Verified bypass:

```
in : .a{background-image:image-set("https://evil.example/x.png" 1x)}
out: .a{background-image:image-set("https://evil.example/x.png" 1x)}
```

`-webkit-image-set`, `cross-fade()`, and `element()` are equally outside the
blacklist. The docs already classify this as P1; the contribution here is a
working bypass string, which upgrades it from "regexes are fragile" to
"the stated claim is false today". Do not extend the blacklist — this is the
architecture item in the existing review's section G.

**F-7. Fresh iframe render envelopes can irrecoverably kill the MessageChannel.**
`iframeRenderFor` builds a new `RealmIframeSandboxRender` literal on every call
([`:931-1016`](../packages/host/app/services/realm-sandbox.ts#L931)) — unlike
`renderFor`, which memoizes a `StableRealmSandboxRender`
([`:868-897`](../packages/host/app/services/realm-sandbox.ts#L868)). Its tracked
inputs include the draft fields, so each keystroke mints a new envelope. If the
`connectFrame` function modifier
([`realm-sandbox-iframe.gts:55-61`](../packages/host/app/components/realm-sandbox-iframe.gts#L55),
which consumes `this.args.sandbox.codePreviewID` during setup) re-runs on that
identity change, its destructor closes `port1`
([`:143-150`](../packages/host/app/components/realm-sandbox-iframe.gts#L143))
and the new setup can never reconnect: `connect()` fires only on the iframe
`load` event (already fired) or the child's one-shot `listening` bootstrap.

**Status: plausible, not confirmed.** The passing acceptance test does _not_
refute it. The iframe branch of `[HMR-01]` asserts
`data-card-sandbox-draft-revision`
([`realm-sandbox-iframe.gts:213`](../packages/host/app/components/realm-sandbox-iframe.gts#L213)),
which is `@sandbox.draft.revision` — a parent-side value that increments whether
or not the child ever receives it — and iframe element identity. It never
asserts `data-card-sandbox-applied-draft-revision`
([`:214`](../packages/host/app/components/realm-sandbox-iframe.gts#L214)), the
child-confirmed value, nor any child DOM content. Changing that one assertion
settles the question either way; see §7.

### P2

**F-8. Trusted-realm and base-realm trust is un-anchored prefix matching.**
`trustedRealmForModule` uses `module.startsWith(realmURL)` over
`config.trustedCardRealmURLs`
([`realm-sandbox.ts:619-638`](../packages/host/app/services/realm-sandbox.ts#L619)),
and `isBaseRealmModule` uses `startsWith(ENV.resolvedBaseRealmURL)`
([`realm-sandbox-import-policy.ts:14`](../packages/host/app/lib/realm-sandbox-import-policy.ts#L14)),
whose value is passed through verbatim by
[`config/environment.js:180-181`](../packages/host/config/environment.js#L180) —
unlike `trustedCardRealmURLs`, which _is_ trailing-slash normalized at `:175-179`.
Deployed without a trailing slash, a realm at `https://host/base-tenant/` is
treated as Base: `shouldUseOpaqueCard` returns false and `delegateBaseModules`
delegates its modules into the app-wide `baseLoader`. This is the handoff's
"canonical module identity vs user-controlled URL resemblance" question, and the
answer today is resemblance.

**F-9. Execution principal is taken from server-supplied instance metadata.**
`principalFor` ([`:3023-3032`](../packages/host/app/services/realm-sandbox.ts#L3023))
returns `resource.meta.realmURL` when present, falling back to the module's own
directory. The registry keys runtimes purely on that string
([`realm-sandbox-runtime-registry.ts:28-35`](../packages/host/app/lib/realm-sandbox-runtime-registry.ts#L28)).
A hostile realm the user reads from can claim another realm's `realmURL` and
have its modules evaluated inside that principal's compartment, sharing its
Loader cache and module state. Derive the principal from the module's resolved
URL, which is already in scope. (Note the fallback has a different granularity —
module _directory_, not realm root — so the two paths do not agree on how
coarse a principal is.)

**F-10. `componentCodeRef` is silently ignored for opaque cards.**
[`card-api.gts:4724-4740`](../packages/base/card-api.gts#L4724) and the host
mirror [`realm-sandbox.ts:494-510`](../packages/host/app/services/realm-sandbox.ts#L494)
return the delegated component before consulting `opts`. `CardRenderer` passes a
codeRef at [`card-renderer.gts:187`](../packages/host/app/components/card-renderer.gts#L187),
and the iframe path _does_ honour it
([`realm-sandbox.ts:987-996`](../packages/host/app/services/realm-sandbox.ts#L987)) —
so an ancestor-template render request is honoured for iframe cards and silently
falls back to the card's own default component for SES cards. Either thread the
ref through the delegated path or throw; do not silently render the wrong thing.

**F-11. Patch persistence failure is silent.**
[`patch-code.ts:144-160,196-210`](../packages/host/app/tools/patch-code.ts#L144):
on `saveSource` rejection the only handling is `volatileCommit?.failed()` plus
`console.error`. `markCommitFailed`
([`code-preview-sandbox.ts:390-411`](../packages/host/app/lib/code-preview-sandbox.ts#L390))
sets `generationState.phase = 'failed'`, but `generationState` has no UI
consumer, and it never sets `moduleError` — the field `code-submode.gts:355-357`
surfaces into the Fix-with-AI display. The volatile generation is not rolled
back, so the preview keeps showing unsaved content with no signal.

**F-12. Silent stale-value persistence at the serialization boundary.**
[`realm-sandbox-boundary.ts:114-128`](../packages/host/app/lib/realm-sandbox-boundary.ts#L114):
`serializeOpaqueRealmCard` catches a `structuredClone` failure per attribute and
"preserves the last serializable value". A non-cloneable field value therefore
saves the _old_ value silently rather than erroring.

**F-13. Targeted invalidation misses cross-realm importers.**
[`loader-service.ts:352-368`](../packages/host/app/services/loader-service.ts#L352):
non-base modules invalidate `this.loader` plus realm loaders whose key is a
string prefix of the resolved URL. A trusted-realm loader that imported a module
from a _different_ realm or directory is never invalidated and keeps the old
evaluation. (The converse — that invalidation never reaches `baseLoader` — is
correct and is what `[LDR-01]` asserts.)

**F-14. External HMR overwrites an unsaved local draft.**
[`realm-sandbox.ts:1601-1615`](../packages/host/app/services/realm-sandbox.ts#L1601)
gates only on "is this module displayed"; `publishExternalModuleSource`
([`:1703-1719`](../packages/host/app/services/realm-sandbox.ts#L1703)) calls
`preview.update(...)` on every matching active preview, including a Code-mode
sandbox holding unsaved Monaco text. The in-flight guard protects against stale
_server_ responses only.

**F-15. `writeTask` saves to `this._url` read at execution time.**
[`file.ts:701-724`](../packages/host/app/resources/file.ts#L701) uses
`new URL(this._url)` while the staged `state.url` is available. The branch's
switch from `restartableTask` to `enqueueTask` materially widens the
stage→execute window, so a queued write can land on the _next_ file's URL after
navigation. Pre-existing shape; newly reachable.

**F-16. No epoch guard on invalidation vs. in-flight fetch.**
`Loader.invalidateModule` deletes map entries
([`loader.ts:613-619`](../packages/runtime-common/loader.ts#L613)) with no
generation counter, while writers write back unconditionally from pre-`await`
locals ([`:1261-1263`](../packages/runtime-common/loader.ts#L1261),
[`:889-893`](../packages/runtime-common/loader.ts#L889)). A fetch in flight when
the invalidation arrives re-registers the pre-edit source under the same key,
where it stays for the loader's lifetime.

**F-17. Unbounded app-lifetime caches.** Bounded by construction: analysis LRU
64, theme LRU 128, commit registry 250 FIFO, module-eval history 30, runtime
registry ref-count + 60s TTL. Unbounded or effectively so:
`VolatileModuleRegistry.latestPublished`
([`code-preview-sandbox.ts:100,150-154`](../packages/host/app/lib/code-preview-sandbox.ts#L100),
retains full source per module forever); the `opaqueCardTypes` family (F-5);
`compartmentTemplates`/`compartmentTemplateRevisions`, whose key embeds
`${sandbox.id}:${sandbox.revision}`
([`realm-sandbox.ts:2273-2278`](../packages/host/app/services/realm-sandbox.ts#L2273))
— a new key per keystroke, with only the immediately previous key reclaimed and
only on a successful render; `pendingCodePreviewTemplates`, a strong Map keyed
by component class; `metrics.compartmentErrors`, keyed by error message text
embedding module URLs; `realmLoaders`; and `trustedExports`
([`realm-compartment-module-runtime.ts:150`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L150)),
which grows one token per property name the sandbox reads off a facade Proxy —
a sandbox-controlled key space.

### P3

- **F-18.** `isCodePreviewCommitAcknowledgement` is documented as "a read-only
  query" ([`:1877-1880`](../packages/host/app/services/realm-sandbox.ts#L1877))
  but mutates sandbox state and metrics, and is called by five independent
  subscribers. Transitions are idempotent, so this inflates metrics rather than
  corrupting state.
- **F-19.** Quiet period expiring mid-edit: after 90s of no keystroke,
  `prepareVolatileModuleCommit` bails
  ([`:1815-1818`](../packages/host/app/services/realm-sandbox.ts#L1815)), so a
  save taken after a pause gets no commit or acknowledgement and falls through
  to the full invalidation path — exactly the visible reload the feature exists
  to prevent.
- **F-20.** Cyclic modules can lose a reverse edge in the invalidation closure:
  `evaluate` derives `consumedModules` by dropping `'completing-dep'`
  ([`loader.ts:1285-1289`](../packages/runtime-common/loader.ts#L1285)) while
  admitting recursive entry in `registered-completing-deps`
  ([`:1317-1323`](../packages/runtime-common/loader.ts#L1317)).
- **F-21.** Hidden LRU format slots stay live: the inactive slot is `hidden` and
  `inert` ([`card-renderer.gts:106-116`](../packages/host/app/components/card-renderer.gts#L106))
  but its Glimmer subtree remains mounted and its sandbox getters re-evaluate
  into the compartment on every revision bump. The architecture doc's "without
  allowing hidden formats to run card effects" is not quite what the code does.
- **F-22.** Unrelated change in the diff: the GPT-5.6 Luna fallback model
  ([`matrix-constants.ts`](../packages/runtime-common/matrix-constants.ts) plus
  two test files) has nothing to do with sandboxing.
- **F-23.** `file-tree-query-cache.ts:29-33` claimed "realm index events refresh
  the cached value in the background" without naming the event owner. The
  service intentionally has no subscription: `FileTreeFromIndex` owns the
  filtered Realm subscription and calls `search.perform(true)`, which delegates
  to `queryCache.load(..., { force: true })`. The service comment now states
  this contract explicitly.
- **F-24.** Partially-built Glimmer trees leak if `iterator.sync()` throws
  mid-transaction ([`isolated-render.gts:176-206`](../packages/host/app/lib/isolated-render.gts#L176))
  — never registered in `activeRenders`, so never destroyed. Leak, not
  double-free.

## 3. Rubric classification

| #         | Finding                                       | P   | Class                                               |
| --------- | --------------------------------------------- | --- | --------------------------------------------------- |
| F-1       | Traversal specifier escapes to trusted loader | P0  | **Fix now**                                         |
| F-2       | Broker fetch is an authenticated open proxy   | P0  | **Fix now** (allowlist) + follow-up for full policy |
| F-3       | Card code can capture a broker port           | P0  | **Architecture proposal** (handshake binding)       |
| F-4       | Ack swallows whole realm event                | P1  | **Fix now**                                         |
| F-5       | Opaque type metadata never invalidated        | P1  | **Fix now**                                         |
| F-6       | `image-set()` defeats CSS sanitizer           | P1  | **Fixed** (decoded preflight + CSSOM policy)        |
| F-7       | Iframe envelope identity kills the channel    | P1  | **Fix now** (memoize) — confirm first               |
| F-8       | Un-anchored trusted-realm prefixes            | P2  | **Fix now**                                         |
| F-9       | Principal from instance metadata              | P2  | **Fix now**                                         |
| F-10      | `componentCodeRef` silently ignored           | P2  | **Change supported behavior** (or thread it)        |
| F-11      | Silent patch persistence failure              | P2  | **Fix now**                                         |
| F-12      | Silent stale-value persistence                | P2  | **Fix now**                                         |
| F-13      | Cross-realm importers not invalidated         | P2  | **Follow-up**                                       |
| F-14      | External HMR clobbers unsaved draft           | P2  | **Change supported behavior** (decide precedence)   |
| F-15      | `writeTask` URL race                          | P2  | **Fix now**                                         |
| F-16      | No epoch guard vs in-flight fetch             | P2  | **Architecture proposal** (generation counter)      |
| F-17      | Unbounded caches                              | P2  | **Fixed** (bounds, eviction, 4,096-realm soak)      |
| F-18–F-24 | see above                                     | P3  | **Follow-up**                                       |

Production gates that must hold regardless: the hosted-iframe gate (F-2, F-3)
and the remaining CSS paint/layout-containment gate, both stated in the
follow-up plan. F-6's selector/network/global-rule escape is closed.

## 4. Proposed commit series

The handoff's dependency order is right. Two changes to it:

1. **Explicit boundary contracts and trusted-loader immunity** — Loader
   evaluator/invalidation APIs, boundary symbols, materialization purpose,
   source/import/URL policies, opaque records. **Add F-1, F-8, and F-9 here**:
   the trust decision must be resolve-then-check before anything else builds on
   it, and this commit is where the policy modules live.
2. **SES runtime and stable render slots** — compartment runtime, principal
   registry, delegated rendering, template/style registries, CardRenderer
   integration. Add F-5 and F-10.
3. **Iframe renderer** — typed protocol, frame route, parent renderer, fetch and
   height capabilities. **Add F-2 and F-7**; land F-3 either here or as an
   immediately-following hardening commit, but do not merge the tier's
   enablement without it.
4. **Code-preview volatility and HMR** — generations, acknowledgement,
   last-known-good, analysis/source caches, format LRU, Reload Card. Add F-4 and
   F-11.
5. **Navigation and authoring UX parity** — file/recent-file navigation,
   file-tree cache, new-file and broken-source recovery, AI patch flow. Add
   F-15.
6. **Compatibility migrations and acceptance matrix** — remaining `getComponent`
   migrations plus focused tests. Keep the audit documents with the behavior
   they explain.
7. **Staging-backed local preview infrastructure (separate PR)** — README,
   `config/staging.env`, `scripts/vite-serve*.js`, `vite.config.mjs`,
   `scripts/start-host.sh`.

**Drop from every sandbox commit:**

- `docs/realm-program-tool-spec.md` (untracked, unrelated — already excluded);
- the GPT-5.6 Luna fallback model change (F-22) — `matrix-constants.ts`,
  `packages/runtime-common/tests/fallback-models-test.ts`,
  `packages/realm-server/tests/fallback-models-test.ts`;
- `docs/realm-isolation-ses-spike.md` — it names files removed from this branch;
  either mark it archival or leave it on the spike branch.

**Correct the size claim.** The consolidation plan states 141 files and ~16,595
insertions. The checkpoint is now:

```
$ git diff main...6cbbf8174d --shortstat
 170 files changed, 21402 insertions(+), 929 deletions(-)
```

Roughly 4,700 of those insertions are the nine `docs/` files, and 18 new test
files are added. The prose should match the artifact before review starts.

## 5. Compatibility implications for existing user-authored cards

Card source does not need to change for the common cases, and the branch earns
that claim: fields, templates, nested rendering, and Markdown embeds all work
through the new boundary without author-visible edits. The real implications:

- **Arbitrary DOM modifiers are gone from the SES tier.** A card using a
  third-party DOM modifier, canvas, or WebGL must classify into the iframe tier,
  and that tier is only available for `isolated`, `embedded`, and `edit`
  ([`realm-sandbox-source-policy.ts:22,32-44`](../packages/host/app/lib/realm-sandbox-source-policy.ts#L22)).
  The same card's `fitted`, `atom`, `head`, and `markdown` surfaces stay in SES
  and fail closed. Authors of DOM-heavy cards must keep those compact formats
  DOM-free.
- **Unscoped `<style>` is no longer supported in SES.** Template capture rejects
  any surviving literal style
  ([`realm-compartment-module-runtime.ts:700-704`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L700)).
  Migration is `<style scoped>`, which is mechanical.
- **Non-JSON values cannot cross the boundary.** Component state, action
  arguments, and getter results all pass through `jsonClone`
  ([`:885-897`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L885)).
  A card storing a `Map`, `Set`, `Date`, or class instance in component state
  will throw at the boundary rather than degrade. This deserves an explicit
  release note; it is the most likely source of "my card used to work".
- **Undocumented static properties stop being host-visible.** Only the fields in
  `SandboxCardTypeMetadata` cross. A card relying on a custom static needs a
  reviewed descriptor field.
- **Field metadata only crosses for trusted field types.** `cardAPIFacade`'s
  `field` decorator records metadata only when the field's card is a
  trusted-export token
  ([`:613-626`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L613)).
  A field whose type is another _user-realm_ card records no metadata, so it is
  absent from `fields` and from `fieldsFor`. Worth confirming against a
  realistic multi-card realm before merge — it is the compatibility risk most
  likely to be under-tested.
- **Editing a card's schema needs a page reload to take effect** until F-5 is
  fixed.

## 6. Security claims

**Safe to make:**

- User-realm card modules execute in a per-principal SES compartment with no
  ambient `window`, `document`, `localStorage`, `fetch`, or `XMLHttpRequest`
  (the compartment self-reports this at
  [`:202-210`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L202)).
- Interactive host state receives inert card records, not executable
  constructors; host UI renders and inspects schema without the user class.
- Data crossing the compartment boundary is JSON-cloneable only; a template
  scope cannot carry an ungranted executable value
  ([`:858-883`](../packages/host/app/lib/realm-compartment-module-runtime.ts#L858)).
- Sandbox tier is chosen by host policy from source classification and render
  format. **No URL query parameter selects a weaker sandbox** — verified by
  grepping `queryParams`, `searchParams`, `sandbox=`, `tier`; the only
  sandbox-related params are the frame route's own bootstrap state
  ([`routes/realm-sandbox-frame.ts:22-30`](../packages/host/app/routes/realm-sandbox-frame.ts#L22)),
  and `format` is funnelled through a three-value allowlist.
- Targeted invalidation is a transitive consumer closure iterated to fixpoint
  ([`loader.ts:594-611`](../packages/runtime-common/loader.ts#L594)), and a user
  module's invalidation never reaches `baseLoader`.
- A late acknowledgement cannot roll a newer draft backward: every generation
  transition is guarded by draft _object identity_
  ([`code-preview-sandbox.ts:340-411`](../packages/host/app/lib/code-preview-sandbox.ts#L340)).
- The iframe tier is fail-closed in a hosted deployment absent explicit
  configuration.
- Trusted imports are accepted only after canonical URL resolution and
  path-segment containment in an explicitly trusted realm; traversal-shaped
  package and URL imports fail closed.
- The iframe broker does not provide ambient authenticated fetch. Realm-auth
  reads must belong to the declared module graph; public reads are
  credentialless.

**Must be avoided:**

- Any claim that hostile CSS cannot visually escape its card box. Selector,
  network, and document-global effects are now structurally rejected, but
  fixed positioning and oversized paint effects still need a host-owned
  containment policy that preserves format layout.
- Any claim of hosted-iframe security or dedicated-origin isolation. The
  broker is narrow now; localhost working is still not the hosted-origin claim.
- Any claim of CPU/memory/availability isolation. Main-thread SES cannot
  terminate a loop.
- Any claim that server indexing/prerender is isolated. It still executes real
  definitions in the trusted realm-server process.

## 7. Three highest-value missing tests

1. **A traversal-specifier import must fail closed.** A card importing
   `@cardstack/base/../<user-realm>/evil.gts` (and the
   `https://cardstack.com/base/../...` spelling) and referencing it in its
   template must not cause the host loader to evaluate that module. This is the
   regression test for F-1 and the single highest-value test in the list.
2. **The iframe HMR test must assert child-confirmed application, not
   parent-published intent.** `[HMR-01]`'s iframe branch currently waits on
   `data-card-sandbox-draft-revision` (parent-side). Waiting on
   `data-card-sandbox-applied-draft-revision`, or asserting the child document's
   rendered text changed, would both settle F-7 and close the gap that lets a
   dead-channel bug pass as green.
3. **A schema edit during Code-mode HMR.** Every current HMR test edits template
   text only. Adding a `@field`, changing `displayName`, or adding an `edit`
   template and asserting the schema, field list, and format routing update is
   the direct regression test for F-5 — and it is the edit authors make most
   often.

Runners-up worth queueing: a route-level SES/iframe retainer snapshot after the
new 4,096-principal service soak; and a mixed displayed/non-displayed
invalidation event asserting that the
_non-acknowledged_ modules in the same event are still invalidated (F-4).

## 8. Recommendation

**Proceed with consolidation, with F-1 fixed inside commit 1 of the series.**

The boundary's shape is right and the diligence behind it is unusually good —
the existing-test audit, the acceptance matrix, and the honesty about what is
unfinished are all better than typical for work of this size. The escape in F-1
is not evidence that the design is wrong; it is evidence that a policy decision
was made on a string instead of on a resolved identity, in four places, and it
is fixable in a focused commit. Do not revise the boundary and do not redesign.

Sequence before requesting human review:

1. Fix F-1 with its regression test; then F-8 and F-9, which are the same class
   of error.
2. Confirm or refute F-7 by changing the one assertion in §7.2.
3. Fix F-4, F-5, F-11, F-12, F-15.
4. Rebuild the history into the seven commits in §4 and drop the files listed
   there.
5. Push and run full Host CI; triage with `pnpm ci:failures --branch <branch>
--workflow "CI Host"`. The branch is not currently pushed, so no CI evidence
   exists for this checkpoint.
6. Keep F-2 and F-3 as named production gates. The iframe tier must stay
   disabled outside the supported local/test environment, and the staging
   launcher's same-server sandbox origin should be called out as a development
   convenience, not an isolation claim. Keep visual CSS paint containment as a
   separate explicit follow-up; the shared-document selector/network boundary
   itself now fails closed.

## Appendix: verification performed

```
git diff main...6cbbf8174d --check                      # clean
cd packages/runtime-common && pnpm lint                 # exit 0
cd packages/realm-server  && pnpm lint                  # exit 0
cd packages/host          && pnpm lint                  # exit 1 — ten documented
                                                        # baseline errors only:
                                                        # 7 Array.at, 3 AI call-signature
pnpm exec ember test --path dist --filter "sandbox live reload"
                                                        # 6/6 pass
```

No `.only` or `.skip` was introduced (`git diff main...HEAD -- 'packages/*/tests/*'`
grepped for both). The only removed assertion in a retained test is
`patch-code-test`'s single-save check, replaced by a stronger
two-saves-for-two-blocks assertion, matching the audit's account.

### Correction to the handoff's "Known State"

The handoff states that the pre-commit hook's parser errors in four Base and
four experiments-realm files are "real checkpoint defects that must be diagnosed
before the review branch is pushed." **They are pre-existing tooling
misconfiguration, not defects in this checkpoint, and they do not block the
push.**

```
$ cd packages/base
$ git show main:packages/base/cards-grid.gts | pnpm exec eslint --stdin --stdin-filename cards-grid.gts
  56:2  error  Parsing error: Unexpected token. A constructor, method, accessor, or property was expected
```

The same file on `main` fails identically; the branch's line number is 57 only
because the delegated-render migration adds one import line. Neither
`packages/base` nor `packages/experiments-realm` has a package-level ESLint
config, so `.gts` falls through to the root config's `@typescript-eslint/parser`
with no `ember-eslint-parser` override — which `packages/host`
(`.eslintrc.js:95-96`) and `packages/catalog` (`.eslintrc.cjs:40-41`) both have.
Every error lands on the first in-class `<template>`, never on a migration hunk;
an untouched file (`packages/base/field-component.gts`) fails the same way; and
all eight parse cleanly under `ember-eslint-parser`. CI has never caught this
because neither package has an eslint lint script, and `lint-staged` is the only
thing that passes explicit `.gts` paths.

Fix (out of scope for the sandbox series, worth its own small PR): add a
package-level `.eslintrc.cjs` to both packages with a `**/*.gts` override using
`ember-eslint-parser`, mirroring `packages/catalog`.
