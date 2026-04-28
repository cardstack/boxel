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
import {
  baseRealmURLFor,
  buildServerToken,
  DEFAULT_REALM_OWNER,
  sourceRealmURLFor,
} from '../src/harness/shared';
import { buildTestClient } from './helpers/test-client';

test('realm-read fetches .realm.json from the test realm', async ({
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
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      client,
    });

    let result = await executor.execute('realm-read', {
      'realm-url': realm.realmURL.href,
      path: '.realm.json',
    });

    expect(result.exitCode).toBe(0);
    expect(typeof result.output).toBe('object');
  } finally {
    cleanup();
  }
});

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

test('realm-write creates a card and realm-read retrieves it', async ({
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
      allowedRealmPrefixes: [realm.realmURL.origin + '/'],
      client,
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
  } finally {
    cleanup();
  }
});

test('realm-delete removes a card from the test realm', async ({ realm }) => {
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

    // Delete via the tool executor
    let deleteResult = await executor.execute('realm-delete', {
      'realm-url': realm.realmURL.href,
      path: 'ToolExecutorTest/delete-test.json',
    });
    expect(deleteResult.exitCode).toBe(0);

    // Verify the deletion took effect — reading the deleted card should fail
    let readResult = await executor.execute('realm-read', {
      'realm-url': realm.realmURL.href,
      path: 'ToolExecutorTest/delete-test.json',
    });
    expect(
      readResult.exitCode,
      `Expected realm-read to fail after delete, but got: ${JSON.stringify(readResult.output)}`,
    ).toBe(1);
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
// Factory tool (card write) tests against live realm
// ---------------------------------------------------------------------------

import type { FactoryTool } from '../src/factory-tool-builder';
import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

type CardWriteResult = { ok: boolean; error?: string };
type CardReadResult = { ok: boolean; content?: string };

async function buildToolsForRealm(
  realm: {
    realmURL: URL;
    realmServerURL: URL;
    ownerBearerToken: string;
  },
  client: BoxelCLIClient,
): Promise<FactoryTool[]> {
  let registry = new ToolRegistry();
  let executor = new ToolExecutor(registry, {
    packageRoot: process.cwd(),
    targetRealmUrl: realm.realmURL.href,
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
      targetRealmUrl: realm.realmURL.href,
      darkfactoryModuleUrl: `${realm.realmServerURL.href}software-factory/darkfactory`,
      realmServerUrl: realm.realmServerURL.href,
      client,
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
    let tools = await buildToolsForRealm(realm, client);
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
    let doc = JSON.parse(readResult.content!) as LooseSingleCardDocument;
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
    let tools = await buildToolsForRealm(realm, client);
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
    let doc = JSON.parse(readResult.content!) as LooseSingleCardDocument;
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
    let tools = await buildToolsForRealm(realm, client);
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
    let doc = JSON.parse(readResult.content!) as LooseSingleCardDocument;
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
    let tools = await buildToolsForRealm(realm, client);
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
    let doc = JSON.parse(readResult.content!) as LooseSingleCardDocument;
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
    let tools = await buildToolsForRealm(realm, client);
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
    let doc = JSON.parse(readResult.content!) as LooseSingleCardDocument;
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
