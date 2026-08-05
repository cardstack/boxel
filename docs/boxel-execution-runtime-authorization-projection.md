# Boxel execution runtime: BXL authorization projection

## Status and scope

This is a proposed companion contract for the Boxel execution runtime. Boxel
does not yet have this complete authorization layer. The purpose of the design
is to ensure that Direct, Capsule, and Sandbox rendering can consume the same
authorization result without confusing client-side UI reduction with the
server security boundary.

In this document, **Boxel means Box Element**: a CardDef, FieldDef, FileDef, or
future compatible visual building block. Realm remains the server-side data
and module location.

The proposal covers:

- linking or otherwise selecting a BXL authorization policy for a resource;
- evaluating a finite, bounded authorization snapshot;
- projecting the Boxel graph to the fields, relationships, query results,
  formats, sections, and Commands a principal may use;
- transporting the result across Direct, Capsule, and Sandbox boundaries; and
- preserving independent server enforcement for all reads and effects.

It does not define authentication, credential storage, organization policy
administration, or the complete mutation protocol.

## Evidence from BXL Clinical Access

The local clinical example currently performs four operations inside
`patient-dashboard.gts`:

1. resolve a linked `ClinicalAccessPolicy`, facility, patient resource,
   principals, and nested team membership;
2. build a finite authorization snapshot;
3. run `prepareBxlAuthorizationSafe()` and `listCapabilities()` for the viewer,
   resource, and request input; and
4. hand-build a dashboard projection whose denied values are `undefined` and
   whose actions are capability booleans.

The example demonstrates semantics the shared service must preserve:

- nested usersets are relationship data and are expanded cycle-safely within
  limits;
- authorization is resource-scoped: a care-team seat on one patient does not
  grant another patient;
- `via(Resource.Facility; Capability.ViewOperationalContext)` delegates a
  specific parent-resource capability rather than exposing the parent graph;
- capabilities can depend on other capabilities;
- request input can refine a result, such as break-glass plus incident ticket;
  and
- explicit refusal is evaluated separately and wins after positive
  eligibility, such as `Seat.Suspended` removing notes and mutations.

Those are general BXL mechanics. The runtime must not hard-code clinical
capability names.

## Security and UX invariants

1. The Realm Server is the authoritative security boundary.
2. Client-side BXL evaluation can only reduce a server-authorized upper bound.
3. The server does not send secrets merely so the client can hide them.
4. Every fetch, search, relationship traversal, Command, and mutation is
   independently authorized by the server.
5. Visibility is not mutation authority. An available Command is descriptive;
   invocation still requires a Host capability and server authorization.
6. A policy card reference is configuration, not a grant.
7. No live Store, policy evaluator, membership service, component, callback,
   credential, or unprojected resource crosses a Capsule or Sandbox boundary.
8. Explicit refusal wins over positive eligibility.
9. Missing, stale, failed, or protocol-incompatible authorization fails closed.
10. Denied data produces no value, child render slot, loading placeholder,
    count, title, URL, menu item, diagnostic payload, or timing-distinct shell.
11. Direct, Capsule, Sandbox, inspector, query, delegated render, Rich
    Markdown, fitted gallery, Code preview, and AI schema consumers use the
    same projection.
12. A different execution tier cannot restore a semantic removed by
    authorization projection.

## Ownership

| Concern                               | Owner                                 | Boundary result                                           |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| Authentication and principal identity | Host + Realm Server                   | stable principal id, never credentials                    |
| Authoritative data authorization      | Realm Server                          | already-authorized resources and upper-bound decisions    |
| BXL policy card and relationship data | Store + Realm Server                  | authorized policy reference/revision and bounded snapshot |
| Client BXL evaluation                 | Host `BoxelAuthorizationService`      | frozen capability decisions                               |
| Boxel graph projection                | Host render projection pipeline       | redacted `BoxelRenderRecord`                              |
| Visual rendering                      | Direct/Capsule/Sandbox adapter        | only projected data and descriptive decisions             |
| Commands and mutation                 | Host capability broker + Realm Server | admitted result/receipt or bounded refusal                |

The service is deliberately not part of `SurfaceService`. Surface authority is
scoped to a mounted visual root. Authorization is scoped to principal,
resource, policy, data revision, and operation.

## Policy binding

A resource or owning application may link a policy card. The initial design
can support an explicit relationship such as `authorizationPolicy`; later it
may also support policy selection from workspace/application configuration or
server policy. The binding rules must be deterministic and inspectable.

The rendered card does not choose a weaker policy. The Host resolves the
effective binding and the server-authorized policy revision. A card that is
itself an authorized policy editor may receive the policy card as ordinary
projected data, but merely rendering a governed resource does not expose the
policy document or membership graph.

## Host service contract

The Host service accepts an internal request and returns a cloneable
projection. Names are aligned with the execution runtime's `Boxel*` semantic
vocabulary.

```ts
export interface BoxelAuthorizationRequest {
  policy: CardIdentifier;
  principal: string;
  resource: CardIdentifier;
  resourceRevision: string;
  requestedCapabilities: string[];
  input: Record<string, JSONValue>;
}

export interface BoxelCapabilityDecision {
  effect: 'allow' | 'refuse' | 'not-applicable';
  reasonCode?: string;
}

export interface BoxelAuthorizationProjection {
  protocolVersion: number;
  policy: CardIdentifier;
  policyRevision: string;
  principal: string;
  resource: CardIdentifier;
  resourceRevision: string;
  inputHash: string;
  capabilities: Record<string, BoxelCapabilityDecision>;
  visibleFields: string[];
  visibleRelationships: string[];
  visibleFormats: string[];
  visibleSections: string[];
  availableCommands: string[];
}

export interface BoxelAuthorizationService {
  project(
    request: BoxelAuthorizationRequest,
  ): Promise<BoxelAuthorizationProjection>;
}
```

`requestedCapabilities` keeps evaluation bounded and makes dependencies
observable. `inputHash` identifies the exact request-input state without
echoing potentially sensitive inputs across all consumers. Bounded reason
codes support safe UI explanations; full policy traces and membership paths
remain server/Host diagnostics unless separately authorized.

The projection is descriptive. It contains no `can()` closure and no method
that can grant authority. Custom authored formats may read the frozen decision
record from render context, while generic Base templates consume the concrete
visible field, relationship, format, section, and Command lists.

## Evaluation and intersection

```text
Realm Server
  authenticates principal
  authorizes resource/policy/snapshot reads
  returns an upper-bound authorization envelope
                         |
                         v
BoxelAuthorizationService
  resolves effective policy revision
  evaluates BXL over an already-authorized finite snapshot
  applies nested membership, via, composition, input, refusal
  intersects local decisions with the server upper bound
                         |
                         v
buildBoxelRenderRecord()
  removes denied values and render slots
  records descriptive capability decisions
                         |
                         v
Direct / Capsule / Sandbox / non-render consumers
```

Two production implementations are valid:

- the server computes the complete projection and the client validates and
  consumes it; or
- the server supplies an upper bound and an authorized finite snapshot, and
  the Host evaluates BXL synchronously for responsive UI changes.

In both cases the client result is an intersection. A forged or buggy local
`allow` cannot widen the server envelope. The second model enables interactions
like changing a viewer or local request input without a network round trip,
but is a UX optimization rather than enforcement.

## Projecting the Boxel graph

Authorization must run before the canonical render record is assembled:

```ts
buildBoxelRenderRecord({
  canonicalDocument,
  boxelType,
  projectedValue,
  relationshipProjection,
  authorizationProjection,
  cardInfoProjection,
  presentationProjection,
  policy,
});
```

The projection controls these semantic domains:

| Domain       | Denied behavior                                                     |
| ------------ | ------------------------------------------------------------------- |
| field        | value and FieldDef slot absent; no placeholder or validation detail |
| relationship | identifier, resolved child, and traversal affordance absent         |
| query        | unauthorized rows excluded before count/sort/page presentation      |
| format       | format unavailable; trusted fallback only if separately authorized  |
| section      | custom presentation section absent, not CSS-hidden                  |
| Guide        | label/help/control/constraint visible only for remaining semantics  |
| menu         | item absent; no inert control that reveals a capability name        |
| Command      | affordance absent, while direct invocation remains server-denied    |
| schema/AI    | unauthorized field and relationship descriptions omitted            |

Projection needs a deterministic mapping from capabilities to these domains.
That mapping may be declared by trusted Base/schema metadata, the linked
policy/application contract, or a future Guide integration. It cannot be an
unvalidated callback copied from authored code into the Host.

## Execution-boundary behavior

### Direct

Trusted code receives the same projected model and frozen authorization
record. Direct execution does not bypass the projection pipeline.

### Capsule

The Capsule receives the redacted `BoxelRenderRecord` and descriptive decision
record. It cannot load omitted data through a trusted Base portal: every nested
render and data request returns to the Host router with the same execution and
authorization identity.

### Sandbox

The iframe receives the same redacted records over the versioned protocol.
The policy evaluator, source snapshot, Store, credentials, and denied data
remain outside. A child request for a nested Boxel re-enters the Host router;
guessing an id or URL does not expand the projection.

## Reactivity, caching, and last-known-good behavior

Projection cache identity includes:

- principal;
- resource id and revision;
- policy id and revision;
- server upper-bound revision;
- finite-snapshot revision;
- request-input hash; and
- requested capability set.

Policy, membership, resource-state, principal, or request-input changes
invalidate only affected authorization keys. The Host diffs old and new
projections and preserves unrelated Table/Cell, field, relationship, and child
render-slot identity.

An authorization failure must never fall back to an earlier broader
projection. The only reusable last-known-good UI is a non-sensitive shell whose
contents are independently safe under the new upper bound. When that cannot be
proved, the Host shows a generic denied/unavailable state.

## Mutation interaction

Authorization projection and mutation admission are related but distinct:

```text
availableCommands / writable field paths
                 |
                 v
          visible affordance
                 |
        user requests operation
                 v
Host capability broker checks execution identity + current projection
                 |
                 v
Realm Server reauthorizes against current data/policy revisions
                 |
                 v
admitted PATCH/Command receipt or bounded refusal
```

A projected writable field does not make the rendered projection itself
writable. The mutation pipeline still serializes only named canonical changes,
rejects computed/presentation/side-loaded data, and detects stale revisions.
Revocation between display and invocation must be safe and ordinary.

## Acceptance coverage

The cumulative music-release suite applies the clinical mechanics to a
non-clinical domain through `ReleaseAccessPolicy` and
`ReleasePlanningSheet`. It must prove:

- artist, nested release team, rights team, finance, guest, and suspended
  collaborator views;
- one resource grant does not authorize a sibling release;
- nested membership and `via(Resource.Label; ...)` are bounded;
- explicit refusal removes internal notes and mutations after positive team
  eligibility;
- request-input changes update only dependent semantics;
- denied rows do not influence counts, totals, sort, pagination, or timing;
- Direct, Capsule, Sandbox, inspector, query, and AI schema projections agree;
- forged allows and direct Command attempts fail;
- server revocation wins over cached client state; and
- unaffected DOM/render-slot identity survives a projection update.

Unit tests cover record codecs, hashing, version rejection, intersection,
refusal precedence, and redaction. Adapter conformance tests run the same
projection through every execution tier. Browser tests assert visible output,
absence of leaks, interactions, targeted updates, and revocation behavior.

## Implementation sequence

1. Define the versioned request, upper-bound, decision, and projection records.
2. Add a test-only linked BXL policy binding to the music fixture graph.
3. Implement `BoxelAuthorizationService` over a bounded authorized snapshot.
4. Intersect local decisions with a server upper-bound fixture.
5. Insert authorization before `buildBoxelRenderRecord()` materialization.
6. Feed the same frozen result to Direct, Capsule, Sandbox, inspector, query,
   Code preview, delegated rendering, and AI schema consumers.
7. Route every operation through the existing/future Host capability broker
   and authoritative server check.
8. Add targeted invalidation and safe non-sensitive failure shells.
9. Add the cross-tier and browser assertions above.
10. Replace application-local authorization projection code only after parity
    is proven.

## Open design decisions

- exact policy-binding precedence across resource relationship, application,
  workspace, and server policy;
- whether the server returns a fully computed projection, an upper bound plus
  finite snapshot, or both;
- the declarative capability-to-field/relationship/format/section mapping;
- safe, localized explanation records versus privileged audit traces; and
- whether authorization projection gets its own revision stream or is folded
  into the canonical Store document/change acknowledgement protocol.
