# Changelog

Release history for `@cardstack/boxel-cli` (npm) and the `boxel-cli` Claude Code plugin. **Stable cuts only** — per-merge unstable releases are documented on the GitHub Releases page (`boxel-cli-v*-unstable.*` tags) and on npm under the `unstable` dist-tag.

Entries below are written by CI on each stable promotion — most recent first.

<!-- New entries are inserted directly below this line by the stable job in .github/workflows/boxel-cli-publish.yml. -->

## 2026-07-09 — npm v0.4.0

Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.4.0

## @cardstack/boxel-cli v0.4.0 (npm `latest`)

https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.4.0

## Changes

- fix: add import attribute to release-prefixes.json import by @lukemelia in https://github.com/cardstack/boxel/pull/5445
- fix: atomic upload result mapping breaks when the realm returns resource-identifier ids by @jurgenwerk in https://github.com/cardstack/boxel/pull/5413
- fix: stop background git maintenance racing the checkpoint commit loop by @habdelra in https://github.com/cardstack/boxel/pull/5411
- refactor: split the prerender visit into index and prerender-html passes by @habdelra in https://github.com/cardstack/boxel/pull/5399
- fix: rename search-entry resource type to entry by @habdelra in https://github.com/cardstack/boxel/pull/5398
- test: rename realm version to generation across the index schema by @habdelra in https://github.com/cardstack/boxel/pull/5391
- feat: add `boxel realm archive` / `restore` + archived state in `realm list` (CS-11671) by @lukemelia in https://github.com/cardstack/boxel/pull/5365
- Add owner-only archive/unarchive realm endpoints by @lukemelia in https://github.com/cardstack/boxel/pull/5341
- feat: drop the -v2 suffix from the search endpoints by @habdelra in https://github.com/cardstack/boxel/pull/5345
- chore: retire the four legacy search endpoints, compat layer, and legacy wire shapes by @habdelra in https://github.com/cardstack/boxel/pull/5332
- fix: Lockfile update by @ef4 in https://github.com/cardstack/boxel/pull/5207
- refactor: Change cross-resource references to prefix form by @backspace in https://github.com/cardstack/boxel/pull/5148
- feat: realm secret seed auth for boxel file read/write + realm publish/unpublish by @habdelra in https://github.com/cardstack/boxel/pull/5326
- feat: support all BFM formats in both inline and block reference directives by @lukemelia in https://github.com/cardstack/boxel/pull/5323
- fix: boxel-cli \_\_dirname under ESM breaks build-plugin / publish by @jurgenwerk in https://github.com/cardstack/boxel/pull/5302
- chore: lint-guard CommonJS `__dirname`/`__filename` in ESM TS source by @lukemelia in https://github.com/cardstack/boxel/pull/5307
- refactor: migrate boxel-cli ingest-card search to per-realm \_search-v2 (data-only) by @habdelra in https://github.com/cardstack/boxel/pull/5305
- refactor: migrate boxel-cli and vscode-boxel-tools search to /\_federated-search-v2 (data-only) by @habdelra in https://github.com/cardstack/boxel/pull/5291
- feat: boxel search can list a realm's cards without a query, and explains rejected filters by @jurgenwerk in https://github.com/cardstack/boxel/pull/5275
- fix: ingest-card copies Spec + instances from shared/published source realms by @jurgenwerk in https://github.com/cardstack/boxel/pull/5276
- fix: ingesting one card no longer copies every card of its type by @jurgenwerk in https://github.com/cardstack/boxel/pull/5289
- feat: surface frontmatter parse errors via indexing diagnostics by @lukemelia in https://github.com/cardstack/boxel/pull/5272
- refactor: migrate from ts-node to native Node ESM by @lukemelia in https://github.com/cardstack/boxel/pull/5265
- feat: route software-factory tests through boxel-cli's engine (drop host/dist dep) by @jurgenwerk in https://github.com/cardstack/boxel/pull/5246
- fix: ship @glimmer/component + @glimmer/tracking types with boxel parse by @jurgenwerk in https://github.com/cardstack/boxel/pull/5197
- feat(ui): Extract fitted component from homepage to boxel-ui with improvements by @burieberry in https://github.com/cardstack/boxel/pull/5212
- fix: keep republish recovery progress off stdout in boxel realm publish by @lukemelia in https://github.com/cardstack/boxel/pull/5203
- feat: add publishability gate and --json to boxel realm publish/unpublish by @lukemelia in https://github.com/cardstack/boxel/pull/5191
- feat: factory:go adjust-existing-card flow + `boxel realm ingest-card` by @jurgenwerk in https://github.com/cardstack/boxel/pull/5145
- refactor: extract RealmClient + RealmOperation pattern shared by host and boxel-cli by @lukemelia in https://github.com/cardstack/boxel/pull/5188
- feat: add `boxel realm ingest-card` to copy a card with its dependency graph by @jurgenwerk in https://github.com/cardstack/boxel/pull/5166
- build: pin Node >=24 across engines, .nvmrc, and CI (CS-11449) by @lukemelia in https://github.com/cardstack/boxel/pull/5173
- refactor: add explicit .ts import extensions in browser-consumed packages (CS-11448 part 2) by @lukemelia in https://github.com/cardstack/boxel/pull/5159
- fix(boxel-cli): auto-bump unstable version on manual publish by @jurgenwerk in https://github.com/cardstack/boxel/pull/5143
- refactor: burn down the erasable-syntax override list (parameter properties + enums) by @lukemelia in https://github.com/cardstack/boxel/pull/5156

**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.3.1...boxel-cli-v0.4.0

## 2026-06-06 — npm v0.3.1

Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.3.1

## @cardstack/boxel-cli v0.3.1 (npm `latest`)

https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.3.1

## Changes

- fix(boxel-cli): serve a stub icon module so self-contained boxel test loads cards by @jurgenwerk in https://github.com/cardstack/boxel/pull/5130
- fix: update boxel-cli profile localhost realmServerUrl to https by @burieberry in https://github.com/cardstack/boxel/pull/5091
- feat: promote AudioDef into @cardstack/base with full format support by @lucaslyl in https://github.com/cardstack/boxel/pull/5055
- feat(realm): add boxel realm indexing-errors command and /\_indexing-errors endpoint by @FadhlanR in https://github.com/cardstack/boxel/pull/5013

**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.3.0...boxel-cli-v0.3.1

## 2026-05-28 — npm v0.3.0

Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.3.0

## @cardstack/boxel-cli v0.3.0 (npm `latest`)

https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.3.0

## Changes

- chore: remove `.realm.json` by @backspace in https://github.com/cardstack/boxel/pull/4971
- test(boxel-cli): poll remote read in first-sync prefer-local conflict test by @habdelra in https://github.com/cardstack/boxel/pull/5003
- feat(skills): include all skills from boxel-skills (CS-11195) by @FadhlanR in https://github.com/cardstack/boxel/pull/4912
- feat: add self contained test-running ability to boxel-cli by @jurgenwerk in https://github.com/cardstack/boxel/pull/4914
- test(boxel-cli): stabilize delete-vs-change sync test against post-DELETE visibility race by @habdelra in https://github.com/cardstack/boxel/pull/4937
- fix(boxel-cli): preserve atomic-upload error detail + retry SF seed sync by @habdelra in https://github.com/cardstack/boxel/pull/4933
- test: diagnose flaky boxel-cli prefer-local conflict-resolution test by @habdelra in https://github.com/cardstack/boxel/pull/4929
- fix(boxel-cli): Extract fetch error.cause on publish/unpublish failures by @backspace in https://github.com/cardstack/boxel/pull/4925
- feat(boxel-cli): bundle parsing (type checking) into boxel-cli; drop the requirement for running it in monorepo by @jurgenwerk in https://github.com/cardstack/boxel/pull/4901
- chore(boxel-cli): sunset workspace-sync-cli — CS-11047 + CS-11162 by @FadhlanR in https://github.com/cardstack/boxel/pull/4853

**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.2.0...boxel-cli-v0.3.0

## 2026-05-21 — npm v0.2.0

Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.2.0

## @cardstack/boxel-cli v0.2.0 (npm `latest`)

https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.2.0

## Changes

- fix: Send binary files via application/octet-stream in boxel-cli sync (CS-11075) by @FadhlanR in https://github.com/cardstack/boxel/pull/4852
- fix: Swap stored password for Matrix access token (CS-10725) by @FadhlanR in https://github.com/cardstack/boxel/pull/4779
- feat(boxel-cli): Add publish/unpublish by @backspace in https://github.com/cardstack/boxel/pull/4851
- feat(boxel-cli): add lint, parse, test validator commands by @jurgenwerk in https://github.com/cardstack/boxel/pull/4881
- fix(boxel-cli): narrow release notes; restrict CHANGELOG to stable cuts by @FadhlanR in https://github.com/cardstack/boxel/pull/4880
- fix(boxel-cli): CS-11062 protect local edits in `boxel realm watch start` by @FadhlanR in https://github.com/cardstack/boxel/pull/4844
- fix(boxel-cli): consolidate publish workflows, push annotated tags by @FadhlanR in https://github.com/cardstack/boxel/pull/4879
- feat(boxel-cli): auto-publish unstable per merge, repurpose manual workflow as stable promoter by @FadhlanR in https://github.com/cardstack/boxel/pull/4804
- Add boxel consolidate-workspaces command (CS-10632) by @FadhlanR in https://github.com/cardstack/boxel/pull/4780
- Add boxel realm sync status command (CS-10621) by @FadhlanR in https://github.com/cardstack/boxel/pull/4781

**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.1.4...boxel-cli-v0.2.0
