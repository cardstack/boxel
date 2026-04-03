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

Every test spec must:

1. Import from `@playwright/test`
2. Read environment variables for realm URLs and auth
3. Create card instances in the **test artifacts realm** (not the target realm)
4. Use `request.post()` / `request.get()` with the `application/vnd.card+source` MIME type
5. Use `data-test-*` attributes for DOM assertions (not CSS classes)

### Complete Example (from the factory smoke test)

```typescript
import { expect, test } from '@playwright/test';

test('hello card renders greeting', async ({ request }) => {
  let sourceRealmUrl = process.env.BOXEL_SOURCE_REALM_URL!;
  let artifactsFolderUrl = process.env.BOXEL_TEST_ARTIFACTS_FOLDER_URL!;
  let authorization = process.env.BOXEL_TEST_ARTIFACTS_AUTHORIZATION!;

  // Create a card instance in the test artifacts folder (Run N/).
  // This is where ALL test-created instances must go — never write
  // test data to the target realm.
  let response = await request.post(
    artifactsFolderUrl + 'HelloCard/smoke-pass.json',
    {
      headers: {
        Accept: 'application/vnd.card+source',
        'Content-Type': 'application/vnd.card+source',
        Authorization: authorization,
      },
      data: JSON.stringify({
        data: {
          type: 'card',
          attributes: { greeting: 'Hello from smoke test' },
          meta: {
            adoptsFrom: {
              module: sourceRealmUrl + 'hello',
              name: 'HelloCard',
            },
          },
        },
      }),
    },
  );
  expect(response.ok()).toBe(true);

  // Verify the card was created by reading it back.
  let readResponse = await request.get(
    artifactsFolderUrl + 'HelloCard/smoke-pass',
    {
      headers: {
        Accept: 'application/vnd.card+source',
        Authorization: authorization,
      },
    },
  );
  expect(readResponse.ok()).toBe(true);
  let card = await readResponse.json();
  expect(card.data.attributes.greeting).toBe('Hello from smoke test');
});
```

### Key Patterns

**Creating a card instance in the test artifacts realm:**

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
```

**Reading a card back to verify:**

```typescript
let readResponse = await request.get(
  artifactsFolderUrl + 'CardType/instance-name',
  {
    headers: {
      Accept: 'application/vnd.card+source',
      Authorization: authorization,
    },
  },
);
let card = await readResponse.json();
expect(card.data.attributes.fieldName).toBe('expected value');
```

**The `adoptsFrom.module` path** must point to the card definition in the **source realm** (target realm). Use `sourceRealmUrl + '<definition-file-without-extension>'`. For example, if the card definition is `sticky-note.gts` in the target realm, use `sourceRealmUrl + 'sticky-note'`.

## Rules

- **Never use `networkidle`** — Boxel host pages have long-lived network activity. Use `domcontentloaded` plus visible element assertions instead.
- **Never write test instances to the target realm** — always use `BOXEL_TEST_ARTIFACTS_FOLDER_URL`. The test artifacts realm gets a fresh `Run N/` folder per execution to prevent collision between runs.
- **Use `data-test-*` attributes** for stable test selectors, not CSS classes.
- **Every ticket must have at least one test file** in `Tests/<ticket-slug>.spec.ts`.
- **Test files are pulled from the target realm** to a local temp directory before Playwright runs them. The specs themselves live in the target realm as realm files.
