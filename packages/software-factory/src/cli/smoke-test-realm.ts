/**
 * Smoke test for the factory test realm management.
 *
 * Simulates the full factory workflow: implementation phase output followed
 * by the testing phase via executeTestRunFromRealm.
 *
 * Phase 1 — Simulate LLM implementation output:
 *   Writes to the target realm (what the LLM would have produced):
 *   1. A sample HelloCard definition (.gts)
 *   2. A Spec card instance pointing to the HelloCard definition
 *   3. A Playwright test spec in the Tests/ folder
 *
 * Phase 2 — Run the testing phase:
 *   Calls executeTestRunFromRealm which:
 *   - Creates a TestRun card (status: running) in the target realm's Test Runs/ folder
 *   - Pulls spec files from the target realm locally (Playwright needs local .spec.ts files)
 *   - Runs the Playwright spec against the live target realm (no local harness)
 *   - Any card instances created during spec execution land in the test artifacts realm
 *   - Completes the TestRun card with pass/fail results
 *
 * Prerequisites:
 *
 *   Realm server authentication — one of:
 *     a. Active Boxel CLI profile (`boxel profile add` then `boxel profile switch`)
 *     b. Environment variables: MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD
 *
 * Usage:
 *   MATRIX_URL=http://localhost:8008 MATRIX_USERNAME=<user> MATRIX_PASSWORD=<pass> \
 *   pnpm smoke:test-realm -- \
 *     --target-realm-url <realm-url>
 */

import {
  getRealmServerToken,
  matrixLogin,
  parseArgs,
} from '../../scripts/lib/boxel';
import { executeTestRunFromRealm } from '../../scripts/lib/factory-test-realm';
import {
  createRealm,
  getRealmScopedAuth,
  writeCardSource,
} from '../../scripts/lib/realm-operations';

// ---------------------------------------------------------------------------
// Sample LLM output — what the agent would produce in the implementation phase
// ---------------------------------------------------------------------------

const HELLO_CARD_GTS = `import {
  CardDef,
  Component,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class HelloCard extends CardDef {
  static displayName = 'Hello Card';
  @field greeting = contains(StringField);
  @field title = contains(StringField, {
    computeVia: function (this: HelloCard) {
      return this.greeting ?? 'Hello World';
    },
  });
  static isolated = class Isolated extends Component<typeof HelloCard> {
    <template>
      <h1 data-test-greeting>{{if @model.greeting @model.greeting 'Hello World'}}</h1>
    </template>
  };
}
`;

const HELLO_SPEC_CARD = {
  data: {
    type: 'card',
    attributes: {
      ref: { module: './hello', name: 'HelloCard' },
      specType: 'card',
      readMe:
        '# HelloCard\n\nA simple greeting card for smoke testing the factory test realm pipeline.',
    },
    meta: {
      adoptsFrom: {
        module: 'https://cardstack.com/base/spec',
        name: 'Spec',
      },
    },
  },
};

const PLAYWRIGHT_SPEC = `import { expect, test } from '@playwright/test';

test('realm index page loads with HelloCard definition', async ({ page }) => {
  let realmUrl = process.env.BOXEL_SOURCE_REALM_URL;
  await page.goto(realmUrl, { waitUntil: 'commit' });
  await expect(page.locator('body')).toBeVisible({ timeout: 30000 });
});
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  let args = parseArgs(process.argv.slice(2));
  let targetRealmUrl = (args['target-realm-url'] as string) ?? '';

  if (!targetRealmUrl) {
    let username = process.env.MATRIX_USERNAME;
    if (!username) {
      console.error('Usage: pnpm smoke:test-realm -- --target-realm-url <url>');
      console.error(
        '\nRequires MATRIX_USERNAME and MATRIX_PASSWORD environment variables.',
      );
      process.exit(1);
    }
    targetRealmUrl = `http://localhost:4201/${username}/smoke-test-realm/`;
    console.log(
      `No --target-realm-url specified, using default: ${targetRealmUrl}\n`,
    );
  }

  if (!targetRealmUrl.endsWith('/')) {
    targetRealmUrl += '/';
  }

  let testResultsModuleUrl = new URL(
    'software-factory/test-results',
    new URL(targetRealmUrl).origin + '/',
  ).href;

  let realmServerUrl = new URL(targetRealmUrl).origin + '/';
  let realmPath = new URL(targetRealmUrl).pathname
    .replace(/^\//, '')
    .replace(/\/$/, '');
  // The endpoint for _create-realm is just the realm name (not username/realm).
  // The username is determined from the JWT. Extract just the last segment.
  let realmEndpoint = realmPath.split('/').pop() ?? realmPath;

  // Set defaults for the auth chain
  if (!process.env.MATRIX_URL) {
    process.env.MATRIX_URL = 'http://localhost:8008';
  }
  if (!process.env.REALM_SERVER_URL) {
    process.env.REALM_SERVER_URL = realmServerUrl;
  }

  console.log('=== Factory Test Realm Smoke Test ===\n');
  console.log(`Target realm: ${targetRealmUrl}`);
  console.log(`Realm server: ${realmServerUrl}`);
  console.log(`Test results module: ${testResultsModuleUrl}`);

  // Authenticate via Matrix to get a realm server JWT for realm creation
  let matrixAuth = await matrixLogin();
  let serverToken = await getRealmServerToken(matrixAuth);
  console.log(`Auth: server token obtained\n`);

  let fetchImpl = globalThis.fetch;
  let authorization: string | undefined = serverToken;

  // -------------------------------------------------------------------------
  // Phase 0: Ensure the target realm exists
  // -------------------------------------------------------------------------

  console.log('--- Phase 0: Ensuring target realm exists ---\n');

  console.log(`  Creating realm: ${realmEndpoint}...`);
  let createResult = await createRealm(realmServerUrl, {
    name: 'Smoke Test Realm',
    endpoint: realmEndpoint,
    authorization: authorization ?? '',
  });

  if (createResult.created) {
    console.log(`  Created: ${createResult.realmUrl}\n`);
  } else if (createResult.error?.includes('already exists')) {
    console.log(`  Realm already exists.\n`);
  } else {
    console.error(`  Failed to create realm: ${createResult.error}`);
    process.exit(1);
  }

  // Get realm-scoped JWT now that the realm exists
  console.log('  Authenticating with new realm...');
  let realmAuth = await getRealmScopedAuth(realmServerUrl, serverToken);
  if (realmAuth.error) {
    console.warn(
      `  Warning: could not get realm-scoped auth: ${realmAuth.error}`,
    );
  } else {
    // Find the token for our target realm
    let realmToken = realmAuth.tokens[targetRealmUrl];
    if (realmToken) {
      authorization = realmToken;
      console.log('  Realm-scoped JWT obtained.\n');
    } else {
      console.warn(
        `  Warning: no token for ${targetRealmUrl} in realm-auth response\n`,
      );
    }
  }

  let fetchOptions = {
    authorization,
    fetch: fetchImpl,
  };

  // -------------------------------------------------------------------------
  // Phase 1: Simulate LLM implementation output
  // -------------------------------------------------------------------------

  console.log(
    '--- Phase 1: Writing LLM implementation output to target realm ---\n',
  );

  // 1. Card definition
  console.log('  Writing hello.gts (HelloCard definition)...');
  let defResult = await writeCardSource(
    targetRealmUrl,
    'hello.gts',
    {
      data: {
        type: 'module' as any,
        attributes: { content: HELLO_CARD_GTS },
        meta: { adoptsFrom: { module: '', name: '' } },
      },
    } as any,
    fetchOptions,
  );
  console.log(
    defResult.ok ? '  ✓ hello.gts' : `  ✗ hello.gts: ${defResult.error}`,
  );

  // 2. Spec card instance pointing to the card definition
  console.log('  Writing Spec/hello-card.json (Spec card for HelloCard)...');
  let specCardResult = await writeCardSource(
    targetRealmUrl,
    'Spec/hello-card.json',
    HELLO_SPEC_CARD as any,
    fetchOptions,
  );
  console.log(
    specCardResult.ok
      ? '  ✓ Spec/hello-card.json'
      : `  ✗ Spec/hello-card.json: ${specCardResult.error}`,
  );

  // 3. Playwright test spec
  console.log('  Writing Tests/hello-smoke.spec.ts (Playwright spec)...');
  let specResult = await writeCardSource(
    targetRealmUrl,
    'Tests/hello-smoke.spec.ts',
    {
      data: {
        type: 'module' as any,
        attributes: { content: PLAYWRIGHT_SPEC },
        meta: { adoptsFrom: { module: '', name: '' } },
      },
    } as any,
    fetchOptions,
  );
  console.log(
    specResult.ok
      ? '  ✓ Tests/hello-smoke.spec.ts'
      : `  ✗ Tests/hello-smoke.spec.ts: ${specResult.error}`,
  );

  // -------------------------------------------------------------------------
  // Phase 2: Run the testing phase via factory-test-realm
  // -------------------------------------------------------------------------

  console.log(
    '--- Phase 2: Running executeTestRunFromRealm (testing phase) ---\n',
  );
  console.log('  This will:');
  console.log('    1. Create a TestRun card (status: running) in Test Runs/');
  console.log('    2. Pull spec files from the target realm locally');
  console.log('    3. Run the Playwright spec against the live target realm');
  console.log('    4. Complete the TestRun card with results');
  console.log('');

  let handle = await executeTestRunFromRealm({
    targetRealmUrl,
    testResultsModuleUrl,
    slug: 'hello-smoke',
    specPaths: ['Tests/hello-smoke.spec.ts'],
    testNames: ['realm index page loads with HelloCard definition'],
    authorization,
    fetch: fetchImpl,
  });

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  console.log('\n--- Results ---\n');
  console.log(`  TestRun ID:  ${handle.testRunId}`);
  console.log(`  Status:      ${handle.status}`);
  if (handle.errorMessage) {
    console.log(`  Error:       ${handle.errorMessage}`);
  }
  console.log(`\n  View in Boxel: ${targetRealmUrl}${handle.testRunId}`);

  if (handle.status === 'passed') {
    console.log('\n✓ All tests passed!');
  } else if (handle.status === 'failed') {
    console.log(
      '\n✗ Some tests failed. Open the TestRun card in Boxel to see failure details.',
    );
  } else if (handle.status === 'error') {
    console.log('\n✗ Test execution encountered an error.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
