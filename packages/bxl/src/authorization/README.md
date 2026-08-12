# BXL Authorization evaluator

This directory implements BXL's synchronous relationship-authorization
kernel and the public `bxl-authorization/1` authoring adapter.

The public question is intentionally narrow:

> May this Party invoke this Capability on this Resource?

The answer is allow or refuse. BXL does not execute the command, mutate a
resource, redact a response, read a clock, query a data source, or perform network I/O.
The host owns those operations before and after the decision.

## Which API applications should use

Applications should import `prepareBxlAuthorizationSafe`:

```ts
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '@cardstack/bxl';

const prepared = prepareBxlAuthorizationSafe(document, snapshot);
if (!prepared.ok) throw new Error(prepared.error.message);

const result = prepared.value.checkCapability({
  party: 'person:operator',
  capability: 'ApproveRequest',
  resource: 'request:123',
});

if (!result.ok) throw new Error(result.error.message);
if (!result.value.allowed) return refuseRequest();

return commandService.approveRequest('request:123');
```

`prepareAuthorizationGraphSafe` and the `bxl-authorization-ir/1` structures are
the lower-level compatibility IR. They remain public for kernel tests and
advanced integration, but they are not the recommended BXL authorization dialect.

## How BXL is used

The adapter compiles each capability's BXL `where` expression into the graph
IR during preparation. The authorization profile extends the policy profile
with compiler-lowered relationship primitives and
ordinary boolean composition:

```bxl
Seat.Owner or Seat.Administrator
(Seat.ReviewTeam and Seat.SecurityReviewer) or Seat.ReleaseManager
via(Resource.Parent; Capability.Edit)
```

The compiler validates every referenced Seat, Capability, and Resource link.
Unknown or ambiguous handles fail preparation. Runtime evaluation then walks
the immutable tuple index synchronously with explicit step, depth, candidate,
and result limits.

The important boundary is:

```text
host resources + authorization document + authenticated party
                    │
                    ▼
trusted host builds a finite BxlAuthorizationSnapshot
                    │
                    ▼
prepareBxlAuthorizationSafe(document, snapshot)
                    │
                    ▼
checkCapability / listResources / listParties / listCapabilities
                    │
                    ▼
boolean decision + bounded metrics + optional trace
                    │
                    ▼
host validates and executes the command or projects the response
```

Policy and relationship resources are reactive application data, but a prepared
evaluator is an immutable decision epoch. When policy fields, seat membership,
or relevant Resource links change, construct a new snapshot and prepare it again.
Do not keep using an old prepared evaluator after its source epoch changes.

BXL itself has no Card or CardDef integration. Boxel may supply an adapter that
uses a card URL as an opaque resource identifier and maps a CardDef to a declared
authorization type. Other hosts can use database keys, URNs, or any other
stable identifiers without changing the evaluator.

## Public policy dialect

A `bxl-authorization/1` document uses host-neutral nouns:

- Resource: the concrete target instance;
- Party: the person, device, service, or nested group requesting access;
- Seat: a relationship-backed role on that Resource;
- Capability: the semantic command or mutation being requested.

Minimal policy:

```ts
const document: BxlAuthorizationDocument = {
  schema: 'bxl-authorization/1',
  scopes: [
    {
      name: 'Request',
      seats: [
        { name: 'Owner', from: 'Resource.Owner' },
        { name: 'Administrator', from: 'Policy.Administrators' },
      ],
      capabilities: [
        {
          name: 'View',
          where: 'Seat.Owner or Seat.Administrator',
        },
        {
          name: 'ApproveRequest',
          where: 'Seat.Administrator',
        },
      ],
    },
  ],
};
```

Supported authoring forms are documented in
[`docs/authorization.md`](../../docs/authorization.md):

- `Seat.Name` for a local relationship;
- `Capability.Name` for another capability in the same scope;
- `Party.Anyone` for any concrete Party identifier, plus `Party.Member` and
  `Party.Guest` for host-populated audiences;
- `via(Resource.Link; Capability.Name)` for a declared parent or related Resource;
- `and`, `or`, and parentheses for BXL boolean composition;
- `refuse` for explicit denials that override a successful `where`.

Names are UpperCamelCase stable handles. Human-facing labels belong in
`displayName`. Seat sources are direct `Resource.Field` or `Policy.Field`
relationship paths. A scope's `name` is also its authorization type; no
host type or module URL is embedded in the document.

## Zanzibar-style recursive groups

Policy authors do not call a recursion helper. The authored rule remains:

```bxl
Seat.ReviewTeam
```

The relationship snapshot can assign that seat to a Party group:

```ts
const snapshot: BxlAuthorizationSnapshot = {
  resources: [
    {
      resource: 'change-request:change-a',
      type: 'ChangeRequest',
      links: { reviewTeam: 'team:change-a-reviewers' },
    },
  ],
  parties: [
    { party: 'person:security-reviewer' },
    {
      party: 'team:product-security',
      members: ['person:security-reviewer'],
    },
    {
      party: 'team:change-a-reviewers',
      members: ['team:product-security'],
    },
  ],
};
```

The kernel expands the nested membership graph, prunes revisited usersets,
short-circuits a match, and stops at configured limits. Because the ReviewTeam
relationship is attached to one ChangeRequest resource, the grant does not cross
to another change request.

## Source layout

| File                   | Responsibility                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `bxl-authorization.ts` | Public `bxl-authorization/1` document, snapshot, compiler adapter, and prepared APIs. |
| `graph-model.ts`       | Private `bxl-authorization-ir/1` compatibility model.                                 |
| `compiler.ts`          | Validates and lowers the graph model into immutable IR.                               |
| `tuple-index.ts`       | Builds the finite relationship index.                                                 |
| `resolver.ts`          | Bounded synchronous capability evaluation and traces.                                 |
| `enumerate.ts`         | Low-level ListObjects and ListUsers graph primitives used by public enumeration.      |
| `openfga-recursive.ts` | Synchronous TypeScript adaptation of the pinned OpenFGA recursive userset slice.      |
| `conditions.ts`        | BXL policy-profile predicates for the compatibility IR.                               |
| `errors.ts`            | Fail-closed structured error results.                                                 |

## OpenFGA and Zanzibar provenance

The relationship algebra follows the Zanzibar family of authorization
systems. OpenFGA describes checks as determining whether a relationship exists
between a user and an object under an authorization model and relationship
tuples, including usersets such as `organization:id#member`:

- [OpenFGA concepts](https://openfga.dev/docs/concepts)
- [Zanzibar: Google's Consistent, Global Authorization System](https://research.google/pubs/zanzibar-googles-consistent-global-authorization-system/)

`openfga-recursive.ts` adapts `processUsersetMessage` and
`breadthFirstRecursiveMatch` from OpenFGA's
[`internal/graph/recursive_resolver.go`](https://github.com/openfga/openfga/blob/2c19e265fc73858fc0a5468fc517dc3bbf727e94/internal/graph/recursive_resolver.go)
at commit `2c19e265fc73858fc0a5468fc517dc3bbf727e94` under Apache-2.0.
Go channels, storage iterators, cancellation, goroutines, and the worker pool
are replaced by deterministic in-memory breadth levels and JavaScript `Set`
instances. Visited-userset pruning and allow short-circuiting are retained.
See the repository root [`NOTICE.md`](../../NOTICE.md) for attribution.

BXL does not claim OpenFGA syntax compatibility. OpenFGA DSL and CEL are used
only by test-only import tooling. Application policy uses `bxl-authorization/1` and
BXL expressions.

## Tests and merge gates

Run the full package gate:

```sh
pnpm lint
pnpm test
```

Authorization-specific gates:

```sh
pnpm fixtures:authorization:verify
pnpm test:authorization:conformance
pnpm test:authorization:performance
pnpm bench:authorization
```

Coverage includes:

- 1,227 pinned OpenFGA semantic assertions with zero unsupported cases and no
  skips;
- generalized coordination scenarios for inventory devices, turn-based
  commands, connected services, nested judging teams, target isolation, and
  capability enumeration;
- synthetic software-release scenarios for administrators, release managers,
  maintainers, contributors, recursive review teams, cross-change isolation,
  and membership reactivity;
- fail-closed invalid input, recursion cycles, depth/step/result limits,
  conditions, traces, and ListResources/ListParties/ListCapabilities parity;
- a generous CI performance regression gate plus a descriptive benchmark.

The timing gate detects gross regressions; it is not a production service-level
objective. Record platform-specific baselines with
`pnpm bench:authorization` before tightening any budget.

## Security boundary

The trusted host must authenticate the Party, resolve and type the target Resource, load a
finite and current relationship snapshot, select the policy epoch, and apply
runtime limits. After an allow, the host must still validate command input,
check current business state, serialize writes, and emit normal audit records.

This package supplies decisions, not request gating. A client may use the same
document for previews, but an authoritative gateway must evaluate the current
snapshot and apply the result before accepting a protected command.
