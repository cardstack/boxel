# Five mutation technologies against the BXL corpus

_A pre-grammar comparison of BXL Mutation, XQuery Update, PostgreSQL JSONB,
JSON:API Atomic Operations, and MongoDB updates_

The mutation runner asks for more than partial JSON replacement. It exercises
schema-known selection, exact-one and explicit-bulk cardinality, ordered
structure, loaded Card relationships, atomic and streamed execution,
revision checks, authorization, and a normalized write set. This comparison
uses those corpus requirements rather than comparing only scalar assignment.

The five technologies are:

1. **BXL Mutation**, using the readable source in the fixture corpus.
2. **XQuery Update Facility**, the closest mature tree-update language.
3. **PostgreSQL JSONB DML**, using `UPDATE`, JSONB functions, JSONPath,
   `RETURNING`, and `ON CONFLICT`.
4. **JSON:API Atomic Operations**, Boxel's closest likely wire format, using
   ordered atomic `add`, `update`, and `remove` operations.
5. **MongoDB updates**, including operators, `arrayFilters`, and update
   pipelines.

XQuery Update 3.0 is a W3C Working Group Note; XQuery Update 1.0 is the W3C
Recommendation. The insert, delete, and replace forms used here are shared.
The 3.0 document is cited because it integrates the XQuery 3.0 grammar and
clearly specifies pending update lists and snapshots.

## Overall scorecard

Scores run from 1 (poor) to 10 (excellent) and cover the complete corpus, not
a hello-world update. They are design-review judgments, not yet an empirical
LLM benchmark.

| Technology | Human understanding | Human writing | AI understanding | AI writing | Corpus-level assessment |
| --- | ---: | ---: | ---: | ---: | --- |
| BXL Mutation | 9 | 9 | 8 | 8 | Best expression of Card-shaped intent. Exact-one and Card Store semantics help, but readable Mutation BXL is new syntax that models have not seen directly in training. |
| XQuery Update | 6 | 4 | 6 | 5 | Strong precedent for tree updates, relative insertion, pending plans, and snapshots. XML constructors and XPath verbosity make routine edits heavy. |
| PostgreSQL JSONB | 5 | 3 | 7 | 5 | Excellent transaction, predicate, upsert, and returning semantics. JSONB mutation needs concrete text-array paths and often reconstructs nested arrays. |
| JSON:API Atomic Operations | 8 | 6 | 9 | 8 | Best wire envelope: ordered operations, atomic failure, resource/relationship refs, and positional results. It is not an expression language and has no native move, predicate, assertion, or contained-field path. |
| MongoDB updates | 5 | 4 | 7 | 6 | Mature atomic document updates. Positional `$`, split `arrayFilters`, and aggregation rewrites make nested structure difficult. |

The opportunity for BXL is to combine XQuery's explicit structural verbs,
SQL's execution envelope, JSON:API Atomic Operations' standard wire contract,
and MongoDB's document atomicity while addressing the loaded Card model
instead of raw persistence paths.

The likely layering is:

```text
human BXL or AI tool call
  -> evaluate against loaded CardDef/FieldDef models
  -> normalized leaf, structural, and relationship intents
  -> authorize the complete concrete write set
  -> JSON:API Atomic Operations request/response envelope
  -> Card Store commit backed by PostgreSQL JSONB
```

This keeps three concerns distinct. XQuery inspires the mutation semantics;
JSON:API Atomic Operations carries ordered all-or-nothing work across the
wire; PostgreSQL supplies indexed search and durable transactions. Mutation
BXL should not expose either JSON:API serialization paths or JSONB text-array
paths to the author.

## Shared comparison model

The examples use a Card with `lineItems`, `sections`, and `reviewers`.
PostgreSQL stores the Card in a `cards(id, revision, document jsonb)` row.
MongoDB stores it as a document. JSON:API Atomic Operations addresses Card
resources and relationships at the wire boundary. XQuery examples assume an XML view such as
`$card/lineItems/lineItem/quantity`; that XML view is only a comparison aid.

## 1. Exactly one selected nested field

Corpus cases: `exact-one-selected-update` and
`classroom-update-contained-schedule`.

| Technology | Equivalent |
| --- | --- |
| BXL | `"Line Item"[SKU = "COPY-03"].Quantity += 1;` |
| XQuery Update | `let $q := $card/lineItems/lineItem[sku = "COPY-03"]/quantity return replace value of node $q with xs:integer($q) + 1` |
| PostgreSQL JSONB | `UPDATE cards SET document = jsonb_set(document, '{lineItems,0,quantity}', to_jsonb((document #>> '{lineItems,0,quantity}')::int + 1)) WHERE id = 'invoice-1' AND document #>> '{lineItems,0,sku}' = 'COPY-03';` |
| JSON:API Atomic Operations | `update` the Card resource with a precomputed `attributes.lineItems` value. A contained Line Item is not independently targetable by `ref`, and Atomic Operations cannot express `+ 1`. |
| MongoDB | `db.cards.updateOne({_id: "invoice-1", "lineItems.sku": "COPY-03"}, {$inc: {"lineItems.$.quantity": 1}})` |

| Technology | Human understanding | Human writing | AI understanding | AI writing | Key difference |
| --- | ---: | ---: | ---: | ---: | --- |
| BXL | 10 | 10 | 9 | 9 | The selector must resolve to exactly one loaded-model location. |
| XQuery Update | 7 | 5 | 7 | 6 | Replace takes a singleton node, but the XML node model is exposed. |
| PostgreSQL JSONB | 5 | 3 | 7 | 5 | The writable function takes a numeric path; JSONPath predicates do not become writable references. |
| JSON:API Atomic Operations | 7 | 5 | 9 | 7 | The envelope is clear, but a contained nested change normally reprints its containing JSON:API attribute value. |
| MongoDB | 6 | 5 | 8 | 7 | Positional `$` means first match, not exactly one. |

This supports BXL's strict rule: an ordinary mutation never silently chooses
the first match and never silently writes all matches. Zero matches are stale;
multiple matches are ambiguous.

## 2. Explicit bulk update

Corpus cases: `explicit-bulk-update`, `reject-ambiguous-single-target`, and
`reject-empty-bulk-target`.

**BXL Mutation**

```bxl
update_all(
  "Line Item"[* Taxable].Discount,
  . + 0.05
);
```

**XQuery Update**

```xquery
for $discount in $card/lineItems/lineItem[taxable = true()]/discount
return replace value of node $discount
       with xs:decimal($discount) + 0.05
```

**PostgreSQL JSONB**

```sql
UPDATE cards
SET document = jsonb_set(
  document,
  '{lineItems}',
  (
    SELECT jsonb_agg(
      CASE WHEN (item->>'taxable')::boolean
        THEN jsonb_set(
          item,
          '{discount}',
          to_jsonb((item->>'discount')::numeric + 0.05)
        )
        ELSE item
      END
      ORDER BY ordinal
    )
    FROM jsonb_array_elements(document->'lineItems')
         WITH ORDINALITY AS line_item(item, ordinal)
  )
)
WHERE id = 'invoice-1'
  AND document @? '$.lineItems[*] ? (@.taxable == true)';
```

**MongoDB**

```javascript
db.cards.updateOne(
  { _id: "invoice-1" },
  { $inc: { "lineItems.$[item].discount": 0.05 } },
  { arrayFilters: [{ "item.taxable": true }] }
)
```

**JSON:API Atomic Operations**

```json
{
  "atomic:operations": [{
    "op": "update",
    "ref": { "type": "cards", "id": "invoice-1" },
    "data": {
      "type": "cards",
      "id": "invoice-1",
      "attributes": {
        "lineItems": "<the complete newly calculated contained value>"
      }
    }
  }]
}
```

Atomic Operations supplies the correct transaction envelope, but not a
predicate, arithmetic expression, or independently addressable contained
field. Without a Boxel lowering layer, the client must calculate and resend
the containing attribute value.

| Technology | Human understanding | Human writing | AI understanding | AI writing | Key difference |
| --- | ---: | ---: | ---: | ---: | --- |
| BXL | 9 | 9 | 9 | 9 | Bulk intent is explicit and requires at least one target. |
| XQuery Update | 7 | 5 | 7 | 6 | Iteration exposes multiplicity; an empty sequence normally does nothing. |
| PostgreSQL JSONB | 4 | 2 | 5 | 3 | The array is reconstructed; a separate `WHERE` clause is needed to reject an empty match. |
| JSON:API Atomic Operations | 6 | 3 | 8 | 5 | Strong atomic wrapper; the standard operations cannot describe a predicate-driven contained-field bulk update. |
| MongoDB | 5 | 4 | 7 | 6 | Capable but the selector is separated into `arrayFilters`; zero matches can look successful. |

## 3. Relative move and deep evidence

Corpus cases: `move-before-stable-anchor`, `exact-reorder`,
`reject-streaming-numeric-position`, `reject-source-is-anchor`, and
`reject-non-permutation-reorder`.

**BXL Mutation**

```bxl
move_item_before(
  Section[ID = "summary"],
  Section[ID = "round-one"]
);
```

The first operand is the item being moved. The second is the positional
anchor. Both are exact-one selectors.

**XQuery Update**

```xquery
let $item := $card/sections/section[@id = "summary"],
    $anchor := $card/sections/section[@id = "round-one"]
return (
  insert node $item before $anchor,
  delete node $item
)
```

XQuery insertion copies its source before deletion removes the original. The
resulting order is equivalent, but the pending update list does not carry a
first-class move intent preserving the original node identity.

**PostgreSQL JSONB, after resolving the two indexes**

```sql
UPDATE cards
SET document = jsonb_insert(
  document #- '{sections,2}',
  '{sections,1}',
  document #> '{sections,2}'
)
WHERE id = 'card-1'
  AND document #>> '{sections,2,id}' = 'summary'
  AND document #>> '{sections,1,id}' = 'round-one';
```

**MongoDB**

MongoDB has no native relative move operator. An update pipeline must find the
item, filter it out, and reduce or concatenate a newly ordered array. That
preserves single-document atomicity but expresses the change as a whole-array
replacement.

**JSON:API Atomic Operations**

```json
{
  "atomic:operations": [{
    "op": "update",
    "ref": { "type": "cards", "id": "card-1" },
    "data": {
      "type": "cards",
      "id": "card-1",
      "attributes": {
        "sections": "<the complete reordered contained value>"
      }
    }
  }]
}
```

Atomic Operations has no `move` operation. A contained collection must be
sent as updated resource data. A to-many relationship can be replaced with an
`update` operation, but base JSON:API deliberately does not assign universal
meaning to the order of resource identifier objects in linkage arrays.

| Technology | Human understanding | Human writing | AI understanding | AI writing | Key difference |
| --- | ---: | ---: | ---: | ---: | --- |
| BXL | 10 | 9 | 9 | 9 | Stable selectors plus a preserved move intent. |
| XQuery Update | 8 | 6 | 7 | 6 | Excellent `before` wording; move is simulated by insert-copy plus delete. |
| PostgreSQL JSONB | 5 | 3 | 7 | 5 | Compact only after numeric paths have been resolved; the JSONB value is replaced. |
| JSON:API Atomic Operations | 5 | 3 | 8 | 5 | Excellent atomic envelope, but no standard move and no portable ordered-relationship semantics. |
| MongoDB | 2 | 1 | 4 | 3 | Requires a whole-array aggregation program. |

The descendant-selection case has an especially strong XPath precedent:

| Technology | “Select the Product containing SKU COPY-03” |
| --- | --- |
| BXL | `Product[Variants[SKU = "COPY-03"]]` |
| XQuery | `$catalog/products/product[variants/variant/sku = "COPY-03"]` |
| PostgreSQL JSONB | JSONPath can query `$.products[*] ? (exists(@.variants[*] ? (@.sku == "COPY-03")))`, but a write still needs the Product's numeric path. |
| JSON:API Atomic Operations | No contained-item predicate selector. The planner must resolve the Product and lower the resulting Card update to the wire operation. |
| MongoDB | A query can use `$elemMatch`; moving the enclosing Product still needs an array rewrite. |

The predicate stays attached to the outer Product step. Several matching
Variants in one Product still select one Product; several matching Products
are ambiguous. To move a Variant, make `Variant[...]` the move operand.

## 4. Loaded Card relationships

Corpus cases: `relate-card`, `unrelate-card`, `move-relationship`,
`workspace-append-entry-point`, `contest-set-singular-link`,
`zine-reorder-linked-fragments`, `reject-related-card-traversal`,
`reject-jsonapi-relationship-path`, and `reject-query-backed-links-to-many`.

| Technology | Equivalent relationship edit |
| --- | --- |
| BXL | `append(Reviewer, card("card:grace"));` and `del(Reviewer[ID = "card:ada"]);` |
| XQuery Update | By application convention: `insert node <reviewer ref="card:grace"/> as last into $card/reviewers`; `delete node $card/reviewers/reviewer[@ref = "card:ada"]` |
| PostgreSQL JSONB | `UPDATE cards SET document = jsonb_insert(document, '{reviewers,999999}', '{"id":"card:grace"}') ...`; removal needs a resolved index or array reconstruction. |
| JSON:API Atomic Operations | `add` or `remove` with `ref: {type: "cards", id: "review-1", relationship: "reviewers"}` and `data: [{type: "cards", id: "card:grace"}]`. This is the closest direct wire equivalent. |
| MongoDB | `$push: {reviewers: {id: "card:grace"}}`; `$pull: {reviewers: {id: "card:ada"}}` |

| Technology | Human understanding | Human writing | AI understanding | AI writing | Key difference |
| --- | ---: | ---: | ---: | ---: | --- |
| BXL | 9 | 9 | 9 | 9 | `card(id)` resolves and type-checks through the Card Store, then lowers to relationship-edge intents. |
| XQuery Update | 7 | 5 | 7 | 6 | XML can model link elements, but loaded Card and edge semantics are application-defined. |
| PostgreSQL JSONB | 4 | 3 | 7 | 5 | Operates on the stored representation and has no CardDef compatibility boundary. |
| JSON:API Atomic Operations | 9 | 8 | 9 | 9 | Direct standard mapping for add/remove/replace relationship membership; ordered move still needs Boxel semantics. |
| MongoDB | 6 | 5 | 8 | 7 | Natural for stored references, but query-backed membership and loaded Cards are application concerns. |

JSON:API Atomic Operations aligns closely with the normalized `relate`,
`unrelate`, and singular relationship-set intents. It still does not provide
the loaded Card Store's resolution and CardDef type check; those remain
schema-directed BXL semantics rather than new relationship-key or hash
configuration.

## 5. Atomic, sequential, upsert, returning, and streaming behavior

Corpus cases: `sequential-statement-evaluation`, `assert-then-update`,
`returning-projection`, `actor-revision-and-idempotency`,
`authorization-write-set`, `streaming-statement-commits`,
`streaming-atomic-semicolon-string`, `reject-revision-conflict`,
`reject-authorization-write`, `reject-incomplete-stream`, and
`reject-duplicate-operation-id`.

**BXL Mutation**

```bxl
assert(Status = "draft", "must still be a draft");
Subtotal = (Quantity * "Unit Price");
Total = (Subtotal + Shipping);
Status = "published";
```

Each statement observes the prior statement's intermediate result. The
execution envelope chooses an atomic commit or progressive complete-statement
commits. An incomplete streamed statement never executes.

**XQuery Update**

```xquery
let $subtotal := xs:decimal($card/quantity)
                 * xs:decimal($card/unitPrice)
return
  if ($card/status = "draft") then (
    replace value of node $card/subtotal with $subtotal,
    replace value of node $card/total
      with $subtotal + xs:decimal($card/shipping),
    replace value of node $card/status with "published"
  ) else error(xs:QName("NOT_DRAFT"), "must still be a draft")
```

An XQuery Update query is one fixed snapshot. Updates remain pending until the
end, so the local `$subtotal` binding is required; the total update cannot
read the pending subtotal update.

**PostgreSQL**

```sql
BEGIN;

UPDATE cards
SET document = jsonb_set(
  document,
  '{subtotal}',
  to_jsonb((document->>'quantity')::numeric
           * (document->>'unitPrice')::numeric)
)
WHERE id = 'invoice-1'
  AND revision = 'r17'
  AND document->>'status' = 'draft';

UPDATE cards
SET document = jsonb_set(
  jsonb_set(
    document,
    '{total}',
    to_jsonb((document->>'subtotal')::numeric
             + (document->>'shipping')::numeric)
  ),
  '{status}',
  '"published"'
)
WHERE id = 'invoice-1'
RETURNING document->>'status', document->>'total';

COMMIT;
```

SQL transactions provide strong atomicity, later statements see earlier
writes, `WHERE` carries revision/precondition checks, and `RETURNING` projects
results. `INSERT ... ON CONFLICT DO UPDATE` gives a real row-level upsert.

**MongoDB update pipeline**

```javascript
db.cards.updateOne(
  { _id: "invoice-1", revision: "r17", status: "draft" },
  [
    { $set: { subtotal: { $multiply: ["$quantity", "$unitPrice"] } } },
    { $set: { total: { $add: ["$subtotal", "$shipping"] } } },
    { $set: { status: "published" } }
  ]
)
```

A single-document update is atomic and later pipeline stages observe earlier
stages. A zero-document match communicates a failed condition, but a message,
authorization write set, and statement streaming are host responsibilities.

**JSON:API Atomic Operations**

```json
{
  "atomic:operations": [
    {
      "op": "update",
      "ref": { "type": "cards", "id": "invoice-1" },
      "data": {
        "type": "cards",
        "id": "invoice-1",
        "attributes": { "subtotal": 40 }
      }
    },
    {
      "op": "update",
      "ref": { "type": "cards", "id": "invoice-1" },
      "data": {
        "type": "cards",
        "id": "invoice-1",
        "attributes": { "total": 45, "status": "published" }
      }
    }
  ]
}
```

Atomic Operations guarantees ordered processing and all-or-nothing success,
and its results correspond positionally to the operations. The caller must
still calculate derived values. Assertions, revision conditions, operation
identities, and progressively committed statement streams require a Boxel
execution contract around the standard extension.

| Technology | Human understanding | Human writing | AI understanding | AI writing | Key difference |
| --- | ---: | ---: | ---: | ---: | --- |
| BXL | 9 | 9 | 9 | 9 | Sequential expressions plus explicit atomic or statement-stream delivery. |
| XQuery Update | 6 | 4 | 6 | 5 | Strong pending-update model; pending writes are not visible within the snapshot. |
| PostgreSQL JSONB | 7 | 5 | 8 | 7 | Best execution semantics, upsert, and returning; nested JSON transformation is verbose. |
| JSON:API Atomic Operations | 9 | 7 | 9 | 8 | Best standard wire envelope for ordered all-or-nothing operations and aligned results; it does not calculate values or frame streams. |
| MongoDB | 6 | 5 | 8 | 7 | Strong single-document atomicity and sequential pipeline stages. |

### Do not conflate two meanings of upsert

SQL and MongoDB use “upsert” for creating a database row/document when no
record matches. BXL field assignment may create an optional member that is
absent from an existing Card, but that is not Card creation. The mutation
profile should keep these separate:

- field set/upsert mutates a targeted existing Card or Field;
- Card creation belongs to a separate creation operation or profile;
- the execution adapter may use SQL `ON CONFLICT` internally only when its
  external semantics actually request create-or-update.

## 6. Outside the profile: search first, then mutate many Cards

The current corpus correctly mutates one already-loaded Card or Field target.
Realm search, collection lookup, and file-tree traversal are network or host
I/O operations. They must not enter the mutation profile, whose evaluation is
pure and has no network or filesystem authority.

Cross-Card DML belongs in a separate sandboxed QuickJS orchestration program.
The host exposes narrowly scoped realm-search or file-tree capabilities, while
each returned Card is transformed by the same prepared BXL mutation. QuickJS
does not receive ambient `fetch`, filesystem, process, or credential access.

| Technology | Search-and-transform equivalent | Target-set and commit behavior |
| --- | --- | --- |
| BXL + sandboxed QuickJS orchestration | QuickJS calls the host's realm search or file-tree iterator, freezes returned IDs and revisions, and invokes one prepared BXL mutation for each loaded Card. | Deliberately outside the mutation profile. The orchestration API chooses atomic or chunked commit and declares expected target bounds. |
| XQuery Update | `for $card in collection("cards")/card[status = "draft"] return replace value of node $card/status with "review"` | The query evaluates against one XDM snapshot and accumulates one pending update list. Persistence across documents remains implementation-defined. |
| PostgreSQL JSONB | `UPDATE cards SET document = jsonb_set(document, '{status}', '"review"') WHERE document->>'status' = 'draft' RETURNING id, revision;` | Search and transform are one statement. All matching rows are updated transactionally; zero matches is not an error unless the application checks the count. |
| JSON:API Atomic Operations | First `GET /cards?filter[status]=draft`, then emit one `update` operation with a resource `ref` for every returned Card. | The submitted operations succeed or fail atomically, but the preceding search is not part of that atomic snapshot. Every target must be enumerated. |
| MongoDB | `db.cards.updateMany({status: "draft"}, {$set: {status: "review"}})` | Search and transform are server-side, but only each individual document update is atomic; the whole multi-document operation needs a transaction for all-or-nothing behavior. |

A conceptual QuickJS program looks like this; the host API names are
provisional, but the boundary is not:

```javascript
const mutation = bxl.prepareMutation(`
  Status = "review";
`);

const cards = await realm.search({
  cardType: "Invoice",
  where: { status: "draft" },
  limit: 100,
});

const batch = bxl.beginBatch({
  expected: { min: 1, max: 100 },
  commit: "atomic",
});

for (const card of cards) {
  batch.mutate(card, mutation, { baseRevision: card.revision });
}

await batch.commit();
```

Preparation occurs once. Each `batch.mutate` evaluates the prepared program
against one loaded Card, producing the same per-Card schema validation,
authorization plan, and retry boundary as an ordinary mutation call. The
network search is visibly a QuickJS host call rather than hidden inside BXL.

The minimum semantics to fixture before adding syntax are:

| Decision | Recommended starting rule | Why |
| --- | --- | --- |
| Target snapshot | Search first and freeze `{cardId, revision}` for every result. | Prevent a progressively running batch from absorbing Cards that only begin matching midway through execution. |
| Cardinality | Require explicit `min` and `max`; reject outside that range. | Prevent an empty migration from looking successful and prevent a broad query from changing an unbounded realm. |
| Mutation evaluation | Evaluate the same program separately against each loaded Card. | Preserves CardDef/FieldDef boundaries and produces a per-Card concrete write set. |
| Authorization | Authorize every per-Card plan before an atomic commit; authorize per chunk for chunked mode. | Avoid partially committing an atomic batch after a later Card is denied. |
| Atomicity | Offer `atomic` only within a host-supported transaction limit; otherwise require explicit `chunked`. | JSON:API Atomic and SQL can express an atomic batch, while large realm mutations need bounded operational behavior. |
| Failure and retry | Return results keyed by Card ID and revision; keep a batch/program ID for idempotency. | Makes conflicts, retries, and partial chunk progress unambiguous. |
| Returning | Return matched, changed, skipped, denied, and conflicted counts plus bounded Card projections. | Gives an AI enough evidence to verify the batch without returning every full Card. |
| Streaming | Stream search/progress/results from QuickJS, not uncommitted mutation statements inside an atomic batch. | An atomic batch cannot honestly expose progressively durable statements. |

This should become a separate QuickJS orchestration corpus—not mutation-profile
grammar—with at least: atomic success, empty search, over-limit search, one
stale revision, one denied Card, chunked partial progress, idempotent retry,
and a Card that begins matching after the search snapshot.

## Coverage of the mutation runner

| Corpus area | Fixture IDs | Comparison pressure |
| --- | --- | --- |
| Scalars, compounds, and roots | `copy-compound-field`, `field-root-update`, `assign-null`, `delete-member`, `reject-card-root-replacement` | Copy versus replace, null versus absence, and root boundaries. |
| Contained structure | `append-contained-value`, `delete-contained-value`, `insert-after-stable-anchor`, `move-before-stable-anchor`, `exact-reorder` | Granular structure without whole-array replacement. |
| Cardinality | `exact-one-selected-update`, `explicit-bulk-update`, `reject-ambiguous-single-target`, `reject-empty-bulk-target` | Exactly one by default; explicit one-or-more bulk intent. |
| Evaluation and results | `sequential-statement-evaluation`, `assert-then-update`, `returning-projection` | Intermediate state, preconditions, and result projection. |
| Execution envelope | `actor-revision-and-idempotency`, `reject-revision-conflict`, `reject-duplicate-operation-id` | Actor, revision, replay identity, and operation identity. |
| Relationships and real Cards | `relate-card`, `unrelate-card`, `move-relationship`, `workspace-append-entry-point`, `contest-set-singular-link`, `classroom-update-contained-schedule`, `zine-reorder-linked-fragments` | Loaded Cards and relationship-edge lowering. |
| Relationship boundaries | `reject-related-card-traversal`, `reject-jsonapi-relationship-path`, `reject-query-backed-links-to-many` | No linked-Card traversal, raw storage paths, or derived membership writes. |
| Authorization | `authorization-write-set`, `reject-authorization-write` | Concrete leaf/edge intents checked as a complete set. |
| Streaming | `streaming-statement-commits`, `streaming-atomic-semicolon-string`, `reject-incomplete-stream`, `reject-streaming-numeric-position` | Statement framing and stable addressing under progressive commit. |
| Structural validation | `reject-source-is-anchor`, `reject-non-permutation-reorder` | Move and exact-permutation invariants. |
| Cross-Card batch orchestration | intentionally outside this corpus | A separate QuickJS corpus should cover search snapshots, target bounds, batch authorization, atomic versus chunked commit, retry, and bounded returning. |

## What appears worth borrowing

1. **XQuery Update:** explicit structural verbs and positional words. Its
   `insert node X before Y` is immediately readable.
2. **XPath:** attach a descendant predicate to the outer item being selected.
   This directly supports `Product[Variants[SKU = value]]`.
3. **PostgreSQL:** revision predicates, transactions, upsert boundaries, and
   `RETURNING` belong in the execution contract. Its split between JSONPath
   query and numeric JSONB write paths is specifically what BXL should avoid.
4. **JSON:API Atomic Operations:** use `atomic:operations` and
   `atomic:results` as the default wire-envelope shape. Resource and
   relationship add/update/remove map directly; first-class contained moves,
   assertions, revisions, and operation IDs need Boxel semantics, preferably
   in a namespaced extension or operation `meta` rather than a competing
   top-level batch format.
5. **MongoDB:** preserve single-Card atomicity, but do not inherit positional
   `$` first-match behavior or distant `arrayFilters` configuration.

## Syntax decisions to make next

The syntax recommendation is to add **no parser productions**. Mutation should
reuse the existing BXL/jq expression grammar and add planner semantics only.

| Question | Recommendation | Why it needs no parser work |
| --- | --- | --- |
| Relative move | Use `move_item_before(item, anchor)` and `move_item_after(item, anchor)`. | The function name states that the first argument is the item; `before` or `after` states that the second is the anchor. They remain ordinary readable-BXL calls, and exact-one behavior belongs to the planner. |
| Relative insert | Change the pre-grammar candidate to subject-first: `insert_after(value, anchor)` and `insert_before(value, anchor)`. | This matches the subject-first order of `move_item_before(item, anchor)`, XQuery, and familiar tree APIs while changing only builtin/planner argument semantics. |
| Descendant evidence | Keep `Product[Variants[SKU = value]]`; do not add an `any` keyword or new selector form. | Nested readable labels and predicates already parse. Mutation planning preserves the outer Product location instead of ordinary derive-mode first-match value lowering. |
| Exact one versus bulk | Keep ordinary `[predicate]` for exact-one mutation locations and existing `[* predicate]` only inside `update_all`/`delete_all`. | Both selector forms already exist. Cardinality enforcement is a profile rule after parsing. |
| Preconditions | Keep `assert(predicate, message)`. Carry resolved revision/precondition data in JSON:API operation `meta` or a Boxel namespaced extension. | `assert` is an ordinary function call. Wire metadata does not require readable-language grammar. |
| Multiple statements | Frame complete semicolon-terminated statements outside the parser and prepare each expression once. | The parser continues to receive one ordinary BXL expression at a time; streaming state belongs to the mutation runner. |
| Cross-Card loops | Use QuickJS `for` plus repeated calls to one prepared mutation; do not add `for`, `collection`, search, or I/O to Mutation BXL. | JavaScript owns orchestration and host capabilities; BXL remains pure over one loaded target. |

Concretely, the recommended structural handwriting is:

```bxl
insert_after(
  { id: "details", title: "Details" },
  Section[ID = "overview"]
);

move_item_before(
  Section[ID = "summary"],
  Section[ID = "round-one"]
);

move_item_before(
  Product[Variants[SKU = "COPY-03"]],
  Product[ID = "featured"]
);
```

Only the `insert_after` argument order differs from the current fixture
candidate. That is the one syntax change I recommend making before the corpus
becomes a grammar contract.

## Primary references

- [W3C XQuery Update Facility 3.0](https://www.w3.org/TR/xquery-update-30/)
- [W3C XQuery Update Facility 3.0 requirements and use cases](https://www.w3.org/TR/xquery-update-30-requirements-use-cases/)
- [PostgreSQL JSON functions and operators](https://www.postgresql.org/docs/current/functions-json.html)
- [PostgreSQL `UPDATE`](https://www.postgresql.org/docs/current/sql-update.html)
- [PostgreSQL `INSERT ... ON CONFLICT`](https://www.postgresql.org/docs/current/sql-insert.html)
- [PostgreSQL transactions](https://www.postgresql.org/docs/current/tutorial-transactions.html)
- [JSON:API Atomic Operations](https://jsonapi.org/ext/atomic/)
- [JSON:API resource linkage and relationship order](https://jsonapi.org/format/#document-resource-object-linkage)
- [MongoDB update documents](https://www.mongodb.com/docs/manual/tutorial/update-documents/)
- [MongoDB array update operators](https://www.mongodb.com/docs/manual/reference/operator/update-array/)
- [MongoDB filtered positional operator](https://www.mongodb.com/docs/manual/reference/operator/update/positional-filtered/)
- [MongoDB atomicity and transactions](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
