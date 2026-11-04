---
status: proposed
date: 2026-11-03
scope:
  - packages/realm-historian/**
  - .github/workflows/ci.yaml
  - .github/workflows/ci-lint.yaml
---

# 018. Build realm-historian as erasable TypeScript that Node runs unbuilt

realm-historian is the service that records realm revision history: it reads
the change journal, captures changed files, and commits them to one git repo
per realm. It runs no realm code and talks to nothing but Postgres, the file
system and git, so it lives in its own package, `packages/realm-historian`.
This ADR fixes that package's conventions: TypeScript
restricted to syntax Node can strip, so nothing is built; a lint that
type-checks; and CI change filters that are kept in step with the package's
imports and consumers by hand, because nothing derives them.

## 1. Decision

### 1.1. Erasable TypeScript, no build

The package's modules, scripts and tests MUST be TypeScript in `.ts` files.
The package's `tsconfig.json` MUST set `erasableSyntaxOnly`,
`verbatimModuleSyntax`, `module: nodenext` and `allowImportingTsExtensions`,
as `packages/secure-origin/tsconfig.json` does, so that the Node version
`.mise.toml` pins runs every file directly: Node strips only the syntax the
first flag allows, loads only the imports the second marks as values, and
resolves only the `.ts` specifiers the last two require. The package MUST NOT
have a build step: its service starts with `node main.ts`, its scripts and
tests run the same way, and its container image copies the sources.

### 1.2. Dependencies

The package MUST NOT depend on `packages/realm-server`, `packages/host` or
`packages/base`. It SHOULD depend only on `@cardstack/postgres`,
`@cardstack/runtime-common` and the `git` executable. `@cardstack/runtime-common`
brings its own dependencies, UI packages among them; the package SHOULD
import from it only modules that run under Node with no browser or Ember
runtime, such as the database, expression, logging and realm-history
modules.

### 1.3. Lint

The package's `lint` script MUST run ESLint and a type-check (`tsc --noEmit`)
over its modules, scripts and tests. The Lint job in
`.github/workflows/ci-lint.yaml` MUST run it, in a step named "Lint Realm
Historian".

### 1.4. CI change filters

`.github/workflows/ci.yaml` MUST define a `realm-historian` change filter and
a `realm-historian-test` job gated on it. The filter MUST include the shared
list, `packages/postgres/**`, `packages/realm-historian/**`, and every other
workspace package the package imports. Every suite that imports the package or
runs it in its test stack MUST include `packages/realm-historian/**` in its
own filter. The filters are hand-kept lists, so a change that adds an import
to the package, or a consumer of it, MUST update the filters in the same
change, and a review MUST check that it did.

## 2. Rationale

The realm server runs its TypeScript the same way, with `node main.ts`, but
without `erasableSyntaxOnly`. Node strips types; it does not compile. An
enum, a parameter property or a namespace in a file it loads fails at run
time, which for a service means at deploy time. The flag moves that failure
to the type-check, where the lint step finds it on every PR. The secure
origin's pages already follow this rule (ADR 008 §1.10), so the convention is
established and the package can copy its configuration.

No build step keeps the image and the local service the same artifact: the
Dockerfile copies the sources and runs them unbuilt, as the worker image runs
`worker-manager.ts`. A build would add a compile step, and a second artifact
that can disagree with the sources, to the service's start, to `mise run
dev` and to every test run.

The package has its own filter because its tests cost minutes and should not
run on every host change, and because the suites that depend on it, the
realm-server tests that import its reader and the matrix suite whose isolated
stack runs it, would otherwise pass on a change that breaks them. The lists in
`ci.yaml` are not derived from `package.json` or from imports, so the only
thing that keeps them right is the rule in §1.4 and a reviewer who checks it.
That is cheap at the one place it has to happen, the change that adds the
import, and expensive anywhere else: a missed filter does not fail, it skips.

A separate package, rather than a directory in `packages/realm-server` as the
worker is, keeps the package's direct dependencies explicit in its own
`package.json`. The worker runs realm code and needs everything the realm
server needs. realm-historian needs Postgres, a POSIX file system and git,
and it is the only writer and the only reader of the repo format, so one
package can own both sides of that format. What it shares with the realm
server, the journal and repo-format types, lives in `@cardstack/runtime-common`,
whose transitive dependencies the package carries without loading them.

## 3. Considered options

- **Erasable TypeScript run by Node, type-checked in lint (chosen).** The
  same code runs in tests, locally and in the image, with the one failure mode
  of unbuilt TypeScript caught before it ships.
- **Compiled TypeScript with a build step.** Allows every TypeScript feature,
  at the cost of a build in the image, in local start and in CI, and of two
  artifacts (sources and output) that can disagree.
- **Plain JavaScript.** Nothing to strip, but the repo format, the trailers
  and the journal rows are contracts shared with the realm server's reader,
  and a type-check is the cheapest test of them.
- **A directory in `packages/realm-server`, like the worker.** Inherits the
  realm server's dependencies, its slow test suite and its change filter, for
  a service that runs none of its code.
- **Deriving the change filters from imports.** Correct by construction, but
  no tool in the repository does it, and writing one is out of scope for the
  package. The hand-kept rule stands until one exists, and would then be
  replaced by a superseding ADR.

## 4. Sources

- ADR 008 §1.10, the same rule for `packages/secure-origin`.
- `packages/secure-origin/tsconfig.json`, the configuration to copy.
- `packages/realm-server/package.json` (`start`), the realm server's unbuilt
  `node main.ts`.
- `.github/workflows/ci.yaml` (`change-check`), the hand-kept filters and the
  comment on the failure mode a missed filter causes.

## 5. Remediation

Known gaps are listed in [remediation/018.md](remediation/018.md).
