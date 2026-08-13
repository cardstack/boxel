# Execution runtime suite parity

This document is the working acceptance log for comparing the execution
runtime branch with the current staging Host. The suite lives at
`https://realms-staging.stack.cards/ctse/execution-runtime-suite/` and is
deliberately composed from nested Boxel definitions rather than isolated
component demos.

The comparison is behavioral and visual. A case is not green merely because
the outer card mounts: its nested fields, delegated formats, computed values,
Guide projection, interactions, and card chrome must match staging.

## Runtime vocabulary

- **Direct**: trusted Boxel code executes in the Host loader.
- **Capsule**: authored JavaScript executes in an SES compartment while
  rendering is delegated into the Host document through the Boxel protocol.
- **Sandbox**: authored code and DOM execute in the isolated iframe runtime.

The live tier is exposed as the first, read-only item in the card options menu.
It reports the mounted runtime, not the classifier's intended result.

## Current Opening Night comparison

| Concern                               | Staging                       | Runtime branch                | Status   |
| ------------------------------------- | ----------------------------- | ----------------------------- | -------- |
| Release renderer                      | Full authored isolated format | Full authored isolated format | Green    |
| Top-level execution                   | Existing Host loader          | Capsule                       | Expected |
| Trusted workspace shell               | Existing Host loader          | Direct                        | Expected |
| Primitive and computed release fields | Rendered                      | Rendered                      | Green    |
| Nested `CatalogMetadata`              | Rendered                      | Rendered                      | Green    |
| Nested price, venue, and credits      | `$24.00`; venue; two credits  | `$24.00`; venue; two credits  | Green    |
| `cardInfo.guide`                      | Eleven rules rendered         | Eleven rules rendered         | Green    |
| iframe requirement                    | None                          | None                          | Expected |

## Current execution-lane checkpoint

| Case                       | Staging behavior                                      | Runtime branch                                                          | Mounted lane | Status |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------- | ------------ | ------ |
| Suite workspace            | 18 fitted cards render                                | 18 fitted cards render                                                  | Direct       | Green  |
| Release / Opening Night    | Full nested release, Guide, venue, credits, and price | Same visible values and nesting                                         | Capsule      | Green  |
| ReleaseGuide               | Guide content renders                                 | Guide content renders                                                   | Capsule      | Green  |
| DeluxeRelease              | Inherited release renders                             | Inherited release renders                                               | Capsule      | Green  |
| Track / Corridor, Take One | Player renders                                        | Iframe mounts but paints no authored DOM                                | Sandbox      | Red    |
| Playlist / Night Sessions  | Cross-realm Track plus delegated formats render       | Cross-realm module is authorized, but the iframe paints no authored DOM | Sandbox      | Red    |

This is a WIP checkpoint, not a merge-readiness statement. Direct and Capsule
now have representative composition parity. Sandbox bootstrap, private-port
transport, module classification, and exact-graph fetch authorization complete,
but the child rendering adapter is not yet equivalent to Main's `CardRenderer`
path.

## Hypotheses and falsification probes

### H1: nested definition references lose their canonical module base

**Evidence:** the top-level `Release` imports and renders in Capsule, but three
nested portals fail in `CapsuleModuleEvaluator.importCardType()` with `Failed
to construct 'URL': Invalid URL`.

**Prediction:** at least one nested request contains a relative or bare
`CodeRef.module` while the request's `relativeTo` points at an instance URL
rather than the defining module URL.

**Probe:** include the unresolved module, export name, card id, and `relativeTo`
in the boundary error; add a unit case where a nested authored FieldDef uses a
relative module reference. The fix passes only when the boundary canonicalizes
the reference once, before the runtime adapter consumes it.

**Result:** confirmed and fixed. Nested requests now prefer Base's canonical
`relativeTo` symbol instead of deriving a module base from an instance id.
Venue and both Credit portals resolve against their defining module.

### H2: Base fallback and authored nested portals have conflated ownership

**Evidence:** the outer authored renderer must be Capsule, but trusted Base
field renderers should remain Host-owned references. Serializing a trusted
Glimmer component into the Capsule is both slower and semantically wrong.

**Prediction:** the failing nested graph contains a mixture of authored
definitions that need Capsule evaluation and Base definitions that should be
resolved Direct by the Host.

**Probe:** assert the execution graph, not only the outer tier: authored
`CatalogMetadata` is Capsule; Base currency, relationship, and default field
components are Direct render references; no trusted template is serialized by
value across the boundary.

**Result:** the execution ownership is correct for Opening Night. The
workspace is Direct; Release, CatalogMetadata, VenueAddress, and both Credit
renderers are Capsule; trusted Base field components remain Host references.
No iframe Sandbox is selected.

### H3: `cardInfo` is not part of the canonical boundary projection

**Evidence:** the same Release displays its Guide on staging, while the runtime
branch says that `cardInfo.guide` is absent.

**Prediction:** the Store has the relationship but the execution record omits
or flattens it before the Capsule renderer receives the model.

**Probe:** compare `cardInfo` identity and its Guide link before projection,
inside the execution request, and inside the Capsule model. Add a conformance
case for Guide, theme, name, summary, notes, and thumbnail without creating
duplicate top-level fields.

**Result:** confirmed and fixed for Guide. JSON:API relationship keys preserve
the full dotted field path, so snapshot construction must rebuild
`cardInfo.guide` rather than expose a literal `"cardInfo.guide"` property.

### H4: included-resource identity is incomplete for relationships

**Evidence:** venue and credits fail after the containing card renders.

**Prediction:** JSON:API `included` data crosses the boundary, but its
relationship type or adopts-from identity cannot be reconstructed into the
same canonical Store object graph.

**Probe:** assert stable ids and definition references for a `linksTo`, a
`linksToMany`, and a nested inline FieldDef across Direct and Capsule. The Host
must remain the canonical data owner; the Capsule receives bounded
representations and sends mutations through explicit capabilities.

**Result:** the Opening Night included graph now completes without alerts or
permanent loading states. Broader relationship fixtures remain part of the
suite progression below.

### H7: declared fields are not the complete authored rendering model

**Evidence:** Capsule correctly evaluated `CatalogMetadata.priceLabel`, but
the nested renderer showed a blank value even though the underlying amount
and currency arrived.

**Prediction:** the boundary projection contains the getter, but the Host
reconstructs `@model` only from `ResolvedField[]`, dropping ordinary authored
getters before the component is invoked.

**Probe:** inspect the projection, `BoxelRenderRecord`, Host model, Capsule
component arguments, and final DOM separately.

**Result:** confirmed and fixed structurally. `BoxelRenderRecord.instance`
now carries an explicit cloneable `model` in addition to field metadata.
Capsule evaluates authored getters inside SES and supplies that model; the
renderer no longer attempts to recreate it from declared fields.

### H8: nested trusted Base semantics are pruned below authored FieldDefs

**Evidence:** once `priceLabel` crossed the protocol it rendered
`24.00 (currency not set)` instead of staging's `$24.00`.

**Prediction:** Host projection either stops at the authored
`CatalogMetadata` waypoint or asks Base to introspect an inert synthetic
receiver, so `CurrencyField.symbol` is never added.

**Probe:** retain authored getters in Capsule, but traverse declared contained
fields Host-side and execute getters only when their declared type belongs to
trusted Base.

**Result:** confirmed and fixed. Authored FieldDefs are structural waypoints;
their code is never evaluated in the Host. Trusted nested types use their
declared type for field metadata and a bounded inert receiver for getter
evaluation. The rendered value now matches staging at `$24.00`.

### H9: the Capsule is missing a pure JavaScript intrinsic

**Evidence:** BXL evaluation failed with `structuredClone is not a function`,
leaving a nested portal in a permanent loading state.

**Result:** confirmed and fixed. Capsule now receives a clone-only
`structuredClone` intrinsic. Transfer options are rejected, so it conveys no
Host object or ownership authority.

### H5: runtime lifetime is too short for composition performance

**Evidence:** the suite is intentionally nested, and repeated module
evaluation would make a successful render visibly slower than staging.

**Prediction:** navigating between sibling cards or reopening a recently used
format repeats classification, transpilation, and Base registration that can
be retained safely.

**Probe:** measure cold and warm navigation separately. A warm Capsule render
must reuse its runtime, trusted module registrations, source-hash
classification, and compiled template while creating a fresh card projection.

### H6: interactive and media state needs an explicit Surface owner

**Evidence:** later suite cases add playback and composed UI behavior that
cannot be inferred from serialized DOM.

**Prediction:** data-only parity can pass while play, seek, focus, height, and
other coordinated interactions diverge.

**Probe:** exercise the music player and playlist cases using the declared
`surface-*` capabilities. A capability is tested through Capsule and Sandbox;
Direct uses the same protocol with a trusted adapter.

### H10: execution documents cannot contain root-relative included modules

**Evidence:** the Playlist's explicitly linked Partner Track was serialized
with an `adoptsFrom.module` spelling relative to the Playlist root, then placed
inside the Partner resource. The Sandbox correctly resolved that spelling
against the Partner card and rejected the resulting nonexistent module.

**Prediction:** transporting absolute module identities at the execution
boundary fixes the linked card without granting realm-wide read or search
authority.

**Result:** confirmed. Execution serialization now uses absolute module URLs.
The Playlist progresses from an exact-graph authority error to a mounted
Sandbox. The Host still grants only observed static modules and explicit
included resources.

### H11: the Sandbox child bypasses required Host rendering semantics

**Evidence:** both a standalone Track and the composed Playlist complete
Sandbox bootstrap and mount an iframe, but the child contains only the route's
empty Glimmer boundaries. The failure is independent of cross-realm links.

**Prediction:** rendering the raw `getComponent()` slot inside the child omits
one or more responsibilities supplied by Main's `CardRenderer` path: contextual
providers, field delegation, container/theme semantics, error presentation, or
the correct Glimmer owner. Reusing that established wiring behind the Sandbox
adapter should paint both simple and composed cards without changing the
transport protocol.

**Next probe:** instrument the child render failure, compare its invocation and
providers with Main and the frozen working iframe branch, and make a standalone
Track the first acceptance test. Only then retest Playlist relationships,
delegated atom/fitted formats, media, height, and writes.

## Suite progression

1. Release identity, primitives, and computed values.
2. Nested catalog metadata, field configuration, and Guide.
3. Enums, inheritance, theme, brand guide, and images.
4. Track and music-player interactions.
5. Playlist composition, relationships, and query fields.

Each case records its outer execution tier and any nested boundary crossings.
The suite is considered at parity only after both the cold and warm path match
staging and no nested alert or silent fallback is present.
