# Realm sandbox card API compatibility ledger

## Compatibility rule

An existing card that renders on staging must not need a source edit merely
because the Host starts evaluating it in an SES compartment or a sandboxed
iframe. The sandbox owns the compatibility work. It must either:

1. provide a confined implementation of an API the card already imports;
2. project an existing template argument or context capability across the
   boundary; or
3. select an iframe when the card genuinely requires browser authority that an
   SES compartment cannot safely receive.

Surface coordination, playback synchronization, and viewport coordination are
deliberately outside this ledger. They are new, opt-in product features rather
than prerequisites for rendering existing cards.

## Bottom line

For ordinary CardDef and FieldDef source, the target number of required new
card-facing APIs is **zero**. Existing cards should continue to import the same
Base, Catalog, Boxel UI, icon, Ember, and Glimmer modules they import today.

The branch currently has one genuinely new card-facing API,
`safeModifier`. It is optional: it lets newly authored code request a small DOM
operation while remaining in SES. Existing cards that import an ordinary DOM
modifier should instead be classified into the iframe tier, or receive a
compatible Host shim when the operation can be expressed safely. They must not
be rewritten just to render.

The branch also has several internal Host/Base runtime bridges. Cards do not
import them, and core rendering no longer requires a separately deployed Base
realm to recognize a new hook. They are still listed because future changes to
these bridges must not become staging card API dependencies.

## Exact inventory: what did this branch add?

There are two different questions hiding behind “new API,” and they need
different answers:

1. **Must an existing realm card import or call something new?** No.
2. **Does the current branch add bundled Host/Base runtime behavior?** Yes, but
   none of it requires a staging card source change or a separately deployed
   Base recognition hook for core rendering.

| Branch addition                                                                                     | Imported by authored realm cards? | Does an unchanged staging card fail to render without it?                                                                                                                                                                     | Disposition                                                                                                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `safeModifier`                                                                                      | Only when a new card opts in      | **No.** Existing DOM-dependent source must be classified into an iframe or supported by a shim.                                                                                                                               | Keep optional; never use it as the compatibility fix for an existing card.                                                     |
| Host-owned static format-slot shim for opaque synthetic definitions                                 | No                                | **No.** Existing trusted Base code continues calling its ordinary `getComponent(opaqueLinkedCard)`. The synthetic type exposes the Host delegate through the same `isolated`/`embedded`/etc. static slots Base already reads. | Implemented without a new symbol or coordinated Base deployment. Unauthored slots retain their trusted Base fallback template. |
| `CardContext.requestRender`                                                                         | No                                | No. It restores dynamic local-state rerenders inside a trusted Base component portal; basic card rendering does not depend on it.                                                                                             | Keep optional. It is a renderer capability supplied by the Host, not realm card API.                                           |
| `CardContext.validateCodeRef`                                                                       | No                                | No. It preserves CodeRef edit validation without importing user modules into the trusted Host graph.                                                                                                                          | Keep optional and limited to trusted Base edit UI.                                                                             |
| `createFromSerialized(..., { loader })`                                                             | No                                | Not as an authored API. Without loader preservation, cross-realm materialization can resolve a definition through the wrong Loader and produce incorrect identity or behavior.                                                | Keep internal. Host and its bundled Base/runtime must agree, but realm source and realm data do not change.                    |
| Loader `ModuleEvaluator` / module delegation                                                        | No                                | No new source requirement; the sandbox cannot evaluate ordinary existing ESM graphs correctly without an equivalent internal mechanism.                                                                                       | Keep internal and test through existing card imports.                                                                          |
| Opaque-card state, type, field, theme, stylesheet, generation, iframe, height, and effect protocols | No                                | No new source requirement; missing projections can make cards render incorrectly, but the correction belongs in the Host protocol.                                                                                            | Keep internal. Never serialize these symbols into card data or expose them as realm imports.                                   |

Therefore, if “API” means an API a card author must adopt, the list is empty.
The previous paired Base/Host dependency for opaque linked-card
`getComponent()` delegation has also been removed. The compatibility shim now
lives entirely in the Host's synthetic opaque card definition.

## Existing card contract that the sandbox must shim

These are not new card APIs. A staging card already depends on them, so the
sandbox runtime must preserve their observable behavior.

| Existing contract                                                                                                                                      | Sandbox implementation                                                                                                                                                                                           | Source change? | Current status                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CardDef`, `FieldDef`, `Component`, `@field`, `contains`, `containsMany`, `linksTo`, `linksToMany`, and `getFields` from either Base card-api spelling | The compartment installs a realm-local card-api facade. Schema decorators record inert metadata; they do not expose the trusted Host Base classes. Unknown type-only exports become inert trusted-export tokens. | No             | Implemented in `RealmCompartmentModuleRuntime.cardAPIFacade()`; covered by compartment runtime tests and the compatibility corpus.                                                     |
| Base and Catalog modules imported by package name, canonical URL, or resolved trusted-realm URL                                                        | Import policy canonicalizes the specifier and delegates trusted modules without granting their Loader or network authority to user code.                                                                         | No             | Implemented. The allowlist is URL/principal based, not chosen by a card or query parameter.                                                                                            |
| Boxel icons, approved Boxel UI presentation exports, and the small Ember/Glimmer import vocabulary already used by cards                               | The compartment supplies explicit facades or inert trusted-export tokens.                                                                                                                                        | No             | Implemented, with import-policy and runtime tests. The exported surface must remain an audited allowlist.                                                                              |
| Static formats and metadata: `isolated`, `embedded`, `fitted`, `edit`, `atom`, `displayName`, `icon`, `prefersWideFormat`, and theme/cardInfo metadata | The compiler captures the static descriptors as data. The Host chooses the trusted render container and injects theme variables/cardInfo presentation outside the compartment.                                   | No             | Implemented. This is a projection problem, not a reason to add card APIs.                                                                                                              |
| `@model`, `@fields`, `@format`, `@context`, `@set`, and `@viewCard`                                                                                    | The Host passes data-only projections and narrow callbacks. `@set` becomes a delegated effect that the Host applies to the canonical Store card; `@viewCard` becomes a navigation effect.                        | No             | SES `@set` is wired through delegated FieldDef rendering and browser-verified to persist. The iframe MessageChannel path still needs equivalent coverage and completion.               |
| Nested field rendering such as `<@fields.cardInfo.name />`, contains/containsMany FieldDefs, links, and polymorphic fields                             | The Host exposes contextual field components by lookup without making them enumerable schema. Rendering re-enters the owning realm sandbox with the field/card identity and format.                              | No             | Implemented for lookup and schema enumeration; browser persistence was verified for cardInfo. Broader delegated-field coverage remains in the corpus matrix.                           |
| Template actions receiving browser events                                                                                                              | The Host projects a frozen data snapshot (`type`, keys, pointer coordinates, form value/checked state, and dataset) instead of passing an `Event`, `Element`, or `Window`.                                       | No             | Implemented for data reads. Imperative effects such as `preventDefault()`, focus, blur, pointer capture, and selection require explicit Host effects if existing cards depend on them. |
| `computeVia`, getters, and BXL-backed materialized values                                                                                              | SES evaluates pure card computation in the realm compartment. Iframe rendering should consume the Realm Server/indexed materialized value rather than opening an iframe merely to compute data.                  | No             | Partially implemented and represented in the corpus. The iframe rule is architectural guidance and still needs complete enforcement/coverage.                                          |
| Default Base isolated/edit templates when a card supplies no custom format                                                                             | The trusted Host/Base renderer uses the opaque card projection and contextual fields. No user module or iframe is needed for the fallback template.                                                              | No             | Implemented for the core fallback path; new-file and broken-source/last-known-good behavior still require parity tests.                                                                |
| Realm readability/writability and Store save semantics                                                                                                 | Permissions stay in the Host. Mutations name a card/field/value; the Host validates the principal, updates the canonical Store identity, and saves through the Store.                                            | No             | Implemented for direct opaque-card editing. Relationship/collection mutation and iframe `@set` need additional end-to-end coverage.                                                    |
| Scoped card CSS and theme CSS variables                                                                                                                | The compiler/Host owns selector confinement, stylesheet identity, ref-counting, and theme variable injection.                                                                                                    | No             | Theme projection exists. Hostile CSS confinement is explicitly unfinished and must not be papered over with a new authored API.                                                        |

## New card-facing API

### `safeModifier`

```gts
import { safeModifier } from '@cardstack/boxel-ui/modifiers';

<section {{safeModifier 'observe-size' this.receiveSize}}></section>
```

Supported operations currently include `focus`, `scroll-into-view`, and
`observe-size`. The modifier executes in the trusted renderer and returns only
plain data (for example `{ width, height }`) to SES. It never gives the card an
`Element`, `ResizeObserver`, `document`, or `window`.

This API is **not required for existing staging cards**:

- A new card may opt into it to remain in SES.
- An existing card using a modifier that requires raw DOM authority may run in
  an iframe unchanged.
- For a common legacy modifier operation, the preferred compatibility solution
  is a Host shim keyed by the existing import/export, not a card rewrite.
- Adding another safe operation requires a threat review of its arguments,
  return value, lifetime, cleanup, and authority—not merely adding the method to
  an allowlist.

The iframe height service itself is transport owned by the renderer. Cards do
not import it. The iframe shell uses `safeModifier('observe-size', ...)` (or an
equivalent trusted Host observer) and reports intrinsic size over its private
MessageChannel.

## Runtime bridges that cards do not import

These changes may ship with the Host/runtime, but they must not appear in realm
card source or serialized card data.

| Internal bridge                                                                          | Why it exists                                                                                                                                                                                                                                            | Does current staging card source need it?                                                | Recommendation                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Loader `ModuleEvaluator`, `ModuleRegistration`, and module delegation                    | Allows the same Loader graph to evaluate user modules through SES while sharing trusted Base/Catalog module identities and caches.                                                                                                                       | No                                                                                       | Keep. This is the runtime seam that makes the shim strategy possible.                                                                                                                                                      |
| `createFromSerialized(..., { loader })` and definition-loader preservation during update | Materializes a canonical Store card while resolving its authored definition in the correct realm loader.                                                                                                                                                 | No                                                                                       | Keep as an internal deserialization option. Test identity across Store, Base, and realm loaders.                                                                                                                           |
| Native `instanceof` fast path before code-ref identity walking                           | Lets a Host-created opaque adapter retain legitimate subclass behavior without pretending to be an exported realm definition.                                                                                                                            | No                                                                                       | Keep if tests demonstrate the opaque adapter case; otherwise narrow it further.                                                                                                                                            |
| `CardContext.requestRender`                                                              | Lets trusted Base FieldDefs whose local state lives behind a delegated render root request a rerender.                                                                                                                                                   | No; only branch-updated trusted Base modules call it.                                    | Keep optional and Host-provided. It is a Base/Host context capability, not an authored-card requirement. Prefer ordinary tracked invalidation whenever it crosses correctly.                                               |
| `CardContext.validateCodeRef`                                                            | Lets the trusted Base CodeRef editor validate a reference through the owning realm sandbox without importing user code into the Host graph.                                                                                                              | No; only the trusted Base CodeRef editor calls it.                                       | Keep optional and capability-scoped. It belongs to edit behavior, not core rendering.                                                                                                                                      |
| Opaque synthetic type static format-slot shim                                            | Existing trusted Base Markdown rendering calls `getComponent(linkedCard)`. The linked user card remains opaque, but its Host-created synthetic type exposes `RealmSandboxDelegatedRender` through the ordinary static format slot Base already resolves. | No. Older deployed Base code uses its unchanged `getComponent(instance)` implementation. | Keep Host-owned. Do not add delegation symbols to Base, the opaque instance, authored source, or serialized data. A focused browser test invokes ordinary Base `getComponent()` and verifies the delegated format renders. |

## Accidental Base APIs removed or forbidden

During the cardInfo/edit investigation the branch temporarily added
`setCardFieldValue()` to Base and considered calling an internal
`notifyCardTracking()`. That was the wrong boundary: the staging Base realm did
not export those functions, and a Host sandbox must not make card rendering
depend on deploying them.

The Host now updates the opaque projection, invalidates its targeted data
revision, and saves the canonical card through the Host Store. The unused
`setCardFieldValue()` and `waitForCardLoads()` additions have been removed from
Base. `notifyCardTracking()` remains an internal Base implementation detail and
is not a sandbox ABI.

The same rule applies going forward: a missing Base export is evidence to add a
Host adapter or use an existing public contract, not evidence that all staging
cards should wait for a new Base deployment.

## Known compatibility gaps—not invitations to add card APIs

1. The existing `@set` contract is working for SES delegated FieldDef rendering,
   but must still be carried through iframe MessageChannel transport so the
   same unchanged editable field works in either automatically selected tier.
2. DOM actions beyond safe event data need a small effect vocabulary or iframe
   classification. Raw browser objects must never cross into SES.
3. CSS confinement is incomplete. Fix compiler/Host scoping; do not require
   cards to adopt a new stylesheet API.
4. Iframe fetch, origin, height, and lifecycle are renderer responsibilities.
   They must not become card arguments or URL-selected policy.
5. Surface/playback/viewport coordination remains opt-in and is not part of the
   core card compatibility bar.

## Merge gate

Before calling the sandbox source-compatible, the compatibility corpus must
prove all of the following using unmodified staging card source:

- custom and default formats render in SES;
- delegated FieldDefs and linked cards render and update;
- cardInfo, themes, icons, `prefersWideFormat`, and CSS match the non-sandboxed
  staging Host;
- `computeVia`/BXL values match indexed staging values;
- existing `@set`, `@viewCard`, query, command, and edit flows work through Host
  capabilities;
- DOM-dependent cards are automatically assigned to an iframe or handled by a
  reviewed compatibility shim;
- no test fixture imports `safeModifier` merely to make an existing staging
  card pass.

Any red corpus row should first be classified as a missing shim, projection,
or tier-selection bug. Adding a new card-facing API is the last resort and
requires an explicit compatibility rationale in this ledger.
