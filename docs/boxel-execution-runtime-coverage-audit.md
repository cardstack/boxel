# Boxel execution runtime coverage audit

This audit is the broad inventory and migration ledger. The companion
[execution runtime composition suite](boxel-execution-runtime-composition-suite.md)
is the smaller deterministic CI graph: twelve cumulative use cases covering
ordinary fields and queries through rich composition, media, Surface
capabilities, and mixed Direct/Capsule/Sandbox execution.
The
[real-example audit](boxel-execution-runtime-real-example-audit.md) checks that
single suite against fifty Boxel Labs and realm examples, including the full
foundation Surface vocabulary and asynchronous AI production.

## Purpose

This is the migration checklist for replacing the current realm-sandbox POC
with the execution runtime described in
[Boxel execution runtime architecture](boxel-execution-runtime-architecture.md).
The architecture may replace the internals, but it may not silently reduce the
set of cards, fields, formats, interactions, or UI behavior that the POC has
already exercised.

This document answers four different questions that must not be collapsed:

1. Which authored and implicit Boxel APIs do current cards use?
2. Which of those APIs have a boundary representation in the POC?
3. Which behaviors have deterministic automated proof, rather than only a
   successful manual comparison?
4. Which multi-boundary execution graphs must the new architecture preserve?

The detailed author-facing API semantics remain canonical in the
[card API compatibility ledger](realm-sandbox-card-api-compatibility.md). The
[surface capability design](realm-sandbox-surface-capabilities.md) remains the
canonical proposal for the `surface*` family. This audit is the cross-product:
it maps those APIs to actual cards, tests, execution owners, graph paths, and
completion gates.

## Evidence vocabulary

Every row uses one of these evidence levels:

| Level                  | Meaning                                                                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Exact automated**    | A deterministic test constructs the same API shape and asserts the relevant render, effect, or protocol result.    |
| **Contract automated** | A lower-level or smaller fixture proves the individual contract, but not the full corpus card or nested graph.     |
| **Manual parity**      | The same Realm document was compared in staging and the sandbox Host and recorded in `COMPARISON-OBSERVATIONS.md`. |
| **Fixture only**       | A representative card exists, but no current automated or recorded manual result proves the claimed behavior.      |
| **Design only**        | The API is proposed and has no implementation proof.                                                               |

A capability is **not migration-complete** until it has exact automated proof
in Direct and every applicable confined runtime. Pairwise proof is also not
enough for a compositional API: it needs at least one graph test in which it is
nested behind another card or field boundary.

## Audited sources

This audit is based on the current `codex/code-preview-instant-reload` branch
and these concrete sources:

- the 40 synthetic cards and five real-card probes in
  `/Users/chris/boxel-workspaces/sandbox-compatibility-corpus-20260803`;
- `Acceptance | code submode | sandbox live reload`;
- `Integration | preview` and `Integration | realm sandbox iframe`;
- the realm-compartment, boundary, source-policy, import-policy, iframe
  protocol, media, Store-boundary, style, HMR, and lifecycle unit suites;
- Boxel Base's `card-api.gts`, `field-support.ts`, default templates, Rich
  Markdown implementation, and `CardContext`;
- the existing skill and real-workspace import audit in
  [realm-sandbox-skill-import-audit.md](realm-sandbox-skill-import-audit.md).

The synthetic corpus currently imports these major runtime families:

| Import family                                  | Current corpus use |
| ---------------------------------------------- | -----------------: |
| `@cardstack/base/card-api`                     |           43 files |
| `@cardstack/base/string`                       |           39 files |
| `@cardstack/base/number`                       |           19 files |
| `@ember/modifier`                              |           14 files |
| `@glimmer/tracking`                            |           11 files |
| `@ember/helper`                                |            8 files |
| `@cardstack/boxel-ui/helpers`                  |            5 files |
| `@cardstack/base/boolean`                      |            5 files |
| `ember-modifier`                               |            3 files |
| `@cardstack/boxel-ui/components`               |            3 files |
| current Surfaces modules                       |            3 files |
| browser libraries such as Three.js and Leaflet |            3 files |

The larger staging-workspace scan is more important for compatibility breadth:
3,072 source files, 1,415 distinct runtime module specifiers, and concentrated
use of Base, Boxel UI, Ember/Glimmer, commands, runtime-common, local modules,
and a smaller external-package tail. The new runtime must be driven by that
inventory, not by whichever imports happen to be convenient in a small test
Realm.

### Automated suite ledger

This table is the index from existing proof to the contract it protects. It is
not permission to delete narrower historical tests: the new architecture must
pass these tests or replace them with stronger assertions that retain their
original regression intent.

| Existing suite                                                                                                     | Contracts currently exercised                                                                                                                                                                            | Refactor use                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| [`sandbox-live-reload-test.gts`](../packages/host/tests/acceptance/code-submode/sandbox-live-reload-test.gts)      | cold Capsule render, authored FieldDef delegation, chained compute, relationships, all formats, Rich Markdown, recursion, HMR, warm format islands, persistent iframe, failure recovery, explicit reload | Primary end-to-end compatibility suite; extend it with the mixed-runtime graph gauntlet rather than weakening its assertions. |
| [`preview-test.gts`](../packages/host/tests/integration/components/preview-test.gts)                               | trust routing, opaque `getComponent()` compatibility, themes, `surfacePresentation`, nested/primitive FieldDefs, `viewCard`, head format, stable contained-field identity                                | Direct-versus-Capsule semantic and Host portal conformance.                                                                   |
| [`realm-sandbox-iframe-test.gts`](../packages/host/tests/integration/components/realm-sandbox-iframe-test.gts)     | readiness, inert type presentation, intrinsic/allocated sizing, permission updates                                                                                                                       | Parent-side Sandbox component contract; add a real child runtime test separately.                                             |
| [`realm-sandbox-boundary-test.ts`](../packages/host/tests/unit/lib/realm-sandbox-boundary-test.ts)                 | cloneable records, projection, mutation sanitation, rejection of unsafe values                                                                                                                           | Seed for the canonical `BoxelRenderRecord` codec.                                                                             |
| [`realm-compartment-module-runtime-test.ts`](../packages/host/tests/unit/realm-compartment-module-runtime-test.ts) | Capsule imports, evaluation, trusted identities, helpers/components, generation behavior                                                                                                                 | Seed for `BoxelRuntime` and `CapsuleComponentRuntime`.                                                                        |
| source/import/URL policy unit suites                                                                               | runtime classification, safe/unsafe module graph decisions, URL normalization                                                                                                                            | Convert to policy tests over `ModuleGraphDescription`; never let a query parameter choose execution.                          |
| iframe protocol, origin, draft, and media unit suites                                                              | exact origin, one-use channel/bootstrap, persistent draft updates, bounded image transport                                                                                                               | Seed for the versioned Sandbox protocol and grants.                                                                           |
| styles, acknowledgement, lifecycle, contextual-field unit suites                                                   | scoped CSS, server-echo acknowledgement, runtime cleanup, nested field state                                                                                                                             | Preserve as subsystem tests and add graph-level assertions for their interactions.                                            |
| [`hydratable-card-test.gts`](../packages/host/tests/integration/components/hydratable-card-test.gts)               | prerender identity, placeholder adoption, render-slot stability                                                                                                                                          | Seed for `I -> H -> C/S` handoff tests.                                                                                       |
| Boxel UI `safe-modifier` and `surface-presentation` integration suites                                             | current authored effect/presentation APIs and teardown                                                                                                                                                   | Seed for shared Direct/Capsule/Sandbox `SurfaceService` behavior specifications.                                              |

### Manual and corpus artifacts

The Realm corpus adds evidence that deterministic tests cannot yet express:

- `COMPARISON-OBSERVATIONS.md` is the append-only staging-versus-branch visual
  and interaction log. Its results are **manual parity**, not CI proof.
- `CompatibilityMatrix/matrix` is a card-rendered summary grouped by syntax,
  API, and boundary layer. The matrix itself exercises nested
  `containsMany(FieldDef)` rendering.
- `FormatPreviewBatchOne/sample` mounts Primitive Profile, Activity Timeline,
  Rich Markdown Article, Multi-format Signal, and Image Story simultaneously
  in `isolated`, `embedded`, `fitted`, `atom`, `edit`, `head`, and `markdown`.
  That is 35 visible delegated boundaries and must become a deterministic
  graph acceptance test before the POC paths are removed.

## Completion rule for every semantic

No new or migrated Boxel semantic is complete until its implementation record
contains all five items:

1. **Owner** — Store, trusted Base, Host, authored Capsule, or authored
   Sandbox.
2. **Boundary representation** — immutable value, trusted identity, component
   handle, effect handle, or capability request.
3. **Runtime consumers** — Direct, Capsule, Sandbox, indexing/prerender, and
   code preview as applicable.
4. **Pairwise conformance** — the same authored behavior in Direct and each
   applicable confined runtime.
5. **Graph conformance** — the semantic still works when its renderer is
   reached through at least one additional card, field, trusted portal, or
   Sandbox boundary.

If an item is intentionally unsupported, the record must name the replacement
behavior and the diagnostic. Partial rendering of an unknown record is not a
valid fallback; retain last-known-good output or fail with a named contract
error.

## The execution graph, not a stack of pairs

### Nodes

The compositional model is a graph whose nodes are render or semantic owners:

| Node                                        | Owns                                                                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `H` — Host                                  | canonical Store identity, trusted Ember owner, Host chrome, policy, capabilities, mutation validation, render-slot identity |
| `D` — Direct                                | trusted Base/official module execution using native Boxel and Glimmer APIs                                                  |
| `C(principal, generation)` — Capsule        | authored module instances, authored getters/computeds, tracked state, captured template programs                            |
| `S(origin, instance, generation)` — Sandbox | a separate document, local Glimmer runtime, browser-dependent authored modules, local DOM and library state                 |
| `I` — Index/prerender                       | server materialization, indexed values, inert HTML/markdown, and last-known-good presentation                               |

### Typed edges

Every crossing must be a typed edge. “It is already in memory” is not a type.

| Edge                    | Required representation                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| `H -> C`                | canonical card projection, type/field descriptions, trusted import identities, scoped capability handles |
| `C -> H`                | captured component program, bounded effect request, mutation proposal, presentation update, diagnostic   |
| `H -> S`                | versioned bootstrap, card document/grant, format presentation, permission state, private `MessagePort`   |
| `S -> H`                | readiness, size/presentation, bounded fetch/effect request, mutation proposal, diagnostic                |
| `H -> D`                | native card instance and `CardContext`; no boundary projection is necessary                              |
| `H <-> I`               | indexed card resource, prerendered format HTML/markdown, source/index acknowledgement                    |
| `H -> H` trusted portal | trusted Base component identity plus projected model/configuration and bounded authored callbacks        |

An invocation path must carry a stable trace tuple:

```ts
interface RenderGraphTrace {
  renderSlotId: string;
  parentRenderSlotId?: string;
  principal: string;
  runtime: 'direct' | 'capsule' | 'sandbox' | 'prerender';
  cardId?: string;
  typeRef: { module: string; name: string };
  format: string;
  generation: number;
  sourceHash?: string;
}
```

This is diagnostic identity, not authority. Authority remains in unforgeable
Host-owned grants associated with the render slot.

### Graph invariants

- A nested render always re-enters the Host policy router; a parent runtime
  cannot decide that a child may run with less isolation.
- A trusted Base portal may render Host DOM, but it receives only the projected
  data and callbacks declared by its contract. It does not hand its Ember owner
  back to authored code.
- An iframe Sandbox uses its own local trusted Base/Glimmer runtime. Host DOM
  is never transplanted into the child document and child DOM never crosses to
  the Host.
- A Capsule may call a trusted helper/component/modifier identity only through
  the Host component runtime. It never receives a live Host element.
- Relationships create graph edges, not embedded authority. Loading a linked
  card does not widen the caller's Store grant.
- Cycles are detected by logical card/type identity, not just object identity.
- Each render request has depth, node-count, and in-flight-load budgets. A
  recursive `containsMany(FieldDef)` may be deep; an accidental cycle may not
  allocate unbounded components, ports, or iframes.
- Teardown is graph-aware: releasing a parent releases only descendants for
  which it is the last active consumer.
- Format selection is per render node. One CardDef may use a Capsule renderer
  for `atom` and a Sandbox renderer for `isolated` without changing canonical
  card identity.

## Required graph gauntlet

These paths are the minimum compositional suite for the new architecture.
They deliberately include alternating owners rather than only one boundary.

| ID   | Path                                                    | Representative behavior                                                               | Current proof                                                                   | Migration gate                                                                         |
| ---- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| G-01 | `H -> C`                                                | ordinary authored isolated card                                                       | Exact automated: `COLD-INTERACT-01`                                             | Preserve authored DOM, styles, metadata, and stable slot.                              |
| G-02 | `H -> C -> H -> C`                                      | CardDef invokes trusted Base field portal which invokes an authored FieldDef template | Exact automated: `COLD-INTERACT-02`                                             | Assert projected value, configuration, scoped CSS inheritance, and `@set`.             |
| G-03 | `H -> C -> H -> C -> H -> C`                            | recursive `containsMany(FieldDef)` with indexed components                            | Exact automated: `CORPUS-03`                                                    | Assert three depths, no JSON fallback, bounded recursion, and teardown.                |
| G-04 | `H -> C -> H -> C2`                                     | `linksTo`/`linksToMany` delegates another CardDef and format                          | Exact automated: `COLD-INTERACT-03`                                             | Include same-realm and separately granted cross-realm child principals.                |
| G-05 | `H -> C -> H -> D -> H -> C`                            | authored card uses trusted Rich Markdown, which embeds an authored card               | Partial: `CORPUS-02` proves Rich Markdown; embed tests prove formats separately | Add one exact nested Rich Markdown card-embed graph test.                              |
| G-06 | `H -> C -> H -> S`                                      | Capsule parent delegates a browser-dependent linked card                              | Contract automated only                                                         | Add an exact parent/child test with readiness, intrinsic height, and parent stability. |
| G-07 | `H -> S(local Base -> authored child)`                  | iframe card renders Base fields and authored local components in its own document     | Protocol automated; full nested child is manual-only                            | Add a real child-document integration test, not only parent messages.                  |
| G-08 | `H -> C -> H -> S -> H(write) -> Store -> C/S`          | nested Sandbox edit proposes a write and all visible consumers reconcile              | Pairwise write protocol exists                                                  | Add exact multi-consumer mutation and permission-revocation test.                      |
| G-09 | `I -> H placeholder -> S interactive`                   | prerendered HTML is immediate while an iframe becomes interactive                     | Hydratable Host card is automated; iframe handoff is incomplete                 | Assert format-correct placeholder, header spinner, no layout jump, then readiness.     |
| G-10 | `H -> C(format A) / C(format B)`                        | same module and card switch between warm formats                                      | Exact automated: `[NAV-07]` for two SES islands                                 | Preserve card identity and bounded two-format LRU.                                     |
| G-11 | `H -> C(atom) / S(isolated)`                            | compact renderer stays Capsule-safe while browser-heavy renderer uses iframe          | Source-policy unit proof                                                        | Add one real split-module CardDef across both formats.                                 |
| G-12 | `H -> C -> surface* -> H` and `H -> S -> surface* -> H` | same named capability through direct dispatcher and MessageChannel                    | Only `surfacePresentation` has both paths                                       | Every shipped `surface*` capability needs this transport-equivalence test.             |

## Authored Boxel semantic checklist

### Definitions, fields, and projections

| Semantic used by current cards                                  | POC boundary behavior                                                                                              | Evidence                                                 | Required new-architecture contract                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `CardDef`, `FieldDef`, `FileDef`, `Component`                   | Capsule-owned classes plus Host type descriptions; native classes in Direct/Sandbox-local runtime                  | Contract automated                                       | One `BoxelRuntime` description/projection contract; never pass a live authored constructor to Host.                                    |
| `@field`                                                        | field metadata captured during Capsule evaluation                                                                  | Contract automated                                       | Preserve declaration order, inheritance, override identity, definition kind, and configuration.                                        |
| `contains` / `containsMany`                                     | materialized snapshot plus stable singular/indexed component capabilities                                          | Exact automated: COLD-02, CORPUS-03                      | Project values recursively; preserve array length/index/iteration and authored FieldDef renderer identity.                             |
| `linksTo` / `linksToMany`                                       | relationship resource plus asynchronously prepared delegated renderer                                              | Exact automated: COLD-03                                 | Relationship stays an id/grant edge; Host loads and routes each target without widening the parent grant.                              |
| query-backed relationships                                      | projected results use the relationship component contract                                                          | Manual parity; existing query suites                     | Add exact sandbox test for loading, empty, error, membership change, and teardown.                                                     |
| `computeVia`                                                    | executes in the owning Capsule; iframe leaves use child/indexed value rather than opening an iframe for projection | Exact automated: COLD-02B and CORPUS-03                  | Include dependency tracking, chained/nested FieldDefs, errors, cycles, and indexing parity.                                            |
| authored getters                                                | evaluated in authored runtime and exposed as projected values                                                      | Contract automated                                       | Same dependency/error/cycle rules as `computeVia`; never evaluate authored getter in Host.                                             |
| field `configuration` object/function                           | resolved against the parent instance and projected to the renderer                                                 | Contract coverage is incomplete                          | Add inherited, per-use merge, function, and dynamic update tests across a trusted Base field portal.                                   |
| `searchable`, query formatting, serializers                     | Store/index semantics remain trusted                                                                               | Existing Base/realm tests; sandbox graph not exact       | New runtime consumes canonical Store/index output; it must not reimplement serializer/index rules.                                     |
| recursive/lazy field type functions                             | Capsule resolves type identity without eager infinite recursion                                                    | Exact automated: CORPUS-03                               | Preserve lazy resolution and logical cycle guard across runtime generations.                                                           |
| inherited fields and templates                                  | type description includes ancestors and inherited slots                                                            | CORPUS-03 plus manual corpus                             | Add direct/Capsule/Sandbox conformance for inherited metadata and renderer selection.                                                  |
| polymorphic or overridden field types                           | opaque type state supports per-instance field overrides                                                            | Contract automated in Base; sandbox proof incomplete     | Include override type refs in the boundary record and test nested render/write.                                                        |
| primitive serialization/deserialization                         | primitive value crosses as data; trusted field handles edit semantics                                              | Exact primitive FieldDef integration test                | Preserve `null`, empty, number/string/boolean, date, URL, currency, and file values without JSON coercion.                             |
| JSON:API persistence                                            | Host serializes canonical document and strips non-card side-loaded projections                                     | Exact boundary unit tests                                | All writes use one `projectCardMutation()` path; reject non-card included resources and non-cloneable values.                          |
| `cardInfo`                                                      | nested field with `name`, `summary`, `cardThumbnail`, `cardThumbnailURL`, `theme`, and `notes`                     | Contract automated; corpus has CardInfo Recipe and Theme | Treat as one nested field, not six synthetic top-level fields. Test title, description, image, theme relationship, and notes together. |
| `cardTitle`, `cardDescription`, `cardTheme`, `cardThumbnailURL` | trusted Base computed aliases over `cardInfo`                                                                      | Manual parity and metadata tests                         | Project canonical computed presentation before Host header render; eliminate `Untitled` races.                                         |

### Formats and type presentation

The set of formats must be open-ended in the new architecture. These are the
current examples, not a closed protocol enum.

| Semantic                             | Current evidence                                  | Migration checklist                                                                                                   |
| ------------------------------------ | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `isolated`                           | Exact automated top-level render                  | ☐ Direct/Capsule/Sandbox; ☐ default Base fallback; ☐ prerender placeholder; ☐ error/LKG.                              |
| `embedded`                           | Exact delegated-format test                       | ☐ nested graph; ☐ intrinsic iframe sizing; ☐ Rich Markdown embedding policy.                                          |
| `fitted`                             | Exact delegated-format test                       | ☐ allocated sizing; ☐ warm gallery performance; ☐ no iframe pill/farm regression.                                     |
| `atom`                               | Exact delegated-format test                       | ☐ compact Capsule/default renderer; ☐ inert fallback for iframe-only modules.                                         |
| `edit`                               | Exact delegated-format and primitive `@set` tests | ☐ writable/read-only parity; ☐ Base fallback; ☐ mutation rejection; ☐ intrinsic iframe size.                          |
| `head`                               | Exact delegated-format test                       | ☐ compact safe renderer or inert fallback; ☐ no iframe farm.                                                          |
| `markdown`                           | Exact delegated-format and fallback tests         | ☐ trusted conversion fallback; ☐ authored renderer; ☐ nested directives.                                              |
| named fitted/custom dimensions       | Markdown embed integration tests                  | ☐ carry variant id and allocated dimensions through all runtime adapters.                                             |
| future/custom format                 | Not proven                                        | ☐ `FormatDescription` is keyed by string and unknown formats fail explicitly rather than disappearing.                |
| `displayName`                        | Boundary/type-presentation tests                  | ☐ no `Untitled` settlement race; ☐ update on valid HMR generation.                                                    |
| `icon`                               | Trusted identity fallback exists                  | ☐ approved identity mapping; ☐ authored unsupported icon fallback; ☐ no component crosses iframe protocol.            |
| `headerColor`                        | Metadata and iframe presentation path             | ☐ validation parity; ☐ title-bar-only semantics; ☐ HMR update.                                                        |
| `prefersWideFormat`                  | Metadata and iframe presentation path             | ☐ strict boolean; ☐ Host remains layout owner; ☐ HMR update.                                                          |
| `prefersFullSandbox`                 | Unit source/routing tests                         | ☐ only strengthens `isolated`/`embedded`/`edit`; ☐ cannot be set by URL; ☐ compact formats remain composable.         |
| authored format in a separate module | Source-policy unit tests                          | ☐ defer unsafe graph only for that slot; ☐ shared module-scope use makes dependency eager; ☐ real two-file card test. |

### Component arguments and implicit template API

These are implicit APIs because existing cards receive them through Base's
component signature rather than importing a capability module.

| Implicit input                          | Owner and boundary rule                                                      | Evidence                                       | Migration gate                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `@model`                                | projected canonical value; authored runtime owns executable behavior         | Exact across card and primitive FieldDef tests | Stable identity where possible; nested object writes cannot bypass mutation validation.          |
| `@cardOrField`                          | inert type description/approved identity, never authored constructor in Host | Contract automated                             | Replace constructor introspection with `BoxelDescription`.                                       |
| `@fields`                               | stable named and indexed renderer handles                                    | Exact COLD/CORPUS tests                        | Singular, many, inherited, recursive, relationship, loading, and error states.                   |
| `@format`                               | string selected by Host policy                                               | Exact format gauntlet                          | Open-ended, per-node, and updateable without replacing unrelated runtime state.                  |
| `@set`                                  | bounded mutation callback                                                    | Exact FieldDef test                            | Permission, path, type, generation, and card identity revalidated by Host.                       |
| `@fieldName`                            | inert field path/name                                                        | Contract automated                             | Preserve nested path semantics without exposing unrelated schema.                                |
| `@configuration`                        | resolved cloneable field configuration                                       | Incomplete                                     | Add exact trusted Base field portal coverage.                                                    |
| `@canEdit` / `canWrite`                 | Host permission-derived boolean                                              | Iframe protocol test                           | No writable/read-only flash; Host rechecks every write.                                          |
| `@typeConstraint`                       | resolved inert CodeRef                                                       | Contract partial                               | Validate through owning realm without Host-importing authored code.                              |
| CRUD functions                          | Host capabilities, not function-valued card data                             | Direct exists; sandbox coverage incomplete     | Separate named create/view/edit/save/delete operations with principal and activation checks.     |
| `@context.mode` / `submode`             | inert presentation hint                                                      | Contract partial                               | Same values across Direct/Capsule/Sandbox; never an authority decision.                          |
| `@context.requestRender`                | trusted Base portal asks its owning render slot to update                    | Rich Markdown proof                            | Private Host/Base capability; do not project into arbitrary authored context.                    |
| `@context.trustedUI`                    | trusted loaders for CodeMirror, KaTeX, Mermaid                               | Exact Rich Markdown acceptance test            | Private to trusted Base/catalog portals; authored code sees rendered result, not loader/service. |
| `@context.validateCodeRef`              | realm-scoped validation through owning runtime                               | Unit/integration partial                       | Private trusted editor capability with bounded CodeRef result.                                   |
| `searchResultsComponent`                | trusted Host rendering portal                                                | Existing component integration tests           | Add nested authored-card use through Capsule; do not pass component class through JSON.          |
| `cardComponentModifier`                 | trusted element tracking hook                                                | Hydratable-card tests                          | Host-only; never present in authored Capsule or iframe code.                                     |
| `markdownEmbedChooser`                  | trusted operator-mode UI capability                                          | Existing editor tests                          | Host/Base only and absent in prerender/unsupported contexts.                                     |
| `toolContext` / legacy `commandContext` | privileged Host tool context                                                 | Current Capsule receives no real context       | Replace each needed operation with a named command capability; never proxy the context bag.      |

### Glimmer, Ember, and authored-program semantics

| Semantic in current cards                                | Current handling                                                              | Evidence                                  | Required contract                                                                                  |
| -------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `@tracked` / `@cached`                                   | Capsule-local reactive state with render notifications                        | HMR and interaction contract tests        | Persistent component instance; same update semantics; teardown stops notifications.                |
| `@action`                                                | Capsule-local method binding                                                  | Contract automated                        | Event handle invokes only the owning instance/generation.                                          |
| `on` modifier                                            | trusted modifier identity plus authored callback                              | Interaction tests                         | Host owns element/listener; callback receives projected event data or approved event contract.     |
| `fn`, `get`, `concat`, `hash`, `array`                   | trusted helper identities                                                     | Module-runtime tests                      | Preserve helper semantics and nested component handles without general helper authority.           |
| template-only and ordinary Glimmer components            | captured program/Host component manager in Capsule; native locally in Sandbox | Manual corpus and component-runtime tests | Blocks, args, splattributes, dynamic element, and local state conformance.                         |
| blocks and `yield`                                       | implicit Glimmer composition                                                  | Coverage incomplete                       | Add Capsule -> trusted Base portal -> authored yielded-block test, including updates and teardown. |
| dynamic component/helper/modifier lookup                 | allowlisted/trusted identities only                                           | Source/module policy partial              | Unknown dynamic identity fails with a named diagnostic; no ambient owner lookup.                   |
| `ember-modifier` custom modifiers                        | iframe classification unless represented by a reviewed adapter                | Source-policy exact                       | Existing cards run unchanged in Sandbox; new `surface*` alternatives may remain Capsule.           |
| `ember-concurrency`                                      | used by real cards; facade incomplete                                         | Import audit only                         | Decide Capsule-local task runtime versus Sandbox; test cancellation, restart, error, and teardown. |
| `ember-resources`, destroyables, provide/consume context | real-workspace use; incomplete                                                | Import audit only                         | Specify runtime-local lifetime/context semantics and graph test before migration.                  |
| locale/string/number/date behavior                       | selected safe intrinsics preserved                                            | Computed Flight Plan manual parity        | Direct/Capsule/Sandbox conformance for locale, timezone, formatting, and deterministic indexing.   |

## `surface*` API inventory

### What is actually shipped in the POC

The distinction in this table is critical. The POC does **not** currently ship
the whole proposed family merely because the design document names it.

| API                                      | Current status       | Semantics and evidence                                                                     | New-runtime gate                                                                 |
| ---------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `safeModifier('focus')`                  | Shipped opt-in       | trusted focus operation; Boxel UI integration test                                         | Decide whether retained as compatibility alias for `surfaceFocus`.               |
| `safeModifier('scroll-into-view')`       | Shipped opt-in       | trusted bounded scroll operation; implementation exists, focused test should be added      | Same as above.                                                                   |
| `safeModifier('observe-size', callback)` | Shipped opt-in       | frozen finite `{ width, height }`, trusted `ResizeObserver`, teardown; exact Boxel UI test | Map to `surfaceObserve('size')`; test Capsule and Sandbox transport equivalence. |
| `surfacePresentation`                    | Shipped opt-in       | publishes validated `containerBackground`; SES integration and iframe protocol tests       | Move dispatch/lifetime into `SurfaceService`; preserve the authored import.      |
| `static headerColor`                     | Existing CardDef API | trusted card-title background metadata                                                     | Keep separate from body/container presentation.                                  |

### Proposed `surface*` family

Each proposed item remains unchecked until it has an authored API, Host
dispatcher, Capsule adapter, iframe protocol adapter where applicable,
revocation, bounds, and Direct/Capsule/Sandbox conformance tests.

| Capability            | Replaces                                             | Current corpus demand                              | Status                                                     |
| --------------------- | ---------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------- |
| `surfaceRoot`         | ad hoc root discovery/identity                       | all root-confined effects and nested surfaces      | ☐ Design only                                              |
| `surfaceLifecycle`    | lifecycle-only custom modifiers                      | Scrabble, Tier Maker, Assistant Run, Signet        | ☐ Design only                                              |
| `surfaceObserve`      | `ResizeObserver`, `IntersectionObserver`             | iframe height, responsive panels, 3D/canvas sizing | ◐ `safeModifier observe-size` only                         |
| `surfaceFocus`        | `focus()`, `scrollIntoView()`                        | Tier Maker, forms, keyboard workflows              | ◐ `safeModifier` operations only                           |
| `surfacePointer`      | pointer listeners/capture/drag                       | Tier Maker, Poster Board, maps, signature/canvas   | ☐ Design only                                              |
| `surfaceStyle`        | validated dynamic style mutation                     | Invoice form, rating, geometry, pan/zoom           | ☐ Design only                                              |
| `surfacePresentation` | Host container/backdrop presentation                 | iframe double-frame/background parity              | ☑ Shipped for solid/matched color                          |
| `surfaceTransition`   | document view transitions and global names           | View Transition Gallery, Tier Maker                | ☐ Design only                                              |
| `surfaceSchedule`     | timers/animation scheduling                          | Scrabble, playback, workflows                      | ☐ Design only                                              |
| `surfaceClipboard`    | `navigator.clipboard`                                | Tier Maker/share flows                             | ☐ Design only                                              |
| `surfaceHaptics`      | `navigator.vibrate`                                  | Tier Maker                                         | ☐ Design only                                              |
| `surfaceSlot`         | portals into Host chrome                             | Assistant Run toolbar                              | ☐ Design only                                              |
| `surfacePlayback`     | cross-surface media intent/state/leader coordination | Video, Audio, 3D, playback lab                     | ☐ Separate design in `surface-playback-synchronization.md` |
| `surfaceViewport`     | pan/zoom intent and effective viewport state         | Poster Board, map, viewport relay                  | ☐ Design only                                              |

Network, Store access, Realm search, commands, secrets, and AI proxy requests
must not be hidden inside `surface*`. Their authority is a principal/data
grant, not a mounted DOM surface.

## Browser, DOM, CSS, and media checklist

| Behavior                               | Runtime decision                                                        | Current evidence                             | Migration gate                                                                               |
| -------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------- |
| scoped styles                          | Capsule shared document with compiler scope; native in Sandbox document | style unit tests and visual canaries         | Reject selectors that escape scope; ref-count styles; stable identity across HMR.            |
| unscoped/global CSS                    | Sandbox or fail closed                                                  | source-policy unit tests                     | No network-bearing CSS bypass; preserve existing card in iframe.                             |
| dynamic inline styles                  | currently conservative Sandbox selection                                | source-policy tests                          | Keep Sandbox until `surfaceStyle` covers the exact property/value contract.                  |
| theme CSS variables                    | Host resolves `cardInfo.theme` and attaches bounded variables           | preview integration; Themed Dashboard manual | Direct/Capsule/Sandbox visual token parity and update test.                                  |
| inherited parent CSS/custom properties | delegated FieldDef must retain Base wrapper and inheritance             | Computed Flight Plan manual parity           | Exact nested FieldDef CSS conformance test.                                                  |
| native image                           | SES-safe markup; iframe media bridge for child-private fetch            | media bridge unit tests                      | Relative URL resolution, cross-realm grant, content type, loading/error, edit/format switch. |
| native audio/video                     | SES-safe unless authored code requests browser authority                | manual corpus                                | Add play/control/source/poster tests without iframe escalation.                              |
| canvas/WebGL/Three.js/3MF              | Sandbox document                                                        | source policy + manual corpus                | Hosted origin, asset/module policy, resize, cleanup, context loss, prerender placeholder.    |
| Leaflet/maps                           | Sandbox document unless replaced by a narrow surface                    | manual corpus                                | Tiles/style/module policy, pointer, marker state, resize, teardown.                          |
| Mermaid/KaTeX/CodeMirror               | trusted Base portal loads Host-vetted packages                          | exact Rich Markdown test                     | Nested Capsule -> Base portal -> authored embed graph, edit write parity.                    |
| top layer/popover                      | Sandbox while it requires document-global top-layer behavior            | source-policy test + manual corpus           | Correct iframe containment, focus, size, close, and teardown.                                |
| view transitions                       | Sandbox until `surfaceTransition` exists                                | source-policy + manual corpus                | Namespaced identity and lifecycle if brought into Capsule.                                   |

## Iframe Sandbox protocol inventory

| Message/semantic                        | Current POC                                           | Required new-runtime treatment                                                                    |
| --------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| exact-origin `listening` + bootstrap id | Implemented and tested                                | Version negotiation, nonce origin, one-use port, sibling-frame rejection.                         |
| `connect`                               | document/draft, root module, presentation, `canWrite` | Replace ad hoc payload with versioned Sandbox session/grant record.                               |
| `ready`                                 | card id, revision, error, type presentation           | Separate loaded, interactive, and failed states; preserve last-known-good placeholder.            |
| `render`                                | format, height mode, field/code ref, container flag   | Persistent child session; open-ended format; stable child document where compatible.              |
| `permissions`                           | `canWrite` boolean                                    | Update without frame remount; Host still rechecks every mutation.                                 |
| `resize`                                | finite width/height                                   | Intrinsic for isolated/embedded/edit/atom; allocated for fitted; clamp/rate-limit.                |
| `surface-presentation`                  | validated solid container background                  | Generalize through `SurfaceService` without arbitrary CSS/DOM.                                    |
| `fetch-request/response`                | bounded module/media broker                           | Bind to declared graph and grant; no ambient credentials or arbitrary authenticated fetch.        |
| `card-update/result`                    | full data-only card document and revision             | Move to canonical mutation protocol with field/card identity and conflict semantics.              |
| draft/HMR                               | source, URL, revision                                 | Source-hash generation, child acknowledgement, LKG, no server-echo remount.                       |
| media hydration                         | private image transport                               | Extend only by content-specific reviewed capability; do not make it generic credentialed network. |
| height readiness and header spinner     | implemented UI pieces                                 | Spinner right of Realm icon; prerender remains visible until interactive; no layout jump.         |

## Corpus coverage ledger

The corpus README remains the detailed visible-proof specification. This table
records what each card contributes to the migration, and whether the current
automated suite proves that exact card shape.

|   # | Card                    | Primary contract tags                         | Best current evidence                     | Missing exact proof                    |
| --: | ----------------------- | --------------------------------------------- | ----------------------------------------- | -------------------------------------- |
|   1 | Primitive Profile       | primitives, compute, three formats, wide      | Contract automated + manual parity        | Exact three-format fixture             |
|   2 | Nested Field Host       | `contains(FieldDef)`, delegated CSS/write     | Exact automated COLD-02                   | Direct/Sandbox conformance             |
|   3 | Activity Timeline       | indexed `containsMany`, sort                  | Manual parity; indexed contract automated | Exact ordering/update test             |
|   4 | Rich Markdown Article   | trusted portal, Mermaid, editor, embeds       | Exact Rich Markdown core CORPUS-02        | Full nested embed graph                |
|   5 | Linked Project          | links, delegated cards/formats                | Exact automated COLD-03                   | Cross-principal grant                  |
|   6 | Query Board             | query-backed links                            | Manual parity                             | Exact loading/update/error test        |
|   7 | Safe Interaction        | tracked/action/`on`                           | Contract automated                        | Exact corpus fixture                   |
|   8 | Themed Dashboard        | `cardInfo.theme`, CSS variables               | Preview contract + manual parity          | Exact theme update test                |
|   9 | Browser Canvas          | iframe, canvas, intrinsic height              | Protocol automated + manual parity        | Real child-document CI test            |
|  10 | Default Template        | trusted Base fallback                         | Contract automated + manual parity        | Explicit no-sandbox timing/parity test |
|  11 | Computed Flight Plan    | nested/chained compute, CSS inheritance       | Exact compute contract + manual parity    | Exact CSS assertions in CI             |
|  12 | Recursive Discussion    | recursive `containsMany(FieldDef)`            | Exact automated CORPUS-03                 | Cycle/budget failure case              |
|  13 | Inherited Experience    | inherited fields/computeds                    | CORPUS-03 analogous + manual              | Exact inheritance fixture              |
|  14 | Variant Scorecard       | nested config/dynamic presentation            | Manual parity                             | Configuration conformance              |
|  15 | Sectioned Profile       | DateField, DOM, anchor, iframe height         | Protocol contract + manual                | Exact navigation/height test           |
|  16 | CardInfo Recipe         | name/summary override                         | Metadata contract + manual                | Full `cardInfo` aliases test           |
|  17 | Editable Rating         | icons/helpers/action/`@set`/atom              | `@set` contract + manual                  | Exact edit/read-write test             |
|  18 | Atomic Work Item        | generated FieldDefs/edit/select/radio         | Field relationship tests + manual         | Generated type/edit fixture            |
|  19 | Multi-format Signal     | trusted FittedCard/icons/formats              | Exact format contract + manual            | Trusted component portal nesting       |
|  20 | Dynamic Title Group     | template-only, dynamic element, splattributes | Manual parity                             | Glimmer bridge conformance             |
|  21 | Typed Command Lab       | `Command`, typed context/progress             | Command unit contract + manual            | Named capability end-to-end            |
|  22 | Surface Data Table      | Surfaces Environment/Layout/Grid              | Manual parity                             | New runtime portal/API decision        |
|  23 | Poster Board            | Surfaces, geometry, images, nested fields     | Manual parity                             | Graph + image + mutation test          |
|  24 | Workflow Studio         | tracked state/actions/workflow                | Contract automated + manual               | Exact no-remount test                  |
|  25 | Image Story             | realm image/CSS                               | Media contract + manual                   | Visual/layout and error test           |
|  26 | Surface Command Center  | Surfaces, form, metrics                       | Manual parity                             | New runtime portal/API decision        |
|  27 | View Transition Gallery | document transition/CSS pseudo-elements       | Source-policy + manual                    | Sandbox child integration              |
|  28 | Fabrication Viewer      | Three.js/3MF/WebGL/cleanup                    | Source-policy + manual                    | Asset/cleanup/prerender CI             |
|  29 | Video Dispatch          | native video/poster/sources                   | Manual parity                             | Exact SES no-escalation test           |
|  30 | Audio Program           | native audio/realm media                      | Manual parity                             | Exact SES no-escalation test           |
|  31 | Media Cue Workflow      | nested fields/tracked selection               | Contract automated + manual               | Playback graph integration             |
|  32 | Geo Dispatch Map        | Leaflet/CSS/tiles/pointer/cleanup             | Manual parity                             | Hosted Sandbox/network test            |
|  33 | Chord Conductor         | UMD/Tone/WebAudio/gesture/cleanup             | Manual parity                             | Activation/audio/teardown test         |
|  34 | Flip Memory             | keyboard/click/3D CSS/tracked                 | Contract automated + manual               | Exact accessibility/state test         |
|  35 | Sorted Queue            | multi-key derived sort                        | Manual parity                             | Exact deterministic ordering test      |
|  36 | Playback Capability Lab | leader/epoch/sequence/lease                   | Fixture/manual semantic proof             | Real `surfacePlayback` implementation  |
|  37 | Viewport Relay          | pan/zoom intent/effective state               | Fixture/manual semantic proof             | Real `surfaceViewport` implementation  |
|  38 | CSS Carousel Deck       | nested fields/3D CSS/keyframes                | CSS contracts + manual                    | Exact scoped keyframe/state test       |
|  39 | Protocol Event Log      | ordering/discriminated events/ack             | Manual parity                             | Exact sequence/ack test                |
|  40 | Top Layer Studio        | popover/backdrop/nested control               | Source-policy + manual                    | Sandbox focus/size integration         |

### Real-card probes

| Card                 | Implicit APIs it revealed                                                                    | Migration requirement                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Scrabble Stream      | lifecycle, scheduling, authenticated AI proxy, collaborative state                           | Keep ordinary UI in Capsule once named lifecycle/schedule/data capabilities exist; do not generalize to ambient Host access.   |
| Tier Maker           | modifiers, pointer/drag, focus, clipboard, haptics, transitions, dynamic styles, image media | Preserve current iframe fallback first; then migrate only covered operations to `surface*`; exact image and edit/return tests. |
| Assistant Run        | Host tools, Realm runner operations, toolbar placement                                       | `surfaceSlot` for presentation and separately reviewed command capabilities for data/effects.                                  |
| Signet Proposal      | enum factory, Markdown, canvas/signature, commands                                           | Trusted Base enum/Markdown portals; isolate only the canvas package if it truly requires browser DOM.                          |
| Invoice Billing Form | nested Base FieldDefs, configuration, dynamic color style, writes                            | `surfaceStyle` or trusted Base portal; writable parity is mandatory.                                                           |

## UX parity checklist

The architecture is not complete when the card eventually renders. It must
retain the behavior users experienced on `main` and the successful parts of
the POC.

### Interact mode

- [ ] Trusted Base/default templates appear without starting a Capsule or
      Sandbox.
- [ ] Card header title, icon, `headerColor`, theme, and wide-format state are
      correct on first stable paint; no `Untitled` settlement.
- [ ] Prerendered HTML is format-correct and remains visible while a live
      Capsule/Sandbox becomes interactive.
- [ ] The loading spinner appears beside the Realm icon only while the live
      renderer is not interactive.
- [ ] Intrinsic and allocated sizing obey format semantics without double
      frames or layout jumps.
- [ ] Edit controls are writable exactly when the Host permission says they
      are; no read-only/writable flashing.
- [ ] A failed generation keeps last-known-good output and shows the standard
      bottom error overlay.
- [ ] Reload Card deliberately replaces only the selected render generation.
- [ ] Execution signage reports `Direct`, `Capsule`, or `Sandbox` for the
      selected format and does not imply a trust label for the whole card.

### Code mode and HMR

- [ ] File tree and recent files do not wait for card analysis/rendering.
- [ ] Monaco mounts when source arrives and does not wait for preview startup.
- [ ] A valid local generation updates the existing render island.
- [ ] Matching save/index/SSE echoes acknowledge that generation rather than
      restoring old code or remounting the card.
- [ ] Syntax/runtime failures retain last-known-good output and standard error
      UI.
- [ ] Source classification and transpilation are cached by source hash.
- [ ] Volatile state lasts at least the agreed quiet period and is shared by
      Monaco, AI patches, and out-of-band Realm file writes.
- [ ] Format switching reuses the same module graph and a bounded warm-island
      cache.

### Performance and lifetime

- [ ] Direct/Base loaders are immune to user-module churn.
- [ ] Capsule runtimes are keyed by explicit principal/generation policy and
      never per card by accident.
- [ ] Sandbox documents persist across compatible format/source updates.
- [ ] Nested graph nodes share completed loads and styles by identity.
- [ ] Cross-realm navigation releases inactive runtimes, ports, observers,
      timers, styles, media resources, and Store residency.
- [ ] A fitted gallery does not perform global invalidation or create an
      iframe per compact child when a safe/inert renderer exists.

## Missing coverage to add before the refactor deletes POC paths

The following gaps are higher priority than adding more pairwise unit tests:

1. Exact Rich Markdown graph: Capsule article -> trusted Rich Markdown portal
   -> embedded Capsule card -> authored FieldDef, with Mermaid and edit.
2. Exact mixed-runtime graph: Capsule parent -> linked Sandbox child -> Host
   mutation -> parent and child reconciliation.
3. Sandbox child integration: execute a real nested Base field and authored
   child inside the child document in CI, not only protocol message mocks.
4. Field configuration cross-product: static, functional, inherited,
   per-usage, dynamic update, and custom edit renderer.
5. Query relationship lifecycle: loading, success, empty, error, membership
   update, navigation, and teardown.
6. Blocks/yields through a trusted portal, including authored callback and
   contextual component identity.
7. One split-module card whose compact formats are Capsule and whose isolated
   format is Sandbox.
8. Format-correct prerender placeholder -> Capsule and placeholder -> Sandbox
   handoffs with stable dimensions.
9. Permission revocation during a nested edit, with a forged stale write
   rejected by generation and principal.
10. Transport-equivalence harness that runs every shipped `surface*`
    capability through Direct, Capsule, and Sandbox adapters from one behavior
    specification.

## New-architecture migration ledger

This ledger should be updated in the new branch. A row may be checked only
when the old path has been replaced and its exact proof passes.

- [ ] `BoxelRuntime` owns type description, projection, compute/getter
      execution, and mutation proposals for Direct, Capsule, and Sandbox adapters.
- [ ] `BoxelRenderRecord` is the only card/field data representation consumed
      by confined renderers.
- [ ] `FormatDescription` is open-ended and contains renderer, sizing,
      presentation, and prerender policy.
- [ ] `CapsuleComponentRuntime` is the only Capsule-to-Glimmer bridge.
- [ ] Trusted Base components/helpers/modifiers are explicit portals with
      enumerated args, blocks, callbacks, and capabilities.
- [ ] `SurfaceService` owns surface registration, generation, dispatch,
      revocation, coordination, and Direct/Capsule/Sandbox adapters.
- [ ] Sandbox uses one versioned session protocol and a child-local
      Boxel/Glimmer runtime; no Host object or credential crosses.
- [ ] Store grants bind principal, allowed roots/cards/operations, expiry, and
      revocation to every sandbox-originated read, search, hydrate, or write.
- [ ] Render graph traces, depth/node budgets, cycle detection, and
      graph-aware teardown are implemented.
- [ ] Direct, Capsule, Sandbox, prerender/index, Interact, and Code preview all
      consume the same semantic records instead of rebuilding snapshots.
- [ ] The graph gauntlet and missing-coverage list above are green.
- [ ] The 40-card corpus has no red compatibility cells for three consecutive
      representative expansion rounds, with every newly discovered contract
      minimized into CI before the POC implementation is removed.

## Review rule

When a refactor changes one of these contracts, reviewers should be able to
follow a single row from authored syntax, to semantic owner, to boundary
record, to runtime adapter, to pairwise test, to nested graph test, to visible
UX expectation. If that chain cannot be followed, the semantic has not yet
been made explicit enough to safely replace the POC.
