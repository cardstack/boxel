# Tests

Every public BXL syntax and API promise has an executable test here.

## Layout

- `unit/`      — narrow unit tests (compiler, linter, formatter, parser)
- `cli/`       — end-to-end CLI smoke
- `security/`  — sandbox guarantees (env blocked, budget limits, output caps)
- `browser/`   — minified-bundle smoke in happy-dom
- `fixtures/`  — shared input/schema fixtures

## Suites

| Script                        | Purpose                                            |
| ----------------------------- | -------------------------------------------------- |
| `test:unit`                   | compiler, linter, formatter, parser correctness    |
| `test:cli`                    | CLI subcommand smoke                               |
| `test:security`               | `env()` blocked, output cap, step cap, byte cap    |
| `test:browser`                | loads `dist/browser/bxl.min.<hash>.js` in happy-dom |
| `test:size`                   | bundle-size report and budget gate                 |

## Ported from staging

The initial test corpus is ported from `jqxlv2/tests/` in the jolly-mackerel
realm:

| Staging file                  | Target location                                  |
| ----------------------------- | ------------------------------------------------ |
| `cli-smoke.ts`                | `tests/cli/smoke.ts`                             |
| `bxl-150-cli.ts`              | `tests/unit/bxl-150.test.ts`                     |
| `bxl-formula-cli.ts`          | `tests/unit/formula.test.ts`                     |
| `bxl-edge-cli.ts`             | `tests/unit/edge-cases.test.ts`                  |
| `bxl-contexts-cli.ts`         | `tests/unit/contexts.test.ts`                    |
| `conversion-cli.ts`           | `tests/unit/conversion.test.ts`                  |
| `excel-paste-cli.ts`          | `tests/unit/excel-paste.test.ts`                 |
| `format-conversion-cli.ts`    | `tests/unit/format-conversion.test.ts`           |
| `pred-filter-cli.ts`          | `tests/unit/pred-filter.test.ts`                 |
| `linter-cli.ts`               | `tests/unit/linter.test.ts`                      |
| `syntax-highlight-cli.ts`     | `tests/unit/syntax-highlight.test.ts`            |
| `fuzzy-input-cli.ts`          | `tests/unit/fuzzy-input.test.ts`                 |

The security suite is new for v0.1 — sandbox guarantees were tested inline in
`cli-smoke.ts` previously; they get their own file here.
