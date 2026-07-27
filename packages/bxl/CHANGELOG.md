# Changelog

All notable changes to `@cardstack/bxl` are recorded here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 caveat: the public API is intentionally unstable. Minor and patch
versions may change syntax behavior until `1.0.0`. See
[RELEASE-PLAN.md](./RELEASE-PLAN.md).

## [Unreleased]

### Added

- **Realm-collaboration regression corpus.** Eighteen runnable examples cover
  the six gateway evaluation stages observed across 88 static declarations:
  admission, rejection diagnostics, state transitions, event projections,
  clock transitions, and decision tests. A source audit command validates a
  live realm checkout and reports raw-jq root-scope hazards.
- **Real-world gateway guide.** Documents the envelope contract, host/runtime
  responsibility boundary, recurring policy patterns, matrix-bot metadata,
  and five unsafe `inside(.config...)` pipelines found in the ledger-lab
  snapshot.

## [0.1.0] — 2026-07-27

### Fixed

- **Readable predicates and nested transforms capture the root record.**
  Item fields resolve first inside predicates, `map`, `select`, and object
  construction, with unresolved readable labels falling back to `$root`.
  Expressions such as `Book[Bidder = Intent.Bidder]` no longer fail with an
  undefined `Intent/0` call.
- **Schema-known invalid members no longer fail silently.** Accessing an
  unknown field on a schema-known object or array item raises a readable
  compiler diagnostic. Input keys that differ from schema keys only by casing
  produce a structured `input-key-casing-mismatch` evaluation warning.
- **`present(no-match)` is Boolean.** `present(...)` now materializes an empty
  argument stream as `null`, returning `false` instead of allowing the whole
  expression to disappear and normalize to `null`.
- **Runtime profile failures explain their capability boundary.** The
  jq-core-only `runtime-bare` entry now points spreadsheet-formula callers to
  the full runtime; `computeVia` continues to report derive-profile codes such
  as `derive-def-banned` for unsupported user helpers.

- **Parser: `A - (B + C)` no longer reassociates to `(A - B) + C`.**
  Long-standing bug in `Parser.normalizeBinaryAst` — equal-precedence
  chains were left-associated regardless of whether the right-hand
  side came from a parenthesized expression. Anything shaped like
  `Revenue - (Cost1 + Cost2 + …)` silently flipped the signs of
  every cost past the first. Fix: `BinaryAst` gains a `parenthesized`
  flag that the normalizer treats as a hard grouping boundary.
- **`IFS` helper supports up to 8 condition/value pairs** (16 args).
  Previously capped at 4 pairs, raising `'IFS/10' is not defined`
  for any spreadsheet that hit a 5+ branch classification. The
  jq-side `def IFS` now covers /4, /6, /8, /10, /12, /14, /16.

### Added

- **Boxel realm authoring surface.** New public exports `bxl`,
  `expression`, `expr`, `jq`, and `fx` (the last two as tagged
  templates). `expression('…')` returns a function bound to `this`
  for use inside `@field` `computeVia`. The `as: SomeFieldDef`
  option mirrors jqxl's `{ as: ... }` and uses Boxel's `getFields`
  when reachable, falling back to `Object.assign`.
- **Excel-error tolerance at the boundary.** `bxl()` catches Excel
  sentinels (`#N/A`, `#DIV/0!`, `#VALUE!`, `#NUM!`, `#REF!`,
  `#NAME?`, `#NULL!`, `#ERROR!`, `#GETTING_DATA`) raised inside
  evaluation and surfaces them as `null` instead of crashing the
  indexer.
- **`fx`/`jq` tagged templates.** `` jq`…` `` skips readable-syntax
  compilation and preserves `\(...)` interpolation through JS's
  silent-escape gotcha. `` fx`…` `` is explicit-Excel sugar over a
  plain string (same compilation today).
- **PascalCase → camelCase fallback** in the readable-syntax
  compiler when no schema is in scope. Resolves bare `Severity` to
  `.severity`; skips all-uppercase initialisms, jq keywords, BXL
  literals, and quoted string literals.
- **JQ control-keyword guard** in the function-call dispatch:
  lowercase `if (.x // 0) == 0 then …` no longer collides with the
  Excel `IF()` formula.
- **Realm-bundle entry shim.** `src/realm-bundle-entry.ts` performs
  the `https://cardstack.com/base/card-api` import as the bundle's
  esbuild entry, registering `getFields` on a `globalThis` hook.
  `src/index.ts` looks up the hook lazily, so non-realm consumers
  (Node tests, CLI tooling) load the public API without tripping on
  the `https:` ESM scheme.
- **`tests/boxel/` test suite.** New M1 milestone covering the
  runtime null-tolerance and expression-factory behavior the realm
  depends on; runnable via `npm run test:boxel` or the full suite.
  Includes plain-data fixtures mirroring the hospital fixture.
- **Documentation reshuffle.** Migration guide at
  [`docs/migration-from-jqxl.md`](./docs/migration-from-jqxl.md);
  full port log moved to
  [`docs/internals/port-from-jqxl.md`](./docs/internals/port-from-jqxl.md).
  TypeDoc setup (`typedoc.json`, `npm run docs:api`) generates an
  API reference from the JSDoc that now annotates every public
  symbol in `src/index.ts`.

### Changed

- **jq runtime tolerates null operands.** Arithmetic operators `-`,
  `*`, `/`, `%` propagate `null` instead of throwing when either
  operand is `null` / `undefined`. Division/modulo by zero returns
  `null`. `+` keeps jq's identity-on-null semantics.
- **Iterating null is empty.** `null | .[]` (or `[null[]]`) yields
  an empty stream instead of `null is not iterable`.
- **`assertString` / `assertNumber` coerce nullish values.** `null`
  and `undefined` become `''` and `0` respectively; filters like
  `ascii_upcase`, `startswith/1`, `endswith/1` no longer surface
  "Got null, string expected".
- **Three-origin `src/` layout** (carried from the original port):
  `jqtools/` (derived from alexxander/jq-tools), `formulajs/`
  (derived from formulajs/formulajs), and `bxl/` (our own
  readable-syntax compiler, linter, formatter, bridge, registry,
  and TextMate grammar). Sub-entry source files
  (`src/compiler.ts`, `src/linter.ts`, `src/runtime.ts`,
  `src/runtime-bare.ts`) wired via `package.json` `exports`.

### Infrastructure

- The computed-field benchmark now registers the same eager extension
  libraries as the Boxel realm bundle. This prevents calibration from silently
  excluding engineering, financial, statistical, Bessel, and validation
  formulas and reports performance over the representative workload.

- `tsconfig.json` relaxed to match ported code realities
  (`noImplicitAny: false`, `noUncheckedIndexedAccess: false`,
  `exactOptionalPropertyTypes: false`). Re-tightening is a follow-up task.
