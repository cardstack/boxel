# Null-tolerance / runtime-resilience changes from jqxl → bxl

Tracking the runtime-tolerance work done in
`realms-staging.stack.cards/ctse/working-loon/jqxl*` so we can re-apply the same
patches against the bxl successor (`/Users/chris/Projects/bxl`).

The motivation: Boxel cards have nullable everywhere — fields may be absent,
linksToMany cards may not yet be loaded, EHR-style data has type irregularities
(strings where numbers expected, etc.). Standard jq is strict, so each null hop
throws. We made the runtime tolerant so .gts files can stay declarative and
write `expression('.patients | map(.fullName)')` without `?` operators or
defensive jq.

## Files touched

| Path (in working-loon jqxl) | Equivalent in bxl |
|---|---|
| `jqxl.ts` | `bxl.ts` |
| `jqxl/native.ts` | `bxl/native.ts` |
| `jqxl/evaluate/evaluate.ts` | `bxl/evaluate/evaluate.ts` |
| `jqxl/evaluate/applyBinary.ts` | `bxl/evaluate/applyBinary.ts` |
| `jqxl/evaluate/utils/utils.ts` | `bxl/evaluate/utils/utils.ts` |
| `jqxl/evaluate/filters/builtinNativeFilters.ts` | likely `bxl/evaluate/filters/builtinNativeFilters.ts` |

## 1. `expression()` — planner fallback (top-level wrapper)

**File:** `jqxl.ts` (`expression()` function, ~line 1396)

When `evaluateJqxl()` (the planner-driven path) throws
`JqxlRuntimeError` with code `unsupported_collection_expression` or
`unsupported_root_expression`, fall back to a lazy-proxy evaluation
(`evaluateJqxlLazy`) instead of bubbling the error.

**Net effect:** `.gts` files can use `computeVia: expression('.patients | map(.fullName)')`
for any expression — the conservative planner is tried first; complex
collection traversals fall through to the lazy proxy. Both paths share the
same `stableValueCache` and `refreshJqxlSubscriptions` for live-host
reactivity. No more function-based computeVia + manual snapshot pattern in
.gts files.

```ts
try {
  evaluation = evaluateJqxl(this, expression, options, options.as);
} catch (planError) {
  if (
    planError instanceof JqxlRuntimeError &&
    (planError.code === 'unsupported_collection_expression' ||
      planError.code === 'unsupported_root_expression')
  ) {
    evaluation = evaluateJqxlLazy(this, expression, options, options.as);
  } else {
    throw planError;
  }
}
```

`evaluateJqxlLazy` is a private helper that builds a lazy proxy (via
`createLazyValue`), runs jq, and returns the same `{ rawValue, value,
diagnostics }` shape the rest of `expression()` expects.

## 2. New top-level helpers

**File:** `jqxl.ts`

- `export function evaluateOnCard(model, expression, options)` — public wrapper
  that runs jq against a lazy-proxy view of a card. Useful when you're
  outside `expression()` and want to evaluate jq against a card without
  the planner.
- `export function snapshot(model)` — deep-walk a card into a plain JSON
  object including computed fields. Re-entry guard via module-level
  `WeakSet<object> ACTIVE_SNAPSHOT` so recursive snapshot calls (a
  computeVia that itself calls `snapshot(this)`) short-circuit to `null`
  instead of infinite-looping.

## 3. Lazy proxy: empty-array coercion for plural fields

**File:** `jqxl.ts` (object-proxy `get` handler in `createLazyValue`)

When a property the consumer reads has `fieldType === 'containsMany'` or
`'linksToMany'` and the underlying value is `null`/`undefined`, return an
empty-array lazy proxy instead of `null`. Prevents `[null].iterate` paths.

```ts
let raw = (value as Record<string, unknown>)[prop];
if (raw == null) {
  let fieldType = safeFieldMap(value)?.[prop]?.fieldType;
  if (fieldType === 'containsMany' || fieldType === 'linksToMany') {
    return createLazyValue([], state, nextPath);
  }
}
return createLazyValue(raw, state, nextPath);
```

## 4. `serializeValue` — optional include-computeds

**File:** `jqxl.ts` (`serializeValue`, ~line 174)

Added `options: { includeComputeds?: boolean } = {}` param and threaded
it into recursive calls + `enumerablePropertyNames`. Used by the new
`snapshot()` export with `{ includeComputeds: true }` so jq can read
computed fields on the snapshot.

## 5. `evaluateExpression` — onError / defaultValue support

**File:** `jqxl.ts` (`evaluateExpression`, ~line 1289)

Wrapped `runNativeJq` in try/catch. When `options.onError === 'default'`,
catch evaluate-time errors and return `{ value: defaultValue ?? null,
error, ... }` instead of throwing. Same options shape `expression()`
already supported.

## 6. Iterator (`.[]`) tolerates null

**File:** `jqxl/evaluate/evaluate.ts` (~line 507, the `'iterator'` case)

Added `case 'null': break;` so `null[]` yields an empty stream instead of
throwing `null is not iterable`. Standard jq strictness preserved for
non-null wrong types (numbers, strings, etc. still throw).

```ts
case 'null':
  break;
```

## 7. Arithmetic operators tolerate null/undefined

**File:** `jqxl/evaluate/applyBinary.ts` (`applyNormalBinaryOperator`)

Top-of-function early return: `-`, `*`, `/`, `%` propagate null when either
operand is `null`/`undefined`. `+` keeps identity behavior (null + n = n,
null + null = null, with both null/undefined accepted via `==` loose check).

```ts
if (op === '/' || op === '*' || op === '-' || op === '%') {
  if (left == null || right == null) {
    return null;
  }
}
```

Inside each case, also added per-case guards using `left == null || right == null`
(the `someOfType(Type.null, ...)` helper only matched `null`, not
`undefined`, which leaked through for missing-key Boxel fields).

Division/mod by zero — replaced `throw divisionByZeroError()` with
`return null` so the runtime stays resilient.

## 8. `assertString` / `assertNumber` — null-coercion

**File:** `jqxl/evaluate/utils/utils.ts`

```ts
export function assertString(value: any): string {
  if (value === null || value === undefined) return '';
  if (typeOf(value) !== Type.string) {
    throw new JqEvaluateError(`Got ${typeOf(value)}, string expected`);
  }
  return value;
}

export function assertNumber(value: any): number {
  if (value === null || value === undefined) return 0;
  if (typeOf(value) !== Type.number) {
    throw new JqEvaluateError(`Got ${typeOf(value)}, number expected`);
  }
  return value;
}
```

Filters that pass null into a context expecting string get `""` (so e.g.
`null | startswith("X")` → false). Numeric contexts get `0`. Wrong
non-null types still throw — this is targeted to Boxel's "field not yet
loaded" pattern, not a blanket type-coercion.

## 9. `startswith/1` and `endswith/1` — use assertString return value

**File:** `jqxl/evaluate/filters/builtinNativeFilters.ts`

The previous code called `assertString(input)` for its side-effect only
(throw if not a string), then used the original `input` (still null) in
`input.startsWith(...)`. With the new tolerant `assertString`, the
function returns a coerced `""` but the call site discarded it. Fixed:

```ts
*'startswith/1'(input: unknown, str: unknown) {
  const i = assertString(input);
  const s = assertString(str);
  yield i.startsWith(s);
},
*'endswith/1'(input: unknown, str: unknown) {
  const i = assertString(input);
  const s = assertString(str);
  yield i.endsWith(s);
},
```

Audit other filters in the same file that follow the same
"`assertString(...)` for side effect" pattern and convert them to use
the return value.

## 10. `jq` tagged-template helper for raw jq strings

**File:** `jqxl.ts` (new export `jq`)

In a regular JS/TS string literal, jq's interpolation syntax `\(...)` gets
silently mangled — JS treats `\(` as an unrecognized escape and drops the
backslash, so `'\(.foo)'` reaches the runtime as `'(.foo)'` and
interpolation never happens. The `jq` tagged template wraps `String.raw`
so backslashes survive untouched.

```ts
// Without — needs `\\(` in source so `\(` reaches jq
expression('"\\(.bpSystolic)/\\(.bpDiastolic)"')

// With — natural jq syntax inside backticks
import { expression, jq } from '../jqxl';
expression(jq`"\(.bpSystolic)/\(.bpDiastolic)"`)
```

Implementation:

```ts
export function jq(strings: TemplateStringsArray, ...values: unknown[]): string {
  let raw = strings.raw;
  return raw.reduce(
    (acc, segment, i) =>
      acc + segment + (i < values.length ? String(values[i]) : ''),
    '',
  );
}
```

The `expression()` signature stays simple — `(string, options?)` — so
options usage doesn't get awkward. The `jq` helper is opt-in for any call
that contains `\(...)` and looks natural at the call site:
`expression(jq\`…\`, { as: SomeField })`.

When porting to bxl: ship the same `jq` export. Encourage it in docs for
any expression containing `\(`. Most expressions don't need it (no
interpolation, no special chars), so usage remains incremental.

## 11a. Tag-driven mode dispatch (`jq` / `fx`) + `as` materialization

**File:** `src/index.ts`

The recommended call-site convention is now:

| Form | Behavior |
|---|---|
| `expression(jq\`…\`)` | plain jq, **readableSyntax off** |
| `expression(fx\`…\`)` | Excel-like BXL syntax, **readableSyntax on** |
| `expression('…')` | plain string → readableSyntax on (default BXL behavior) |

Both `jq` and `fx` are tagged-template helpers that return a branded
`BxlTaggedSource` object (`{ [BXL_MODE]: 'jq' \| 'fx', source, toString }`).
`bxl()` detects the brand and sets `readableSyntax` accordingly. Explicit
`{ readableSyntax: ... }` in options always wins over the tag default.

```ts
const BXL_MODE = Symbol.for('@cardstack/bxl.mode');

export interface BxlTaggedSource {
  readonly [BXL_MODE]: 'jq' | 'fx';
  readonly source: string;
  toString(): string;
}

export function jq(strings, ...values): BxlTaggedSource { /* mode 'jq' */ }
export function fx(strings, ...values): BxlTaggedSource { /* mode 'fx' */ }
```

**Materialization (`{ as: SomeFieldDef }`):** ported from jqxl. When the
expression's raw output is structured (object or array of objects), the
factory instantiates the given class via `new` and copies fields onto it.
Fixes Boxel's "could not identify card: Object" serializer error for
`contains(...)` / `containsMany(...)` computed fields.

```ts
function materializeShape(raw: unknown, ShapeClass: new () => unknown) {
  if (raw == null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const instance = new ShapeClass();
  for (const [k, v] of Object.entries(raw)) (instance as any)[k] = v;
  return instance;
}
```

This is intentionally minimal — no `getFields` lookup, no nested
recursion. Works for the flat field shapes we have today
(`ChargeLeaderField`, `RevenueSummaryField`, etc.). Add a fieldMap-aware
recursive variant later if a deep-nested computed shape needs it.

## 11. `bxl()` defaults to `readableSyntax: false`

**File:** `src/index.ts` (`bxl()` factory)

The factory function `bxl()` (re-exported as `expression`) now defaults
`readableSyntax: false` in the merged options it forwards to
`evaluateBxl`. Without this, BXL's `compileReadableSyntax` runs on every
expression *before* the jq tokenizer/parser, and rewrites pure-jq
constructs in ways that break the parser:

- `if … then … else … end` → keyword `if` becomes `IF` (uppercase),
  causing the parser to choke at `then`
- Numeric ops can be reshaped into `ROUND(... ; n)` calls

With `readableSyntax: false`, plain jq is passed straight through.
Anyone wanting readable BXL syntax opts in:
`expression(src, { readableSyntax: true })`.

```ts
export function bxl(expression: string, options: BxlOptions = {}) {
  const merged: BxlOptions = { readableSyntax: false, ...options };
  return function computeViaReadableBxl(this: object) {
    return evaluateBxl(expression, this, merged).value;
  };
}
```

This made working-loon's hospital expressions (which are pure jq) drop
into BXL unchanged.

## 12. PascalCase → camelCase fallback in readable-syntax compiler

**File:** `src/bxl/compiler/readable-syntax.ts`

Single-word PascalCase identifiers now compile to a `.camelCase` field
path even when no schema is provided. Lets users write `fx\`Severity ==
"High"\`` and have it compile to `.severity == "High"` without first
threading a schema through. The rule is intentionally narrow:

- `Severity` → `.severity`
- `BpSystolic` → `.bpSystolic`
- `PatientName` → `.patientName`
- `"Bp Systolic"` (quoted, multi-word) → still requires schema (no
  fallback applied, since the camelCase mapping is ambiguous)
- `severity` (lowercase) → no fallback; existing schema-driven path
- `SUM` (would-be field) → already short-circuited by the call-site
  check that bails out when the next token is `(`, so function calls
  win

Helper:

```ts
function pascalCaseToCamelKey(label: Token): string | null {
  if (label.type !== 'ident') return null;            // not a quoted string literal
  if (!/^[A-Z][A-Za-z0-9]*$/.test(label.value)) return null;
  if (!/[a-z]/.test(label.value)) return null;        // skip ALL-CAPS (`AND`, `ID`)
  const lower = label.value.toLowerCase();
  if (KEYWORDS.has(lower) || LITERALS.has(lower)) return null;
  return label.value[0]!.toLowerCase() + label.value.slice(1);
}
```

Hooked into all four resolution sites in `Compiler.tryCompilePath`:
top-level identifier, `.foo`, `?.foo`, and chained `.foo.bar`. In each
case `resolveField()` runs first; only when it returns nothing does the
fallback try. So schema-driven authoring keeps full priority — labels
like `"Bp Systolic"` and explicit overrides still win.

**Schema gate.** Each fallback site is gated on `!scope` — i.e. the
fallback only fires when no schema is in scope. With a schema, every
unrecognized PascalCase token is left as-is (so context-variable paths
like `@User.Departments` survive verbatim instead of being silently
mangled to `.departments`). Without a schema (the realm pattern), the
fallback fills in the camelCase mapping.

**Token-type gate.** The fallback only applies to `ident` tokens, not
quoted strings. Otherwise a predicate like `Category = "Hardware"`
would camelCase the RHS string literal into a `.hardware` field path.

**Operator/keyword exclusions.** The regex requires at least one
lowercase letter (so `AND`/`OR`/`NOT`/`XOR`/`ID`/`URL` are skipped),
and the helper bails on any token that maps to a jq keyword
(`if`/`then`/`else`/`end`/…) or BXL literal (`true`/`false`/`null`)
case-insensitively. This keeps BXL's fuzzy-input mode (`If total > 50
Then "x" Else "y" End`) intact — the path parser backs out when the
first token is a control keyword and the higher-level expression
parser handles it.

This unlocks ~80% of Phase A's readability win (see "schema inference"
in section 11a TODOs) at runtime cost of one regex test per identifier,
no caching, no schema derivation. Array iteration (`Patients[all]…`,
`Patient[Severity = "Critical"]`) still needs a schema or jq-style
brackets, since the compiler has to know the field is an array to emit
the right code.

> **Note on naming for BXL.** If/when BXL grows an Excel-formula-mode tag
> (parallel to the jq mode), use **`fx`** as the tagged-template name —
> e.g. `expression(fx\`SUMIFS(...)\`)`. Mirrors spreadsheet `fx`
> nomenclature, reads naturally next to `jq\`…\``, and keeps both modes
> opt-in at the call site.

## 13. JQ control-keyword guard for the function-call branch

**File:** `src/bxl/compiler/readable-syntax.ts` (function-call branch in
`Compiler.compile`)

`canonicalFunctionName('if')` returns `'IF'` because `IF` is in
`FORMULA_FUNCTIONS`. So when a user wrote idiomatic jq

```jq
if (.x // 0) == 0 then 0 else .x end
```

the compiler entered the function-call branch (because `if` is followed
by `(` for the parenthesized condition), produced `IF(.x // 0) == 0
then 0 …`, and the parser then choked on the dangling `then`.

Fix: skip the function-call branch entirely when the identifier is a
reserved jq control keyword. `JQ_KEYWORDS` (re-exported as `KEYWORDS`)
covers `if`, `then`, `else`, `elif`, `end`, `as`, `try`, `catch`,
`reduce`, `foreach`, `def`, `and`, `or`, `not`, `label`, `break`.

```ts
if (
  token.type === 'ident' &&
  this.tokens[this.index + 1]?.type === 'punc' &&
  this.tokens[this.index + 1]?.value === '(' &&
  !KEYWORDS.has(token.value) &&    // case-sensitive: `IF` is Excel, `if` is jq
  …
) {
  // function-call branch
}
```

After this guard, the `(…)` after `if` is picked up by the paren-grouping
branch and the rest of the jq form (`then`/`else`/`elif`/`end`) flows
through `canonicalTokenSource`, which already lowercases reserved
keywords. End result: idiomatic jq passes through readable mode
verbatim, no `jq\`…\`` tag required.

**Case sensitivity matters.** The `KEYWORDS.has(token.value)` check
is case-sensitive on purpose — uppercase `IF(empty; 1; 0)` is the
Excel function, lowercase `if (.x // 0) == 0 then …` is jq syntax.
Lowercasing the token before the check would suppress the Excel
dispatch and break `IF`/`IFS`/`IFERROR` in readable mode. The
PascalCase-fallback (§12) handles its own case-insensitive guard
internally so `If`, `Then`, `Else`, `End` in fuzzy-input mode still
back out of path parsing and fall through to the jq-keyword path.

## 14. Subclass / inheritance polymorphism (gigantic-crawdad evidence)

**File (in the realm, not BXL):** `Hospital/hospital-icu-patient.gts`

`HospitalIcuPatient extends HospitalPatient` adds three raw fields
(`icuAdmissionDate`, `ventilatorRequired`, `gcsScore`) plus three
ICU-specific computeds in mixed jq / fx / plain-string modes. An
instance with `adoptsFrom.name = "HospitalIcuPatient"` is linked into
the operations card's `linksToMany(HospitalPatient)` collection as
`patients.13`.

What this validates in BXL:

- `getFields(icuInstance)` enumerates inherited + own fields. Our
  `materializeAs` path uses `safeFieldMap` → `getFields`, so the
  inherited shape is correctly walked when constructing
  `{ as: ChargeLeaderField }` results that involve a polymorphic patient.
- The PascalCase fallback resolves both inherited (`Severity`) and
  ICU-only (`GcsScore`, `IcuAdmissionDate`) identifiers in one
  expression — no schema, no override.
- Jq-tag interpolation `\(…)` survives the bundle (because of the `jq`
  tagged-template helper using `String.raw`).

When porting to bxl, the equivalent test fixture should be plain JSON
objects with a parent + child class shape, since BXL itself is
class-shape-agnostic — see the testing strategy doc for the fixture
plan.

## 15. Probe fields — the gigantic-crawdad test surface

**File (in the realm):** `Hospital/hospital-patient.gts` —
`probe*`-prefixed computeds.

Each probe is named after a single quirk it exercises so failures isolate
the broken path:

| Field | Tests |
|---|---|
| `probeRiskFlag` | Cascading-computed reference (`.fxIsHighRisk`) + plain-string `if/then/else` + PascalCase fallback (`FxIsHighRisk` → `.fxIsHighRisk`) |
| `probeAdmissionQuarter` | Multi-line plain-string + PascalCase identifier + `if/elif/elif/else/end` chain + string-date range comparison (no `strptime`) |
| `probeAdmissionState` | Plain-string `if/then/elif/else/end` with raw-jq-style `.admissionDate` paths — confirms the JQ_KEYWORDS guard's effect on plain-string sources |
| `probeFullNameWithId` | Excel `&` string-concat operator under `fx\`…\`` — `PatientId & " — " & FirstName & " " & LastName` |
| `probeRecentlyAdmitted` | Date-string range comparison under `fx\`…\`` — `AdmissionDate >= "2024-11-01"` |

These all run against the existing fuzz patient instances
(`fuzz-empty-vitals`, `fuzz-bad-types`, `fuzz-shell-record`,
`fuzz-stringified-numbers`, `fuzz-empty-strings`, etc.), so each probe
exercises every fuzz pattern automatically.

## 16. Mixed-syntax expressions

**Convention used in gigantic-crawdad operations card:**

```ts
// Top PascalCase, nested jq lowercase
fx`SUM([Patients[].billing.roomCharge])`

// Top jq lowercase, nested PascalCase
fx`COUNTIF([.patients[].Severity], "Critical")`
```

Both compile fine because the PascalCase fallback runs on each
identifier independently. Worth shipping as deliberate test fixtures
in BXL — the same expression can have PascalCase head and jq nested,
or vice versa, and the runtime should produce the same result either
way.

## 17. Realm-bundle entry split (`src/realm-bundle-entry.ts`)

**Files:** `src/realm-bundle-entry.ts` (new), `src/index.ts`,
`scripts/build-realm-bundle.mjs`

Earlier the static `import { getFields } from
'https://cardstack.com/base/card-api'` lived directly in
`src/index.ts`. The bundle worked — esbuild's `external-https`
plugin left the statement in place — but Node's ESM loader rejects
the `https:` scheme at module-load time, so any non-realm consumer
(tsx tests, CLI tools, examples) that imported `src/index.ts`
crashed before its first line ran.

Fix: split the URL import into a tiny `realm-bundle-entry.ts` that
re-exports `./index.js` and registers `getFields` on a global hook
the main module reads lazily.

```ts
// src/realm-bundle-entry.ts (the entry point esbuild bundles)
import { getFields as _getFields } from 'https://cardstack.com/base/card-api';
(globalThis as any).__cardstackGetFields = _getFields;
export * from './index.js';
```

```ts
// src/index.ts — no static URL import; lookup is by global hook
function getCardstackGetFields(): GetFieldsFn | undefined {
  const fn = (globalThis as any).__cardstackGetFields;
  return typeof fn === 'function' ? fn : undefined;
}
```

`scripts/build-realm-bundle.mjs` now points its `entryPoints` at the
shim, so the bundled `bxl.ts` still ships the URL import (the realm
server resolves it at request time). For Node consumers, `index.ts`
loads cleanly and `safeFieldMap` simply returns null when the hook
hasn't been registered — the materialize fallback kicks in.

This is what unlocks the `tests/boxel/` suite — without the split,
running any test that imported the public API would explode with
`ERR_UNSUPPORTED_ESM_URL_SCHEME`.

## TODO when porting to bxl

- [ ] Re-apply each numbered change above against bxl source paths
- [ ] BXL is described as "more readable / Excel-like" — confirm whether
      operator precedence or builtin filter names diverge from jqxl. If
      the AST or filter registry differs, the *spots* to patch will be
      different even though the semantic intent is the same.
- [ ] Run the working-loon Hospital scenarios against the bxl-ported
      runtime as the regression suite (4 baseline patients + the fuzz
      suite under `Hospital/HospitalPatient/fuzz-*.json`).
- [ ] Decide whether the new lazy-proxy fallback in `expression()` should
      be ON by default (current jqxl behavior) or gated behind an opt-in
      flag in bxl. Current call site: hospital-operations.gts uses no
      flag — fallback fires automatically when planner rejects.
- [ ] `cardstack-queryable-value` paths (the trailing iterator that
      flattens cards for indexer queries) also exercise the runtime —
      make sure they tolerate null the same way the rendered path does.

## Reference checkpoints in working-loon (for archeology)

| Sha | Subject |
|---|---|
| `662c5ee` | Initial 69-file push baseline |
| `8c0b172` | `evaluateOnCard()` lazy-proxy helper added |
| `65214b6` | `expression()` falls back to lazy on planner failure; ops card declarative |
| `dc7a281` | `null[]` iterator yields empty instead of throwing |
| `3a19204` | `assertString`/`assertNumber` null-coerce |
| `4bda2b8` | `startswith`/`endswith` use return value |
| `43b8756` | Arithmetic operators propagate null on `-`, `*`, `/`, `%` |
| `793e8b6` | Switch null guards from `someOfType(Type.null, …)` to `== null` (covers `undefined`) |
| `41d9dbd` | Top-of-function early return for arithmetic null-propagation (`v2`) |
