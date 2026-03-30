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

  let result = await executor.execute({
    type: 'invoke_tool',
    tool: 'realm-read',
    toolArgs: {
      'realm-url': realm.realmURL.href,
      path: '.realm.json',
    },
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

  let result = await executor.execute({
    type: 'invoke_tool',
    tool: 'realm-search',
    toolArgs: {
      'realm-url': realm.realmURL.href,
      query: JSON.stringify({
        filter: {
          type: {
            module: '@cardstack/base/card-api',
            name: 'CardDef',
          },
        },
        page: { size: 1 },
      }),
    },
  });

  expect(result.exitCode).toBe(0);
  let output = result.output as { data?: unknown[] };
  expect(Array.isArray(output.data)).toBe(true);
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
    executor.execute({
      type: 'invoke_tool',
      tool: 'shell-exec-arbitrary',
      toolArgs: { command: 'rm -rf /' },
    }),
  ).rejects.toThrow(ToolNotFoundError);
});
