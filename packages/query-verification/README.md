# Query V2 formal verification

This package checks the Query V2 query language against a formal model of
what its queries mean. Its goal is to surface correctness bugs: places where
one of the code paths that reads or answers a query gives a different answer
than the specification ([`docs/search.md`](../../docs/search.md)) says it
should, or a different answer than another code path gives for the same
query.

It works in two halves. A model of the language, written in
[Lean 4](https://lean-lang.org/), states what a query means and carries
machine-checked proofs of the laws the language is meant to obey. The same
model then generates test vectors (queries, cards, and the answer for every
query on every card), and the real code is run against them. A proof is only
as good as the model it is about, so the vectors are what tie the model to
the code: any place the code and the model disagree is either a bug in the
code or a mistake in the model, and each one has to be looked at.

## How it is put together

```
lean/QueryV2/Truth.lean     three-valued (SQL / Kleene) truth
lean/QueryV2/Filter.lean    filters, cards, evaluation, lowering, refusals
lean/QueryV2/Laws.lean      theorems about filters and lowering
lean/QueryV2/Grammar.lean   queries as written: spelling, acceptance, refusals
lean/QueryV2/Doc.lean       nested documents and dotted field paths
lean/QueryV2/Json.lean      rendering the model's filters as query JSON
lean/QueryV2/Values.lean    typed values: a calendar, field spellings, their vectors
lean/QueryV2/Dates.lean     relative dates against a fixed clock, and their vectors
lean/Main.lean              the vector generator (lake exe vectors)
lean/Audit.lean             prints the axioms every theorem rests on
vectors/*.json              generated: filters, grammar, paths, values, dates
src/check-matcher.ts        lowerQuery + host matcher, in Node
src/check-grammar.ts        usesNewSyntax, assertAuthoredQuerySpelling, assertQuery
src/check-sqlite.ts         the engine on SQLite (node:sqlite), in Node
src/sqlite-adapter.ts       a DBAdapter over node:sqlite, as the host's over sqlite-wasm
src/engine-fixture.ts       seeds the vectors into an engine and runs every case
src/matcher-cards.ts        stand-in card classes the matcher can read
src/conformance.ts          shared vector types and reporting
src/known.ts                the known divergences, by evaluator
../realm-server/tests/query-verification-conformance-test.ts
                            the engine on Postgres, through engine-fixture
```

### The model

A card holds, at each field path, either a scalar (a value, or none) or a
list of values. A comparison on a scalar with no value is unknown, as in SQL;
a comparison on a list holds when some element satisfies it, so it is never
unknown, and on an empty list it fails. `every`, `any` and `not` are SQL's
`AND`, `OR` and `NOT`. A card is in a query's result when its filter is
true. `on: T` gates a filter to cards of type `T` and its subtypes.

The grammar model describes a query as written: its top-level members, the
members of `page`, and the members beside the top filter node's operator. It
says which spelling the query is read in (the newer one as soon as any
member Query V2 added appears), which refusals apply (`mixed-spelling`,
`unknown-key`, `conflicting-members`), and what an accepted query means.
Its member lists are copied from `query-grammar.ts`, and `check-grammar.ts`
fails if they drift apart.

The path model describes a stored search document: nested objects for
compound fields and link targets, arrays for `containsMany` and
`linksToMany`. A path fans out through every list it crosses, and a path
that crosses a list is a list path.

Typed values are integers in the model, so every law above holds for them
unchanged:

- a decimal is in hundredths and a big integer is itself;
- a date is days since 1970;
- a date-time is UTC minutes since 1970;
- a boolean is 0 or 1.

What differs is only how a value is written. Each field type has its own
spelling in the search doc and in the card JSON, and the queries write each
value in several spellings that mean the same value:

- a decimal as a number or as `"2.00"`;
- a boolean as `true` or `"true"`;
- a date-time with no zone, with `:00Z`, with `:00.000Z`, with a `+05:30`
  offset, or as a date.

A shared value with different answers across spellings is a disagreement.

A relative date is resolved in the model against one fixed clock,
`2000-01-01T00:00:30Z`. That is thirty seconds into a minute a stored
date-time holds, and the evening before in New York. Moves by `s`, `m` and
`h` are elapsed time, and moves by `d`, `w`, `M` and `y` and every rounding
are on the query zone's calendar. The result is then put in the field's
format: the day it falls on in that zone for a date field, and its UTC
minute for a date-time field. From there it's an integer like any other
value, so the same laws hold.

### The theorems

All proved, with no `sorry`. `pnpm prove` prints the axioms each rests on and
fails if any proof is unfinished.

- **Connectives.** `every` and `any` are AND and OR chains (`all_cons`,
  `any_cons`); De Morgan holds through `not` (`not_any`, `not_all`); order and
  repetition inside `every` / `any` don't matter (`every_perm`, `any_perm`,
  `every_dup`); a one-element `every` is its element (`every_single`); the
  order and repetition of `in`'s values don't matter (`in_congr`).
- **Missing values and lists.** A card with no value at a path is in neither
  `f` nor `not f` for a comparison `f` (`missing_excluded`); a comparison on
  a list is never unknown (`list_two_valued`); `not` keeps a card whose list
  is empty (`empty_list_not`); `exists` and `missing` are each other's `not`
  and never unknown (`exists_not_missing`).
- **Type gates.** `not (on T f)` keeps a card of another type and
  `on T (not f)` doesn't, so a gate can't be moved across a `not`
  (`gate_under_not`).
- **Lowering.** Lowering the newer nodes (`{ on }` alone, `exists`,
  `missing`) keeps every answer (`eval_lower`) and leaves nothing the engine
  would have to lower again (`lower_engineForm`); lowering refuses exactly
  what the authored query does (`refused_lower`, `refused_lowerTyped`); a
  newer query with `type: T` means its filter on cards of `T`
  (`lowerTyped_meaning`), which is what the older `{ on: T, … }` means
  (`spellings_agree`).
- **Spelling and acceptance.** In the older spelling a member the grammar
  doesn't know changes nothing in `page` or beside the filter operator
  (`older_ignores_page`, `older_ignores_node`), and a top-level member that
  isn't a marker keeps a query older (`older_stays_older_top`). Writing any
  member Query V2 added makes a query newer (`marker_makes_newer`). An unknown
  top-level member is refused in either spelling (`refuses_unknown_top`), and
  the newer spelling refuses an unknown member anywhere
  (`newer_refuses_unknown_node`). The rewrite the `mixed-spelling` error
  suggests gives a query that is accepted and means the same
  (`mixed_rewrite`).
- **Paths.** With no list on the way, a path reaches exactly one value
  (`reach_single`); a filter through a list holds when it holds of some
  element (`compare_through_list`); an empty list, or an absent or null
  compound, in front of a list reaches nothing, so a comparison fails and its
  `not` holds (`empty_on_the_way`, `reach_absent`, `absent_before_list`).

### The vectors

`lake exe vectors` writes five files:

- `filters.json`: 318 filter cases over 960 cards that cover every
  combination of present, null and absent values on string, number and list
  fields, across a small type hierarchy. The cases are every leaf operator
  and composition up to about three levels deep, each under `not`.
- `grammar.json`: 544 written queries, combining top-level members, `page`
  members and members beside the operator, each with the refusals the model
  allows and, when it's accepted, its answers.
- `paths.json`: 88 cases over 1,050 cards with a compound field, a list of
  compound fields, a `linksTo` and a `linksToMany`, with null, absent, empty
  and populated values at each level.
- `values.json`: 173 cases over 503 cards. The fields are a boolean, a
  decimal, a big integer, a date, a date-time, and lists of decimals and
  date-times. Each card carries its search doc and its card JSON. Three
  cards of another type hold text under the same field names, for a query on
  the first type to pass over.
- `dates.json`: 66 cases over the same cards, with three cards of another
  type holding `now`, `now-3x` and `abc` as text. It has `range`, `eq` and
  `in` with relative dates on date, date-time and date-time list fields, in
  UTC and in New York, plus malformed relative dates, which are refused on a
  date field and literal on a text field. It names its clock (`now`), and
  each case names its zone.

Each case carries the model's lowered form and, per card, `t`, `f` or `u`.
The files are checked in, and CI fails if they are not what the model
generates.

### The evaluators

- **The host matcher** (`check-matcher.ts`, `check-grammar.ts`) builds
  stand-in card classes from the vectors' schema and runs
  `matchInstanceAgainstFilter` on every card, for the lowered and the older
  form of every case. An instance holds what its card JSON deserializes to
  through the field's real serializer (a `Date`, a `bigint`). The card API's
  `getQueryableValue` and `formatQueryValue` go through the same serializers,
  as `card-api` does. It runs in UTC and in `America/New_York`. For
  `dates.json` it replaces the global `Date` so that `new Date()` reads the
  vectors' clock, and it skips a case in another zone, which the host leaves
  to the server.
- **The query front end** (`check-grammar.ts`) runs every written query
  through `usesNewSyntax`, then `assertAuthoredQuerySpelling` and
  `assertQuery` (as an author's query is), and `assertQuery` alone (as the
  server's is).
- **The engine** (`IndexQueryEngine`, through `engine-fixture.ts`) gets
  every card seeded straight into `boxel_index` with a stand-in definition
  lookup. It runs every case in both spellings and under `not`, with the
  vectors' clock as `queryNow` and the case's zone as `timeZone`. It runs
  twice:
  - on **Postgres**, in the realm-server test;
  - on **SQLite**, in `check-sqlite.ts`. That runs on Node's `node:sqlite`
    with the host's schema, and the SQL goes through the same
    Postgres-to-SQLite rewrites the host's adapter applies. The check fails
    if the host's list of rewrites changes, since the copy here would then be
    stale.

A disagreement the code is known to have is listed with what it does, and
which evaluators have it, in `src/known.ts` (the grammar's in
`check-grammar.ts`). It is reported instead of failing. An entry that stops
occurring fails, so it gets taken off the list when the bug is fixed.

## What it doesn't cover

The proofs hold for filters of any depth and any number of cards; the
coverage limits are in what the model describes and in what the vectors
exercise.

- **Not modeled:** `let` bindings and references to them, `matches` (full
  text) and its modifiers' effect on ranking, `sort`, `page` contents beyond
  their members, `facets`, `collapse`, `rerank`, vector search, and
  query-backed fields.
- **Value types:** relative dates are covered at one clock and in two zones
  with fixed offsets. A daylight-saving change, month-end overflow
  (`now+1M` on 31 January), relative bounds in facets, and `now-1M`-style
  moves are not covered. `contains` on boolean, date and date-time fields
  isn't covered either, and nor are the other primitive fields (email,
  phone, code refs).
- **Depth:** the vectors compose filters about three levels deep and follow
  paths two segments long. A bug that only appears deeper would not be
  caught.
- **Engines:** the matcher runs on stand-in card classes, with the real
  serializers, rather than on real card classes. SQLite runs on Node's
  build (3.53) rather than the host's sqlite-wasm (3.45), and through a copy
  of the host adapter's rewrites rather than the adapter itself. The indexer
  isn't exercised: the vectors say what the search doc holds instead of
  indexing the card JSON.
- **Text:** `contains` is modeled with ASCII case folding; the vectors use
  ASCII text only.

## Running it

Needs [elan](https://github.com/leanprover/elan) for Lean (the toolchain is
pinned in `lean/lean-toolchain`), and the realm-server test services for the
Postgres check.

```sh
cd packages/query-verification
pnpm prove           # build the model, check every proof, audit axioms
pnpm vectors         # regenerate vectors/ after a model change
pnpm vectors:check   # fail if vectors/ is not what the model generates
pnpm test            # host matcher (UTC and New York), lowering, grammar, SQLite
pnpm lint

cd ../realm-server   # Postgres; needs `pnpm start:all` running
MATRIX_REGISTRATION_SHARED_SECRET=unused \
  TEST_FILES=query-verification-conformance-test pnpm test
# QV_REPORT=/tmp/report.txt also writes every disagreement and known entry
```

In CI, the `query-verification-test` job runs `prove`, `vectors:check` and
`test` whenever this package or the query code changes, and the Postgres
check runs in the realm-server suite.

To extend it, add a case or card space to `lean/Main.lean`,
`lean/QueryV2/Values.lean` or `lean/QueryV2/Dates.lean` (and, for new behavior, a definition and theorem
to the model), run `pnpm vectors`, and run the checks. A new disagreement is
one of three things: a bug to fix, a divergence to list in `src/known.ts`
with what the code does, or a mistake in the model.
