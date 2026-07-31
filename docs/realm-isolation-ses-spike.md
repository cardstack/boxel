# Realm-isolated cards with SES

This spike demonstrates five real Boxel cards across two realms running side by
side in one browser without sharing authority. The parent realm contains one
`ArticleCard`. The child realm contains `VideoCard`, `RecipeCard` (including Ask
AI), `CommentCard`, and an intentionally hostile `SecurityProbeCard`. The
parent delegates the three editorial slots without giving child code access to
the parent's private state; the probe can also be opened independently in the
ordinary Interact UI.

The preview is available locally at:

<http://localhost:4200/_realm-isolation-spike>

## The key idea

SES is only one layer of the boundary. The important architectural decision is
that card-authored JavaScript does not execute in the Ember page's global
environment.

For the current compatibility checkpoint, each active realm security principal
gets:

1. One Endo SES `Compartment` on the host application's main thread.
2. One evaluated-module cache owned by that compartment.
3. Card-instance capability handles chosen by the host.
4. No direct `window`, `document`, `localStorage`, Matrix session, realm
   credentials, or API key.

The trusted Ember host keeps authentication, network access, storage, and DOM
ownership. A card returns plain, serializable render data; the host projects
that data into the shared DOM using trusted Ember templates.

```text
Card module in per-realm SES Compartment
        |
        | serialized template descriptor / capability request
        v
Trusted Ember host capability membrane
        |
        +--> authenticated realm read/write
        +--> realm-scoped query
        +--> allowlisted command
        +--> optional AI proxy
        |
        v
Realm server / Matrix / external service proxy
```

Two cards may therefore share a DOM visually without sharing a JavaScript
global or browser ambient authority. The default compatibility tier still uses
a main-thread SES compartment. Worker execution remains available for commands
and non-DOM programs, adding a separate browser global and a termination
boundary without pretending that a worker can own Ember's DOM.

DOM-heavy cards use a different renderer tier. A host-owned static source
classifier delegates the ordinary `CardRenderer` operation to a separately
originated, sandboxed iframe when imports or executable source require a real
document, canvas, WebGL, Three.js, media, or imperative browser APIs. The card
and its `FieldDef` do not know about the iframe or `MessageChannel`; they receive
the same arguments and use the same templates as an ordinary render.

The tier is not a query parameter or card declaration. `cardSandboxTier` was
removed from public route/controller state, so changing a URL cannot raise or
lower a card's authority. Base/Catalog/configured trust still comes from host
configuration. User source is classified by the host after GTS template bodies
are masked and ESM imports are parsed with `es-module-lexer`. Known browser
renderer families (including Three.js, Babylon, Cesium, Mapbox, Pixi, and p5)
and executable references to DOM/browser globals select the iframe; ordinary
GTS stays in the per-principal SES compartment. Comments, strings, and template
copy cannot trigger the broader renderer. Malformed streaming drafts keep the
previous classification and last good render.

## Iframe DOM renderer tier

The iframe is a `CardRenderer` transport variant, not a card-specific wrapper:

```text
parent CardRenderer(card, field, codeRef, format)
  -> separate-origin sandboxed iframe
  -> serialized current-card bootstrap + native MessageChannel capability port
  -> parent-authenticated, read-only card/module fetch broker
  -> renderer-local Loader + unchanged card deserialization
  -> child CardRenderer(card, field, codeRef, format)
  -> authored Ember template + DOM/WebGL behavior
```

The parent never transfers its Store, Loader, Matrix token, API keys, live card
instance, DOM node, or Ember owner. The child receives only the already-loaded
JSON:API document for the card it is rendering, avoiding a duplicate card read;
older hot-reloaded records without that bootstrap fall back to fetching the
document in parallel with Base API loading. Module HTTP GETs still travel over
the private port. Boxel realm module reads use the parent's authenticated fetch
path and the realm server's read permissions, including explicitly imported
cross-realm modules. Public external dependencies remain credentialless.
Mutation, query, command, and AI authority remain separate named capabilities
rather than being smuggled through fetch.

The child does not immediately paint transport copy. “Loading sandboxed card”
appears only after three seconds and errors remain immediate. This avoids a
loading-message flash for normal and cached renders while retaining feedback
for genuinely slow module graphs. In the live Three.js SignMaker check, the
message was not shown before the iframe reached its ready state.

The same transport handles nested `FieldDef` rendering: the host sends only the
field name and optional resolved component reference, and the child resolves
that field from its locally deserialized card before invoking `CardRenderer`.

Intrinsic size is also explicit. A renderer-owned height service observes the
child render root, document, font readiness, mutations, and resizes, coalesces
measurements after Ember render, and sends changed width/height values over the
port. The parent clamps and applies the iframe height. Card and field code never
receives a resize callback or a reference to the parent document.

The current proof uses the unchanged Tribeca SignMaker card, including its
Three.js canvas, OrbitControls, `three-bvh-csg`, JSZip, STL export, and 3MF
export. The browser decides actual renderer-process placement; the security
contract is the separate origin, iframe sandbox flags, credentialless child,
and capability-only connection—not a promise about a particular OS process.

## Web Worker command tier

The worker tier is selected by the host for command/non-DOM execution, not by a
URL and not for an Ember card render. It changes where the SES compartment and
evaluated module cache live:

```text
unchanged realm GTS source
  -> authenticated host module-fetch broker
  -> per-realm Web Worker
  -> SES Compartment + evaluated module Loader
  -> inert template descriptor + JSON presentation state
  -> trusted Ember template reconstruction and DOM rendering
```

The worker has no `window`, `document`, `localStorage`, native `fetch`, or
`XMLHttpRequest`. Module requests are RPC messages to the host. The host applies
the same authenticated Boxel-realm response and declaring-realm checks used by
the main-thread compartment before returning source text. Safe Base, Catalog,
Boxel UI, icon, Ember helper, and runtime-common imports are passed into the
worker as an explicit import policy and reconstructed as inert facades.

Glimmer cannot synchronously await a worker RPC while reading a component
getter. The first worker implementation therefore evaluates model-dependent
presentation getters in the worker before rendering and replaces them with
JSON state in the returned descriptor. That supports static and derived
presentation from an unchanged card snapshot. Stateful actions, tracked
updates, modifiers, tasks, and event-driven getter recomputation remain
fail-closed until the async action/render protocol is explicit.

The hidden `data-card-sandbox-diagnostics` element reports
`data-card-sandbox-tier="worker"` and the active worker-compartment count, so a
test can prove which evaluator produced the card rather than inferring it from
the URL or visual output.

## Production compatibility invariant

The production target does **not** require realm authors to rewrite existing
card definitions or templates. The existing GTS card API is the compatibility
surface. Changes belong in the card compiler/runtime and the host renderer:

1. The loader fetches ordinary realm modules but does not evaluate untrusted
   module code in the host JavaScript realm.
2. A sandbox compilation target separates the card's executable program from
   its template and emits a constrained, serializable render program.
3. The executable program, including module initialization, computed fields,
   getters, helpers, and actions, is evaluated in an SES compartment.
4. The trusted host interprets render operations and owns the real DOM. DOM
   nodes, Ember owners, services, credentials, and host closures never become
   card endowments.
5. Existing template syntax is adapted by the runtime. Unsupported syntax is a
   runtime compatibility defect to implement or diagnose, not a required
   source migration for the card author.

The SES shared-DOM tier remains iframe-free. The iframe tier is an intentional
compatibility boundary for cards whose existing behavior fundamentally needs a
document or WebGL context. Shadow DOM may still be useful for style scoping,
but it is not treated as an authority boundary.

## Compartment and loader topology

The host now separates official Base code from realm-authored module caches.
`LoaderService.baseLoader` is one ordinary trusted Loader for the whole
application session and owns every Base module, including the canonical
`CardDef` and `FieldDef` class identities. The host's general-purpose loader
and every ordinary trusted-realm loader delegate Base imports to that shared
loader instead of evaluating Base again.

An explicitly reviewed realm may opt out of SES by appearing in the
comma-separated `TRUSTED_CARD_REALM_URLS` host configuration. It still does
not enter the host or Base loader: all card types and instances from that
realm share one ordinary loader keyed by realm URL. Catalog uses the same
trusted-realm-loader path. Loader trust never comes from a card URL query
parameter.

```text
Application session
  +-- shared Base Loader
  |     +-- Base card API, fields, templates (evaluated once)
  +-- trusted realm A Loader
  |     +-- realm A modules
  |     +-- delegated references to shared Base exports
  +-- trusted realm B Loader
  |     +-- realm B modules
  |     +-- delegated references to shared Base exports
  +-- untrusted realm C SES/worker/iframe loader
        +-- realm C modules under its selected boundary
```

Delegated module namespaces retain the identity of their source loader.
Borrowing `BaseDef` into a realm loader therefore does not change
`Loader.getLoaderFor(BaseDef)` and cannot create a second, subtly incompatible
Base class graph. Session and code-cache resets dispose the Base, host, and
trusted-realm loader graphs together.

The sandbox runtime should use the following layers:

```text
Host-wide immutable compile cache (keyed by source/content hash)
        |
        +-- Realm principal A SES compartment + module loader/cache
        |       +-- Card type X evaluated once
        |       |       +-- instance X/1
        |       |       +-- instance X/2
        |       +-- Card type Y evaluated once
        |
        +-- Realm principal B SES compartment + module loader/cache
                +-- Card type X evaluated independently
                        +-- instance X/3
```

The default lifecycle is **one compartment and one evaluated module loader per
active realm security principal**, not one loader per card and not one loader
per card type. A principal key includes at least:

- authenticated session identity;
- owning realm URL;
- permission/capability policy version;
- module graph generation or invalidation epoch.

All card types in that principal reuse the loader's module cache. A card type
is evaluated once and may have many instance handles. Different realms never
share evaluated module state, even when they load the same card type. Immutable
transpilation artifacts may be shared by content hash because they contain no
live objects or authority.

Capabilities are bound to a card instance or invocation, not installed as a
compartment-global ambient `fetch`. This prevents a card without the AI grant from
borrowing a more privileged sibling's capability merely because both cards
share a realm compartment. If two cards in the same realm truly have
incompatible principal-level policies, the principal key places them in
separate sandbox loaders.

The runtime should expose counters so loader growth and cache behavior are
observable in development and tests:

- active realm-principal compartments and evaluated loaders;
- active card instances per loader;
- evaluated card types and modules per loader;
- compile-cache hits and misses;
- module invalidations and compartment replacements;
- denied cross-realm imports and capability calls;

Idle realm compartments can be LRU-evicted once they have no mounted card
instances. Code changes invalidate only affected principal loaders and
dependent module graphs; session changes revoke and destroy every loader
belonging to the old session.

### Code mode preview loaders

Code mode is deliberately more isolated than Interact mode. Every mounted
Code preview owns a private sandbox runtime and evaluated module loader. It
does not reuse the realm-principal loader used by Interact, another Code
preview, or a second editor window. Closing the preview destroys that loader
and its live module graph.

Monaco reports user-authored changes synchronously from its model-change event.
The initial buffer and programmatic file switches publish in Glimmer's
`afterRender` queue so they cannot mutate tracked preview state during the
render transaction. This path is separate from the existing debounced realm
write, so typing updates the preview without waiting for autosave or changing
what another browser session reads. The preview loader serves the current
buffer only for its exact module URL, invalidates that module and its already
known dependents, and retains unrelated dependencies in cache. Intermediate
revisions are skipped when evaluation falls behind the editor. A syntax error
keeps the last valid template visible and the next valid revision retries the
same graph.

The same authoring contract applies to both renderer transports:

```text
Monaco model change (immediate)
        |
        +-- SES/DOM preview
        |     +-- private Code-preview Loader
        |     +-- invalidate edited module + dependents
        |     +-- reconstruct trusted render template
        |
        +-- iframe/DOM+WebGL preview
              +-- MessageChannel draft revision
              +-- private detached Loader in child document
              +-- parent-brokered exact-buffer fetch
              +-- invalidate edited module + dependents

Monaco autosave (debounced) -> ordinary realm write
```

For the iframe tier, deserialization must receive the detached loader
explicitly. Allowing `createFromSerialized` to discover Base's default loader
would silently bypass the MessageChannel fetch broker, defeating both draft
invalidation and the separate-origin authority boundary. The iframe remains a
CardRenderer implementation detail; unchanged cards and fields do not know
about the transport.

The diagnostics surface reports `activeCodePreviewLoaders` plus the draft and
applied iframe revision. This makes loader lifetime and hot-reload lag directly
testable instead of inferred from a query parameter or visual output.

## Actual card topology

The editorial page is backed by real card definitions, instances, and
relationships—not one synthetic record containing several pretend modules:

```text
Parent realm
└── ArticleCard
    ├── linksTo VideoCard ──────┐
    ├── linksTo RecipeCard ─────┼── Child realm
    └── linksTo CommentCard ────┘

Child realm
└── SecurityProbeCard (standalone Interact-mode adversarial test)
```

`ArticleCard` owns the story fields and its editorial isolated template.
`VideoCard`, `RecipeCard`, and `CommentCard` each own their data and beautiful
embedded/isolated templates. Ask AI belongs to `RecipeCard`. The separate
`SecurityProbeCard` is intentionally not linked into the article; it exercises
the same child-to-parent realm boundary in a normal Interact stack item.

The existing two staging realms are migrated in place. The previous primary
record URL is retained and its type is upgraded to `ArticleCard` in the parent
and `CommentCard` in the child; this avoids leaving an extra synthetic card in
either realm. The video, recipe, and security-probe instances are added to the
child realm.

## Ordinary Interact-mode security probe

The staging probe is available through the normal application route:

<http://localhost:4200/ctse/ses-isolation-ms7jy87e-child/security-probe>

It is a real card source and card instance in the reused child realm. The
shared `CardRenderer` recognizes its sandbox profile and mounts the trusted
sandbox projection inside the normal Interact stack item—there is no special
route and no iframe. Clicking the red **Scrape all data & send it** button runs
the hostile program in the realm's SES worker. The program:

- enumerates its compartment globals;
- reads its own serialized card snapshot;
- attempts to read the parent `ArticleCard`;
- constructs a payload containing everything it found;
- attempts to POST that payload to `https://attacker.invalid/collect`.

The own-card read succeeds. `window`, `document`, and `localStorage` are absent.
The parent read fails the realm-path check. The POST is routed through the
fetch-shaped capability and fails the exact AI-proxy allowlist before a network
request is created. The card then turns red and renders the attempted payload
and each allow/deny decision.

The probe's persisted JSON now follows the same opaque Store deserialization
path as other non-base realm cards, so its schema/type module is not imported
into the host. Its adversarial program still uses the older worker harness;
ordinary card templates use the main-thread per-principal compartment described
below.

## Authoritative existing-card experiment

On this branch the sandbox is always active for ordinary non-base realm cards;
there is no query-parameter escape hatch. `cardSandbox=ses` is accepted as an
inert legacy URL parameter, but it no longer changes behavior.

The Base and Catalog Realms are explicit trust roots. Base definitions use the
single app-wide Base Loader; Catalog definitions use the Catalog realm's
ordinary trusted-realm Loader, which delegates Base imports to that shared Base
graph. Neither has an SES boundary. A user-authored realm card remains
sandboxed unless its realm is explicitly configured as trusted, but may import
Base and Catalog field modules through hardened compartment facades. Other card
types are deserialized as opaque records and evaluated inside their owning
realm-principal compartment.

The sandbox import policy is centralized separately from host trust. Boxel
Icons and Boxel UI are sandbox-safe presentation imports, but they do not make a
user-authored card type host-trusted. Ember template plumbing remains an
explicit, narrow shim. Bare package imports outside that policy fail closed.

Realm module imports are permission-based rather than restricted to the
principal's owning realm. Relative imports in the same realm and absolute
imports from another realm use the current user's authenticated fetch path.
Every successful module response must identify its owning realm with
`X-Boxel-Realm-URL`, and the returned module URL must remain inside that
declared realm. The realm server's 401/403 response is the authorization
decision; the compartment cannot bypass it or make an ambient fetch. This lets
a card reuse modules from any realm the user can read without merging the two
realms' evaluated state or credentials.

For example:

<http://localhost:4200/ctse/ses-isolation-ms7jy87e-child/VideoCard/field-notes>

This path requires no changes to the card source. For a compatible view it:

1. fetches card JSON without importing the realm's `adoptsFrom` module;
2. creates a host-owned opaque `CardDef` record containing only cloned JSON
   attributes, relationship URLs, identity, and the resolved type reference;
3. fetches the same compiled, extensionless realm module representation used
   by the normal Loader;
4. recursively loads the card's authorized module graph with Boxel's cycle- and
   cache-aware Loader, while evaluating every untrusted module registration and
   initialization only in the realm principal's SES `Compartment`;
5. removes the ordinary Loader's `import.meta.loader` authority before module
   code enters the compartment;
6. captures the compiled GTS wire-format template, its lexical component/helper
   scope, scoped styles, and the JSON-shaped component state contract;
7. recreates root and child templates on host-owned inert component classes;
8. evaluates user component getters in the compartment with JSON-only args and
   returns JSON-only values to the inert host component;
9. decodes compiled `.glimmer-scoped.css` imports as inert data, removes
   network-bearing `@import` and `url()` values, and mounts the sanitized scoped
   CSS from the trusted host renderer;
10. projects allowlisted card-type presentation metadata (`displayName`,
    `headerColor`, `icon`, `prefersWideFormat`, and custom-template flags) onto
    the host-owned opaque type without transferring executable card objects;
11. resolves `cardInfo.theme` with the user's authenticated realm access and
    mounts its sanitized CSS variables through the trusted `CardContainer`
    (using included card data first, then the indexed card endpoint, then the
    realm-source JSON when a stale indexed Theme card returns an error);
12. supplies the opaque plain-data snapshot and trusted primitive/list field
    renderers instead of a live realm-authored card instance; and
13. caches opaque host types, evaluated modules, field renderers, themes, and inert
    templates by their appropriate realm/type/instance keys.

Non-serializable values are omitted from the snapshot and counted. An
unsupported template fails closed on the opaque card's trusted base template;
the realm-authored component is never instantiated as a fallback. Hidden
`[data-card-sandbox-diagnostics]` elements expose aggregate counters for render
requests, sandboxed cards, fallbacks and reasons, omitted fields, active realm
principals, template-cache hits/misses, and clone/snapshot timing.

The focused Store test verifies that deserializing an ordinary realm card leaves
its type module absent from the host Loader. This is now an authoritative
read/render slice, not a shadow evaluation after host execution.

The staging-backed `software-layer-matrix` workspace is the current realistic
acceptance case. Its unchanged card imports a same-realm `PublicationNav`
component, Boxel UI's `eq` helper, a Boxel icon, and Base fields. Its isolated
component initializes a 590-item data structure and computes several getters.
The normal Interact route renders through one compartment with no sandbox
errors:

<http://localhost:4200/ctse/software-layer-matrix/index>

### Compatibility tunnel audit

The A/B acceptance rule is that an unchanged card produces the same trusted
host presentation while the local route still reports a sandbox render. The
`DropLabProposal` comparison currently matches the ordinary staging route at a
1,240 px wide layout, with the same theme scope, CSS variables, display name,
and authored content. The local route reports one sandbox render; staging
reports none.

The audit found these host/card-runtime dependencies:

| Surface                                                        | Boundary representation                                                                                                   | Current status                                                                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `displayName`                                                  | bounded string                                                                                                            | tunneled                                                                                                                                                                    |
| `prefersWideFormat`                                            | boolean                                                                                                                   | tunneled                                                                                                                                                                    |
| `headerColor`                                                  | bounded, network-free CSS color string                                                                                    | tunneled                                                                                                                                                                    |
| `icon`                                                         | trusted `{ module, export }` identity, resolved by host                                                                   | tunneled for allowlisted Base/Catalog/Boxel presentation modules                                                                                                            |
| `hasCustomEditTemplate`, `hasCustomIsolatedTemplate`           | booleans derived inside the compartment                                                                                   | tunneled                                                                                                                                                                    |
| `cardInfo.theme.cssVariables`                                  | authenticated relationship read, sanitized CSS text, host-computed scope                                                  | tunneled                                                                                                                                                                    |
| `cardInfo.theme.cssImports`                                    | explicit allowlisted URL descriptors                                                                                      | not yet granted; arbitrary CSS imports are an outbound network capability                                                                                                   |
| host-owned format wrapper                                      | trusted `CardContainer` classes and CSS for fitted, embedded, atom, edit, and isolated formats                            | tunneled, including fitted width/height limits and overflow, fitted/embedded container queries, atom display semantics, and the default edit background                     |
| root card tracking                                             | trusted `cardComponentModifier` installed on the sandbox `CardContainer` with inert card id/format/field metadata         | tunneled; selection, overlay targeting, and card-element tracking do not require the realm card object                                                                      |
| `@context.searchResultsComponent`                              | trusted host component consuming the existing scoped search providers                                                     | tunneled without exposing Store/getCard functions to compartment JS                                                                                                         |
| `@context.cardComponentModifier`                               | trusted presentation modifier from the surrounding operator context                                                       | tunneled for card selection/opening overlays                                                                                                                                |
| `@context.markdownEmbedChooser`                                | trusted operator UI capability                                                                                            | tunneled for Base edit/markdown UI                                                                                                                                          |
| `@cardstack/runtime-common`                                    | explicit pure-function facade (`codeRef`, `searchEntryWireQueryFromQuery`) plus inert `realmURL` identity                 | tunneled; the package namespace is not exposed wholesale                                                                                                                    |
| authored component actions and modifiers                       | action handles plus allowlisted host modifiers that return JSON only                                                      | actions and `safeModifier` implemented; `observe-size`, `focus`, and `scroll-into-view` never expose an Element; arbitrary `ember-modifier` code selects the iframe         |
| `viewCard`                                                     | host capability handle accepting realm-relative targets only, resolved and checked against the current principal          | implemented for same-realm navigation; absolute URLs, schemes, and parent traversal fail closed                                                                             |
| `createCard`, `editCard`, `saveCard`, and `set`                | host capability handles checked against the current principal and card                                                    | not yet implemented (`set` is currently a no-op)                                                                                                                            |
| `linksTo` / `linksToMany` values                               | permission-checked opaque relationship projections; trusted host hydration re-enters `CardRenderer` for card/file targets | implemented for relationship fields whose declared target resolves to a trusted Base/Catalog type; same-realm target-type metadata still needs an inert code-ref descriptor |
| `contains` fields backed by trusted Base/Catalog field types   | inert `{ kind, module, export }` field descriptor; host resolves the trusted type and honors an explicit child `@format`  | implemented for `contains` and `containsMany`, including `MarkdownField.embedded` delegation                                                                                |
| computed card fields and instance methods                      | explicit compartment reads/invocations returning JSON                                                                     | component getters work; card getters and methods do not yet                                                                                                                 |
| card menu extensions                                           | declarative menu descriptors plus compartment action handles                                                              | not yet implemented; executable `getMenuItems` methods cannot cross the boundary                                                                                            |
| trusted Base default isolated/edit templates                   | host-selected trusted template with opaque model and field adapters                                                       | implemented; edit currently renders the standard template over the opaque projection, while mutation still requires a scoped `set` capability                               |
| nested card rendering requested from trusted Base components   | host hydration/render capability that re-enters `CardRenderer` for the opaque child                                       | implemented for the relationship field bridge                                                                                                                               |
| `@model.constructor` presentation access in authored templates | non-enumerable inert `{ displayName, icon }` descriptor on the host projection                                            | implemented without exposing an executable class; omitted from JSON args sent into the compartment                                                                          |

The authored-template constructor dependency is now narrowed to an inert,
non-enumerable descriptor containing only `displayName` and a trusted resolved
`icon`. The executable opaque `CardDef` class is not exposed through
`@model.constructor`, and the descriptor is omitted when args are JSON-cloned
back into the compartment for getter evaluation.

### Implicit API source audit

The compatibility table is backed by a source scan, not only the current demo
cards. On 2026-07-30 the local `stack.cards/ctse` corpus contained 583 `.gts`
files. The following counts are files containing at least one use; generated
copies and experiments are intentionally included because they represent the
unchanged cards the runtime is expected to tolerate.

| Implicit dependency               |   Files | Boundary implication                                                                              |
| --------------------------------- | ------: | ------------------------------------------------------------------------------------------------- |
| `static prefersWideFormat`        |     125 | inert type metadata; implemented                                                                  |
| `static headerColor`              |       6 | bounded CSS value; implemented                                                                    |
| custom `[getMenuItems]`           |       5 | declarative menu items plus revocable action handles; missing                                     |
| `@context.searchResultsComponent` |      11 | trusted host rendering component over a scoped query; implemented                                 |
| `@context.cardComponentModifier`  |       3 | trusted host modifier over inert ids; implemented in both authored templates and the root wrapper |
| `@context.store`                  |       6 | realm-scoped read capability; raw Store must not cross                                            |
| `@context.getCard`                |       3 | reactive, permission-checked read handle; missing                                                 |
| `commandContext`                  |      18 | command construction/execution capability; missing                                                |
| `{{on ...}}`                      |     105 | persistent component instance plus compartment action handle; missing                             |
| `@tracked`                        |      94 | state must remain in the compartment and notify a host render subscription; missing               |
| `@action`                         |      33 | method identity/binding plus compartment invocation; missing                                      |
| `restartableTask(...)`            |      17 | cancellable async task scheduling and state projection; missing                                   |
| direct `window` / `document`      | 29 / 37 | intentionally denied; replace legitimate lifecycle/measurement uses with trusted modifiers        |
| direct `fetch(...)`               |      26 | intentionally denied; replace with destination- and operation-scoped fetch/command capabilities   |
| `localStorage` / `sessionStorage` |   7 / 1 | intentionally denied; replace legitimate persistence with realm/card-scoped storage capabilities  |

The ordinary `BaseDefComponent` invocation is itself an API surface. The host
normally supplies all of these named arguments:

```text
cardOrField, model, fields, format, set, fieldName, context,
configuration, createCard, viewCard, saveCard, editCard,
canEdit, typeConstraint
```

The sandbox currently supplies `cardOrField`, an opaque `model`, field
adapters, `format`, a no-op `set`, a presentation-only `context`, and a
same-realm `viewCard`. `configuration`, `createCard`, `saveCard`, `editCard`,
real `canEdit`, `typeConstraint`, and a mutation-capable `set` still need
explicit descriptors or capability handles. This explains why a default edit
template can render but is not yet writable.

The module graph is another compatibility surface. The corpus imports trusted
Base definitions and Boxel presentation modules heavily, but also imports
`@glimmer/tracking`, `@ember/object`, `@ember/template`, `ember-modifier`,
`ember-concurrency`, `tracked-built-ins`, Lodash, and host commands/tools. The
current sandbox deliberately does not pass those packages through wholesale.
Each must be classified as one of:

1. an inert/pure facade;
2. a trusted host presentation identity used only by the reconstructed
   template;
3. a compartment-owned state/runtime implementation; or
4. a revocable host capability with explicit authority.

Passing the host package namespace or a live Ember object is never the
compatibility fallback.

#### Skill-derived import contract

The detailed findings and upstream distillation checklist live in
[`realm-sandbox-skill-import-audit.md`](realm-sandbox-skill-import-audit.md).

The shipped card-authoring skills are the closest thing Boxel currently has to
a public runtime import manifest. In particular,
`boxel-patterns/references/libraries.md` explicitly says which imports are
available to authored `.gts` files, and the curated pattern examples show which
ones are used in practice. A scan of the 53 checked-in `example.gts` files
produced these file counts:

| Import family                            | Example files | Sandbox interpretation                                                                                      |
| ---------------------------------------- | ------------: | ----------------------------------------------------------------------------------------------------------- |
| `https://cardstack.com/base/*`           |            48 | trusted Base schema/presentation identity; imported without granting the host loader or live Base instances |
| `@cardstack/boxel-ui/*`                  |            18 | trusted host presentation identities reconstructed into template scope                                      |
| `@cardstack/boxel-icons/*`               |             7 | trusted inert presentation identities                                                                       |
| `@cardstack/runtime-common*`             |            14 | export-by-export facade; never the complete namespace                                                       |
| `@cardstack/boxel-host/tools/*`          |            12 | revocable command capability required; raw command classes are not granted                                  |
| `@glimmer/component`                     |             6 | compartment-owned component base; implemented                                                               |
| `@glimmer/tracking`                      |            15 | compartment-owned state plus host rerender notification; missing                                            |
| `@ember/helper`                          |             7 | trusted template identities; documented `array`, `concat`, `fn`, `get`, and `hash` are implemented          |
| `@ember/modifier`                        |            18 | trusted `on` identity is available, but useful handlers still require action handles                        |
| `@ember/object`                          |             9 | compartment-owned `action` binding; missing                                                                 |
| `ember-modifier`                         |             6 | declarative host lifecycle/DOM adapter required; a realm callback must never receive the shared DOM node    |
| `ember-concurrency`                      |             6 | compartment task scheduler, cancellation, state projection, and rerender protocol required                  |
| `ember-resources`                        |             1 | compartment resource lifecycle protocol required                                                            |
| `https://esm.run/*` / `https://esm.sh/*` |             5 | denied today; require a pinned/vetted module service rather than arbitrary browser fetch                    |

The skill catalogue also teaches direct browser globals such as `AudioContext`,
`document`, and modifier callbacks that receive elements. Those examples
describe the unsandboxed runtime and are not evidence that the compartment
should gain browser authority. Their legitimate behaviors need explicit audio,
measurement, canvas, or lifecycle capabilities.

The exact safe `@cardstack/runtime-common` facade is now
`baseRRI`, `codeRef`, `getMenuItems`, `realmURL`, and
`searchEntryWireQueryFromQuery`. All five are pure data transforms or inert
symbols. `getMenuItems` lets a card module define the standard symbol
without yet granting its returned closures to the host; menu extraction still
needs declarative items and revocable action handles. APIs taught by the skills
such as `getCard`, `getCards`, `getField`, `Command`, and planning/install
helpers remain outside the facade until their authority and return values have
boundary protocols.

The scrub also found a stale skill API: several menu examples imported
`getCardMenuItems` and `GetCardMenuItemParams`, while the current runtime
exports `getMenuItems` and Base exports `GetMenuItemParams` from
`base/menu-items`. The checked-in plugin skill tree is generated from the
pinned `boxel-skills` repository, so that correction belongs in the upstream
skill source rather than this branch's generated copy. This is why the skill
corpus is evidence for the intended API, but must still be checked against
source exports before it becomes an allowlist.

Local and cross-realm relative imports stay on the ordinary module graph. They
are readable only when the authenticated fetch succeeds and the response
identifies a valid Boxel realm. Being readable does not upgrade a dependency
to host authority: user-authored code from either realm executes under the
importing realm principal's compartment, while trusted Base/Catalog and
presentation packages are represented by the explicit facades above.

The next compatibility implementation order follows the observed frequency
and authority risk:

1. persistent compartment component instances, action handles, and rerender
   notifications (`{{on}}`, `@tracked`, `@action`);
2. realm-scoped read/query handles (`getCard`, `getCards`, `getCardCollection`,
   and the card-facing Store subset);
3. permission-derived `canEdit` plus field-path `set` and save/edit/create
   capabilities;
4. command/tool handles and declarative menu extensions;
5. lifecycle/measurement modifiers and vetted pure-library facades; and
6. opt-in public CSS imports and other explicit outbound network surfaces.

`interaction-lab/InteractionLab/lab` is the current representative fail-closed
case for the first item. Its trusted Base fallback renders, while diagnostics
report that `ember-modifier` is not an allowed realm module. Even if that
import were admitted, the card also needs compartment-owned tracked state,
method/action handles, and a lifecycle modifier before its authored interaction
benches can honestly be considered compatible. The import error is therefore
the first visible missing contract, not the whole contract.

The rule behind the table is consistent: primitives and inert descriptors may
cross from the compartment; components may cross only by trusted import
identity; actions and data access cross only as host-owned capability handles.
No realm-authored function, class, Ember owner, service, or live card instance
is copied into the host.

Compatibility is still incomplete and fails closed. Authored actions,
mutation/edit persistence, same-realm relationship type descriptors, and
package imports beyond the current safe facades do not yet receive host
authority and may render the trusted fallback rather than the authored UI.
Each feature must be expressed as an explicit compartment operation or host
capability before it can work again; there is no security fallback to
evaluating the realm module in the host.

The `software-periodic-workspace/PeriodicTable/home` acceptance card exercises
an especially important transition: 165 indexed fitted cards begin as inert
prerendered HTML and hydrate to live sandboxed cards on interaction. The parity
check compares both sides of that transition. Theme scope, semantic CSS
variables, scoped component CSS, format, fitted container-query setup, and
host context must remain identical; a difference in any one of them is a
runtime boundary defect, not a card-source defect.

## SES setup and the legacy worker harness

The ordinary-card compatibility path described above runs its compartment on
the main thread and does not construct a Web Worker. It imports `ses`, locks
down the shared intrinsics, and creates a compartment endowed only with the
decorator runtime needed by compiled card modules. Card API, Ember template,
and primitive field imports are deny-by-default facades. Other imports fail
unless the runtime explicitly grants them.

The older dedicated security-probe harness still uses a worker. It is retained
as a separate demonstration of CPU/message isolation, not as a requirement or
dependency of the ordinary-card path.

The worker imports `ses` and calls `lockdown()` before evaluating card code. It
then creates a `Compartment` whose globals contain only hardened endowments:

- `capabilities`, containing the host operations available to every card.
- A proxy-shaped `fetch`, but only when that card was explicitly granted AI
  proxy access.

The compartment evaluates the realm program and exposes named actions such as
`initialize`, `increment`, `saveNote`, and `renderDelegated`. Calls and results
cross the worker boundary using `postMessage`.

Because the host does not endow browser globals, the spike confirms that
`window`, `document`, and `localStorage` are `undefined`. The usual
`Function(...)` escape does not reach the page global after SES lockdown.

The focused host test additionally verifies that `fetch` and `XMLHttpRequest`
are absent, a second render hits the compartment module cache, and an import
from an ungranted realm is rejected.

## Realm-scoped data access

Card code cannot call authenticated network APIs directly. It asks the host to
perform an operation such as:

- `read-own-card`
- `write-own-card`
- `read-card`
- `query-own`
- `run-own-command`
- `proxy-fetch`

Every operation is handled against the card's immutable realm configuration.
For reads and writes, the host verifies that the target has the same origin and
is under the requesting realm's URL path. A sibling realm URL is rejected
before an authenticated request is made.

Queries are also created by the trusted host and restricted to the requesting
realm. The server's realm permissions remain the authoritative security
boundary; these client checks prevent one compromised card from borrowing the
host's broader in-browser authority.

Writes are narrower than general realm access in this spike. The edit form may
only submit:

```json
{ "note": "up to 500 characters" }
```

Attempts to change `role`, `counter`, `privateValue`, or add another property
are rejected by the host. The default edit template reflects this contract:
protected fields are read-only and only the note field is editable.

The increment button does not let the card execute an arbitrary command name.
The host accepts only the known `increment` command and applies it to that
card's own resource.

## Rendering in a shared DOM

The card program owns its display description: title, subtitle, fields,
actions, editor metadata, and optional AI UI metadata. This description is
hardened, returned across the worker boundary, and rendered by the trusted
Ember host.

The security demonstration is deliberately not arbitrary HTML or direct native
GTS execution. The host controls the elements and event wiring, and Ember
escapes field values. That keeps DOM authority out of the untrusted compartment
while still letting each card decide what content and actions its view
contains.

The original editorial harness still uses its explicit render-model program for
the adversarial demonstration. The newer ordinary-card path now evaluates an
unchanged realm GTS module in the SES runtime and reconstructs its captured
template in trusted Ember. In the worker tier, model-derived getters are
materialized to JSON before reconstruction. This is broader than the original
harness, but it is not yet the complete interactive render protocol: actions,
tracked state, modifiers, tasks, and DOM-dependent behavior still need named
asynchronous adapters.

Each card has an independent View/Edit toggle:

- **View** renders the card-produced display model.
- **Edit** uses a trusted, host-generated default edit template based on the
  card snapshot and the allowed write contract.

An action click invokes the corresponding named function in that card's worker.
The card may request a capability during the action, and the returned render
model refreshes only that card's host projection.

## AI proxy capability

Only the child card receives a `fetch` endowment. It is not the browser's real
`fetch`; it is a hardened facade that sends a `proxy-fetch` capability request
to the host.

The host then enforces all of the following:

- The card was granted AI proxy access.
- The URL exactly matches the configured OpenRouter chat-completions endpoint.
- The method is `POST`.
- The message roles and text are valid and bounded.
- At most eight messages are forwarded.
- The model, streaming setting, and token limit are fixed by trusted code.

The actual API key is never placed in the worker, compartment, render model, or
DOM. The authenticated host/server proxy performs the external request. A card
without the grant sees `typeof fetch === "undefined"`.

### Recipe context and bounded content command

Ask AI does not receive a live card object. Before an AI request, the child
worker calls a dedicated `readRecipe` capability. The host binds that capability
to the one configured `RecipeCard` URL and returns a frozen projection containing
only the recipe's editorial fields, ingredients, and steps. The current recipe
projection is included in the AI prompt, so answers and proposed substitutions
are grounded in persisted card data.

The model may return a complete proposed recipe, but it cannot write the card
itself. The reader must click **Apply full recipe update**, which invokes the
named `update-recipe-content` command. The host accepts that command only from
the child realm configuration and targets only the configured recipe URL. Its
schema permits exactly six editorial fields: `title`, `description`, `serves`,
`time`, `ingredients`, and `steps`. It rejects extra properties and bounds the
text, ingredient count, and step count before writing. This lets a serving-size
request update both the displayed yield and proportionally scaled ingredients.
The image, card type, relationships, and all unrelated state remain outside the
command's authority. The command then updates the real `RecipeCard` source and
returns a fresh read-only projection.

This separation keeps AI generation and mutation distinct:

```text
readRecipe capability → AI proposal → explicit user approval
  → update-recipe-content command → validated RecipeCard write
```

## Parent-to-child render delegation

Delegation is explicit data passing across the worker/host membrane:

1. The parent worker returns a request naming the child renderer and a props
   object.
2. The host validates the props against an allowlist.
3. Only `message` and `parentCounter` may cross the boundary.
4. The host invokes `renderDelegated` in the child worker with the sanitized
   props.
5. The child returns a serializable render model for the parent-owned slot.

If the parent attempts to pass `privateValue`, `note`, or any unknown property,
the host rejects the delegation. The child does not receive a parent object,
closure, DOM node, capability, or callback, so it has no path for inspecting
the rest of the parent's state.

## Hostile comment mode

The embedded comment module can switch between a normal reader experience and
a hostile-card simulation. Hostile mode does not display a fabricated result:
the child program enumerates its actual SES globals, reads its own card, records
the props delegated by the parent, attempts to read the parent card, and tries
to send its data to an arbitrary external URL.

The red evidence panel shows everything the attempt can observe. The child can
see its own realm data, its safe delegated props, hardened JavaScript
intrinsics, and its allowlisted AI proxy facade. It sees no DOM globals,
credentials, or API key. The host rejects both the parent-realm read and the
arbitrary network destination. Normal-mode comment submission is persisted in
the child card's own realm and survives worker and page reloads.

## What the spike proves

- Two cards from different realms can render in one page without sharing
  browser ambient authority.
- Each card can read, query, write, and run a command within its own realm.
- A cross-realm card read is denied even though the authenticated host can see
  both cards.
- Capabilities can differ per card; only one card receives the AI proxy.
- The API key does not need to enter card-controlled JavaScript.
- A parent can delegate rendering to a child using explicit, sanitized data.
- The child cannot inspect undelegated parent state.

## What still needs production hardening

This is an architectural spike, not yet a complete untrusted-code runtime.
Production work should add:

- Runtime schemas and size limits for every message and render-model result.
- Execution time, memory, message-rate, and recursion budgets, with worker
  termination on violation.
- Production provenance, invalidation, and integrity policy for ordinary GTS
  module graphs, including explicit resolution for non-URL realm aliases.
- Capability manifests tied to realm/card identity and server-issued
  permissions.
- Revocation and lifecycle handling when a card, realm permission, or session
  changes.
- Audit logs for denied capability calls and delegated-render attempts.
- Tests against malicious getters, oversized structured-clone payloads,
  prototype edge cases, confused-deputy attempts, and compromised card source.
- A compatibility matrix and implementation coverage for the constrained
  render protocol. Existing templates must be translated to safe
  components/primitives by the runtime; directly granting DOM access would
  undo the isolation shown here.

The core rule should remain: **card code receives capabilities, never ambient
credentials or ambient host authority**.

## Code-mode instant reload

Code-mode preview does not need Vite's file watcher, WebSocket protocol, or an
`@vite/client` inside card code. Realm source is already an in-memory stream
from Monaco, not a filesystem event. The useful Vite HMR mechanics are instead
implemented at the card-loader boundary:

- Every mounted code preview owns a `CodePreviewSandbox` revision stream.
- A Monaco buffer change publishes immediately, before the existing debounced
  realm write.
- Editable code-mode previews always use one dedicated iframe. The child keeps
  its document, `MessageChannel`, and detached loader mounted, invalidates the
  affected graph, and renders only the newest revision. Ordinary Interact-mode
  cards still use the realm SES compartment unless their runtime requirements
  select the iframe tier.
- Updates are serialized and stale revisions are ignored. A compile failure
  reports against the draft while the last good card/template stays mounted.
- Base-realm source remains trusted and read-only, so it does not participate
  in editable per-preview reload.

This follows the load-bearing shape in Vite's module graph and HMR runtime
(`moduleGraph.ts`, `hmr.ts`, `client.ts`, and `evaluatedModules.ts`) without
copying its transport. The comparison was made against the local Vite checkout
at `/Users/chris/Projects/vite`, not from remembered behavior.

The explicit acceptance boundary is therefore:

```text
Monaco keystroke
  -> revisioned open-file buffer
  -> one private CodePreviewSandbox
  -> iframe MessageChannel invalidation
  -> last-good-render swap
  -> debounced/policy-checked realm persistence
```

## Hosted iframe origin requirement

The current iframe renderer is operational on localhost only. The runtime is
not hard-coded to localhost—it accepts `REALM_SANDBOX_IFRAME_ORIGIN`—but a
hosted deployment must provision and route that origin before enabling the
iframe tier.

The renderer must use a separate **site**, not merely another subdomain of the
host application. Use these terms consistently in the target architecture:

- **SES card runtime**: realm-scoped card and FieldDef behavior;
- **iframe renderer**: approved external DOM, canvas, WebGL, media, chart, or
  diagram implementations;
- **command worker**: process-isolated command execution with no DOM.

The current compatibility spike can execute a whole card inside its iframe.
That is not the intended final responsibility split: authored card and field
behavior should remain in the realm SES runtime, and CardRenderer should
delegate only the approved renderer operation without exposing the iframe or
MessageChannel API to authored code.

The strongest production shape combines an opaque iframe origin with a fresh,
cryptographically random hostname for every renderer lifetime:

```text
Host UI:          https://app.boxel.ai
Bootstrap URL:    https://<128-bit-random>.renderer.boxelusercontent.com/v1/bootstrap.html
Iframe origin:    opaque (omit `allow-same-origin` from the sandbox attribute)

Staging host UI:  https://boxel-host-staging.stack.cards
Bootstrap URL:    https://<128-bit-random>.renderer.boxelusercontent.dev/v1/bootstrap.html
Iframe origin:    opaque (omit `allow-same-origin` from the sandbox attribute)
```

If operating a separate staging registrable domain is impractical, use
`<random>.renderer-staging.boxelusercontent.com`, while preserving the same
cookie-free edge policy. Wildcard DNS and certificates for
`*.renderer.boxelusercontent.com` and `*.renderer.boxelusercontent.dev` make
per-instance origins operationally manageable.

Do not use `sandbox.boxel.ai` for the production boundary. A sibling subdomain
is cross-origin, but it is still same-site for cookies and other browser
policies. A separate registrable domain prevents host site cookies from being
ambiently attached to renderer requests.

An opaque-origin frame can still load a normal document and run DOM-dependent
libraries such as Three.js. The host transfers a fresh `MessagePort` after
checking `event.source`; the child checks the exact parent origin. The one
bootstrap `window.postMessage` handshake may need `targetOrigin: '*'` because
an opaque origin serializes as `null`, but the nonce and source-window check
must bind that handshake to the newly created iframe. All authority-bearing
messages then travel only over the private port.

Generate the hostname in trusted host code. Do not derive it from or expose a
realm name, user ID, card ID, or sequential number, and do not allow card
source or a URL parameter to select it. Do not reuse the hostname after its
iframe is destroyed. The unique hostname is defense in depth for opaque frames
and becomes an essential origin-storage boundary if a reviewed dependency
truly requires `allow-same-origin`:

```text
https://<128-bit-random>.renderer.boxelusercontent.com/v1/bootstrap.html
```

Distinct instance origins isolate DOM access, localStorage, IndexedDB, service
workers, and other origin-scoped state between renderer instances. They remain
same-site when they share `boxelusercontent.com`, so the renderer
infrastructure must still prohibit parent-domain cookies rather than relying
only on origin separation.

The current spike still uses `allow-same-origin` with one configured renderer
origin. `credentialless` prevents ambient credentials from entering the frame,
but that alone is not the final cross-realm origin boundary. Before enabling
the iframe tier in a hosted environment, replace the single configured origin
with a trusted per-instance origin allocator and prefer opaque origins.

The hosted renderer origin must:

- serve only the sandbox bootstrap and static assets, never the privileged
  host application or authenticated realm endpoints;
- set no authentication cookies and reject any unexpected cookies;
- have its edge strip incoming `Cookie` and outgoing `Set-Cookie` headers and
  never vary cached bootstrap responses by cookies;
- receive realm reads, writes, commands, and AI access only through the
  validated `MessageChannel` capability broker;
- use a restrictive CSP (`default-src 'none'`) with narrowly enumerated script,
  style, image, font, and connect sources required by the selected tier;
- deny direct CORS access from the opaque serialized origin `null`; realm and
  asset access must go through the host capability broker;
- validate the exact parent origin during bootstrap; reserve `*`, if required
  by an opaque-origin handshake, for transferring the nonce-bound private port
  and never use it for authority-bearing capability messages;
- give each channel a random one-time session ID, protocol version, monotonic
  message sequence, payload-size limit, and update-rate limit;
- retain iframe `sandbox` restrictions and add permissions through a minimal
  `allow` policy only when a card capability explicitly requires them;
- keep credentials and private card data out of renderer query strings,
  fragments, and paths;
- close the MessagePort, revoke capabilities, and retire the instance hostname
  when the rendered card or field is destroyed;
- be protected from DNS takeover and never share deploy credentials or storage
  with the host origin.

The host CSP must restrict `frame-src` to the environment's renderer wildcard.
The renderer response must restrict `frame-ancestors` to the exact production
or staging Boxel host and deny direct networking with `connect-src 'none'` by
default. Cards may select an approved renderer identifier such as `three`; they
must never select an arbitrary script or asset URL.

### Hosted renderer rollout plan

1. Provision separate renderer DNS, certificates, edge configuration, and
   deployment credentials for production and staging.
2. Replace `REALM_SANDBOX_IFRAME_ORIGIN`'s single-origin behavior with a trusted
   per-instance origin allocator using 128 bits of cryptographic randomness.
3. Publish only a versioned, integrity-pinned renderer bootstrap; do not serve
   the host app, realm APIs, redirects, arbitrary uploaded HTML, or login flows
   from the renderer site.
4. Remove `allow-same-origin` by default and update the bootstrap handshake for
   an opaque child: bind the initial port transfer to `event.source`, a fresh
   nonce, and the exact expected parent origin.
5. Define schemas and limits for renderer initialization, updates, asset reads,
   resize events, and teardown. Transfer data, never host objects, callbacks,
   credentials, stores, or DOM nodes.
6. Route every renderer read or privileged operation through the host's
   capability broker and realm authorization checks; keep renderer
   `connect-src` denied.
7. Add browser acceptance coverage proving two simultaneous renderer instances
   cannot observe each other's DOM, storage, channels, realm data, or network
   authority, including when `allow-same-origin` is enabled for an explicitly
   reviewed renderer.

Local development uses `https://localhost:4200` for the host and
`https://127.0.0.1:4200` for the renderer. The mkcert leaf covers both names;
the two loopback origins reach one Vite process without Docker.

## Local staging sign-in invariant

The development certificate and the data environment are independent. Trusting
the local CA makes `https://localhost:4200` a secure browser context; it does
not select staging Matrix or staging realms.

When launching the host through mise, environment ordering matters. This form
is wrong because `mise exec` can re-inject the local development service URLs
after `staging.env` was sourced:

```sh
source packages/host/config/staging.env
mise exec -- pnpm -C packages/host start
```

Use the checked-in host command, which applies staging after mise, clears
Docker/Traefik environment mode, and prints the selected endpoints:

```sh
mise exec -- pnpm -C packages/host start:staging
```

The misleading symptom is a normal-looking Boxel sign-in form followed by
“Sign in failed.” The decisive diagnostic is the Matrix login destination: a
request to `http://localhost:8008/_matrix/client/v3/login` means the host is
still configured for local Synapse; staging must use
`https://matrix-staging.stack.cards`. The generated
`@cardstack/host/config/environment` meta tag is a quick way to verify
`matrixURL` and `realmServerURL` before testing credentials.

## Relevant implementation files

- `packages/host/app/components/realm-sandbox-iframe.gts` — parent-side
  delegated renderer, sandbox attributes, MessageChannel lifecycle, fetch
  broker, and intrinsic-height application.
- `packages/host/app/templates/realm-sandbox-frame.gts` — credentialless child
  renderer shell, port-backed Loader, unchanged card/FieldDef deserialization,
  and nested `CardRenderer` invocation.
- `packages/host/app/lib/realm-iframe-sandbox-protocol.ts` — typed bootstrap,
  read-only fetch, ready, and resize messages.
- `packages/host/app/lib/realm-iframe-height-service.ts` — renderer-owned
  intrinsic sizing across Ember renders, DOM mutations, fonts, and resizes.
- `packages/host/workers/realm-isolation-spike.ts` — worker startup, SES
  lockdown, compartment endowments, and message RPC.
- `packages/host/workers/realm-compartment-module-runtime.ts` — ordinary card
  module evaluation inside a worker-hosted SES compartment.
- `packages/host/app/lib/realm-worker-compartment-module-runtime.ts` — host-side
  worker lifecycle, RPC calls, and authenticated module-fetch broker.
- `packages/host/app/lib/realm-worker-compartment-protocol.ts` — the
  serializable worker call, result, and module-response protocol.
- `packages/host/app/lib/realm-isolation-spike.ts` — realm guards, request
  sanitizers, card/program source, and shared types.
- `packages/host/app/templates/realm-isolation-spike.gts` — worker
  orchestration, trusted capability handlers, rendering, and default edit UI.
- `packages/host/tests/unit/realm-isolation-spike-test.ts` — focused boundary
  and sanitizer tests.
