import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRRI, type CodeRef } from '@cardstack/runtime-common';

import {
  fileTreeFromIndex,
  invalidatesFileTree,
  type FileTreeFromIndexResource,
  type FileTreeNode,
} from '@cardstack/host/resources/file-tree-from-index';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const SKILL_MD = `---
name: Realm Sync
boxel:
  kind: skill
---
# Realm Sync
`;

const RECIPE_MD = `---
name: Pasta
boxel:
  kind: recipe
---
# Pasta
`;

const PLAIN_MD = `# Just a note
`;

const markdownRef = {
  module: baseRRI('markdown-file-def'),
  name: 'MarkdownDef',
} as CodeRef;

// Collect the relative paths of every file leaf in the tree.
function filePaths(entries: FileTreeNode[]): string[] {
  let paths: string[] = [];
  for (let entry of entries) {
    if (entry.kind === 'file') {
      paths.push(entry.path);
    }
    if (entry.children) {
      paths.push(...filePaths([...entry.children.values()]));
    }
  }
  return paths.sort();
}

function getTreeForTest(
  owner: object,
  fileTypeFilter: () => CodeRef | undefined,
  fileFieldFilter: () => Record<string, unknown> | undefined,
) {
  return fileTreeFromIndex(
    owner,
    () => testRealmURL,
    fileTypeFilter,
    fileFieldFilter,
  ) as unknown as Omit<FileTreeFromIndexResource, 'loaded'> & {
    loaded: Promise<void>;
  };
}

module('Integration | file-tree-from-index resource', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'skills/realm-sync/SKILL.md': SKILL_MD,
          'recipes/pasta/SKILL.md': RECIPE_MD,
          'notes/plain.md': PLAIN_MD,
        },
      }),
    );
  });

  test('a fileFieldFilter of kind:skill limits the tree to skill markdown files', async function (assert) {
    let tree = getTreeForTest(
      getService('loader-service'),
      () => markdownRef,
      () => ({ kind: 'skill' }),
    );
    await tree.loaded;

    assert.deepEqual(
      filePaths(tree.entries),
      ['skills/realm-sync/SKILL.md'],
      'only the skill markdown file is in the tree',
    );
  });

  test('without a fileFieldFilter the tree includes every markdown file', async function (assert) {
    let tree = getTreeForTest(
      getService('loader-service'),
      () => markdownRef,
      () => undefined,
    );
    await tree.loaded;

    assert.deepEqual(
      filePaths(tree.entries),
      [
        'notes/plain.md',
        'recipes/pasta/SKILL.md',
        'skills/realm-sync/SKILL.md',
      ],
      'all markdown files are in the tree when unscoped',
    );
  });

  test('distinguishes its initial request from a settled empty result', async function (assert) {
    let tree = getTreeForTest(
      getService('loader-service'),
      () => markdownRef,
      () => ({ kind: 'does-not-exist' }),
    );

    assert.true(tree.isLoading, 'the first render reports loading');
    await tree.loaded;

    assert.false(tree.isLoading, 'the completed empty query is settled');
    assert.true(tree.hasLoaded, 'the resource records a completed query');
    assert.deepEqual(tree.entries, [], 'the settled result is empty');
  });

  test('refreshes only for incremental invalidations inside its realm', function (assert) {
    assert.true(
      invalidatesFileTree(
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [`${testRealmURL}notes/new.md`],
          realmURL: testRealmURL,
        },
        testRealmURL,
      ),
    );
    assert.false(
      invalidatesFileTree(
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: ['https://another-realm.example/new.md'],
          realmURL: testRealmURL,
        },
        testRealmURL,
      ),
      'another realm cannot trigger a full search/sort',
    );
    assert.false(
      invalidatesFileTree(
        {
          eventName: 'index',
          indexType: 'full',
          realmURL: testRealmURL,
        },
        testRealmURL,
      ),
      'full-index chatter is not treated as an incremental file update',
    );
  });
});
