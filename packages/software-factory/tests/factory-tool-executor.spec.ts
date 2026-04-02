/**
 * Live integration tests for the ToolExecutor against the software-factory
 * harness realm server.
 *
 * These run as Playwright specs so they share the harness lifecycle
 * (global-setup starts serve:support + cache:prepare, fixtures start
 * serve:realm per spec). No browser is needed — these are pure Node tests
 * that happen to use the Playwright test runner for harness management.
 */

import { test } from './fixtures';
import { expect } from '@playwright/test';

import {
  ToolExecutor,
  ToolNotFoundError,
} from '../scripts/lib/factory-tool-executor';
import { ToolRegistry } from '../scripts/lib/factory-tool-registry';
import { DEFAULT_REALM_OWNER } from '../src/harness/shared';
import {
  readSupportMetadata,
  registerMatrixUser,
  getRealmToken,
} from './helpers/matrix-auth';

test('realm-read fetches .realm.json from the test realm', async ({
  realm,
}) => {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmUrl: realm.realmURL.href,
    testRealmUrl: realm.realmURL.href,
    allowedRealmPrefixes: [realm.realmURL.origin + '/'],
    authorization: `Bearer ${realm.ownerBearerToken}`,
  });

  let result = await executor.execute('realm-read', {
    'realm-url': realm.realmURL.href,
    path: '.realm.json',
  });

  expect(result.exitCode).toBe(0);
  expect(typeof result.output).toBe('object');
});

test('realm-search returns results from the test realm', async ({ realm }) => {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmUrl: realm.realmURL.href,
    testRealmUrl: realm.realmURL.href,
    allowedRealmPrefixes: [realm.realmURL.origin + '/'],
    authorization: `Bearer ${realm.ownerBearerToken}`,
  });

  let result = await executor.execute('realm-search', {
    'realm-url': realm.realmURL.href,
    query: JSON.stringify({
      filter: {
        type: {
          module: 'https://cardstack.com/base/card-api',
          name: 'CardDef',
        },
      },
      page: { size: 1 },
    }),
  });

  expect(result.exitCode).toBe(0);
  let output = result.output as { data?: unknown[] };
  expect(Array.isArray(output.data)).toBe(true);
});

test('realm-write creates a card and realm-read retrieves it', async ({
  realm,
}) => {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmUrl: realm.realmURL.href,
    testRealmUrl: realm.realmURL.href,
    allowedRealmPrefixes: [realm.realmURL.origin + '/'],
    authorization: `Bearer ${realm.ownerBearerToken}`,
  });

  let cardJson = JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        title: 'Tool Executor Write Test',
      },
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/card-api',
          name: 'CardDef',
        },
      },
    },
  });

  let writeResult = await executor.execute('realm-write', {
    'realm-url': realm.realmURL.href,
    path: 'ToolExecutorTest/write-test.json',
    content: cardJson,
  });

  expect(writeResult.exitCode).toBe(0);

  // Verify the written card can be read back
  let readResult = await executor.execute('realm-read', {
    'realm-url': realm.realmURL.href,
    path: 'ToolExecutorTest/write-test.json',
  });

  expect(readResult.exitCode).toBe(0);
  let output = readResult.output as {
    data?: { attributes?: { title?: string } };
  };
  expect(output.data?.attributes?.title).toBe('Tool Executor Write Test');
});

test('realm-delete removes a card from the test realm', async ({ realm }) => {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmUrl: realm.realmURL.href,
    testRealmUrl: realm.realmURL.href,
    allowedRealmPrefixes: [realm.realmURL.origin + '/'],
    authorization: `Bearer ${realm.ownerBearerToken}`,
  });

  // First, write a card to delete
  let cardJson = JSON.stringify({
    data: {
      type: 'card',
      attributes: {},
      meta: {
        adoptsFrom: {
          module: 'https://cardstack.com/base/card-api',
          name: 'CardDef',
        },
      },
    },
  });

  let writeResult = await executor.execute('realm-write', {
    'realm-url': realm.realmURL.href,
    path: 'ToolExecutorTest/delete-test.json',
    content: cardJson,
  });
  expect(writeResult.exitCode).toBe(0);

  // Delete it
  let deleteResult = await executor.execute('realm-delete', {
    'realm-url': realm.realmURL.href,
    path: 'ToolExecutorTest/delete-test.json',
  });
  expect(deleteResult.exitCode).toBe(0);

  // Verify the deletion took effect — search should no longer find the card
  let searchResult = await executor.execute('realm-search', {
    'realm-url': realm.realmURL.href,
    query: JSON.stringify({
      filter: {
        type: {
          module: 'https://cardstack.com/base/card-api',
          name: 'CardDef',
        },
        eq: {
          id: `${realm.realmURL.href}ToolExecutorTest/delete-test`,
        },
      },
    }),
  });
  expect(searchResult.exitCode).toBe(0);
  let searchOutput = searchResult.output as { data?: unknown[] };
  expect(searchOutput.data?.length ?? 0).toBe(0);
});

test('unregistered tool is rejected without reaching the server', async ({
  realm,
}) => {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmUrl: realm.realmURL.href,
    testRealmUrl: realm.realmURL.href,
    authorization: `Bearer ${realm.ownerBearerToken}`,
  });

  await expect(
    executor.execute('shell-exec-arbitrary', { command: 'rm -rf /' }),
  ).rejects.toThrow(ToolNotFoundError);
});

// ---------------------------------------------------------------------------
// realm-search with pre-seeded fixture data
// The darkfactory-adopter fixture has Project and Ticket cards with
// distinct types — we search for each and verify the filter works.
// ---------------------------------------------------------------------------

test.describe('realm-search with seeded fixture data', () => {
  // Uses default darkfactory-adopter fixture (shared mode for speed)

  test('search by type returns matching cards and excludes non-matching types', async ({
    realm,
  }) => {
    // The darkfactory-adopter fixture type module uses a placeholder URL
    // that gets remapped at runtime. Discover the live module URL by
    // reading a known card and extracting its adoptsFrom module.
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      testRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      authorization: `Bearer ${realm.ownerBearerToken}`,
    });

    let projectRead = await executor.execute('realm-read', {
      'realm-url': realm.realmURL.href,
      path: 'project-demo.json',
    });
    expect(projectRead.exitCode).toBe(0);
    let projectDoc = projectRead.output as {
      data: { meta: { adoptsFrom: { module: string; name: string } } };
    };
    let darkfactoryModule = projectDoc.data.meta.adoptsFrom.module;

    // Search for Project cards — should find at least project-demo
    let projectResult = await executor.execute('realm-search', {
      'realm-url': realm.realmURL.href,
      query: JSON.stringify({
        filter: {
          type: { module: darkfactoryModule, name: 'Project' },
        },
      }),
    });

    expect(
      projectResult.exitCode,
      `project search failed: ${JSON.stringify(projectResult.output)}`,
    ).toBe(0);
    let projectOutput = projectResult.output as {
      data?: { id: string }[];
    };
    expect(
      (projectOutput.data?.length ?? 0) > 0,
      'should find at least one Project card',
    ).toBe(true);
    let projectIds = (projectOutput.data ?? []).map((d) => d.id);

    // Verify no Ticket cards leak into the Project results
    let ticketResult = await executor.execute('realm-search', {
      'realm-url': realm.realmURL.href,
      query: JSON.stringify({
        filter: {
          type: { module: darkfactoryModule, name: 'Ticket' },
        },
      }),
    });
    expect(ticketResult.exitCode).toBe(0);
    let ticketOutput = ticketResult.output as {
      data?: { id: string }[];
    };
    let ticketIds = (ticketOutput.data ?? []).map((d) => d.id);

    // Project and Ticket result sets must be disjoint
    for (let ticketId of ticketIds) {
      expect(
        projectIds.includes(ticketId),
        `Ticket ${ticketId} should not appear in Project results`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// realm-search on a private realm: verifies auth is enforced
// ---------------------------------------------------------------------------

test.describe('realm-search on a private realm', () => {
  test.use({ realmServerMode: 'isolated' });
  test.use({
    realmPermissions: {
      [DEFAULT_REALM_OWNER]: ['read', 'write', 'realm-owner'],
      // No '*' key — unauthenticated reads are denied
    },
  });

  test('search with owner token succeeds, search without token fails', async ({
    realm,
  }) => {
    let registry = new ToolRegistry();

    // Discover the live module URL from the fixture data
    let ownerExecutor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      testRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      authorization: `Bearer ${realm.ownerBearerToken}`,
    });

    let projectRead = await ownerExecutor.execute('realm-read', {
      'realm-url': realm.realmURL.href,
      path: 'project-demo.json',
    });
    expect(
      projectRead.exitCode,
      `Failed to read project-demo: ${JSON.stringify(projectRead.output)}`,
    ).toBe(0);
    let projectDoc = projectRead.output as {
      data: { meta: { adoptsFrom: { module: string; name: string } } };
    };
    let darkfactoryModule = projectDoc.data.meta.adoptsFrom.module;

    let searchQuery = JSON.stringify({
      filter: {
        type: { module: darkfactoryModule, name: 'Project' },
      },
    });

    // Authenticated search with owner token — should succeed
    let authedResult = await ownerExecutor.execute('realm-search', {
      'realm-url': realm.realmURL.href,
      query: searchQuery,
    });

    expect(
      authedResult.exitCode,
      `authenticated search failed: ${JSON.stringify(authedResult.output)}`,
    ).toBe(0);
    let authedOutput = authedResult.output as { data?: unknown[] };
    expect(
      (authedOutput.data?.length ?? 0) > 0,
      'authenticated search should return results',
    ).toBe(true);

    // Unauthenticated search — should fail (401 → exitCode 1)
    let noAuthExecutor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      testRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      // No authorization — simulates unauthenticated access
    });

    let noAuthResult = await noAuthExecutor.execute('realm-search', {
      'realm-url': realm.realmURL.href,
      query: searchQuery,
    });

    expect(
      noAuthResult.exitCode,
      'unauthenticated search on private realm should fail',
    ).toBe(1);

    // Search with a token for a different user who has no permissions — should fail
    let unauthorizedToken = realm.createBearerToken('@stranger:localhost', []);
    let unauthorizedExecutor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      testRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      authorization: `Bearer ${unauthorizedToken}`,
    });

    let unauthorizedResult = await unauthorizedExecutor.execute(
      'realm-search',
      {
        'realm-url': realm.realmURL.href,
        query: searchQuery,
      },
    );

    expect(
      unauthorizedResult.exitCode,
      'unauthorized user search on private realm should fail',
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// realm-create: requires an isolated realm server (creates a new realm)
// ---------------------------------------------------------------------------

test.describe('realm-create against a live realm server', () => {
  test.use({ realmServerMode: 'isolated' });
  test.setTimeout(180_000);

  test('realm-create creates a new realm on the server via tool executor', async ({
    realm,
  }) => {
    let { matrixURL, matrixRegistrationSecret } = readSupportMetadata();

    // Register a fresh Matrix user for this test
    let username = `tool-create-${Date.now()}`;
    let password = 'test-password';
    await registerMatrixUser(
      matrixURL,
      matrixRegistrationSecret,
      username,
      password,
    );

    // Login to Matrix and obtain an OpenID token
    let baseUrl = matrixURL.endsWith('/') ? matrixURL : `${matrixURL}/`;
    let loginResponse = await fetch(`${baseUrl}_matrix/client/v3/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username },
        password,
      }),
    });
    expect(loginResponse.ok).toBe(true);
    let { access_token, user_id } = (await loginResponse.json()) as {
      access_token: string;
      user_id: string;
    };

    let openIdResponse = await fetch(
      `${baseUrl}_matrix/client/v3/user/${encodeURIComponent(user_id)}/openid/request_token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${access_token}`,
        },
        body: '{}',
      },
    );
    expect(openIdResponse.ok).toBe(true);
    let { access_token: openidToken } = (await openIdResponse.json()) as {
      access_token: string;
    };

    let realmServerUrl = realm.realmServerURL.href;
    let registry = new ToolRegistry();

    // Step 1: Obtain a realm-server JWT via the tool executor
    let sessionExecutor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      testRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
    });

    let sessionResult = await sessionExecutor.execute('realm-server-session', {
      'realm-server-url': realmServerUrl,
      'openid-token': openidToken,
    });

    expect(
      sessionResult.exitCode,
      `realm-server-session failed: ${JSON.stringify(sessionResult.output)}`,
    ).toBe(0);
    let serverJwt = (sessionResult.output as { token: string }).token;
    expect(serverJwt).toBeTruthy();

    // Step 2: Create a new realm via the tool executor
    let newEndpoint = `e2e-tool-test-${Date.now()}`;
    let createExecutor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      testRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      authorization: serverJwt,
    });

    let createResult = await createExecutor.execute('realm-create', {
      'realm-server-url': realmServerUrl,
      name: 'E2E Tool Executor Test',
      endpoint: newEndpoint,
    });

    expect(
      createResult.exitCode,
      `realm-create failed: ${JSON.stringify(createResult.output)}`,
    ).toBe(0);
    let createOutput = createResult.output as { data?: { id?: string } };
    expect(createOutput.data?.id).toBeTruthy();

    // Step 3: Verify the realm was actually created by reading .realm.json
    let newRealmUrl = createOutput.data!.id!;
    let newRealmToken = await getRealmToken(
      matrixURL,
      username,
      password,
      newRealmUrl,
    );

    let verifyExecutor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: newRealmUrl,
      testRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      authorization: newRealmToken,
    });

    let readResult = await verifyExecutor.execute('realm-read', {
      'realm-url': newRealmUrl,
      path: '.realm.json',
    });

    expect(readResult.exitCode).toBe(0);
    expect(typeof readResult.output).toBe('object');
  });
});
