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
_identity-aware_ and _not access-enforced_. The realm checks its own read/write
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
you _intend_ a subclass to reshape is annotated `: OperationDeclaration` where
it is first declared; the override then keeps its own literal types. That
annotation costs the annotated name its payload type, so write it only where a
subclass really will reshape the operation.

### `base` — the behavior a declaration builds on

The base operations are `read`, `readSource`, `create`, `update`, `delete`,
`query`, `transform`, `appendContainsMany`, `appendLine` and `explain`. Which
of them a def carries follows from what kind of def it is. `explain` is the
exception: no def carries it until a card declares an operation on it, and it
belongs on a policy card (see
[Asking a policy what it decides](#asking-a-policy-what-it-decides)).

| Def                                | Carries                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CardDef`                          | `read`, `readSource`, `create`, `update`, `delete`, `query`, `transform`, `appendContainsMany`                                                                              |
| `FileDef`                          | `read`, `readSource`, `update`, `appendLine`                                                                                                                                |
| anything else, `FieldDef` included | nothing — a def that is neither a card nor a file classifies as a field, and a field has no URL, so its data is reached through the operations of the card that contains it |

Naming a base the def does not carry is the authoring error `base-not-carried`:
`appendLine` belongs to files and `appendContainsMany` to cards, and neither is
available on the other.

Two name rules the decorator enforces at class-definition time. `readSource` is
reserved: the realm answers a stored-bytes read without reading a definition,
so a declaration under that name would never be reached. And `atomic`, `on`,
`find`, `parallel` and `serial` belong to the invocation surface, so a
declaration under one of those names could never be called either. `create` is
deliberately _not_ reserved — specializing it is normal.

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
  a created card links back to what created it. It is available only where the
  operation assembles that document: a `create` reads the card it was invoked
  from, and a `transform` reads the card it changes. An `appendContainsMany`
  reads neither — it edits the card's stored bytes without ever assembling it,
  which is what makes it affordable on a card too large to load — so an
  `instance(…)` inside an appended item is the authoring error
  `instance-out-of-scope`. An item that needs the card's own values belongs on
  a `transform`.
- `realmConfig('key')` — a named value from the `config` map of the realm the
  operation runs in, so one card type can read a per-realm setting without
  hard-coding it. `realmConfig()` answers the whole map. A realm that
  configures nothing refuses the invocation rather than resolving the marker to
  nothing.
- `card(…)` — a link identity: a card URL, or a reference that resolves to one
  (`card(params('activity'))`, `card(instance('id'))`).

### The declarative clauses

Each base accepts its own clauses:

| `base`                                   | Clauses                       |
| ---------------------------------------- | ----------------------------- |
| `transform`                              | `append`, `assert`, `set`     |
| `create`                                 | `of` (required), `fill`       |
| `query`                                  | `query` (required)            |
| `appendContainsMany`                     | `field` + `item`, or `fields` |
| `update`, `delete`, `read`, `appendLine` | none                          |

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
`line`, so the simplest declaration on a `FileDef` says which param carries it
and nothing more.

There is a second spelling, and it is the one to reach for when the line should
not be the caller's to write. An `input` program _produces_ the payload, so a
declaration can compose the line from values the caller has no way to supply —
the authenticated actor, a realm setting, the realm's own clock. Base's
`LogFile`, the class every stored `.log` is, declares exactly that:

```ts
export class LogFile extends TextFileDef {
  @operation static record = {
    base: 'appendLine',
    params: { what: StringField },
    input: bxl`. + { line: (TEXT(NOW(); "yyyy-mm-dd hh:mm:ss") + " " + actor() + " " + params("what")) }`,
  } satisfies OperationDeclaration;
}
```

The caller chooses what to say and never who said it. Two things to know about
the form: `. +` merges into the payload rather than replacing it, and replacing
it would drop the declared `what` — the params check runs against what `input`
produced, not what the caller sent, so a program answering `{ line: … }` alone
is refused for a missing param. And `NOW()` answers an Excel serial rather than
a timestamp, so it is formatted; unformatted it appends a number like
`46023.518`.

A stored file's class comes from its extension, through the platform's own
table: `.log` is `LogFile`, `.jsonl` is `JSONLFile` (whose `record` appends
each entry as one JSON object), `.txt` is `TextFileDef`, and so on. A realm does
not configure it. So a named operation is reachable on a file only when it is
declared on the class the platform maps that file's extension to — one declared
on an author's own `FileDef` subclass lowers and indexes, but no stored file
resolves to it.

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

### `links` — how much of the link graph a read or a query carries

A read serves a JSON:API document, and by default it assembles the transitive
closure of the card's links into `included[]`: the cards it links to, the cards
those link to, and so on to the end of the graph. A search does the same for
every row it answers with. A `read` or a `query` declaration may say how much of
that to carry.

```ts
@operation static read = {
  base: 'read',
  links: 'ids',
} satisfies OperationDeclaration;
```

| `links` | What the response carries                                          |
| ------- | ------------------------------------------------------------------ |
| `full`  | The whole assembled closure in `included[]`. The default.          |
| `ids`   | The relationships name their targets; nothing is assembled.        |
| `none`  | No relationship data at all — nothing assembled and nothing named. |

Under `ids` a consumer fetches each target on its own request, which is one
round trip per link it actually displays rather than one response carrying
every link it might. Under `none` the card answers for itself alone.

**It governs reads of this card, not the card's appearances in other reads.**
The strategy decides what a read rooted at this card serves. When the card turns
up inside another card's closure, that read's own strategy decides, and a
`full` one carries this card whole — its relationships and the cards behind
them — whatever this card's `read` declares. So a narrowing belongs on the type
that is read: to keep the cards a `Classroom` links to out of a `Classroom`
read, declare it on `Classroom`, not on the types it links to.

A declaration on `read` itself governs the card's plain `GET`, which is what
the host loads a card with to render it live — in every mode, for every user.
Under `ids` the host resolves the named links itself as it displays them. Under
`none` it is never told what the card links to, so wherever the host renders the
card live from its `GET` its link fields come up empty, including for the realm's
own writers. A card the host first holds from a search row that carried its
links — an ad-hoc search's, or a `full` query's — keeps them: what a search
carries is governed by the search, not by the card's `read`.
Prerendered HTML is different: it is rendered from the card's stored source
under the realm's own authority, so the card's prerendered formats still draw
its links, and so does every view the host fills from them, such as search
results and embedded or fitted rows.

Editing such a card in the host is where `none` costs data. Saving a card whose
link fields were left alone keeps its stored links, because a save leaves out
the link fields the loaded document never set. Editing a link field does not:
the editor starts from empty, and the save replaces what is stored with what the
editor showed — a `linksToMany` edit replaces the whole list, so adding one card
drops every one the editor never displayed, and a `linksTo` edit overwrites a
target the writer never saw. Reach for `none` only where a card's representation
genuinely should not say what it points at and its links are not edited in the
host; where they are viewed or edited there, `ids` narrows the closure without
hiding them.

**It applies to every caller alike.** The declaration belongs to the operation,
not to the caller, so the same request answers a realm writer and a caller
reached by some other route with the same document. Narrowing a read therefore
costs the round trips to everyone, which is the trade to weigh — and the reason
the strategy is not a way to show one caller less than another.

**It governs assembly, not derivation.** A computed value that derives from a
linked card still carries its value under all three strategies. The value is
computed when the card is indexed and lives in the card's own attributes, so
withholding the link withholds the linked card's document and nothing about
what the card itself computed from it. This is the part that most often
surprises: `links: 'none'` on a card whose `summary` is computed from its
linked records still answers with that summary.

#### On a `query`

A `query` declaration narrows its results the same way, with the same three
values:

```ts
@operation static allRosters = {
  base: 'query',
  query: { filter: { type: () => Roster } },
  links: 'ids',
} satisfies OperationDeclaration;
```

**It governs every row alike, under the query's declaration.** Each row the
query answers with carries what the query declares, whatever type the row is and
whatever that type's own `read` declares — the query's results are its
representation, as a read's document is the read's. The two are separate
statements, so a type whose `read` narrows its closure is still carried whole by
a `full` query that returns it. A query that must not reach what its rows link
to declares that itself.

**It narrows the row's card, never the entry the row arrives in.** A search
delivers each row as an entry that names its card and carries the renderings
asked for, and those are untouched: under every strategy the entry still names
its card, and its prerendered HTML still draws the card's links, as a card's
prerendered formats do under a narrowed read. What narrows is the card itself —
its relationships and the closure behind them. A sparse row asking for a link
field is narrowed with the rest: under `none` it is not told what that field
links to.

A search a render runs is the exception. It keeps each row's stored links
whatever the query declares, and never assembles a closure under any strategy:
the render resolves the cards those links name itself, and it keeps those cards
for the rest of the indexing pass, so a row served without them would draw its
link fields empty in every later render that shows it — HTML that is then served
to every viewer. Since prerendered HTML draws a card's links under every
strategy, keeping them in the render withholds nothing a caller would otherwise
receive.

The request's own narrowing composes with it the way it does with a read: a
search the realm-server is shedding load on, or one whose caller asked for links
only, is served `ids` from a `full` query, and nothing a request asks for widens
what a query declares. The declaration is applied on a realm's own `_search` and
on `_federated-search` alike, since the server re-lowers a named query from its
own definition wherever it is served.

**A query's `none` never becomes the card's live representation.** The host
keeps the cards a search answers with as the live instances it renders and
edits, and adopts a `full` or `ids` row as one; under `ids` it resolves each
named link itself, as it does for an `ids` read. A row served under `none` is
silent about what its card links to rather than saying it links to nothing, so
the realm marks the row's card `meta.relationshipsWithheld` and the host never
adopts it. The row renders from its prerendered HTML, and wherever the card is
opened, edited or rendered live, the host loads it through its own read, so a
query's `none` never leaves a live card with empty link fields the query chose
not to send. The cost is one request for each such card the host goes on to use
live, where an adopted row would have needed none.

The rule runs one way. A row that carries more than the card's own `read` — an
ad-hoc search's or a `full` query's row of a type whose `read` narrows — is
adopted as it came, since what a search carries is governed by the search, and
the host then holds the card with the links that row carried.

#### Where it is refused

`links` is a `read` and `query` key: it narrows the closure a read of the card
or a query's results assemble, and no other base assembles one. A write answers
without assembling the card's closure, and a `readSource` serves stored bytes. A
`links` on any other base is refused where it is written, and a stored
definition carrying one records a `links-without-assembly` issue; a value that
is not one of the three records `invalid-link-strategy`.

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
operations<typeof PatientRecord>(record).escalateRhythmEvent({
  eventId,
  findings,
});
```

In a card template `@model` is typed with every field optional — a template
renders a card that may still be loading — so a template that wants the typed
form casts once, where it is saying that it is rendering a loaded card.

### What a call answers with

| The operation is built on                                           | It resolves to                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `create`, `update`, `transform`, `appendContainsMany`, `appendLine` | `{ id, version, generation, lastModified }`, plus `lid` for a create in a batch |
| `delete`                                                            | `null`                                                                          |
| `read`                                                              | the projected document                                                          |
| `query`                                                             | **not a promise** — see below                                                   |

A write answers with an identity and a version, not a document. `version` is
the fingerprint of the card's stored source; to see the written document, read
it after the call, or let the store refresh from the realm's invalidation.

## Asking before invoking

A template can ask whether the current session may invoke an operation, so it
can hide a control the caller cannot use instead of rendering every control and
letting the refusal arrive after the click:

```gts
class Isolated extends Component<typeof Classroom> {
  get canAddActivity() {
    return this.args.context?.canInvoke?.('appendActivity', this.args.model);
  }
  <template>
    {{#if this.canAddActivity}}
      <button {{on 'click' this.addActivity}}>Add activity</button>
    {{/if}}
  </template>
}
```

`canInvoke(operation, target)` answers synchronously: `true` or `false` once the
realm has answered, `undefined` while it is being asked. The template re-renders
when the answer lands. Every call made during one render pass goes to the realm
as one request, so thirty cards each asking about three operations cost one
round trip, not ninety. `@context.canInvoke` is absent where there is no session
to ask for (a prerender, a freestyle), so guard on it.

The target is a saved card, or a card class for a "New" button:
`canInvoke('create', Classroom, { realm })` asks whether this session may create
a `Classroom`, in `realm` or, when you leave it out, in the realm a class-scoped
create lands in when it names none.

An answer is refreshed when the realm reindexes the card it is about, and every
answer in a realm is refreshed when the realm's own config changes. The realm's
policy card often lives in a realm this session cannot read, and a permission
change is not broadcast, so an answer more than a few seconds old is also asked
again the next time the template reads it. The template keeps showing the old
answer until the new one arrives.

**Nothing may treat a capability answer as authorization.** The realm decides
again when the operation is invoked, against the state as it is then, so a
`true` means the operation was allowed a moment ago, not that the call will
succeed. Hide a control on `false`; never skip or trust the call because of a
`true`.

Under it is `POST {realm}/_capabilities`, which takes up to 100
`{ target, operation }` pairs and answers each one. A target is a card's URL, or
a type's `{ module, name }` for a create. Each answer comes from the realm's own
permission decision and goes no further, so asking changes nothing in the realm:

- A grant whose predicate reads a stored card is judged against the card as it
  is stored now. When the operation is invoked, the realm judges the same card
  again under the write lock.
- `allowed: true, conditional: true` answers a create against a type whose grant
  has a predicate. That predicate reads the card the create would write, which
  does not exist yet, so the check can't evaluate it. Render the control; the
  call can still be refused.
- A caller who cannot read the realm gets only `allowed`, with no reason and no
  `conditional`. A card they may not use and a card that does not exist get the
  same answer. A create that would be `conditional` for anyone else is `true`
  for them, since it names no card.
- A write the realm refuses before any policy can judge it gets `false`: a
  caller who is not signed in, or a session that may only read.
- A caller who can read the realm also gets a `reason` on a refusal: the error
  code the invocation itself would return.

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

A query may also declare how much of each row's link graph its results carry,
with the same `links` a read declares — see
[`links`](#links--how-much-of-the-link-graph-a-read-or-a-query-carries).

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

In a realm a caller reaches only through its policy, a saved search is granted
by its own name, and a search the caller writes by hand is granted as `query`
on the type its filter names with `on`. So granting `myPatients` grants that
search and not the freedom to write any filter over `PatientRecord`, and a
filter that names no type is granted by nothing. For the same reason no saved
search may be named `query`: the name belongs to the search written by hand.

## Batches

`operations(card).atomic(build)` sends one all-or-nothing batch in that card's
realm: either every entry commits or none of them do.

What an entry is staged against depends on where it sits. The top level is
**serial**, and a serial entry composes — it stages from what the entries
before it staged, so a later entry sees an earlier one's write. Members of a
`parallel` group are staged at the same time and each is evaluated against the
state at the start of that group, which is why two of them writing the same
file is the batch error `conflicting-targets` rather than a merge. A `read`
entry is the one thing that always answers from pre-batch state: a batch never
reads back its own writes.

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
'many'` fans the entry out over every match and answers an array. For a
  caller who reaches the realm only through its policy, the filter is a search
  they wrote by hand, so it finds only the cards a `query` grant on its type
  admits, and each card it finds still needs a grant for the entry's own
  operation.

A builder that returns nothing is answered positionally, with a group's results
nested where the group sat. A builder that returns handles is answered with
those handles' results, in the order it listed them — which is also what types
them.

A batch commits in one realm, under one write lock, as one index job and one
event. An entry naming a card in another realm is refused before anything is
sent.

A realm's policy judges a batch entry by entry. For a caller the realm's own
permissions decline, each entry is gated against its own target and the
operation that target's type declares, and one entry's grant admits nothing
for another, even on the same card: a grant to rename a classroom does not
let the delete beside it through. An entry that runs against the cards a
`b.find(…)` answers is gated once per card, so an `expect: 'many'` entry that
finds three cards is three decisions. One refusal refuses the batch, wherever
it comes from. The gate refuses an entry no grant admits before anything is
staged. The write lock refuses a write whose predicate does not hold against
the card it changes (for a create anchored on a card, that card), and a create
against a type whose predicate does not hold for the card it would mint, after
the entries ahead of it have staged. Either way nothing is written, no index
job is enqueued and no event is sent. The refusal names its entry in
`meta.entry`, a path such as `[0].boxel:target[1]` for the second card an entry
found. A caller who may not read the realm is told that entry and nothing
else, in the same 404 a missing card gets, and never which card it was. Such a
caller's `b.find(…)` finds only the cards a `query` grant on its type admits,
and a query no grant admits answers as one that matched no card.

## Authoring errors

Lowering runs when the module is indexed and records findings against the
declaration. An operation with findings still exists and refuses with
`invalid-operation`, so a broken declaration is visible rather than silent.

The codes are `unknown-field`, `not-a-collection`, `undeclared-param`,
`computed-write`, `read-only-write`, `link-collection-replace`,
`path-crosses-collection`, `link-requires-identity`, `write-through-link`,
`unsearchable-read`, `unsnapshotted-assert`, `unresolved-type`,
`actor-not-a-card`, `invalid-program`, `invalid-query`, `reserved-name`,
`base-not-carried`, `unrunnable-program`, `incomplete-append` and
`instance-out-of-scope`.

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
`precondition-unverifiable`, `actor-required`, `operation-not-permitted`,
`policy-predicate-failed`, `payload-too-large`, `wrong-entry-point`,
`conflicting-targets` and `internal-error`.

Four worth recognizing:

- `assertion-failed` — a precondition did not hold. Nothing was written.
- `actor-required` — the operation reads the actor and the request
  authenticated nobody. Nothing the caller sent is wrong; the remedy is
  credentials.
- `operation-not-permitted` — the realm's permissions declined the caller and
  no grant in the realm's policy admits the operation. Only a caller who may
  read the realm is told this, as a 403. A caller who may not is told
  `target-not-found`, in a 404 identical to the one for a card that does not
  exist, so the refusal does not tell them which cards are there. One thing
  still can, and it is not concealed: a refusal that evaluated a policy
  predicate takes measurably longer than one that found no card.
- `policy-predicate-failed` — the realm's permissions declined the caller, no
  grant admitted the operation, and a predicate in the realm's policy threw.
  It is a 500, since the fault is the policy's. Only a caller who may read the
  realm is told this. A caller who may not gets the same 404 as for a card
  that does not exist. Whether a predicate throws depends on the card's stored
  values, so a 500 would say that the card is there and something about what
  it holds. The realm logs the fault on its `realm:policy` channel, and an
  explain reports it as `predicate-threw`. Write predicates that cannot throw
  on any value the card can store.

## The card routes and a realm's policy

A realm's policy can admit a caller the realm's own permissions decline. The
card+json writes reach the policy the way a batch does: a `POST` that creates a
card is judged as `create` on the type it names, a `PATCH` as `update` on the
card, and a `DELETE` as `delete`. A grant whose `where` reads the card is decided
under the write lock, against the card as it stands when the write runs. A
refusal follows the same rules on both: a caller who may read the realm gets a
403, and one who may not gets the 404 a card that does not exist gets. The
card+json body carries no `code`, so there the status is the whole answer.

A caller who may not read the realm doesn't choose where a card they create
lands. A create mints a card where nothing is stored and is refused where a card
is, so a caller who chose the path would learn which paths hold a card. On
either route the realm mints such a caller's new card's id. A `lid` still names
the card within a batch: it is the key a later entry links the card by, and the
one its result reports. But the card is stored under the realm's id, so a create
sent again with the same `lid` mints a second card. Such a caller's `POST` is
aimed at the realm's root. One aimed at a directory beneath it gets the 404,
since the card would land beneath that directory, and whether the write succeeds
would depend on what is stored along its path. A caller who may read the realm
can list it anyway, so they name their own cards as any writer does, and are
told when a `lid` is taken.

For a caller the realm admits only through a grant, four things set the card
routes apart from a batch:

- **A verb is the built-in behavior.** A `PATCH` merges the document it is sent
  and a `DELETE` removes the card, whatever the card's type declares under those
  names. A type that declares its own `update` or `delete` means by the name
  what its declaration says, so a grant on the name is used through
  `operations()`, and the card route refuses the write.
- **No side-loads.** A document's `included` cards are written too, and a grant
  on one card does not reach another. Create each as its own entry in a batch.
- **A create names its type by URL or registered prefix.** A relative module in
  `meta.adoptsFrom` is refused, because a card that is not stored yet has no
  location for it to be relative to.
- **A write answers with the card it wrote.** A `POST` or `PATCH` answers with
  the card's indexed document, without its link closure, and without running
  the type's `read`, so an `output` its `read` declares does not narrow it. A
  grant of `create` or `update` over the card routes therefore shows the caller
  the card's whole document, whatever `read` grant they hold, and a `PATCH`
  that changes nothing still answers with it. Grant a card write only where the
  caller may see the card.

Some routes answer on the realm's own permissions alone, and no grant reaches
them: the `card+source` write, its octet-stream spelling and the `card+source`
removal; `/_atomic`; and the realm's administration routes, such as `_reindex`
and `_permissions`. The first two write or remove stored bytes verbatim, whether
those are module source, a data file or a card's whole document, and a verbatim
replacement can change a card's type out from under the grant that admitted it.
The administration routes do not act on a card at all.

### Stored bytes, and code

A `readSource` grant is honored on the routes that serve a path's bytes, the
`card+source` read and the realm's file serve, as it is through `operations()`.
It reaches a data file by the `FileDef` its extension names, and a card's `.json`
by the card's own type. Grant it with care. A card's `.json` is its whole stored
document, including every field a `read` projection omits, so a `readSource`
grant beside a narrower `read` hands the caller everything the `read` was
written to leave out.

Code is never granted. A module's source, the transpiled module a browser's
`import` loads, and a directory listing are served only to a caller the realm's
own permissions let read it:

- A rule whose `targetType` is module source (`TsFileDef`, `GtsFileDef`, or a
  type descending from one) compiles to nothing and records
  `grants-module-source`. The rest of the policy applies.
- A rule on `FileDef` reaches every data file and no module.
- A directory has no type, so no rule can name one.

A caller who reaches the realm only through grants is told of each of these
what they are told of a path that holds nothing, and a copy the realm cached
for a reader is never served to them.

So code mode, which edits a realm's modules and browses its file tree, needs
the realm's own read permission. The host does not lead a caller without it
there: the submode switcher, a card's error and an attached file offer no way
in, and the assistant's tools that open code mode refuse. A caller who arrives
anyway, by a shared link, finds the file tree and every module refused, and can
open only a file a grant reaches.

That is the one place the difference between a card's `.json` and its `read`
could be seen side by side: with a `readSource` grant and no `read`, the editor
shows the stored document beside a preview that is refused. The host keeps such
a caller from being led there, but it is not a boundary. The endpoints are.

## Asking a policy what it decides

A realm's policy widens what the realm's own permissions allow. A policy
narrower than its author meant shows up as refusals someone reports. A policy
wider than its author meant shows up as nothing at all. An explain is how the
realm's owner asks directly.

`RealmPolicy` declares one, named `explain`, on the `explain` base, so every
policy card carries it, a subtype's included. Invoked on the policy card with
an actor, a card and an operation, it runs the policy gate of the realm that
holds the card, exactly as that invocation would. It stops at the decision,
invokes nothing, and answers with how the gate got there. The policy card's
isolated view asks it from an "Explain a decision" form and renders the
answer; code asks it the same way:

```ts
let explanation = await operations<typeof RealmPolicy>(policy).explain({
  actor: '@teacher:example.org',
  target: 'https://example.org/education/classrooms/room-204',
  operation: 'read',
});
// explanation.decision   'allowed' | 'denied' | 'failed'
// explanation.reason     why, as one code: 'acl', 'granted', 'no-grant',
//                        'predicate-false', 'predicate-threw', …
// explanation.acl        what the realm's own permissions allow the actor
// explanation.rules      every rule governing the card's type, with each of
//                        its grants for the operation: the predicate, the
//                        tier it reads, and what it said
// explanation.admittedBy the grant that admitted it, where one did
// explanation.refusal    the status and code the actor would be refused with
```

Some things worth knowing before you read one:

- **It is for the people who run the realms.** The caller asking must be able
  to read both the policy card's realm and the card's realm, as a session of
  their own: a revoked session, or one delegated to a single realm, asks as
  nobody. A caller missing either read is told what a card that does not exist
  is told, the same response byte for byte. No policy grant ever reaches an
  explain, the policy's own grant included.
- **Read is the whole gate.** A reader of both realms learns, for any actor
  they name, what the card's realm's permissions allow that actor, which the
  realm's permissions listing shows only to its owners.
- **It is not a self-service check.** A caller who may not read the card's
  realm is told as little as the realm's permissions entitle them to, so that
  they cannot learn which cards exist, and an explain would tell them exactly
  that. Such a caller cannot ask about the card at all, themselves included. A
  caller who reads both realms can ask about any actor, themselves included,
  but a view never decides what to show from an explain.
- **It explains only the policy the card's realm names.** An explain on any
  other policy card refuses with `policy-not-in-force`.
- **`allowed` means the gate admits the invocation.** The operation can still
  refuse for reasons of its own, such as a param it was not sent or an
  assertion the card does not satisfy.
- **A write's predicate is judged against the card as it is stored now.** An
  invocation decides it under the write lock, so another write landing first
  can change the answer.
- **The tier says what a predicate reads.** `stored` is the card's own stored
  source, which is as fresh as the last write. `snapshot` is a predicate
  annotated as reading computed values or linked cards. Those lag the index,
  the gate never evaluates them, and such a grant admits nothing.

### Asking about a draft

An explain can answer against rules that are not live yet. Pass `draft`, a
policy document holding the `rules` a `RealmPolicy` card holds, to the explain
of the card the target's realm names:

```ts
let explanation = await operations<typeof RealmPolicy>(policy).explain({
  actor: '@teacher:example.org',
  target: 'https://example.org/education/classrooms/room-205',
  operation: 'read',
  draft: {
    rules: [
      {
        targetType: { module: '../../education/classroom', name: 'Classroom' },
        grants: [{ operation: 'read' }],
      },
    ],
  },
});
// explanation.draft.issues  what compiling the draft recorded, as a policy's
//                           own issues read
```

The target's realm compiles the draft as it would compile the card its key
names if that card held the document. So a relative `targetType` module
resolves against that card, and a draft copied from the card's own document
means what it means there. The draft is compiled for this answer alone. It is
never cached and never activated, and the live policy answers exactly as it did
before. A draft that doesn't compile reports its issues the way a policy card
does. A draft whose `rules` can't be read at all fails every decision
(`failed`, `policy-unloadable`), which is what the realm would do if its card
held that document. Asking about a draft needs exactly what asking about the
live policy needs: read on both realms.

### Asking about a search

A search is not decided by the gate. The search engine composes the grants
that admit it into its filter, and it reads the index. So an explain of a
search is answered from the search lane. Pass `search` and name the realm as
the target: `{ on, params }` for a named query, or `{ filter }` for an ad-hoc
one, asked as `query`:

```ts
let explanation = await operations<typeof RealmPolicy>(policy).explain({
  actor: '@teacher:example.org',
  target: 'https://example.org/education/',
  operation: 'listClassrooms',
  search: { on: { module: '…/classroom', name: 'Classroom' } },
});
// explanation.search.filter    the search's own filter, as the realm runs it
// explanation.search.fragment  what the policy composes into it; the search
//                              runs { every: [filter, fragment] }
// explanation.search.index     how far behind its source the index is
```

`allowed` with `acl` means the actor reads the realm and searches it unscoped.
`allowed` with `granted` means the fragment scopes the search. `denied` means
the search answers with no rows, which refuses nobody, so no `refusal` comes
with it. `search.index.pending` counts the passes that write the realm's index
and haven't landed yet. Until they land, the search answers from the index as
it was, while the direct lane already sees the card as stored. This is the
freshness difference the explain makes visible: revoking access takes effect
on the direct lane at the next request, and on search only at the next reindex.

### Listing, and the cap

Who can read a card is every actor, and what an actor can reach is every card,
so an explain is bounded. Pass `list: { on?, page?: { number?, size? } }` and
name the realm as the target to explain one page of the realm's cards. Each
card is explained as its own triple, and the answer is
`{ explanations, page: { number, size, total } }`. A request explains at most
100 triples, and that covers a listing's page and a batch's explain entries
together. A listing entry counts as the page it asks for. A request over the
cap is refused whole with `invalid-params` before anything is explained.

## Where to look next

- `packages/experiments-realm/clinical/` — a realm using one of every shape
  above, with the batches built in `patient-record.gts`.
- `packages/base/operations.ts` — the authoring and invocation surface, with
  the reasoning for each decision beside it.
