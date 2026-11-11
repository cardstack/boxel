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
lean/Main.lean              the vector generator (lake exe vectors)
lean/Audit.lean             prints the axioms every theorem rests on
vectors/*.json              generated: filters, grammar, paths
src/check-matcher.ts        lowerQuery + host matcher, in Node
src/check-grammar.ts        usesNewSyntax, assertAuthoredQuerySpelling, assertQuery
src/matcher-cards.ts        stand-in card classes the matcher can read
src/conformance.ts          shared vector types and reporting
../realm-server/tests/query-verification-conformance-test.ts
                            the Postgres engine, through the realm server's search
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

`lake exe vectors` writes three files:

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

Each case carries the model's lowered form and, per card, `t`, `f` or `u`.
The files are checked in, and CI fails if they are not what the model
generates.

### The evaluators

- **The host matcher** (`check-matcher.ts`, `check-grammar.ts`) builds
  stand-in card classes from the vectors' schema and runs
  `matchInstanceAgainstFilter` on every card, for the lowered and the older
  form of every case.
- **The query front end** (`check-grammar.ts`) runs every written query
  through `usesNewSyntax`, then `assertAuthoredQuerySpelling` and
  `assertQuery` (as an author's query is), and `assertQuery` alone (as the
  server's is).
- **Postgres** (the realm-server test) seeds every card straight into
  `boxel_index` with a stand-in definition lookup and runs every case through
  the realm's search, in both spellings and under `not`.

A disagreement the code is known to have is listed with what it does under
`KNOWN` in the check that finds it. It is reported instead of failing, and a
`KNOWN` entry that stops occurring fails, so it gets taken off the list.

## What it doesn't cover

The proofs hold for filters of any depth and any number of cards; the
coverage limits are in what the model describes and in what the vectors
exercise.

- **Not modeled:** `let` bindings and references to them, `matches` (full
  text) and its modifiers' effect on ranking, `sort`, `page` contents beyond
  their members, `facets`, `collapse`, `rerank`, vector search, and
  query-backed fields.
- **Value types:** strings and integers only. Boolean, decimal, date and
  big-integer fields are not in the vectors, so neither is how each is
  stored, compared or cast.
- **Depth:** the vectors compose filters about three levels deep and follow
  paths two segments long. A bug that only appears deeper would not be
  caught.
- **Engines:** the matcher runs on stand-in card classes rather than real
  ones, and SQLite (the host's in-browser index) is not exercised.
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
pnpm test            # host matcher, lowering, and grammar checks
pnpm lint

cd ../realm-server   # Postgres; needs `pnpm start:all` running
MATRIX_REGISTRATION_SHARED_SECRET=unused \
  TEST_FILES=query-verification-conformance-test pnpm test
```

In CI, the `query-verification-test` job runs `prove`, `vectors:check` and
`test` whenever this package or the query code changes, and the Postgres
check runs in the realm-server suite.

To extend it, add a case or card space to `lean/Main.lean` (and, for new
behavior, a definition and theorem to the model), run `pnpm vectors`, and
run the checks. A new disagreement is either a bug to fix, a divergence to
list under `KNOWN` with what the code does, or a mistake in the model.
