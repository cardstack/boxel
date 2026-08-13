# Foreign-Framework Probes: Architectural Checks

> **Status: informative, OUT OF SCOPE.** Nothing in this document is planned,
> committed, or part of the execution-runtime project. These are thought
> experiments — we point a foreign framework at the architecture and record
> which of our laws answered the question. If a law answers cleanly, the
> layering is real. If we would have needed to patch the protocol to make the
> example fit, the layering is coupling in disguise. No statement here is
> normative; the normative protocol lives in
> [boxel-rendering-protocol.md](boxel-rendering-protocol.md) and this document
> deliberately lives outside its bijection ratchet.

## Why probe with frameworks we don't support

The project rule is: use random examples to improve the official protocol,
never patch the protocol to fit an example. A foreign framework is the
strongest random example available, because it shares _nothing_ with Glimmer —
no template layer, no tracking system, no component model. Every place the
architecture answers a React or Starbeam question without modification is
evidence that a layer boundary is where we drew it. Every place it can't
answer is a seam worth naming, even if we never build the thing.

Three probes, run in conversation on 2026-08-07. Each records: the question,
what needed zero platform change, what didn't, and which law decided it.

---

## Probe 1 — a React card in the Sandbox

**Question.** Can an authored card render its body with `react-dom` inside the
Sandbox tier, using only the plumbing that exists today?

**Answer: yes, with a ~15-line authored shim and zero platform changes.**
The reason it works is the load-bearing bet the whole runtime rides on: the
boundary contract is _serialized documents and operations_, not Glimmer. The
parent never asks what framework rendered the child's DOM.

What works untouched, and the law that makes it work:

| Concern             | Why it works                                                                                                                                                                                                                | Law                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Child→parent writes | The RP-20.6 forwarder hooks `subscribeToChanges` on the **instance**, not the template. `model.price = 42` from React code fires the card-api setter, and the forwarder serializes, ships, applies, and schedules the save. | Data plane is tiered below the render plane.           |
| Height              | The intrinsic-height reporter measures DOM. It cannot tell `createRoot` output from Glimmer output.                                                                                                                         | Measurement is a DOM concern, not a framework concern. |
| Security            | Fetch gate, entitlement graph, permissions push are ambient, enforced at the MessagePort. Authored code never imports them, so foreign code cannot opt out of them.                                                         | RP-21: entitlement is orthogonal to what renders.      |
| Classification      | `react-dom` means owning real DOM, which is exactly what Sandbox exists to contain.                                                                                                                                         | R5: escalation to Sandbox is the safe default.         |

**The one genuine mismatch: parent→child push visibility.** By the
loop-termination law, an applied `updateFromSerialized` writes buckets and
calls `notifyCardTracking` — it deliberately never fires `subscribeToChanges`
(that is what makes the sync loop terminate). Glimmer sees pushes through
tracked invalidation; React has no tracking frames, so it would not. The
bridge must read model fields _inside_ a Glimmer tracking frame and re-push
props when the frame invalidates. A modifier is the natural frame:

```gts
static isolated = class extends Component {
  <template><div {{mountReact @model}}></div></template>
}
// mountReact: a modifier whose arg reads consume the tracked fields
// (that consumption is what makes parent pushes reach React),
// then root.render(<App {...props} />) on each re-run.
```

**Minimal imports beyond React itself: exactly one module plus a modifier.**

1. `@cardstack/base/card-api` — unavoidable; it is the data contract. The
   class must still be a `CardDef`/`FieldDef` or nothing on either side of the
   boundary knows how to serialize it.
2. `ember-modifier` (or equivalent) — the mount bridge above.

No sandbox imports, no transport imports, no protocol awareness in authored
code at all.

**Caveats.** (a) React delivery rides the module fetch gate, i.e. the same
`authedFetch` pipeline where the un-root-caused CDN bundle bug lives (the
prosemirror failures). (b) The shim is authored code — the _platform_ needs
zero changes, but each React card (or a shared realm `react-adapter.gts`)
needs the bridge module.

**Check result: PASS.** The protocol needed no change. One seam recorded (push
visibility is a reactivity-substrate question — see Probe 3, which is where
that seam actually belongs).

---

## Probe 2 — React in the Capsule

**Question.** Same card, Capsule tier?

**Answer: `react-dom`, never; the React _authoring model_, plausibly — and the
distinction is itself the law.** React's foundational assumption is "give me a
real element and I own it": `createRoot`, direct node mutation, its own
delegated event system on live DOM. Capsule's foundational invariant is
"authored code never touches a live element": templates are reified into
records, the host materializes DOM, events return only as SafeEvent
projections through `on`. These contracts are directly opposed. You cannot
hand react-dom a node without destroying the exact property that makes Capsule
host-DOM-safe. Per R5, nothing softens this: a module importing `react-dom`
classifies Sandbox, full stop.

The principled path that remains is a **custom React renderer targeting
reified records**. React officially supports custom render targets via
`react-reconciler` (react-native, react-three-fiber, and ink exist this way,
none touching a browser DOM). Our reified-template lane already _is_ a custom
render target — Glimmer authors a description, the host materializes it. A
reconciler host config emitting the same records would slot into the same
lane:

- JSX, hooks, `useState`, composition all work (reconciler-side, DOM-free).
- Commits become record updates the host projects, like a Glimmer re-render.
- React's synthetic event system is _replaced_ by SafeEvent through `on`, not
  bridged.
- The data plane needs nothing: `@model` is already a live read-through
  projection, so Capsule doesn't even need the RP-20.6 transport — the host
  owns the instance.
- Such an adapter imports no DOM APIs, so it legitimately classifies Capsule.
  It is not an escalation dodge; it genuinely lives within the containment.

The honest cost: **React the programming model, not React the ecosystem.**
Any npm component assuming real DOM — refs, `useLayoutEffect` measurement,
portals, editor wrappers — breaks. That is not an implementation gap; it is
the entropy-reducing line: _ecosystem code that demands DOM ownership belongs
in Sandbox; authoring-model code that describes UI can live in Capsule._ The
same law we already apply to Glimmer, extended unchanged to a second syntax.

|                                               | Sandbox                          | Capsule                                                                                |
| --------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| React ecosystem (`react-dom`, npm components) | works today via the Probe-1 shim | never — violates the containment itself                                                |
| React authoring model (JSX + hooks)           | trivially                        | possible via a `react-reconciler` → reified-record adapter; a real project, not a shim |

**Check result: PASS — the tier laws sharpened rather than bent.** "DOM
ownership" turns out to cleanly classify an entire foreign ecosystem we never
designed for, which is the behavior you want from a law.

---

## Probe 3 — Starbeam as a tier-neutral reactivity substrate

**Question.** Probe 1 left a seam: pushes are visible only to code that reads
inside Glimmer tracking frames. Is that seam a protocol problem?

**Answer: no — it is a substrate question, and Starbeam
(`~/Projects/starbeam`, active as of June 2026) demonstrates the substrate is
a swappable layer that the protocol never touches.** Starbeam is not a
renderer; it is framework-neutral reactivity ("a reactive `Map<K,V>` is still
a `Map<K,V>`"). Three facts from the checkout matter:

1. **The bridge direction we'd need already exists — pointed the right way.**
   A Glimmer→React bridge exists nowhere and we would own it forever. But
   Starbeam's Ember adapter (`packages/ember/ember/src/tracked.ts`) does
   **Starbeam→Glimmer** first-party: `installStarbeamTags` forwards every
   Starbeam consume/mark into `@glimmer/validator`'s `consumeTag`/`dirtyTag`.
   So the move is not to bridge _out of_ Glimmer — it is to make a neutral
   substrate the invalidation source of truth, and let Glimmer become one
   consumer among several.

2. **card-api already has the choke points.** All invalidation routes through
   `notifyCardTracking`; all reads route through field getters. A
   per-instance-per-field `Marker` (exported from `@starbeam/universal`) —
   `marker.mark()` beside the notify, `marker.consume()` in the read path —
   makes card state visible to the neutral substrate. Additive: the Glimmer
   path is untouched, existing cards see zero change.

3. **The consumers then come for free, upstream-maintained.** React cards use
   the official adapter's `useReactive(() => model.title)` — fine-grained
   re-render on exactly the fields read, _including parent pushes_, because
   pushes mark the Marker. The Probe-1 modifier shim (coarse: whole-root
   re-render per change) becomes unnecessary. Vue, Svelte, and Preact
   adapters ship upstream. And `@starbeam/renderer` is explicitly an
   adapter-author kit (RendererManager: identity, scheduling, notification,
   lifecycle) — most of the scaffolding the Probe-2 Capsule adapter would
   need.

The deeper reframe is about authoring: with a neutral substrate, the
module-separation ideal from the
[reviewer's guide](boxel-execution-runtime-reviewers-guide.md) gets its
strongest form — **author the card's model in `@starbeam/universal`**, DOM-free
and framework-free plain JS. That model module classifies Direct/Capsule
trivially, runs in _any_ tier, and could eventually run server-side or in bot
evaluation, since it needs no DOM and no framework. Per-framework template
modules sit on top.

**Caveats.** (a) Granularity is a choice — per-instance markers are coarse;
mirror card-api's per-field granularity. (b) SES compatibility is plausible
(WeakMaps, plain JS, no eval) but unverified under frozen intrinsics.
(c) The choke points live in card-api — shared, main-affecting code; it could
stage child-side-only first.

**Check result: PASS.** The seam Probe 1 found never reached the wire
protocol. Reactivity turns out to be a distinct, swappable layer _below_ the
data plane — a layer we hadn't needed to name until a foreign framework asked.

---

## What the probes jointly imply: the VM boundary

If both probes were built, the sandbox child would run two rendering VMs in
one document. **They do not merge, and that separation is the design:**

- **GlimmerVM keeps rendering everything it renders today** — host chrome, the
  Base wrapper, format surfaces, Glimmer-authored cards. A React card ships
  react-dom's reconciler through the module gate; Vue would ship Vue's
  runtime. Neither VM ever sees the other's templates.
- **The composition boundary between VMs is an element, not a component.**
  Glimmer renders down to a mount `<div>` and hands the element over; the
  foreign framework owns everything below it. Same handoff shape as
  `boxel-field-portal`, pointed the other direction. No cross-VM template
  composition exists — a Glimmer component inside JSX, or vice versa, is
  always another element handoff.
- **The substrate sits underneath both**, as the shared dirty-graph:

  ```text
  model field changes → marker.mark()
          ├─ installStarbeamTags → Glimmer tag dirties → Ember revalidates its subtrees
          └─ RUNTIME.subscribe   → React adapter schedules → react-dom re-renders its subtree
  ```

  Each VM keeps its own scheduler and cadence; they only agree on _what
  changed_. Disjoint DOM subtrees mean no conflicts, and everything
  downstream of DOM stays framework-blind (height, write leg, gates).

- **The tiers differ exactly along the DOM-ownership law.** Sandbox: many VMs
  side by side sharing an invalidation graph. Capsule: one materializer (the
  host's projection lane does every DOM write), many describers.

The resulting layer stack, with the layer each probe exercised:

```text
  wire protocol      documents + operations          (Probe 1: unchanged)
  data plane         card-api instances, store, save (Probe 1: unchanged)
  invalidation       today Glimmer tags;             (Probe 3: swappable —
  substrate          neutral substrate possible       the newly named layer)
  render VMs         GlimmerVM | react-dom | ...     (Probe 2: per-tier law)
  DOM                measured, gated, framework-blind
```

---

## The only in-scope outputs

Probes are outside the project; two observations they produced are not:

1. **The CDN module-fetch bug gained importance.** The un-root-caused
   `authedFetch` failures (prosemirror bundles, sweep cards 7/8/23/33) sit
   exactly on the delivery path _any_ foreign-framework bundle would ride.
   Already in scope for its own reasons; the probes show it is a
   load-bearing lane, not an edge case.
2. **The renderer-agnostic claim in the reviewer's guide now has proofs, not
   assertions.** "The protocol carries serialized documents, not Glimmer" is
   demonstrated by a foreign framework needing zero protocol changes in two
   tiers.

## Explicit non-goals

Not building React card support. Not adopting Starbeam. Not modifying
card-api's tracking. Not writing a Capsule reconciler adapter. Not adding any
RP statement for any of this. Revisit trigger: after the preview build ships
and the RP-21 deliveries land — and only if a real authoring need appears.
