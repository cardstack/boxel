# Card operations

An operation is a named, reusable action on a card — "escalate this event",
"titrate this dose", "create a consult for this patient" — declared by the card
author as **plain data** rather than as JavaScript, and carried out by the realm.

A card type declares its operations with the `@operation` decorator and a card
invokes them with `operations()`, both from `@cardstack/base/operations`. A
worked realm that uses one of every shape below lives in
`packages/experiments-realm/clinical/`; `patient-record.gts` there is the file
to copy from.

## Operations are not access control

**This is the most important thing on this page.** Operations are
*identity-aware* and *not access-enforced*. The realm checks its own read/write
permissions and nothing else:

- Anyone who can write a realm can invoke any mutating operation on any card in
  it. Anyone who can read it can invoke any read.
- `actor()` tells a declaration who is calling, so an operation can **record**
  who acted. It never decides whether they may.
- `assert(…)` is a precondition on the **state of the data**, not on identity.
  A failed assertion means the data was not in the shape the operation needs.
- An `output` projection decides the shape of one operation's answer and
  nothing more. A field it leaves out is still reachable through the card's
  plain read, its stored source, or a search. Leave a value out because the
  consumer does not need it, never because the caller may not have it.

Enforcement at the operation level is a separate project. Until it ships, treat
every operation's result as reachable by any caller permitted to use the realm,
and do not build a security boundary out of any of the above.

## No card code runs on an operation's path

A declaration is captured when a module's definition-cache entry is built,
lowered there to base-operation data plus BXL, and executed by the realm from
that lowered form. The realm never instantiates the card, never loads the
module, and never runs author JavaScript — the only author-supplied logic it
evaluates is BXL, which has no host access.

Two consequences an author feels:

- A computed field is not writable by an operation, and is not readable from
  the card's stored source. What a program reads is the stored document.
- A declaration is checked when its module is indexed, not when it is invoked.
  A mistake in one is a lowering issue against your own edit (see
  [Authoring errors](#authoring-errors)), and the operation is still there but
  refuses with `invalid-operation`.

## Declaring an operation

```ts
import {
  operation,
  params,
  actor,
  type OperationDeclaration,
} from '@cardstack/base/operations';
import StringField from '@cardstack/base/string';

class ExternalReport extends CardDef {
  @operation static addComment = {
    base: 'transform',
    params: { body: StringField },
    append: {
      to: 'comments',
      value: { body: params('body'), postedBy: actor() },
    },
  } satisfies OperationDeclaration;
}
```

`satisfies OperationDeclaration` is worth keeping. It type-checks the
declaration in place and preserves the literal types — `base: 'transform'`
rather than `base: string` — which is what makes the payload and the result
typed at the call site. Written without it, the declaration still works but the
invocation surface cannot read it.

A subclass overrides an inherited operation by redeclaring its name. TypeScript
requires the override to stay assignable to what it shadows, so an operation
you *intend* a subclass to reshape is annotated `: OperationDeclaration` where
it is first declared; the override then keeps its own literal types. That
annotation costs the annotated name its payload type, so write it only where a
subclass really will reshape the operation.

### `base` — the behavior a declaration builds on

The base operations are `read`, `readSource`, `create`, `update`, `delete`,
`query`, `transform`, `appendContainsMany` and `appendLine`. Which of them a
def carries follows from what kind of def it is:

| Def | Carries |
| --- | --- |
| `CardDef` | `read`, `readSource`, `create`, `update`, `delete`, `query`, `transform`, `appendContainsMany` |
| `FileDef` | `read`, `readSource`, `update`, `appendLine` |
| any other `BaseDef` | `read`, `readSource` |
| `FieldDef` | nothing — a field has no URL, so its data is reached through the operations of the card that contains it |

Naming a base the def does not carry is the authoring error `base-not-carried`:
`appendLine` belongs to files and `appendContainsMany` to cards, and neither is
available on the other.

Two name rules the decorator enforces at class-definition time. `readSource` is
reserved: the realm answers a stored-bytes read without reading a definition,
so a declaration under that name would never be reached. And `atomic`, `on`,
`find`, `parallel` and `serial` belong to the invocation surface, so a
declaration under one of those names could never be called either. `create` is
deliberately *not* reserved — specializing it is normal.

The name a caller invokes and the base that carries it out are read separately.
A `delete` declared on `transform` is a soft delete: asking such a card to
delete itself archives it.

### `params` — the payload schema

Every declaration that takes a payload declares one. It is the single source
for three things: the TypeScript type of the payload at the call site, the
checking of `params('…')` references when the declaration is lowered, and the
realm's own validation of the payload before any program runs.

```ts
params: {
  body: StringField,            // a field class, for a scalar
  activity: linkTo(Activity),   // a card identity: a saved card's URL, or a
                                // local id from the same batch
}
```

Referencing a key the schema does not declare is `undeclared-param`.

### Typed references

A value only known at invocation time is written as a reference. The same words
name the BXL builtins the lowered program evaluates, so what you write in a
clause is what runs — there is no interpolation syntax and no sigil.

The references are `params('key')`, `actor()`, `instance('key')`,
`realmConfig('key')`, `card(…)` and the `` bxl`…` `` tag.

- `params('key')` — a member of the request payload.
- `actor()` — **the caller's Matrix user id, as a string, and nothing else.**
  It takes no argument. It is stored in text fields and compared in query
  filters; it is never a card, because no card represents a user. Putting it
  where a card identity belongs is `actor-not-a-card` — declare the person as a
  `params` member typed `linkTo(…)` and link that instead.
- `instance('key')` — the invocation target's **stored source document**, never
  a live card instance. `instance('id')` is the target's identity, which is how
  a created card links back to what created it. Unavailable to an operation
  invoked with no target in scope.
- `realmConfig('key')` — a named value from the `config` map of the realm the
  operation runs in, so one card type can read a per-realm setting without
  hard-coding it. `realmConfig()` answers the whole map. A realm that
  configures nothing refuses the invocation rather than resolving the marker to
  nothing.
- `card(…)` — a link identity: a card URL, or a reference that resolves to one
  (`card(params('activity'))`, `card(instance('id'))`).

### The declarative clauses

Each base accepts its own clauses:

| `base` | Clauses |
| --- | --- |
| `transform` | `append`, `assert`, `set` |
| `create` | `of` (required), `fill` |
| `query` | `query` (required) |
| `appendContainsMany` | `field` + `item`, or `fields` |
| `update`, `delete`, `read`, `appendLine` | none |

Every declaration may also carry `params`, `optimistic`, `input`,
`transformations` and `output`.

`append` adds to a collection. Whether the value is a contained value or a link
comes from the field's own type, so the clause names the field and the value
and nothing else:

```ts
append: { to: 'comments', value: { body: params('body'), postedBy: actor() } }
append: { to: 'consultTeam', value: card(params('clinician')) }
```

`set` writes field values, links included:

```ts
set: { status: 'escalated', attending: card(params('receiving')) }
```

`assert` is a **uniqueness** precondition: `unique` names the collection and
`by` says what decides whether an item is already in it.

```ts
// On a collection of links, `by` is compared against each linked card's id —
// and a link collection always needs `snapshot: true`, see below
assert: { unique: 'consultTeam', by: params('clinician'), snapshot: true, message: '…' }
// On a collection of contained values, the item is compared whole — so key the
// check on the value the collection actually holds, not on part of it
assert: { unique: 'activeCaseload', by: params('mrn'), message: '…' }
```

A precondition on anything else — "this event is still open", "this patient is
still admitted" — is a program; see the escape hatch below.

`assert` reads the target's stored document, which holds neither computed
values nor a linked card's fields. A `unique` path that names either is only
checkable against an index snapshot, and asking for one is explicit:
`snapshot: true` says you accept that the check guards the interface rather
than the commit. Without it, such a path is `unsnapshotted-assert` and the
operation refuses every invocation with `invalid-operation`.

**A `unique` over a `linksTo`/`linksToMany` collection always needs it.** A
link is stored as a reference, so the ids the check compares are not in the
stored document at all — there is no non-snapshot form of that check. Only a
collection of contained values can be checked against the commit.

`fill` is `create`'s version of `set`: the new card's field values.

```ts
@operation static createActivity = {
  base: 'create',
  of: ClassroomActivity,
  params: { title: StringField },
  fill: { title: params('title'), classroom: instance('id') },
} satisfies OperationDeclaration;
```

A class declared later in the same module is named with a thunk — `of: () =>
ClassroomActivity` — because the class binding is not initialized yet while its
own statics are being built.

`appendContainsMany` adds items to a card's `containsMany` by editing the
card's stored JSON as text, without loading the document — the operation for a
collection large enough that loading it is the cost:

```ts
@operation static recordVitals = {
  base: 'appendContainsMany',
  field: 'vitals',
  params: { heartRate: NumberField },
  item: { heartRate: params('heartRate'), recordedBy: actor() },
} satisfies OperationDeclaration;
```

`appendLine` takes no clause at all: the line **is** the payload, read under
`line`, so a declaration on a `FileDef` says which param carries it and nothing
more.

### The raw escape hatch

For work the clauses do not express, write the program. The `` bxl`…` `` tag
takes no substitutions: `params()`, `actor()`, `instance()` and `realmConfig()`
are builtins the program calls, so values are read rather than spliced in.

```ts
@operation static escalate = {
  base: 'transform',
  params: { findings: StringField },
  transformations: bxl`
    assert(.status == "open"; "Report is not open");
    .status = "escalated";
    .findings = params("findings");
  `,
} satisfies OperationDeclaration;
```

The mutation dialect in brief. Statements end in `;` and function arguments are
separated by `;` too:

```bxl
# scalar and nested writes
.severity = "Critical";
.vitals.heartRate = 132;

# exactly one match, then a write through it — note the parentheses around the
# whole path being assigned to
(.medications[] | select(.name == params("drug")) | .doseMg) = 5;

# arithmetic against the value the realm holds, so concurrent edits compose
(.medications[] | select(.name == params("drug")) | .doseMg) |= . + params("delta");

# preconditions and collection predicates
assert(.status == "admitted"; "Patient is not admitted");
assert(any(.events[]; .id == params("id") and .status == "open"); "Not open");

# add, remove, construct
append(.comments; { body: params("body"), postedBy: actor() });
prepend(.instructions; { activity: "Monitoring" });
del(.caseload[] | select(. == params("mrn")));

# links
.attending = card(params("receiving"));
append(.consultTeam; card(params("clinician")));

# ordered structural edits, anchored on stable values rather than positions
insert_item_after({ id: "details" }; .sections[] | select(.id == "overview"));
move_item_before(.team[] | select(.id == "a"); .team[] | select(.id == "b"));
reorder_by(.instructions; .activity; ["Meals", "Mobility"]);

# deep copy
copy_value_to(.careSummary; .dischargeDraft);
```

`select(…)` is for exactly one semantic match — an ambiguous or empty match is
an error rather than an accidental write. `[* predicate]` is the explicit
one-or-more form, so bulk behavior only happens where it is asked for.

### `input` and `output`

`input` runs first, over the payload the caller sent, and produces the payload
the operation uses — so a value it supplies satisfies a declared param the
caller left out. `output` projects or reshapes the result.

Both are expressions rather than mutation programs, and both may read the
request context. An `output` that reads `actor()` makes the response
per-caller, which on a `read` means the card's plain `GET` is served uncached
and is never answered with a `304`.

`output` is **not** an access boundary. See the posture section.

### `optimistic`

The client applies an eligible write to its local copy before the realm
answers. Eligibility is detected automatically; `optimistic: false` opts an
operation out, and `optimistic: true` opts one in.

## Invoking operations

```ts
import { operations } from '@cardstack/base/operations';

let result = await operations(report).addComment({ body: 'Approved.' });
```

`operations()` takes either an instance or a class:

- **An instance** for the operations that run against one card: `read`,
  `update`, `delete`, anything built on `transform`, `appendContainsMany`, and
  a named `create` anchored on that card for context.
- **A class** for the operations that have no instance to run against: a plain
  or named `create`, and a `query`.

A class-scoped call takes an options argument, `{ realm, relationships }` for a
create and `{ realms, owner }` for a search, because there is no instance to
read a realm from. An instance-scoped call takes none: it runs in the realm
that holds its target.

### Reading the class off an instance

`operations(card)` cannot infer the card's class from the instance, so it
answers a bucket that accepts any name and any payload. That is usually what
you want inside application code. To get the declaration-derived types, name
the class:

```ts
// untyped: every name is callable, no payload is checked
operations(record).escalateRhythmEvent({ eventId, findings });
// typed from the declarations: unknown names and wrong payloads are errors
operations<typeof PatientRecord>(record).escalateRhythmEvent({ eventId, findings });
```

In a card template `@model` is typed with every field optional — a template
renders a card that may still be loading — so a template that wants the typed
form casts once, where it is saying that it is rendering a loaded card.

### What a call answers with

| The operation is built on | It resolves to |
| --- | --- |
| `create`, `update`, `transform`, `appendContainsMany`, `appendLine` | `{ id, version, generation, lastModified }`, plus `lid` for a create in a batch |
| `delete` | `null` |
| `read` | the projected document |
| `query` | **not a promise** — see below |

A write answers with an identity and a version, not a document. `version` is
the fingerprint of the card's stored source; to see the written document, read
it after the call, or let the store refresh from the realm's invalidation.

## Saved searches

A `query` operation is a saved search declared next to the card's other
operations. Declaring is uniform with them; invoking is not — a query runs on
the search engine, never on the operation endpoint.

```ts
@operation static myPatients = {
  base: 'query',
  query: {
    filter: { on: () => PatientRecord, eq: { 'attending.userId': actor() } },
    sort: [{ on: () => PatientRecord, by: 'patientName', direction: 'asc' }],
  },
} satisfies OperationDeclaration;
```

Filters name types with the classes themselves. A filter that reads a **linked**
card's field needs the link that reaches it declared searchable — `@field
attending = linksTo(Clinician, { searchable: true })` — otherwise the read is
`unsearchable-read`.

Calling it answers the live entries resource a search runs as — `{ entries,
isLoading, meta }` — and `.query()` answers the wire query behind it, which is
what a card hands to `@context.searchResultsComponent` to render the rows
itself. Neither is awaited, and **each call builds a new one**, so resolve it
once and hold what it answers:

```ts
// right: resolved once, so the search component sees one query
class Isolated extends Component<typeof ClinicalDashboard> {
  myPatients = operations(PatientRecord).myPatients.query();
}
// wrong: a getter answers a new query every render, restarting the search
get myPatients() {
  return operations(PatientRecord).myPatients.query();
}
```

`.query()` answers nothing when the session cannot say who the caller is —
nobody is signed in, or this is a render, which authenticates as itself rather
than as a viewer. A search compared against `actor()` has nothing to ask in that
case, so render an empty state for it.

A search reads the index, which lags a write the realm has just committed. To
read a card you just wrote, read the card.

## Batches

`operations(card).atomic(build)` sends one all-or-nothing batch in that card's
realm. Every entry is evaluated against the state the batch started from —
there is no reading of your own writes — and either all of them commit or none
of them do.

```ts
let [consult] = await operations(patient).atomic((b) => {
  let created = b.create(ConsultRequest, { specialty: 'Cardiology' });
  b.addConsult({ consult: created });
  b.on(patient.auditLog).appendLine({ line: 'consult requested' });
  return [created];
});
```

The builder:

- `b.<name>(payload)` registers an entry against the card the batch was built
  on; `b.on(other).<name>(payload)` against another card **in the same realm**,
  and `b.on(file)` against a file in it.
- `b.create(Type, attributes, opts)` mints a card and answers a handle. **The
  handle is the local id a later entry links the new card by** — pass it
  wherever a link is expected and the entry carries it, so a link to a card
  that has no URL yet is a value rather than a token to keep consistent by
  hand. `b.create(instance)` mints a card the caller is already holding.
- `b.parallel(build)` stages its members at the same time; `b.serial(build)`
  one after another. The top level is serial and the two nest to any depth.
  Two members of one parallel group that write the same file are the batch
  error `conflicting-targets` — serial order is how a batch says that two
  entries touch the same target, and there the second stages from the first's
  result.
- `b.find(filter, { field, expect })` answers a target found by search rather
  than named by reference, usable wherever `b.on(…)` takes a card. `expect:
  'many'` fans the entry out over every match and answers an array.

A builder that returns nothing is answered positionally, with a group's results
nested where the group sat. A builder that returns handles is answered with
those handles' results, in the order it listed them — which is also what types
them.

A batch commits in one realm, under one write lock, as one index job and one
event. An entry naming a card in another realm is refused before anything is
sent.

## Authoring errors

Lowering runs when the module is indexed and records findings against the
declaration. An operation with findings still exists and refuses with
`invalid-operation`, so a broken declaration is visible rather than silent.

The codes are `unknown-field`, `not-a-collection`, `undeclared-param`,
`computed-write`, `read-only-write`, `link-collection-replace`,
`path-crosses-collection`, `link-requires-identity`, `write-through-link`,
`unsearchable-read`, `unsnapshotted-assert`, `unresolved-type`,
`actor-not-a-card`, `invalid-program`, `invalid-query`, `reserved-name`,
`base-not-carried`, `unrunnable-program` and `incomplete-append`.

## Failure at invocation

A refused operation arrives as an `OperationsError` carrying `status`, `code`,
`title` and `detail`. **`detail` is the sentence your declaration wrote,
verbatim** — a failed `assert` puts its own message there and nothing else.
`message` is `title: detail`, so a refused assertion reads "Assertion failed:
…"; show `detail` to a person and keep `message` for a log.

```ts
try {
  await operations(record).escalateRhythmEvent({ eventId, findings });
} catch (err) {
  this.refusal = err instanceof OperationsError ? err.detail : String(err);
}
```

The codes are `unknown-operation`, `operation-not-allowed`,
`invalid-operation`, `invalid-params`, `target-not-found`,
`target-not-indexed`, `target-errored`, `assertion-failed`, `version-conflict`,
`precondition-unverifiable`, `actor-required`, `payload-too-large`,
`wrong-entry-point`, `conflicting-targets` and `internal-error`.

Two worth recognizing:

- `assertion-failed` — a precondition did not hold. Nothing was written.
- `actor-required` — the operation reads the actor and the request
  authenticated nobody. Nothing the caller sent is wrong; the remedy is
  credentials.

## Where to look next

- `packages/experiments-realm/clinical/` — a realm using one of every shape
  above, with the batches built in `patient-record.gts`.
- `packages/base/operations.ts` — the authoring and invocation surface, with
  the reasoning for each decision beside it.
