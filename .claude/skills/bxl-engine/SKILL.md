---
name: bxl-engine
description: Architecture of the BXL expression engine (`packages/bxl`) — how a formula gets from readable syntax to a value, how the builtin registry resolves libraries, and the invariants a change must preserve. Leads with the ones that fail silently rather than turning a test red — a coverage recorder that keeps passing while exercising a different dispatch route than production, a second `IF`/`IFS` implementation that registry-enumerated coverage structurally cannot see, a fast-path allowlist that truncates multi-output filters, and execution-profile safety lists that nothing checks against the registry. Use when editing or reviewing anything under `packages/bxl/src`, adding or fixing a builtin, writing or changing function-coverage cases, or working out why a formula behaves differently in the suite than it does in a card.
---

# BXL engine — architecture and the invariants a change must preserve

`packages/bxl` is the expression engine: a vendored jq runtime (`src/jqtools/`),
a vendored Excel formula library (`src/formulajs/`), and BXL's own readable
syntax, linter, formatter, registry bridge, authorization and mutation
subsystems (`src/bxl/`, `src/authorization/`, `src/mutation/`). It ships raw
erasable TypeScript with `.ts` import specifiers — Node runs the sources
directly, the host bundles them, and there is no build step to go stale.

This skill is for people changing the engine. Card authors writing formulas
want `packages/bxl/README.md` and `packages/bxl/docs/` instead — the syntax
surface, the tag choice, the profile constraints as an author meets them.

Several of this package's invariants are enforced by the suite; the ones worth
a skill are the ones that are not, because their violation leaves every test
green while the thing under test quietly changes.

## How a formula becomes a value

```
source ── compileReadableSyntax ──▶ canonical jq text     src/bxl/compiler/readable-syntax.ts
       (skipped when readableSyntax: false — the jq tag)
  │  Tokenizer → Parser                                   src/jqtools/parser/
  ▼
AST
  │  annotateBuiltinFilters      resolve each call against the registry
  │  compileScalarExpression     try to compile the WHOLE program to scalars
  ▼
either  compiledScalar(input)        one call, no jq machinery   src/jqtools/evaluate/compiledScalar.ts
or      evaluateWithRegistry(ast)    streaming Item iterators     src/jqtools/evaluate/evaluate.ts
  │  outputs unwrapped, then recordRuntimeOutput
  ▼
outputs[]
```

`annotateBuiltinFilters` (`src/bxl/bridge/native.ts`) walks the AST once and
stamps each `filter` node with the implementation it resolved: `resolvedJq` if
the registry has a jq-source definition at that `NAME/arity`, otherwise
`resolvedNative`. **A jq definition at a key permanently hides a native at the
same key** — in the annotator and in the evaluator both. The same pass marks
each node `singleOutput`, which is what lets the evaluator evaluate an argument
without materializing a stream.

`compileScalarExpression` then tries to compile the entire expression into one
`(input) => unknown` function. It succeeds only if every node compiles;
anything it does not handle — `if`/`try`/`reduce`/`foreach`, a jq-source
builtin other than `IF`/`IFS` (which it intercepts by name; see below), a
native outside its allowlist — makes the whole program fall back to the
streaming evaluator. So the fast path is all-or-nothing per program, and a
formula's route depends on its shape, not on a flag.

`runParsedNativeProgram` picks between them: the compiled scalar runs **only
when the caller passed no explicit `runtimeLimits`**. Explicit limits force the
streaming route, because step metering (`checkRuntimeBudget`) lives in the
evaluator's loops and the compiled scalar has none. Output accounting
(`recordRuntimeOutput`) runs on both routes, and default limits still apply —
`withRuntimeDiagnostics` normalizes `undefined` to the defaults in
`src/jqtools/evaluate/runtimeState.ts`.

Two things follow, and both are load-bearing:

- **Anything added to `compiledScalar.ts` runs unmetered.** It must be bounded
  by the size of its input, never by anything the program controls.
- **The two implementations must agree exactly.** Where the same function
  exists on both routes, a change to one is a change to half of production.

## The builtin registry

`src/bxl/registry/index.ts` composes `BXL_REGISTRY` from the core jq library
plus BXL's own, and `BUILTIN_LIBRARY_NAMES` is the single roster everything
else derives from: `BuiltinLibraryName`, the lazy list
(`LAZY_BUILTIN_LIBRARIES` = the roster minus the eager ones), the lazy loader's
work list, and the coverage gate's expectations.

`resolveRegistry` (`src/jqtools/evaluate/filters/registry.ts`) copies each
requested library's `jq` and `native` maps in order with `Object.assign`, so
**resolution is last-wins**: a later library's entry hides an earlier one's at
the same key. It then computes `publicNames` (dropping `_`-prefixed helpers and
the sandbox-blocked `env/0`) and **rebuilds `native['builtins/0']`** so the name
list it reports matches the set that resolved. Resolutions are cached per
library set; `registerBuiltinLibrary` clears that cache.

Lazy families (`formula-statistical`, `formula-bessel`, `formula-engineering`,
`formula-financial`, `validation`) register themselves when their chunk loads.
`src/bxl/bridge/lazy-formulas.ts` decides a chunk is needed by matching the
program — its AST for the prepared/async entry points, its source text for the
expression-list entry point — against that family's **manifest**
(`src/bxl/bridge/*-manifest.ts`). Consequences:

- A name the manifest lists but the library does not register sends the loader
  to fetch a chunk that still cannot answer.
- A name the library registers but the manifest omits never triggers the load,
  so the function is simply absent when the program runs.
- Only the async entry points auto-load. Synchronous `evaluateBxl` on a
  financial formula raises `'PMT/3' is not defined` unless
  `loadAllFormulaExtensions()` ran first — which also appends every lazy family
  to `DEFAULT_BUILTIN_LIBRARIES` **in place**, so callers holding that array see
  the additions.

The coverage gate (`tests/unit/fixtures/function-coverage/gate.ts`) checks all
of this before any case runs, in both directions, so a drift fails loudly.

**Shadowing is a decision, not an accident.** The default card set resolves
`core` then `formula`, so Excel's `INDEX/2` wins over jq's object-builder —
and takes jq's `INDEX/1` with it, since that definition delegates to whichever
`INDEX/2` resolved:

```
libraries: default      INDEX(.[]; .id)  →  throws "Cannot index array with string"
libraries: ['core']     INDEX(.[]; .id)  →  {"1": {...}, "2": {...}}
```

Every such collision is recorded in `SHADOWED_BUILTINS` with which version the
platform answers to, checked in both directions — an unrecorded collision fails,
and so does a recorded one that no longer happens. The linter reports the
two-argument jq call shape as `jq-index-shadowed-by-excel`. A coverage case
reaches a shadowed builtin by narrowing its `libraries`.

## Silent-failure invariants

### The coverage recorder must preserve dispatch shape

`tests/unit/fixtures/function-coverage/runner.ts` credits coverage by observed
invocation: it replaces every library with a recording equivalent before the
registry resolves, so a case naming `ROUND/2` whose program never reaches
`ROUND/2` fails instead of quietly counting.

Native filters come in two shapes. A **bare** filter takes and yields raw
values and carries a `bareNativeFilter` handle stamped by
`wrapBareNativeFilters`; a plain `NativeFilter` takes and yields `Item`s
(`{ value, path }`). Both the streaming evaluator
(`evaluateNativeFilterCall` → `evaluateBareNativeFilterCall`) and the
compiled-scalar path check for that handle and call the bare filter directly
when it is there. So the handle is not a detail of the type — **it selects the
dispatch route**.

A recording wrapper that honors the `NativeFilter` contract but does not carry
the handle forward is behavior-preserving and therefore invisible: results are
identical, every case still passes, and every formula function has moved off the
route production takes. Wrapping the _bare_ function and re-wrapping the result
through `wrapBareNativeFilters` is what keeps the route intact. Confirming the
trap takes one probe: the object `prepareNativeJqForRuntime('ROUND(1.2345, 2)')`
returns carries the compiled scalar, which is a function against the real
registry and `undefined` against a handle-dropping one — while both answer
`1.23`.

`builtins/0` needs a second wrap, on the **resolved** registry: `resolveRegistry`
rebuilds it after copying the libraries in, discarding the recorder installed on
the library entry. That one fails loudly (`the program never invoked
builtins/0`) but not obviously, so the runner does it once per resolved registry,
memoized in a `WeakSet`.

Install the recorder **after** `loadAllFormulaExtensions()`, or the lazy
families register unwrapped copies of themselves after the wrap.

### `SINGLE_OUTPUT_BARE_NATIVE_FILTERS` truncates anything multi-output

`compileBareNativeFilter` takes `iterator.next()` and discards the rest. The
allowlist in `compiledScalar.ts` is a promise that each named filter emits at
most one value; a multi-output filter added to it silently loses every value
after the first, with no test anywhere going red — adding `range/2` turns
`range(0;3)` from `[0,1,2]` into `[0]` and leaves the whole package suite green.
Registry-enumerated coverage cannot see it either: the function is still invoked
and still returns _a_ value.

Adding a name here means checking the implementation yields exactly once on
every path, and adding a case whose program stays wholly scalar so it actually
routes through the fast copy.

### `IF` and `IFS` have a second implementation

`compiledScalar.ts` compiles `IF/2`, `IF/3` and every `IFS/*` arity itself,
ahead of the allowlist check. A wholly scalar-compilable program never reaches
the registry, so for a simple formula those compiled copies are the live
implementation and the `def IF` / `def IFS` definitions in
`src/bxl/bridge/formula-contrib-jq.ts` are the dead ones:

```
IF(.count > 3, "big", "small")            → compiled-scalar copy
IF(ISBLANK(.count), "blank", "set")       → registry definition (ISBLANK is not scalar-compilable)
IFS(.count > 3, "big", .count > 1, "mid") → compiled-scalar copy
```

Registry-enumerated coverage structurally cannot reach the fast-path copy — a
case only earns credit by invoking the registry entry, which means forcing the
builtin route (the coverage cases use a blank guard for exactly this). Someone
fixing `IFS` in the registry can therefore leave the version that actually runs
for most card formulas untouched and watch the coverage gate go green.

The exposure is one-directional. Changing the compiled copy is caught, because
other suites assert results from wholly scalar programs and so pin its behavior
incidentally — inverting the branch in `compileExcelIf` turns
`bxl-formula-cli`, `excel-paste-cli`, `boxel-runtime`, `boxel-runtime-async`
and `compiler-readable` red while the coverage gate prints its usual line.
Changing only the registry copy is what nothing notices. Keep the two in step
by hand, and pair a registry-route case with a wholly scalar one when the
behavior matters.

Both copies read a condition with **jq truthiness** — only `null` and `false`
are false, so the number `0` takes the true branch where Excel takes the false
one. That is a documented divergence, not a defect; it must stay the same on
both routes.

### Derive expectations independently; never record what the implementation returns

Nothing enforces this, and it is the whole difference between a coverage matrix
that finds defects and one that ratifies them. Prefer values that are checkable
without running the code: closed forms, exact quotients, hand-worked schedules,
identities, and inversions of a case whose root is known. The financial tables
show the shape — zero-rate TVM results are exact quotients, nonzero-rate anchors
come from hand-amortized two-period loans with repeating decimals written as
fractions, and solver cases (`RATE`, `IRR`, `XIRR`) invert a closed form.

Where references disagree about a function, the published specification and the
answers real Excel gives outrank any second implementation of it. A `tolerance`
must sit **below the smallest term the case exists to prove** — a tolerance wide
enough to admit an implementation that drops that term proves nothing.

A function that diverges from its specification keeps the correct assertion and
takes a `knownDefect` note plus a `produces` recording what it returns today.
The runner then inverts the case: it must keep failing, must keep failing the
documented way, and reports itself the moment it starts passing. Fixing the
function means deleting both fields — `produces` exists so a defect cannot
change shape (a different wrong value, or a throw where there was a value) while
the case stays green. Known-defect cases are not skipped: a skipped case invokes
nothing, so it would fall out of the coverage gate and the suite would report
full coverage over untested functions.

### Every case runs under every zone, and module scope escapes the sweep

`COVERAGE_ZONES` spans both ends of the offset range, whole/half/quarter-hour
offsets, and DST in both hemispheres. The sweep is unconditional rather than
opt-in, because a case that reads a date is not always obvious from its source.
This is a product invariant before it is a test one: indexing evaluates
computeds server-side in UTC while a viewer's browser evaluates them locally, so
a result that shifts with the host is a wrong value in a card, not just a flaky
test.

The runner switches zones by assigning `process.env.TZ` between runs — that is,
after this package's modules have loaded. **A host-zone value hoisted to module
scope is frozen at whatever the zone was at process start** and agrees with
itself across every zone the sweep tries, which reads as a pass. Read the zone
inside the function under test. A `check` is handed a `ZoneContext` for the few
filters whose job is to report the host zone.

`process.env.TZ` has no browser equivalent, so this sweep is node-only. A
zone-sensitive claim proven here is not re-proven by the host integration
suites; they prove the plumbing, not the zone matrix.

### Execution-profile safety defaults to "allowed"

`src/bxl/profiles/function-safety.ts` classifies function names into categories
(`aggregate`, `volatile`, `controlOrSideEffect`, `errorMasking`, `metadata`,
`predicateLowerable`, `boundedScalar`, `authorization`) and
`BXL_PROFILE_FUNCTION_POLICIES` turns those into per-profile decisions. The
`predicate` profile uses an **allowlist**, and `validatePredicateNode` bans any
call that does not come back `allow` — so a name with no category at all is
denied there, along with every other unlisted name. Every other profile —
`derive`, `mutation`, `policy`, `authorization` — uses a **denylist**, and their
validators in `src/bxl/ast/index.ts` raise nothing at all for a name that comes
back `unclassified`.

That is the right default for the large majority of names (a pure scalar like
`ABS` needs no entry), and it is why nothing enumerates the registry against
these lists. The cost is that a **newly added function in any of those
categories — volatile, aggregate, side-effecting, error-masking,
metadata-reading — is permitted in every denylist profile until someone adds it
to the right set**, including `derive`, which is what `computeVia` runs under,
where a volatile call means a computed field that changes on every index. Classification is by base name, case-folded and without
arity, so jq's `now` and Excel's `NOW` are one entry.

### Vendored divergence is recorded, and the record is prose

`src/jqtools/UPSTREAM-DIFFS.md` and `src/formulajs/UPSTREAM-DIFFS.md` audit,
file by file, how each vendored subsystem diverges from upstream — filters
added, stubs filled, semantics deliberately changed. A divergence this codebase
documents there is not a defect: a coverage case asserts the documented
behavior and notes it.

Nothing executes those files, so they can disagree with the code. Read the
registry entry before trusting a claim about argument order or about how many
entries a name has — `atan2/2` (jq/POSIX `(y; x)`) and `ATAN2/2` (Excel
`(x, y)`) are two separate live entries that differ in argument order and in
what they do with `(0, 0)`, and the readable compiler routes between them by the
name that was written. Update the audit in the same change that moves the code.

## Cards reaching jq

`bxl()` / `expression()` (`src/index.ts`) builds the `computeVia` function a
card field holds. Between the card graph and the evaluator sits
`materializeCardInput` (`src/bxl/bridge/card-input.ts`): a lazy view that
materializes fields as the program touches them and, on re-entering a value
already on the current traversal path, yields a bounded `{ id }` reference
instead of recursing — the same clip the platform's `queryableValue` applies.
Card graphs are legitimately cyclic; jq's data model is not.

Two rules at that boundary:

- **Outputs shed the view before anything measures or stores them.**
  `runParsedNativeProgram` unwraps first and calls `recordRuntimeOutput` on the
  unwrapped value, because output accounting stringifies what it is given —
  measuring the lazy view would materialize every card the value can reach.
- **Field metadata arrives out-of-band.** This package never imports
  `card-api`; a `https:` specifier would break every consumer that runs outside
  a realm. Card-api stamps its own `getFields` onto instances under a
  cross-realm symbol, with `globalThis.__cardstackGetFields` as the ambient
  fallback. Keep both bridges working — the symbol is what stays correct when
  several loader universes are alive at once.

Excel error sentinels thrown out of a program (`#N/A`, `#DIV/0!`, …) are caught
at this boundary and surfaced as `null`, so a bad formula leaves a blank field
instead of tearing down an indexing render. The materialization depth-cap error
is deliberately excluded from that catch, so a fail-fast error is not demoted to
a blank field by a card property named after a sentinel.

## Package conventions

- **Strict layering**: `jqtools/` and `formulajs/` import neither each other nor
  `bxl/`; `bxl/` imports both. This is a convention, not a lint rule — the
  vendored subsystems stay independently auditable against upstream only as long
  as it holds.
- **Erasable TypeScript only** (no `enum`, no `namespace`, no decorators, no
  `import =`), `.ts` import specifiers throughout. Node's native type stripping
  runs the sources as-is; repo lint enforces the erasable subset.
- **UPPERCASE names are reserved for real Excel functions**, lowercase for
  jq/BXL-native helpers, and preserved upstream APIs (validator.js) keep their
  established casing.
- Any parser or compiler change carries a regression test under `tests/unit/`
  (`tests/unit/compiler-bug-regressions.ts` is the pattern), plus a matching
  note in `docs/grammar.ebnf` when the public surface shifts.

Suites are standalone entry points asserting with `node:assert`. `pnpm test`
runs everything, `pnpm test tests/unit` runs one directory, and
`node tests/unit/function-coverage-cli.ts` runs one suite. CI runs the package suite
on any change under `packages/bxl/**`; the host integration suites
(`packages/host/tests/integration/bxl-*.gts`) cover what only a real card can
prove — the platform module shim, `computeVia` on live instances, each lazy
chunk loading inside the host bundle, and the cyclic-graph guard through the
indexing path.

## Key files

Paths are relative to `packages/bxl/`.

- `src/bxl/bridge/native.ts` — parse, annotate, choose a route, run
- `src/jqtools/evaluate/compiledScalar.ts` — the scalar fast path and its allowlist
- `src/jqtools/evaluate/evaluate.ts` — the streaming evaluator and native dispatch
- `src/jqtools/evaluate/filters/lib/nativeFilter.ts` — `NativeFilter` vs bare, and the handle
- `src/jqtools/evaluate/filters/registry.ts` — `resolveRegistry`, `publicNames`, `builtins/0`
- `src/bxl/registry/index.ts` — `BXL_REGISTRY`, the library roster, resolution cache
- `src/bxl/bridge/lazy-formulas.ts` + `src/bxl/bridge/*-manifest.ts` — chunk loading
- `src/bxl/bridge/formula-contrib-jq.ts` / `-native.ts` — the Excel library
- `src/bxl/profiles/function-safety.ts` — per-profile call classification
- `src/bxl/bridge/card-input.ts` — the lazy, cycle-guarded card view
- `src/jqtools/evaluate/runtimeState.ts` — limits, budget, output accounting
- `tests/unit/function-coverage-cli.ts` — the registry-enumerated coverage gate
- `tests/unit/fixtures/function-coverage/` — `runner.ts` (recording, zones),
  `gate.ts` (registry invariants), `case.ts` (the case contract), family tables
- `tests/README.md` — what to know before writing a coverage case
