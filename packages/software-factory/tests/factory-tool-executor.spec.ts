/**
 * Live integration tests for the ToolExecutor against the software-factory
 * harness realm server.
 *
 * These run as Playwright specs so they share the harness lifecycle
 * (global-setup starts serve:support + cache:prepare, fixtures start
 * serve:realm per spec). No browser is needed — these are pure Node tests
 * that happen to use the Playwright test runner for harness management.
 */

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common/card-reference-resolver';

import { test } from './fixtures';
import { expect } from '@playwright/test';

import { ToolExecutor, ToolNotFoundError } from '../src/factory-tool-executor';
import { ToolRegistry } from '../src/factory-tool-registry';
import { buildFactoryTools } from '../src/factory-tool-builder';
import { fetchCardTypeSchema } from '../src/darkfactory-schemas';
import { baseRealmURLFor, sourceRealmURLFor } from '../src/harness/shared';
import { buildTestClient } from './helpers/test-client';
import { createTestWorkspace } from './helpers/workspace-fixture';

// Note: the registry-tool surface that used to live here (realm-search,
// realm-read, realm-write, realm-delete) was retired in CS-10883. The
// remaining specs cover the factory-tool-builder paths (update_project /
// update_issue / add_comment / create_knowledge / create_catalog_spec)
// against a live realm, plus an unregistered-tool sanity check.

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
      targetRealmIdentifier: realm.realmURL.href,
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
// Factory tool (card write) tests against live realm
// ---------------------------------------------------------------------------

import type { FactoryTool } from '../src/factory-tool-builder';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

type CardWriteResult = { ok: boolean; error?: string };
type CardReadResult = { ok: boolean; document?: Record<string, unknown> };

async function buildToolsForRealm(
  realm: {
    realmURL: URL;
    realmServerURL: URL;
    ownerBearerToken: string;
  },
  client: BoxelCLIClient,
  workspaceDir: string,
): Promise<FactoryTool[]> {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmIdentifier: realm.realmURL.href,
    allowedRealmPrefixes: [realm.realmURL.origin + '/'],
    client,
  });

  // Fetch schemas via _run-command. The realmUrl targets the test realm
  // (where the owner has permissions), while the codeRef module URL points
  // to the source realm where darkfactory.gts is defined.
  let sourceRealmUrl = sourceRealmURLFor(realm.realmServerURL).href;
  let darkfactoryModule = `${sourceRealmUrl}darkfactory`;

  let cardTypeSchemas = new Map<
    string,
    {
      attributes: Record<string, unknown>;
      relationships?: Record<string, unknown>;
    }
  >();
  for (let name of ['Project', 'Issue', 'KnowledgeArticle']) {
    let schema = await fetchCardTypeSchema(
      client,
      realm.realmServerURL.href,
      realm.realmURL.href,
      { module: rri(darkfactoryModule), name },
    );
    if (schema) {
      cardTypeSchemas.set(name, schema);
    }
  }

  // Fetch Spec card schema from the base realm
  let baseRealmUrl = baseRealmURLFor(realm.realmServerURL).href;
  let specSchema = await fetchCardTypeSchema(
    client,
    realm.realmServerURL.href,
    baseRealmUrl,
    {
      module: rri('https://cardstack.com/base/spec'),
      name: 'Spec',
    },
  );
  if (specSchema) {
    cardTypeSchemas.set('Spec', specSchema);
  }

  return buildFactoryTools(
    {
      targetRealmIdentifier: realm.realmURL.href,
      darkfactoryModuleUrl: `${realm.realmServerURL.href}software-factory/darkfactory`,
      realmServerUrl: realm.realmServerURL.href,
      client,
      workspaceDir,
      cardTypeSchemas,
    },
    executor,
    registry,
  );
}

test('update_project writes and reads back a project card', async ({
  realm,
}) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let workspace = createTestWorkspace();
    await client.pull(realm.realmURL.href, workspace.dir);
    let tools = await buildToolsForRealm(realm, client, workspace.dir);
    let updateProject = tools.find((t) => t.name === 'update_project')!;
    let readFile = tools.find((t) => t.name === 'read_file')!;

    expect(updateProject).toBeDefined();

    let writeResult = (await updateProject.execute({
      path: 'Projects/tool-test-project.json',
      attributes: {
        objective: 'Test project for update_project tool',
        projectStatus: 'in_progress',
      },
    })) as CardWriteResult;

    expect(writeResult.ok).toBe(true);

    let readResult = (await readFile.execute({
      path: 'Projects/tool-test-project.json',
    })) as CardReadResult;

    expect(readResult.ok).toBe(true);
    let doc = readResult.document as unknown as LooseSingleCardDocument;
    expect(doc.data.attributes!.objective).toBe(
      'Test project for update_project tool',
    );
  } finally {
    cleanup();
  }
});

test('update_issue writes and reads back an issue card', async ({ realm }) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let workspace = createTestWorkspace();
    await client.pull(realm.realmURL.href, workspace.dir);
    let tools = await buildToolsForRealm(realm, client, workspace.dir);
    let updateIssue = tools.find((t) => t.name === 'update_issue')!;
    let readFile = tools.find((t) => t.name === 'read_file')!;

    expect(updateIssue).toBeDefined();

    let writeResult = (await updateIssue.execute({
      path: 'Issues/tool-test-issue.json',
      attributes: {
        summary: 'Test issue for update_issue tool',
        status: 'blocked',
        priority: 'high',
      },
    })) as CardWriteResult;

    expect(writeResult.ok).toBe(true);

    let readResult = (await readFile.execute({
      path: 'Issues/tool-test-issue.json',
    })) as CardReadResult;

    expect(readResult.ok).toBe(true);
    let doc = readResult.document as unknown as LooseSingleCardDocument;
    expect(doc.data.attributes!.summary).toBe(
      'Test issue for update_issue tool',
    );
    expect(doc.data.attributes!.status).toBe('blocked');
  } finally {
    cleanup();
  }
});

test('add_comment appends a comment to an existing issue without changing other fields', async ({
  realm,
}) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let workspace = createTestWorkspace();
    await client.pull(realm.realmURL.href, workspace.dir);
    let tools = await buildToolsForRealm(realm, client, workspace.dir);
    let writeFile = tools.find((t) => t.name === 'write_file')!;
    let addComment = tools.find((t) => t.name === 'add_comment')!;
    let readFileTool = tools.find((t) => t.name === 'read_file')!;

    expect(addComment).toBeDefined();

    // Create an issue via write_file (descriptions are set at creation time,
    // not via update_issue which strips them)
    let darkfactoryModule = `${realm.realmServerURL.href}software-factory/darkfactory`;
    let issueDoc = {
      data: {
        type: 'card',
        attributes: {
          summary: 'Issue for comment test',
          description: 'Original description that must not change',
          status: 'blocked',
          priority: 'high',
        },
        meta: {
          adoptsFrom: { module: darkfactoryModule, name: 'Issue' },
        },
      },
    };
    let createResult = (await writeFile.execute({
      path: 'Issues/comment-test-issue.json',
      content: JSON.stringify(issueDoc, null, 2),
    })) as CardWriteResult;

    expect(createResult.ok).toBe(true);

    // Add a comment
    let commentResult = (await addComment.execute({
      path: 'Issues/comment-test-issue.json',
      body: 'This is a test comment from the integration test',
      author: 'test-agent',
    })) as { ok: boolean };

    expect(commentResult.ok).toBe(true);

    // Read back and verify
    let readResult = (await readFileTool.execute({
      path: 'Issues/comment-test-issue.json',
    })) as CardReadResult;

    expect(readResult.ok).toBe(true);
    let doc = readResult.document as unknown as LooseSingleCardDocument;
    let attrs = doc.data.attributes!;
    // Original fields unchanged
    expect(attrs.summary).toBe('Issue for comment test');
    expect(attrs.description).toBe('Original description that must not change');
    expect(attrs.status).toBe('blocked');
    expect(attrs.priority).toBe('high');
    // Comment was appended
    let comments = attrs.comments as {
      body: string;
      author: string;
      datetime: string;
    }[];
    expect(comments).toHaveLength(1);
    expect(comments[0].body).toBe(
      'This is a test comment from the integration test',
    );
    expect(comments[0].author).toBe('test-agent');
    expect(comments[0].datetime).toBeTruthy();
  } finally {
    cleanup();
  }
});

test('create_knowledge writes and reads back a knowledge article', async ({
  realm,
}) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let workspace = createTestWorkspace();
    await client.pull(realm.realmURL.href, workspace.dir);
    let tools = await buildToolsForRealm(realm, client, workspace.dir);
    let createKnowledge = tools.find((t) => t.name === 'create_knowledge')!;
    let readFile = tools.find((t) => t.name === 'read_file')!;

    expect(createKnowledge).toBeDefined();

    let writeResult = (await createKnowledge.execute({
      path: 'Knowledge Articles/tool-test-article.json',
      attributes: {
        articleTitle: 'Test Knowledge Article',
        content: 'This is a test knowledge article created by the tool.',
      },
    })) as CardWriteResult;

    expect(writeResult.ok).toBe(true);

    let readResult = (await readFile.execute({
      path: 'Knowledge Articles/tool-test-article.json',
    })) as CardReadResult;

    expect(readResult.ok).toBe(true);
    let doc = readResult.document as unknown as LooseSingleCardDocument;
    expect(doc.data.attributes!.articleTitle).toBe('Test Knowledge Article');
  } finally {
    cleanup();
  }
});

test('create_catalog_spec writes and reads back a Spec card', async ({
  realm,
}) => {
  let { client, cleanup } = buildTestClient({
    realmUrl: realm.realmURL.href,
    realmToken: `Bearer ${realm.ownerBearerToken}`,
    realmServerUrl: realm.realmServerURL.href,
    realmServerToken: `Bearer ${realm.serverToken}`,
  });

  try {
    let workspace = createTestWorkspace();
    await client.pull(realm.realmURL.href, workspace.dir);
    let tools = await buildToolsForRealm(realm, client, workspace.dir);
    let createCatalogSpec = tools.find(
      (t) => t.name === 'create_catalog_spec',
    )!;
    let readFile = tools.find((t) => t.name === 'read_file')!;

    expect(createCatalogSpec).toBeDefined();

    let writeResult = (await createCatalogSpec.execute({
      path: 'Spec/tool-test-spec.json',
      attributes: {
        ref: { module: '../hello', name: 'HelloCard' },
        specType: 'card',
        readMe: '# HelloCard\n\nA test card for the catalog spec tool.',
      },
    })) as CardWriteResult;

    expect(writeResult.ok).toBe(true);

    let readResult = (await readFile.execute({
      path: 'Spec/tool-test-spec.json',
    })) as CardReadResult;

    expect(readResult.ok).toBe(true);
    let doc = readResult.document as unknown as LooseSingleCardDocument;
    expect(doc.data.attributes!.specType).toBe('card');
    let adoptsFrom = doc.data.meta.adoptsFrom as {
      module: string;
      name: string;
    };
    expect(adoptsFrom.module).toBe('https://cardstack.com/base/spec');
    expect(adoptsFrom.name).toBe('Spec');
  } finally {
    cleanup();
  }
});
