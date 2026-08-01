# Boxel Policy authorization

Boxel Policy is BXL's synchronous capability-authorization surface for
Cardstack and Boxel applications. It answers one question:

> May this Party invoke this Capability on this Card?

That is the complete execution boundary. A yes does not mean that the command
will succeed. The command system remains responsible for input validation,
business rules, patches, receipts, transactions, clocks, and external effects.

For example, a player may have the MakeMove capability while the game engine
still rejects a request because it is another player's turn.

## The four nouns

| Noun | Meaning |
| --- | --- |
| Card | The concrete card on which the operation would be invoked. |
| Party | A person, device, service, team, or other actor. |
| Seat | A relationship-backed role the Party occupies for that Card. |
| Capability | A named command or mutation the Party may invoke. |

Capabilities should normally match semantic commands:

- RecordPunch
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

~~~ts
import {
  prepareBoxelPolicySafe,
  type BoxelPolicyDocument,
  type BoxelPolicySnapshot,
} from '@cardstack/bxl';

const prepared = prepareBoxelPolicySafe(document, snapshot);
if (!prepared.ok) throw new Error(prepared.error.message);

const policy = prepared.value;
~~~

The prepared policy exposes four synchronous queries:

~~~ts
policy.authorize({ party, capability, card });
policy.listCards({ party, capability });
policy.listParties({ card, capability });
policy.listCapabilities({ party, card });
~~~

The enumeration APIs are symmetric with authorize. A capability appears in
listCapabilities exactly when authorize returns yes for the same Party,
Capability, and Card.

## `boxel-policy/2` syntax reference

A public policy document contains one or more CardDef scopes. Names are stable
UpperCamelCase handles; put spaces and other presentation text in
`displayName`.

~~~ts
interface BoxelPolicyDocument {
  schema: 'boxel-policy/2';
  card?: string;
  scopes: Array<{
    name: string;
    adoptsFrom: string;
    links?: Array<{ name: string; to: string; displayName?: string }>;
    seats?: Array<{
      name: string;
      displayName?: string;
      from?: `Card.${string}` | `Policy.${string}`;
    }>;
    capabilities: Array<{
      name: string;
      displayName?: string;
      where: string;
      refuse?: string | Array<{ when: string; because: string }>;
    }>;
  }>;
}
~~~

The `where` and `refuse.when` strings use the BXL `authorization` profile, a
strict superset of `policy` that adds only compiler-lowered relationship-graph
forms. The public
authorization vocabulary is deliberately small:

| Form | Meaning |
| --- | --- |
| `Seat.Operator` | The Party occupies this relationship-backed seat on the target Card. |
| `Capability.View` | Reuse another capability in the same scope. |
| `Party.Anyone` | Any concrete Party identifier, matching Zanzibar-style typed-wildcard semantics. |
| `Party.Member` | A Party present in `snapshot.members`. |
| `Party.Guest` | A Party present in `snapshot.guests`. |
| `via(Card.Parent; Capability.View)` | Follow a declared Card link and evaluate the target scope's capability. |
| `a and b`, `a or b`, `(a)` | Ordinary BXL boolean composition. |

Examples:

~~~bxl
Seat.Owner or Seat.Admin
(Seat.Provider and Seat.ServiceProvider) or Seat.LeadTeacher
via(Card.Project; Capability.Edit)
Party.Member and Seat.Contributor
~~~

Positive eligibility belongs in `where`. Explicit denials belong in `refuse`
and win after eligibility succeeds:

~~~ts
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
~~~

Do not put traversal functions in authored policy. A rule is
`Seat.Provider`, not `recursiveUserset(Seat.Provider)`. If the Provider seat is
held by a Party group, the snapshot's nested `members` relationships carry the
userset graph and the kernel expands it synchronously.

## Attendance example

The attendance gateway needs to distinguish a kiosk from an administrator:

~~~ts
const document: BoxelPolicyDocument = {
  schema: 'boxel-policy/2',
  card: '../Policy/attendance-capabilities',
  scopes: [
    {
      name: 'AttendanceLedger',
      adoptsFrom: '../attendance/AttendanceLedger',
      seats: [
        { name: 'Kiosk' },
        { name: 'Admin' },
      ],
      capabilities: [
        { name: 'RecordPunch', where: 'Seat.Kiosk' },
        { name: 'AmendRecord', where: 'Seat.Admin' },
        { name: 'RecordOfflineDay', where: 'Seat.Admin' },
        { name: 'RevokePolicy', where: 'Seat.Admin' },
      ],
    },
  ],
};
~~~

The host loads the concrete cards, parties, and seat assignments:

~~~ts
const snapshot: BoxelPolicySnapshot = {
  cards: [
    {
      card: '../AttendanceLedger/main',
      adoptsFrom: '../attendance/AttendanceLedger',
    },
  ],
  parties: [
    { party: '../Device/front-desk-1' },
    { party: '../Person/attendance-admin' },
  ],
  seats: [
    {
      scope: '../AttendanceLedger/main',
      seat: 'Kiosk',
      holders: ['../Device/front-desk-1'],
    },
    {
      scope: '../AttendanceLedger/main',
      seat: 'Admin',
      holders: ['../Person/attendance-admin'],
    },
  ],
};
~~~

The kiosk can invoke RecordPunch but not AmendRecord:

~~~ts
policy.authorize({
  party: '../Device/front-desk-1',
  capability: 'RecordPunch',
  card: '../AttendanceLedger/main',
});
// allowed: true

policy.authorize({
  party: '../Device/front-desk-1',
  capability: 'AmendRecord',
  card: '../AttendanceLedger/main',
});
// allowed: false
~~~

The authorization layer does not inspect whether the kiosk is enabled, the
staff member exists, or the cooldown elapsed. Those are command rules evaluated
after authorization succeeds.

## Nested groups and Zanzibar-style usersets

A seat holder can be a Party group whose members include other Party groups.
For example, Student A's Provider seat can point to that student's provider
group, which contains a related-services team, which contains the individual
provider. The capability rule remains about the relationship:

~~~ts
capabilities: [
  {
    name: 'ViewStudentClassroom',
    where: 'Seat.Provider',
  },
],
~~~

Recursion lives in the relationship tuples, not in the policy syntax. A
Provider assignment to a Party userset such as StudentAProviders#Member tells the
kernel to expand that membership relation. If the group contains another group
userset, expansion continues synchronously and within the configured bounds.
This follows the Zanzibar/OpenFGA model: policy authors declare relations while
the authorization engine owns graph traversal. The result remains only allow
or refuse; command execution and mutation logic remain outside authorization.

Keep the assignment scoped to the governed card. If Student A's access card points
to Student A's provider group, membership in that group grants access to that
student's classroom only. It does not grant access to Student B's access card, whose Provider
seat points to a different group.

## Relationship-sourced seats

A seat can come from the governed Card:

~~~ts
{
  name: 'Owner',
  from: 'Card.Owner',
}
~~~

If a ConnectedApp card contains:

~~~ts
links: {
  owner: '../Person/store-owner',
  appPrincipal: '../Service/fulfillment-bot',
}
~~~

then these declarations bind the human owner and service principal:

~~~ts
seats: [
  { name: 'Owner', from: 'Card.Owner' },
  { name: 'App', from: 'Card.AppPrincipal' },
],
capabilities: [
  { name: 'GrantApp', where: 'Seat.Owner' },
  { name: 'RevokeApp', where: 'Seat.Owner' },
  { name: 'PerformAppAction', where: 'Seat.App' },
],
~~~

The service can perform the app action but cannot grant itself authority. The
owner can grant or revoke the app but does not automatically act as the app.

Policy relationships may also populate a seat with Policy.Field. Explicit seat
assignments remain useful when the relationship is episodic rather than a
permanent field on the CardDef.

## Nested parties

A team can occupy a seat:

~~~ts
parties: [
  { party: '../Person/judge-a' },
  { party: '../Person/judge-b' },
  {
    party: '../Team/spring-judges',
    members: [
      '../Person/judge-a',
      '../Person/judge-b',
    ],
  },
],
seats: [
  {
    scope: '../JudgingContest/spring-2026',
    seat: 'Judge',
    holders: ['../Team/spring-judges'],
  },
],
~~~

Both members inherit SubmitScore when the capability is Seat.Judge. Membership
is cycle-safe and bounded by the same authorization runtime limits as every
other traversal.

## Target isolation

Every decision includes the target Card. Authority on one instance does not
apply automatically to another instance of the same CardDef.

Examples covered by the native suite:

- a player in Match 1 cannot make a move in Match 2;
- the fulfillment service cannot act as the analytics service;
- a Spring judge cannot submit a score to the Fall contest;
- an attendance administrator assigned to the main ledger has no authority on
  an unassigned satellite ledger.

This is why an authorization result must not be treated as a permanent token.
The gateway should evaluate against the relationship snapshot for the current
decision epoch.

## Capability enumeration

Use listCapabilities to build command surfaces without duplicating policy
logic:

~~~ts
const result = policy.listCapabilities({
  party: '../Person/attendance-admin',
  card: '../AttendanceLedger/main',
});

if (!result.ok) throw new Error(result.error.message);

result.value.capabilities;
// ['AmendRecord', 'RecordOfflineDay', 'RevokePolicy']
~~~

The API applies maxCandidates and maxResults limits. It reports accumulated
steps, tuple reads, and maximum recursion depth.

## Host responsibilities

Before evaluation, the trusted host must:

1. authenticate the Party;
2. resolve the target Card and its CardDef;
3. load the finite set of required Party, seat, membership, and Card links;
4. select the current policy or relationship epoch;
5. pass explicit runtime limits.

After a yes, another system must:

1. validate the command input;
2. apply domain rules against current state;
3. serialize conflicting mutations;
4. write state and receipts;
5. trigger external effects through its normal effect mechanism.

Boxel Policy performs no I/O and does not execute the command.

## Failure behavior

Preparation or evaluation fails closed for:

- unknown cards;
- unknown capabilities;
- invalid Party or Card identifiers;
- ambiguous or invalid policy handles;
- a Card whose CardDef has no matching scope;
- malformed relationship sources;
- cycles or work exceeding configured limits.

An ordinary relationship miss is a successful authorization evaluation whose
allowed value is false. A malformed model or request is an error result.

## Conformance

The generalized coordination fixture contains 32 decisions across:

- staff attendance;
- turn games;
- connected applications;
- judging.

It also verifies listCapabilities parity, nested team membership, target
isolation, relationship-sourced seats, ListCards, and ListParties.

The generalized education fixture adds 40 classroom-report decisions and 10
capability-list expectations. It covers policy-sourced membership, a
Staff-only room view, administrator internal-note refusal, nested and direct
provider groups, cross-student isolation, and re-preparing a snapshot after a
membership edit.

Run it with:

~~~sh
node scripts/run-ts-entry.mjs tests/unit/boxel-policy-cli.ts
node scripts/run-ts-entry.mjs tests/unit/education-policy-cli.ts
~~~

The private graph kernel separately runs the pinned OpenFGA semantic corpus:

~~~sh
npm run test:authorization:conformance
~~~

That corpus remains a semantic kernel test. OpenFGA syntax and identifiers are
not part of the Boxel Policy authoring API.

Run the non-SLO performance regression gate and the descriptive benchmark with:

~~~sh
npm run test:authorization:performance
npm run bench:authorization
~~~

The architecture and upstream attribution are summarized in
[`src/authorization/README.md`](../src/authorization/README.md).
