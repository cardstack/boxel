# BXL Documentation

This directory holds the v0.1 documentation set.

| File                        | Purpose                                        |
| --------------------------- | ---------------------------------------------- |
| `syntax-reference.md`       | Canonical public BXL syntax                    |
| `syntax-modes.md`           | Boxel `computeVia`, `jq`, and `fx` call-site modes |
| `profiles.md`               | Execution profile contracts and use cases      |
| `authorization.md`          | Boxel Policy v2 guide: Cards, Parties, Seats, Capabilities, BXL rules, APIs, and domain patterns |
| `authorization-kernel-ir.md` | Internal `bxl-authorization/1` compatibility IR and graph-kernel reference |
| `../src/authorization/README.md` | Authorization runtime architecture, integration lifecycle, upstream provenance, and test gates |
| `predicate-sql.md`           | Predicate-profile SQL compiler contract        |
| `query-then-process.md`      | Retrieval first, BXL post-query processing     |
| `realm-collaboration-use-cases.md` | Real gateway policies, state transitions, ledgers, and audit findings |
| `boxel-realm-policy-mediation.md` | Proposed default Realm security model for groups, mediated access, materialized views, writes, commands, and private aggregates |
| `handoff-realm-computed-performance.md` | Agent handoff for reproducing the real CLI computed-field benchmark as a fitted Realm card |
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
