# Editing Cards Without Rewriting Them

_A hands-on guide to the proposed BXL mutation language_

Suppose you are looking at a loaded invoice Card and want to rename it. You do
not want to download its JSON, reproduce every field, preserve a relationship
subtree you did not mean to touch, and upload the whole thing again. You want
to write the edit you actually mean:

```bxl
Title = "Final";
```

That is the idea behind mutation BXL. It is a small data-manipulation language
for Cards and Fields, shaped like jq and comfortable to write one statement at
a time. The examples in this guide come from the executable
[`bxl-mutation-examples.ts`](../examples/bxl-mutation-examples.ts) corpus. The
surface syntax is still being settled through those examples; it is not yet a
frozen grammar.

Readable calls use Excel-style commas, such as
`move_item_before(item, anchor)`. The readable compiler solidifies them to
canonical jq calls with semicolons. A final semicolon terminates the mutation
statement; it is not an argument separator in handwritten BXL.

## Start with the Card you already have

In a mutation program, `.` means the loaded target. If the target is an Invoice
Card, `.` is that Invoice. If the target is its scalar `score` Field, `.` is the
number itself. It is never the raw JSON:API resource document.

That makes the smallest edits pleasantly unsurprising:

```bxl
Title = "Championship Replay";
Status = "review";
Note = null;
```

The mutation profile gives top-level `Label = value;` statement shape the
meaning “assign this field.” Inside a predicate or `assert`, readable `=` keeps
its established comparison meaning.

Assignment writes one location. Update assignment passes the current value to
the expression on its right. Readable compound assignment is usually nicer for
a small arithmetic change:

```bxl
Count += 1;
```

The readable compiler solidifies that to canonical update assignment:

```bxl
.count |= . + 1;
```

If the target itself is a numeric Field, the same expression becomes:

```bxl
. += 1;
```

Deletion is different from assigning `null`. This keeps an explicit null:

```bxl
Note = null;
```

This removes the member:

```bxl
del(Note);
```

That distinction matters for Card schemas where “missing,” “unknown,” and
“intentionally empty” mean different things.

Every top-level statement ends with a semicolon. Besides making a handwritten
program easy to scan, the terminator tells a streaming executor when it has a
complete statement that can be parsed and planned.

## Select a row by what it says

BXL readable syntax lets a person use the labels printed by the Card rather
than its internal camelCase paths. Predicates retain jq's ability to describe a
precise location inside a tree.

Here is a real Classroom-shaped example from the corpus. It finds the 1:00 PM
schedule item and marks its `status` done:

```bxl
"Schedule Item"[Time = "1:00 PM"].Status = "done";
```

The readable compiler uses the Card schema to resolve “Schedule Item,” “Time,”
and “Status.” The mutation planner then resolves a concrete contained-field
path such as `["scheduleItems", 1, "status"]`. The loaded `staff` and
`students` relationships beside it are untouched.

Update assignment is equally useful for arithmetic:

```bxl
"Line Item"[SKU = "COPY-03"].Quantity += 1;
```

That handwritten statement solidifies to the canonical jq-shaped mutation:

```bxl
(
  .lineItems[]
  | select(.sku == "COPY-03")
  | .quantity
) |= . + 1;
```

Readable mutation predicates need one important profile-specific rule. In an
ordinary value expression, `[predicate]` means “give me the first match.” In a
mutation location it means “resolve this predicate and require exactly one
match.” The compiler must preserve the selector until cardinality validation;
it must not hide ambiguity by lowering through `first(...)`.

Ordinary assignment and update assignment require exactly one selected
location. If the selector finds nothing, the edit is stale. If it finds two
items, the edit is ambiguous. In either case BXL stops instead of guessing.

## Make bulk intent obvious

Sometimes changing several matches is exactly what you want. Mutation BXL asks
you to say so where a reviewer—and an authorization policy—can see it:

```bxl
update_all(
  "Line Item"[* Taxable].Discount,
  . + 0.05
);
```

The first argument selects every writable discount. The second expression runs
against each selected value. This is deliberately different from hiding a
multi-location write inside ordinary jq assignment.

An empty explicit bulk selection is still an error by default. A stale filter
should not make a migration or generated tool call appear successful.

## Write calculations in reading order

Statements observe the output of earlier statements. A recalculation can
therefore read like the steps a person would write on paper:

```bxl
Subtotal = (Quantity * "Unit Price");
Total = (Subtotal + Shipping);
```

The second statement reads the newly calculated subtotal. In atomic mode the
host still commits both changes together; sequential evaluation does not imply
that intermediate state becomes durable.

When an edit is valid only in a particular state, put the assumption beside
the edit:

```bxl
assert(Status = "draft", "must still be a draft");
Status = "published";
```

The assertion produces no write. It becomes a checked precondition in the
mutation plan.

## Change collections without reprinting them

Appending a value should not require rebuilding its surrounding array. When
the Card schema labels its collection “Section,” a person can keep using that
label throughout the structural vocabulary:

```bxl
append(Section, { id: "summary", title: "Summary" });
```

When placement matters, select a stable anchor:

```bxl
insert_after(
  Section[ID = "overview"],
  { id: "details", title: "Details" }
);
```

Moving an existing item preserves even more intent:

```bxl
move_item_before(
  Section[ID = "summary"],
  Section[ID = "round-one"]
);
```

The first argument is the item being moved. The second is the positional
anchor, so this reads “move summary immediately before round-one.” Both
selectors must resolve to exactly one item. BXL does not silently choose the
first match when an ID or another selector is duplicated.

Sometimes the field that identifies an item lives deeper than the item you
want to move. Keep the outer item as the operand and nest the identifying
predicate inside it:

```bxl
move_item_before(
  Product[Variants[SKU = "COPY-03"]],
  Product[ID = "featured"]
);
```

This moves the whole Product that contains a matching Variant. It does not
move the Variant. The canonical jq-shaped selector makes that existential
test explicit:

```bxl
move_item_before(
  .products[] | select(any(.variants[]; .sku == "COPY-03"));
  .products[] | select(.id == "featured")
);
```

Nested matches are collapsed to an existence test for their outer item. Two
matching Variants inside one Product still select one Product; two matching
Products make the move ambiguous and reject it. To move a nested Variant
instead, make `Variant[...]` the first operand.

This is not implemented as “calculate a new array and replace the old one.”
The plan records a move. A Yjs or Card Store adapter can perform the granular
operation, authorization can see what moved, and undo can reverse it.

For an atomic edit that knows the complete desired order, write the permutation
directly:

```bxl
reorder_by(
  Section,
  ID,
  ["summary", "overview", "round-one"]
);
```

The order must contain every current identity exactly once. It cannot quietly
drop an item, duplicate one, or introduce a new value.

Indexes are useful in a fixed snapshot, but identities make better handwritten
edits. In particular, progressively committed streams should not use an
ordinary numeric index: another edit could insert an item and make index `1`
mean something different before the statement arrives.

## Follow the collection the Field already exposes

Mutation BXL does not add a separate collection schema on top of CardDef and
FieldDef. A `containsMany` already behaves as an ordered array, so use the
ordinary array vocabulary:

```bxl
append(Tag, "urgent");
del(Tag[. = "obsolete"]);
```

Repeated values are possible because `containsMany` does not promise set
membership. The delete above must select exactly one item; if the collection
contains several matching values, use `delete_all` to make the bulk intent
explicit.

This is particularly important for complex FieldDefs. A contained Field has
no intrinsic Card ID, and the mutation language should not invent identity by
hashing its serialized JSON. Select it using the fields a person naturally
uses in that Card shape:

```bxl
del("Line Item"[SKU = "COPY-03"]);
```

`linksToMany` is also ordered, but its members are loaded Cards. There the
Card's ID is naturally available for selection, and the Card Store turns the
array edit into a relationship edit. If Boxel later gains a keyed or hash-map
relationship, mutation BXL can add the operations that field naturally
supports then.

Compound data can also be copied without reproducing it:

```bxl
copy_to("Billing Address", "Shipping Address");
```

Copy is deep by value. Later changes to the shipping address do not mutate the
billing address.

## Treat links as loaded Cards

This is where the loaded-model boundary pays off most.

On disk, a Boxel `linksToMany` can be serialized under relationship keys such
as `entryPoints.0`, `entryPoints.1`, and `entryPoints.2`. A person should never
have to manufacture or renumber those keys. When loaded through the Card Store,
the same field is simply an ordered array of Cards.

To set a singular `linksTo`, resolve a Card by identity:

```bxl
Winner = card("card:submission/tidal");
```

`card(id)` is not a JSON object constructor. It asks the Card Store to load the
Card and verifies that the relationship field accepts its type.
The corpus uses short `card:` identifiers to keep examples readable; a real
host normally supplies the Card Store's canonical URL-shaped Card ID.

A `linksToMany` uses the same collection vocabulary as contained data:

```bxl
append("Entry Point", card("card:collab-stage"));
```

Removal selects the loaded Card by identity:

```bxl
del("Entry Point"[ID = "card:architecture"]);
```

And rearrangement remains an ordinary move:

```bxl
move_item_before(
  Fragment[ID = "card:fragment/personal-web"],
  Fragment[ID = "card:fragment/opposite-viral"]
);
```

The surface syntax stays consistent, but schema-directed lowering preserves
the difference. The first collection examples become contained `insert`,
`delete`, and `move` intents. Relationship examples become `relate`,
`unrelate`, and `move-relation` intents that the Card Store adapter commits as
edges.

Two boundaries keep this safe:

- You may inspect a linked Card to select the edge, but you may not mutate
  through it. Changing `.reviewers[].name` requires targeting that Person Card
  separately.
- A query-backed `linksToMany` is derived membership. It is readable but not
  assignable; change the Cards or fields that feed its query instead.

Raw persistence paths are never part of the language:

```bxl
# Rejected: this is JSON:API storage, not the loaded Workspace model
.relationships["entryPoints.1"].links.self = "./some-card";
```

## Let an AI stream the same handwriting

An AI does not have to wait for a complete replacement Card—or even a
complete mutation program—before the host can understand its intent. It can
stream the same readable BXL a person would write:

```bxl
Status = "review";
Count += 1;
```

Token boundaries have no semantic meaning. A model might happen to deliver the
program in these chunks:

| Arriving text | Decoder result | Host action |
| --- | --- | --- |
| `Status = "rev` | Incomplete | Buffer; do not evaluate anything. |
| `iew";\nCount ` | One complete statement, plus an incomplete tail | Solidify `Status` to `.status`, parse it, and produce its plan. |
| `+= ` | Incomplete tail | Keep buffering the second statement. |
| `1;` | Second complete statement | Solidify the compound assignment and produce its plan. |

The framing rule is intentionally small: only a top-level semicolon completes
a statement. The decoder still tracks quoted strings, escapes, comments, and
nested brackets. A semicolon inside a string is just text, so this remains two
statements rather than three fragments:

```bxl
Note = "keep; this semicolon";
Status = "ready";
```

Only a top-level semicolon frames a statement. An unfinished final statement
is an error and is never partially evaluated.

### Choose progressive or atomic AI edits

For a live interaction—such as the Scrabble stream in the prototype—the host
can use `delivery: "streaming"` with `transaction: "statement"`. As soon as the
AI finishes `Status = "review";`, that statement is schema-checked,
authorized, revision-checked, and committed. The next statement sees the first
statement's result and revision. All commits share an undo session, but a later
failure does not silently roll back edits already shown to collaborators.

For a change that must never be observed half-finished, use streaming delivery
with an atomic transaction. The host can still parse, validate, plan, and show
a preview as each AI-written statement completes. It evaluates later
statements against the private working result of earlier ones, then performs
one final authorization, revision check, and commit at end of stream. A
truncated or invalid stream commits nothing.

Transaction and delivery choices belong to the execution envelope rather than
being repeated in every AI-written statement:

```json
{
  "language": "bxl-mutation/1",
  "programId": "review-invoice-42",
  "target": { "kind": "card", "id": "card:invoice-42" },
  "actor": "user:ada",
  "baseRevision": "rev-7",
  "delivery": "streaming",
  "transaction": "atomic",
  "syntax": "readable",
  "returning": ["changes", "affected", "paths"]
}
```

The revision supplies optimistic concurrency. The program identity supports
durable deduplication. The actor travels with the plan into authorization and
audit. The trusted host supplies the actor and authoritative target/revision
context; they are not claims the model gets to make about itself. None of
those concerns makes the actual edit harder to read.

## Let an AI make a schema-constrained tool call

Some AI integrations work better when the model calls a strict JSON Schema
tool instead of emitting source text. Suppose the user asks, “Pin the
Collaboration Stage at the end of this workspace.” The human-readable version
of that request is:

```bxl
append("Entry Point", card("card:collab-stage"));
```

An illustrative `mutate_card` tool call written by the AI is:

```json
{
  "language": "bxl-mutation-ops/1",
  "programId": "pin-collab-stage-01",
  "target": { "kind": "card", "id": "card:workspace" },
  "baseRevision": "rev-18",
  "delivery": "complete",
  "transaction": "atomic",
  "operations": [
    {
      "id": "pin-collab-stage",
      "op": "relate",
      "target": { "path": ["entryPoints"] },
      "cardId": "card:collab-stage",
      "position": { "at": "end" }
    }
  ]
}
```

The model names the logical Card field and the linked Card ID. It does not
manufacture a loaded Card object, an `entryPoints.2` storage key, or a
JSON:API relationship record. The Card Store resolves the ID and the schema
tells the planner that this is a `linksToMany`, so the operation lowers to a
single normalized `relate` intent.

The structured form also handles several atomic edits without reprinting the
Card. For “send this invoice to review and increment its attempt count,” an AI
can call the same tool with:

```json
{
  "language": "bxl-mutation-ops/1",
  "programId": "review-invoice-42",
  "target": { "kind": "card", "id": "card:invoice-42" },
  "baseRevision": "rev-7",
  "delivery": "complete",
  "transaction": "atomic",
  "operations": [
    {
      "id": "set-review",
      "op": "set",
      "target": { "path": ["status"] },
      "value": "review"
    },
    {
      "id": "increment-attempts",
      "op": "update",
      "target": { "path": ["count"] },
      "expression": ". + 1"
    }
  ]
}
```

That is semantically identical to `Status = "review"; Count += 1;`. The tool
schema catches misspelled operation shapes and missing IDs before planning;
the mutation profile, Card schema, authorization profile, and revision check
still decide whether the requested writes are valid. JSON Schema validation is
not authorization.

Tool-call arguments may themselves arrive as a JSON stream. A decoder can
queue each fully closed operation object, but never plans a partial JSON
object. With an atomic transaction, queued operations still commit together
only after the complete tool call is valid. Operation IDs make retry and
deduplication explicit.

Both encodings lower to the same normalized plan. The textual form is
optimized for readable handwriting, token streaming, and replay. The object
form is optimized for tool validation and direct construction. Neither is
allowed to invent different mutation semantics.

## Pick the AI interface for the interaction

| Interaction | Suggested encoding | Why |
| --- | --- | --- |
| A chat assistant visibly edits a Card as it talks | Readable BXL, streaming + statement | Each finished statement can update the UI immediately. |
| An AI drafts a multi-field change for approval | Readable BXL, streaming + atomic | The host can preview incrementally and commit all-or-nothing. |
| A model has a strict mutation tool | Structured operations, complete + atomic | JSON Schema constrains operation shapes and literal values. |
| A long tool call is delivered incrementally | Structured operations, streaming + atomic | Closed operations can be planned early without exposing a partial commit. |

The executable cases `streaming-statement-commits`,
`streaming-atomic-semicolon-string`, and `workspace-append-entry-point` in the
fixture corpus cover these paths. Rejected fixtures also pin down incomplete
streams and duplicate operation IDs, so these examples are conformance
requirements rather than presentation-only syntax.

## What the host sees before committing

The author writes intent. The planner resolves it into a concrete write set.
For example:

```bxl
Status = "review";
Title = (Title + " — reviewed");
```

may plan as:

```json
[
  {
    "op": "set",
    "path": ["status"],
    "before": "draft",
    "after": "review"
  },
  {
    "op": "set",
    "path": ["title"],
    "before": "Quarterly report",
    "after": "Quarterly report — reviewed"
  }
]
```

That is the boundary where the host validates schema, checks the revision,
authorizes every old/new value, and commits through CardDef, FieldDef, and
relationship APIs. A valid expression describes a possible edit; it never
grants permission to make it.

## Follow the examples into the corpus

The guide's examples are backed by accepted fixtures rather than illustrative
syntax alone:

| Theme | Corpus cases |
| --- | --- |
| Small field edits | `field-root-update`, `assign-null`, `delete-member`, `copy-compound-field` |
| Selection and bulk changes | `classroom-update-contained-schedule`, `exact-one-selected-update`, `explicit-bulk-update` |
| Evaluation order | `sequential-statement-evaluation`, `assert-then-update` |
| Ordered collections | `append-contained-value`, `delete-contained-value`, `insert-after-stable-anchor`, `move-before-stable-anchor`, `exact-reorder` |
| Loaded Card relationships | `workspace-append-entry-point`, `contest-set-singular-link`, `unrelate-card`, `zine-reorder-linked-fragments` |
| Streaming | `streaming-statement-commits`, `streaming-atomic-semicolon-string` |
| Safety boundaries | every `reject-*` fixture, including raw JSON:API paths, ambiguous selectors, unstable indexes, relationship traversal, and query-backed membership |

Running `npm run example:mutation` checks that each accepted normalized plan
produces its documented after-state and that the corpus retains these design
areas.

## A compact handwriting reference

```bxl
# Set or transform one field
Title = "Final";
Count += 1;

# Preserve null versus remove a member
Note = null;
del(Note);

# Select exactly one nested field
Item[ID = $params.id].Score += 10;

# Explicitly update every match
update_all(Item[* Done].Status, "archived");

# Structural collection edits
append(Item, $params.item);
insert_after(Item[ID = $params.anchorId], $params.item);
move_item_before(
  Item[ID = $params.movingId],
  Item[ID = $params.anchorId]
);
# Select and move an enclosing item by a nested field
move_item_before(
  Product[Variants[SKU = $params.sku]],
  Product[ID = $params.anchorId]
);
reorder_by(Item, ID, $params.order);

# Contained collections preserve their natural order
append(Tag, "urgent");
del(Tag[. = "obsolete"]);

# Preconditions
assert(Status = "draft", "must still be a draft");

# Loaded Card relationships
Owner = card($params.ownerId);
append(Reviewer, card($params.reviewerId));
del(Reviewer[ID = $params.reviewerId]);
```

The recurring pattern is simple: select the smallest meaningful location,
write the operation you intend, and let the schema and Card Store preserve the
parts of the model you never mentioned.
