# Testing Cards in Code Mode — Implementation Tasks

Commit-sized tasks grouped by layer. Work top-to-bottom — each group roughly depends on the one above it.

---

## 1. Prerender Server

- [ ] Add `/run-tests` endpoint to prerender server (Koa route, mirrors `/run-command` pattern)
- [ ] Integrate `PagePool` for test runs — borrow page, navigate to `/_test-runner?module=<url>`, wait for `window.__testResults`, return JSON, close page

---

## 2. Host App — `/_test-runner` Route

- [ ] Add `/_test-runner` Ember route that accepts `?module=<url>` query param
- [ ] Boot `MemoryRealm` (SQLite WASM + `TestRealmAdapter`) inside `/_test-runner` on route load
- [ ] Dynamically import test module via `loaderService` from the `module` query param
- [ ] Wire QUnit (`QUnit.module`, `QUnit.done`) to run imported tests and write result to `window.__testResults`

---

## 3. Test Support Package

- [ ] Create `@cardstack/test-support` package with `test`, `setupRealm`, `render`, `assert`, `beforeEach`, `afterEach`, `beforeAll`, `afterAll` exports
- [ ] Implement `setupRealm(hooks, files)` — wraps QUnit `beforeAll`, boots `MemoryRealm`, seeds with provided file map
- [ ] Implement `render(component, container)` — renders Glimmer component into DOM container, calls `settled()` internally
- [ ] Implement lifecycle hook exports — `beforeEach`, `afterEach`, `beforeAll`, `afterAll` delegating to QUnit module hooks

---

## 4. Realm — Test File Indexing

- [ ] Index `.test.gts` files as `GtsFileDef` in the realm — detect by extension, not treated as card definitions

---

## 5. Code Mode — LHS

- [ ] Detect `.test.gts` when opened in Monaco and switch code mode to test mode
- [ ] Show distinct icon for `.test.gts` files in the LHS file tree
- [ ] Show summary badge (e.g. `3/5 passed`) next to test file name in tree after a run
- [ ] Add Monaco gutter markers (green/red) next to each `test()` call after a run
- [ ] Grey out gutter markers on any Monaco edit after a run (invalidation)

---

## 6. Code Mode — `TestRunnerService`

- [ ] Create `TestRunnerService` — stores `{ moduleUrl, status, results }` keyed by test file URL
- [ ] Implement `runTests(moduleUrl)` — calls `POST /run-tests` on prerender server, updates state
- [ ] Implement invalidation — any Monaco content change sets status to `idle` and greys results without clearing them

---

## 7. Code Mode — RHS Test Runner Tab

- [ ] Add Test Runner tab to RHS panel alongside Spec and Playground tabs
- [ ] Show/hide Test Runner tab based on whether the open file is `.test.gts`
- [ ] Implement idle state UI — "Run Tests" prompt, prominent Run button, no results
- [ ] Implement running state UI — spinner, Run button disabled
- [ ] Implement pass state UI — green summary line, green bullet per test
- [ ] Implement fail state UI — red summary, failing tests expanded with `qunit-dom` message and actual/expected diff, collapsible stack trace
- [ ] Implement error state UI — module load or setup error with stack trace
- [ ] Implement invalidated state UI — all bullets grey, tab indicator neutral, results still visible
