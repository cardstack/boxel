# Boxel execution runtime — reviewer's guide

**Status:** describes the branch as built. Companions:
[boxel-rendering-protocol.md](boxel-rendering-protocol.md) is the normative
spec (RP ids cited throughout; the spec wins on disagreement);
[boxel-execution-runtime-architecture.md](boxel-execution-runtime-architecture.md)
is the original design rationale; and
[boxel-capsule-glimmer-dom-review.md](boxel-capsule-glimmer-dom-review.md)
audits the Capsule's Glimmer wire-format bridge and shared-Host-DOM risk for
Ember/Glimmer maintainers. Read this guide once, top to bottom, then review
against the spec.

---

## Layer 0 — the model

Card authors keep main's API unchanged. The Host decides **per module** how
much cage that module's _rendering_ needs. Everything crossing a cage wall
is cloneable data or a parent-validated capability — never a live object,
store, or service.

Three corollaries explain most of the code:

1. **Rendering is tiered; canonical data semantics are not.** The Host still
   evaluates authored modules and holds every canonical instance, exactly as
   main does. That evaluation includes class statics, getters, `computeVia`,
   relationship logic, deserialization, and serialization. Search, save,
   indexing, SSE, and chrome (`card.constructor`) therefore keep main's
   behavior. "Tier" answers _who renders the component/template, in whose
   document_ — it is not a general authored-JavaScript sandbox.
2. **Boundaries speak one grammar.** Validated envelopes, serial dispatch,
   monotonic ordering, bounded timeouts, self-naming refusals. Review one
   lane, and you know the shape of all five.
3. **Authority is declared, then delivered.** What a card may load and see
   is computed from its source and document _before_ it runs, and delivered
   as data or scoped capability. Outside the declared set: visible refusal.
   Inside it: guaranteed delivery or a loud failure — never a silently
   empty box.

## Layer 1 — the tiers

| Tier        | Who executes                                                  | Whose DOM                                  | When                                                  |
| ----------- | ------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| **Direct**  | Host loader + Host Glimmer                                    | Host document                              | Trusted Base and Cardstack package provenance         |
| **Capsule** | SES compartment in the Host process                           | Host document, via reconstructed templates | Authored code with no browser-authority needs         |
| **Sandbox** | Full child app in an origin-isolated, `credentialless` iframe | The child's own document                   | Authored code that needs real DOM / browser libraries |

Vocabulary: a **SES compartment** runs JS with a controlled global scope —
no `document`, `window`, or `fetch` exists inside it; templates are
compiled, inspected, and rebuilt by the Host rather than executed as
authored. A **credentialless iframe** gets a throwaway cookie jar and
storage — the child runs on a realm-user origin but carries none of the
user's credentials; its only connection to anything is one message port.

Every render is stamped for triage:

```html
<div
  data-boxel-execution="sandbox"
  data-boxel-execution-reason="browser-runtime:document,dynamic-inline-style"
></div>
```

Read those two attributes first when debugging any render (RP-6.4).

**The load-bearing bet.** This branch keeps host-side evaluation for
canonical Card API semantics (construction, statics, getters/computeds,
identity, search, serialization, and save) and cages component/template
rendering. Running an authored class to implement those semantics remains a
real Host-authority risk; this prototype does not claim otherwise. What the
tiers remove is authored presentation code's direct access to the Host DOM,
services, Loader, and ambient browser APIs. A future design that also cages
canonical data evaluation requires a store/Card API split and is outside
this branch (RP-6).

## Layer 2 — the spine of a render

```
BoxelExecutionRenderer                  ≈ main's CardRenderer (RP-1.5)
  └─ boxelExecution.requestFor(card, format, surfaceId)
       ├─ 1. classify    module + import graph → direct|capsule|sandbox
       ├─ 2. route       lease a runtime per surface identity
       │                 (a compatible, same-card Sandbox isolated↔authored-
       │                  edit switch RETAINS the exact mounted iframe)
       ├─ 3. materialize serialize canonical instance → projected document
       │                 → runtime builds its own copy via
       │                 createFromSerialized (main's own card-api entry)
       └─ 4. getRenderSlot(format) → template branches:
                 direct slot | capsule component | sandbox iframe
```

Main patterns and where each reappears — **when a runtime path and a main
path disagree, main is the bug oracle** (RP-0.5):

| Proven on main                                                        | Where it lives now                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `defaultFieldFormats` child-format cascade                            | `childFieldFormatsFor` in runtime-common — ONE definition, all tiers (RP-2.6)                            |
| `Box.set` → one `setField` funnel (validate, write, notify, autosave) | Capsule `@set` closures enter the same funnel (RP-9.8); Sandbox writes re-enter it parent-side (RP-20.6) |
| `subscribeToChanges` (what store autosave listens to)                 | Triggers both sync loops — parent→child pushes and child→parent writes                                   |
| `updateFromSerialized` (main's SSE reload)                            | The apply mechanism for pushes and writes, both directions                                               |
| Store's debounced autosave lane                                       | `store.scheduleSave()` — sandbox writes save on main's cadence                                           |
| Permissions provider in stack-item (RP-9.1)                           | Consumed by the renderer, pushed to the child as `{canRead, canWrite}`                                   |
| Theme tokens (`themeScope`/`themeCss`)                                | Host-derived once, crossed as plain strings (RP-5.4)                                                     |

## Layer 3 — the boundary grammar

One private `MessagePort`, established by a nonce-bound bootstrap: the
iframe URL carries a random `bootstrapId`; the child announces it; the
parent verifies exact origin + id, transfers one port, and tears down
window messaging. Everything after that is port-scoped. There is no second
door.

Five lanes multiplex on the port by envelope `kind`:

| Lane          | Direction      | Carries                                                                                |
| ------------- | -------------- | -------------------------------------------------------------------------------------- |
| Runtime RPC   | parent → child | `loadBoxel`, `createFromSerialized`, `describeBoxel`, `serializeCard`…                 |
| Render family | parent → child | `render`, `clear`, `draft` (HMR), `updateInstance` (RP-20.5), `updateContext` (RP-9.1) |
| Fetch         | child → parent | exact admitted module reads + exact projected, bounded image reads                     |
| Surface       | child → parent | height/presentation requests (RP-16)                                                   |
| Write         | child → parent | instance-write proposals (RP-20.6)                                                     |

A request and its refusal, concretely:

```ts
// child → parent, over the fetch lane:
{ kind: 'boxel-sandbox-fetch-request', requestId: 'module:7',
  url: 'https://realm/contacts.gts', headers: [...] }

// parent checks the EXACT url against the classified graph BEFORE any
// authenticated fetch fires. Not entitled → the child's import rejects:
Error: Sandbox module read is outside its classified graph:
       https://realm/contacts.gts
```

Shared discipline to spot-check in any transport file:

```ts
// 1. envelope validated before dispatch (plain predicates, bottom of file)
if (!isSandboxWriteRequest(value)) return;
// 2. serial dispatch — one promise queue per lane, arrival order
this.queue = this.queue.then(() => this.dispatch(request)).then(...)
// 3. ordering tokens with supersede-drop
if (request.seq < this.latestSeqSeen) throw new SandboxWriteSuperseded(...)
// (the sender treats a drop as success: every message carries COMPLETE
//  state, so the newer one already contained everything the older did)
// 4. bounded timeouts — silence is a protocol violation (RP-15.3)
`Sandbox write timed out after 10000ms waiting for the parent to confirm`
```

## Layer 4 — the sync loop that must terminate

Down (RP-20.5) and up (RP-20.6) are mirror images:

```
canonical instance mutated (host side)          authored code mutates model
  └─ subscribeToChanges fires                     (inside the child)
       └─ coalesce, serialize FULL state            └─ subscribeToChanges fires
            └─ updateInstance push ↓                     └─ coalesce, serialize
                 └─ child: updateFromSerialized               └─ write proposal ↑
                    (in place — no remount)                        └─ parent: verify
                                                                     doc id == the ONE
                                                                     card this process
                                                                     renders, apply,
                                                                     scheduleSave()
```

**Doesn't this loop?** Push → child applies → child's subscription fires →
write → parent applies → parent's subscription fires → push → … No. The
reason is a card-api property main itself depends on (its SSE reload must
not trigger a re-save):

```ts
// card-api _updateFromSerialized: writes the data bucket directly.
deserialized.set(field.name, value); // NO notifySubscribers(...)
notifyCardTracking(instance); // Glimmer re-renders bindings only
```

An applied push can never fire the write subscription; an applied write can
never fire the push subscription. Termination is structural — there are no
suppression flags to get wrong (an earlier draft had them; finding this
property let us delete them).

One asymmetry: an applied write fans out to every _other_ view of the card,
but **never echoes to the writer**. The writer's child already holds what
it wrote, and applying a serialized document replaces nested compound field
instances — remounting `{{each}}` DOM and destroying an open inline editor
for zero data change (RP-20.3's known limit, shared with main). Main's
mutating view likewise only ever sees its own tracked updates.

## What card authors see

Nothing new is required. This card runs unchanged on main and on every tier:

```gts
export class Product extends CardDef {
  @field name = contains(StringField);
  @field price = contains(NumberField);
  @field vendor = linksTo(() => Vendor);

  static isolated = class extends Component<typeof Product> {
    updatePrice = (ev: Event) => {
      // main's in-place edit idiom — a plain model assignment.
      // Direct: mutates the live instance, autosaves.
      // Sandbox: mutates the child copy, crosses the write lane,
      //          applies to the canonical instance, autosaves.
      // The author neither knows nor cares which happened.
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

Behavior at the edges, per cage:

```gts
// CAPSULE — works:
{{on 'click' this.pick}}                    // the one supported modifier
<style scoped> .row { color: red; } </style> // scoped CSS, same as main
get isBrowser() { return typeof window !== 'undefined'; } // probe: exempt

// CAPSULE — routes the module to Sandbox instead (classifier signals):
{{someElementModifier}}                      // modifier receives live element
style="width: {{this.w}}px"                  // dynamic inline style
document.querySelector(...)                  // DOM call
import * as THREE from 'three';              // browser-authority import
:global(.toast) { ... }  /  @font-face       // global / document-level CSS
<div popover>                                // top-layer attribute
```

Capsule handlers receive a reduced **SafeEvent** (RP-14.1) — scalar
properties and dataset copied, live `Event`/elements withheld:

```ts
pick = (ev: SafeEvent) => {
  ev.target?.value; // ✓ scalars cross
  ev.key;
  ev.clientX; // ✓
  (ev.target as any).closest('.row'); // ✗ no live element crossed
};
```

Sandbox cards get a full, real document — real events, real modifiers,
three.js, canvas — but their _data world_ is the declared world (own
document, declared links delivered in pushes, declared queries; ambient
search and arbitrary `fetch` refuse visibly, RP-21.3). Declarative images
also require an exact parent-projected resource URL; denial leaves the image
unloaded instead of restoring the authored URL as an ambient egress path.

**Format containment (RP-6.3):** compact formats of a Sandbox module render
in Capsule — a gallery of fifty fitted tiles is never fifty iframes. `edit`
renders the trusted Base editor host-side _unless the module authors any
`static edit`_ (card-level or FieldDef-level). Only that compatible,
same-card Sandbox-to-Sandbox transition uses the retained-slot fast path;
changing cards, template identity, or execution tier takes the ordinary
request/materialization path:

```gts
// This FieldDef makes the whole module's edit surface keep the Sandbox —
// authored edit code never runs below its module's tier, and it keeps the
// SAME retained iframe as isolated, so editor state survives the switch:
class CurrencyField extends FieldDef {
  static edit = class extends Component<typeof this> {
    <template>
      <input value={{@model.value}} {{on 'change' this.set}} />
    </template>
  };
}
```

Principle: edit demotes only when demoting executes **no authored template
at all**.

## The classifier — defaults chosen for compatibility

Goal: **realms authored against main render correctly with zero edits.**
Order of decision:

```
trusted realm?             → Direct        (provenance, not code inspection)
browser signal in module   → Sandbox       (signals listed above)
  or via static import edge
otherwise                  → Capsule       (the default cage)
```

Details that matter:

- **Module-based** (RP-6.2): all formats in one module share its route.
  Promotion follows _static import edges_ only. Ambient-global tokens in a
  dependency do NOT promote importers — libraries often carry dormant
  browser adapters SES can safely leave unavailable.
- **`typeof` probes are exempt** — feature detection is not a dependency.
- Candidate source signals are found in comment/string-masked text, then
  confirmed with Babel scope/AST checks. `window`, `document`,
  `globalThis.document`, `self['document']`, and destructured global access
  are covered; shadowed bindings and `typeof` probes remain exempt.
- Classification collects the complete reachable static graph first, then
  computes promotion in a deterministic second pass. Diamond/cyclic graph
  import order cannot change the answer.
- **Every ambiguity resolves upward** (R5): a false positive costs an
  iframe boot (smoothness); a false negative would cost containment. We
  always pay the smoothness price. Escape hatch upward exists
  (`static prefersFullSandbox = true`); there is none downward.

## Ideal authoring — speed, power, smoothness

The unit of classification is the module, so module layout is the
performance lever. The before/after that matters most:

```
// BEFORE: one module — every gallery tile pays the sandbox toll
product.gts
  ├─ class Product (fields)
  ├─ static embedded / fitted   ← simple markup, no browser needs
  └─ static isolated            ← three.js configurator

// AFTER: three modules — tiles render instantly in Capsule,
// only the full-screen view boots an iframe
product.gts            fields only                    → Capsule
product-tiles.gts      embedded/fitted/atom           → Capsule
product-configurator.gts  isolated + three.js         → Sandbox
```

The rest of the checklist:

```gts
// don't buy the Sandbox by accident:
style="width: {{this.w}}px"          // ✗ dynamic inline style
<div class='bar' style='--w: 40%'>   // ✗ still dynamic if interpolated
<div class='bar bar--wide'>          // ✓ class toggle + scoped CSS
if (window.matchMedia(...))          // ✗ bare global
if (typeof window !== 'undefined')   // ✓ probe, exempt

// declare data; don't fetch it:
@field related = linksToMany(() => Product);          // ✓ delivered + live-synced
@field top = containsMany(Entry, { query: {...} });   // ✓ parent-evaluated (RP-7.6)
await fetch('https://realm/_search?...')              // ✗ ambient — refused in cages

// author `static edit` deliberately: it opts the edit surface into the
// retained iframe (state survives isolated↔edit). Omit it → free host-side
// standard editor. Either is fine; make it a choice.
```

## The security model

Two orthogonal axes (RP-21):

- **Containment** — how much browser authority the _rendering_ needs.
  Chosen by the classifier from code evidence. This is what tiers are.
- **Entitlement** — what the card may _know and do_. A function of module
  provenance and card declaration ONLY. Capsule and Sandbox hold the same
  trust grade and receive **identical entitlements**.

Why the axes must not collapse: if entitlement keyed off tier, an attacker
writes deliberately DOM-free code, classifies Capsule, and _gains_ reach.
The cage you get must never change what you are allowed to touch.

Four entitlement grades (RP-21.2):

| Grade               | What                                                                                        | Example                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **declared**        | own document + declared links + declared queries, always delivered as parent-evaluated DATA | every authored card                                                             |
| **display-only**    | host-rendered surface, no read-back, no egress                                              | Capsule's `searchResultsComponent` key                                          |
| **mediated action** | parent validates + executes in parent chrome                                                | `viewCard`; future CRUD lane                                                    |
| **ambient**         | search / arbitrary data reach                                                               | trusted provenance ONLY — never grantable by classification, format, or request |

**"Can a card search your contact book?"** — an ambient-grade question;
unconditionally no for authored code in any cage. Exfiltration needs read
AND egress; both are independently denied (no ambient read; no `fetch` in
Capsule scope; every Sandbox request dies at the gated port).

What to verify rather than trust, with the code that enforces it:

```ts
// Sandbox: distinct origin is mandatory, credentialless is set
if (childOrigin === globalThis.location.origin) reject(...)
if (!supportsCredentiallessIframe()) reject(...)
iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
iframe.setAttribute('credentialless', '');

// fetch gate: exact-URL allow list, pre-authorization, redirect re-check
if (!this.isAllowed(request.url)) throw new Error('...outside its classified graph...')
if (!this.isAllowed(response.url)) throw new Error('...escaped its classified graph...')
if (body.byteLength > maxModuleBytes) throw ...

// media uses a separate exact projected-resource set; only successful image
// responses cross, and error bodies are never exposed to authored code
if (!isProjectedResource(request.url)) throw ...
if (!response.ok || !contentType.startsWith('image/')) throw ...

// Capsule: the @context handed to authored code is frozen to exactly two
// presentation keys — unit-pinned against a deliberately fat host context
projectCapsuleContext(fatContext) // → { cardComponentModifier?, searchResultsComponent? }

// write authority: ONE entitled receiver per process, identity-checked
if (unresolve(document.data.id) !== unresolve(card.id))
  throw new Error(`... does not match the card this process renders`);
// related resources are read-only: relationship targets must already be in
// the parent's projection and incoming `included` is replaced canonically
constrainSandboxWriteDocument(incoming, currentProjection)
```

Capsule dynamic imports receive the named
`CAPSULE_DYNAMIC_IMPORT_DENIED` policy refusal; the real Host Loader never
crosses as `import.meta.loader`.

**Known containment limit:** Capsule executes on the Host main thread. SES
removes ambient capabilities but does not preempt computation, so an infinite
loop can wedge the tab and has no termination control. Worker/process
execution is a production-hardening follow-up, not something this branch
claims to solve.

**Sandbox deployment gate:** a hosted environment must set an explicit
`BOXEL_SANDBOX_RUNTIME_URL` on a distinct realm-user origin. The Host allocates
a fresh 128-bit nonce hostname for each Sandbox process; staging uses
`<nonce>.boxelusercontent.dev` and production uses
`<nonce>.boxelusercontent.com`. The Worker in
`host/sandbox-runtime-worker/` serves only the bootstrap document and its
content-addressed Host assets, strips credentials, and applies restrictive
CSP/referrer/permissions/nosniff headers. Each zone therefore needs the
Worker routes in `wrangler.jsonc` plus a proxied wildcard DNS record (`AAAA *`
to the originless placeholder `100::`). The Host refuses same-origin/missing
configuration and browsers without `credentialless` support; deployment must
stay disabled until that edge boundary resolves and `/healthz` succeeds.
The CSP has one deliberate third-party egress exception: stylesheets may load
from the exact `https://fonts.googleapis.com` origin and font binaries from
the exact `https://fonts.gstatic.com` origin. It does not allow wildcard
Google origins or Google access from script, connect, image, or media lanes.
Google receives the requested URL, client IP, and user agent, while
`credentialless` plus `Referrer-Policy: no-referrer` exclude cookies and the
parent/card URL.

Failure posture: fail closed and say so. Silence after an ack is a protocol
violation (RP-15.3); unavailability must refuse visibly (RP-21.3); nothing
ever falls back to a weaker cage (R5). Excluded by design, with conformance
tests asserting the denial (RP-17.2): authored code executing Direct,
cross-realm search without an explicit grant, arbitrary DOM/CSS mutation
from Capsule, any generic "give me the element" escape hatch.

Note: Boxel is not validate-on-write — validation is post-save (the future
guide system) — so the write lane's error path exists for transport faults
and identity violations, not as a validation UX.

## Where to look

| Concern                          | File                                                                             |
| -------------------------------- | -------------------------------------------------------------------------------- |
| Classification + routing         | `host/app/lib/boxel-source-classifier.ts`                                        |
| Session/engine spine             | `host/app/lib/boxel-execution-engine.ts`, `host/app/services/boxel-execution.ts` |
| The renderer (every tier branch) | `host/app/components/boxel-execution-renderer.gts`                               |
| Capsule evaluator + facade       | `host/app/lib/capsule-module-evaluator.ts`                                       |
| Sandbox process (parent)         | `host/app/lib/sandbox-runtime-process.ts`                                        |
| Sandbox child shell              | `host/app/components/boxel-sandbox-runtime.gts`                                  |
| Transports (read one, know all)  | `host/app/lib/sandbox-{render,fetch,surface,write}-transport.ts`                 |
| Cross-boundary types             | `runtime-common/boxel-execution-protocol.ts`                                     |
| Capsule entitlement boundary     | `host/app/lib/capsule-context-projection.ts`                                     |

**Enforcement:** every normative statement carries an RP id; CI enforces a
statement↔test bijection (`scripts/check-rp-bijection.mjs`) — a statement
with no test and a test citing no statement both fail the build. The
capability matrix at the end of RP-21 is the one-page index: every
capability × tier, with grade, delivery, build status, and owning
statement.
