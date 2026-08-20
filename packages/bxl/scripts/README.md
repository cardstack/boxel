# Scripts

| Script                             | Purpose                                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `run-tests.mjs`                    | Runs every suite under `tests/unit`, `tests/smoke`, and `tests/boxel`; backs `pnpm test`.                                 |
| `verify-authorization-fixtures.ts` | Checks the pinned OpenFGA fixture hashes and the assertion inventory; backs `pnpm fixtures:authorization:verify`.         |
| `run-authorization-conformance.ts` | Executes the OpenFGA conformance corpus and reports pass/fail accounting; backs `pnpm test:authorization:conformance`.    |
| `bench-authorization.ts`           | Times authorization prepare/check/batch paths; backs `pnpm bench:authorization`.                                          |
| `build.ts`                         | Emits the published artifact (JavaScript + declarations) into `dist/`; backs `pnpm build` and runs on `prepack`.          |
| `verify-package.ts`                | Packs or downloads the npm artifact and checks it from a throwaway install; backs `pnpm verify:package`.                  |
| `compute-release.ts`               | Decides which version a merge to main publishes, from the PR title and the changed files.                                 |
| `next-unstable-version.ts`         | Prints the next `-unstable.<n>` free on npm for the current base, for the manual publish path.                            |
| `set-version.ts`                   | Sets the version in both places that carry it — `package.json` and `VERSION` in `src/index.ts`.                           |
| `promote-changelog.ts`             | Closes out the CHANGELOG's `[Unreleased]` section under a version heading when a stable release is cut.                   |
| `release-prefixes.json`            | The conventional-commit prefixes and the bump each implies; read by both the pre-merge title check and `compute-release`. |

Every `.ts` script runs directly under Node — nothing here is compiled first.
The one build in the package produces the npm tarball's contents, never
anything development or the test suites read.

The release scripts are driven by `.github/workflows/bxl-publish.yml`; the
README's [Releasing](../README.md#releasing) section describes the flow they
implement.
