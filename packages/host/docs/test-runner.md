# Card Test Runner — Host App API

This document explains how to run `.test.gts` realm files via the prerender server's `/run-tests` endpoint, and how to reproduce a test run manually using `curl` or a fetch call.

---

## Overview

```
.test.gts file in realm
  → POST /run-tests (prerender server)
      └── PagePool.getPage()
      └── page.goto('/_test-runner?module=<url>&nonce=<n>[&filter=<name>]')
      └── /_test-runner route boots in Puppeteer page
      └── test module imported via loaderService
      └── tests filtered by name (if filter provided), then run sequentially
      └── results written to DOM → [data-test-results]
  → JSON response with pass/fail/counts
```

---

## Prerender Server — `/run-tests` endpoint

**Method:** `POST`
**Content-Type:** `application/json`

### Request body

```json
{
  "data": {
    "attributes": {
      "moduleUrl": "http://localhost:4201/experiments/sample-command-card.test.gts",
      "auth": "<jwt-or-session-token>",
      "realm": "http://localhost:4201/experiments/",
      "affinityType": "realm",
      "affinityValue": "http://localhost:4201/experiments/"
    }
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `moduleUrl` | string | yes | Full URL of the `.test.gts` file in the realm |
| `auth` | string | yes | JWT or session auth for the realm |
| `realm` | string | yes | Realm base URL |
| `affinityType` | `"realm"` or `"user"` | yes | Page pool affinity — use `"realm"` for test runs |
| `affinityValue` | string | yes | Realm URL (when `affinityType = "realm"`) |
| `filter` | string | no | Exact test name to run. Omit to run all tests. |

### Response body (HTTP 201)

```json
{
  "data": {
    "type": "test-result",
    "id": "http://localhost:4201/experiments/sample-command-card.test.gts",
    "attributes": {
      "status": "pass",
      "total": 5,
      "passed": 5,
      "failed": 0,
      "duration": 1240,
      "tests": [
        {
          "name": "SampleCommand returns a greeting for the given name",
          "status": "pass",
          "duration": 38
        },
        {
          "name": "SampleCommand falls back to World when name is empty",
          "status": "pass",
          "duration": 12
        }
      ]
    }
  },
  "meta": {
    "timing": { "launchMs": 320, "renderMs": 920, "totalMs": 1240 },
    "pool": { "pageId": "...", "affinityType": "realm", "affinityValue": "...", "reused": false, "evicted": false, "timedOut": false }
  }
}
```

### curl example

```sh
PRERENDER_URL="http://localhost:4221"
REALM_URL="http://localhost:4201/experiments/"
AUTH_TOKEN="<your-jwt>"

curl -s -X POST "${PRERENDER_URL}/run-tests" \
  -H "Content-Type: application/json" \
  -d "{
    \"data\": {
      \"attributes\": {
        \"moduleUrl\": \"${REALM_URL}sample-command-card.test.gts\",
        \"auth\": \"${AUTH_TOKEN}\",
        \"realm\": \"${REALM_URL}\",
        \"affinityType\": \"realm\",
        \"affinityValue\": \"${REALM_URL}\"
      }
    }
  }" | jq '.data.attributes'
```

---

## Host App — `/_test-runner` route

The prerender server navigates a Puppeteer page to:

```
/_test-runner?module=<encoded-module-url>&nonce=<n>
```

The route:
1. Reads `module` and `nonce` from query params
2. Exposes `globalThis.__boxelTestRegistry` for test modules to register tests
3. Dynamically imports the test module via `loaderService.loader.import(moduleUrl)`
4. Runs collected tests sequentially, catching errors per-test
5. Serialises results to `[data-test-results]` in the DOM (hidden `<pre>`)
6. Sets `data-prerender-status="ready"` (or `"error"`) on `[data-prerender-id="test-runner"]`

The prerender server polls the `data-prerender-status` attribute until it is set, then reads `[data-test-results]` to get the JSON payload.

### Visiting the route manually in a browser

Navigate to (experiments realm running locally):

```
http://localhost:4200/_test-runner?module=http%3A%2F%2Flocalhost%3A4201%2Fexperiments%2Fsample-command-card.test.gts&nonce=1
```

Open DevTools → Elements and inspect:

```html
<div data-prerender data-prerender-id="test-runner"
     data-prerender-nonce="1" data-prerender-status="ready">
  <pre data-test-results hidden>{"status":"pass","total":5,...}</pre>
</div>
```

Or in the console:

```js
JSON.parse(document.querySelector('[data-test-results]').textContent)
```

---

## Writing a test file

Test files are `.test.gts` files that live in the realm alongside card definitions.

```ts
// my-card.test.gts

// Future: import { test } from '@cardstack/test-support';
// For now, use the global registry provided by /_test-runner:

declare const globalThis: {
  __boxelTestRegistry?: {
    test(name: string, fn: () => Promise<void> | void): void;
  };
};

function test(name: string, fn: () => Promise<void> | void): void {
  globalThis.__boxelTestRegistry!.test(name, fn);
}

test('my card has the expected title', async () => {
  let { MyCard } = await import('./my-card');
  let card = new MyCard({ title: 'Hello' });
  if (card.title !== 'Hello') {
    throw new Error(`Expected 'Hello' but got '${card.title}'`);
  }
});
```

See [packages/experiments-realm/sample-command-card.test.gts](../../experiments-realm/sample-command-card.test.gts) for a complete example that tests both a command and a card.

---

## Example: SampleCommandCard

[packages/experiments-realm/sample-command-card.gts](../../experiments-realm/sample-command-card.gts) demonstrates:

- A `SampleCommand` that accepts a name and returns a greeting
- A card component with a **Run Sample Command** button
- A `@tracked commandOutput` variable updated with the command result
- `data-test-*` attributes on all interactive elements for DOM assertions

[packages/experiments-realm/sample-command-card.test.gts](../../experiments-realm/sample-command-card.test.gts) contains runnable tests for that card.

---

## Test result format

```ts
type TestResult = {
  name: string;
  status: 'pass' | 'fail' | 'error';
  duration: number;        // milliseconds
  error?: {
    message: string;
    stack?: string;
    actual?: unknown;
    expected?: unknown;
  };
};

type RunTestsResponse = {
  status: 'pass' | 'fail' | 'error';
  total: number;
  passed: number;
  failed: number;
  duration: number;        // total milliseconds
  tests: TestResult[];
};
```
