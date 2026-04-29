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

import { ToolExecutor, ToolNotFoundError } from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';
import { buildServerToken, DEFAULT_REALM_OWNER } from '../src/harness/shared';
import { buildTestClient } from './helpers/test-client';

test('realm-search returns results from the test realm', async ({ realm }) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      client,
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
  } finally {
    cleanup();
  }
});

test('unregistered tool is rejected without reaching the server', async ({
  realm,
}) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let registry = new ToolRegistry();
    let executor = new ToolExecutor(registry, {
      packageRoot: process.cwd(),
      targetRealmUrl: realm.realmURL.href,
      client,
    });

    await expect(
      executor.execute('shell-exec-arbitrary', { command: 'rm -rf /' }),
    ).rejects.toThrow(ToolNotFoundError);
  } finally {
    cleanup();
  }
});


// ---------------------------------------------------------------------------
// realm-search with pre-seeded fixture data
// The darkfactory-adopter fixture has Project and Issue cards with
// distinct types — we search for each and verify the filter works.
// ---------------------------------------------------------------------------

test.describe('realm-search with seeded fixture data', () => {
  // Uses default darkfactory-adopter fixture (shared mode for speed)

  test('search by type returns matching cards and excludes non-matching types', async ({
    realm,
  }) => {
    let { client, cleanup } = buildTestClient({
      realmUrl: realm.realmURL.href,
      realmToken: `Bearer ${realm.ownerBearerToken}`,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: `Bearer ${realm.serverToken}`,
    });

    try {
      // The darkfactory-adopter fixture type module uses a placeholder URL
      // that gets remapped at runtime. Discover the live module URL by
      // reading a known card and extracting its adoptsFrom module.
      let registry = new ToolRegistry();
      let executor = new ToolExecutor(registry, {
        packageRoot: process.cwd(),
        targetRealmUrl: realm.realmURL.href,
        allowedRealmPrefixes: [realm.realmURL.origin + '/'],
        client,
      });

      // Discover the darkfactory module URL by reading a known card's
      // adoptsFrom via the BoxelCLIClient — this is setup for the
      // realm-search assertions below.
      let projectRead = await client.read(
        realm.realmURL.href,
        'project-demo.json',
      );
      expect(projectRead.ok).toBe(true);
      let projectDoc = JSON.parse(projectRead.content ?? '') as {
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

      // Verify no Issue cards leak into the Project results
      let issueResult = await executor.execute('realm-search', {
        'realm-url': realm.realmURL.href,
        query: JSON.stringify({
          filter: {
            type: { module: darkfactoryModule, name: 'Issue' },
          },
        }),
      });
      expect(issueResult.exitCode).toBe(0);
      let issueOutput = issueResult.output as {
        data?: { id: string }[];
      };
      let issueIds = (issueOutput.data ?? []).map((d) => d.id);

      // Project and Issue result sets must be disjoint
      for (let issueId of issueIds) {
        expect(
          projectIds.includes(issueId),
          `Issue ${issueId} should not appear in Project results`,
        ).toBe(false);
      }
    } finally {
      cleanup();
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
    let ownerSetup = buildTestClient({
      realmUrl: realm.realmURL.href,
      realmToken: `Bearer ${realm.ownerBearerToken}`,
      realmServerUrl: realm.realmServerURL.href,
      realmServerToken: `Bearer ${realm.serverToken}`,
    });

    try {
      let registry = new ToolRegistry();

      // Discover the live module URL from the fixture data
      let ownerExecutor = new ToolExecutor(registry, {
        packageRoot: process.cwd(),
        targetRealmUrl: realm.realmURL.href,
        allowedRealmPrefixes: [realm.realmURL.origin + '/'],
        client: ownerSetup.client,
      });

      // Discover the module URL via the client for the search assertions below.
      let projectRead = await ownerSetup.client.read(
        realm.realmURL.href,
        'project-demo.json',
      );
      expect(
        projectRead.ok,
        `Failed to read project-demo: ${projectRead.error}`,
      ).toBe(true);
      let projectDoc = JSON.parse(projectRead.content ?? '') as {
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

      ownerSetup.cleanup();

      // Search with a token for a different user who has no permissions — should fail with 403
      let unauthorizedToken = realm.createBearerToken(
        '@stranger:localhost',
        [],
      );
      let unauthorizedRealmServerToken = buildServerToken(
        '@stranger:localhost',
      );
      let unauthorizedSetup = buildTestClient({
        realmUrl: realm.realmURL.href,
        realmToken: `Bearer ${unauthorizedToken}`,
        realmServerUrl: realm.realmServerURL.href,
        realmServerToken: `Bearer ${unauthorizedRealmServerToken}`,
      });

      try {
        let unauthorizedExecutor = new ToolExecutor(registry, {
          packageRoot: process.cwd(),
          targetRealmUrl: realm.realmURL.href,
          allowedRealmPrefixes: [realm.realmURL.origin + '/'],
          client: unauthorizedSetup.client,
        });

        let unauthorizedResult = await unauthorizedExecutor.execute(
          'realm-search',
          {
            'realm-url': realm.realmURL.href,
            query: searchQuery,
          },
        );

        expect(unauthorizedResult.exitCode).toBe(1);
        let unauthorizedOutput = unauthorizedResult.output as {
          status?: number;
        };
        expect(unauthorizedOutput.status).toBe(403);
      } finally {
        unauthorizedSetup.cleanup();
      }
    } finally {
      // ownerSetup may already be cleaned up; safe to call twice since it's a temp dir
    }
  });
});
