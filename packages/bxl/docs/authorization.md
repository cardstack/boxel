# BXL Authorization

BXL Authorization is BXL's synchronous, host-neutral capability evaluator. It
answers one question:

> May this Party invoke this Capability on this Resource?

That is the complete execution boundary. A yes does not mean that the command
will succeed. The command system remains responsible for input validation,
business rules, patches, receipts, transactions, clocks, and external effects.

For example, a player may have the MakeMove capability while the game engine
still rejects a request because it is another player's turn.

## The four nouns

| Noun       | Meaning                                                          |
| ---------- | ---------------------------------------------------------------- |
| Resource   | The concrete resource on which the operation would be invoked.   |
| Party      | A person, device, service, team, or other actor.                 |
| Seat       | A relationship-backed role the Party occupies for that Resource. |
| Capability | A named command or mutation the Party may invoke.                |

Capabilities should normally match semantic commands:

- RecordScan
- MakeMove
- SubmitAnswer
- GrantApp
- PerformAppAction
- SubmitScore
- DeclareWinner

Use broader Create, Update, or Delete capabilities only when direct CRUD is
actually intended. When mutation authority differs by field or operation,
prefer a specific capability such as EditCitation or UpdateRoster.

## Public API

Prepare one immutable policy document and one finite relationship snapshot:

```ts
import {
  prepareBxlAuthorizationSafe,
  type BxlAuthorizationDocument,
  type BxlAuthorizationSnapshot,
} from '@cardstack/bxl';

const prepared = prepareBxlAuthorizationSafe(document, snapshot);
if (!prepared.ok) throw new Error(prepared.error.message);

const authorization = prepared.value;
```

The prepared evaluator exposes four synchronous queries:

```ts
authorization.checkCapability({ party, capability, resource });
authorization.listResources({ party, capability });
authorization.listParties({ resource, capability });
authorization.listCapabilities({ party, resource });
```

The enumeration APIs are symmetric with `checkCapability`. A capability appears in
`listCapabilities` exactly when `checkCapability` returns yes for the same Party,
Capability, and Resource.

## `bxl-authorization/1` syntax reference

A public authorization document contains one or more named types. The scope's
`name` is its stable UpperCamelCase authorization type; it is not a host type
or module path. The host maps each loaded resource to one of these types when it
builds the snapshot. Put presentation text in `displayName`.

```ts
interface BxlAuthorizationDocument {
  schema: 'bxl-authorization/1';
  id?: string;
  scopes: Array<{
    name: string;
    links?: Array<{ name: string; to: string; displayName?: string }>;
    seats?: Array<{
      name: string;
      displayName?: string;
      from?: `Resource.${string}` | `Policy.${string}`;
    }>;
    capabilities: Array<{
      name: string;
      displayName?: string;
      where: string;
      refuse?: string | Array<{ when: string; because: string }>;
    }>;
  }>;
}
```

The `where` and `refuse.when` strings use the BXL `authorization` profile, a
strict superset of `policy` that adds only compiler-lowered relationship-graph
forms. The public
authorization vocabulary is deliberately small:

| Form                                    | Meaning                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------- |
| `Seat.Operator`                         | The Party occupies this relationship-backed seat on the target Resource.         |
| `Capability.View`                       | Reuse another capability in the same scope.                                      |
| `Party.Anyone`                          | Any concrete Party identifier, matching Zanzibar-style typed-wildcard semantics. |
| `Party.Member`                          | A Party present in `snapshot.members`.                                           |
| `Party.Guest`                           | A Party present in `snapshot.guests`.                                            |
| `via(Resource.Parent; Capability.View)` | Follow a declared Resource link and evaluate the target scope's capability.      |
| `a and b`, `a or b`, `(a)`              | Ordinary BXL boolean composition.                                                |

Examples:

```bxl
Seat.Owner or Seat.Admin
(Seat.ReviewTeam and Seat.SecurityReviewer) or Seat.ReleaseManager
via(Resource.Project; Capability.Edit)
Party.Member and Seat.Contributor
```

Positive eligibility belongs in `where`. Explicit denials belong in `refuse`
and win after eligibility succeeds:

```ts
{
  name: 'Publish',
  where: 'Seat.Editor or Seat.Owner',
  refuse: [
    {
      when: 'Seat.Suspended',
      because: 'Suspended parties cannot publish.',
    },
  ],
}
```

Do not put traversal functions in authored policy. A rule is
`Seat.ReviewTeam`, not `recursiveUserset(Seat.ReviewTeam)`. If the ReviewTeam
seat is held by a Party group, the snapshot's nested `members` relationships
carry the userset graph and the kernel expands it synchronously.

## Inventory example

An inventory service needs to distinguish a loading-dock scanner from a
supervisor:

```ts
const document: BxlAuthorizationDocument = {
  schema: 'bxl-authorization/1',
  id: 'inventory-capabilities',
  scopes: [
    {
      name: 'InventoryLedger',
      seats: [{ name: 'Scanner' }, { name: 'Admin' }],
      capabilities: [
        { name: 'RecordScan', where: 'Seat.Scanner' },
        { name: 'AmendEntry', where: 'Seat.Admin' },
        { name: 'RecordOfflineBatch', where: 'Seat.Admin' },
        { name: 'RevokePolicy', where: 'Seat.Admin' },
      ],
    },
  ],
};
```

The host loads the concrete resources, parties, and seat assignments:

```ts
const snapshot: BxlAuthorizationSnapshot = {
  resources: [
    {
      resource: 'inventory-ledger:main',
      type: 'InventoryLedger',
    },
  ],
  parties: [
    { party: 'device:loading-dock-scanner' },
    { party: 'person:inventory-supervisor' },
  ],
  seats: [
    {
      resource: 'inventory-ledger:main',
      seat: 'Scanner',
      holders: ['device:loading-dock-scanner'],
    },
    {
      resource: 'inventory-ledger:main',
      seat: 'Admin',
      holders: ['person:inventory-supervisor'],
    },
  ],
};
```

The scanner can invoke RecordScan but not AmendEntry:

```ts
authorization.checkCapability({
  party: 'device:loading-dock-scanner',
  capability: 'RecordScan',
  resource: 'inventory-ledger:main',
});
// allowed: true

authorization.checkCapability({
  party: 'device:loading-dock-scanner',
  capability: 'AmendEntry',
  resource: 'inventory-ledger:main',
});
// allowed: false
```

The authorization layer does not inspect whether the scanner is online, the
shipment exists, or the batch is closed. Those are command rules evaluated
after authorization succeeds.

## Nested groups and Zanzibar-style usersets

A seat holder can be a Party group whose members include other Party groups.
For example, Change A's ReviewTeam seat can point to a change-specific review
team, which contains a product-security team, which contains the individual
reviewer. The capability rule remains about the relationship:

```ts
capabilities: [
  {
    name: 'ReviewSecurity',
    where: 'Seat.ReviewTeam and Seat.SecurityReviewer',
  },
],
```

Recursion lives in the relationship tuples, not in the policy syntax. A
ReviewTeam assignment to a Party userset such as ChangeAReviewers#Member tells
the kernel to expand that membership relation. If the group contains another
group userset, expansion continues synchronously and within the configured bounds.
This follows the Zanzibar/OpenFGA model: policy authors declare relations while
the BXL evaluator owns graph traversal. The result remains only allow
or refuse; command execution and mutation logic remain outside authorization.

Keep the assignment scoped to the governed resource. If Change A points to Change
A's review team, membership in that team grants review authority on Change A
only. It does not grant authority on Change C, whose ReviewTeam seat points to
a different group.

## Relationship-sourced seats

A seat can come from the governed Resource:

```ts
{
  name: 'Owner',
  from: 'Resource.Owner',
}
```

If a ConnectedApp resource contains:

```ts
links: {
  owner: 'person:store-owner',
  appPrincipal: 'service:fulfillment-bot',
}
```

then these declarations bind the human owner and service principal:

```ts
seats: [
  { name: 'Owner', from: 'Resource.Owner' },
  { name: 'App', from: 'Resource.AppPrincipal' },
],
capabilities: [
  { name: 'GrantApp', where: 'Seat.Owner' },
  { name: 'RevokeApp', where: 'Seat.Owner' },
  { name: 'PerformAppAction', where: 'Seat.App' },
],
```

The service can perform the app action but cannot grant itself authority. The
owner can grant or revoke the app but does not automatically act as the app.

Policy relationships may also populate a seat with Policy.Field. Explicit seat
assignments remain useful when the relationship is episodic rather than a
permanent relationship on the resource.

## Nested parties

A team can occupy a seat:

```ts
parties: [
  { party: 'person:judge-a' },
  { party: 'person:judge-b' },
  {
    party: 'team:spring-judges',
    members: [
      'person:judge-a',
      'person:judge-b',
    ],
  },
],
seats: [
  {
    resource: 'judging-contest:spring-2026',
    seat: 'Judge',
    holders: ['team:spring-judges'],
  },
],
```

Both members inherit SubmitScore when the capability is Seat.Judge. Membership
is cycle-safe and bounded by the same authorization evaluation limits as every
other traversal.

## Target isolation

Every decision includes the target Resource. Authority on one instance does not
apply automatically to another resource of the same authorization type.

Examples covered by the native suite:

- a player in Match 1 cannot make a move in Match 2;
- the fulfillment service cannot act as the analytics service;
- a Spring judge cannot submit a score to the Fall contest;
- an inventory supervisor assigned to the main ledger has no authority on
  an unassigned satellite ledger.

This is why an authorization result must not be treated as a permanent token.
The gateway should evaluate against the relationship snapshot for the current
decision epoch.

## Capability enumeration

Use listCapabilities to build command surfaces without duplicating policy
logic:

```ts
const result = authorization.listCapabilities({
  party: 'person:inventory-supervisor',
  resource: 'inventory-ledger:main',
});

if (!result.ok) throw new Error(result.error.message);

result.value.capabilities;
// ['AmendEntry', 'RecordOfflineBatch', 'RevokePolicy']
```

The API applies maxCandidates and maxResults limits. It reports accumulated
steps, tuple reads, and maximum recursion depth.

## Host responsibilities

Before evaluation, the trusted host must:

1. authenticate the Party;
2. resolve the target Resource and map it to a declared authorization type;
3. load the finite set of required Party, seat, membership, and Resource links;
4. select the current policy or relationship epoch;
5. pass explicit runtime limits.

After a yes, another system must:

1. validate the command input;
2. apply domain rules against current state;
3. serialize conflicting mutations;
4. write state and receipts;
5. trigger external effects through its normal effect mechanism.

BXL Authorization performs no I/O and does not execute the command.

### Boxel is a host adapter

BXL does not import Card APIs, resolve CardDefs, or interpret realm URLs. A
Boxel host may use a card URL as an opaque resource identifier and map a CardDef
to a policy type while constructing the snapshot. That mapping is application
integration code and is not part of this evaluator or its document syntax.

## Failure behavior

Preparation or evaluation fails closed for:

- unknown resources;
- unknown capabilities;
- invalid Party or Resource identifiers;
- ambiguous or invalid policy handles;
- a Resource whose authorization type has no matching scope;
- malformed relationship sources;
- cycles or work exceeding configured limits.

An ordinary relationship miss is a successful authorization evaluation whose
allowed value is false. A malformed model or request is an error result.

## Conformance

The generalized coordination fixture contains 32 decisions across:

- inventory scanning;
- turn games;
- connected applications;
- judging.

It also verifies listCapabilities parity, nested team membership, target
isolation, relationship-sourced seats, ListResources, and ListParties.

The synthetic software-release fixture adds 40 decisions and 10 capability-list
expectations. It covers policy-sourced membership, distinct release-manager and
maintainer authority, nested and direct review teams, cross-change isolation,
and re-preparing a snapshot after a membership edit.

Run it with:

```sh
node tests/unit/bxl-authorization-cli.ts
node tests/unit/release-governance-policy-cli.ts
```

The private graph kernel separately runs the pinned OpenFGA semantic corpus:

```sh
pnpm test:authorization:conformance
```

That corpus remains a semantic kernel test. OpenFGA syntax and identifiers are
not part of the BXL Authorization authoring API.

Run the non-SLO performance regression gate and the descriptive benchmark with:

```sh
pnpm test:authorization:performance
pnpm bench:authorization
```

The architecture and upstream attribution are summarized in
[`src/authorization/README.md`](../src/authorization/README.md).
