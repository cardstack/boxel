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
 * Phase 2 — Run the testing phase (both specs in a single TestRun):
 *   Calls executeTestRunFromRealm with both spec paths, which:
 *   - Creates a TestRun card (status: running) in the target realm's Test Runs/ folder
 *   - Pulls spec files from the target realm locally (Playwright needs local .spec.ts files)
 *   - Runs both Playwright specs against the live target realm (no local harness)
 *   - Any card instances created during spec execution land in the test artifacts realm
 *   - Completes the TestRun card with SpecResults grouped by spec file
 *   - The passing spec produces a SpecResult with passedCount=1
 *   - The failing spec produces a SpecResult with failedCount=1
 *   - The overall TestRun status is 'failed' (mixed results)
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
  writeFile,
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

function buildProjectCard(realmServerUrl: string) {
  return {
    data: {
      type: 'card',
      attributes: {
        projectCode: 'HELLO-SMOKE',
        projectName: 'Hello World Smoke Test',
        projectStatus: 'active',
        objective:
          'Verify the factory test realm pipeline by creating a HelloCard and running Playwright specs against it.',
        scope:
          '## Scope\n\n- Create a HelloCard definition with a greeting field\n- Create a Spec card pointing to the definition\n- Write Playwright specs that create and verify HelloCard instances\n- Verify pass and fail paths produce correct TestRun cards',
        technicalContext:
          '## Technical Context\n\nThis is a smoke test project. The HelloCard has a single `greeting` field and renders it in an `<h1>` with `data-test-greeting`.',
      },
      meta: {
        adoptsFrom: {
          module: `${realmServerUrl}software-factory/darkfactory`,
          name: 'Project',
        },
      },
    },
  };
}

const PLAYWRIGHT_SPEC = `import { expect, test } from '@playwright/test';

test('hello card renders greeting', async ({ request }) => {
  let sourceRealmUrl = process.env.BOXEL_SOURCE_REALM_URL!;
  let artifactsFolderUrl = process.env.BOXEL_TEST_ARTIFACTS_FOLDER_URL!;
  let authorization = process.env.BOXEL_TEST_ARTIFACTS_AUTHORIZATION!;

  // Create a HelloCard instance in the test artifacts folder (Run N/).
  let response = await request.post(artifactsFolderUrl + 'HelloCard/smoke-pass.json', {
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
          adoptsFrom: { module: sourceRealmUrl + 'hello', name: 'HelloCard' },
        },
      },
    }),
  });
  expect(response.ok()).toBe(true);

  // Verify the card was created by reading it back.
  let readResponse = await request.get(artifactsFolderUrl + 'HelloCard/smoke-pass', {
    headers: {
      Accept: 'application/vnd.card+source',
      Authorization: authorization,
    },
  });
  expect(readResponse.ok()).toBe(true);
  let card = await readResponse.json();
  expect(card.data.attributes.greeting).toBe('Hello from smoke test');
});
`;

const PLAYWRIGHT_FAILING_SPEC = `import { expect, test } from '@playwright/test';

test('hello card has wrong greeting (deliberately fails)', async ({ request }) => {
  let sourceRealmUrl = process.env.BOXEL_SOURCE_REALM_URL!;
  let artifactsFolderUrl = process.env.BOXEL_TEST_ARTIFACTS_FOLDER_URL!;
  let authorization = process.env.BOXEL_TEST_ARTIFACTS_AUTHORIZATION!;

  // Create a HelloCard instance in the test artifacts folder.
  let response = await request.post(artifactsFolderUrl + 'HelloCard/smoke-fail.json', {
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
          adoptsFrom: { module: sourceRealmUrl + 'hello', name: 'HelloCard' },
        },
      },
    }),
  });
  expect(response.ok()).toBe(true);

  // Read the card back and check for text that doesn't exist (deliberately fails).
  let readResponse = await request.get(artifactsFolderUrl + 'HelloCard/smoke-fail', {
    headers: {
      Accept: 'application/vnd.card+source',
      Authorization: authorization,
    },
  });
  expect(readResponse.ok()).toBe(true);
  let card = await readResponse.json();
  // This assertion is deliberately wrong:
  expect(card.data.attributes.greeting).toBe('THIS TEXT DOES NOT EXIST');
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

  let realmDisplayName = realmEndpoint.replace(/-/g, ' ');
  console.log(`  Creating realm: ${realmEndpoint}...`);
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

  // 1. Project card — represents this project in the testing phase.
  console.log('  Writing Projects/hello-world.json (Project card)...');
  let projectResult = await writeFile(
    targetRealmUrl,
    'Projects/hello-world.json',
    JSON.stringify(buildProjectCard(realmServerUrl), null, 2),
    fetchOptions,
  );
  console.log(
    projectResult.ok
      ? '  ✓ Projects/hello-world.json'
      : `  ✗ Projects/hello-world.json: ${projectResult.error}`,
  );
  let projectCardUrl = `${targetRealmUrl}Projects/hello-world`;

  // 2. Card definition
  console.log('  Writing hello.gts (HelloCard definition)...');
  let defResult = await writeFile(
    targetRealmUrl,
    'hello.gts',
    HELLO_CARD_GTS,
    fetchOptions,
  );
  console.log(
    defResult.ok ? '  ✓ hello.gts' : `  ✗ hello.gts: ${defResult.error}`,
  );

  // 3. Spec card instance pointing to the card definition
  console.log('  Writing Spec/hello-card.json (Spec card for HelloCard)...');
  let specCardResult = await writeFile(
    targetRealmUrl,
    'Spec/hello-card.json',
    JSON.stringify(HELLO_SPEC_CARD, null, 2),
    fetchOptions,
  );
  console.log(
    specCardResult.ok
      ? '  ✓ Spec/hello-card.json'
      : `  ✗ Spec/hello-card.json: ${specCardResult.error}`,
  );

  // 5. Playwright test spec
  console.log('  Writing Tests/hello-smoke.spec.ts (Playwright spec)...');
  let specResult = await writeFile(
    targetRealmUrl,
    'Tests/hello-smoke.spec.ts',
    PLAYWRIGHT_SPEC,
    fetchOptions,
  );
  console.log(
    specResult.ok
      ? '  ✓ Tests/hello-smoke.spec.ts'
      : `  ✗ Tests/hello-smoke.spec.ts: ${specResult.error}`,
  );

  // 4. Deliberately failing Playwright test spec
  console.log(
    '  Writing Tests/hello-failing.spec.ts (deliberately failing spec)...',
  );
  let failSpecResult = await writeFile(
    targetRealmUrl,
    'Tests/hello-failing.spec.ts',
    PLAYWRIGHT_FAILING_SPEC,
    fetchOptions,
  );
  console.log(
    failSpecResult.ok
      ? '  ✓ Tests/hello-failing.spec.ts'
      : `  ✗ Tests/hello-failing.spec.ts: ${failSpecResult.error}`,
  );

  // -------------------------------------------------------------------------
  // Phase 2: Run both specs in a single TestRun
  // -------------------------------------------------------------------------

  console.log('\n--- Phase 2: Running both specs in a single TestRun ---\n');

  let matrixAuthForRealm = {
    userId: matrixAuth.userId,
    accessToken: matrixAuth.accessToken,
    matrixUrl: matrixAuth.credentials.matrixUrl,
  };

  let handle = await executeTestRunFromRealm({
    targetRealmUrl,
    testResultsModuleUrl,
    slug: 'hello-smoke',
    specPaths: ['Tests/hello-smoke.spec.ts', 'Tests/hello-failing.spec.ts'],
    testNames: [
      'hello card renders greeting',
      'hello card has wrong greeting (deliberately fails)',
    ],
    authorization,
    fetch: fetchImpl,
    forceNew: true,
    projectCardUrl,
    matrixAuth: matrixAuthForRealm,
    serverToken,
    realmServerUrl: matrixAuth.credentials.realmServerUrl,
  });

  console.log(`  TestRun ID:  ${handle.testRunId}`);
  console.log(`  Status:      ${handle.status}`);
  if (handle.errorMessage) {
    console.log(`  Error:       ${handle.errorMessage}`);
  }
  if ((handle as unknown as Record<string, unknown>).error) {
    console.log(
      `  Complete error: ${(handle as unknown as Record<string, unknown>).error}`,
    );
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------

  console.log('\n--- Results ---\n');

  // The TestRun should have status 'failed' because it contains both a
  // passing and a deliberately failing spec. The SpecResults inside should
  // show one spec passed and one spec failed.
  let expectedStatus = handle.status === 'failed';

  console.log(
    `  TestRun status: ${expectedStatus ? '✓ failed (as expected — one spec passes, one fails)' : `✗ expected failed, got ${handle.status}`}`,
  );
  console.log(`\n  View in Boxel: ${targetRealmUrl}${handle.testRunId}`);

  if (expectedStatus) {
    console.log(
      '\n✓ Smoke test passed! Single TestRun contains both pass and fail spec results.',
    );
  } else {
    console.log('\n✗ Smoke test had unexpected results.');
    console.log(
      `  Expected "failed" (mixed pass/fail specs) but got "${handle.status}"`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
