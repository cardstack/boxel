// CS-11545 — verify a search query finds MarkdownDef files whose frontmatter
// declares `boxel.kind: skill`. The discriminator is projected onto the
// indexed `MarkdownDef.kind` field at extraction, so it's filterable via the
// same file-meta query path used for any other FileDef field (cf. the
// `eq: { url }` file-meta filter in realm-querying-test).
//
// Requires the host test-services stack / CI to run.

import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, baseRRI } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';
import type { RealmIndexQueryEngine } from '@cardstack/runtime-common/realm-index-query-engine';

import {
  testRealmURL,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupRenderingTest } from '../helpers/setup';

const SKILL_MD = `---
name: Realm Sync
description: Sync workspace files
boxel:
  kind: skill
  commands:
    - codeRef:
        module: '@cardstack/boxel-host/commands/realm-sync'
        name: SyncCommand
      requiresApproval: true
---
# Realm Sync
`;

// A markdown file with frontmatter but a non-skill kind — must NOT match.
const RECIPE_MD = `---
name: Pasta
boxel:
  kind: recipe
---
# Pasta
`;

// Plain markdown, no frontmatter — must NOT match.
const PLAIN_MD = `# Just a note

Nothing special here.
`;

const markdownRef = {
  module: baseRRI('markdown-file-def'),
  name: 'MarkdownDef',
};

let loader: Loader;

module('Integration | CS-11545 | markdown skill search', function (hooks) {
  setupRenderingTest(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);
  setupRealmCacheTeardown(hooks);

  let queryEngine: RealmIndexQueryEngine;

  hooks.beforeEach(async function () {
    let { realm } = await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'skills/realm-sync/SKILL.md': SKILL_MD,
          'recipes/pasta/SKILL.md': RECIPE_MD,
          'notes/plain.md': PLAIN_MD,
        },
      }),
    );
    queryEngine = realm.realmIndexQueryEngine;
  });

  test('finds MarkdownDef files where boxel.kind is "skill"', async function (assert) {
    let result = (await queryEngine.searchCards({
      filter: {
        on: markdownRef,
        eq: { kind: 'skill' },
      },
    })) as unknown as { data: { id?: string; type: string }[] };

    assert.deepEqual(
      result.data.map((entry) => entry.id),
      [`${testRealmURL}skills/realm-sync/SKILL.md`],
      'only the skill markdown file matches kind: skill',
    );
    assert.strictEqual(
      result.data[0]?.type,
      'file-meta',
      'the match is a file-meta resource (an indexed MarkdownDef file)',
    );
  });

  test('all three markdown files index as MarkdownDef (kind only discriminates the filter)', async function (assert) {
    let result = (await queryEngine.searchCards({
      filter: { type: markdownRef },
    })) as unknown as { data: { id?: string }[] };

    let ids = result.data.map((entry) => entry.id);
    assert.ok(
      ids.includes(`${testRealmURL}skills/realm-sync/SKILL.md`),
      'skill file is a MarkdownDef',
    );
    assert.ok(
      ids.includes(`${testRealmURL}recipes/pasta/SKILL.md`),
      'recipe file is also a MarkdownDef (different kind, not a different type)',
    );
    assert.ok(
      ids.includes(`${testRealmURL}notes/plain.md`),
      'plain markdown is a MarkdownDef too',
    );
  });
});
