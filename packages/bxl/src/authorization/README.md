# BXL authorization runtime

This directory implements BXL's synchronous relationship-authorization
kernel and the public `boxel-policy/2` authoring adapter.

The public question is intentionally narrow:

> May this Party invoke this Capability on this Card?

The answer is allow or refuse. BXL does not execute the command, mutate a
card, redact a response, read a clock, query a realm, or perform network I/O.
The host owns those operations before and after the decision.

## Which API applications should use

Applications should import `prepareBoxelPolicySafe`:

```ts
import {
  prepareBoxelPolicySafe,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
} from '@cardstack/bxl';

const prepared = prepareBoxelPolicySafe(document, snapshot);
if (!prepared.ok) throw new Error(prepared.error.message);

const result = prepared.value.authorize({
  party: '../Person/operator',
  capability: 'ApproveRequest',
  card: '../Request/123',
});

if (!result.ok) throw new Error(result.error.message);
if (!result.value.allowed) return refuseRequest();

return commandService.approveRequest('../Request/123');
```

`prepareAuthorizationModelSafe` and the `bxl-authorization/1` structures are
the lower-level compatibility IR. They remain public for kernel tests and
advanced integration, but they are not the recommended Boxel policy dialect.

## How BXL is used

The adapter compiles each capability's BXL `where` expression into the graph
IR during preparation. The authorization profile extends the policy profile
with compiler-lowered relationship primitives and
ordinary boolean composition:

```bxl
Seat.Owner or Seat.Administrator
(Seat.Provider and Seat.ServiceProvider) or Seat.LeadTeacher
via(Card.Parent; Capability.Edit)
```

The compiler validates every referenced Seat, Capability, and Card link.
Unknown or ambiguous handles fail preparation. Runtime evaluation then walks
the immutable tuple index synchronously with explicit step, depth, candidate,
and result limits.

The important boundary is:

```text
Boxel cards + policy card + authenticated party
                    │
                    ▼
trusted host builds a finite BoxelPolicySnapshot
                    │
                    ▼
prepareBoxelPolicySafe(document, snapshot)
                    │
                    ▼
authorize / listCards / listParties / listCapabilities
                    │
                    ▼
boolean decision + bounded metrics + optional trace
                    │
                    ▼
host validates and executes the command or projects the response
```

Policy and relationship cards are reactive application data, but a prepared
runtime is an immutable decision epoch. When policy fields, seat membership,
or relevant Card links change, construct a new snapshot and prepare it again.
Do not keep using an old prepared runtime after its source epoch changes.

## Public policy dialect

A `boxel-policy/2` document uses Boxel-native nouns:

- Card: the concrete target instance;
- Party: the person, device, service, or nested group requesting access;
- Seat: a relationship-backed role on that Card;
- Capability: the semantic command or mutation being requested.

Minimal policy:

```ts
const document: BoxelPolicyDocument = {
  schema: 'boxel-policy/2',
  scopes: [
    {
      name: 'Request',
      adoptsFrom: '../requests/Request',
      seats: [
        { name: 'Owner', from: 'Card.Owner' },
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
- `via(Card.Link; Capability.Name)` for a declared parent or related Card;
- `and`, `or`, and parentheses for BXL boolean composition;
- `refuse` for explicit denials that override a successful `where`.

Names are UpperCamelCase stable handles. Human-facing labels belong in
`displayName`. Seat sources are direct `Card.Field` or `Policy.Field`
relationship paths.

## Zanzibar-style recursive groups

Policy authors do not call a recursion helper. The authored rule remains:

```bxl
Seat.Provider
```

The relationship snapshot can assign that seat to a Party group:

```ts
const snapshot: BoxelPolicySnapshot = {
  cards: [
    {
      card: '../StudentAccess/student-a',
      adoptsFrom: '../reports/StudentAccess',
      links: { provider: '../Group/student-a-providers' },
    },
  ],
  parties: [
    { party: '../Staff/provider-a' },
    {
      party: '../Group/related-services',
      members: ['../Staff/provider-a'],
    },
    {
      party: '../Group/student-a-providers',
      members: ['../Group/related-services'],
    },
  ],
};
```

The kernel expands the nested membership graph, prunes revisited usersets,
short-circuits a match, and stops at configured limits. Because the Provider
relationship is attached to one StudentAccess card, the grant does not cross
to another student's card.

## Source layout

| File | Responsibility |
| --- | --- |
| `boxel-policy.ts` | Public `boxel-policy/2` document, snapshot, compiler adapter, and prepared APIs. |
| `model.ts` | Private `bxl-authorization/1` compatibility model. |
| `compiler.ts` | Validates and lowers the graph model into immutable IR. |
| `tuple-index.ts` | Builds the finite relationship index. |
| `resolver.ts` | Bounded synchronous Check evaluation and traces. |
| `enumerate.ts` | ListObjects and ListUsers primitives used by public enumeration. |
| `openfga-recursive.ts` | Synchronous TypeScript adaptation of the pinned OpenFGA recursive userset slice. |
| `conditions.ts` | BXL policy-profile predicates for the compatibility IR. |
| `errors.ts` | Fail-closed structured error results. |

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
only by test-only import tooling. Application policy uses `boxel-policy/2` and
BXL expressions.

## Tests and merge gates

Run the full repository gate:

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

Authorization-specific gates:

```sh
npm run fixtures:authorization:verify
npm run test:authorization:conformance
npm run test:authorization:performance
npm run bench:authorization
```

Coverage includes:

- 1,227 pinned OpenFGA semantic assertions with zero unsupported cases and no
  skips;
- generalized coordination scenarios for attendance devices, turn-based
  commands, connected services, nested judging teams, target isolation, and
  capability enumeration;
- generalized education-report scenarios for administrator, instructional,
  provider, and general-staff visibility, recursive provider groups,
  cross-student isolation, and membership reactivity;
- fail-closed invalid input, recursion cycles, depth/step/result limits,
  conditions, traces, and ListCards/ListParties/ListCapabilities parity;
- a generous CI performance regression gate plus a descriptive benchmark.

The timing gate detects gross regressions; it is not a production service-level
objective. Record platform-specific baselines with `npm run
bench:authorization` before tightening any budget.

## Security boundary

The trusted host must authenticate the Party, resolve the target Card, load a
finite and current relationship snapshot, select the policy epoch, and apply
runtime limits. After an allow, the host must still validate command input,
check current business state, serialize writes, and emit normal audit records.

Never use a client-side decision as the only request-time enforcement point.
The same policy can drive a client preview, but an authoritative gateway must
evaluate the current snapshot before accepting a protected command.
