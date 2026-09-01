# Reviewer’s Guide: BXL Clinical Mutation Atlas

This PR prototypes `POST /_mutate` as a command-style, source-only BXL mutation
endpoint and demonstrates it with **synthetic clinical data only**. The sample
realm is `packages/bxl-clinical-mutation-realm`; Tessar data, mounts, helpers,
notes, and fixtures are deliberately excluded.

All patients, clinicians, contacts, facilities, identifiers, notes, and events
in the clinical realm are fictional.

## Start here

1. Start the normal local services.
2. Open the [BXL Clinical Mutation Atlas](./ClinicalMutationWorkbench/main).
3. Pick a scenario from the table of contents.
4. Read the intent, the **BXL demonstrated** note, and the highlighted Apply and
   Reverse programs.
5. Click **Apply operation** and watch the focused section of the live patient
   card at right.
6. Click **Reverse operation** and confirm that the same target returns to its
   baseline.

The review criterion is visual and strict: the directly edited target must
refresh from its Matrix index event within 10 seconds. An early HTTP response
without a refreshed live card is a failure.

Local URLs:

- Realm: `https://localhost:4251/bxl-clinical-mutation/`
- Atlas: `https://localhost:4251/bxl-clinical-mutation/ClinicalMutationWorkbench/main`
- Mutated target: `https://localhost:4251/bxl-clinical-mutation/PatientDashboard/pt-1001`

## What the prototype proves

BXL operates like a typed `jq` over the persisted Card JSON source. It does not
load and edit a Card model, and it does not reprint the document through PATCH.
The existing BXL mutation language, planner, and Card-source adapter remain
unchanged.

For each request the realm server:

1. resolves the target inside the current realm;
2. reads the stored JSON:API Card document;
3. derives a mutation schema from `meta.adoptsFrom`;
4. executes the supplied BXL program against that source document;
5. lets the BXL Card-source adapter maintain JSON:API relationship keys;
6. atomically writes only the transformed JSON source under the realm write
   lock;
7. indexes and broadcasts the directly edited target first; and
8. schedules recursive dependent invalidation as lower-priority background
   work.

This gives commands fast target visibility without abandoning eventual
consistency for cards that depend on the edited source.

## How this spike fits “Introduce Card Operations”

This PR is a focused implementation subset that the **Introduce Card
Operations** Linear project can use. It implements and exercises the
single-Card `mutate` base-operation executor, including the BXL-to-source
adapter boundary and the indexing/event behavior needed for a live client.
The Card Operations project remains the owner of the named-operation layer.

| Card Operations requirement                                      | How it uses this spike                                                                                                                  | Status in this PR                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Operations are data/config only                                  | A serializable `OperationDefinition`; no operation-specific realm-server JavaScript                                                     | Atlas operation records prove the data-only shape                                                                      |
| `read`, `update`, `delete`, `create`, `mutate` base operations   | Route the `mutate` case through this source-only executor; retain the other base-operation implementations behind the common dispatcher | `mutate` executes; authorized `read` is demonstrated client-side and specified server-side; unified dispatcher remains |
| Preprocess `payload`                                             | BXL `input` transformations over an operation context document                                                                          | Contract specified; runner remains                                                                                     |
| Execute `runOperation(author, instance, baseOperation, payload)` | Authenticated `OperationContext` with actor, target, payload, request identity, and outputs from earlier atomic steps                   | Contract specified; runner remains                                                                                     |
| Postprocess output                                               | BXL `output` projection/redaction before any result enters the client store                                                             | Contract specified; server-side read/output proxy remains                                                              |
| `@operation` declarations on Card definitions                    | Static operation metadata registered by the Card loader and resolved from the target’s `adoptsFrom`                                     | Illustrative authoring syntax only; decorator/registry remains                                                         |
| Factory helpers such as append-to-many                           | Factories emit ordinary operation data and canonical BXL; they are authoring sugar, not server plug-ins                                 | Canonical BXL behavior is exercised directly                                                                           |
| `POST /operations` using JSON:API Atomic                         | Named operations lower to validated base operations and commit through a multi-document atomic coordinator                              | Single-target `/_mutate` exists; named endpoint and coordinator remain                                                 |
| Assigning a relationship grants access                           | Relationship mutation and authorization tuples/policy changes are explicit coordinated effects                                          | Relationship edits and BXL authorization are demonstrated separately; server gate remains                              |
| Create reports/activities and link them                          | `create` produces a separately typed Card document; a following `mutate` links it, all under one outer atomic transaction               | Concrete compounded-prescription contract is documented below; multi-Card execution remains                            |
| Parent reads/lists external reports                              | Authorized `read`/query operations return only the actor’s server-side projection and visible action catalog                            | Concrete clinical projections are demonstrated; server proxy remains                                                   |

This means the Linear story does not need to reinvent BXL planning, JSON:API
source adaptation, target-first indexing, or Matrix invalidation. It can build
the author-facing operation system on this lower-level primitive.

### Operation definition above this primitive

The named-operation layer can make each execution stage explicit:

```ts
type BaseOperation = 'read' | 'update' | 'delete' | 'create' | 'mutate';

type BxlTransformation = {
  source: string;
  syntax?: 'readable' | 'solidified';
};

type OperationDefinition = {
  baseOperation: BaseOperation;
  input?: BxlTransformation[];
  authorize?: {
    capability: string;
    resource?: BxlTransformation;
  };
  execute?: BxlTransformation[];
  output?: BxlTransformation[];
  resultType?: { module: string; name: string };
};

type OperationContext = {
  actor: { id: string };
  instance: { id: string } | null;
  payload: unknown;
  request: { id: string; realm: string };
  steps: Array<{ id: string; result: unknown }>;
};
```

All BXL stages run against bounded JSON values. For a `mutate` execution stage,
the mutation profile remains bound to one authoritative Card source. The
operation coordinator—not BXL—owns cross-document identity, locking, and
commit.

An author-facing declaration can stay compact:

```ts
class ExternalReport extends CardDef {
  @operation static addComment = OperationFactory.appendContained({
    field: 'comments',
    authorize: 'CommentOnExternalReport',
    value: {
      body: '$payload.data.attributes.body',
      author: 'card($actor.id)',
    },
  });
}
```

The factory must lower to ordinary data equivalent to canonical mutation BXL,
not custom server code:

```bxl
assert(
  .status != "locked";
  "Comments are closed for this report"
);
append(
  .comments;
  {
    body: $payload.data.attributes.body,
    author: card($actor.id)
  }
);
```

The Card-source adapter writes the contained attributes, the new indexed
`comments.N.author` relationship, and any required metadata sidecars together.
Authors do not calculate the next flattened JSON:API relationship key.

Likewise, inviting a parent or guardian lowers to a normal relationship edit:

```bxl
assert(
  all(.externalPortalACL[]; .id != $payload.data.id);
  "This person already has portal access"
);
append(
  .externalPortalACL;
  card($payload.data.id)
);
```

### Operation HTTP and atomic contract

The external request remains JSON:API Atomic, but each entry names a Card
operation rather than overloading JSON:API’s built-in `op` vocabulary:

```http
POST /operations HTTP/1.1
Content-Type: application/vnd.api+json;ext="https://jsonapi.org/ext/atomic"
Accept: application/vnd.api+json;ext="https://jsonapi.org/ext/atomic"

{
  "atomic:operations": [{
    "op": "invoke",
    "name": "addComment",
    "href": "/reports/my-report-id",
    "data": {
      "type": "CommentField",
      "attributes": { "body": "This is my comment text" }
    }
  }]
}
```

The realm resolves `name` from the target Card definition, authenticates the
actor, runs `input`, authorizes the resulting context, dispatches the declared
base operation, runs `output`, and commits all entries or none. Results from an
earlier entry are addressable by stable step ID so a later mutation can link a
newly created Card without string interpolation or an uncommitted public URL.

### Mapping the earlier classroom examples onto this spike

The clinical Atlas covers the same structural requirements with less
domain-specific ambiguity:

| Earlier example                      | Clinical equivalent / replacement technique                                              |
| ------------------------------------ | ---------------------------------------------------------------------------------------- |
| Add classroom activity               | Create a clinical resource, then link it to care-plan and shared-resource walls          |
| Assign teacher and grant access      | Add a consultant/team relationship and separately authorize the resulting capability     |
| Assign student to RSP                | Add a care contact or clinical team edge with an explicit policy effect                  |
| Assign student to several classrooms | Append one resource to multiple ordered `linksToMany` fields in one outer atomic command |
| Create internal report               | Create a separately typed staff-only Card and link it under an authorized operation      |
| Create external report               | Create a separately typed patient-visible Card with an output projection                 |
| Parent reads external report         | Server-side authorized `read` projection                                                 |
| Parent lists reports                 | Authorized query/list operation whose result contains only permitted resources           |
| Add report comment                   | `containsMany` append plus nested `linksTo` author, maintained by the source adapter     |
| Invite parent/guardian               | `linksToMany` append guarded by authorization and duplicate assertion                    |

The Atlas additionally covers exact-one selection, explicit bulk mutation,
arithmetic updates, deep copy, ordered contains and relationship moves,
contains-with-link coordination, reversibility, target-first indexing, useful
assertion errors, and Matrix-driven live refresh.

## End-to-end approach

```text
Card-authored operation or command
        │  href + BXL source + syntax + program identity
        ▼
Authenticated host command bridge
        │  POST /_mutate
        ▼
Realm endpoint ──► adoptsFrom definition ──► mutation schema
        │
        ▼
Existing BXL planner + Card-source adapter
        │  next JSON:API source document
        ▼
Realm write lock + atomic source write
        │
        ├── foreground: direct target index (priority 10)
        │                  │
        │                  └── Matrix event names the actual target URL
        │
        └── background: recursive dependents (priority 3)
                           │
                           └── later Matrix event for the dependent closure
```

The important boundary is between **author intent** and **runtime mechanics**.
A Card author supplies data and a BXL transformation. The realm owns schema
lookup, JSON:API adaptation, locking, persistence, indexing, event delivery,
and error normalization. No operation-specific JavaScript is installed in the
realm server.

## How the parts fit together

### 1. Card authoring: operations are data

**Approach.** A Card author describes a mutation as BXL source attached to a
scenario today and, in the intended operations API, to an `@operation`
declaration. The program names Card fields rather than JSON:API relationship
keys or Ember object internals.

**Change in this PR.** The clinical Atlas stores ten Apply/Reverse program pairs
as data in `ClinicalMutationWorkbench/main.json`. The GTS card is a generic
runner and renderer; it contains no clinical mutation branches.

**Rationale.** Operations should be portable, inspectable configuration. A
realm must not need custom server code for “titrate a medication,” “add a care
contact,” or “reorder consultants.”

**In practice for Card authors.** Authors can:

- assign scalar and nested contained fields directly;
- select contained records by stable domain identity instead of array index;
- opt into one-or-more updates with explicit bulk selectors;
- append, prepend, insert, move, reorder, copy, and delete contained values;
- use `card(id)` for `linksTo` and `linksToMany` identities while the adapter
  writes the corresponding JSON:API relationships; and
- begin Apply and Reverse programs with `assert(...)` to reject stale or
  directionally invalid state with a useful domain message.

Authors should leave computed fields alone, prefer semantic selectors, and
write an explicit inverse for demonstrations or workflows that require undo.

### 2. Host command bridge: authenticated command delivery

**Approach.** The Atlas invokes a normal Boxel command, not browser-global
`fetch` and not Card edit mode. `AuthedFetchCommand` carries the current realm
session through the virtual network.

**Change in this PR.** `AuthedFetchInput` gains `contentType` and `requestBody`.
The host tool forwards those values and parses both success and failure bodies.

**Rationale.** A mutation button needs the same authentication and realm
routing as other host commands, and a failed BXL assertion must reach the Card
as structured feedback rather than collapse into “Bad Request.”

**In practice for Card authors.** The current spike’s generic runner sends:

```ts
new AuthedFetchCommand(commandContext).execute({
  url: `${realmURL}_mutate`,
  method: 'POST',
  acceptHeader: 'application/vnd.card+json',
  contentType: 'application/json',
  requestBody: JSON.stringify({ href, source, syntax, programId }),
});
```

The future operations API should hide even this request boilerplate: an author
should choose an operation and payload while the host constructs the command.

### 3. Realm endpoint: BXL over persisted Card source

**Approach.** `POST /_mutate` reads `<href>.json` and transforms that source
document directly. It does not instantiate a Card model and does not translate
the command into PATCH.

**Change in this PR.** `realm.ts` resolves the local target, validates that it
is a Card JSON document, resolves its `adoptsFrom`, prepares a loader-backed
mutation schema, and calls the existing `mutateBxlCardSource` entry point.

**Rationale.** BXL mutation is DML for Card source. Source-level execution
preserves untouched attributes, metadata, relationship spellings, and ordering
without coupling the endpoint to UI Card instances.

**In practice for Card authors.** Programs address the logical Card shape:

```bxl
assert(.status == "admitted"; "Patient is no longer admitted");
.vitals.heartRate = 112;
append(.consultingClinicians; card("https://example.test/Principal/icu-rn"));
```

The author does not create `relationships["consultingClinicians.2"]` manually.
The Card-source adapter translates the logical link operation into valid
JSON:API source.

### 4. Schema and BXL adapter: typed, unchanged machinery

**Approach.** The endpoint uses the target Card definition to distinguish
scalar fields, `contains`, `containsMany`, `linksTo`, and `linksToMany` before
planning a write.

**Change in this PR.** Runtime Common takes an explicit dependency on
`@cardstack/bxl` and wires the existing mutation exports into the realm. The
BXL parser, mutation profile, planner, and Card-source adapter are unchanged.

**Rationale.** The spike is testing whether the existing language can serve as
a realm mutation primitive—not quietly changing the language until the demo
works.

**In practice for Card authors.** Invalid field paths, ambiguous exact-one
selectors, failed assertions, and illegal shape changes fail before the source
write. Relationship helpers accept canonical Card IDs and the adapter handles
the storage representation.

### 5. Persistence and concurrency: one authoritative source write

**Approach.** Schema preparation occurs outside the realm lock. Immediately
before mutation, the realm takes its write lock, re-reads the current file,
checks that `adoptsFrom` did not change, executes BXL against that current
source, and writes the result atomically.

**Change in this PR.** `/_mutate` uses the same per-realm cross-replica write
serialization as other writes while avoiding slow module preparation inside
the critical section.

**Rationale.** Two commands must not both plan against the same stale file and
silently overwrite one another. Conversely, unrelated schema loading should
not hold the write lock.

**In practice for Card authors.** Assertions are still important business
preconditions. The lock prevents lost writes; `assert(...)` explains why the
current state no longer permits the requested operation.

### 6. Foreground indexing: make the edited Card visible first

**Approach.** The source write is followed by a direct index visit containing
only the explicitly changed URL seeds. The response waits for that target to
be indexed and for its Matrix index event to be dispatched.

**Change in this PR.** Index writer/runner/updater/job plumbing carries an
`invalidationMode` of `direct` or `recursive`. Direct mode tombstones and
revisits the supplied targets without first expanding their dependent closure.

**Rationale.** The user changed one Card and is looking at that Card. A large
dependency graph must not turn a millisecond source mutation into a minute-long
“Working…” state.

**In practice for Card authors.** A command may mutate a Card other than the
Card that owns the button. The author supplies that target in `href`; the realm
broadcasts that exact canonical target URL, and any visible instance of that
Card reloads.

### 7. Background dependent indexing: consistency without blocking intent

**Approach.** After the direct target commits, the realm enqueues a recursive
pass at priority 3. It discovers and reindexes cards whose assembled or
computed output depends on the changed source.

**Change in this PR.** The queue defines an interactive-dependent tier and the
indexer preserves invalidation mode through publication and job coalescing.

**Rationale.** Dependents still need correctness, but they are not on the
critical path of confirming the user’s direct command. Priority 3 keeps this
work above ordinary system indexing while below new interactive requests.

**In practice for Card authors.** The directly mutated Card is read-after-write
consistent. Derived or dependent Cards are eventually consistent and receive
their own later Matrix event. An operation should not assume the entire realm
has finished re-rendering when the command returns.

### 8. Matrix events and the client store: command echo is intentional

**Approach.** This command path sends no `clientRequestId`. The initiating
client therefore receives the same target invalidation as every other client.

**Change in this PR.** The foreground invalidation set explicitly includes the
mutated root even when direct indexing finds no recursive invalidations. Event
dispatch is part of the foreground completion boundary.

**Rationale.** Unlike Edit Card, the current Atlas has not already updated the
target object in the client store. Suppressing the event would leave the
embedded result stale even though disk and index are correct.

**In practice for Card authors.** A command button can fire `/_mutate`, stop
showing “Working…” after the foreground result completes, and rely on the
Matrix event to refresh every visible rendering of the actual target.

### 9. Worker topology and service wiring

**Approach.** Local development mounts the synthetic clinical realm and
reserves a worker lane for user-index jobs.

**Change in this PR.** Mise service tasks add the clinical realm mappings,
`WORKER_USER_INDEX_COUNT`, and `--userIndexCount`. Filesystem watcher changes
remain system-priority background synchronization.

**Rationale.** A target-first algorithm still feels slow if all workers are
occupied by low-priority prerender or indexing work. The reserved lane makes
the priority contract operational rather than documentary.

**In practice for Card authors.** No per-Card worker configuration is needed.
Interactive commands naturally enter the user tier; recursive fan-out is
demoted by the realm.

### 10. Errors and reversibility

**Approach.** Parser, schema, planning, assertion, selection, and adapter errors
are returned as structured `400` responses. Missing source is `404`. The Atlas
extracts the useful message and keeps Apply/Reverse state local to the runner.

**Change in this PR.** The endpoint normalizes BXL error phase and code, the
host retains error bodies, and every Atlas program includes state assertions.

**Rationale.** “Bad Request” is not an authoring experience. The author needs
to know whether syntax, selection cardinality, stale state, or schema caused
the rejection.

**In practice for Card authors.** Write domain messages that tell the operator
what prerequisite is missing. Reverse should assert that its forward state is
actually present before deleting or restoring anything.

## Endpoint contract

```http
POST /_mutate
Accept: application/vnd.card+json
Content-Type: application/json
```

```json
{
  "href": "/PatientDashboard/pt-1001",
  "source": ".vitals.heartRate = 112;",
  "syntax": "solidified",
  "programId": "clinical-review:heart-rate"
}
```

| Field       | Meaning                                                                  |
| ----------- | ------------------------------------------------------------------------ |
| `href`      | Realm-relative path, URL, or registered RRI for one stored Card instance |
| `source`    | BXL mutation program                                                     |
| `syntax`    | `readable` or `solidified`; defaults to `readable`                       |
| `programId` | Optional diagnostic identity; generated when absent                      |

Successful writes return `204 No Content`, `Last-Modified`, and `Cache-Control:
no-store`. A no-op also returns `204`. Missing targets return `404`; invalid
request bodies, schema preparation, assertions, selectors, and BXL programs
return useful `400` responses without changing the source file.

## Indexing and live-update policy

`/_mutate` is a DML command, not an optimistic Card editing request. The caller
has no local Card-model edit to preserve, so the command intentionally uses no
client request ID and receives its own Matrix invalidation.

| Work                           | Priority | Invalidation mode | Request waits?  | Matrix event                                |
| ------------------------------ | -------: | ----------------- | --------------- | ------------------------------------------- |
| Explicitly mutated target      |       10 | Direct            | Yes             | Broadcasts the actual target URL            |
| Recursive dependents           |        3 | Recursive         | No by default   | Broadcast after background indexing settles |
| Filesystem/CLI synchronization |        1 | Recursive         | Background path | Normal realm index event                    |

Direct invalidation tombstones and revisits only the supplied URL seeds. It
does not discover the full dependent closure. The background job performs that
recursive discovery later while preserving the realm’s single serialized index
lane.

A future optimistic Card API mutation can supply a client request ID and
suppress its own Matrix echo. This endpoint must not suppress that echo.

## Atlas coverage

|   # | Clinical command                        | BXL capability under review                                                                             |
| --: | --------------------------------------- | ------------------------------------------------------------------------------------------------------- |
|  01 | Escalate an acute rhythm-control event  | Assertions, nested contained fields, atomic multi-write, audit append, predicate deletion               |
|  02 | Titrate Warfarin and hold the dose      | Exact-one `select`, arithmetic update, sibling updates, stale-state rejection                           |
|  03 | Hold every administered medication      | Explicit bulk selector, one-or-more semantics, sibling preservation                                     |
|  04 | Post cardioversion and pharmacy charges | Sequential arithmetic, computed Card field left untouched, coordinated audit                            |
|  05 | Insert fall precautions after mobility  | Stable semantic anchor and `insert_item_after` on `containsMany`                                        |
|  06 | Promote mobility to first priority      | `move_item_before`, stable anchors, intact contained-object reorder, canonical reset                    |
|  07 | Draft a discharge summary               | `copy_value_to`, deep-copy semantics, destination-only transformation                                   |
|  08 | Expand and reorder the consult team     | `linksToMany` add, validate, reorder, bulk remove, and reverse                                          |
|  09 | Designate a healthcare proxy            | `containsMany` record plus nested `linksTo` identity in one atomic command                              |
|  10 | Execute an ICU transfer                 | Mixed scalar, contains, `linksTo`, two `linksToMany` collections, prepend, and audit as one transaction |

Every scenario has an explicit inverse program. Apply and Reverse begin with
assertions so an invalid direction produces a domain-specific error instead of
silently corrupting the demonstration state.

## Quick BXL mutation language reference

This is intentionally a reference to syntax **actually exercised by this
Atlas**, not a complete language specification. It is suitable for copying
into an agent prompt with the target Card schema and desired outcome.

### Paths, selection, and assignment

```bxl
# Scalar and nested contains fields
.severity = "Critical";
.vitals.heartRate = 132;

# Array position, traversal, and exact-one semantic selection
.caretakerInstructions[0].activity == "Meals";
.medications[] | select(.name == "Warfarin") | .doseMg;

# Explicit one-or-more bulk selection
.medications[* .lastDoseStatus == "Administered"] | .lastDoseStatus;

# Update assignment; `.` on the right is the selected current value
.billing.pharmacy |= . + 640;
.dischargeSummaryDraft |= . + " Arrange follow-up within 48 hours.";
```

The demo uses `==`, `!=`, `and`, strings, numbers, `null`, object literals, and
array literals. Statements end in `;`. Function arguments are also separated
with `;`.

### Preconditions and collection predicates

```bxl
assert(
  .status == "admitted" and .severity == "Moderate";
  "Apply unavailable: patient is not at the expected baseline"
);

any(.medications[]; .lastDoseStatus == "Administered");
all(.careContacts[]; .personLabel != "Helen Mensah");
```

`assert` rejects the entire program before persistence. `any` and `all` are
used for presence/absence checks over collections. `select(...)` is used when
the mutation requires exactly one semantic match; an ambiguous or empty match
is an error instead of an accidental update.

### Add, remove, and construct values

```bxl
append(
  .auditTrail;
  {
    occurredAt: "2026-09-01 10:12",
    actor: "Jordan Blake, RN",
    action: "Escalated acute event"
  }
);

prepend(
  .caretakerInstructions;
  {
    activity: "Continuous monitoring",
    status: "Critical",
    instruction: "Continuous telemetry and pulse oximetry.",
    schedule: "Continuous"
  }
);

del(.auditTrail[* .occurredAt == "2026-09-01 10:12"]);
```

The predicate inside `[* ...]` is deliberately visible: deletion is bulk only
when the author asks for bulk behavior.

### Create and manage links

```bxl
# Replace linksTo
.careTeam = card("https://example.test/Principal/icu-care-team");

# Append to linksToMany
append(
  .consultingClinicians;
  card("https://example.test/Principal/icu-nurse")
);

# Select or delete existing links by canonical Card identity
.consultingClinicians[]
| select(.id == "https://example.test/Principal/icu-nurse");

del(
  .consultingClinicians[* .id == "https://example.test/Principal/icu-nurse"]
);
```

`card(id)` represents linked Card identity. The Card-source adapter writes and
renumbers JSON:API relationship keys; the author does not manipulate those
keys.

### Ordered structural edits

```bxl
insert_item_after(
  {
    activity: "Fall precautions",
    status: "High risk",
    instruction: "Use gait belt and two-person assist.",
    schedule: "Every transfer"
  };
  .caretakerInstructions[] | select(.activity == "Mobility")
);

move_item_before(
  .consultingClinicians[] | select(.id == "https://example.test/Principal/emergency");
  .consultingClinicians[] | select(.id == "https://example.test/Principal/pharmacist")
);

reorder_by(
  .caretakerInstructions;
  .activity;
  ["Meals", "Feeding", "Bathroom", "Mobility"]
);
```

These functions preserve the selected contained object or linked Card while
changing collection structure. Prefer stable field values or Card IDs as
anchors, not numeric positions.

### Deep copy

```bxl
copy_value_to(
  .careSummary;
  .dischargeSummaryDraft
);
.dischargeSummaryDraft |= . + " Arrange INR follow-up within 48 hours.";
```

`copy_value_to` creates a distinct destination value. Later changes to the
copy do not alias the source.

### Agent-ready authoring prompt

```text
Write one solidified BXL mutation program for the supplied Card schema.
Operate on the logical Card field shape, not raw JSON:API relationship keys.
Begin with assert(...) using a domain-specific failure message. Use select(...)
for exactly one match and [* predicate] only when one-or-more bulk behavior is
intended. Use card(canonicalId) for links. Preserve unrelated fields and
computed fields. End every statement with a semicolon. Also provide an explicit
reverse program with its own assertion.
```

## Clinical demo files

The realm is intentionally self-contained:

- `clinical-mutation-workbench.gts` — one wide Atlas card, table of contents,
  syntax highlighting, commands, error display, scenario-aware target focus,
  and the embedded isolated result.
- `ClinicalMutationWorkbench/main.json` — ten ordered mutation scenarios and
  their Apply/Reverse BXL programs.
- `patient-dashboard.gts` and `PatientDashboard/*.json` — mixed clinical data
  shapes: scalar fields, nested `contains`, `containsMany`, `linksTo`, and
  `linksToMany`.
- `principal.gts`, `Principal/*.json`, `facility.gts`, and clinical resource
  files — synthetic linked identities and resources.
- `clinical-access-policy.gts` and `ClinicalAccessPolicy/main.json` — existing
  BXL authorization projection used to make the before/after result realistic.
- `workspace.gts`, `index.json`, theme, README, and scenario documentation —
  discoverability and presentation.
- `bxl/` — the clinical realm’s existing authorization runtime copy; it is not
  the mutation implementation changed by this PR.

## Required monorepo changes

### Realm runtime

- `packages/runtime-common/realm.ts`
  - registers and implements `POST /_mutate`;
  - resolves and validates source targets;
  - builds the loader-backed mutation schema;
  - runs `mutateBxlCardSource` without changing BXL’s mutation profile;
  - serializes concurrent source mutations with the realm write lock;
  - publishes the direct target before background dependents; and
  - broadcasts target and dependent Matrix index events at the correct phase.
- `packages/runtime-common/index-writer.ts` adds direct invalidation seeds.
- `packages/runtime-common/index-runner.ts`, `realm-index-updater.ts`,
  `jobs/indexing.ts`, and `tasks/indexer.ts` carry `direct` versus `recursive`
  invalidation mode through queued indexing and preserve it during coalescing.
- `packages/runtime-common/queue.ts` defines priority 3 for dependents spawned
  by an interactive write.
- `packages/runtime-common/package.json` and `pnpm-lock.yaml` make
  `@cardstack/bxl` an explicit runtime dependency.
- `packages/runtime-common/file-meta.ts` selects the correct conflict target
  for databases with or without the newer `realm_view` column. Review this as a
  compatibility accommodation, not part of BXL semantics.

### Host command bridge

- `packages/base/command.gts` adds `contentType` and `requestBody` to
  `AuthedFetchInput`.
- `packages/host/app/tools/authed-fetch.ts` sends authenticated JSON bodies and
  preserves structured or raw error responses.
- `packages/host/tests/integration/tools/authed-fetch-test.gts` covers the new
  body/header behavior and error-body parsing.

The Atlas uses this authenticated command bridge. It does not mutate by
pretending that the embedded target is in Card edit mode.

### Realm server and local services

- `packages/realm-server/tests/realm-endpoints/mutate-test.ts` covers a scalar
  source rewrite, invalid BXL/no write, missing target, and a `linksToMany`
  relationship append.
- `packages/realm-server/scripts/clinical-mutate.ts` is a focused CLI helper
  for the synthetic clinical realm.
- `mise-tasks/services/realm-server` mounts the clinical realm.
- `mise-tasks/services/worker` maps the realm and starts a dedicated
  user-index worker lane.
- `mise-tasks/lib/env-vars.sh` supplies the local user-index worker count.
- `.gitignore` excludes the local `.pnpm-store/` cache.

## Focused verification

For this spike, prefer the narrow checks below over the complete monorepo test
suites:

```sh
cd packages/realm-server
TEST_FILES=realm-endpoints/mutate-test pnpm test

cd ../host
pnpm exec ember test --path dist --filter "tools | authed-fetch"
```

Direct CLI smoke test:

```sh
mise exec -- node packages/realm-server/scripts/clinical-mutate.ts \
  /PatientDashboard/pt-1001 \
  '.vitals.heartRate = 112;' \
  --syntax solidified
```

Use the Atlas Reverse program afterward rather than hand-editing the fixture.

## Scope and merge checklist

- [ ] The demo contains only synthetic clinical data.
- [ ] No Tessar realm data, service mount, helper, or review note is staged.
- [ ] `packages/screens-realm`, `.pnpm-store/`, and local service/database data
      are not staged.
- [ ] The BXL mutation parser, planner, and source adapter are unchanged.
- [ ] The direct Matrix event names the actual mutated target URL.
- [ ] Apply and Reverse visibly update the embedded target in under 10 seconds.
- [ ] All ten scenarios can return to baseline using their Reverse programs.
- [ ] Database compatibility changes are either justified for the target
      branch schema or removed after branch/database alignment.

## Important future work

### 1. Optimistic mutation through the Card API

The direct `/_mutate` command in this spike is intentionally pessimistic from
the client’s perspective: it waits for the target index event, and Matrix tells
the store to reload the changed Card. That is the correct baseline for a
command that may edit an off-screen or separately embedded target.

For ordinary interactive Card operations, we likely want an optimistic path:

```text
User invokes a Card operation
        │
        ├── client applies BXL to the local JSON:API Card source
        │      and immediately updates the client-side store
        │
        └── client sends the same operation to the realm with
               clientRequestId + base version/hash + programId
                         │
                         ▼
                  realm re-runs against authoritative source
                         │
          ┌──────────────┴──────────────────┐
          ▼                                 ▼
same authoritative result          failure or different result
          │                                 │
suppress initiating-client echo    send rejection/correction event
request is fire-and-forget          replace/rollback optimistic store state
other clients still receive event  show the operation’s useful error
```

The optimistic result is provisional. The realm remains authoritative and must
re-run the transformation against its current persisted source. The request
should carry enough identity to reconcile safely:

- `clientRequestId` to identify the optimistic store change;
- `programId` or named operation identity;
- the target Card ID;
- a base ETag, source hash, or indexed generation; and
- the operation payload/context needed to reproduce the transformation.

On success, if the authoritative source hash matches the optimistic result,
the initiating client can suppress its own Matrix echo and treat the network
request as fire-and-forget. Other clients still receive the update. A compact
acknowledgement can retire the optimistic ledger entry without re-rendering.

On assertion failure, authorization failure, version conflict, or a different
authoritative result, the server must send a correlated rejection or
correction. The store replaces or rolls back the optimistic document, clears
the ledger entry, and surfaces the server’s useful message. “Different” must
include cases where concurrent edits changed selector cardinality or where
server-side transformation/redaction produces a different visible result.

This requires explicit store semantics for pending optimistic documents,
correlated Matrix events, duplicate/out-of-order delivery, rollback, and
multiple queued operations against the same Card. Echo suppression must be
limited to the initiating client and only after equivalence is established; it
must never suppress a corrective event.

### 2. Authorization as a server-side operation gate

The clinical realm currently demonstrates BXL authorization by projecting the
dashboard on the client. That is useful for explaining policy, but it does **not**
authorize `POST /_mutate`. Hiding a button is not an enforcement boundary.

The operation layer should authorize the actor, target, named operation, and
payload before BXL mutation executes. The author-facing shape could declare a
required capability or an authorization transformation alongside the mutation:

```ts
@operation static transferToICU = {
  baseOperation: 'mutate',
  authorize: {
    capability: 'TransferPatientToICU',
  },
  transformations: [/* data-only BXL mutation */],
};
```

The authorization engine may be BXL Authorization or another configured
scheme, but the server contract should be uniform:

```ts
type OperationDecision =
  | { allowed: true; decisionId: string }
  | {
      allowed: false;
      code: string;
      message: string; // safe to show to this actor
      decisionId: string;
    };
```

Important requirements:

- enforce authorization on the realm server even when the client already
  evaluated policy;
- bind the decision to actor, realm, target, operation, and relevant payload;
- evaluate against the authoritative state close enough to commit to avoid a
  time-of-check/time-of-use gap;
- return a safe, actionable denial such as “ICU transfer requires attending or
  charge-nurse capability,” not a generic `403`;
- keep sensitive policy facts out of denial messages;
- audit actor, operation, target, decision ID, program ID, and outcome; and
- apply the same gate to direct, optimistic, automated, and multi-card calls.

BXL mutation assertions remain valuable after authorization. Authorization
answers **may this actor attempt this operation?** Assertions answer **does the
current data still permit this transformation?** Both can fail, and the client
should distinguish their error codes and messages.

### 3. BXL-authorized Card reads through a server-side proxy

The existing clinical demo already illustrates the desired read semantics. For
the selected party it:

- filters the Card’s fields and related data;
- returns an access-denied view when the party cannot read the record;
- lists only the actions that party is allowed to invoke; and
- explains the relevant authorization result.

Today that projection is computed in `patient-dashboard.gts` after the complete
Card has reached the client. The future work is to move the same behavior into
the realm server’s **GET Card response path**. This is a BXL-authorized read
proxy. It is adjacent to mutation and Card operations, but it is not itself a
mutation feature and does not depend on iframe isolation.

```text
GET /PatientDashboard/pt-1001
        │
        ├── authenticated requesting party
        ├── authoritative Card source/index entry
        ├── linked policy, party, team, and facility data
        └── read context such as time or break-glass input
                         │
                         ▼
              BXL authorization evaluation
                         │
          ┌──────────────┼───────────────────┐
          ▼              ▼                   ▼
     deny record    project fields      derive allowed actions
          │              │                   │
          └──────────────┴───────────────────┘
                         │
                         ▼
          actor-specific Card JSON response
                         │
                         ▼
                 client-side Card store
```

#### Proposed read flow

1. The realm authenticates the requesting party.
2. It loads the complete authoritative Card plus the policy relationships
   needed to evaluate the read.
3. BXL Authorization evaluates capabilities for that party and resource.
4. A server-side read transformation rewrites the Card response:
   - omit fields and relationships the party cannot view;
   - omit unauthorized related resources from `included`;
   - attach only the named actions/operations the party may attempt; and
   - when the record itself is unavailable, return a safe access error or a
     deliberately minimal restricted representation.
5. The realm returns only that rewritten document to the client.
6. The Card store materializes the authorized representation it received; it
   does not need to receive a full document and hide pieces afterward.

This can be understood as:

```ts
runOperation(
  actor,
  instance,
  'read',
  requestContext,
) -> authorizedCardDocument | accessError
```

The exact implementation may use BXL Authorization to produce capabilities
and a separate projection transform, or a future BXL read-transformation
profile that directly produces the output document. The important contract is
that authorization and rewriting happen before the Card response leaves the
realm server.

#### Mapping the current clinical demo to the server

| Current client-side behavior                                                                        | Future GET Card behavior                                                                   |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `viewerPartyId` selects a simulated party                                                           | Authenticated Matrix/session identity supplies the party                                   |
| Authorization snapshot evaluates linked policy and membership                                       | Realm server evaluates the same policy graph while handling GET                            |
| `projection` includes identity, vitals, medications, notes, billing, and other sections selectively | Response transformer includes only the permitted Card fields and relationships             |
| `projection.actions` controls which buttons render                                                  | Response includes only the operations/actions the party is permitted to see                |
| Restricted component says the viewer cannot access the record                                       | GET returns a safe denial or restricted Card response with the allowed explanation/actions |
| Changing the viewer recomputes the projection                                                       | A request by another authenticated party receives a different authorized representation    |

#### Concrete projections already shown by the clinical realm

- **Margaret Okonkwo, the patient:** receives her identity and billing view,
  but not staff-only clinical notes or clinical mutation actions.
- **Elena Ruiz, the pharmacist:** receives identity, medications, and the
  medication-order action; diagnosis, vitals, internal notes, billing, and the
  audit trail are filtered out.
- **Owen Grant, the billing specialist:** receives identity and billing only;
  the clinical sections and clinical actions are absent.
- **Morgan Lee, the external consultant:** receives only the record locator and
  a request-access action instead of the patient record.
- **Dr. Theo Martin, the emergency physician:** receives the restricted locator
  until valid break-glass context authorizes the larger clinical projection.

The server-side read proxy should produce these same differences in the GET
response, rather than sending one complete patient document and relying on the
dashboard template to hide sections.

The Card author should declare authorization meaning, not hand-code response
deletion in every template. A future Card definition might associate readable
fields and visible operations with capabilities:

```ts
class PatientDashboard extends CardDef {
  @readableWhen('ViewIdentity')
  @field
  patientName = contains(StringField);

  @readableWhen('ViewVitals')
  @field
  vitals = contains(VitalsField);

  @operation static transferToICU = {
    visibleWhen: 'TransferPatientToICU',
    authorize: { capability: 'TransferPatientToICU' },
    baseOperation: 'mutate',
    transformations: [
      /* data-only BXL mutation */
    ],
  };
}
```

The syntax above is illustrative; this PR does not define those decorators.
The design objective is that the realm can derive one server-side read plan
from Card metadata and BXL policy rather than executing arbitrary Card-authored
JavaScript.

#### Read-cache, Matrix, and store implications

Because two parties may receive different representations of the same Card
URL, an authorized GET cannot use one globally shared response cache entry.
Cache identity and ETags must vary by the authorization inputs that can affect
the projection—for example party, relevant policy version, and contextual
inputs.

Matrix remains an invalidation signal, not the authorized data payload. When a
Card URL is invalidated, each client re-fetches that URL through the same
authorized GET proxy and receives its own current projection. The Matrix event
does not need to contain hidden fields, action lists, or a full Card document.

The client store should replace its prior representation with the complete
authorized response. This matters when permission is revoked: fields and
actions that were previously visible must disappear from the stored Card, not
survive because the next response merely omitted an incremental patch.

Relationship filtering must cover both linkage and `included` resources. If a
party cannot see consulting clinicians, the response must not preserve their
IDs, count, ordering, or included person records while merely hiding the
rendered section.

#### Relationship to mutation and operations

This read proxy is a separate BXL use in the realm server:

- **Read authorization/projection** decides which representation and action
  catalog a party receives from GET Card.
- **Operation authorization** re-checks whether the party may invoke a named
  action when the request arrives; a listed button is helpful UX, not the final
  enforcement decision.
- **BXL mutation** transforms the complete authoritative source after the
  operation is authorized.
- **Post-mutation reads** pass through the read proxy again, so Matrix refresh
  and optimistic reconciliation return the party’s authorized representation.

For optimistic mutation, the client can optimistically change only data present
in its authorized Card representation. If the server’s authoritative result or
current authorization differs, reconciliation replaces the optimistic Card
with the authorized GET result and shows the correlated operation error.

### 4. Named Card operations and multi-card atomicity

The desired authoring API wraps this low-level primitive in named, data-only
Card operations with payload preprocessing and output postprocessing. Operation
definitions should compose authorization, mutation, validation, audit metadata,
projection, and redaction without custom realm-server code.

`/_mutate` currently targets one Card source. Commands that create or update
several Cards as one business action should integrate BXL transformations with
`/_atomic`, validate and authorize every target first, acquire a deterministic
set of locks, and either commit every source plus its event metadata or commit
nothing.

A concrete clinical example is **Create compounded prescription**. The new
prescription is not a polymorphic value embedded inside the patient. It is a
separate Card instance whose root source records its concrete subtype:

```json
{
  "data": {
    "type": "card",
    "attributes": {
      "medicationName": "Diltiazem oral suspension",
      "concentration": "12 mg/mL",
      "doseInstructions": "Give 5 mL by mouth every 6 hours"
    },
    "meta": {
      "adoptsFrom": {
        "module": "../prescription",
        "name": "CompoundingPrescription"
      }
    }
  }
}
```

One outer atomic operation would create that document, run a single-target BXL
program against the patient to append `card(newPrescriptionId)` to the ordered
prescriptions relationship, and append the audit event. Commas separate
arguments in readable BXL calls; top-level mutation statements are separated
by semicolons. The BXL mutation profile remains bounded to one document while
the operation layer owns cross-document identity, locking, and commit.

## Known boundaries

- The endpoint mutates one Card source per request. Multi-card atomic commands
  belong in the future `/_atomic` integration above.
- Authorization, server-side projection, and server-side redaction are not
  enforcement features of this spike; this is the lower-level mutation
  execution primitive.
- The current client store is not yet an optimistic mutation ledger and should
  not suppress `/_mutate` Matrix echoes.
- Recursive dependent indexing is eventually consistent by design.
- The clinical realm is a review harness, not production medical software and
  not a source of real clinical guidance.
