# Simplification opportunities: what "study main" has bought, and where it pays next

2026-08-06. Companion to `docs/boxel-sync-root-cause-2026-08-06.md` and the
RP-20 section of `docs/boxel-rendering-protocol.md`. Status: items 1–3 of the
main-audit remediation are landed (`83df9c33d1` and the follow-on
cascade/tracker commit); the rest of this document is the forward queue.

## The organizing principle

Main does not solve stale-value problems — it does not have them, because
nothing in its render path captures a value. Every binding holds a PATH
(`Box` = instance + fieldName, resolved per render, autotracked), so a field
set re-renders every consumer in place: the framework's render pass IS the
synchronization pipeline. Each time this branch captured a value instead, it
then needed delivery machinery to re-push updates — and that machinery is
where the corruption bug lived (see the root-cause doc). The execution
runtime's job is to express the path idiom THROUGH the Capsule/Sandbox
boundaries, adding only what the boundary itself requires (cloneability for
SES, a wire for the iframe) — never a parallel abstraction.

## What the principle has already deleted or obsoleted

- **The delivery-pipeline concept, entirely.** Two failed sync designs (an
  event pipeline that corrupted corpus data; an engine-watch pipeline)
  existed to re-deliver captured `@model` values. Replaced by
  `createLiveBoxelModel` (~60-line pure read-through proxy) plus a per-
  instance tracked version cell (~20 lines) bridging `subscribeToChanges`
  into autotracking.
- **A parallel mutation protocol.** `serializeCardPatch` (runtime-interface
  method, three tier implementations, sandbox client/server dispatch, a
  protocol op) and the `writableFields`/`ResolvedField.writable` plumbing
  had zero callers/readers: mutation is now the Host-granted `set` closure
  entering RP-9.2's one `setField` funnel (main's `Box.set` as a
  capability). ~120 lines across 9 files, deleted.
- **Per-settle generation rebuilds on Direct/Capsule.** Every card settles
  at least once (`cardInfo.theme`); each settle republished a full
  generation — SES re-instantiation, template remount, component-state
  wipe. Gated to Sandbox-only; the one datum Capsule needed from it (a
  late-settling theme's presentation) became a live read
  (`livePresentationFor`).
- **Portal staleness as a problem class.** `@fields` portals hold thunks
  composed with the version cell; there is no cached value to refresh, so
  frozen plural lengths / invisible reorders cannot recur.
- **Duplicate DOM-contract stamping.** The ElementTracker registration +
  card data attributes now live at ONE site (the renderer slot root, root
  and nested renders alike); the portal only contributes field identity.
- **The format cascade ×4 → ×1.** `childFieldFormatsFor` in
  `runtime-common/boxel-execution-protocol.ts` mirrors main's
  `defaultFieldFormats` verbatim; the Capsule facade's drifted copy (nested
  cardDef `isolated` where main mounts `fitted`) is gone, as are two portal
  divergences (computed-never-renders-edit; plural card lists use the
  cardDef axis).

## The forward queue, ranked by expected deletion payoff

1. **`capsule-component-runtime.ts` — args as paths.** The component manager
   JSON-stringifies projected args, diffs signatures, and RE-INSTANTIATES
   the SES component instance on any change (plus a microtask-deferred
   revision bump added as a stopgap for mid-render arg updates). If the SES
   side read args through a handle — the same read-through idiom `@model`
   now uses — the clone/signature/re-instantiate cycle deletes and authored
   component state survives arg changes. Same disease as the portals, one
   boundary deeper.

2. **The settle-watch apparatus — deletable after the updateInstance push.**
   `onSettle` / `waitThenReproject` / `waitForAnyRelationshipToSettle` /
   `isPendingRelationship` in `boxel-projection.ts`, the engine's
   `settleWatchers` set, and the strip-before-clone dance in
   `adoptHostProjection` (~120 lines) now serve ONLY the Sandbox tier — and
   the Sandbox republish re-materializes from the SAME serialized document,
   so it delivers no fresh data anyway. The honest mechanism is the
   parent→child `updateInstance` push (RP-20.5's documented gap:
   revision-guarded document push, child applies without echoing). Once it
   lands, delete the whole watch apparatus rather than maintaining both.

3. **Shrink the render record toward metadata.** With `@model` and
   `@fields` both live, audit what still reads `ResolvedField.value` at
   render time on Direct/Capsule. If nothing does, the record can carry
   descriptions/configuration/kinds only for those tiers — a cheaper
   projection walk and one less captured-value surface. (The Sandbox child
   still needs values via its document; that is the boundary's own
   requirement, which is the test for keeping anything.)

4. **Resist porting the frozen branch's full revision protocol.** When
   building `updateInstance`, the revision/echo-suppression machinery is
   needed at the IFRAME boundary only. The live model already made
   parent-side echo suppression unnecessary; a Capsule needs none of it.

5. **One pass with main's `field-component.gts` open side-by-side.** The
   audit LOWs are all re-derivations of things main computes once: the
   theme-card predicate (duplicated between `boxel-projection.ts` and
   Base), the bespoke `.boxel-execution-error` UI vs main's error chrome,
   the unconditional `structuredClone(fields)` where only Sandbox needs a
   clone, the `resolveFieldConfiguration` legacy fallback (check whether
   any deployed Base still lacks the public resolver), and
   `ensureLocalIdentity`'s namespace.

6. **Test-environment simplifications that protect the above.**
   The broad-filter battery shows module-setup contamination (SystemCard
   404 → cascading test-realm fetch failures) when acceptance modules share
   a browser session with rp- modules; and the typing-continuity test fails
   on harness focus behavior that a real browser disproves. Both make
   verification noisier than the code deserves — fixing the harness keeps
   the "study main" loop cheap.

## The test for any new abstraction

Before adding a mechanism, name the boundary requirement that forces it
(SES cloneability, iframe wire, module authority). If the justification is
"the value might be stale" or "we need to deliver updates," the answer is a
path plus tracking, not machinery — main is the proof it works.
