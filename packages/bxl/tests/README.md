# Tests

Every public BXL syntax and API promise has an executable test here.

A suite is a standalone `.ts` entry point: it asserts with `node:assert` and
prints one summary line. Node runs them directly — the package is erasable
TypeScript, so there is no loader hook or transpile step.

## Layout

- `unit/` — compiler, linter, formatter, parser, mutation planner, and
  authorization correctness, plus the Excel/jq function matrices
- `smoke/` — end-to-end checks over the assembled runtime: sandbox limits,
  error handling, lazy formula chunks loading on demand, the bundled surface
- `boxel/` — the Boxel-flavored runtime and factory rules a card runtime
  depends on, over plain-object fixtures (see [`boxel/README.md`](./boxel/README.md))
- `authorization/` — OpenFGA conformance fixtures and the harness that drives
  them (see [`authorization/README.md`](./authorization/README.md))

## Function coverage

`unit/function-coverage-cli.ts` holds every function BXL exposes to one case
with an asserted result — jq's builtins, the Excel helpers including the lazily
chunked families, the validator.js helpers, and the authorization builtins. It
reads the list of functions to cover out of the resolved builtin registry, so
**adding a builtin without a case fails the suite**. Add yours to the matching
family table under `unit/fixtures/function-coverage/`.

Two things about that suite are worth knowing before you write a case:

- Coverage is credited by **observed invocation**, not by what a case declares.
  A case naming `ROUND/2` whose program never reaches `ROUND/2` fails, as does
  one that only names it inside a branch that never runs.
- A case touching a date must set `zones`, which evaluates it under a spread of
  time zones and requires the same answer in all of them. Indexing runs
  server-side in UTC while a browser runs in the viewer's zone, and CI's zone is
  neither, so a date result that shifts with the host is both a flaky test and a
  product bug.

A function that diverges from its specification keeps the correct assertion and
takes a `knownDefect` note: the suite then requires the case to keep failing,
and reports it the moment it starts passing so the fix promotes the case.

## Running

```sh
pnpm test                       # every suite
pnpm test tests/boxel           # one directory
node tests/unit/linter-cli.ts   # one suite
```

`pnpm test` prints a line per suite and exits non-zero if any fails.
