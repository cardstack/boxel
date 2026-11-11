# ADR match-file-paths-with-path-aware-globs-and-cap-the-file-content-the-index-holds remediation

Places where the code does not meet [ADR match-file-paths-with-path-aware-globs-and-cap-the-file-content-the-index-holds](../proposed-match-file-paths-with-path-aware-globs-and-cap-the-file-content-the-index-holds.md)
yet (ADR 001 §1.6).

- `packages/runtime-common/query-engine/filter-compiler.ts`
  (`#patternCondition`, the SQLite path) breaks §1.1. The browser's SQLite
  index runs a glob as `LIKE` only, so `*` and `?` cross `/` there. The
  difference is listed in `docs/search.md` ([ADR give-every-query-evaluator-the-databases-semantics](../proposed-give-every-query-evaluator-the-databases-semantics.md) §1.1). Match by segment,
  or refuse the glob with `needs-postgres`.
