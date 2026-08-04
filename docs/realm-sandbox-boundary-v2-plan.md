# Realm sandbox boundary v2 implementation plan

## Goal

Make the card boundary a complete, versioned description of Boxel semantics so
new Card API features cannot work in Direct rendering while silently
disappearing in Capsule or iframe rendering. This is near-future work, not a
claim about the current branch.

The Store remains canonical for documents and relationship state. Authored
code owns authored getters, `computeVia`, and custom renderers inside its
selected execution environment. The trusted Host owns policy, validation,
persistence, and Host capabilities. No live Store, Loader, CardDef instance,
service, component, modifier, or DOM object crosses the boundary.

## Design rules

Every Boxel semantic must declare four things before it ships:

1. **Owner:** Store, trusted Base, authored sandbox, or Host capability.
2. **Boundary representation:** an inert value, a typed request/effect, or no
   crossing at all.
3. **Consumers:** Direct, Capsule, iframe, Code preview, indexing/prerender,
   and any trusted Base portal that uses it.
4. **Conformance proof:** the same fixture and expected behavior across every
   compatible execution mode.

`surface*` names are reserved for narrow Host-mediated UI and runtime
capabilities such as `surfacePresentation`, `surfaceMeasure`, and future
`surfacePlayback`. Store fields, relationships, `cardInfo`, `computeVia`, and
document mutations are ordinary Card semantics and should not be renamed as
Surface APIs.

## Replace the fixed type-state shape

The present boundary mixes a growing list of special fields with two
format-specific booleans:

```ts
interface OpaqueRealmCardTypeState {
  typeRef: CodeRef;
  displayName: string;
  fields: Record<string, OpaqueRealmCardFieldMetadata>;
  hasCustomEditTemplate: boolean;
  hasCustomIsolatedTemplate: boolean;
  authoredTemplateFormats?: string[];
  headerColor: string | null;
  prefersWideFormat: boolean;
}
```

That shape makes every new format require another coordinated special case.
Replace it with a versioned record whose template inventory is open-ended:

```ts
interface CardBoundaryTypeRecord {
  protocolVersion: number;
  requiredFeatures: string[];
  typeRef: CodeRef;
  definitionKind: 'card' | 'field' | 'file';
  ancestorTypes: OpaqueRealmCardFieldType[];
  fields: Record<string, OpaqueRealmCardFieldMetadata>;
  templates: OpaqueTemplateSlot[];
  presentation: {
    displayName: string;
    icon?: TrustedExportRef;
    headerColor: string | null;
    prefersWideFormat: boolean;
  };
  executionHints: {
    prefersFullSandbox: boolean;
  };
}

interface OpaqueTemplateSlot {
  format: string;
  provider:
    | { kind: 'authored'; typeRef: CodeRef }
    | { kind: 'trusted-base'; typeRef: CodeRef };
}
```

Use an array rather than an untrusted-keyed object so entries can be bounded,
validated, deduplicated, and extended without prototype-key hazards. The
formats in examples (`isolated`, `embedded`, `fitted`, `atom`, `edit`, `head`,
and `markdown`) are examples, not the closed universe. A future custom format
must cross through the same inventory without changing the protocol shape.

During migration, derive `hasCustomEditTemplate` and
`hasCustomIsolatedTemplate` as compatibility getters from `templates`. Delete
their stored copies after current Host/Base consumers move to a generic
`hasAuthoredTemplate(format)` query.

## Separate records from capabilities

Split the current `OpaqueRealmCardState`, which combines data with Host
closures, into two values:

```ts
interface CardBoundaryRecord {
  protocolVersion: number;
  type: CardBoundaryTypeRecord;
  document: LooseSingleCardDocument;
  projection: Record<string, unknown>;
  presentation: OpaqueRealmCardPresentation;
}

interface BoundaryCapabilitySet {
  setField?: (request: SetFieldRequest) => Promise<SetFieldResult>;
  render?: (request: DelegatedRenderRequest) => RenderHandle;
  navigate?: (request: ViewCardRequest) => void;
  fetch?: (request: BoundedFetchRequest) => Promise<BoundedFetchResponse>;
}
```

The record is serializable, cloneable, inspectable, and safe to cache. The
capability set stays Host-side and is granted per sandbox principal, card,
format, realm permission, and lifetime. Receiving the record never implies a
write, query, navigation, or network capability.

## One projection pipeline

Introduce `projectCardForBoundary()` as a pure Host assembler over already
captured inert inputs. It must not import or introspect authored CardDef code
in the Host.

```ts
projectCardForBoundary({
  canonicalDocument,
  capturedTypeMetadata,
  capturedComputedProjection,
  relationshipProjection,
  cardInfoProjection,
  presentationProjection,
  policy,
}): CardBoundaryRecord
```

Semantic capture happens with the semantic owner:

- authored getters and `computeVia` execute in Capsule or the iframe;
- trusted Base field behavior executes in trusted Base;
- the Store supplies canonical authored data and relationship identifiers;
- the Host validates, prunes, assembles, and versions the record.

Direct, Capsule, iframe, Code preview, delegated rendering, and prerender must
consume this one record instead of maintaining parallel snapshot builders.

## Protocol compatibility and failure behavior

- Add a protocol version plus individually named optional and required
  features.
- Reject an unsupported required feature atomically.
- Keep last-known-good output visible when a newer record cannot be consumed.
- Never partially render an unknown record while silently dropping fields.
- Keep iframe transport messages separate from the semantic record version;
  transport and Card API semantics evolve independently.

In development and tests, wrap boundary projections in a missing-path
diagnostic proxy. A missing access should report the complete property path,
type reference, format, and execution mode. Do not ship this proxy in
production and do not let it synthesize values.

## Implementation order

1. Add the missing-path diagnostic proxy and a nested Base
   `CurrencyField.symbol` conformance fixture.
2. Add a fake unknown custom format fixture to prove the template inventory is
   not a hard-coded seven-format switch.
3. Add `CardBoundaryTypeRecord`, `CardBoundaryRecord`, and validation without
   changing consumers.
4. Implement pure `projectCardForBoundary()` from the current inert capture
   outputs.
5. Move relationship, getter/compute, `cardInfo`, theme/presentation, and
   template projection into that pipeline.
6. Make Direct, Capsule, iframe, Code preview, delegated Base portals, and
   prerender consume the same record.
7. Introduce `BoundaryCapabilitySet` and move `setField`, relationship
   resolution, navigation, and fetch closures out of the record.
8. Derive legacy custom-template booleans from the template inventory, migrate
   call sites, then remove duplicated stored values and hard-coded format
   loops.
9. Generate the owner × representation × consumer conformance matrix in CI.
10. Delete duplicate snapshot/projection paths only after the cross-product
    suite is green.

## Acceptance criteria

- Adding a new format needs no new field on the boundary record.
- Adding a Card API semantic fails CI until ownership, encoding, consumers,
  and conformance fixtures are declared.
- Nested Base semantics, relationships, computed values, cardInfo/theme,
  writable fields, images/media, and custom format selection match Direct
  rendering in every compatible sandbox tier.
- An unknown required protocol feature retains last-known-good UI and reports
  one actionable diagnostic.
- A sandbox cannot gain Store/search/write/fetch authority by receiving a card
  record or by naming an identifier.
- No consumer reads authored constructors or calls `getComponent(instance)`
  across the boundary; trusted Base compatibility portals delegate through
  the Host-owned render capability.
