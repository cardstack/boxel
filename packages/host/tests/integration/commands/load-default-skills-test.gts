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
  skillFileURL,
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

module('Integration | commands | load-default-skills', function (hooks) {
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

  test('falls back to the hardcoded .md default skills when no system card is set', async function (assert) {
    let matrixService = getService('matrix-service') as any;
    matrixService._systemCard = undefined;

    assert.deepEqual(
      await matrixService.loadDefaultSkills('code'),
      [devSkillId, envSkillId, skillFileURL('source-code-editing')],
      'code mode falls back to the dev/env/source-code-editing .md skills',
    );
    assert.deepEqual(
      await matrixService.loadDefaultSkills('interact'),
      [envSkillId],
      'interact mode falls back to the env .md skill',
    );
  });

  test('falls back when the system card lists no default skills', async function (assert) {
    let matrixService = getService('matrix-service') as any;
    matrixService._systemCard = { defaultSkills: [] };

    assert.deepEqual(
      await matrixService.loadDefaultSkills('interact'),
      [envSkillId],
      'an empty defaultSkills list falls through to the hardcoded default',
    );
  });

  test("uses the system card's default skills (mode-agnostic) when set", async function (assert) {
    let matrixService = getService('matrix-service') as any;
    let skillA = `${testRealmURL}skills/my-skill/SKILL.md`;
    let skillB = `${testRealmURL}skills/another-skill/SKILL.md`;
    matrixService._systemCard = {
      defaultSkills: [{ id: skillA }, { id: skillB }],
    };

    assert.deepEqual(
      await matrixService.loadDefaultSkills('code'),
      [skillA, skillB],
      'configured skills win in code mode',
    );
    assert.deepEqual(
      await matrixService.loadDefaultSkills('interact'),
      [skillA, skillB],
      'the same configured skills apply in interact mode (mode-agnostic)',
    );
  });
});
