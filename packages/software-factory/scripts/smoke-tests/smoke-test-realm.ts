/**
 * Smoke test for the factory test realm management (QUnit).
 *
 * Simulates the full factory workflow: implementation phase output followed
 * by the testing phase via executeTestRunFromRealm with QUnit .test.gts files.
 *
 * Phase 1 -- Simulate LLM implementation output:
 *   Writes to the target realm (what the LLM would have produced):
 *   1. A sample HelloCard definition (.gts)
 *   2. A Spec card instance pointing to the HelloCard definition
 *   3. A sample HelloCard instance (HelloCard/sample.json)
 *   4. A QUnit test file (hello.test.gts) -- passing
 *   5. A QUnit test file (hello-fail.test.gts) -- deliberately failing
 *
 * Phase 2 -- Run the testing phase via QUnit:
 *   Calls executeTestRunFromRealm, which:
 *   - Creates a TestRun card (status: running) in the target realm
 *   - Launches a headless browser pointing at the host app QUnit page
 *   - Collects QUnit results (testEnd / runEnd events)
 *   - Completes the TestRun card with module results
 *   - The passing test produces a result with passedCount=1
 *   - The failing test produces a result with failedCount=1
 *   - The overall TestRun status is 'failed' (mixed results)
 *
 * Prerequisites:
 *
 *   Realm server authentication -- one of:
 *     a. Active Boxel CLI profile (`boxel profile add` then `boxel profile switch`)
 *     b. Environment variables: MATRIX_URL, MATRIX_USERNAME, MATRIX_PASSWORD
 *
 * Usage:
 *   MATRIX_URL=http://localhost:8008 MATRIX_USERNAME=<user> MATRIX_PASSWORD=<pass> \
 *   pnpm smoke:test-realm -- \
 *     --target-realm-url <realm-url>
 */

// This should be first
import '../setup-logger';

import { getRealmServerToken, matrixLogin, parseArgs } from '../../src/boxel';
import { logger } from '../../src/logger';
import { executeTestRunFromRealm } from '../../src/test-run-execution';
import {
  createRealm,
  getRealmScopedAuth,
  writeFile,
} from '../../src/realm-operations';

// ---------------------------------------------------------------------------
// Sample LLM output -- what the agent would produce in the implementation phase
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

// The .test.gts files use import.meta.url to resolve the co-located card
// definition, making them portable across realms.

const HELLO_TEST_GTS = `import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard', function (hooks) {
    setupCardTest(hooks);

    test('greeting renders in isolated view', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from smoke test' });
      await renderCard(loader, card, 'isolated');
      assert.dom('[data-test-greeting]').hasText('Hello from smoke test');
    });
  });
}
`;

const HELLO_FAILING_TEST_GTS = `import { module, test } from 'qunit';
import { setupCardTest } from '@cardstack/host/tests/helpers';
import { renderCard } from '@cardstack/host/tests/helpers/render-component';
import { getService } from '@universal-ember/test-support';

let cardModuleUrl = new URL('./hello', import.meta.url).href;

export function runTests() {
  module('HelloCard Fail', function (hooks) {
    setupCardTest(hooks);

    test('deliberately fails - wrong greeting text', async function (assert) {
      let loader = getService('loader-service').loader;
      let { HelloCard } = await loader.import(cardModuleUrl);
      let card = new HelloCard({ greeting: 'Hello from smoke test' });
      await renderCard(loader, card, 'isolated');
      // This assertion deliberately fails - the rendered text doesn't match
      assert.dom('[data-test-greeting]').hasText('THIS TEXT DOES NOT EXIST');
    });
  });
}
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let log = logger('smoke-test-realm');

async function main() {
  let args = parseArgs(process.argv.slice(2));
  let targetRealmUrl = (args['target-realm-url'] as string) ?? '';

  if (!targetRealmUrl) {
    let username = process.env.MATRIX_USERNAME;
    if (!username) {
      log.error('Usage: pnpm smoke:test-realm -- --target-realm-url <url>');
      log.error(
        '\nRequires MATRIX_USERNAME and MATRIX_PASSWORD environment variables.',
      );
      process.exit(1);
    }
    targetRealmUrl = `http://localhost:4201/${username}/smoke-test-realm/`;
    log.info(
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

  log.info('=== Factory Test Realm Smoke Test (QUnit) ===\n');
  log.info(`Target realm: ${targetRealmUrl}`);
  log.info(`Realm server: ${realmServerUrl}`);
  log.info(`Test results module: ${testResultsModuleUrl}`);

  // Authenticate via Matrix to get a realm server JWT for realm creation
  let matrixAuth = await matrixLogin();
  let serverToken = await getRealmServerToken(matrixAuth);
  log.info(`Auth: server token obtained\n`);

  let fetchImpl = globalThis.fetch;
  let authorization: string | undefined = serverToken;

  // -------------------------------------------------------------------------
  // Phase 0: Ensure the target realm exists
  // -------------------------------------------------------------------------

  log.info('--- Phase 0: Ensuring target realm exists ---\n');

  let realmDisplayName = realmEndpoint.replace(/-/g, ' ');
  log.info(`  Creating realm: ${realmEndpoint}...`);
  let createResult = await createRealm(realmServerUrl, {
    name: realmDisplayName,
    endpoint: realmEndpoint,
    authorization: authorization ?? '',
    matrixAuth: {
      userId: matrixAuth.userId,
      accessToken: matrixAuth.accessToken,
      matrixUrl: matrixAuth.credentials.matrixUrl,
    },
  });

  if (createResult.created) {
    log.info(`  Created: ${createResult.realmUrl}\n`);
  } else if (createResult.error?.includes('already exists')) {
    log.info(`  Realm already exists.\n`);
  } else {
    log.error(`  Failed to create realm: ${createResult.error}`);
    process.exit(1);
  }

  // Get realm-scoped JWT now that the realm exists
  log.info('  Authenticating with new realm...');
  let realmAuth = await getRealmScopedAuth(realmServerUrl, serverToken);
  if (realmAuth.error) {
    log.warn(`  Warning: could not get realm-scoped auth: ${realmAuth.error}`);
  } else {
    // Find the token for our target realm
    let realmToken = realmAuth.tokens[targetRealmUrl];
    if (realmToken) {
      authorization = realmToken;
      log.info('  Realm-scoped JWT obtained.\n');
    } else {
      log.warn(
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

  log.info(
    '--- Phase 1: Writing LLM implementation output to target realm ---\n',
  );

  // 1. Card definition
  log.info('  Writing hello.gts (HelloCard definition)...');
  let defResult = await writeFile(
    targetRealmUrl,
    'hello.gts',
    HELLO_CARD_GTS,
    fetchOptions,
  );
  log.info(
    defResult.ok ? '  ✓ hello.gts' : `  ✗ hello.gts: ${defResult.error}`,
  );

  // 2. Spec card instance pointing to the card definition
  log.info('  Writing Spec/hello-card.json (Spec card for HelloCard)...');
  let specCardResult = await writeFile(
    targetRealmUrl,
    'Spec/hello-card.json',
    JSON.stringify(HELLO_SPEC_CARD, null, 2),
    fetchOptions,
  );
  log.info(
    specCardResult.ok
      ? '  ✓ Spec/hello-card.json'
      : `  ✗ Spec/hello-card.json: ${specCardResult.error}`,
  );

  // 3. QUnit passing test (imports HelloCard from the realm)
  log.info('  Writing hello.test.gts (QUnit passing test)...');
  let testResult = await writeFile(
    targetRealmUrl,
    'hello.test.gts',
    HELLO_TEST_GTS,
    fetchOptions,
  );
  log.info(
    testResult.ok
      ? '  ✓ hello.test.gts'
      : `  ✗ hello.test.gts: ${testResult.error}`,
  );

  // 4. QUnit deliberately failing test (imports HelloCard from the realm)
  log.info(
    '  Writing hello-fail.test.gts (QUnit deliberately failing test)...',
  );
  let failTestResult = await writeFile(
    targetRealmUrl,
    'hello-fail.test.gts',
    HELLO_FAILING_TEST_GTS,
    fetchOptions,
  );
  log.info(
    failTestResult.ok
      ? '  ✓ hello-fail.test.gts'
      : `  ✗ hello-fail.test.gts: ${failTestResult.error}`,
  );

  // -------------------------------------------------------------------------
  // Phase 2: Run QUnit tests via executeTestRunFromRealm
  // -------------------------------------------------------------------------

  log.info(
    '\n--- Phase 2: Running QUnit tests via executeTestRunFromRealm ---\n',
  );

  let handle = await executeTestRunFromRealm({
    targetRealmUrl,
    testResultsModuleUrl,
    slug: 'hello-smoke',
    testNames: [],
    authorization,
    fetch: fetchImpl,
    forceNew: true,
    realmServerUrl,
    hostAppUrl: realmServerUrl,
  });

  log.info(`  TestRun ID:  ${handle.testRunId}`);
  log.info(`  Status:      ${handle.status}`);
  if (handle.errorMessage) {
    log.info(`  Error:       ${handle.errorMessage}`);
  }
  if ((handle as unknown as Record<string, unknown>).error) {
    log.info(
      `  Complete error: ${(handle as unknown as Record<string, unknown>).error}`,
    );
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  log.info('\n--- Results ---\n');

  // The TestRun should have status 'failed' because it contains both a
  // passing and a deliberately failing QUnit test. The module results inside
  // should show one test passed and one test failed.
  let expectedStatus = handle.status === 'failed';

  log.info(
    `  TestRun status: ${expectedStatus ? '✓ failed (as expected -- one test passes, one fails)' : `✗ expected failed, got ${handle.status}`}`,
  );
  log.info(`\n  View in Boxel: ${targetRealmUrl}${handle.testRunId}`);

  if (expectedStatus) {
    log.info(
      '\n✓ Smoke test passed! TestRun contains both pass and fail QUnit results.',
    );
  } else {
    log.info('\n✗ Smoke test had unexpected results.');
    log.info(
      `  Expected "failed" (mixed pass/fail QUnit tests) but got "${handle.status}"`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
