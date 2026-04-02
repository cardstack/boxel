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
import { buildFactoryTools } from '../scripts/lib/factory-tool-builder';

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
// Factory tool (card write) tests against live realm
// ---------------------------------------------------------------------------

import type { FactoryTool } from '../scripts/lib/factory-tool-builder';

type CardWriteResult = { ok: boolean; error?: string };
type CardReadResult = {
  ok: boolean;
  document?: { data: { attributes: Record<string, unknown> } };
};

function buildToolsForRealm(realm: {
  realmURL: URL;
  ownerBearerToken: string;
}): FactoryTool[] {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmUrl: realm.realmURL.href,
    testRealmUrl: realm.realmURL.href,
    allowedRealmPrefixes: [realm.realmURL.origin + '/'],
    authorization: `Bearer ${realm.ownerBearerToken}`,
  });

  return buildFactoryTools(
    {
      targetRealmUrl: realm.realmURL.href,
      testRealmUrl: realm.realmURL.href,
      realmTokens: {
        [realm.realmURL.href]: `Bearer ${realm.ownerBearerToken}`,
      },
    },
    executor,
    registry,
  );
}

function makeCardDoc(
  realmUrl: string,
  className: string,
  attributes: Record<string, unknown>,
): string {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: {
        adoptsFrom: {
          module: `${realmUrl}darkfactory`,
          name: className,
        },
      },
    },
  });
}

test('update_project writes and reads back a project card', async ({
  realm,
}) => {
  let tools = buildToolsForRealm(realm);
  let updateProject = tools.find((t) => t.name === 'update_project')!;
  let readFile = tools.find((t) => t.name === 'read_file')!;

  let writeResult = (await updateProject.execute({
    path: 'Projects/tool-test-project.json',
    content: makeCardDoc(realm.realmURL.href, 'Project', {
      objective: 'Test project for update_project tool',
      status: 'in_progress',
    }),
  })) as CardWriteResult;

  expect(writeResult.ok).toBe(true);

  let readResult = (await readFile.execute({
    path: 'Projects/tool-test-project.json',
  })) as CardReadResult;

  expect(readResult.ok).toBe(true);
  expect(readResult.document?.data.attributes.objective).toBe(
    'Test project for update_project tool',
  );
});

test('update_ticket writes and reads back a ticket card', async ({ realm }) => {
  let tools = buildToolsForRealm(realm);
  let updateTicket = tools.find((t) => t.name === 'update_ticket')!;
  let readFile = tools.find((t) => t.name === 'read_file')!;

  let writeResult = (await updateTicket.execute({
    path: 'Tickets/tool-test-ticket.json',
    content: makeCardDoc(realm.realmURL.href, 'Ticket', {
      summary: 'Test ticket for update_ticket tool',
      status: 'in_progress',
      priority: 'high',
    }),
  })) as CardWriteResult;

  expect(writeResult.ok).toBe(true);

  let readResult = (await readFile.execute({
    path: 'Tickets/tool-test-ticket.json',
  })) as CardReadResult;

  expect(readResult.ok).toBe(true);
  expect(readResult.document?.data.attributes.summary).toBe(
    'Test ticket for update_ticket tool',
  );
  expect(readResult.document?.data.attributes.status).toBe('in_progress');
});

test('create_knowledge writes and reads back a knowledge article', async ({
  realm,
}) => {
  let tools = buildToolsForRealm(realm);
  let createKnowledge = tools.find((t) => t.name === 'create_knowledge')!;
  let readFile = tools.find((t) => t.name === 'read_file')!;

  let writeResult = (await createKnowledge.execute({
    path: 'Knowledge Articles/tool-test-article.json',
    content: makeCardDoc(realm.realmURL.href, 'KnowledgeArticle', {
      title: 'Test Knowledge Article',
      content: 'This is a test knowledge article created by the tool.',
    }),
  })) as CardWriteResult;

  expect(writeResult.ok).toBe(true);

  let readResult = (await readFile.execute({
    path: 'Knowledge Articles/tool-test-article.json',
  })) as CardReadResult;

  expect(readResult.ok).toBe(true);
  expect(readResult.document?.data.attributes.title).toBe(
    'Test Knowledge Article',
  );
});
