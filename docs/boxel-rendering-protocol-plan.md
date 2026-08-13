# Boxel rendering protocol: the smallest contract, three trust tiers, one running spec

## Stance

This replan reorients the execution-runtime work from **adapter-first** to
**protocol-first**. The requirement is:

1. the **smallest possible framework-quality protocol** that formalizes the
   rendering contract `main` already has;
2. that protocol adopted by three trust tiers — Direct, Capsule (SES),
   Sandbox (iframe) — with **clear routing rules**;
3. the spec is **the** maintainer artifact: a running spec, where every
   normative statement has a conformance test and every conformance test
   cites its statement.

Parity is redefined. The oracle is **main's own rendering**, not staging
screenshots. Direct re-expressed through the protocol must be behaviorally
equivalent to main's existing pipeline; Capsule and Sandbox must then conform
to the same spec. When Direct-through-protocol ≡ main, the protocol is proven
sufficient; when an adapter passes the same suite, it is at parity by
construction. Staging comparison (the suite realm) remains a validation layer
at the end, never the driver of protocol changes.

The 1,849-line
[architecture document](boxel-execution-runtime-architecture.md) is demoted to
**rationale and boundary rules**. It designed forward from principles toward a
large future (14 surface capabilities, BXL authorization, annotations,
collaboration, Realm Script, async AI). All of that is out of protocol v1.
The protocol document this plan commissions is small, normative, and derived
backward from main.

### Why this eliminates special-case code structurally

Every special case on the branch exists because an adapter held private
knowledge about how to make a card look right (a vendored currency map, a
`cssVar` string match in two places, a hard-coded 7-format fallback list,
regexes over compiled wire opcodes). The protocol-first rule that prevents
recurrence is a single sentence:

> **Adapters contain no protocol knowledge. If an adapter cannot express a
> behavior, that is a protocol change: spec section + version bump + Direct
> conformance proof in the same PR — never code in the adapter.**

A special case then has nowhere to live. Either the behavior is in the spec
(and all three tiers must prove it) or it does not exist.

---

## Part 1 — extract the contract from main (the missing artifact)

Nobody has written down main's de facto rendering contract as a finite list.
The architecture doc designed forward; the audits pressure-tested examples;
the branch discovered the contract one hypothesis at a time. Phase A produces
the inventory once, from main, and it becomes the spec's raw material.

The seams are already known; the task is enumeration and closure, not
discovery:

| Seam                    | Where on main                                           | What to enumerate                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card API render surface | `packages/base/card-api.gts`, `field-support.ts`        | `getComponent`, format resolution, field walk (`getFields`/`getField`), `contains/containsMany/linksTo/linksToMany` render behavior, getters + `computeVia` (both forms), configuration merge, defaults, inheritance, enum |
| Component entry         | `packages/host/app/components/card-renderer.gts`        | the contexts it consumes (CardContext, GetCard/GetCards/GetCardCollection, CardCrudFunctions) and provides (CardURL, DefaultFormats), `@displayContainer`, error presentation, `head` handling                             |
| Default field rendering | `packages/base/field-component.gts` (`getBoxComponent`) | what the default context supplies and what breaks when it is absent (the Sandbox child bug is this list, observed the hard way)                                                                                            |
| Presentation statics    | CardDef statics                                         | `displayName`, `icon`, `headerColor`, wide-format hint, `cardInfo`, theme/CSS variables                                                                                                                                    |
| Styling                 | `glimmer-scoped-css` in the transpile pipeline          | scoping guarantees; what a stylesheet may not do                                                                                                                                                                           |
| Instance identity       | Store / identity map                                    | `createFromSerialized`, `relativeTo` resolution, included-resource identity, lazy link loading, revisions                                                                                                                  |
| Edit + save             | edit format, CRUD context, patch semantics              | which fields are writable, what a save sends, computed rejection                                                                                                                                                           |
| Prerender               | prerender/index pipeline                                | which formats are materialized, what indexed HTML may be used for (inert placeholder only)                                                                                                                                 |

Method: enumerate top-down from these seams, then validate closure bottom-up
against the corpus (the suite realm's cases 1–5, the sandbox compatibility
corpus, Base + Catalog defaults). Anything a corpus card uses at render time
that the inventory missed gets added to the inventory — during Phase A, not
later as an adapter patch.

Deliverable: `docs/boxel-rendering-protocol.md` **section 2, "The contract"**
— a numbered list. Every numbered item is either IN protocol v1, DEFERRED
(with the version it targets), or EXCLUDED (with the reason). No silent
omissions: the deferred/excluded lists are part of the spec.

---

## Part 2 — the protocol (v0 strawman, to be validated by Phases A–B)

This section is a sizing target and shape constraint, not the final spec.
The spec itself is written in Phase A/B and lives in
`docs/boxel-rendering-protocol.md` + `packages/runtime-common/boxel-execution-protocol.ts`.
Names reuse the existing vocabulary — minimal means small, not renamed.

**Budget: ~10 record types, ~8 operations, 5 routing rules, 5 capabilities.
If the spec exceeds this by more than half, something from the deferred list
has leaked in.**

### Records (all cloneable, versioned, defined in runtime-common)

1. `CodeRef` — module + export identity (exists).
2. `BoxelDescription` — type: ref, kind, ancestors, `FieldDescription[]`,
   `FormatDescription[]`, presentation statics.
3. `FieldDescription` — name, kind, field type ref, resolved configuration,
   computed?, writable.
4. `InstanceProjection` — id, type ref, revision, cloneable `model` with
   **linked values as references** (`{$boxel:{id,type}}`), never expanded
   graphs.
5. `TemplateBundle` — validated wire templates + a **typed dependency
   union**: `trusted-component | authored-component | trusted-helper |
safe-modifier | block`. Unknown kind ⇒ reject the whole generation.
6. `SafeEvent` — the reduced event record (exported type, not a private
   function's output).
7. `ComponentUpdate` — `{generation, changed, effects}`.
8. `Effect` — closed v1 vocabulary (see capabilities).
9. `PatchData` — canonical attributes + relationship identifiers only.
10. `ProtocolVersion` / feature record — checked by every consumer, failing
    closed to last-known-good.

### Operations (`BoxelRuntime`, implemented per tier)

`loadBoxel`, `describeBoxel`, `createFromSerialized`, `getFields`/`getField`,
`getRenderSlot(instance, format)`, `invokeAction(component, action,
safeEvent)`, `serializeCardPatch(instance, changes)`, `dispose`. Nothing
else. Mutation is IN v1 only to the extent main's edit format requires it:
named field changes → `PatchData` → one authorized Store PATCH path.

### Capabilities (v1 — exactly what honest rendering needs)

`presentation` (header/container intent), `layout` (intrinsic ↔ allocated),
`observe` (size/visibility records), `view-card` (navigation intent),
`patch`. The other eleven `surface*` designs are DEFERRED; each future
capability enters as its own spec section + version + three-tier conformance.

### Routing rules (one pure function, ordered, total)

```
R1  Module in the trusted graph (base, catalog, @cardstack/*)      → Direct
R2  Module's import closure requires browser globals,
    or contains an unresolvable import (fail closed, diagnose)     → Sandbox
R3  Module declares prefersFullSandbox                             → Sandbox
R4  Otherwise authored                                             → Capsule
R5  Host policy may escalate isolation; nothing may de-escalate
    (authored code never routes Direct, whatever it requests)
```

Classification is **module-based**: every format defined by a module shares
its route; a nested Boxel defined in a different module routes independently.
Authors split browser-dependent formats into separate modules to keep compact
formats out of iframes. The classifier's job shrinks to computing R1–R4
inputs from the **resolved import graph** (transpiler output, not source
regexes); the routing function itself is ~30 lines and unit-tested as a
table.

### Tier obligations (one table, the maintainer's mental model)

| Concern                                                 | Direct                           | Capsule                                   | Sandbox                                         |
| ------------------------------------------------------- | -------------------------------- | ----------------------------------------- | ----------------------------------------------- |
| Module executes in                                      | Host loader                      | SES compartment per principal             | iframe child loader                             |
| Semantics (`BoxelRuntime`)                              | local                            | compartment, via handles                  | child, via MessageChannel                       |
| Glimmer + DOM                                           | Host                             | Host (manager bridge + `TemplateBundle`)  | child                                           |
| Trusted Base components                                 | shared Host graph                | Host portal by reference                  | child-local Base                                |
| Trusted Base **semantics** (getters, symbols, defaults) | local                            | **materialized Host-side, cross as data** | child-local Base                                |
| Capabilities                                            | local dispatch to SurfaceService | trusted managers → SurfaceService         | protocol client → SurfaceService                |
| Failure                                                 | error presentation               | last-known-good + diagnostic              | placeholder retained + post-render error signal |

---

## Part 3 — the running spec

Mechanics that make the spec the single maintainable artifact:

1. **One document, numbered statements.** `docs/boxel-rendering-protocol.md`.
   Every normative sentence carries an ID (`RP-4.3`). The document contains
   the contract inventory (IN/DEFERRED/EXCLUDED), the records, the
   operations, the routing table, the tier-obligations table, and the
   capability schemas. Target: under ~800 lines. Rationale lives in the
   architecture doc, not here.
2. **1:1 statement ↔ test.** The conformance suite mirrors the spec's
   numbering (`tests/conformance/rp-4-rendering/…`). A lint/CI check fails
   when a spec ID has no test or a conformance test cites no ID. Adding
   behavior without amending the spec is mechanically impossible.
3. **One harness, three tiers.** Each conformance case declares a fixture,
   a format, and expectations (record shape, visible DOM, interaction
   result, boundary negatives). The harness runs it through every applicable
   tier via `BoxelExecutionRenderer` in a real DOM (Sandbox in a real iframe
   in the test browser). Tier-inapplicable cases say so in the spec, not in
   the test's silence.
4. **The equivalence oracle.** A dedicated suite renders each fixture through
   main's legacy `CardRenderer` path and through the protocol's Direct
   adapter and diffs visible behavior. Green here is the definition of "the
   protocol formalizes main." It also becomes the migration gate: legacy
   paths are deleted only when equivalence is green.
5. **Record-diff across tiers.** For every fixture: Direct's, Capsule's, and
   Sandbox's `BoxelDescription`/`InstanceProjection` deep-diff to zero
   (modulo spec-declared tier fields, of which there should be almost none).
6. **Versioned change protocol.** Any spec change = version bump + spec edit
   - Direct proof + adapter conformance updates, one PR. Consumers reject
     unknown versions/features and retain last-known-good.

---

## Part 4 — replanned phases

### Phase A — contract inventory and spec v1 draft

- [ ] Enumerate main's rendering contract from the eight seams (Part 1);
      validate closure against corpus cases 1–5 and Base/Catalog defaults.
- [ ] Write `docs/boxel-rendering-protocol.md` with IN/DEFERRED/EXCLUDED
      decisions; hold to the Part 2 budget.
- [ ] Review gate: a maintainer who has read only the spec can say what a
      card may rely on at render time and which tier runs it. This is the
      "easy to understand" requirement made testable.

Exit: spec v1 merged as DRAFT; fixture list agreed; budget respected.

### Phase B — protocol module + Direct + the equivalence oracle

- [ ] Tighten `packages/runtime-common/boxel-execution-protocol.ts` to
      exactly the spec (typed dependency union, exported `SafeEvent`,
      version checks that consumers actually enforce).
- [ ] Collapse the branch's three projection builders into **one** pure
      pipeline behind `buildBoxelRenderRecord()`; Direct is its reference
      consumer. (Carries over slice 1 of
      [the parity plan](boxel-execution-runtime-parity-plan.md); that plan's
      slice 0 items — the loader `eval` regression fix, dead-code deletion,
      the CI rendering harness — land here if not already done.)
- [ ] Trusted-Base semantics materialize Host-side during projection; delete
      the vendored currency map as a semantic source.
- [ ] Build the conformance harness + the main-equivalence oracle; run the
      Phase A fixtures through Direct.

Exit: Direct-through-protocol ≡ main on the fixture corpus; spec v1 moves
DRAFT → NORMATIVE; from here on, **no adapter PR may edit the protocol**.

### Phase C — Capsule conforms

- [ ] Run the full conformance suite against Capsule. Every red is either an
      adapter bug (fix in adapter) or a spec insufficiency (spec-change
      protocol, with Direct proof first). No third category.
- [ ] The Card API facade shrinks to "authored semantics only," grown solely
      by red conformance cases; trusted-Base behavior now arrives as data.
- [ ] Keep the proven mechanisms as-is: template capture, component manager,
      session generation discipline, CSS policy.
- [ ] Fix the two known adapter bugs: authored `@tracked` state destroyed on
      arg change; invalidation primitives (`invalidateModule`,
      classifier/render-slot caches) wired to source changes and keyed by
      source hash.

Exit: Capsule green on the suite; record-diff Direct↔Capsule zero;
special-case inventory (currency map, `cssVar` string matches, pathname
regexes, hard-coded format list) deleted with their conformance replacements
cited.

### Phase D — Sandbox conforms

- [ ] Fix the iframe lifetime model first (never re-parent a live iframe —
      falsify the H11 re-parenting suspect, then rebuild slot/retention under
      that invariant; the frozen reference branch's retained-child technique
      is the oracle).
- [ ] Child shell implements the protocol server plus the child-local
      context obligations from the tier table (the Phase A inventory of
      `getBoxComponent`'s context needs is the checklist — no more
      discovering it via blank iframes).
- [ ] Post-render failure signal; placeholder retained as last-known-good;
      fetch transport timeout/port-closed handling; layout via the `layout`
      capability instead of hard-coded fitted/intrinsic.

Exit: Sandbox green on every sandbox-applicable conformance case, in CI, in
a real iframe; suite-realm cases 4–5 (Track, Playlist) green as validation.

### Phase E — routing + host integration + migration

- [ ] Routing function implemented as the R1–R5 table over the resolved
      import graph; classifier reduced to producing its inputs; routing
      unit-tested exhaustively (it is ~30 lines — test it like a truth
      table).
- [ ] Host entry points (stack item, host mode, preview panel) route through
      the protocol renderer; `data-boxel-execution` observed-tier adapter
      closes the suite realm's boundary lane.
- [ ] Migrate consumers off constructor introspection; delete legacy
      duplicates only when the equivalence oracle stays green without them.

Exit: one rendering path in the Host; routing decisions explainable by
pointing at one table; suite realm cases 1–5 fully green (all four lanes).

### Phase F — extensions, one spec section at a time

Mutation completion beyond v1's minimum, HMR/source volatility, further
capabilities, authorization projection — each enters by the versioned change
protocol: spec section, Direct proof, three-tier conformance. The deferred
list in the spec is the roadmap; nothing enters through an adapter.

---

## Part 5 — disposition of the existing branch

| Verdict                   | What                                                                                                                                                                                                                       | Why                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Keep as-is                | Component manager + `_CapsuleComponent`; template capture → bundle → `setComponentTemplate`; `BoxelExecutionSession` generations; Sandbox transports; CSS policy; `RetainedRuntimeRegistry`; loader `moduleEvaluator` seam | Sound, doc-faithful, tested                 |
| Absorb into spec          | `BoxelRuntime` ops; protocol module; `SafeEvent`; capability trio                                                                                                                                                          | Right shape, needs tightening + enforcement |
| Rebuild under conformance | Projection (3 builders → 1); Card API facade scope; classifier → routing inputs; Sandbox child shell + iframe lifetime                                                                                                     | The special-case generators                 |
| Delete                    | Currency map as semantics; `trusted-base-format.gts`; dead evaluator exports; one of the two surface transports; `formatOnlyImports`                                                                                       | Zero-referenced or spec-violating           |

Rough cost: the spec doc (~600–800 lines) and conformance harness (~1–2k
test lines) are new; the protocol module tightening is small; adapters
mostly exist. The genuinely new intellectual work is Phase A — and it is
bounded, because main's contract is finite and the corpus already exists.

## Part 6 — governance (supersedes the parity plan's working agreements)

1. **Adapters contain no protocol knowledge.** The one rule everything else
   follows from.
2. **Spec change = version + Direct proof + adapter updates, one PR.**
3. **Every normative statement has an ID and a test; CI enforces the
   bijection.**
4. **Vocabularies, not string matches.** Any name-based decision is an entry
   in a typed, spec-listed vocabulary.
5. **Fail closed, retain last-known-good, surface one diagnostic.** Unknown
   version, unknown feature, unknown dependency kind, unresolvable import —
   same behavior everywhere.
6. **The suite realm validates; it does not drive.** A staging red opens a
   conformance case first; the fix lands against that case.
