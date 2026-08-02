# BXL Mutation Profile

Status: proposed, example-led contract for `Profile.mutation`

The pre-grammar design corpus is
[`examples/bxl-mutation-examples.ts`](../examples/bxl-mutation-examples.ts).
Its accepted and rejected cases are the current source of truth for candidate
surface syntax. Grammar and AST work should be derived from that corpus after
the examples settle, not used to prematurely freeze it.

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
insert_after(
  .moves[] | select(.id == "move-07");
  { id: "move-08", word: "STREAM", score: 24 }
);
move_before(
  .sections[] | select(.id == "summary");
  .sections[] | select(.id == "round-one")
);
```

The same DML has two equivalent source encodings:

- structured operations, optimized for JSON-schema tool calls; and
- textual BXL statements, optimized for human authoring and token streaming.

Both lower to the same mutation-plan IR and must have identical semantics.

This is a DML, not a persistence API. Evaluation is pure:

```text
snapshot + mutation source + parameters
  -> mutation plan + output snapshot + returning data
```

A trusted host separately authorizes and commits the plan through CardDef and
FieldDef setters, relationship APIs, and the host's transaction mechanism.

The input snapshot is the **loaded Card or Field model exposed by the Card
Store**, not the raw JSON:API card resource document. A relationship field is
therefore observed as a loaded Card or array of loaded Cards. Storage details
such as `relationships["entryPoints.0"].links.self` are not addressable BXL
paths. Only the commit adapter translates relationship intents to that
serialization.

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
  /** Stable principal supplied by the trusted host. */
  actor?: string;
  delivery?: 'complete' | 'streaming';
  transaction?: 'atomic' | 'statement';
  parameters?: Readonly<Record<string, JsonValue>>;
  returning?: ReadonlyArray<'old' | 'new' | 'changes' | 'affected' | 'paths'>;
}
```

Defaults are `delivery: 'complete'` and `transaction: 'atomic'`.

The target defines what `.` means. For a Card target, `.` is the Card's
editable projection. For a Field target, `.` is that Field's own value. The
profile is otherwise independent of CardDef and FieldDef names or shapes.

This produces four meaningful combinations:

| Delivery | Transaction | Meaning |
| --- | --- | --- |
| complete | atomic | Parse, validate, and commit the complete program once. |
| streaming | atomic | Evaluate complete statements into a private preview, then commit once when the stream finishes. |
| streaming | statement | Commit each complete statement independently inside one named undo session. This is the Scrabble-stream behavior. |
| complete | statement | Execute a supplied batch statement by statement; useful for imports and resumable jobs. |

“Streaming” never implies partial-statement execution. “Atomic” never describes
a sequence whose earlier statements have already become durable.

## Statements

Version 1 should support this closed statement set:

| Statement | Meaning | Cardinality |
| --- | --- | --- |
| `location = expression` | Set/upsert a schema-permitted location. | exactly one target |
| `location \|= expression` | Transform an existing value. | exactly one target |
| `replace(location; expression)` | Replace an existing value. | exactly one target |
| `copy_to(source; destination)` | Deep-copy one loaded value to another writable field. | one source, one destination |
| `del(location)` | Delete an existing member or item. | exactly one target |
| `update_all(location; expression)` | Explicit bulk update. | one or more targets |
| `delete_all(location)` | Explicit bulk delete. | one or more targets |
| `add_to_set(collection; expression)` | Add a value if absent from a schema-declared set collection. | one collection, zero or one write |
| `remove_from_set(collection; expression)` | Remove a value from a schema-declared set collection. | one collection, exactly one value |
| `prepend(collection; expression)` | Insert at array start. | one collection, one value |
| `append(collection; expression)` | Insert at array end. | one collection, one value |
| `insert_at(collection; index; expression)` | Insert at a zero-based index. | one collection, one value |
| `insert_before(anchor; expression)` | Insert before a stable array item. | exactly one anchor |
| `insert_after(anchor; expression)` | Insert after a stable array item. | exactly one anchor |
| `move_before(source; anchor)` | Move an item before another. | one source, one anchor |
| `move_after(source; anchor)` | Move an item after another. | one source, one anchor |
| `move_to_start(source; collection)` | Move an item to array start. | one source, one collection |
| `move_to_end(source; collection)` | Move an item to array end. | one source, one collection |
| `reorder_by(collection; key; order)` | Apply an exact key permutation. | one collection |
| `assert(expression; message)` | Add a no-write precondition. | exactly one Boolean |

The strict single-target default is deliberate. jq's implicit multi-location
assignment is concise but dangerous for generated DML. Bulk intent must be
visible in source through `update_all` or `delete_all`, and the result reports
the affected count.

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
  | ({ id: string; op: 'replace'; target: StructuredTarget } & OperationValue)
  | { id: string; op: 'copy'; from: StructuredTarget; target: StructuredTarget }
  | { id: string; op: 'delete'; target: StructuredTarget }
  | ({ id: string; op: 'add-to-set'; target: StructuredTarget } & OperationValue)
  | ({ id: string; op: 'remove-from-set'; target: StructuredTarget } & OperationValue)
  | ({ id: string; op: 'insert'; into: StructuredTarget; position: StructuredPosition } & OperationValue)
  | { id: string; op: 'move'; target: StructuredTarget; into: StructuredTarget; position: StructuredPosition }
  | { id: string; op: 'reorder'; target: StructuredTarget; key: JqPath; order: JsonScalar[] }
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

For streaming JSON tool calls, an executor may accept each fully closed
operation object as it arrives. A partial JSON object is never planned or
committed. Operation IDs are explicit and unique within the program.

Literal structured operations and equivalent textual statements must lower to
the same intent. For example, these are semantically identical:

```json
{ "id": "rename", "op": "set", "target": { "path": ["title"] }, "value": "Final" }
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
semantics. Host parameters are read through a dedicated `$params` binding;
statements cannot bind variables for later statements.

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

Move is a first-class intent. Its normative algorithm is:

1. Resolve source and anchor against the pre-statement snapshot.
2. Require distinct direct array items.
3. Remove the source item.
4. Relocate the resolved anchor in the post-removal destination.
5. Insert immediately before or after the anchor.

For numeric positions, the index is interpreted after source removal. Moving
across collections is permitted only when both fields are writable and the
destination schema accepts the moved value.

### Exact reorder

Relative moves are best for streaming and collaborative editing. Atomic tools
also need a concise way to assert a complete order:

```bxl
reorder_by(.sections; .id; ["overview", "round-one", "summary"])
```

`reorder_by` requires every current item to have one unique JSON-scalar key.
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

Stable selectors should use schema-declared identity fields. For arrays of
objects, an implementation should accept a schema hint such as `id`, `key`, or
another unique field. Numeric indexes are allowed only when one of these is
true:

- the execution carries a matching `baseRevision` and commits atomically; or
- the collection is declared position-addressed by its schema.

Streaming statement commits should reject index-addressed edits to ordinary
ordered collections because a concurrent insert can retarget them.

Selectors are resolved against the current intermediate snapshot, so each
statement observes prior statements. A source and anchor are each resolved
once per statement.

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
  | { op: 'add-to-set'; collection: JqPath; value: JsonValue }
  | { op: 'remove-from-set'; collection: JqPath; value: JsonValue }
  | { op: 'insert'; collection: JqPath; index: number; value: JsonValue }
  | { op: 'move'; from: JqPath; toCollection: JqPath; toIndex: number }
  | { op: 'reorder'; collection: JqPath; keys: JsonScalar[] }
  | BxlRelationshipIntent;
```

Concrete paths are useful for authorization, validation, audit, and UI
highlighting. Intent kinds are necessary for granular Yjs/CRDT operations and
correct undo. Implementations must not collapse array intent to a single
whole-array `set` merely because the output snapshot differs.

Copy and set-collection operations likewise remain explicit in the plan for
audit, authorization, idempotent no-op reporting, and adapters that support
granular operations. Copy is deep by value and never aliases two loaded
fields.

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
move_before(
  .reviewers[] | select(.id == "https://example.com/people/ada");
  .reviewers[] | select(.id == "https://example.com/people/grace")
);
```

The schema determines whether a selected location is contained data,
`linksTo`, or `linksToMany`. It therefore lowers assignment, append, delete,
insert, and move to relationship intents when the target field is a
relationship. Structured tool-call operations keep explicit `relate`,
`unrelate`, and `move-relation` operation names because this makes their JSON
Schema and authorization intent unambiguous.

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
  | { id: string; op: 'relate'; target: StructuredTarget; cardId: string; position?: StructuredPosition }
  | { id: string; op: 'unrelate'; target: StructuredTarget; cardId: string }
  | { id: string; op: 'move-relation'; target: StructuredTarget; cardId: string; position: StructuredPosition };
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

Only `=` and `|=` assignment operators are source syntax. Compound assignment
operators should normalize to `|=` or be rejected in version 1 so their target
and value semantics remain explicit.

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
- `stream-incomplete`, `commit-failed`, `rollback-conflict`.

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

| Area | Required cases |
| --- | --- |
| Streaming | every byte boundary; strings/comments with semicolons; truncated final statement; retry; backpressure; stop-on-error |
| Encodings | structured/text equivalence, streamed JSON objects, streamed statements, canonical plan equality |
| Atomic | all-or-nothing validation; final invariant failure; revision drift before commit; no observable intermediate state |
| Statement commits | revision chaining; durable dedupe; partial success report; undo grouping; rollback conflict |
| Scalar/object | set, update, replace, delete/null distinction, computed RHS, forbidden Card-root write, allowed Field-root replace |
| Bulk | explicit multi-target success, zero matches, deterministic path order, per-target authorization failure |
| Insert | start/end/index/before/after, empty array, invalid index, single-value cardinality |
| Move | forward/backward, start/end, source-is-anchor, cross-array type validation, concurrent anchor drift |
| Reorder | exact permutation, missing/extra/duplicate keys, primitive arrays, unchanged order no-op |
| Relationships | loaded linksTo/linksToMany projection, Card Store resolution, singular/plural, duplicate edge, unlink missing edge, ordered edge move, query-backed read-only membership, no related-Card traversal, no raw JSON:API paths |
| Safety | forbidden constructs, prototype paths, limits, output cardinality, unknown functions |
| Audit | stable canonical hash, concrete intents, redaction, inverse plan, resulting revision |

Property tests should verify that plan application produces the returned output
snapshot, inverse application restores the base snapshot in isolation, reorder
preserves the exact multiset, and chunking a streaming source at any byte
boundary does not change its parsed statements.

## Implementation sequence

1. Expand and review the accepted/rejected example corpus until syntax,
   normalized plans, loaded Card semantics, and error behavior are coherent.
2. Derive the mutation AST and grammar from the accepted corpus.
3. Add `mutation` to `BxlProfile` and implement AST-based source validation.
4. Add a real incremental statement parser with canonical source and spans.
5. Lower assignment and structural helpers to a closed mutation-plan IR.
6. Implement the pure planner/evaluator and conformance tests.
7. Define a host-neutral commit-adapter interface and an in-memory reference
   adapter.
8. Port both the Scrabble structured tool-call flow and textual statement flow
   to the package API and verify byte-boundary streaming plus canonical-plan
   equivalence and granular move/reorder intent.
9. Add the Boxel CardDef/FieldDef/Card Store/Yjs adapter in the Boxel
   integration layer.
10. Add relationship intents, authorization integration, and audit records.

The profile should not ship as supported merely because assignment nodes pass
AST validation. Source validation, plan lowering, result cardinality, and the
commit contract must land together.
