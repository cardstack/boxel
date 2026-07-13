import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmInfo,
  testRealmURL,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  devSkillId,
  envSkillId,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

class StubRealmService extends RealmService {
  get defaultReadableRealm() {
    return {
      path: testRealmURL,
      info: testRealmInfo,
    };
  }
}

module('Integration | tools | load-default-skills', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupBaseRealm(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {},
      }),
    );
  });

  test('falls back to the hardcoded default skill cards when no system card is set', async function (assert) {
    let matrixService = getService('matrix-service') as any;
    matrixService._systemCard = undefined;

    assert.deepEqual(
      await matrixService.loadDefaultSkills('code'),
      [devSkillId, envSkillId],
      'code mode falls back to the dev/env skill cards',
    );
    assert.deepEqual(
      await matrixService.loadDefaultSkills('interact'),
      [envSkillId],
      'interact mode falls back to the env skill card',
    );
  });

  test('falls back when the system card lists no default skills', async function (assert) {
    let matrixService = getService('matrix-service') as any;
    matrixService._systemCard = {
      defaultSkillCards: [],
      defaultSkillFiles: [],
    };

    assert.deepEqual(
      await matrixService.loadDefaultSkills('interact'),
      [envSkillId],
      'empty default-skill lists fall through to the hardcoded default',
    );
  });

  test("uses the system card's default skills (mode-agnostic) when set", async function (assert) {
    let matrixService = getService('matrix-service') as any;
    let skillCard = `${testRealmURL}Skill/my-legacy-skill`;
    let skillFileA = `${testRealmURL}skills/my-skill/SKILL.md`;
    let skillFileB = `${testRealmURL}skills/another-skill/SKILL.md`;
    matrixService._systemCard = {
      defaultSkillCards: [{ id: skillCard }],
      defaultSkillFiles: [{ id: skillFileA }, { id: skillFileB }],
    };

    // Card ids and file ids are unioned (cards first, then files); the runtime
    // resolves each id kind-agnostically via `loadSkillSource`.
    assert.deepEqual(
      await matrixService.loadDefaultSkills('code'),
      [skillCard, skillFileA, skillFileB],
      'configured skill cards and skill files both win in code mode',
    );
    assert.deepEqual(
      await matrixService.loadDefaultSkills('interact'),
      [skillCard, skillFileA, skillFileB],
      'the same configured skills apply in interact mode (mode-agnostic)',
    );
  });

  test('supports a system card with only legacy Skill cards', async function (assert) {
    let matrixService = getService('matrix-service') as any;
    let skillCard = `${testRealmURL}Skill/my-legacy-skill`;
    matrixService._systemCard = {
      defaultSkillCards: [{ id: skillCard }],
      defaultSkillFiles: [],
    };

    assert.deepEqual(
      await matrixService.loadDefaultSkills('code'),
      [skillCard],
      'a card-only default-skill list is used verbatim',
    );
  });
});
