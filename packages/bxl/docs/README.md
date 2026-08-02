# BXL Documentation

This directory holds the v0.1 documentation set.

| File                        | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `syntax-reference.md`       | Canonical public BXL syntax                    |
| `syntax-modes.md`           | Boxel `computeVia`, `jq`, and `fx` call-site modes |
| `profiles.md`               | Execution profile contracts and use cases      |
| `mutation-profile.md`       | Implemented pure Card-native DML planner and candidate contract for streaming, atomic, structural, and relationship edits |
| `mutation-language-guide.md` | Blog-style guide to handwriting mutation BXL against loaded Cards and Fields |
| `authorization.md`          | BXL Authorization guide: Resources, Parties, Seats, Capabilities, BXL rules, APIs, and domain patterns |
| `authorization-kernel-ir.md` | Internal `bxl-authorization-ir/1` compatibility IR and graph-kernel reference |
| `../src/authorization/README.md` | Authorization evaluator architecture, integration lifecycle, upstream provenance, and test gates |
| `predicate-sql.md`           | Predicate-profile SQL compiler contract        |
| `query-then-process.md`      | Retrieval first, BXL post-query processing     |
| `realm-collaboration-use-cases.md` | Real gateway policies, state transitions, ledgers, and audit findings |
| `openfga-synchronous-kernel-port-plan.md` | Implemented BXL-native authorization kernel, conformance evidence, APIs, and security boundary |
| `function-dispatch-hardening-proposal.md` | Excel/jq function-name collision dispatch proposal |
| `grammar.ebnf`              | Formal grammar (matches implementation)        |
| `sandbox.md`                | Sandbox contract, blocked builtins, budgets    |
| `excel-compatibility.md`    | Supported Excel paste idioms and formulas      |
| `formulas.md`               | Excel helper matrix with gaps                  |
| `api.md`                    | TypeScript API and option defaults             |
| `browser-runtime.md`        | Browser runtime patterns, worker usage, errors |

Each file is ported from the equivalent staging-tree doc in follow-up commits
and is a release gate for v0.1. See the root [RELEASE-PLAN.md](../RELEASE-PLAN.md).
