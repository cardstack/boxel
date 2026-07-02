import QUnit from 'qunit';
const { module, test } = QUnit;

import type { BoxelCLIClient } from '@cardstack/boxel-cli/api';

import { linkProjectToSeedIssue } from '../src/factory-seed.ts';
import { createTestWorkspace } from './helpers/workspace-fixture.ts';

const REALM = 'https://realms.example.test/me/proj/';
const DARKFACTORY = 'https://realms.example.test/software-factory/darkfactory';
const SEED_ISSUE_FILE = 'Issues/bootstrap-seed.json';

function seedIssueDocument() {
  return {
    data: {
      type: 'card',
      attributes: {
        issueId: 'BOOT-1',
        status: 'done',
        issueType: 'bootstrap',
      },
      meta: { adoptsFrom: { module: DARKFACTORY, name: 'Issue' } },
    },
  };
}

function clientFindingProjects(
  projects: Record<string, unknown>[],
  capture?: (realmUrls: unknown, query: Record<string, unknown>) => void,
): BoxelCLIClient {
  return {
    search: async (realmUrls: unknown, query: Record<string, unknown>) => {
      capture?.(realmUrls, query);
      return { ok: true, data: projects };
    },
  } as unknown as BoxelCLIClient;
}

module('factory-seed > linkProjectToSeedIssue', function (hooks) {
  let workspace: ReturnType<typeof createTestWorkspace>;

  hooks.beforeEach(function () {
    workspace = createTestWorkspace();
    workspace.write(
      SEED_ISSUE_FILE,
      JSON.stringify(seedIssueDocument(), null, 2),
    );
  });

  hooks.afterEach(function () {
    workspace.cleanup();
  });

  test('patches the seed issue project link to the found Project', async function (assert) {
    let capturedQuery: Record<string, unknown> | undefined;
    let modified = await linkProjectToSeedIssue({
      client: clientFindingProjects(
        [{ id: `${REALM}Projects/sticky-note` }],
        (_realms, query) => {
          capturedQuery = query;
        },
      ),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    });

    assert.true(modified, 'reports the seed issue was modified');
    // Searches for Project in the sibling issue-tracker module.
    assert.deepEqual(capturedQuery?.filter, {
      type: {
        module: 'https://realms.example.test/software-factory/issue-tracker',
        name: 'Project',
      },
    });

    let seed = JSON.parse(workspace.read(SEED_ISSUE_FILE));
    assert.deepEqual(
      seed.data.relationships.project,
      { links: { self: '../Projects/sticky-note' } },
      'project link is relative to the seed issue directory',
    );
    // Existing attributes are preserved.
    assert.strictEqual(seed.data.attributes.issueId, 'BOOT-1');
    assert.strictEqual(seed.data.attributes.status, 'done');
  });

  test('is a no-op when no Project exists yet', async function (assert) {
    let modified = await linkProjectToSeedIssue({
      client: clientFindingProjects([]),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    });

    assert.false(modified, 'reports no modification');
    let seed = JSON.parse(workspace.read(SEED_ISSUE_FILE));
    assert.strictEqual(
      seed.data.relationships,
      undefined,
      'project link stays unset',
    );
  });

  test('is idempotent when the project link is already correct', async function (assert) {
    let options = {
      client: clientFindingProjects([{ id: `${REALM}Projects/sticky-note` }]),
      realmUrl: REALM,
      workspaceDir: workspace.dir,
      darkfactoryModuleUrl: DARKFACTORY,
    };

    assert.true(await linkProjectToSeedIssue(options), 'first run links');
    assert.false(
      await linkProjectToSeedIssue(options),
      'second run is a no-op once the link is set',
    );
  });
});
