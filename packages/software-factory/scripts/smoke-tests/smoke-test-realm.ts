/**
 * Smoke test for the validation pipeline with real QUnit test execution.
 *
 * 1. Creates a target realm and writes simulated LLM output:
 *    - A HelloCard definition (.gts)
 *    - A Spec card instance pointing to the HelloCard definition
 *    - A passing QUnit test (hello.test.gts)
 *    - A deliberately failing QUnit test (hello-fail.test.gts)
 *
 * 2. Runs the full ValidationPipeline via createDefaultPipeline(), which
 *    executes all validation steps (parse, lint, evaluate, instantiate
 *    are NoOp placeholders; test step runs real QUnit tests via Playwright).
 *
 * 3. Verifies pipeline results: test step fails (deliberately), NoOp steps
 *    pass, detailed failure data is read back from the TestRun card, and
 *    formatForContext() produces LLM-friendly markdown.
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
import '../../src/setup-logger';

import { getRealmServerToken, matrixLogin, parseArgs } from '../../src/boxel';
import { logger } from '../../src/logger';
import {
  createRealm,
  getRealmScopedAuth,
  writeFile,
} from '../../src/realm-operations';
import { createDefaultPipeline } from '../../src/validators/validation-pipeline';
import type { TestValidationDetails } from '../../src/validators/test-step';

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
  // Run validation pipeline against the realm
  // -------------------------------------------------------------------------

  log.info('\n--- Running ValidationPipeline.validate() ---\n');

  let lintResultsModuleUrl = new URL(
    'software-factory/lint-result',
    realmServerUrl,
  ).href;
  let evalResultsModuleUrl = new URL(
    'software-factory/eval-result',
    realmServerUrl,
  ).href;

  let pipeline = createDefaultPipeline({
    authorization,
    serverToken: authorization,
    fetch: fetchImpl,
    realmServerUrl,
    hostAppUrl: realmServerUrl,
    testResultsModuleUrl,
    lintResultsModuleUrl,
    evalResultsModuleUrl,
  });

  let validationResults = await pipeline.validate(targetRealmUrl);

  log.info(
    `  Pipeline result: ${validationResults.passed ? 'PASSED' : 'FAILED'} (${validationResults.steps.length} steps)`,
  );
  for (let step of validationResults.steps) {
    let statusIcon = step.passed ? '✓' : '✗';
    let detail = '';
    if (step.details) {
      let d = step.details as unknown as TestValidationDetails;
      if (d.passedCount != null) {
        detail = ` (${d.passedCount} passed, ${d.failedCount} failed)`;
      }
    }
    log.info(
      `    ${step.step}: ${statusIcon} ${step.passed ? 'passed' : 'failed'}${detail}`,
    );
  }

  // Verify pipeline results
  let pipelinePassed = true;

  if (validationResults.passed) {
    log.info('\n  ✗ Expected pipeline to fail (deliberately failing test)');
    pipelinePassed = false;
  } else {
    log.info('\n  ✓ Pipeline correctly reports failure');
  }

  let testStep = validationResults.steps.find((s) => s.step === 'test');
  if (!testStep) {
    log.info('  ✗ No test step in results');
    pipelinePassed = false;
  } else if (testStep.passed) {
    log.info('  ✗ Test step should have failed');
    pipelinePassed = false;
  } else {
    log.info('  ✓ Test step correctly failed');
  }

  let noOpSteps = validationResults.steps.filter((s) => s.step !== 'test');
  let allNoOpsPassed = noOpSteps.every((s) => s.passed);
  if (allNoOpsPassed) {
    log.info('  ✓ All NoOp steps (parse, lint, evaluate, instantiate) passed');
  } else {
    log.info('  ✗ Some NoOp steps failed unexpectedly');
    pipelinePassed = false;
  }

  if (testStep?.details) {
    let details = testStep.details as unknown as TestValidationDetails;
    if (details.passedCount > 0 && details.failedCount > 0) {
      log.info(
        `  ✓ Test details: ${details.passedCount} passed, ${details.failedCount} failed`,
      );
    } else {
      log.info(
        `  ✗ Expected both passing and failing tests, got passed=${details.passedCount} failed=${details.failedCount}`,
      );
      pipelinePassed = false;
    }
  } else {
    log.info('  ✗ No test details available');
    pipelinePassed = false;
  }

  // Show formatted context for LLM
  let formatted = pipeline.formatForContext(validationResults);
  log.info('\n  Formatted context for LLM:');
  log.info('  ─────────────────────────');
  for (let line of formatted.split('\n')) {
    log.info(`  ${line}`);
  }
  log.info('  ─────────────────────────');

  if (pipelinePassed) {
    log.info('\n✓ Validation pipeline smoke test passed!');
  } else {
    log.info('\n✗ Validation pipeline smoke test failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(String(err));
  process.exit(1);
});
