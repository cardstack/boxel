# Authoring Lattice owners

The operator first enables the realm with `LATTICE_ENABLED_REALMS`. A definition
then declares `static materialized = true`. The declaration opts that card into
the publication path; it does not enable a realm or authorize native execution.

Keep a materialized value at the card identity that owns it. A reusable summary
can consume other materialized cards, but changing one section of a screen should
not require inventing a second identity for every rendered fragment.

## Query and computation declarations

The following uses the same declaration pattern as the executable
[synthetic parity fixture](../packages/realm-server/tests/helpers/lattice-parity-fixture.ts):

```gts
import { bxl } from '@cardstack/bxl';
import {
  CardDef,
  field,
  contains,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import NumberField from '@cardstack/base/number';

export class Item extends CardDef {
  @field group = contains(StringField);
}

export class Summary extends CardDef {
  static materialized = true;
  static queryInputs = { items: {} };

  @field group = contains(StringField);
  @field items = linksToMany(Item, {
    query: {
      filter: { eq: { group: '$this.group' } },
      page: { size: 20 },
    },
  });
  @field displayedCount = contains(NumberField, {
    computeVia: bxl('.items | length', {
      libraries: ['core'],
      readableSyntax: false,
    }),
  });
}
```

`displayedCount` counts this query's returned page, not every matching record
outside it. Filtering, ordering and pagination remain part of the input's
meaning. Do not silently replace a paged query with an unbounded aggregate.

`static queryInputs` declares the data projection for query-backed inputs on
the native path. `static linkInputs` declares projections for direct links.
An empty projection selects the card's attribute data; nested projections
describe the linked data the computation consumes. These declarations do not
load arbitrary modules into Node. Input preparation uses reviewed definition
metadata and indexed card data. Projection depth and card-count limits still
apply; unavailable required input is a refusal or pending state, not a zero.

The fixture also demonstrates a query whose parameter depends on a computed
list of identities. Those prerequisites must settle before the dependent query
can be treated as complete. Empty results still participate in invalidation, so
a newly matching item can dirty the owner.

This draft's declaration vocabulary is `queryInputs` and `linkInputs`. A planned
analysis-owned `reads` option is not part of this documented contract yet.

## Native computation is a separate opt-in

Use the official `@cardstack/bxl` helper in `computeVia`. BXL formulas can run
over captured card data without a card-module loader in the computation worker.
This does not make arbitrary JavaScript getters, constructors or FileDefs safe
for Node. The operator's review must cover the supported implementation and
definition closure, and publication checks the receipts again.

Do not remove required inputs to gain admission, convert input failures to empty
arrays, or increase counters speculatively inside arbitrary computeds. Time
inputs also need an explicit validity grain; a result using time must stop being
fresh when that grain expires. Native review can become stale after a module
edit, even if the card's JSON is unchanged.

## Presentation and edits

Retain the card's existing templates and delegated field editors. Observe
`publicationState` to distinguish pending from ready. A pending update should
leave the last displayed data and unrelated drafts mounted.

Write the source card through ordinary operations. Treat the server's
`meta.publication` as a read receipt; do not store a manufactured receipt in
source JSON or use it to bypass computation. `outputRevision` can stay unchanged
when recomputation validates identical output, so readiness is not equivalent
to receiving a different body.

The [two-store test](../packages/realm-server/tests/lattice-two-store-publication-test.ts)
exercises a feeder edit, complete output application in both browser stores,
and preservation of an unsaved delegated editor. Its fixture contains synthetic
data only. Passing a count-only test is insufficient to establish output parity
or editing continuity.
