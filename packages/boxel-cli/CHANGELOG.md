# Changelog

Release history for `@cardstack/boxel-cli` (npm) and the `boxel-cli` Claude Code plugin.

Entries below are written by CI on each publish — most recent first. Each entry calls out the npm version and, when it bumps in the same release, the plugin version. For the source PRs of a given entry, follow the GitHub Release linked at the top of that entry.

<!-- New entries are inserted directly below this line by .github/workflows/boxel-cli-publish.yml. -->

## 2026-05-19 — npm v0.2.0-unstable.298 / plugin v0.3.2
Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.2.0-unstable.298

## @cardstack/boxel-cli v0.2.0-unstable.298 (npm `unstable`)
https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.2.0-unstable.298

## boxel-cli plugin v0.3.2
Marketplace plugin version bumped in this release.

## Changes

## What's Changed
* observability: parameterize worker-status alert log group per env (CS-11107) by @lukemelia in https://github.com/cardstack/boxel/pull/4796
* CS-10009 PR 2: migrate realm-endpoints/ tests to explicit fixture by @lukemelia in https://github.com/cardstack/boxel/pull/4790
* realm-server: lock grafana operator endpoints to POST + Bearer (CS-10927) by @lukemelia in https://github.com/cardstack/boxel/pull/4792
* Add boxel realm sync status command (CS-10621) by @FadhlanR in https://github.com/cardstack/boxel/pull/4781
* Add boxel consolidate-workspaces command (CS-10632) by @FadhlanR in https://github.com/cardstack/boxel/pull/4780
* Remove field-spec instances from packages/base by @richardhjtan in https://github.com/cardstack/boxel/pull/4724
* manual-deploy: send post-deployment auth as Authorization header [CS-11129] by @jurgenwerk in https://github.com/cardstack/boxel/pull/4807
* Rename submission branches to {hash}-{listing-slug} by @richardhjtan in https://github.com/cardstack/boxel/pull/4805
* Actually fix the software factory shard 1/3 instantiate-validation flake (follow-up to #4782) by @habdelra in https://github.com/cardstack/boxel/pull/4802
* observability: fix Overview dashboard Tasks panel rendering by @lukemelia in https://github.com/cardstack/boxel/pull/4811
* Add longest-running indexing jobs panels to Job Queue dashboard by @habdelra in https://github.com/cardstack/boxel/pull/4810
* Fix flaky 'sends read receipts only for bot messages' test by @habdelra in https://github.com/cardstack/boxel/pull/4808
* CS-11123 Phase 1: Pre-warm modules table before indexing (serial) by @habdelra in https://github.com/cardstack/boxel/pull/4799
* Phase 2: job-scoped same-realm search cache during indexing by @habdelra in https://github.com/cardstack/boxel/pull/4791
* Add Concurrent Users panel to boxel-status overview by @habdelra in https://github.com/cardstack/boxel/pull/4812
* Remember prerender scroll position to prevent jump by @burieberry in https://github.com/cardstack/boxel/pull/4795
* flaky tests - percySnapshot: cap upload wait at 25s, log phase timing by @habdelra in https://github.com/cardstack/boxel/pull/4806
* observability: render Tasks panel as inline 'Run / Need' by @lukemelia in https://github.com/cardstack/boxel/pull/4814
* grafana: clarify Synapse panels in overview by @habdelra in https://github.com/cardstack/boxel/pull/4813
* observability: Concurrent Users list + Synapse panel polish by @habdelra in https://github.com/cardstack/boxel/pull/4817
* CS-11106: per-PR preview deployments for grafana dashboards by @lukemelia in https://github.com/cardstack/boxel/pull/4818
* realm: gate ::jsonb on pg so module_transpile_cache writes don't error on sqlite by @habdelra in https://github.com/cardstack/boxel/pull/4820
* CS-11133: expand per-batch search cache to cross-realm reads by @habdelra in https://github.com/cardstack/boxel/pull/4816
* observability: indexing dashboard polish — realm column, static gauge, longest-jobs move by @habdelra in https://github.com/cardstack/boxel/pull/4821
* sf playwright: fix worker-manager EADDRINUSE race + port-conflict diagnostics by @habdelra in https://github.com/cardstack/boxel/pull/4827
* ci: Move observability diff behind details by @backspace in https://github.com/cardstack/boxel/pull/4826
* Lockfile update by @ef4 in https://github.com/cardstack/boxel/pull/4825
* Remove ask-ai components, commands, and tests by @burieberry in https://github.com/cardstack/boxel/pull/4815
* CS-10009 PR 4: migrate root tests/ to explicit fixture by @lukemelia in https://github.com/cardstack/boxel/pull/4819
* PagePool: don't block reused-tab callers on standby refill (CS-11139) by @habdelra in https://github.com/cardstack/boxel/pull/4822
* worker: finalize reservation as 'completed' on fatal child error by @habdelra in https://github.com/cardstack/boxel/pull/4824
* Add fix for prerenderer cache-clearing on publish by @backspace in https://github.com/cardstack/boxel/pull/4719
* simplify host ember-cli-build.js by @ef4 in https://github.com/cardstack/boxel/pull/4834
* PagePool: non-blocking eviction + fix shared-context bookkeeping (CS-11140) by @habdelra in https://github.com/cardstack/boxel/pull/4823
* CS-10009 Final PR: rename tests/cards → fixtures/realistic, flip default to blank by @lukemelia in https://github.com/cardstack/boxel/pull/4837
* Grafana: fix Overview Tasks panels showing "No data" by @lukemelia in https://github.com/cardstack/boxel/pull/4838
* CS-11141: Allow X-Grafana-Device-Id in realm-server CORS preflight by @lukemelia in https://github.com/cardstack/boxel/pull/4835
* Refactor: move per-realm advisory lock into DBAdapter.withWriteLock by @lukemelia in https://github.com/cardstack/boxel/pull/4839
* CS-11152: fix catalog remix — resolve scoped prefixes in fetcher by @richardhjtan in https://github.com/cardstack/boxel/pull/4833
* Add Docker caching in deployments by @backspace in https://github.com/cardstack/boxel/pull/4831
* fix: pin vite to 127.0.0.1 behind same-port dispatcher by @backspace in https://github.com/cardstack/boxel/pull/4847
* createRealm: enqueue exactly one priority-10 index job (CS-11157) by @habdelra in https://github.com/cardstack/boxel/pull/4849
* Extract RealmServer class methods into per-concern handler modules by @habdelra in https://github.com/cardstack/boxel/pull/4846
* from-scratch coalesce: fall back to in-flight candidates (CS-11157) by @habdelra in https://github.com/cardstack/boxel/pull/4850
* realm-server: HTTPS+HTTP/2 in local dev by @habdelra in https://github.com/cardstack/boxel/pull/4797
* Remove legacy catalog from startup scripts (CS-11148) by @habdelra in https://github.com/cardstack/boxel/pull/4854
* CS-11167: HTTP DELETE card-source returns 204 without awaiting indexing by @habdelra in https://github.com/cardstack/boxel/pull/4857
* Stabilize prerender "distinct pages per realm" against cross-affinity steal by @habdelra in https://github.com/cardstack/boxel/pull/4856
* Graceful Ctrl-C shutdown for mise dev / dev-all by @habdelra in https://github.com/cardstack/boxel/pull/4855
* Opt private realms out of full reindex on startup by @habdelra in https://github.com/cardstack/boxel/pull/4858
* CS-11125: per-realm advisory lock on data-plane write paths by @lukemelia in https://github.com/cardstack/boxel/pull/4840
* Indexing dashboard: add full-width Completed Indexing Jobs panel by @habdelra in https://github.com/cardstack/boxel/pull/4861
* CS-11156: cross-replica clearLocalCaches broadcast via NOTIFY by @lukemelia in https://github.com/cardstack/boxel/pull/4842
* deploy: exec through pnpm/ts-node so PID 1 catches SIGTERM by @habdelra in https://github.com/cardstack/boxel/pull/4860
* realm-server: reset retrieveIndexHTML cache when work throws by @habdelra in https://github.com/cardstack/boxel/pull/4859
* CS-11119: cross-replica clearInFlightSearch via realm_index_updated NOTIFY by @lukemelia in https://github.com/cardstack/boxel/pull/4862
* Add hidden-column restore flows to kanban by @burieberry in https://github.com/cardstack/boxel/pull/4867
* host: expand isolated view to full width with floating top bar by @christse in https://github.com/cardstack/boxel/pull/4626
* feat(boxel-cli): auto-publish unstable per merge, repurpose manual workflow as stable promoter by @FadhlanR in https://github.com/cardstack/boxel/pull/4804
* fix(boxel-cli): consolidate publish workflows, push annotated tags by @FadhlanR in https://github.com/cardstack/boxel/pull/4879
* fix(boxel-cli): CS-11062 protect local edits in `boxel realm watch start` by @FadhlanR in https://github.com/cardstack/boxel/pull/4844


**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.1.4...boxel-cli-v0.2.0-unstable.298


## 2026-05-19 — npm v0.2.0-unstable.294 / plugin v0.3.0
Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.2.0-unstable.294

## @cardstack/boxel-cli v0.2.0-unstable.294 (npm `unstable`)
https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.2.0-unstable.294

## boxel-cli plugin v0.3.0
Marketplace plugin version bumped in this release.

## Changes

## What's Changed
* observability: parameterize worker-status alert log group per env (CS-11107) by @lukemelia in https://github.com/cardstack/boxel/pull/4796
* CS-10009 PR 2: migrate realm-endpoints/ tests to explicit fixture by @lukemelia in https://github.com/cardstack/boxel/pull/4790
* realm-server: lock grafana operator endpoints to POST + Bearer (CS-10927) by @lukemelia in https://github.com/cardstack/boxel/pull/4792
* Add boxel realm sync status command (CS-10621) by @FadhlanR in https://github.com/cardstack/boxel/pull/4781
* Add boxel consolidate-workspaces command (CS-10632) by @FadhlanR in https://github.com/cardstack/boxel/pull/4780
* Remove field-spec instances from packages/base by @richardhjtan in https://github.com/cardstack/boxel/pull/4724
* manual-deploy: send post-deployment auth as Authorization header [CS-11129] by @jurgenwerk in https://github.com/cardstack/boxel/pull/4807
* Rename submission branches to {hash}-{listing-slug} by @richardhjtan in https://github.com/cardstack/boxel/pull/4805
* Actually fix the software factory shard 1/3 instantiate-validation flake (follow-up to #4782) by @habdelra in https://github.com/cardstack/boxel/pull/4802
* observability: fix Overview dashboard Tasks panel rendering by @lukemelia in https://github.com/cardstack/boxel/pull/4811
* Add longest-running indexing jobs panels to Job Queue dashboard by @habdelra in https://github.com/cardstack/boxel/pull/4810
* Fix flaky 'sends read receipts only for bot messages' test by @habdelra in https://github.com/cardstack/boxel/pull/4808
* CS-11123 Phase 1: Pre-warm modules table before indexing (serial) by @habdelra in https://github.com/cardstack/boxel/pull/4799
* Phase 2: job-scoped same-realm search cache during indexing by @habdelra in https://github.com/cardstack/boxel/pull/4791
* Add Concurrent Users panel to boxel-status overview by @habdelra in https://github.com/cardstack/boxel/pull/4812
* Remember prerender scroll position to prevent jump by @burieberry in https://github.com/cardstack/boxel/pull/4795
* flaky tests - percySnapshot: cap upload wait at 25s, log phase timing by @habdelra in https://github.com/cardstack/boxel/pull/4806
* observability: render Tasks panel as inline 'Run / Need' by @lukemelia in https://github.com/cardstack/boxel/pull/4814
* grafana: clarify Synapse panels in overview by @habdelra in https://github.com/cardstack/boxel/pull/4813
* observability: Concurrent Users list + Synapse panel polish by @habdelra in https://github.com/cardstack/boxel/pull/4817
* CS-11106: per-PR preview deployments for grafana dashboards by @lukemelia in https://github.com/cardstack/boxel/pull/4818
* realm: gate ::jsonb on pg so module_transpile_cache writes don't error on sqlite by @habdelra in https://github.com/cardstack/boxel/pull/4820
* CS-11133: expand per-batch search cache to cross-realm reads by @habdelra in https://github.com/cardstack/boxel/pull/4816
* observability: indexing dashboard polish — realm column, static gauge, longest-jobs move by @habdelra in https://github.com/cardstack/boxel/pull/4821
* sf playwright: fix worker-manager EADDRINUSE race + port-conflict diagnostics by @habdelra in https://github.com/cardstack/boxel/pull/4827
* ci: Move observability diff behind details by @backspace in https://github.com/cardstack/boxel/pull/4826
* Lockfile update by @ef4 in https://github.com/cardstack/boxel/pull/4825
* Remove ask-ai components, commands, and tests by @burieberry in https://github.com/cardstack/boxel/pull/4815
* CS-10009 PR 4: migrate root tests/ to explicit fixture by @lukemelia in https://github.com/cardstack/boxel/pull/4819
* PagePool: don't block reused-tab callers on standby refill (CS-11139) by @habdelra in https://github.com/cardstack/boxel/pull/4822
* worker: finalize reservation as 'completed' on fatal child error by @habdelra in https://github.com/cardstack/boxel/pull/4824
* Add fix for prerenderer cache-clearing on publish by @backspace in https://github.com/cardstack/boxel/pull/4719
* simplify host ember-cli-build.js by @ef4 in https://github.com/cardstack/boxel/pull/4834
* PagePool: non-blocking eviction + fix shared-context bookkeeping (CS-11140) by @habdelra in https://github.com/cardstack/boxel/pull/4823
* CS-10009 Final PR: rename tests/cards → fixtures/realistic, flip default to blank by @lukemelia in https://github.com/cardstack/boxel/pull/4837
* Grafana: fix Overview Tasks panels showing "No data" by @lukemelia in https://github.com/cardstack/boxel/pull/4838
* CS-11141: Allow X-Grafana-Device-Id in realm-server CORS preflight by @lukemelia in https://github.com/cardstack/boxel/pull/4835
* Refactor: move per-realm advisory lock into DBAdapter.withWriteLock by @lukemelia in https://github.com/cardstack/boxel/pull/4839
* CS-11152: fix catalog remix — resolve scoped prefixes in fetcher by @richardhjtan in https://github.com/cardstack/boxel/pull/4833
* Add Docker caching in deployments by @backspace in https://github.com/cardstack/boxel/pull/4831
* fix: pin vite to 127.0.0.1 behind same-port dispatcher by @backspace in https://github.com/cardstack/boxel/pull/4847
* createRealm: enqueue exactly one priority-10 index job (CS-11157) by @habdelra in https://github.com/cardstack/boxel/pull/4849
* Extract RealmServer class methods into per-concern handler modules by @habdelra in https://github.com/cardstack/boxel/pull/4846
* from-scratch coalesce: fall back to in-flight candidates (CS-11157) by @habdelra in https://github.com/cardstack/boxel/pull/4850
* realm-server: HTTPS+HTTP/2 in local dev by @habdelra in https://github.com/cardstack/boxel/pull/4797
* Remove legacy catalog from startup scripts (CS-11148) by @habdelra in https://github.com/cardstack/boxel/pull/4854
* CS-11167: HTTP DELETE card-source returns 204 without awaiting indexing by @habdelra in https://github.com/cardstack/boxel/pull/4857
* Stabilize prerender "distinct pages per realm" against cross-affinity steal by @habdelra in https://github.com/cardstack/boxel/pull/4856
* Graceful Ctrl-C shutdown for mise dev / dev-all by @habdelra in https://github.com/cardstack/boxel/pull/4855
* Opt private realms out of full reindex on startup by @habdelra in https://github.com/cardstack/boxel/pull/4858
* CS-11125: per-realm advisory lock on data-plane write paths by @lukemelia in https://github.com/cardstack/boxel/pull/4840
* Indexing dashboard: add full-width Completed Indexing Jobs panel by @habdelra in https://github.com/cardstack/boxel/pull/4861
* CS-11156: cross-replica clearLocalCaches broadcast via NOTIFY by @lukemelia in https://github.com/cardstack/boxel/pull/4842
* deploy: exec through pnpm/ts-node so PID 1 catches SIGTERM by @habdelra in https://github.com/cardstack/boxel/pull/4860
* realm-server: reset retrieveIndexHTML cache when work throws by @habdelra in https://github.com/cardstack/boxel/pull/4859
* CS-11119: cross-replica clearInFlightSearch via realm_index_updated NOTIFY by @lukemelia in https://github.com/cardstack/boxel/pull/4862
* Add hidden-column restore flows to kanban by @burieberry in https://github.com/cardstack/boxel/pull/4867
* host: expand isolated view to full width with floating top bar by @christse in https://github.com/cardstack/boxel/pull/4626
* feat(boxel-cli): auto-publish unstable per merge, repurpose manual workflow as stable promoter by @FadhlanR in https://github.com/cardstack/boxel/pull/4804


**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.1.4...boxel-cli-v0.2.0-unstable.294


## 2026-05-19 — npm v0.2.0-unstable.293 / plugin v0.2.0
Release: https://github.com/cardstack/boxel/releases/tag/boxel-cli-v0.2.0-unstable.293

## @cardstack/boxel-cli v0.2.0-unstable.293 (npm `unstable`)
https://www.npmjs.com/package/@cardstack/boxel-cli/v/0.2.0-unstable.293

## boxel-cli plugin v0.2.0
Marketplace plugin version bumped in this release.

## Changes

## What's Changed
* observability: parameterize worker-status alert log group per env (CS-11107) by @lukemelia in https://github.com/cardstack/boxel/pull/4796
* CS-10009 PR 2: migrate realm-endpoints/ tests to explicit fixture by @lukemelia in https://github.com/cardstack/boxel/pull/4790
* realm-server: lock grafana operator endpoints to POST + Bearer (CS-10927) by @lukemelia in https://github.com/cardstack/boxel/pull/4792
* Add boxel realm sync status command (CS-10621) by @FadhlanR in https://github.com/cardstack/boxel/pull/4781
* Add boxel consolidate-workspaces command (CS-10632) by @FadhlanR in https://github.com/cardstack/boxel/pull/4780
* Remove field-spec instances from packages/base by @richardhjtan in https://github.com/cardstack/boxel/pull/4724
* manual-deploy: send post-deployment auth as Authorization header [CS-11129] by @jurgenwerk in https://github.com/cardstack/boxel/pull/4807
* Rename submission branches to {hash}-{listing-slug} by @richardhjtan in https://github.com/cardstack/boxel/pull/4805
* Actually fix the software factory shard 1/3 instantiate-validation flake (follow-up to #4782) by @habdelra in https://github.com/cardstack/boxel/pull/4802
* observability: fix Overview dashboard Tasks panel rendering by @lukemelia in https://github.com/cardstack/boxel/pull/4811
* Add longest-running indexing jobs panels to Job Queue dashboard by @habdelra in https://github.com/cardstack/boxel/pull/4810
* Fix flaky 'sends read receipts only for bot messages' test by @habdelra in https://github.com/cardstack/boxel/pull/4808
* CS-11123 Phase 1: Pre-warm modules table before indexing (serial) by @habdelra in https://github.com/cardstack/boxel/pull/4799
* Phase 2: job-scoped same-realm search cache during indexing by @habdelra in https://github.com/cardstack/boxel/pull/4791
* Add Concurrent Users panel to boxel-status overview by @habdelra in https://github.com/cardstack/boxel/pull/4812
* Remember prerender scroll position to prevent jump by @burieberry in https://github.com/cardstack/boxel/pull/4795
* flaky tests - percySnapshot: cap upload wait at 25s, log phase timing by @habdelra in https://github.com/cardstack/boxel/pull/4806
* observability: render Tasks panel as inline 'Run / Need' by @lukemelia in https://github.com/cardstack/boxel/pull/4814
* grafana: clarify Synapse panels in overview by @habdelra in https://github.com/cardstack/boxel/pull/4813
* observability: Concurrent Users list + Synapse panel polish by @habdelra in https://github.com/cardstack/boxel/pull/4817
* CS-11106: per-PR preview deployments for grafana dashboards by @lukemelia in https://github.com/cardstack/boxel/pull/4818
* realm: gate ::jsonb on pg so module_transpile_cache writes don't error on sqlite by @habdelra in https://github.com/cardstack/boxel/pull/4820
* CS-11133: expand per-batch search cache to cross-realm reads by @habdelra in https://github.com/cardstack/boxel/pull/4816
* observability: indexing dashboard polish — realm column, static gauge, longest-jobs move by @habdelra in https://github.com/cardstack/boxel/pull/4821
* sf playwright: fix worker-manager EADDRINUSE race + port-conflict diagnostics by @habdelra in https://github.com/cardstack/boxel/pull/4827
* ci: Move observability diff behind details by @backspace in https://github.com/cardstack/boxel/pull/4826
* Lockfile update by @ef4 in https://github.com/cardstack/boxel/pull/4825
* Remove ask-ai components, commands, and tests by @burieberry in https://github.com/cardstack/boxel/pull/4815
* CS-10009 PR 4: migrate root tests/ to explicit fixture by @lukemelia in https://github.com/cardstack/boxel/pull/4819
* PagePool: don't block reused-tab callers on standby refill (CS-11139) by @habdelra in https://github.com/cardstack/boxel/pull/4822
* worker: finalize reservation as 'completed' on fatal child error by @habdelra in https://github.com/cardstack/boxel/pull/4824
* Add fix for prerenderer cache-clearing on publish by @backspace in https://github.com/cardstack/boxel/pull/4719
* simplify host ember-cli-build.js by @ef4 in https://github.com/cardstack/boxel/pull/4834
* PagePool: non-blocking eviction + fix shared-context bookkeeping (CS-11140) by @habdelra in https://github.com/cardstack/boxel/pull/4823
* CS-10009 Final PR: rename tests/cards → fixtures/realistic, flip default to blank by @lukemelia in https://github.com/cardstack/boxel/pull/4837
* Grafana: fix Overview Tasks panels showing "No data" by @lukemelia in https://github.com/cardstack/boxel/pull/4838
* CS-11141: Allow X-Grafana-Device-Id in realm-server CORS preflight by @lukemelia in https://github.com/cardstack/boxel/pull/4835
* Refactor: move per-realm advisory lock into DBAdapter.withWriteLock by @lukemelia in https://github.com/cardstack/boxel/pull/4839
* CS-11152: fix catalog remix — resolve scoped prefixes in fetcher by @richardhjtan in https://github.com/cardstack/boxel/pull/4833
* Add Docker caching in deployments by @backspace in https://github.com/cardstack/boxel/pull/4831
* fix: pin vite to 127.0.0.1 behind same-port dispatcher by @backspace in https://github.com/cardstack/boxel/pull/4847
* createRealm: enqueue exactly one priority-10 index job (CS-11157) by @habdelra in https://github.com/cardstack/boxel/pull/4849
* Extract RealmServer class methods into per-concern handler modules by @habdelra in https://github.com/cardstack/boxel/pull/4846
* from-scratch coalesce: fall back to in-flight candidates (CS-11157) by @habdelra in https://github.com/cardstack/boxel/pull/4850
* realm-server: HTTPS+HTTP/2 in local dev by @habdelra in https://github.com/cardstack/boxel/pull/4797
* Remove legacy catalog from startup scripts (CS-11148) by @habdelra in https://github.com/cardstack/boxel/pull/4854
* CS-11167: HTTP DELETE card-source returns 204 without awaiting indexing by @habdelra in https://github.com/cardstack/boxel/pull/4857
* Stabilize prerender "distinct pages per realm" against cross-affinity steal by @habdelra in https://github.com/cardstack/boxel/pull/4856
* Graceful Ctrl-C shutdown for mise dev / dev-all by @habdelra in https://github.com/cardstack/boxel/pull/4855
* Opt private realms out of full reindex on startup by @habdelra in https://github.com/cardstack/boxel/pull/4858
* CS-11125: per-realm advisory lock on data-plane write paths by @lukemelia in https://github.com/cardstack/boxel/pull/4840
* Indexing dashboard: add full-width Completed Indexing Jobs panel by @habdelra in https://github.com/cardstack/boxel/pull/4861
* CS-11156: cross-replica clearLocalCaches broadcast via NOTIFY by @lukemelia in https://github.com/cardstack/boxel/pull/4842
* deploy: exec through pnpm/ts-node so PID 1 catches SIGTERM by @habdelra in https://github.com/cardstack/boxel/pull/4860
* realm-server: reset retrieveIndexHTML cache when work throws by @habdelra in https://github.com/cardstack/boxel/pull/4859
* CS-11119: cross-replica clearInFlightSearch via realm_index_updated NOTIFY by @lukemelia in https://github.com/cardstack/boxel/pull/4862
* Add hidden-column restore flows to kanban by @burieberry in https://github.com/cardstack/boxel/pull/4867
* host: expand isolated view to full width with floating top bar by @christse in https://github.com/cardstack/boxel/pull/4626
* feat(boxel-cli): auto-publish unstable per merge, repurpose manual workflow as stable promoter by @FadhlanR in https://github.com/cardstack/boxel/pull/4804


**Full Changelog**: https://github.com/cardstack/boxel/compare/boxel-cli-v0.1.4...boxel-cli-v0.2.0-unstable.293

