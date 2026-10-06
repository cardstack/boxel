# Releasing glimmer-motion and @cardstack/choreo

`glimmer-motion` and `@cardstack/choreo` publish to npm in lockstep, from
`.github/workflows/glimmer-motion-choreo-publish.yml`. Both packages carry one
version, every release publishes both (glimmer-motion first), and choreo's
peer dependency on glimmer-motion is the exact version they share.

Merging to main publishes a prerelease of both under the `unstable` dist-tag
when the merge changes anything either tarball ships. The version comes from
the merged PR's title: a conventional-commit prefix (`feat:` minor, `fix:` /
`perf:` / `refactor:` patch, a `!` or a `BREAKING CHANGE:` footer major), and
prefixes that describe no consumer-visible change (`chore:`, `docs:`, `test:`,
…) publish nothing. One title decides one bump for both packages, so a `fix:`
that touches only glimmer-motion still publishes a choreo at the new version.
The PR-title check (`glimmer-motion-choreo-pr-title.yml`) also previews, in its
job summary, the version the merge would publish.

Cutting a stable release is a separate, manual act: run the workflow with
`confirm = promote`. It strips the `-unstable.<n>` suffix, closes out both
CHANGELOGs' `[Unreleased]` sections under the new version, and publishes both
packages under `latest`, so keep each `[Unreleased]` current as changes land.

Publishing authenticates through npm Trusted Publishing: a rule on npmjs.com
for each package names this repository and the workflow file. Such a rule can
only be added to a package that already exists, so each package's first
version is published by hand.

| Script                     | Purpose                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `compute-release.ts`       | Decides which version a merge to main publishes, from the PR title and the changed files of both packages.                |
| `next-unstable-version.ts` | Prints the next `-unstable.<n>` free on npm for both packages, for the manual publish path.                               |
| `set-version.ts`           | Sets the shared version in both packages' `package.json`.                                                                 |
| `promote-changelog.ts`     | Closes out both CHANGELOGs' `[Unreleased]` sections under the shared version when a stable release is cut.                |
| `release-prefixes.json`    | The conventional-commit prefixes and the bump each implies; read by both the pre-merge title check and `compute-release`. |
| `release.test.ts`          | The release decisions as pure functions; backs `pnpm test:release`.                                                       |

Every script runs directly under Node; nothing here is compiled first.
