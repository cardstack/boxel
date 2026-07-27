# Realm collaboration use cases

This guide records how BXL is used in the `stack.cards/ctse/realm-collaboration`
realm snapshot reviewed on 2026-07-27. It turns that application corpus into
runnable examples and separates expression-language responsibilities from the
gateway responsibilities around them.

## Inventory

There are 88 statically declared BXL programs across eight source files: 53
`jq`-tagged GTS declarations and 35 plain template declarations consumed by the
live-auction daemon runtime.

| Source | Declarations | What it demonstrates |
| --- | ---: | --- |
| `collaboration-by-example.gts` | 2 | Minimal auction admission and accepted-state update |
| `POCs/stream-policy-harness/stream-policy-harness.gts` | 27 | Tickets, audience interaction, turn games, timed trivia, and a clock transition |
| `POCs/ledger-lab/ledger-lab-gateway.gts` | 24 | Auction, agent activity, spatial presence, and market-tick ledgers |
| `POCs/live-auction-lab/agent-activity-plan.mjs` | 7 | Agent activity admission, state/event branches, and projection |
| `POCs/live-auction-lab/auction-bid-segment.gts` | 7 | FieldDef-hosted auction stream plan |
| `POCs/live-auction-lab/auction-stream-plan.mjs` | 7 | Daemon-hosted auction stream plan |
| `POCs/live-auction-lab/crypto-ticker-plan.mjs` | 7 | Trusted market-source stream |
| `POCs/live-auction-lab/spatial-presence-plan.mjs` | 7 | Bounded move/chat presence stream |
| **Total** | **88** | **15 policy and 73 derive declarations** |

The declarations occupy these gateway slots:

| Slot | Count | Required result |
| --- | ---: | --- |
| `admission` | 14 | One Boolean |
| `rejectionReason` | 13 | One stable reason string |
| `acceptedStatePatch` | 14 | One object |
| `rejectedStatePatch` | 13 | One object |
| `acceptedEvent` | 13 | One object |
| `rejectedEvent` | 13 | One object |
| projection `attributes` | 5 | One object |
| clock `when` | 1 | One Boolean |
| clock `statePatch` | 1 | One object |
| clock `event` | 1 | One object |

Run the source audit against any checkout without importing its Ember modules:

```sh
npm run audit:realm-bxl -- /path/to/realm-collaboration
```

The audit parses tagged and plain-template static declarations in raw-jq mode,
applies their declared `policy` or `derive` profile, and reports source
locations, profile failures, and known root-scope hazards. The reviewed
snapshot compiled all 88 declarations, with five runtime root-scope warnings
described below.

The committed [example corpus](../examples/realm-collaboration-examples.ts)
contains 18 runnable cases spanning every observed evaluation stage and both
static declaration forms. Its unit test is self-contained, so CI does not
require a sibling realm checkout.

## The gateway evaluation envelope

The expressions do not query global application state. The host assembles a
bounded JSON envelope and BXL evaluates only that value:

```ts
interface GatewayEnvelope {
  config: unknown;       // cached policy parameters and allowlists
  state: unknown;        // current authoritative projection
  input: unknown;        // typed command/intent payload
  derived: unknown;      // trusted identity, time, budget, and authority facts
  request: {
    receivedAt: string;  // gateway clock, not expression-local time
    receivedAtMs?: number;
  };
  decision?: { accepted: boolean; reason?: string };
  nextState?: unknown;
}
```

The normal flow is:

1. Evaluate `admission` with the `policy` profile.
2. If false, evaluate `rejectionReason` and the rejected state/event branches.
3. If true, evaluate the accepted state transition.
4. Evaluate the accepted event with `nextState` available when necessary.
5. Let the gateway persist the state and event atomically and advance its
   cursor.

The realm runtime caps each evaluation at 10,000 steps, 25 ms, one output, and
64 KiB. Admission must return a Boolean; state and event declarations must
return one object. An exception fails closed as `policy-error`.

Two Node adapters implement this contract. The stream-policy harness loads the
package (or `BXL_MODULE_PATH`), profile-checks each declaration, prepares it
once, and evaluates the accepted/rejected branches. The live-auction adapter
does the same for its plain plan templates and adds a prepared public
projection slot. Realm cards import the generated local BXL bundle; daemon
processes import the package build. These are distribution choices around the
same compiler and evaluator, not different language dialects.

## Patterns worth keeping in the regression suite

### Capture the root before item scopes

Ticket and turn-game policies compare an array item to command input. Inside
`any`, `all`, or `map`, `.` is the current item, so the envelope is explicitly
captured:

```jq
. as $root
| (.state.status == "selling")
  and any(
    .state.seats[];
    .seatId == $root.input.seatId and .status == "available"
  )
```

The same rule applies to nested game logic. The turn-game transition maps a
cell array, indexes candidate win lines, and uses nested `any`/`all`; `$root`
keeps the current player and command visible through every nested scope.

### Treat state updates as pure values

BXL does not mutate the input. State declarations return a new projection:

```jq
.state + {
  currentBid: .input.amount,
  acceptedBidCount: (.state.acceptedBidCount + 1),
  winnerId: .derived.bidderId,
  updatedAt: .request.receivedAt
}
```

Array updates use `map`, and bounded feeds prepend then slice:

```jq
[{ eventId: .eventIdentity, kind: .input.kind }] + .state.overlay | .[:12]
```

This keeps transitions deterministic and makes before/after values easy to
assert.

### Separate admission from diagnostics

Admission remains a Boolean optimized for fail-closed control. A separate
ordered `if` chain provides stable machine-readable reasons such as
`sale-closed`, `unknown-seat`, `already-answered`, `budget-exceeded`, and
`asset-not-held`. This avoids weakening the gate merely to produce UI text.

### Normalize time outside BXL

Trivia compares numeric `receivedAtMs`, `opensAtMs`, and `closesAtMs` facts.
The auction similarly consumes `beforeOpen`, `afterClose`, `boundaryAt`, and
`offsetMs` from `derived`. The host owns parsing and trust; BXL owns the pure
comparison. The clock transition uses gateway-supplied timestamps and BXL only
selects the next question with modulo/index logic.

### Record rejected attempts

The ledger lab projects both accepted and rejected commands into durable event
objects. A rejection is therefore an auditable fact with an attempt sequence,
actor, received time, reason, and boundary details—not a dropped request.

### Use allowlists with the captured root

The live snapshot contains five forms like this:

```jq
[.input.kind] | inside(.config.allowedKinds)
```

That is invalid raw-jq scoping. After `|`, the input is the new array, so
`.config` attempts to index an array with a string. It affects agent admission
and rejection, spatial admission and rejection, and market admission in
`ledger-lab-gateway.gts`.

Capture the envelope and qualify both sides:

```jq
. as $root
| [$root.input.kind] | inside($root.config.allowedKinds)
```

The committed agent and spatial examples use this corrected form. The realm
source audit emits `root-scope-risk` warnings until the source realm is updated.

## Dynamic and card-authored expressions

The 88-program count covers declarations discoverable directly from source.
The matrix-bot architecture also evaluates expressions stored as card data or
generated at runtime:

- `orchestration-tester.gts` evaluates readable `PolicyRule.conditions[].test`
  strings against schema-backed room projections. It binds the arrival clock
  before evaluation and fails each condition closed on error.
- `box-office-workflow.gts` evaluates persisted workflow `gate` strings, such
  as `present(Attachment[Type = "ticket-request"])`, against a transcript
  schema. Broken gates remain incomplete.
- `decision-table-test.gts`, `ticket-rulebook.gts`, and
  `aftermarket-rulebook.gts` prepare a fact-derivation program, generate a jq
  `def` from an editable BXL skill, prepare the generated decision table once,
  and evaluate it against facts plus enabled rows. Zero matches is uncovered;
  more than one is overlap; both fail closed.
- `decision-test.gts` and `decision-test-styled.gts` evaluate six raw row
  predicates and retain a per-row trace. Their JSON cards persist those traces
  for inspection.
- `expression-field.gts` calls `prepareBxlSafe` while editing to show whether a
  stored expression parses. Schema-dependent readable filters may remain
  “unproven” until evaluated with their schema.

Nineteen `PolicyRule` cards and the workflow/decision-table cards are therefore
executable policy-authoring data, even though they are not part of the 88
statically declared programs. The corpus includes readable policy and workflow
examples, direct fact derivation, a generated `def` decision program, and a
stored decision trace.

The generated `def` programs intentionally use direct `prepareBxlSafe()`, whose
general runtime accepts user helpers. They are not `computeVia` formulas;
moving them to that derive-profile surface would produce `derive-def-banned`.

Keeping these categories separate prevents a count of JSON strings from being
mistaken for the executable gateway corpus while still preserving useful test
and authoring examples.

## What BXL guarantees—and what it does not

| BXL expression/runtime | Gateway or host |
| --- | --- |
| Deterministic evaluation over one supplied JSON value | Authoritative state lookup |
| Policy/derive capability validation | Authentication and role/actor binding |
| Bounded steps, time, outputs, and output bytes | Serialization of concurrent commands |
| Boolean admission and pure state/event projections | Idempotency and event identity |
| Structured parse/profile/runtime failures | Trusted clock and normalized time facts |
| No direct I/O or persistence | Atomic state + ledger persistence and cursor updates |

A static or precompiled BXL program can reduce parse/compile work, but it does
not make the overall workflow atomic or authoritative. Those properties come
from the gateway around the expression.

## Tests

Run the committed semantic corpus:

```sh
node scripts/run-ts-entry.mjs tests/unit/realm-collaboration-cli.ts
```

Static declaration cases are profile-validated. Every case is evaluated with
the appropriate raw-jq or readable mode and the stream adapter's runtime
limits. The suite asserts exact values, exactly one output, Boolean admission
results, and object/array transition shapes.

The examples cover auction windows and a live daemon plan, ticket lookup and
immutable seat rewrite, bounded audience overlays, a winning turn-game move,
trivia duplicate and clock behavior, agent allowlists, spatial rejection,
market projection, rejected ledger events, readable policy/workflow cards,
generated decision tables, editable expectations, and stored decision traces.
