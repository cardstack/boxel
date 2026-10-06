# Lockstep npm publish for glimmer-motion and @cardstack/choreo

## Goal

Publish `glimmer-motion` and `@cardstack/choreo` to npm from one workflow, so
that every release carries the same version for both packages. The setup
follows bxl's (`bxl-publish.yml`, `bxl-pr-title.yml`, `packages/bxl/scripts/*`)
and adapts it to two packages.

## Decisions

- **npm names.** glimmer-motion publishes under its manifest name, unscoped
  `glimmer-motion`. Every import in the monorepo and the host's realm shims use
  that name. `@cardstack/choreo` keeps its scoped name. The unscoped name needs
  a placeholder and a Trusted Publisher rule on npmjs.com before the workflow
  can publish it. That is a human step, tracked in its own ticket.
- **One version, one tag.** Both manifests carry the same version at all
  times, and the release scripts refuse to run when they disagree. A release
  is tagged once, as `glimmer-motion-choreo-v<version>`, and gets one GitHub
  release.
- **One bump.** The merged PR's title decides the bump, and it applies to both
  packages. A merge that changes what either tarball ships releases both, so
  choreo's exact-version peer dependency on glimmer-motion (`workspace:*`,
  which pnpm rewrites to the exact version at publish) always names a
  glimmer-motion that exists.
- **Publish order.** glimmer-motion first, then choreo. choreo's declaration
  build resolves glimmer-motion through its built output, and a consumer
  installing choreo needs the glimmer-motion it names to be on npm.
- **CHANGELOGs.** One per package, so each tarball carries its own history.
  A stable release closes out both `[Unreleased]` sections under the shared
  version. A section with nothing in it gets a line saying the package was
  released in step with the other one. Both empty stops the release.
- **Dry run on every PR.** The PR-title workflow gains a second job that runs
  the release computation against the PR's own title and diff, and writes the
  version the merge would publish into the job summary.

## Steps

1. `packages/glimmer-motion/scripts/release/`:
   - `compute-release.ts`: bxl's classifier with a lockstep version, a
     published surface that spans both packages, the catalog entries of both
     packages' dependencies, and npm counters taken from both packages'
     published versions.
   - `set-version.ts`: writes one version into both manifests.
   - `next-unstable-version.ts`: the manual republish path.
   - `promote-changelog.ts`: closes out both CHANGELOGs and writes the
     combined release notes.
   - `release-prefixes.json`: the prefix list, read by the title check and the
     classifier.
   - `release.test.ts`: `node:test` suite over the pure functions.
2. `.github/workflows/glimmer-motion-choreo-publish.yml`: the unstable and
   stable jobs in one file. Both packages' Trusted Publisher rules name this
   file.
3. `.github/workflows/glimmer-motion-choreo-pr-title.yml`: the title check
   plus the release preview, path-scoped to both packages.
4. Package metadata: CHANGELOG.md in both packages and in their `files`;
   glimmer-motion's `repository` points at this repository (npm provenance
   requires it to match the repository that publishes).
5. CI: the release tests run in the Glimmer Motion Tests job.
6. `AGENTS.md` and the `published-package-pr-title` skill list both packages.

## Testing

- `node --test scripts/release/release.test.ts` in glimmer-motion.
- Run `compute-release.ts` locally with a PR title and a commit range that
  touches each package, and confirm one version comes out for both.
- `pnpm pack` choreo and check that its peer dependency on glimmer-motion is
  the exact shared version.
- `pnpm lint` in glimmer-motion and choreo; `actionlint` on the two workflows.
