# tests/boxel — Boxel-flavored BXL suites

These suites validate the runtime relaxations and the
`expression`/`jq`/`fx`/`bxl` factory that .gts files in a Boxel realm
import via `from '../bxl'`. They run inside BXL CI so a regression
that would break a hospital card is caught upstream — before the
realm bundle is shipped.

The fixtures (`fixtures/hospital.ts`) are plain JS objects mirroring
the gigantic-crawdad realm's serialized cards. **No** Boxel runtime,
**no** decorators, **no** `https://cardstack.com/base/...` imports —
adding any of those means the test belongs in the realm-server repo
instead.

## Sections

Each test name is tagged with the docs/internals/port-from-jqxl.md section it
asserts (e.g. `§7 division by zero returns null`). When a case fails,
look up the matching section in the port doc to see the rule and the
original incident.

| File | Port-doc sections |
|---|---|
| `runtime-null-tolerance.ts` | §6 (null iteration) · §7 (null arithmetic) · §8 (assertString/Number) · §9 (startswith/endswith) · §11a (factory smoke) |
| `expression-factory.ts` | §10 (jq backslash) · §11 (mode dispatch) · §11a (`as` materialization, Excel-error catch) |
| `compiler-readable.ts` | §11 (readableSyntax dispatch) · §12 (PascalCase fallback) · §13 (JQ_KEYWORDS guard) · §16 (mixed-syntax) |
| `excel-error-tolerance.ts` | §11a (Excel-error catch — sentinels surface as null at the bxl() boundary) |
| `materialize.ts` | §11a (`as: Cls` Object.assign fallback path — no Boxel runtime) |
| `probe-fields.ts` | §15 (probe-field regressions — one assertion per gigantic-crawdad probe field) |

## Running

```bash
npm run test:boxel        # just this folder
npm run test              # full suite (unit + smoke + boxel)
```

## Adding a fuzz pattern

1. Add a new fixture export to `fixtures/hospital.ts`.
2. Mirror the data in
   `realms-staging.stack.cards/ctse/gigantic-crawdad/Hospital/HospitalPatient/fuzz-*.json`
   so the realm and the unit tests stay in lockstep.
3. Add a `check(...)` case asserting the runtime behavior, naming it
   with the relevant port-doc section.

## What lives elsewhere

- `getFields`-aware `as` materialization (the `field.fieldType` /
  `field.card` traversal) needs Boxel's runtime to be loaded — that
  path is exercised in the realm-server repo, not here. The Node
  fallback (`new Cls(); Object.assign(instance, raw)`) is what these
  tests cover.
- Realm push/index/prerender plumbing belongs in the realm-server's
  own integration suite.
