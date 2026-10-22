# Releasing @cardstack/choreo-player

`@cardstack/choreo-player` publishes to npm from
`.github/workflows/choreo-player-publish.yml`. It versions independently of
`glimmer-motion` and `@cardstack/choreo`: it depends on neither, and drives any
run that satisfies its structural run contract.

Merging to main publishes a prerelease under the `unstable` dist-tag when the
merge changes anything the tarball ships. The version comes from the merged
PR's title: a conventional-commit prefix (`feat:` minor, `fix:` / `perf:` /
`refactor:` patch, a `!` or a `BREAKING CHANGE:` footer major), and prefixes
that describe no consumer-visible change (`chore:`, `docs:`, `test:`, …)
publish nothing. The PR-title check (`choreo-player-pr-title.yml`) also
previews, in its job summary, the version the merge would publish.

Cutting a stable release is a separate, manual act: run the workflow with
`confirm = promote`. It strips the `-unstable.<n>` suffix, closes out the
CHANGELOG's `[Unreleased]` section under the new version, and publishes under
`latest`, so keep `[Unreleased]` current as changes land.

Publishing authenticates through npm Trusted Publishing: a rule on npmjs.com
names this repository and the workflow file. Such a rule can only be added to a
package that already exists, so the first version, `0.0.0`, was published by
hand as a placeholder. The first release builds on it.

| Script                     | Purpose                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `compute-release.ts`       | Decides which version a merge to main publishes, from the PR title and the changed files.                                 |
| `next-unstable-version.ts` | Prints the next `-unstable.<n>` free on npm for the current base, for the manual publish path.                            |
| `set-version.ts`           | Sets the version in `package.json`.                                                                                       |
| `promote-changelog.ts`     | Closes out the CHANGELOG's `[Unreleased]` section under a version heading when a stable release is cut.                   |
| `release-prefixes.json`    | The conventional-commit prefixes and the bump each implies; read by both the pre-merge title check and `compute-release`. |
| `release.test.ts`          | The release decisions as pure functions; backs `pnpm test:release`.                                                       |

Every script runs directly under Node; nothing here is compiled first.
