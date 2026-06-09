/**
 * Smoke test for the validation pipeline with real QUnit test execution.
 *
 * 1. Creates a target realm and writes simulated LLM output:
 *    - A HelloCard definition (.gts)
 *    - A Spec card instance pointing to the HelloCard definition
 *    - A passing QUnit test (hello.test.gts)
 *    - A deliberately failing QUnit test (hello-fail.test.gts)
 *
 * 2. Runs the full ValidationPipeline via createDefaultPipeline().
 *
 * 3. Verifies pipeline results.
 *
 * Prerequisites:
 *
 *   Active Boxel CLI profile (`boxel profile add`)
 *
 * Usage:
 *   pnpm smoke:test-realm -- --target-realm <realm-url>
 */

// This should be first
import '../../src/setup-logger.ts';

import { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { logger } from '../../src/logger.ts';
import { createDefaultPipeline } from '../../src/validators/validation-pipeline.ts';
import type { TestValidationDetails } from '../../src/validators/test-step.ts';

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
      assert.dom('[data-test-greeting]').hasText('THIS TEXT DOES NOT EXIST');
    });
  });
}
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

let log = logger('smoke-test-realm');

function parseArg(name: string): string | undefined {
  let argv = process.argv.slice(2);
  let prefix = `--${name}`;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === prefix) {
      return argv[i + 1];
    }
    if (argv[i].startsWith(`${prefix}=`)) {
      return argv[i].slice(prefix.length + 1);
    }
  }
  return undefined;
}

async function main() {
  let targetRealm = parseArg('target-realm') ?? '';

  let client = new BoxelCLIClient();
  let active = client.getActiveProfile();
  if (!active) {
    log.error(
      'No active Boxel profile found. Run `boxel profile add` to configure one.',
    );
    process.exit(1);
  }

  if (!targetRealm) {
    let username = active.matrixId.replace(/^@/, '').replace(/:.*$/, '');
    targetRealm = `http://localhost:4201/${username}/smoke-test-realm/`;
    log.info(`No --target-realm specified, using default: ${targetRealm}\n`);
  }

  if (!targetRealm.endsWith('/')) {
    targetRealm += '/';
  }

  let testResultsModuleUrl = new URL(
    'software-factory/test-results',
    new URL(targetRealm).origin + '/',
  ).href;

  let realmServerUrl = new URL(targetRealm).origin + '/';
  let realmPath = new URL(targetRealm).pathname
    .replace(/^\//, '')
    .replace(/\/$/, '');
  let realmEndpoint = realmPath.split('/').pop() ?? realmPath;

  log.info('=== Factory Test Realm Smoke Test (QUnit) ===\n');
  log.info(`Target realm: ${targetRealm}`);
  log.info(`Realm server: ${realmServerUrl}`);
  log.info(`Test results module: ${testResultsModuleUrl}`);

  // -------------------------------------------------------------------------
  // Phase 0: Ensure the target realm exists
  // -------------------------------------------------------------------------

  log.info('--- Phase 0: Ensuring target realm exists ---\n');

  let realmDisplayName = realmEndpoint.replace(/-/g, ' ');
  log.info(`  Creating realm: ${realmEndpoint}...`);
  await BoxelCLIClient.ensureProfile({ realmServerUrl });
  try {
    let createResult = await client.createRealm({
      realmName: realmEndpoint,
      displayName: realmDisplayName,
    });
    if (createResult.created) {
      log.info(`  Created: ${createResult.realmUrl}\n`);
    } else {
      log.info(`  Realm already exists: ${createResult.realmUrl}\n`);
    }
  } catch (err) {
    log.error(
      `  Failed to create realm: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }

  // -------------------------------------------------------------------------
  // Phase 1: Simulate LLM implementation output
  // -------------------------------------------------------------------------

  log.info(
    '--- Phase 1: Writing LLM implementation output to target realm ---\n',
  );

  log.info('  Writing hello.gts (HelloCard definition)...');
  let defResult = await client.write(targetRealm, 'hello.gts', HELLO_CARD_GTS);
  log.info(
    defResult.ok ? '  ✓ hello.gts' : `  ✗ hello.gts: ${defResult.error}`,
  );

  log.info('  Writing Spec/hello-card.json (Spec card for HelloCard)...');
  let specCardResult = await client.write(
    targetRealm,
    'Spec/hello-card.json',
    JSON.stringify(HELLO_SPEC_CARD, null, 2),
  );
  log.info(
    specCardResult.ok
      ? '  ✓ Spec/hello-card.json'
      : `  ✗ Spec/hello-card.json: ${specCardResult.error}`,
  );

  log.info('  Writing hello.test.gts (QUnit passing test)...');
  let testResult = await client.write(
    targetRealm,
    'hello.test.gts',
    HELLO_TEST_GTS,
  );
  log.info(
    testResult.ok
      ? '  ✓ hello.test.gts'
      : `  ✗ hello.test.gts: ${testResult.error}`,
  );

  log.info(
    '  Writing hello-fail.test.gts (QUnit deliberately failing test)...',
  );
  let failTestResult = await client.write(
    targetRealm,
    'hello-fail.test.gts',
    HELLO_FAILING_TEST_GTS,
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
  let instantiateResultsModuleUrl = new URL(
    'software-factory/instantiate-result',
    realmServerUrl,
  ).href;
  let parseResultsModuleUrl = new URL(
    'software-factory/parse-result',
    realmServerUrl,
  ).href;

  let pipeline = createDefaultPipeline({
    client,
    realmServerUrl,
    hostAppUrl: realmServerUrl,
    testResultsModuleUrl,
    lintResultsModuleUrl,
    evalResultsModuleUrl,
    instantiateResultsModuleUrl,
    parseResultsModuleUrl,
    // Smoke-test doesn't exercise fs I/O — any real path is fine.
    workspaceDir: '/tmp/boxel-factory-smoke',
  });

  let validationResults = await pipeline.validate(targetRealm);

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
