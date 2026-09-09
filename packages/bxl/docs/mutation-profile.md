# BXL Mutation Profile

Status: implemented pure planner with an example-led candidate source contract

The pre-grammar design corpus is
[`examples/bxl-mutation-examples.ts`](../examples/bxl-mutation-examples.ts).
Its accepted and rejected cases are the current source of truth for candidate
surface syntax. The planner is implemented against that corpus, but the
human-facing grammar remains candidate syntax until the examples settle.

For a human-first walkthrough of the candidate syntax, see
[`mutation-language-guide.md`](./mutation-language-guide.md).

For a corpus-driven comparison with XQuery Update, PostgreSQL JSONB,
JSON:API Atomic Operations, and MongoDB—including the boundary with
cross-Card QuickJS orchestration—see
[`mutation-language-comparison.md`](./mutation-language-comparison.md).

## Purpose

The mutation profile is BXL's data manipulation language for any schema-known
Card- or Field-shaped model. The target may be a complete Card, a scalar Field,
a compound Field, a collection Field, or a relationship Field. It uses
jq-shaped locations and expressions to describe terse changes without
requiring a caller—especially an LLM—to reprint the complete Card, a complete
compound field, or expanded relationship subtrees.

```bxl
.title = "Championship Replay";
.score |= . + 10;
insert_item_after(
  { id: "move-08", word: "STREAM", score: 24 };
  .moves[] | select(.id == "move-07")
);
move_item_before(
  .sections[] | select(.id == "summary");
  .sections[] | select(.id == "round-one")
);
```

The same DML has two equivalent source encodings:

- structured operations, optimized for JSON-schema tool calls; and
- textual BXL statements, optimized for human authoring and token streaming.

Both lower to the same mutation-plan IR and must have identical semantics.

The implementation entry points are:

```ts
import {
  prepareBxlMutation,
  prepareBxlMutationOperations,
} from '@cardstack/bxl/mutation';
```

This is a DML, not a persistence API. Evaluation is pure:

```text
snapshot + mutation source + parameters
  -> mutation plan + output snapshot + returning data
```

A trusted host separately authorizes and commits the plan through CardDef and
FieldDef setters, relationship APIs, and the host's transaction mechanism.

The snapshot must already be loaded. Realm search, collection lookup,
file-tree traversal, and other network or host I/O are outside this profile.
A separate capability-limited QuickJS program may perform those operations,
prepare one mutation program, and invoke it independently against each loaded
Card. This keeps cross-Card orchestration out of the mutation parser and keeps
the one-Card mutation evaluator pure.

The input snapshot is the **loaded Card or Field model exposed by the Card
Store**, not the raw JSON:API card resource document. A relationship field is
therefore observed as a loaded Card or array of loaded Cards. Storage details
such as `relationships["entryPoints.0"].links.self` are not addressable BXL
paths. Only the commit adapter translates relationship intents to that
serialization.

## Planner API

`prepareBxlMutation` parses and prepares a complete textual program once. Its
`plan` method may then run against a loaded Card/Field snapshot:

```ts
const prepared = prepareBxlMutation(
  '"Line Item"[SKU = "COPY-03"].Quantity += 1;',
  {
    targetKind: 'card',
    syntax: 'readable',
    schema: invoiceMutationSchema,
  },
);

const plan = prepared.plan(loadedInvoice, {
  programId: 'assistant:call_123',
  targetId: loadedInvoice.id,
  baseRevision: loadedRevision,
  currentRevision: loadedRevision,
  returning: ['affected', 'paths', 'changes'],
  cards: loadedRelatedCardsById,
  authorize(statement) {
    return authorizeConcreteWriteSet(statement.intents);
  },
});
```

`prepareBxlMutationOperations` accepts the equivalent structured operation
array and returns the same prepared-planner interface with language
`bxl-mutation-ops/1`. Operation IDs must be present and unique.

For token streaming, `createBxlMutationStatementStream()` accepts arbitrary
chunks and emits only complete semicolon-terminated statements. It preserves
semicolons inside strings and nested calls, enforces buffer/statement limits,
and rejects an incomplete tail from `finish()`. A host may prepare emitted
statements independently for statement transactions or collect them for one
complete atomic program.

The mutation schema extends BXL's existing readable schema with facts a host
already knows from CardDef/FieldDef metadata:

- `fieldType`: `contains`, `containsMany`, `linksTo`, or `linksToMany`;
- `writable`: whether the Field accepts writes; and
- `rootField`: the natural Field metadata when the planner target is a Field
  value rather than a complete Card.

The Realm bundle's single-Card adapter derives this shape from the loaded
Card's definitions with `getFields(card)`. It is not additional
author-maintained mutation configuration.

Planning is synchronous and pure. It clones the supplied snapshot, evaluates
statements sequentially against a private working snapshot, and returns only
after every statement, schema check, revision precondition, and optional
authorization callback succeeds. An error therefore cannot mutate the
caller's snapshot. The returned intents retain `copy`, `insert`, `move`,
`reorder`, `relate`, `unrelate`, and `move-relation`; they are not reconstructed
from a final JSON diff.

The pure planner does not persist. `updateViaBxl(source)` is the small
single-Card convenience boundary: its returned function snapshots `this`,
plans the complete program, and applies semantic intents to the resident
Card Store-backed model through Card/Field setters. It derives schema through
`getFields(this)` and resolves relationship Cards through `getStore(this)`.
This deliberately stops at the local model. A trusted host still owns
current-revision loading, durable idempotency, transaction limits, network
persistence, JSON:API Atomic lowering, and result publication.

```ts
const update = updateViaBxl('"Line Item"[SKU = "COPY-03"].Quantity += 1;');

const plan = update.call(invoice, {
  programId: 'assistant:call_123',
});
```

### Canonical card-source adapter

Server-side clone/create tools may hold canonical Boxel `.json` source without
loading a CardDef instance. They use a separate commit adapter while retaining
the same source language, schema rules, pure planner, plan IR, and
authorization hook:

```ts
const schema = await mutationSchemaForCardSource(definition, {
  lookupDefinition,
});

const result = mutateBxlCardSource(sourceDocument, changes, {
  schema,
  syntax: 'solidified',
  programId,
  targetId,
  resolveReference,
  formatReference,
  resolveCard,
  serializeContainedValue({ path, value, field, operation }) {
    return serializePolymorphicFieldSidecars(path, value, field, operation);
  },
});
```

`mutationSchemaForCardSource` consumes the loaderless subset of Boxel's
`Definition` graph: field type, primitive/compound shape, computed and query
status, target code reference, and target display name. The host-provided
lookup owns code-reference resolution and Definition caching.

`snapshotBxlCardSource` maps authored attributes to their logical field paths
and maps Boxel dotted relationship keys to `{ id }` projections. It accepts
both canonical `links.self` relationships and served JSON:API `data` resource
identifiers, including indexed and compact to-many forms. A host callback may
resolve source-relative references before planning.

`applyBxlMutationPlanToCardSource` structured-clones the complete source
document and changes only storage locations named by validated intents. It
preserves unknown authored data, document extensions, relationship metadata,
and untouched relationship records. Relationship assignment removes stale
`data`, writes `links.self`, and retains other relationship extensions. The
original source object is never mutated.

The source adapter applies the plan's original `set`, `copy`, `delete`,
`insert`, `move`, `reorder`, `relate`, `unrelate`, and `move-relation` intents
rather than diffing `plan.output`. Structural operations coordinate all three
parallel source representations:

- authored values under `data.attributes`;
- flattened relationship keys such as `examples.2.owner` and
  `sections.0.items.1.target`; and
- recursive field metadata under `data.meta.fields`.

Boxel has two collection metadata shapes. A composite `containsMany` stores a
parallel array at `meta.fields[fieldName]`, whose items may contain both
`adoptsFrom` and recursive `fields`. A polymorphic primitive `containsMany`
stores direct keys such as `meta.fields["fieldName.0"]`. Inserts, deletes,
moves, reorders, and copies reindex the applicable shape and every nested
relationship prefix together. Compact JSON:API to-many `data: [...]` is
normalized to Boxel's indexed source representation before an edit, and an
empty `linksToMany` returns to `{ links: { self: null } }` when its last edge is
removed.

Plain mutation JSON does not identify the runtime FieldDef of a newly created
polymorphic contained value. `serializeContainedValue` is the host boundary for
that information. It returns the value's source-relative `meta` (normally an
`adoptsFrom`, optionally recursive `fields`) and local relationship records;
the adapter hoists those relationships under the contained value's dotted
path. Existing values need no callback: their exact metadata and relationship
extensions travel with move/copy operations. If a collection already uses
per-value `adoptsFrom`, an insertion without matching metadata fails with
`card-source-contained-meta-required` rather than damaging the source.

Computed Fields use `writeBehavior: 'skip'` in the derived mutation schema.
They remain readable and addressable, but any assignment, replacement,
deletion, or collection operation targeting one produces no intent and reports
zero affected values. The right-hand expression is not evaluated. This makes
model-generated updates tolerant of derived Card Info fields without weakening
the fail-closed behavior of query-backed or otherwise read-only Fields. Read-
only overlays do not change this: a Field the schema speaks for is answered by
the schema, so the same program plans the same way whether or not the Card is
indexed.

Relationship references are logical Card IDs in plans and source references at
the persistence boundary. `resolveReference(reference, path)` expands authored
relative links when projecting a snapshot and may preserve portable RRI values
such as `@catalog/...`. `formatReference(cardId, path)` performs the inverse for
writes and may choose RRI, relative, or absolute form per edge. Reindexing never
rewrites an untouched relationship's reference, metadata, or extension members.

## Read-only overlays

A Card's stored document holds its own Field values and its links to other
Cards as references. Two other kinds of value exist only in the search index:
**computed** values, which the indexer evaluates and writes to `pristine_doc`,
and **linked-Card** values, the searchable Fields of the Cards this one links
to, denormalized into `search_doc`. A host that does not instantiate Cards
reads those columns itself and passes them to the planner as read-only
overlays:

Both overlays are keyed the way the snapshot is: by Field, from the Card's
root. `search_doc` already has that shape. `pristine_doc` does not — it is the
Card's JSON:API resource, so its Field values sit under `attributes`, and it
has to be projected through the same adapter the snapshot came from before the
planner will recognize a path in it:

```ts
const computeds = snapshotBxlCardSource({ data: pristineDoc }, schema, options);

const plan = prepared.plan(storedSnapshot, {
  programId: 'assistant:call_123',
  overlays: {
    computeds,
    linked: searchDoc,
    unavailable: [
      { path: 'patient.name', tier: 'linked', reason: 'not-searchable' },
    ],
  },
  onRead(event) {
    log(event.path, event.tier, event.outcome);
  },
});
```

Passing the raw resource instead is not an error the planner can raise: every
Field path simply goes unanswered, while `attributes`, `meta`, `type` and
`links` become computed values in their own right.

An author addresses stored, computed, and linked values through the same
`.path` syntax. The rules the planner enforces:

- **The stored document wins, and keeps its shape.** An overlay answers a path
  only where the stored document holds nothing — an absent key or a `null`,
  which is what a Card holds at a path it never persists. An overlay's stale
  copy of a stored value never displaces the stored one. An empty list counts
  as holding nothing, since a projection manufactures one for a list Field the
  Card never persists and it carries none of the Card's own values either way.
  Nor may an overlay _reshape_ the Card: a value whose path runs past a stored
  scalar is dropped rather than retyping the scalar, and no path is ever
  followed _into_ a list, empty or not. Index drift is routine and must not
  change the document a program plans over.
- **An overlay speaks only where it has something to say.** `pristine_doc` and
  `search_doc` are whole documents: they carry the Card's own Fields alongside
  the ones only they can answer. A Field the Card leaves unset therefore
  arrives as a `null` in both, and a `null` supplies nothing — claiming it
  would make an ordinary writable Field read-only for no reason. A host can
  pass either column wholesale without narrowing it first — `search_doc`'s own
  bookkeeping keys, which start with an underscore where a Field key never
  does, are index columns rather than Field values and are dropped. An
  `unavailable`
  entry, by contrast, is refused rather than guessed at: a missing or
  misspelled `path`, `tier`, or `reason` raises `overlay-invalid`, because a
  marker the planner cannot read is a read it would wrongly allow.
- **An overlay is data, not a path a program spelled out.** It is read out of
  a column, so a key naming something on a JavaScript prototype
  (`__proto__`, `prototype`, `constructor`) is dropped, the same refusal the
  planner gives a program that spells one out.
- **A list is one value.** An overlay may hand over a whole list the Card does
  not store — a computed `containsMany` — and that list reads as itself and is
  read-only whole, its own positions consistent with each other. It is never
  descended into, so no overlay position is ever laid beside one of the Card's
  own items.
- **Overlays stop at a collection boundary.** No overlay value ever names a
  position _inside_ a list: a path with a segment that reads as an index is
  dropped, however it is spelled, and so is one that runs through a list the
  Card stores. An overlay arrives keyed by position, and a position is an
  identity only while nothing moves: inserting, deleting, reordering or moving
  an item renumbers everything after it, and a copy written before the program
  ran cannot say which item it meant. Contained items carry no id to re-key
  against. So inside a collection the Card stores, its own items are the whole
  answer: reads there are source reads, an `unavailable` marker there is
  dropped for the same reason, and every collection operation plans, outputs
  and records intents exactly as it would with no overlays at all. A computed
  Field inside a collection is the schema's to answer for, through
  `writeBehavior: 'skip'`.
- **Overlay values are read-only, and the schema answers first.** Where the
  schema already speaks for a Field, it decides: a Definition-derived schema
  marks every computed Field `writeBehavior: 'skip'`, so a write to one stays
  the intentional no-op described above whether or not the indexer has
  answered. The overlay is the backstop for paths the schema has no opinion
  about — there, a write that lands on a computed value fails with
  `computed-read-only`, and one that lands on a linked Card's Field fails with
  `write-through-link`, each naming the path. A container the overlay supplies
  where the Card holds nothing is a computed value in its own right and is
  read-only whole; a container the Card stores, into which an overlay merely
  filled a Field, stays the Card's to write. Writing an _ancestor_ of a linked
  value likewise stays an ordinary write: replacing a relationship edge changes
  the Card's own document, not the Card on the far side of the link.
- **A read reports an overlay whenever one participates in its value** — the
  overlay supplied the path, the read sits inside a value it supplied, or the
  value returned carries overlay-supplied descendants. Reading a stored
  container whose Fields an overlay filled in is therefore an overlay read, not
  a source read, so it cannot reach index data without saying so. That holds at
  the root as well: reading the whole Card carries whatever an overlay put
  under it, so an expression that indexes by a computed key, or pipes the Card
  into a builtin, is an overlay read like any other.
- **An unavailable read fails loudly.** `unavailable` entries name what the
  host could not supply and why (`not-indexed`, `not-searchable`,
  `key-absent`). A marker at the read path, or nested under it, makes the read
  `unavailable` — the subtree returned would be missing what the host could not
  supply. A marker _above_ the path applies only where the stored document has
  nothing of its own there. Reading one raises `snapshot-unavailable` carrying
  `{ path, tier, reason }` rather than leaking a `null` into a write or a
  precondition. A marker carries no value, so it refuses no writes on its own.

  A relationship Field is the case worth knowing about. `not-searchable`
  markers sit under links, and a marker under one covers the link itself:
  reading `.patient` where `patient.name` is unavailable is an unavailable
  read, even though the Card's own edge is right there. Address the edge to
  ask whether it is set — `.patient.id != null`, which reads from source —
  rather than the Field that holds it.

- **An assert over an overlay says so.** Overlay values can lag the stored
  document by an indexing round, so an `assert` that reads one requires the
  three-argument form `assert(condition, message, { snapshot: true })`; without
  it the statement fails with `assert-snapshot-required`. With it, an
  unavailable read fails the assert with the author's own message. The literal
  `{ snapshot: true }` is the only accepted option record — `assert/2` is how
  an assert says it requires stored values.
- **An update sees the layered value, and stores the Card's.** `|=` is handed
  the location's value with the overlays under it, so a Field an overlay filled
  into a stored container is in scope the same way it is anywhere else — which
  matters because `=` evaluates its value expression against the Card root, so
  only `|=` can write a value derived from the location it is updating. What
  the expression returns is settled back against the Card before it is written:
  an overlay value carried straight through is put back to what the Card holds,
  an expression that simply omits the path is not writing to it, and one that
  writes something else there is refused. Reaching a supplied value may have
  taken containers the Card does not hold either; those are put back the same
  way, so a graft is never stored. Only paths an overlay supplied are settled,
  and none of them lie inside a collection, so an update that reorders or
  resizes one has nothing to carry.
- **Choosing a write set is a read.** A `[* predicate]` selector consults the
  document to decide what it matches, so an unavailable value stops it rather
  than quietly settling which items a statement deletes. A location that
  addresses one place selects nothing and adds no event of its own.
- **A path a statement clears belongs to the program.** An overlay answers
  where the Card holds nothing, and a place the program emptied is not one of
  those — otherwise a stale index copy would fill it straight back in and
  refuse the write that follows.
- **The guards see the paths a program can be _proven_ to read.** Reads are
  collected by walking an expression, and the walk reports a lower bound. It
  skips anything conditional — `if`/`else`, the right side of `//`, `and` or
  `or`, everything after the first argument of `IF`/`IFS`, a comma branch
  inside `first` — because a path read only on the branch not taken must not
  refuse the program. It also cannot see through a variable binding,
  `reduce`/`foreach`, a computed key, `getpath`, `..`, or a builtin that may
  re-root its argument — and that last one covers the formula functions, so a
  path reached as an argument to `UPPER`, `LEN`, `ISBLANK` or any of their
  neighbours is not seen either. `assert(UPPER(.status) == "OPEN"; …)` plans
  without the option that `assert((.status | ascii_upcase) == "OPEN"; …)`
  requires. A read reached any of those ways sees the same layered value as
  any other, but the three guarantees above — the loud unavailable failure, the
  assert opt-in, and the read event — do not speak for it. Treat them as
  catching the ordinary `.path` spelling, not as a boundary that cannot be
  stepped around.
- **Every read an expression resolves is reported.** `onRead` fires once per
  such path, in program order, with the tier that answered (`source`,
  `computed`, `linked`) and the outcome (`value`, `null`, `unavailable`). A
  selector reports only the paths an overlay answered: what it reads of the
  Card's own document it reads to choose a write target, which the statement's
  own paths already record.

Overlays are additive: a plan built without them behaves exactly as one built
before they existed. A plan's `output`, and the `before` recorded on every
intent, carry stored values only — the planner's working state is the Card's
own document, and the layered view exists only for the duration of an
expression's evaluation, so an overlay answers reads without ever standing in
for what the Card held. The planner receives overlay values already fetched by
the host; it never queries the index itself.

## Why a profile is needed

Ordinary BXL computes a value. Mutation BXL additionally describes locations
that may change and preserves the intent of each change. It needs a dedicated
profile because ordinary jq assignment is broader than a safe Card DML:

- jq can replace the root or generate multiple outputs;
- a selector can unexpectedly update many paths;
- array indexes are unstable under insertion and concurrent editing;
- a final JSON diff cannot distinguish move from delete-plus-insert;
- contained values and relationship edges have different commit semantics;
- schema validity, authorization, revision checks, and transactionality live
  outside the jq evaluator.

`Profile.mutation` therefore defines a restricted source language, a mutation
plan IR, and a commit contract. All three are part of conformance.

## Three-layer architecture

### 1. Source encodings

Authors may use jq-shaped statements or structured tool-call operations.
Statements can calculate a value from the current snapshot; structured
operations carry JSON values and canonical target/selector objects. Only
approved statement and operation forms can produce writes.

Textual statements have the same two syntax modes as ordinary BXL. Readable
BXL lets humans use schema labels, predicates, Excel-style comparison, and
compound assignment sugar. It solidifies to schema-resolved, jq-shaped mutation
source before AST validation and planning:

```bxl
"Line Item"[SKU = "COPY-03"].Quantity += 1;
```

```bxl
(.lineItems[] | select(.sku == "COPY-03") | .quantity) |= . + 1;
```

This solidification must be mutation-aware. In ordinary derive expressions a
readable `[predicate]` returns the first matching value. On the left side of a
mutation it remains a location selector and must satisfy the mutation
statement's exact-one cardinality. It must not be lowered through `first(...)`
in a way that conceals multiple matches. Readable `[* predicate]` is the
explicit multi-location marker on the left side of assignment, update
assignment, or `del`. The mutation-aware compiler preserves that selector mode
in the prepared AST even after displaying a jq-shaped solidification; ordinary
`[]` iteration never silently becomes bulk permission.

At the top level of the mutation profile, `Label = expression;` is an
assignment statement. Inside predicates, assertions, and value expressions,
readable `=` retains its established comparison meaning. Readable `+=`, `-=`,
`*=`, and `/=` normalize to canonical `|=` expressions. They are permitted for
schema-compatible scalar values, but not as a way to replace collection or
relationship fields wholesale.

### 2. Mutation plan

The compiler lowers source to typed mutation intent. During evaluation,
selectors resolve to concrete paths and every statement produces a write-set
entry. The plan retains operations such as insert and move; these must not be
reconstructed later by diffing two arrays.

### 3. Commit adapter

The host validates the concrete write set against schema and authorization,
checks revisions, and applies each intent through the correct storage API. BXL
does not write to a Realm, Yjs document, database, or network itself.

## Execution envelope

Delivery and transactionality are independent axes:

```ts
interface BxlMutationExecution {
  language: 'bxl-mutation/1' | 'bxl-mutation-ops/1';
  programId: string;
  target: {
    kind: 'card' | 'field';
    id: string;
    /** Optional path when a Field target is addressed inside a Card. */
    path?: JqPath;
  };
  baseRevision?: string;
  schemaVersion?: string;
  delivery?: 'complete' | 'streaming';
  transaction?: 'atomic' | 'statement';
  /** Textual programs default to readable BXL; solidified is planner-facing mutation BXL. */
  syntax?: 'readable' | 'solidified';
  /** Stable principal supplied by the trusted host, for authorization and audit. */
  actor?: string;
  /** Request-scoped values the program reads; see "Request context" below. */
  context?: BxlMutationContext;
  returning?: ReadonlyArray<'old' | 'new' | 'changes' | 'affected' | 'paths'>;
}
```

Defaults are `delivery: 'complete'`, `transaction: 'atomic'`, and
`syntax: 'readable'`. Structured operation programs ignore `syntax`.

## Request context

A program sees the document it is editing through `.`. Three builtins supply
the rest of what a write operation needs, each reading a value the trusted
host resolved before the program ran:

| Call                             | Reads                                          |
| -------------------------------- | ---------------------------------------------- |
| `params("key")`                  | that entry of the payload the caller sent      |
| `actor()` / `actor("key")`       | the authenticated caller, or one of its fields |
| `instance()` / `instance("key")` | the stored document, or one of its fields      |

`actor()` is what a _program_ reads. It is distinct from the envelope's
`actor`, which the host carries alongside the plan into authorization and
audit and which no program can see. A host that wants a program to record its
caller supplies both.

```ts
type BxlMutationJsonObject = { [key: string]: BxlMutationJson };

interface BxlMutationContext {
  params?: BxlMutationJsonObject;
  actor?: { id: string; [key: string]: BxlMutationJson };
  instance?: BxlMutationJsonObject;
}
```

The host passes it as `context` on the plan options, and may keep and reuse
that object freely. A value is copied on its way to a program — a builtin is
free to write into the argument it is handed, and the copy is what keeps those
writes off the host's own object — and a written value is copied again on its
way into the plan, so a plan never shares structure with the context and is
settled once made.

These are functions rather than `$`-prefixed bindings, matching the form an
operation is authored in. The name `params` rather than the more obvious
`input` is forced by the profile: `input` is denied in `mutation`, and
classification is by base name without arity, so an `input("key")` accessor
would be refused before it ran. Registry resolution is per `NAME/arity`, so
that accessor would land at the free `input/1` and hide jq's `input/0` from
nothing — the collision is in the safety table, not the registry.

Every failure is loud. Naming one of these where the host supplied no context,
or asking for a key that is not there, fails the program — a `null` would land
in the document as a missing comment author or a silently unset field. The
operation layer validates declared keys before a program runs; the key check
here is the backstop. `actor()` and `instance()` return the whole object, which
is the reading to reach for when a key may legitimately be absent.

A key is readable only if it is the object's own and its value is not
`undefined`. A prototype-chain name would otherwise answer with a function,
and `undefined` is not a JSON value — it would reach the planner as one and
write an intent that unsets the field. A JSON `null` is a real value and reads
as `null`.

The context is checked against that same standard before a program can reach
it: a slot carrying anything a JSON document cannot hold — a `Date`, `Map`,
`Set`, `RegExp`, `TypedArray`, `URL` or any other value whose built-in type is
neither a plain object nor an array, a `bigint`, a function, or a non-finite
number, at any depth — fails the plan with `context-not-json` naming the path.
An object carrying only its own data fields is a plain object whatever its
prototype says, and is accepted. The type declares JSON, but a type is not a
runtime guarantee, and a `bigint` read through `tostring` produces exactly the
silent unset these builtins refuse.

An absent array entry is refused too, whether it is a hole or an explicit
`undefined`. An absent object member serializes as absent, but an absent array
entry serializes as `null` — a value the host never sent.

Only the `mutation` profile admits them. `derive` denies them because a stored
derivation reused on later reads must not depend on whichever request last
wrote it, and `policy`, `authorization` and `predicate` deny them because a
mutation payload is not an input to an authorization decision or a query
predicate.

In readable syntax the quoted argument to these three is a literal key name.
Everywhere else a quoted string is resolved against the schema's field labels
— that is how a multi-word label like `"Packing Notes"` is written — which
would otherwise turn `params("Image")` on a card with an `Image` field into a
read of that field. A bare label still compiles as an expression, so a
computed key stays available.

The target defines what `.` means. For a Card target, `.` is the Card's
editable projection. For a Field target, `.` is that Field's own value. The
profile is otherwise independent of CardDef and FieldDef names or shapes.
Readable source may spell a Field root with that Field's existing display
label—`Score += 1` or `append(Tag, "urgent")`. This reuses Card/Field metadata;
it does not add mutation-specific identity or naming configuration. The
solidified form uses `.` for the same root.

This produces four meaningful combinations:

| Delivery  | Transaction | Meaning                                                                                                           |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------- |
| complete  | atomic      | Parse, validate, and commit the complete program once.                                                            |
| streaming | atomic      | Evaluate complete statements into a private preview, then commit once when the stream finishes.                   |
| streaming | statement   | Commit each complete statement independently inside one named undo session. This is the Scrabble-stream behavior. |
| complete  | statement   | Execute a supplied batch statement by statement; useful for imports and resumable jobs.                           |

“Streaming” never implies partial-statement execution. “Atomic” never describes
a sequence whose earlier statements have already become durable.

## Statements

Version 1 should support this closed statement set:

The signatures below use readable BXL's comma-separated arguments. During
solidification, calls become jq-shaped mutation BXL with semicolon-separated
arguments. The mutation AST may retain profile information such as a
filter-all location that ordinary value-mode jq would collapse into an array.
Statement-terminating semicolons are framed outside the expression parser.

| Statement                                         | Meaning                                                                         | Cardinality                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `location = expression`                           | Set/upsert a schema-permitted location.                                         | exactly one, or every match selected with `[* predicate]` |
| `location \|= expression`                         | Transform an existing value. Readable `+=`, `-=`, `*=`, and `/=` use this form. | exactly one, or every match selected with `[* predicate]` |
| `replace(location, expression)`                   | Replace an existing value.                                                      | exactly one target                                        |
| `copy_value_to(source, destination)`              | Deep-copy one loaded value to another writable field.                           | one source, one destination                               |
| `del(location)`                                   | Delete an existing member or item.                                              | exactly one, or every match selected with `[* predicate]` |
| `prepend(collection, expression)`                 | Insert at array start.                                                          | one collection, one value                                 |
| `append(collection, expression)`                  | Insert at array end.                                                            | one collection, one value                                 |
| `insert_at(collection, index, expression)`        | Insert at a zero-based index.                                                   | one collection, one value                                 |
| `insert_item_before(value, anchor)`               | Insert a value before a stable array item.                                      | exactly one anchor                                        |
| `insert_item_after(value, anchor)`                | Insert a value after a stable array item.                                       | exactly one anchor                                        |
| `move_item_before(item, anchor)`                  | Move an item immediately before an anchor.                                      | exactly one item, exactly one anchor                      |
| `move_item_after(item, anchor)`                   | Move an item immediately after an anchor.                                       | exactly one item, exactly one anchor                      |
| `move_item_to_start(item, collection)`            | Move an item to array start.                                                    | exactly one item, one collection                          |
| `move_item_to_end(item, collection)`              | Move an item to array end.                                                      | exactly one item, one collection                          |
| `reorder_by(collection, key, order)`              | Apply an exact key permutation.                                                 | one collection                                            |
| `assert(expression, message)`                     | Add a no-write precondition.                                                    | exactly one Boolean                                       |
| `assert(expression, message, { snapshot: true })` | The same precondition, accepting a stale or missing overlay answer.             | exactly one Boolean                                       |

The strict single-target default is deliberate. jq's implicit multi-location
assignment is concise but dangerous for generated DML. Bulk intent must be
visible in the location through `[* predicate]`, and the result reports the
affected count. This gives assignment and deletion one shared cardinality
rule instead of separate bulk functions.

An expression used as a value must produce exactly one JSON value. Zero or
multiple outputs are an `expression-cardinality` error.

## Structured tool-call operations

The structured encoding is a JSON-schema-friendly form of the same DML:

```ts
interface BxlMutationOperationProgram {
  language: 'bxl-mutation-ops/1';
  programId: string;
  target: BxlMutationExecution['target'];
  baseRevision?: string;
  schemaVersion?: string;
  delivery?: 'complete' | 'streaming';
  transaction?: 'atomic' | 'statement';
  operations: BxlMutationOperation[];
}

type JsonScalar = null | boolean | number | string;
type JqPath = Array<string | number>;

type StructuredTarget =
  | { path: JqPath }
  | {
      collection: JqPath;
      where: Array<{ path: JqPath; equals: JsonValue }>;
      relativePath?: JqPath;
    };

type StructuredPosition =
  | { at: 'start' | 'end' }
  | { index: number }
  | { before: StructuredTarget }
  | { after: StructuredTarget };

type OperationValue =
  | { value: JsonValue; expression?: never }
  | { value?: never; expression: string };

type BxlMutationOperation =
  | ({ id: string; op: 'set'; target: StructuredTarget } & OperationValue)
  | { id: string; op: 'update'; target: StructuredTarget; expression: string }
  | ({ id: string; op: 'set-all'; target: StructuredTarget } & OperationValue)
  | {
      id: string;
      op: 'update-all';
      target: StructuredTarget;
      expression: string;
    }
  | ({ id: string; op: 'replace'; target: StructuredTarget } & OperationValue)
  | { id: string; op: 'copy'; from: StructuredTarget; target: StructuredTarget }
  | { id: string; op: 'delete'; target: StructuredTarget }
  | { id: string; op: 'delete-all'; target: StructuredTarget }
  | ({
      id: string;
      op: 'insert';
      into: StructuredTarget;
      position: StructuredPosition;
    } & OperationValue)
  | {
      id: string;
      op: 'move';
      target: StructuredTarget;
      into: StructuredTarget;
      position: StructuredPosition;
    }
  | {
      id: string;
      op: 'reorder';
      target: StructuredTarget;
      key: JqPath;
      order: JsonScalar[];
    }
  | { id: string; op: 'assert'; expression: string; message?: string }
  | StructuredRelationshipOperation;
```

`StructuredTarget` uses canonical jq path arrays plus bounded selector clauses,
as in the Scrabble prototype's `bxl-card-mutation/1` draft. It never transports
display-path strings as the canonical address.

An operation takes either a literal JSON `value` or a mutation-profile BXL
`expression`, never both. This keeps structured operations as expressive as
textual statements without asking a tool caller to serialize a complete
replacement tree.

Ordinary structured `set`, `update`, and `delete` operations require exactly
one target. Their `-all` counterparts are the tool-call encoding of a textual
`[* predicate]` location and require one or more targets. Cardinality is
therefore explicit in the operation name rather than added as target
configuration.

For streaming JSON tool calls, an executor may accept each fully closed
operation object as it arrives. A partial JSON object is never planned or
committed. Operation IDs are explicit and unique within the program.

Literal structured operations and equivalent textual statements must lower to
the same intent. For example, these are semantically identical:

```json
{
  "id": "rename",
  "op": "set",
  "target": { "path": ["title"] },
  "value": "Final"
}
```

```bxl
.title = "Final";
```

The conformance suite should compare their canonical plans, not only their
final output snapshots.

The core primitives are structurally complete for one loaded target: set and
delete cover objects, replace covers scalar and compound values, and
insert/delete/move/reorder cover ordered collections. Copy and set operations
retain useful author intent even though their final state could be expressed
with lower-level set/delete operations. Explicit structured relationship
operations cover graph edges.

### Set, update, and replace

`=` may create a missing object member when the schema permits it. It may not
create sparse arrays. `|=` and `replace` require the target to exist.

The right side of `=` and `replace` observes the current root snapshot. The
right side of `|=` observes the selected value, matching jq update-assignment
semantics. Host parameters are read through `params("key")`; statements cannot
bind variables for later statements.

Root replacement (`. = ...`) is forbidden for a Card target. It is permitted
for an explicitly selected Field target because replacing a scalar or complete
Field value is sometimes the only meaningful mutation. The plan records this
as replacement of that Field path, not replacement of the containing Card.

### Delete and null

Deletion removes a member or array item. Assigning JSON `null` preserves a
member whose value is null. Missing deletes fail by default. Version 1 has no
silent `del?`; callers get idempotency from execution identity, not by hiding
missing targets.

### Insert and move

Insertion expressions produce one sibling value. An array expression inserts
one array value, not several sibling values.

Version 1 follows the collection shapes that CardDef and FieldDef expose
today. A `containsMany` is an ordered array of Field values, and a
`linksToMany` is an ordered array of loaded Cards. Neither field kind implies
set membership, and repeated values are not assigned an invented equality or
identity rule by the mutation language. Use insert, delete, move, and reorder
against the loaded array; relationship-shaped writes lower to relationship
intents as described below.

The profile deliberately has no generic `add_to_set` operation. Complex
FieldDefs have no intrinsic ID, while deep serialized-value equality would
make membership depend on representation details. A future keyed or hash-map
Card relationship can add key-based operations when that capability exists in
the Card model itself, without preconfiguring an identity system here.

Move is a first-class intent. Its normative algorithm is:

1. Resolve the item and anchor against the pre-statement snapshot.
2. Require distinct direct array items.
3. Remove the item being moved.
4. Relocate the resolved anchor in the post-removal destination.
5. Insert immediately before or after the anchor.

For numeric positions, the index is interpreted after item removal. Moving
across collections is permitted only when both fields are writable and the
destination schema accepts the moved value.

### Exact reorder

Relative moves are best for streaming and collaborative editing. Atomic tools
also need a concise way to assert a complete order:

```bxl
reorder_by(.sections; .id; ["overview", "round-one", "summary"])
```

`reorder_by` requires every current item to have one unique JSON-scalar key.
The readable key argument is compiled in the collection item's schema. A Card
program such as `reorder_by(Bookings, Booking ID, order)` therefore lowers its
key to item-relative `.bookingId`, not root-relative
`.bookings[].bookingId`.
The supplied order must be an exact permutation: no missing, duplicate, or
unknown keys. It changes order only; it cannot insert, delete, or replace an
item. This makes accidental data loss impossible and gives the commit adapter
a true reorder intent.

## Addressing and identity

Direct locations use jq paths. Selected locations use bounded jq iteration and
`select`:

```bxl
.moves[] | select(.id == "move-07") | .score
```

The compiler records a location expression, not just its current value.
Structural sources and anchors must resolve to direct array items.

Stable selectors should use values that naturally identify an item in the
loaded model: a linked Card's ID, or one or more ordinary fields of a contained
value. The author supplies that selector and the planner proves its cardinality
against the current snapshot; the mutation profile does not add identity
configuration to the FieldDef. Numeric indexes are allowed only when one of
these is true:

- the execution carries a matching `baseRevision` and commits atomically; or
- the collection is declared position-addressed by its schema.

Streaming statement commits should reject index-addressed edits to ordinary
ordered collections because a concurrent insert can retarget them.

Selectors are resolved against the current intermediate snapshot, so each
statement observes prior statements. A moved item and its anchor are each
resolved once per statement. Neither has implicit first-match behavior: zero
matches are stale and multiple matches are ambiguous.

A descendant may identify the enclosing structural item. Readable BXL keeps
the item being moved outermost:

```bxl
move_item_before(
  Product[Variants[SKU = "COPY-03"]],
  Product[ID = "featured"]
)
```

This solidifies to an existential selector over the descendant collection:

```bxl
move_item_before(
  .products[] | select(any(.variants[]; .sku == "COPY-03"));
  .products[] | select(.id == "featured")
)
```

Several matching Variants within one Product still select one Product.
Several matching Products violate the move operand's exact-one cardinality.
`Product[Variants[predicate]]` addresses the Product; a `Variant[predicate]`
operand addresses the nested Variant itself.

## Mutation plan IR

The plan is the durable semantic boundary between BXL evaluation and host
commit:

```ts
interface BxlMutationPlan {
  language: 'bxl-mutation-plan/1';
  programId: string;
  target: BxlMutationExecution['target'];
  baseRevision?: string;
  schemaVersion?: string;
  sourceHash: string;
  statements: BxlMutationStatementResult[];
  output: JsonValue;
  inverse?: BxlMutationIntent[];
}

interface BxlMutationStatementResult {
  ordinal: number;
  statementId: string;
  source: {
    encoding: 'statement' | 'operation';
    start?: number;
    end?: number;
    operationId?: string;
    canonical: string;
  };
  affected: number;
  intents: BxlMutationIntent[];
}

type BxlMutationIntent =
  | { op: 'set'; path: JqPath; before?: JsonValue; after: JsonValue }
  | { op: 'delete'; path: JqPath; before: JsonValue }
  | { op: 'copy'; from: JqPath; path: JqPath }
  | { op: 'insert'; collection: JqPath; index: number; value: JsonValue }
  | { op: 'move'; from: JqPath; toCollection: JqPath; toIndex: number }
  | { op: 'reorder'; collection: JqPath; keys: JsonScalar[] }
  | BxlRelationshipIntent;
```

Concrete paths are useful for authorization, validation, audit, and UI
highlighting. Intent kinds are necessary for granular Yjs/CRDT operations and
correct undo. Implementations must not collapse array intent to a single
whole-array `set` merely because the output snapshot differs.

Copy operations likewise remain explicit in the plan for audit,
authorization, and adapters that support granular operations. Copy is deep by
value and never aliases two loaded fields.

The IR is shape-generic. It contains paths, values, collection operations, and
relationship edges—not domain-specific Card or Field classes. Schema adapters
provide the type information needed to plan and commit a particular model.

## Relationships are loaded Cards and commit as edges

A Card mutation projection must not expose JSON:API relationship records or
expanded related Cards as writable contained JSON. A `linksTo` field evaluates
to a loaded Card (or no Card), and a `linksToMany` field evaluates to an ordered
array of loaded Cards. Reading fields such as `.reviewers[].id` is allowed;
mutating through a linked Card such as `.reviewers[].name = ...` is not.

`card(id)` asks the Card Store to resolve and type-check a Card for assignment.
Ordinary collection syntax operates on the loaded relationship field:

```bxl
// linksTo
.author = card("https://example.com/people/ada");

// linksToMany append and removal
append(.reviewers; card("https://example.com/people/grace"));
del(.reviewers[] | select(.id == "https://example.com/people/grace"));

// The same positional vocabulary used by contained collections
move_item_before(
  .reviewers[] | select(.id == "https://example.com/people/ada");
  .reviewers[] | select(.id == "https://example.com/people/grace")
);
```

A relationship reached through a contained value is written the same way.
A `card(id)` standing inside the object or array a statement writes is resolved
where it stands, at any depth:

```bxl
append(.comments; {body: "Looks right to me", author: card(params("who"))});
```

A link is an edge of the Card rather than a member of the value, so the stored
contained value holds `body` alone and the plan carries a separate relationship
intent at `["comments", 0, "author"]`. A `linksToMany` written this way takes
one marker per edge, and every member of it must be one, because the whole
collection leaves the stored value together.

A marker reads its argument against the input the value expression itself was
handed, so resolution follows the nodes that pass that input straight down and
whose operands flow into the result: object entries, array and comma streams,
the operands of `//`, `+` and `*`, and the branches of an `if`. A `card(id)`
somewhere that re-roots the input — the body of `map`, either side of a pipe —
is refused rather than answered against the wrong value, and so is one in a
condition, which chooses a branch rather than being the value, and one in an
argument read as a plain value, such as an `assert` message or a `reorder_by`
order, which names no Field to relate a Card to.

The argument is read when the program reaches the marker, so a marker in a
branch that is not taken costs nothing:

```bxl
.owner = (card(params("preferred")) // card(params("fallback")));
```

`card(id)` is the only spelling that names a relationship target. A marker is
recognised by an identity the planner mints from a `card(…)` node the program
itself wrote, never by the shape of the value that node produced, so a value a
program assembles to look like a reference is plain JSON: at a relationship Field it is refused as
`relationship-value-required`, and in a slot the Card stores as a value it is
stored as it reads. A program therefore cannot point a link at a Card without
writing `card(…)`, which is what lets declaration lowering, the profile's own
classification and a reader of the program all reason about links from one
vocabulary.

The schema determines whether a selected location is contained data,
`linksTo`, or `linksToMany`. It therefore lowers assignment, append, delete,
insert, and move to relationship intents when the target field is a
relationship. Structured tool-call operations keep explicit `relate`,
`unrelate`, and `move-relation` operation names because this makes their JSON
Schema and authorization intent unambiguous.

The Boxel adapter also exposes inherited Card Info relationships at their
natural readable root label. `Theme = card(id)` compiles to the concrete
`.cardInfo.theme` location and produces a relationship intent at
`["cardInfo", "theme"]`; the snapshot never gains a synthetic `theme` member.
Promoted aliases are derived from FieldDef metadata and skipped when their
label would collide with a real root field.

This surface matches how real Card code works: it reads a `linksToMany` as a
Card array and assigns a new Card array. It intentionally hides the persistence
representation, where a field may serialize as `entryPoints.0`,
`entryPoints.1`, and so on under `relationships`. BXL never asks an LLM to
construct or renumber those keys.

A mutation may not traverse through a relationship and mutate the related
Card. That requires a separate target and authorization decision. A
query-backed `linksToMany` has derived membership and is read-only; callers
must mutate the source Cards or fields that determine its query instead.

```ts
type BxlRelationshipIntent =
  | { op: 'relate'; field: JqPath; cardId: string; index?: number }
  | { op: 'unrelate'; field: JqPath; cardId: string }
  | { op: 'move-relation'; field: JqPath; cardId: string; toIndex: number };

type StructuredRelationshipOperation =
  | {
      id: string;
      op: 'relate';
      target: StructuredTarget;
      cardId: string;
      position?: StructuredPosition;
    }
  | { id: string; op: 'unrelate'; target: StructuredTarget; cardId: string }
  | {
      id: string;
      op: 'move-relation';
      target: StructuredTarget;
      cardId: string;
      position: StructuredPosition;
    };
```

This is the key mechanism for avoiding reprinted relationship subtrees.

## Atomic semantics

Atomic execution has four phases:

1. Parse and profile-validate the complete program.
2. Evaluate every statement against an immutable working snapshot and build
   the complete mutation plan.
3. Validate every target, value, relationship, authorization rule, and final
   Card invariant without committing.
4. Recheck `baseRevision` and commit the plan in one host transaction.

Failure in any phase commits nothing. Per-field type checks are immediate
during planning; cross-field and whole-Card invariants may be deferred until
the complete final snapshot exists. The specification must label which
constraints are immediate and which are deferred.

## Statement transaction semantics

With `transaction: 'statement'`, each complete statement is planned,
validated, revision-checked, and committed before the next statement runs.
Each commit receives the prior statement's result revision as its expected
revision.

All statements share a session identifier and undo group. On failure the
executor stops and returns the last committed statement and revision. Rollback
is an explicit host operation; it is not equivalent to atomic execution and
may itself conflict with later collaborative edits.

For Yjs, every statement should use a distinct transaction with a shared
session origin. The mutation plan's insert/move/reorder intent should map to
granular Yjs operations rather than replacing the complete array.

## Streaming parser contract

A streaming parser has three outcomes: `incomplete`, `complete`, or `invalid`.
It buffers until a top-level statement terminator while tracking strings,
escapes, comments, and nested parentheses/brackets/braces. Semicolons inside a
helper call separate arguments and do not terminate the statement.

Streaming rules:

- a partial statement is never evaluated;
- every streamed statement must end with a top-level semicolon;
- each statement is parsed to an AST before profile validation;
- source locations and canonical source are retained;
- cross-statement lexical bindings are forbidden;
- end-of-stream with a partial statement is an error;
- backpressure bounds buffered source and queued statements.

Regex scanning may be used only as a tokenizer optimization, never as the
security validator. Profile enforcement operates on the parsed BXL AST.

Structured streaming has the same three outcomes but frames fully closed JSON
operation objects inside the `operations` array. The decoder must account for
JSON strings and escapes, reject malformed completed objects, retain an
incomplete tail, and enforce duplicate operation IDs. Both streaming decoders
feed the same ordered planner queue and backpressure limits.

## Idempotency and replay

Every textual statement receives a stable derived identity:

```text
statementId = programId + ordinal + hash(canonicalStatement)
```

Every structured operation uses its explicit operation ID combined with the
program ID and a hash of its canonical operation JSON. An atomic program
additionally has a hash of its canonical complete source or operation list.
The durable commit layer, not only the in-memory stream reader, stores applied
identities. Reusing a program ID with different canonical source is an
`execution-identity-conflict`.

Deduplication gives exactly-once commit within the ledger's retention window.
It does not make a statement such as `.count |= . + 1` semantically idempotent
if its ledger is lost. The API and documentation must keep those concepts
separate.

## Concurrency

`baseRevision` is an optimistic compare-and-swap condition. It is checked
before planning and again immediately before commit.

Version 1 should fail on revision drift. It must not silently re-resolve a
selector against a newer document, because that can change the affected item.
A future explicit rebase mode may replay stable-selector intents, but must
return the rebased plan for review and authorization before commit.

CRDT mergeability does not remove this semantic requirement. Yjs can merge two
operations mechanically while the DML still targeted the wrong logical item.

## Schema and authorization boundary

The compiler may use schema metadata to reject impossible targets early. The
commit adapter remains authoritative and must:

1. Resolve every concrete path to a CardDef/FieldDef or relationship field.
2. Reject computed, derived, immutable, or otherwise read-only targets.
3. Materialize contained values through the declared field type.
4. Validate scalar, compound, collection, and relationship values.
5. Authorize every intent using the actor, old value, new value, and policy
   epoch.
6. Recheck revision and schema version.
7. Commit through normal setters or relationship APIs.
8. Return the resulting revision and committed write set.

Profile validation is not authorization. A syntactically valid mutation never
implies permission to commit it.

## Returning and audit

A successful execution should return more than the final snapshot:

```ts
interface BxlMutationResult {
  plan: BxlMutationPlan;
  committed: boolean;
  baseRevision?: string;
  resultRevision?: string;
  lastCommittedStatement?: number;
  returning: {
    affected: number;
    paths: JqPath[];
    values?: JsonValue[];
  };
}
```

Hosts may omit before/after values from logs when fields are sensitive, but
must retain source hash, actor, target, statement IDs, intent kinds, concrete
paths, policy epoch, schema version, and revisions. An inverse plan is useful
for local undo but is not automatically safe to apply after concurrent edits.

## Restricted BXL subset

Mutation expressions may use deterministic, bounded scalar computation and
ordinary JSON construction. Version 1 forbids:

- user-defined `def` helpers;
- `reduce`, `foreach`, recursive descent, and recursion;
- `try`/`catch` and error masking;
- label/break and format filters;
- volatile calls, runtime metadata, I/O, or side effects;
- authorization-kernel calls;
- dynamic modules or host callbacks;
- multiple output values;
- writes outside the target snapshot;
- writes to a Card root (a Field root may be replaced explicitly).

Canonical mutation source uses only `=` and `|=` assignment operators.
Readable mutation source may use the scalar compound-assignment sugar defined
above; solidification normalizes it to `|=` before profile validation. A
compound operator over a collection or relationship field is rejected so it
cannot disguise whole-collection replacement.

The initial function allowlist should be conservative. Collection-wide
rewrites such as `sort`, `map`, and arbitrary array construction can recreate
the whole-subtree problem and erase move intent; dedicated DML statements are
preferred for structural edits.

## Limits

Implementations must bound source bytes, statements, AST depth, path depth,
selector work, selector matches, expression steps, intents, affected paths,
value bytes, output bytes, buffered stream bytes, queued statements, and wall
time. Limits are applied per statement and per program/session.

Forbidden path segments include `__proto__`, `prototype`, and `constructor`.
Negative/non-integer array indexes and sparse-array creation are invalid.

## Error taxonomy

Errors are structured and include program ID, statement ID/ordinal, source
location, target paths when safe, and phase (`parse`, `plan`, `validate`,
`authorize`, or `commit`). Stable version 1 codes should include:

- `parse-error`, `statement-forbidden`, `construct-forbidden`;
- `function-unsupported`, `expression-cardinality`;
- `target-not-found`, `target-ambiguous`, `target-type`;
- `bulk-target-empty`, `position-invalid`, `source-is-anchor`;
- `order-key-missing`, `order-key-duplicate`, `order-not-permutation`;
- `path-forbidden`, `field-read-only`, `schema-rejected`;
- `relationship-invalid`, `authorization-denied`;
- `revision-conflict`, `schema-version-conflict`;
- `execution-identity-conflict`, `limit-exceeded`;
- `stream-incomplete`, `commit-failed`, `rollback-conflict`;
- `computed-read-only`, `write-through-link`, `snapshot-unavailable`,
  `assert-snapshot-required`, `assert-option-invalid`, `overlay-invalid`.

## Additional use cases covered by this contract

Beyond streaming, atomic edits, and reorder, the profile should support:

- arithmetic updates such as counters, scores, balances, and progress;
- conditional bulk edits with explicit affected cardinality;
- relationship link/unlink/order changes without expanded Card JSON;
- optimistic form submission with compare-and-swap conflict detection;
- previews showing exact affected fields before commit;
- durable replay, audit, and retry of generated edits;
- granular undo/redo and collaborative Yjs operations;
- schema migrations over one Card when run by a separately authorized host;
- command handlers that calculate a bounded mutation plan and then commit it;
- policy checks over the concrete old/new write set.

The same operations must work against arbitrary Field roots. Examples include
replacing a scalar Field, updating one member of a compound Field, splicing or
reordering a collection Field, and linking or reordering a relationship Field.
No operation may rely on a domain-specific shape such as a board, move, section,
or message.

Multi-Card DML is intentionally not part of version 1. It needs a separate
transaction coordinator, authorization fan-out, and failure model.

## Conformance matrix

Tests should cross execution mode with mutation shape, not test each feature in
only one happy path:

| Area              | Required cases                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Streaming         | every byte boundary; strings/comments with semicolons; truncated final statement; retry; backpressure; stop-on-error                                                                                                       |
| Encodings         | structured/text equivalence, streamed JSON objects, streamed statements, canonical plan equality                                                                                                                           |
| Atomic            | all-or-nothing validation; final invariant failure; revision drift before commit; no observable intermediate state                                                                                                         |
| Statement commits | revision chaining; durable dedupe; partial success report; undo grouping; rollback conflict                                                                                                                                |
| Scalar/object     | set, update, replace, delete/null distinction, computed RHS, forbidden Card-root write, allowed Field-root replace                                                                                                         |
| Bulk              | explicit multi-target success, zero matches, deterministic path order, per-target authorization failure                                                                                                                    |
| Insert            | start/end/index/before/after, empty array, invalid index, single-value cardinality                                                                                                                                         |
| Move              | forward/backward, start/end, source-is-anchor, cross-array type validation, concurrent anchor drift                                                                                                                        |
| Reorder           | exact permutation, missing/extra/duplicate keys, primitive arrays, unchanged order no-op                                                                                                                                   |
| Relationships     | loaded linksTo/linksToMany projection, Card Store resolution, singular/plural, duplicate edge, unlink missing edge, ordered edge move, query-backed read-only membership, no related-Card traversal, no raw JSON:API paths |
| Safety            | forbidden constructs, prototype paths, limits, output cardinality, unknown functions                                                                                                                                       |
| Audit             | stable canonical hash, concrete intents, redaction, inverse plan, resulting revision                                                                                                                                       |

Property tests should verify that plan application produces the returned output
snapshot, inverse application restores the base snapshot in isolation, reorder
preserves the exact multiset, and chunking a streaming source at any byte
boundary does not change its parsed statements.

## Implementation status and sequence

Implemented in BXL:

1. The accepted/rejected corpus defines loaded-Card semantics and error codes.
2. `mutation` is a public `BxlProfile`, with deterministic value-expression
   validation.
3. Complete semicolon-framed readable and solidified programs parse into a
   closed mutation statement representation.
4. Assignment, copy, delete, insert, move, reorder, assert, and relationship
   helpers lower to a typed mutation-plan IR.
5. The pure planner evaluates sequentially against a private snapshot,
   enforces exact-one/explicit-bulk cardinality, and supports revision and
   concrete-write authorization hooks.
6. Structured operations and textual statements share the same planner. All
   34 accepted corpus cases pass through both encodings; all 13 rejected
   boundaries are exercised.
7. Relationship intents cover singular/plural relate, unrelate, and ordered
   move while forbidding related-Card traversal and JSON:API storage paths.
8. The stateful stream framer is verified across every two-chunk byte boundary,
   one-character chunks, quoted semicolons, and incomplete tails.
9. The Realm-facing `updateViaBxl` adapter derives Card schema and snapshots,
   resolves relationships through the Card's own store, and applies granular
   intents to one live Card model. Focused tests cover identity preservation,
   relationship edits, authorization-before-write, and setter rollback.

Remaining host and streaming work:

1. Freeze the candidate surface grammar and add source spans after the example
   syntax settles.
2. Connect the single-Card adapter to Boxel Host tool execution and focused
   real-Realm fixtures.
3. Add Yjs/JSON:API Atomic lowering for durable multi-Card Host transactions.
4. Add durable idempotency, audit/inverse records, revision chaining, and
   statement-commit undo grouping in the host.

The profile should not ship as supported merely because assignment nodes pass
AST validation. Source validation, plan lowering, result cardinality, and the
commit contract must land together.
