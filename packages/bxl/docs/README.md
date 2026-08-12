# BXL Documentation

| File                                                                       | Purpose                                                                                            |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `syntax-reference.md`                                                      | Canonical public BXL syntax                                                                        |
| `syntax-modes.md`                                                          | Boxel `computeVia`, `jq`, and `fx` call-site modes                                                 |
| `grammar.ebnf`                                                             | Formal grammar (matches the implementation)                                                        |
| `profiles.md`                                                              | Execution profile contracts and use cases                                                          |
| `formulas.md`                                                              | Excel helper matrix, including the gaps                                                            |
| `realm-composition.md`                                                     | Threading inputs into a child FieldDef via `{ as: ... }` materialization                           |
| `query-then-process.md`                                                    | Retrieval first, BXL post-query processing                                                         |
| `predicate-sql.md`                                                         | Predicate-profile SQL compiler contract                                                            |
| `browser-runtime.md`                                                       | Browser runtime patterns, worker usage, errors                                                     |
| `mutation-profile.md`                                                      | Card-native DML planner: streaming, atomic, structural, and relationship edits                     |
| `mutation-language-guide.md`                                               | Guide to handwriting mutation BXL against loaded Cards and Fields                                  |
| `mutation-language-comparison.md`                                          | How the mutation profile compares with other data-mutation languages                               |
| `authorization.md`                                                         | Authorization guide: Resources, Parties, Seats, Capabilities, BXL rules, APIs, and domain patterns |
| `authorization-kernel-ir.md`                                               | The `bxl-authorization-ir/1` compatibility IR and graph-kernel reference                           |
| `realm-collaboration-use-cases.md`                                         | Gateway policies, state transitions, ledgers, and audit findings                                   |
| `password-game-spec.md`                                                    | Specification for the password-game corpus the compiler stress suite runs                          |
| [`../src/authorization/README.md`](../src/authorization/README.md)         | Authorization evaluator architecture, integration lifecycle, upstream provenance, and test gates   |
| [`../src/jqtools/UPSTREAM-DIFFS.md`](../src/jqtools/UPSTREAM-DIFFS.md)     | File-by-file audit of how the vendored jq engine diverges from upstream                            |
| [`../src/formulajs/UPSTREAM-DIFFS.md`](../src/formulajs/UPSTREAM-DIFFS.md) | File-by-file audit of how the vendored Excel formula library diverges from upstream                |

The rendered reference with syntax-highlighted examples is published at
[bxl.boxel.site](https://bxl.boxel.site).
