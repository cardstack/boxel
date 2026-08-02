# Editing Cards Without Rewriting Them

_A hands-on guide to the proposed BXL mutation language_

Suppose you are looking at a loaded invoice Card and want to rename it. You do
not want to download its JSON, reproduce every field, preserve a relationship
subtree you did not mean to touch, and upload the whole thing again. You want
to write the edit you actually mean:

```bxl
.title = "Final";
```

That is the idea behind mutation BXL. It is a small data-manipulation language
for Cards and Fields, shaped like jq and comfortable to write one statement at
a time. The examples in this guide come from the executable
[`bxl-mutation-examples.ts`](../examples/bxl-mutation-examples.ts) corpus. The
surface syntax is still being settled through those examples; it is not yet a
frozen grammar.

## Start with the Card you already have

In a mutation program, `.` means the loaded target. If the target is an Invoice
Card, `.` is that Invoice. If the target is its scalar `score` Field, `.` is the
number itself. It is never the raw JSON:API resource document.

That makes the smallest edits pleasantly unsurprising:

```bxl
.title = "Championship Replay";
.status = "review";
.note = null;
```

Assignment writes one location. Update assignment passes the current value to
the expression on its right:

```bxl
.count |= . + 1;
```

If the target itself is a numeric Field, the same expression becomes:

```bxl
. |= . + 1;
```

Deletion is different from assigning `null`. This keeps an explicit null:

```bxl
.note = null;
```

This removes the member:

```bxl
del(.note);
```

That distinction matters for Card schemas where “missing,” “unknown,” and
“intentionally empty” mean different things.

Every top-level statement ends with a semicolon. Besides making a handwritten
program easy to scan, the terminator tells a streaming executor when it has a
complete statement that can be parsed and planned.

## Select an item the jq way

The useful part of jq is not merely its JSON syntax. It is the way a path can
describe a precise location inside a tree.

Here is a real Classroom-shaped example from the corpus. It finds the 1:00 PM
schedule item and marks its `status` done:

```bxl
(
  .scheduleItems[]
  | select(.time == "1:00 PM")
  | .status
) = "done";
```

The parentheses say, “this whole pipeline is the location I am assigning.”
The mutation planner resolves it to a concrete contained-field path such as
`["scheduleItems", 1, "status"]`. The loaded `staff` and `students`
relationships beside it are untouched.

Update assignment is equally useful for arithmetic:

```bxl
(
  .lineItems[]
  | select(.sku == "COPY-03")
  | .quantity
) |= . + 1;
```

Ordinary assignment and update assignment require exactly one selected
location. If the selector finds nothing, the edit is stale. If it finds two
items, the edit is ambiguous. In either case BXL stops instead of guessing.

## Make bulk intent obvious

Sometimes changing several matches is exactly what you want. Mutation BXL asks
you to say so where a reviewer—and an authorization policy—can see it:

```bxl
update_all(
  .lineItems[] | select(.taxable) | .discount;
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
.subtotal = (.quantity * .unitPrice);
.total = (.subtotal + .shipping);
```

The second statement reads the newly calculated subtotal. In atomic mode the
host still commits both changes together; sequential evaluation does not imply
that intermediate state becomes durable.

When an edit is valid only in a particular state, put the assumption beside
the edit:

```bxl
assert(.status == "draft"; "must still be a draft");
.status = "published";
```

The assertion produces no write. It becomes a checked precondition in the
mutation plan.

## Change collections without reprinting them

Appending a value should not require rebuilding its surrounding array:

```bxl
append(.sections; { id: "summary", title: "Summary" });
```

When placement matters, select a stable anchor:

```bxl
insert_after(
  .sections[] | select(.id == "overview");
  { id: "details", title: "Details" }
);
```

Moving an existing item preserves even more intent:

```bxl
move_before(
  .sections[] | select(.id == "summary");
  .sections[] | select(.id == "round-one")
);
```

This is not implemented as “calculate a new array and replace the old one.”
The plan records a move. A Yjs or Card Store adapter can perform the granular
operation, authorization can see what moved, and undo can reverse it.

For an atomic edit that knows the complete desired order, write the permutation
directly:

```bxl
reorder_by(
  .sections;
  .id;
  ["summary", "overview", "round-one"]
);
```

The order must contain every current identity exactly once. It cannot quietly
drop an item, duplicate one, or introduce a new value.

Indexes are useful in a fixed snapshot, but identities make better handwritten
edits. In particular, progressively committed streams should not use an
ordinary numeric index: another edit could insert an item and make index `1`
mean something different before the statement arrives.

## Let the schema distinguish lists from sets

An ordered list and a set are both arrays when printed as JSON, but they do not
have the same mutation vocabulary. For a schema-declared set collection, use
set intent:

```bxl
add_to_set(.tags; "urgent");
remove_from_set(.tags; "obsolete");
```

Adding a value that is already present is a successful no-op with an affected
count of zero. Positional operations such as `append` are rejected for a set
because “last” has no semantic meaning there.

When the execution target is the `tags` Field itself, the handwritten form is
even smaller:

```bxl
add_to_set(.; "urgent");
```

Compound data can also be copied without reproducing it:

```bxl
copy_to(.billingAddress; .shippingAddress);
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
.winner = card("card:submission/tidal");
```

`card(id)` is not a JSON object constructor. It asks the Card Store to load the
Card and verifies that the relationship field accepts its type.
The corpus uses short `card:` identifiers to keep examples readable; a real
host normally supplies the Card Store's canonical URL-shaped Card ID.

A `linksToMany` uses the same collection vocabulary as contained data:

```bxl
append(.entryPoints; card("card:collab-stage"));
```

Removal selects the loaded Card by identity:

```bxl
del(.entryPoints[] | select(.id == "card:architecture"));
```

And rearrangement remains an ordinary move:

```bxl
move_before(
  .fragments[] | select(.id == "card:fragment/personal-web");
  .fragments[] | select(.id == "card:fragment/opposite-viral")
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

## Stream handwriting without changing its meaning

The language is the same whether it arrives all at once or token by token:

```bxl
.status = "review";
.count |= . + 1;
```

In `streaming` + `statement` mode, the first complete statement may commit
before the second has arrived. In `streaming` + `atomic` mode, both statements
are parsed and planned as they complete, but the host buffers their effects and
commits once at end of stream.

A semicolon inside a string is just text:

```bxl
.note = "keep; this semicolon";
.status = "ready";
```

Only a top-level semicolon frames a statement. An unfinished final statement
is an error and is never partially evaluated.

Transaction and delivery choices belong to the execution envelope rather than
being repeated in every handwritten statement:

```json
{
  "language": "bxl-mutation/1",
  "programId": "review-invoice-42",
  "target": { "kind": "card", "id": "card:invoice-42" },
  "actor": "user:ada",
  "baseRevision": "rev-7",
  "delivery": "streaming",
  "transaction": "atomic",
  "returning": ["changes", "affected", "paths"]
}
```

The revision supplies optimistic concurrency. The program identity supports
durable deduplication. The actor travels with the plan into authorization and
audit. None of those concerns makes the actual edit harder to read.

## The same edit as a tool call

Humans and streamed models write BXL statements. A model using a strict JSON
Schema tool can send structured operations instead. These two inputs express
the same edit:

```bxl
append(.entryPoints; card("card:collab-stage"));
```

```json
{
  "id": "pin-collab-stage",
  "op": "relate",
  "target": { "path": ["entryPoints"] },
  "cardId": "card:collab-stage",
  "position": { "at": "end" }
}
```

Both lower to the same normalized relationship intent. The textual form is
optimized for handwriting and token streaming. The object form is optimized
for tool validation. Neither is allowed to invent different semantics.

## What the host sees before committing

The author writes intent. The planner resolves it into a concrete write set.
For example:

```bxl
.status = "review";
.title = (.title + " — reviewed");
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
| Ordered and set collections | `insert-after-stable-anchor`, `move-before-stable-anchor`, `exact-reorder`, `add-to-set`, `remove-from-set` |
| Loaded Card relationships | `workspace-append-entry-point`, `contest-set-singular-link`, `unrelate-card`, `zine-reorder-linked-fragments` |
| Streaming | `streaming-statement-commits`, `streaming-atomic-semicolon-string` |
| Safety boundaries | every `reject-*` fixture, including raw JSON:API paths, ambiguous selectors, unstable indexes, relationship traversal, and query-backed membership |

Running `npm run example:mutation` checks that each accepted normalized plan
produces its documented after-state and that the corpus retains these design
areas.

## A compact handwriting reference

```bxl
# Set or transform one field
.title = "Final";
.count |= . + 1;

# Preserve null versus remove a member
.note = null;
del(.note);

# Select exactly one nested field
(.items[] | select(.id == $params.id) | .score) |= . + 10;

# Explicitly update every match
update_all(.items[] | select(.done) | .status; "archived");

# Structural collection edits
append(.items; $params.item);
insert_after(.items[] | select(.id == $params.anchorId); $params.item);
move_before(
  .items[] | select(.id == $params.movingId);
  .items[] | select(.id == $params.anchorId)
);
reorder_by(.items; .id; $params.order);

# Set collections
add_to_set(.tags; "urgent");
remove_from_set(.tags; "obsolete");

# Preconditions
assert(.status == "draft"; "must still be a draft");

# Loaded Card relationships
.owner = card($params.ownerId);
append(.reviewers; card($params.reviewerId));
del(.reviewers[] | select(.id == $params.reviewerId));
```

The recurring pattern is simple: select the smallest meaningful location,
write the operation you intend, and let the schema and Card Store preserve the
parts of the model you never mentioned.
