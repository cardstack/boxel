# Changelog

All notable changes to `@cardstack/bxl` are recorded here.

This file follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0 caveat: the public API is intentionally unstable. Minor and patch
versions may change syntax behavior until `1.0.0`. See
[RELEASE-PLAN.md](./RELEASE-PLAN.md).

## [Unreleased]

### Added

- Three-origin `src/` layout: `jqtools/` (derived from alexxander/jq-tools),
  `formulajs/` (derived from formulajs/formulajs), and `bxl/` (our own
  readable-syntax compiler, linter, formatter, bridge, registry, and TextMate
  grammar).
- Sub-entry source files: `src/compiler.ts`, `src/linter.ts`,
  `src/runtime.ts`, `src/runtime-bare.ts` wired via `package.json` `exports`.
- `src/bxl/registry/` composes jq-core + formula libraries; jqtools remains
  standalone with a core-only registry mechanism.
- `src/formulajs/errors.ts` defines a standalone `ExcelError` so the
  formulajs subfolder has zero dependencies on `src/jqtools/`.
- Attribution: `NOTICE.md`, `src/jqtools/UPSTREAM-DIFFS.md`,
  `src/formulajs/UPSTREAM-DIFFS.md`, per-folder `README.md`.
- Test runner `scripts/run-tests.mjs` discovers suites in `tests/unit/` and
  `tests/smoke/` automatically.

### Test results (post-port)

- 13 / 13 suites pass: bxl-150 (150 cases), formula (121), excel-paste (104),
  edge (31), smoke (14), context (18), pred-filter (14), fuzzy-input (16),
  format-conversion, conversion, linter, syntax-highlight, smoke runtime (5).
- Total: **489+ passing cases** end-to-end through the new layout.

### Infrastructure

- `tsconfig.json` relaxed to match ported code realities
  (`noImplicitAny: false`, `noUncheckedIndexedAccess: false`,
  `exactOptionalPropertyTypes: false`). Re-tightening is a follow-up task.

## [0.1.0] — Unreleased

Initial public release. See [RELEASE-PLAN.md](./RELEASE-PLAN.md) for the
definition-of-done checklist.
