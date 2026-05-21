# Changelog

Release history for `@cardstack/boxel-cli` (npm) and the `boxel-cli` Claude Code plugin. **Stable cuts only** — per-merge unstable releases are documented on the GitHub Releases page (`boxel-cli-v*-unstable.*` tags) and on npm under the `unstable` dist-tag.

Entries below are written by CI on each stable promotion — most recent first.

<!-- New entries are inserted directly below this line by the stable job in .github/workflows/boxel-cli-publish.yml. -->

## 2026-05-21 — npm v0.2.0
Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.2.0

## @cardstack/boxel-cli v0.2.0 (npm `latest`)
https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.2.0

## Changes

* fix: Send binary files via application/octet-stream in boxel-cli sync (CS-11075) by @FadhlanR in https://github.com/cardstack/boxel/pull/4852
* fix: Swap stored password for Matrix access token (CS-10725) by @FadhlanR in https://github.com/cardstack/boxel/pull/4779
* feat(boxel-cli): Add publish/unpublish by @backspace in https://github.com/cardstack/boxel/pull/4851
* feat(boxel-cli): add lint, parse, test validator commands by @jurgenwerk in https://github.com/cardstack/boxel/pull/4881
* fix(boxel-cli): narrow release notes; restrict CHANGELOG to stable cuts by @FadhlanR in https://github.com/cardstack/boxel/pull/4880
* fix(boxel-cli): CS-11062 protect local edits in `boxel realm watch start` by @FadhlanR in https://github.com/cardstack/boxel/pull/4844
* fix(boxel-cli): consolidate publish workflows, push annotated tags by @FadhlanR in https://github.com/cardstack/boxel/pull/4879
* feat(boxel-cli): auto-publish unstable per merge, repurpose manual workflow as stable promoter by @FadhlanR in https://github.com/cardstack/boxel/pull/4804
* Add boxel consolidate-workspaces command (CS-10632) by @FadhlanR in https://github.com/cardstack/boxel/pull/4780
* Add boxel realm sync status command (CS-10621) by @FadhlanR in https://github.com/cardstack/boxel/pull/4781

**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.1.4...boxel-cli-v0.2.0

