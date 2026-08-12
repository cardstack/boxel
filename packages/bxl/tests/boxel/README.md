# tests/boxel — Boxel-flavored BXL suites

These suites validate the null-tolerance rules and the
`expression`/`jq`/`fx`/`bxl` factory that card source uses inside `computeVia`.
They run over plain JS objects, which makes them fast and free of any host
setup — the cost is that they cannot exercise anything requiring a live card
runtime.

The fixtures (`fixtures/hospital.ts`) are plain objects shaped like serialized
cards. **No** Boxel runtime, **no** decorators, **no**
`https://cardstack.com/base/...` imports — a test needing any of those belongs
in the host or realm-server suite instead.

## Rules

Each test name is tagged with the rule it asserts (e.g.
`§7 division by zero returns null`). Each suite's header comment states its
rules, so a failing case name points straight at the one that broke.

| File                        | Rules                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `runtime-null-tolerance.ts` | §6 null iteration · §7 null arithmetic · §8 assertString/Number coercion · §9 startswith/endswith                        |
| `expression-factory.ts`     | §10 jq backslash preservation · §11 mode dispatch · §11a `as` materialization and Excel-error catch                      |
| `compiler-readable.ts`      | §12 PascalCase fallback · §13 JQ_KEYWORDS guard · §16 mixed syntax                                                       |
| `excel-error-tolerance.ts`  | Excel error sentinels surface as `null` at the `bxl()` boundary                                                          |
| `materialize.ts`            | The `as: Cls` fallback path — `new Cls()` plus `Object.assign`, with no card runtime present                             |
| `probe-fields.ts`           | One assertion per probe field on the hospital fixture                                                                    |
| `fielddef-threading.ts`     | Multi-stage `{ as: Cls }` threading — the insurance pipeline pattern                                                     |
| `card-source-mutation.ts`   | The card-source mutation adapter: schema derivation, computed-field skips, relationship serialization, stale-plan safety |
| `update-via-bxl.ts`         | The `updateViaBxl` adapter                                                                                               |

## Running

```sh
pnpm test tests/boxel   # just this folder
pnpm test               # full suite
```

## Adding a fuzz pattern

1. Add a new fixture export to `fixtures/hospital.ts`.
2. Add a `check(...)` case asserting the runtime behavior, naming it with the
   relevant rule.

## What lives elsewhere

- `getFields`-aware `as` materialization — the `field.fieldType` /
  `field.card` traversal — needs a loaded card runtime, so it is exercised in
  the host's integration suite. What these tests cover is the fallback
  (`new Cls(); Object.assign(instance, raw)`).
- Realm push, indexing, and prerender plumbing belong to the realm-server's
  own integration suite.
