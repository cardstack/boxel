# Boxel execution runtime — reviewer's guide

**Status:** describes the branch as built (`codex/boxel-execution-runtime-architecture`).
Companions: [boxel-rendering-protocol.md](boxel-rendering-protocol.md) is the
normative spec (every claim here cites its RP ids);
[boxel-execution-runtime-architecture.md](boxel-execution-runtime-architecture.md)
is the original design rationale. This guide is the narrative bridge: read it
top to bottom once, then use the protocol doc as the reference.

---

## Layer 0 — the one-sentence model

Card authors keep main's authoring API unchanged; the Host decides **per
module** how much cage its _rendering_ needs; and everything that crosses a
cage wall is either cloneable data or a mediated, parent-validated
capability — never a live object, store, or service.

Three corollaries that explain most of the code you will review:

1. **Rendering is tiered; data is not.** The Host still evaluates every
   module and holds every canonical instance exactly as main does. Only the
   question "whose Glimmer renders this template, in whose document?" gets a
   per-module answer.
2. **Boundaries speak one grammar.** Every lane across a cage wall uses the
   same discipline: validated envelopes, serial dispatch, monotonic
   ordering, bounded timeouts, self-naming refusals.
3. **Authority is declared, then delivered.** A caged card receives exactly
   what its module graph and card document declare — as materialized data or
   scoped capabilities — and can neither request more nor silently lose what
   it is entitled to.

## Layer 1 — the tiers

| Tier        | Who executes the module                                     | Whose DOM                            | When                                                  |
| ----------- | ----------------------------------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| **Direct**  | Host loader, Host Glimmer                                   | Host document                        | Trusted-realm modules (Base, catalog, skills)         |
| **Capsule** | SES Compartment (Host process)                              | Host document, via reified templates | Authored modules with no browser-authority needs      |
| **Sandbox** | Full child app in an origin-isolated, credentialless iframe | The child's own document             | Authored modules that need real DOM/browser authority |

The mounted tier is stamped as `data-boxel-execution` with a
`data-boxel-execution-reason` diagnostic (RP-6.4) — the first thing to read
when triaging any render.

**The load-bearing architectural bet** (and the main divergence from the
frozen reference branch): the Host keeps executing authored modules for
_data_ purposes — deserialization, identity, search, save, indexing all run
against real classes host-side, so main's store, autosave, SSE, and chrome
(`card.constructor`, type introspection) are untouched. The branch deletes
only 75 lines of main. The frozen branch removed host-side classes entirely
and paid for it with deep interleaving into the store and ~11 chrome
call-site rewrites; we pay instead with a discipline: **authored templates
never render host-side below their tier** — data-trust and render-trust are
decoupled on purpose.

## Layer 2 — the spine of a render

Follow one card from stack to pixels; every stage has a main analog:

```
BoxelExecutionRenderer (≈ main's CardRenderer, RP-1.5-identical seeding)
  └─ BoxelExecutionService.requestFor(card, format, surfaceId)
       ├─ classify: BoxelModuleGraphClassifier over the resolved import
       │    graph (RP-6) → direct | capsule | sandbox + reason
       ├─ route: BoxelRuntimeRouter leases a runtime per surface identity
       │    (a Sandbox process is RETAINED across format switches — the
       │    iframe never reloads on isolated↔edit)
       ├─ materialize: serialize the canonical instance to a projected
       │    execution document; the runtime materializes its own copy
       │    (createFromSerialized — the same card-api entry main uses)
       └─ getRenderSlot(format) → the renderer's template branches:
            direct slot | capsule component | sandbox iframe slot
```

Main patterns you already trust, and where each reappears:

| Proven on main                                         | Where it lives now                                                                                                                |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `defaultFieldFormats` child-format cascade             | `childFieldFormatsFor` in runtime-common — ONE definition consumed by every tier (RP-2.6)                                         |
| `Box.set` — all mutation through one `setField` funnel | Capsule `@set` closures invoke the same funnel (RP-9.8); Sandbox writes arrive as documents and re-enter it parent-side (RP-20.6) |
| `subscribeToChanges` — what store autosave listens to  | The identical signal triggers both sync loops: parent→child pushes and child→parent writes                                        |
| `updateFromSerialized` — main's store reload on SSE    | The apply mechanism for every push and every write, both directions                                                               |
| Store's debounced autosave lane                        | `store.scheduleSave()` — sandbox writes persist with the exact cadence a host-side setter would have                              |
| Permissions provider in stack-item (RP-9.1)            | Consumed by the renderer, pushed to the child as a cloneable snapshot                                                             |
| Theme scope tokens (`themeScope`/`themeCss`)           | Derived host-side once, crossed as plain strings (RP-5.4)                                                                         |
| Scoped-CSS pipeline                                    | Same pipeline; Capsule adds admission policy, Sandbox runs it natively in the child                                               |

The review heuristic this table supports: **when a runtime path and a main
path disagree, main is the bug oracle** (RP-0.5 — Direct is the reference
implementation).

## Layer 3 — the boundary grammar

Five lanes cross the Sandbox wall, all multiplexed on one private
`MessagePort` established by an origin-checked, nonce-bound bootstrap
(`sandbox-runtime-process.ts`). Each lane is a client/server pair with the
same shape — read one transport file and you have read them all:

| Lane          | Direction      | Purpose                                                                                                                                            |
| ------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime RPC   | parent → child | `loadBoxel`, `createFromSerialized`, `describeBoxel`, `serializeCard`… (the BoxelRuntime interface)                                                |
| Render family | parent → child | `render`, `clear`, `draft` (HMR), `updateInstance` (RP-20.5), `updateContext` (RP-9.1) — one monotonic generation sequence, stale requests dropped |
| Fetch         | child → parent | Module reads pre-authorized against the exact classified graph; bounded media lane for realm images                                                |
| Surface       | child → parent | Height/presentation capability requests (RP-16)                                                                                                    |
| Write         | child → parent | Full-document instance-write proposals (RP-20.6), child-owned seq                                                                                  |

Shared discipline (verify it in any transport you spot-check): envelope
validated before dispatch; serial promise-queue per lane; ordering tokens
(generation or seq) with supersede-drop semantics; bounded ack timeouts
(silence is a protocol violation, RP-15.3); refusals that name themselves.

## Layer 4 — the sync loop that must terminate

The subtlest part of the branch; hold these four facts together:

1. **Down:** a canonical-instance mutation fires `subscribeToChanges` →
   coalesced serialize → `updateInstance` push → child applies in place
   (RP-20.5).
2. **Up:** an authored mutation in the child fires the child's
   `subscribeToChanges` → coalesced serialize → write proposal → the ONE
   entitled receiver validates the card identity, applies to the canonical
   instance, schedules the debounced save (RP-20.6).
3. **Termination is structural, not flag-based:** `updateFromSerialized`
   writes the data bucket without firing change subscribers (a card-api
   property main's own SSE reload already depends on) — so an applied push
   can never re-trigger the write subscription, and an applied write can
   never re-trigger the push subscription. There is no suppression state to
   maintain or get wrong.
4. **The writer never hears its own echo:** an applied write fans out to
   every _other_ view of the card; the writer's child already holds what it
   wrote, and an echo would remount compound-field DOM for zero data change
   (RP-20.3's known limit) — exactly matching main, where the mutating view
   sees only its own tracked updates.

## What card authors see

**Nothing new is required.** The authored surface is main's, verbatim:

```gts
export class Product extends CardDef {
  @field name = contains(StringField);
  @field price = contains(NumberField);
  @field vendor = linksTo(() => Vendor);

  static isolated = class extends Component<typeof Product> {
    updatePrice = (ev: Event) => {
      // Main's in-place edit idiom — a plain tracked-model set. In the
      // Sandbox this same line now persists through the write leg; the
      // author neither knows nor cares which tier is mounted.
      this.args.model.price = Number((ev.target as HTMLInputElement).value);
    };
    <template>
      <h1>{{@model.name}}</h1>
      <input value={{@model.price}} {{on 'change' this.updatePrice}} />
      <@fields.vendor @format='embedded' />
    </template>
  };
}
```

What changes _behaviorally_ per tier — the honest list:

- **Capsule:** no `document`/`window`, no element-receiving modifiers (only
  `{{on}}`); event handlers receive the reduced `SafeEvent` projection
  (RP-14.1); dynamic inline `style=` strings and global/unscoped styles are
  not available (they are Sandbox signals — see the classifier). Scoped
  `<style scoped>` works identically to main.
- **Sandbox:** full DOM, real events, third-party browser libraries — but
  the card's world is its _declared_ world: its own document, its declared
  links (included in pushes), its declared query fields (delivery in
  flight, RP-17.1). Ambient search and arbitrary `fetch` do not exist and
  will refuse visibly rather than render empty (RP-21.3).
- **Edit surfaces (RP-6.3):** compact formats (`fitted`/`atom`/`head`/
  `markdown`) of a Sandbox module always render in Capsule — composition
  never creates inline iframes, so a gallery of fifty tiles is never fifty
  iframes. `edit` renders the trusted Base editor host-side _unless the
  module authors any `static edit` template_ (card-level or FieldDef-level)
  — authored edit code keeps the Sandbox, in the SAME retained iframe as
  isolated, so in-editor state survives the format switch.

## The classifier — compatibility defaults, stated as choices

Design goal: **existing main-authored realms render correctly with zero
edits.** The default is therefore the most-capable cage that will actually
run the code, not the cheapest one:

- Trusted-realm provenance → **Direct**. Everything else starts at
  **Capsule** and is promoted to **Sandbox** only on concrete browser
  signals in the module or its graph: browser-authority imports
  (`three`, `ember-modifier`, …), unbound browser globals (with a
  `typeof x !== 'undefined'` probe exemption — feature detection is not a
  dependency), DOM-method calls, dynamic or quoted inline `style`
  attributes, global/document-level styles, top-layer attributes
  (`popover`, `command…`).
- **Module-based, not format-based** (RP-6.2): all formats of one module
  share its route; promotion follows _static import edges_ (a library's
  dormant browser adapter does not promote its importers).
- **Fail-safe direction only** (R5): every ambiguity resolves toward the
  stronger cage; nothing ever de-escalates. `static prefersFullSandbox`
  exists as an author escape hatch upward; there is no escape hatch
  downward.
- The costs are named, not hidden: Sandbox boots a full child app (hundreds
  of ms, covered by the prerender placeholder), and a false-positive
  promotion costs smoothness, never correctness.

## Ideal authoring — getting the most out of the platform

The defaults make everything work; module layout decides how _fast and
smooth_ it is. The platform rewards separation:

1. **Split presentation weight by format.** Keep `embedded`/`fitted`/`atom`
   in a module free of browser signals — those are your composition
   formats, and Capsule renders them in-document, instantly, iframe-free.
   Put the WebGL/canvas/heavy-DOM isolated experience in its own module
   (RP-6.2 gives each module its own route). One import edge between them
   costs nothing; one merged module makes every gallery tile pay the
   sandbox toll.
2. **Split data shape from presentation.** A fields-only module (the type,
   its serializers, its computed fields) classifies Capsule-or-better
   forever, keeps schema-level reuse cheap, and never gets dragged into an
   iframe by a presentation dependency.
3. **Don't buy the sandbox by accident.** Scoped styles instead of global;
   class toggles or static style constants instead of interpolated
   `style="{{…}}"` strings; `typeof window` guards around environment
   probes. Each avoided signal keeps a module in the lighter cage.
4. **Declare data; don't fetch it.** `linksTo`/`linksToMany` and query
   fields (`options.query`) are the entitlement-correct data path: parent-
   evaluated, pushed as data, live-synced. Imperative fetching is the
   ambient grade — refused in cages.
5. **Author `static edit` deliberately.** It is the opt-in to an in-iframe
   editing experience with retained state and write-leg persistence. If the
   standard Base editor serves the card, omit it and get the host-side form.
6. **Theme through `cssVariables`** (the Theme card contract) — themes cross
   every boundary as strings; hand-rolled global CSS crosses none.

## Security model

Two orthogonal axes (RP-21 — the load-bearing separation):

- **Containment** (RP-6): how much browser authority the module's rendering
  needs, and which cage delivers it. Chosen by the classifier from code
  evidence.
- **Entitlement** (RP-21): what the card may know and do. A function of
  module provenance and card declaration ONLY. Capsule and Sandbox hold the
  same trust grade — untrusted authored code — and receive **identical
  entitlements**; keying authority off the tier would let an author write
  deliberately DOM-free code to classify Capsule and _gain_ reach.

Entitlement grades (RP-21.2): **declared** (own document, declared links,
declared queries — delivered as parent-evaluated data, never as query
capability) → **display-only** (host-rendered surfaces with no read-back and
no egress) → **mediated action** (parent-validated, user-visible: `viewCard`;
future CRUD) → **ambient** (search/data reach — trusted provenance only,
never grantable by classification, format, or request). "Can it search your
contacts?" is an _ambient_-grade question with an unconditional no for
authored code in any cage; the future guide/trust-badge system grants
upward per module without touching containment.

Cage properties a reviewer should verify rather than trust:

- **Sandbox isolation:** distinct origin (rejected if it equals the Host's),
  `credentialless` (no ambient cookies/storage), nonce-bound bootstrap with
  exactly one transferred port, no ambient network — every fetch
  pre-authorized against the exact classified module graph (no pattern
  matching), response-URL escape re-checked after redirects, size-capped,
  self-naming refusals _before_ any host-credentialed fetch fires.
- **Capsule confinement:** SES compartment scope (no `document`, no
  `fetch`), reified templates rendered by Host Glimmer, element-receiving
  modifiers rejected, CSS admission policy, `SafeEvent` reduction, and an
  `@context` projection frozen to exactly two enumerated presentation keys
  (`projectCapsuleContext` — unit-pinned against a deliberately fat host
  context).
- **Write authority:** one entitled receiver per process, registered by the
  sync connection that knows the ONE canonical card; incoming documents are
  identity-validated before anything applies; persistence, permissions, and
  realm arbitration never leave the parent. Boxel is not validate-on-write
  (validation is post-save, the guide system) — the error lane exists for
  transport faults and identity violations, not a validation UX.
- **Failure posture:** fail closed and _say so_. Silence after an ack is a
  protocol violation (RP-15.3); silent unavailability is prohibited
  (RP-21.3); nothing ever falls back to a weaker cage (R5).
- **Excluded by design** (RP-17.2, conformance-asserted): authored code
  executing Direct; cross-realm search without an explicit grant; arbitrary
  DOM/CSS mutation from Capsule; generic DOM-request escape hatches.

## Where to look

| Concern                          | File                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Routing + classification         | `host/app/lib/boxel-source-classifier.ts`                                        |
| Session/engine spine             | `host/app/lib/boxel-execution-engine.ts`, `host/app/services/boxel-execution.ts` |
| The renderer (all tier branches) | `host/app/components/boxel-execution-renderer.gts`                               |
| Capsule evaluator + facade       | `host/app/lib/capsule-module-evaluator.ts`                                       |
| Sandbox process (parent)         | `host/app/lib/sandbox-runtime-process.ts`                                        |
| Sandbox child shell              | `host/app/components/boxel-sandbox-runtime.gts`                                  |
| Transports (read one, know all)  | `host/app/lib/sandbox-{render,fetch,surface,write}-transport.ts`                 |
| Cross-boundary types             | `runtime-common/boxel-execution-protocol.ts`                                     |
| Entitlement boundary             | `host/app/lib/capsule-context-projection.ts`                                     |

**Enforcement:** every normative statement in the protocol doc is bijected
to a conformance test by CI (`scripts/check-rp-bijection.mjs`) — a statement
without a test and a test citing no statement both fail the build. The
capability matrix at the end of RP-21 is the one-page index of everything
above, row by row, with build status.
