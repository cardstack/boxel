# Changelog

All notable changes to `@cardstack/bxl` are recorded here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 caveat: the public API is intentionally unstable. Minor and patch
versions may change syntax behavior until `1.0.0`.

## [Unreleased]

### Added

- **Cycle-guarded lazy card materialization in `expression()`.** The
  computeVia factory hands the program a lazy view of the card graph:
  path access materializes only the fields it names, structural
  operations (`unique`, `==`, `tojson`, `keys`, …) enumerate a card's
  real field map on demand, and re-entering a value already on the
  traversal path — card graphs are legitimately cyclic, jq's data model
  is not — reads as a bounded `{ id }` reference instead of recursing.
  Cards clip by object identity and by id (mirroring the platform's
  `queryableValue` clip); ordinary JSON clips by identity alone. A
  256-hop depth cap fails fast on pathological graphs, and
  materialization hops count toward the runtime step/time budget.
  Program outputs are unwrapped back to raw values, so nothing
  downstream ever holds the lazy view. See the README's "Linked cards,
  cycles, and bounded references."

- **`loadAllFormulaExtensions()`.** Loads every lazy formula chunk
  (statistical, Bessel, engineering/financial, validation) and folds it into
  `DEFAULT_BUILTIN_LIBRARIES`, so hosts can serve the module to authors whose
  synchronous `expression()` computeVia expressions may name any function.
  A failed chunk load no longer sticks: the memo clears on rejection so the
  next call retries.

### Changed

- **`sort` no longer mutates its input.** The builtin sorts a copy;
  sorting in place mutated the caller's array — on a live card array,
  its change subscribers fired as a side effect of evaluating an
  expression. Non-array inputs are rejected with a clear error instead
  of failing on a missing `sort` method.

- **`{ as: FieldDef }` field-metadata resolution is instance-carried
  first.** Materialization reads the value's own bridge — card-api stamps
  its `getFields` onto `BaseDef.prototype` under
  `Symbol.for('cardstack.getFields')` — and only then falls back to the
  ambient `globalThis.__cardstackGetFields`, which logs a one-time warning
  when consulted for a card-api-marked value. This keeps materialization
  correct when several card-api copies are loaded at once.

- **The package ships raw erasable TypeScript from `src/`.** The `exports`
  map points at `.ts` sources; there is no build step and no `dist/`.
  Consumers are Node ≥24 (native type stripping) and bundlers that compile
  TypeScript — `engines.node` is now `>=24`.
- Relative import specifiers use `.ts` extensions throughout.

### Fixed

- **Twenty functions that answered something other than their specification.**
  On the jq side: named captures now travel on a match, so `capture`, `sub` and
  `gsub` can read them, and a group that did not participate reports an absent
  capture rather than crashing; `round` ties away from zero; `isinfinite`
  excludes NaN, and `isfinite` with it; `lgamma_r` returns its `[magnitude,
  sign]` pair; `scalars_or_empty` keeps empty collections; `max_by` breaks ties
  on the last maximum, as jq does; `inputs` yields an empty stream. On the Excel
  side: `PROPER`, `TRIM`, `SEARCH` (wildcards), `SUBSTITUTE` (an occurrence at
  position 0), `TEXT` (date format codes), `NUMBERVALUE` (percent signs and
  spaces), `CHAR` (bounded to 1–255), `ISEVEN`/`ISODD` (truncation),
  `WEEKDAY`/`WEEKNUM` (every return type), `ISOWEEKNUM`, `TIMEVALUE` (AM/PM),
  `BASE`/`BIN2HEX`/`DEC2HEX`/`OCT2HEX` (upper-case digits), `COMPLEX` (`-i`),
  `ERF`/`ERFC` (full double precision), `WEIBULL_DIST` (shape and scale),
  `T_TEST` (Welch degrees of freedom), `IRR`/`IRR_BY`/`XIRR` (`#NUM!` for a
  series with no root), the `TBILL` family (maturity within a year) and
  `COUPDAYS` (a real coupon period under actual/actual). Each is pinned by a
  case in the function-coverage suite; see `src/*/UPSTREAM-DIFFS.md`.

- **Excel wildcards are matched in linear time.** `SEARCH` and the `COUNTIF`
  family of criteria share one matcher that walks the text once. Compiling `*`
  to a regex's `.*` made a pattern carrying several stars exponential — a stray
  run of asterisks over an ordinary text field took tens of seconds, blocking an
  indexing worker or the browser's main thread.

- **`max_by`/`min_by` on an empty array yield `null`**, as `max`/`min` already
  did, rather than an empty stream.

- **Numeric literals accept an exponent.** `1e3`, `1E-3` and `5e-324` are
  single numbers in both readable and canonical-jq syntax, where the tokenizer
  previously ended the literal at the first digit and read the rest as a name.

### Removed

- **`BXL_BUILD_INFO.buildTime`.** Only a bundling step ever set it; the const
  now carries `version` and the `features` detection list.
- **The `bxl` and `bxl-sync` bins.** The CLI and the per-realm bundle-sync
  flow are not part of this package.

## [0.5.1] — 2026-08-02

### Fixed

- **Computed mutation targets are tolerant no-ops.** Derived Fields—including
  nested Card Info Fields—remain schema-addressable, but attempts to assign,
  replace, delete, or structurally edit them skip without evaluating the value,
  emit no intent, and report zero affected records. Query-backed and other
  read-only Fields continue to reject writes.
- **Relationship serialization cross-product coverage.** Source conformance now
  covers root, Card Info, and nested contained relationships across `linksTo`
  and `linksToMany`, recursive per-value metadata, relationship extensions,
  collection index shifts, and mixed RRI, relative, and absolute references.
  Reference resolution/formatting remains an explicit host boundary.

## [0.4.2] — 2026-08-02

- Superseded immediately by `0.5.1`; the source tag used the wrong release
  number. No npm package was published under `0.4.2`.

## [0.4.1] — 2026-08-02

### Fixed

- **Complete Boxel source serialization lowering.** Card-source mutations now
  coordinate attributes with Boxel's recursive `meta.fields` shapes and
  flattened relationship indexes for contained and relationship collection
  insert/delete/move/reorder operations, whole-value replacement, and copy.
  Composite `containsMany` metadata arrays, primitive `field.N` overrides,
  nested field metadata, compact JSON:API relationship data, empty to-many
  markers, and relationship extensions are preserved or reindexed exactly.
- **Fail-closed polymorphic inserts.** New Spec-like contained values can supply
  source-relative `adoptsFrom` and nested relationship sidecars through
  `serializeContainedValue`; mutations reject an untyped insertion into an
  already-polymorphic collection instead of silently producing invalid source.

## [0.4.0] — 2026-08-02

### Added

- **Immutable Boxel card-source mutation adapter.** Server-side clone/create
  tools can derive mutation schema from loaderless Boxel `Definition` graphs,
  project canonical `.json` source into the loaded-shaped planner model, and
  lower validated scalar and singular-relationship intents back into a cloned
  source document. Logical `cardInfo.theme` writes become dotted Boxel
  relationship records without exposing JSON:API storage paths to authors.
- **Source-preserving commit safety.** Card-source commits retain unknown
  authored data, document extensions, `meta.fields`, relationship metadata,
  and untouched relationships; remove stale relationship `data`; reject stale
  plans; and (as of 0.4.0) fail closed on collection-structural operations that
  require coordinated Boxel metadata or indexed-key rewrites.

## [0.3.1] — 2026-08-02

### Fixed

- **Readable selectors over primitive Card fields.** Primitive array items now
  retain an explicit empty item scope, so natural selectors such as
  `del(Tag[. = "obsolete"])` and their explicit bulk form
  `del(Tag[* . = "obsolete"])` lower to jq predicates on `.` for full Card
  schemas as well as field-root schemas.

## [0.3.0] — 2026-08-02

### Added

- **Mutation execution profile and Card-native DML.** Readable mutation
  statements and structured operations now lower to one typed, pure plan with
  exact-one selectors, explicit bulk intent, atomic sequential evaluation,
  scalar updates, assertions, copy/delete, contained collection operations,
  and loaded Card relationship intents.
- **Boxel `updateViaBxl` adapter.** Realm Cards derive mutation schema through
  `getFields(this)`, resolve relationship values through `getStore(this)`, and
  apply granular intents to their live Card Store-backed model. Contained
  inserts materialize their Field class, structural edits preserve identity,
  detached plans reject stale snapshots, and synchronous setter failures roll
  back earlier writes.
- **Streaming and AI tool-call surfaces.** Semicolon framing accepts arbitrary
  token chunks without releasing partial statements; `bxl-mutation-ops/1`
  offers the equivalent JSON operation encoding. The guide and Boxel handoff
  document model-written tool calls, structural statement shapes, root
  assertions, and source-first value copy.
- **Authorization execution profile.** Relationship rewrites now use an
  explicit `authorization` profile: a strict superset of `policy` that adds
  only the compiler-lowered OpenFGA graph forms (`direct`, `userset`,
  `userset_from`, and `except`) and BXL Authorization's authoring-time `via`
  form. Plain
  policy expressions and tuple conditions reject graph traversal, while
  authorization rewrites reject recursive authorization-kernel calls.

### Fixed

- **`reorder_by` keys use collection-item scope.** Programs such as
  `reorder_by(Bookings, Booking ID, order)` now compile the key to item-relative
  `.bookingId` instead of a root collection projection, so valid exact
  permutations no longer fail.
- **Inherited Card Info relationships are root-readable.** Natural statements
  such as `Theme = card(id)` now compile to the concrete `cardInfo.theme`
  relationship path without adding synthetic properties to snapshots or
  plans. Conflicting real root labels still take precedence.

## [0.2.0] — 2026-07-27

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
- **Browser corpus runner.** `pnpm demo:realm-collaboration` opens an
  interactive 18-case results page with stage/status filters and expandable
  source, input, expected/actual output, and compiled jq.

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
- **`tests/boxel/` test suite.** Covers the runtime null-tolerance and
  expression-factory behavior the realm depends on.
  Includes plain-data fixtures mirroring the hospital fixture.
- **Documentation reshuffle.** Migration guide at
  `docs/migration-from-jqxl.md`; full port log moved to
  `docs/internals/port-from-jqxl.md`.
  TypeDoc setup (`typedoc.json`, `pnpm docs:api`) generates an
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
