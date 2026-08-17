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

## Running

```sh
pnpm test                       # every suite
pnpm test tests/boxel           # one directory
node tests/unit/linter-cli.ts   # one suite
```

`pnpm test` prints a line per suite and exits non-zero if any fails.
