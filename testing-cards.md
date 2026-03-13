# Testing Cards in Code Mode

## Context

The goal is to allow card authors to write and run tests directly from code mode, with results shown in the RHS panel. Tests should deal with DOM assertions only and not expose Ember/QUnit internals.

---

## Option 1: `.test.gts` Module + In-App Mini Runner

When a `.test.gts` file is opened in code mode, the RHS switches from the Playground panel to a **Test Runner panel**.

**Runner:** Custom micro-runner (~30 lines) — no global state, fully isolated instance, owned by the test panel service.

**Assertions:** [`@testing-library/dom`](https://testing-library.com/docs/dom-testing-library/intro/) — browser-native, framework-agnostic, encourages accessible queries (`getByRole`, `getByText`).

**Rendering:** Thin wrapper around `renderComponent` (from `@glimmer/core`) using the app's owner. `settled()` from `@ember/test-helpers` used internally — not exposed to test authors.

```ts
// example test file
test('shows name', async (container) => {
  const card = new PersonCard({ firstName: 'Alice' });
  await render(<PersonCard @card={card} />, container);
  getByText(container, 'Alice');
});
```

**Pros:**
- Clean API, no framework leakage to test authors
- Uses existing `loaderService` for dynamic module import
- RHS panel is a natural extension of the existing playground panel

**Cons:**
- Rendering Glimmer components requires careful owner/context injection
- `settled()` internals still needed under the hood
- No test isolation from host app services

---

## Option 2: Iframe-Sandboxed Test Environment

The RHS renders a sandboxed `<iframe>` pointing to a special `/_test-runner` route. The iframe loads the host app in minimal mode, imports the test module via the realm loader, runs tests in its own isolated Glimmer app instance, and `postMessage`s results back.

```
Code mode test panel
  └── <iframe src="/_test-runner?module=...">
        └── loads host app in minimal mode
        └── imports test module via loaderService
        └── runs tests in isolated JS context
        └── postMessage results → parent panel
```

**Pros:**
- Full JS context isolation (no service state leakage, separate localStorage)
- Failures can't crash the host app
- Reuses the same Chrome process the user is already in — no Puppeteer/Node needed
- Similar isolation model to the prerender `PagePool` (separate `BrowserContext` per realm), but client-side

**Cons:**
- More infrastructure (iframe shell, postMessage protocol)
- Auth tokens and realm access need to be forwarded
- Debugging inside an iframe is harder

---

## Option 3: Vitest Browser Mode via Prerender Server Endpoint

**Prerequisite: Vite migration (planned).**

A `/run-tests` endpoint is added to the prerender server. Code mode calls it with the test module URL. The endpoint uses Vitest's programmatic API to spin up a Playwright-managed Chrome page, run the tests, and return structured results.

```
Code mode (browser)
  → POST /run-tests { module: "https://my-realm/my-card.test.gts" }
  → Prerender server (Node)
      └── createVitest()
      └── vitest.runFiles(['my-card.test.gts'])
      └── Playwright launches/reuses Chrome page
            └── Vite serves /_test-runner page
            └── MemoryRealm boots in page
            └── tests run with full realm semantics
      └── returns structured JSON results
  → RHS panel renders pass/fail
```

**Assertions:** `qunit-dom` (already in project) or `@testing-library/dom` — both work inside Vitest browser mode.

```ts
// example test file
import { test, expect } from 'vitest';

test('search returns created card', async () => {
  await createCard(PersonCard, { firstName: 'Alice' });
  await render(<PersonSearch />);
  expect(document.querySelector('[data-test-result]')).toHaveTextContent('Alice');
});
```

**Pros:**
- Vitest replaces the custom `BrowserManager`/`PagePool` machinery for test running
- Real browser context per test file — full isolation
- HMR: test file changes re-run instantly via Vite
- No custom `postMessage` protocol — results come back as JSON over HTTP
- Consistent with existing prerender server pattern (`/run-command`, `/prerender-card`)
- Native ESM — no custom `loaderService` needed for module loading

**Cons:**
- Requires Vite migration first
- Vitest programmatic API is Node-only — still needs the server endpoint
- Playwright adds another process dependency alongside existing Puppeteer
- MemoryRealm boot inside Vitest browser context needs validation

---

## Option 4: Test Specs — Extend Playground Infrastructure

Add a `TestSpec` card type (extends `Spec`). Tests are assertions run against the rendered output of the playground preview. The playground panel gains a **Tests tab**.

**Pros:**
- Maximum reuse of existing playground, instance chooser, format chooser
- Tests are cards — indexable and searchable in the realm
- No new panel architecture

**Cons:**
- Tests-as-cards is conceptually awkward (stored in realm, not alongside source files)
- Async tests are hard (assertions must fire after render in the same tick)
- Scope limited to "does this card render correctly" — no arbitrary test logic

---

## Key Design Decision: Test Data Model

### Model A — Construct from scratch (no realm)

Tests instantiate card data directly in test code. No realm server, no indexing, no storage. Fast and fully isolated.

```ts
const card = new PersonCard({ firstName: 'Alice' });
await render(<PersonCard @card={card} />, container);
```

**Suitable for:** Pure rendering/component tests.
**Not suitable for:** Tests involving realm queries, linked cards resolved from storage, or live data.

### Model B — Fresh ephemeral realm per test run

Each test suite gets a clean in-memory realm (similar to how existing acceptance tests use `setupPermissionedRealms` with a `MemoryRealm`). Tests write data as part of setup, then assert on rendered output that reads from it.

**Suitable for:** Full integration tests — queries, relationships, live data.
**Not suitable for:** Lightweight embedding in a running app without significant infrastructure.

---

## Why Not Standard Tools

| Tool | Why Not |
|---|---|
| **QUnit** | Global test registry — dynamically importing a `.test.gts` module registers tests into the same global queue as `/tests`, causing collision and state corruption |
| **Testem** | CLI process manager, not embeddable. Spins up browsers externally — irrelevant when already inside a running browser |
| **Vitest (current)** | Browser mode requires a Vite pipeline + Node orchestration. Programmatic API (`createVitest`) is Node-only. Project uses Ember CLI/Embroider, not Vite — see Option 3 for post-migration path |
| **Prerender manager** | Server-side concern (Node → Puppeteer → Chrome) designed for indexing without a user's browser. Code mode already runs inside Chrome — no new browser needed |
| **Mocha** | Has a valid programmatic `new Mocha()` API with isolated instance per runner. ~270kb browser bundle. Viable alternative to custom micro-runner if `describe`/`beforeEach` hooks are needed |
