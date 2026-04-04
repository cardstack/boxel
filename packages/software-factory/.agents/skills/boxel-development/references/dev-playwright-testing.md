# Playwright Testing for Boxel Cards

How to write Playwright test specs for card definitions produced by the software factory.

## Where Files Live

- **Test spec files** go in the **target realm's** `Tests/` folder (e.g., `Tests/sticky-note.spec.ts`)
- **Card instances created during tests** go in the **test artifacts realm**, not the target realm. The test artifacts realm is auto-created (e.g., `<target>-test-artifacts`) with per-run folders (`Run 1/`, `Run 2/`, etc.)
- **Card definitions** (`.gts`) and **Catalog Spec cards** (`Spec/*.json`) live in the target realm — tests reference them but don't modify them

## Environment Variables

The test execution infrastructure injects these environment variables into every Playwright spec:

| Variable                             | Description                                                        |
| ------------------------------------ | ------------------------------------------------------------------ |
| `BOXEL_SOURCE_REALM_URL`             | The target realm URL being tested (where card definitions live)    |
| `BOXEL_TEST_ARTIFACTS_FOLDER_URL`    | URL to write test card instances to (includes the `Run N/` folder) |
| `BOXEL_TEST_ARTIFACTS_AUTHORIZATION` | JWT for writing to the test artifacts realm                        |
| `BOXEL_TEST_REALM_URL`               | Same as `BOXEL_SOURCE_REALM_URL`                                   |
| `PLAYWRIGHT_TEST_DIR`                | Local directory containing the pulled spec files                   |

## Writing a Test Spec

Tests must verify that cards **render correctly in the browser**, not just that JSON can be round-tripped through the API. The realm API accepts writes without validating that the card definition compiles, so API-only tests can pass even when the card is broken.

Every test spec must:

1. Import from `@playwright/test`
2. Create a card instance in the test artifacts realm via `request.post()`
3. **Navigate to the card instance in the browser** via `page.goto()`
4. **Assert on rendered DOM content** using `data-test-*` selectors
5. Never use `networkidle` — use `domcontentloaded` + visible element assertions

### Complete Example

```typescript
import { expect, test } from '@playwright/test';

test('sticky note renders title and content', async ({ page, request }) => {
  let sourceRealmUrl = process.env.BOXEL_SOURCE_REALM_URL!;
  let artifactsFolderUrl = process.env.BOXEL_TEST_ARTIFACTS_FOLDER_URL!;
  let authorization = process.env.BOXEL_TEST_ARTIFACTS_AUTHORIZATION!;

  // Step 1: Create a card instance in the test artifacts realm
  let createResponse = await request.post(
    artifactsFolderUrl + 'StickyNote/test-note.json',
    {
      headers: {
        Accept: 'application/vnd.card+source',
        'Content-Type': 'application/vnd.card+source',
        Authorization: authorization,
      },
      data: JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            title: 'Test Note',
            content: 'Hello from the test',
          },
          meta: {
            adoptsFrom: {
              module: sourceRealmUrl + 'sticky-note',
              name: 'StickyNote',
            },
          },
        },
      }),
    },
  );
  expect(createResponse.ok()).toBe(true);

  // Step 2: Set up browser auth via localStorage (same as the prerenderer).
  // boxel-session is a JSON object mapping realm URLs to JWTs.
  let realmOrigin = new URL(artifactsFolderUrl).origin;
  let realmUrl = new URL(artifactsFolderUrl).href.replace(/\/Run.*$/, '/');
  await page.goto(realmOrigin, { waitUntil: 'domcontentloaded' });
  await page.evaluate(
    ({ url, token }) => {
      let sessions: Record<string, string> = {};
      sessions[url] = token;
      localStorage.setItem('boxel-session', JSON.stringify(sessions));
    },
    { url: realmUrl, token: authorization },
  );

  // Step 3: Navigate to the card instance in the browser
  await page.goto(artifactsFolderUrl + 'StickyNote/test-note', {
    waitUntil: 'domcontentloaded',
  });

  // Step 3: Assert on rendered DOM content
  await expect(page.locator('[data-test-title]')).toContainText('Test Note');
  await expect(page.locator('[data-test-content]')).toContainText(
    'Hello from the test',
  );
});
```

### Why Browser Rendering Tests Matter

API-only tests (`request.post` + `request.get`) only verify that JSON round-trips through the realm. They do NOT verify:

- The `.gts` card definition compiles without errors
- Imports resolve (e.g., icon imports, field imports)
- Templates render correctly
- Computed fields work
- Styles apply

If you only test via the API, a card with a broken import or template error will pass all tests but fail when a user tries to view it. **Always include at least one test that navigates to the card in the browser and asserts on rendered content.**

### Key Patterns

**Creating a card instance (test data setup):**

Use `request.post()` with card+source MIME type to create instances in the test artifacts realm. This is setup — not the actual assertion.

```typescript
let response = await request.post(
  artifactsFolderUrl + 'CardType/instance-name.json',
  {
    headers: {
      Accept: 'application/vnd.card+source',
      'Content-Type': 'application/vnd.card+source',
      Authorization: authorization,
    },
    data: JSON.stringify({
      data: {
        type: 'card',
        attributes: {
          /* card fields */
        },
        meta: {
          adoptsFrom: {
            module: sourceRealmUrl + 'card-definition',
            name: 'CardClassName',
          },
        },
      },
    }),
  },
);
expect(response.ok()).toBe(true);
```

**Navigating to a card and asserting on rendered content:**

```typescript
await page.goto(artifactsFolderUrl + 'CardType/instance-name', {
  waitUntil: 'domcontentloaded',
});

// Assert on rendered fields using data-test-* selectors
await expect(page.locator('[data-test-title]')).toContainText('Expected Title');
await expect(page.locator('[data-test-content]')).toBeVisible();
```

**The `adoptsFrom.module` path** must point to the card definition in the **source realm** (target realm). Use `sourceRealmUrl + '<definition-file-without-extension>'`. For example, if the card definition is `sticky-note.gts` in the target realm, use `sourceRealmUrl + 'sticky-note'`.

## Debugging Test Failures

When tests fail, the orchestrator feeds test failure details back to the agent. For more detail:

- **TestRun cards** live in the target realm's `Test Runs/` folder. To find all test runs, search by the TestRun card type in the target realm:

  ```json
  {
    "filter": {
      "type": {
        "module": "<targetRealmUrl>test-results",
        "name": "TestRun"
      }
    }
  }
  ```

  Each TestRun has a `sequenceNumber` that increases with each iteration of the agentic loop. To see the latest run, sort by `sequenceNumber` descending. Each TestRun contains structured `specResults` with individual test pass/fail status, error messages, and stack traces. Use `read_file` on a specific TestRun for full details.

- **Test artifacts realm** contains the card instances created during test execution. The Project card's `testArtifactsRealmUrl` field has the realm URL. Each test run gets its own folder (`Run 1/`, `Run 2/`, etc.). You can use `search_realm` against the test artifacts realm to inspect what was created during a failing test run.

## Rules

- **Always test browser rendering** — at least one test per card must navigate to the instance and assert on rendered DOM. API-only tests miss compilation errors, broken imports, and template bugs.
- **Never use `networkidle`** — Boxel host pages have long-lived network activity. Use `domcontentloaded` plus visible element assertions instead.
- **Never write test instances to the target realm** — always use `BOXEL_TEST_ARTIFACTS_FOLDER_URL`. The test artifacts realm gets a fresh `Run N/` folder per execution to prevent collision between runs.
- **Use `data-test-*` attributes** in card templates for stable test selectors, not CSS classes.
- **Every ticket must have at least one test file** in `Tests/<ticket-slug>.spec.ts`.
- **Test files are pulled from the target realm** to a local temp directory before Playwright runs them. The specs themselves live in the target realm as realm files.
