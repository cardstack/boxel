import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import FetchCardJsonCommand from '@cardstack/host/tools/fetch-card-json';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  testRealmURL,
  testRealmInfo,
  setupRealmCacheTeardown,
  withCachedRealmSetup,
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

module('Integration | commands | fetch-card-json', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  hooks.beforeEach(function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
  });

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': `
            import { CardDef, field, contains } from 'https://cardstack.com/base/card-api';
            import StringField from 'https://cardstack.com/base/string';

            export class Person extends CardDef {
              static displayName = 'Person';
              @field firstName = contains(StringField);
            }
          `,
          'Person/alice.json': {
            data: {
              type: 'card',
              attributes: {
                firstName: 'Alice',
              },
              meta: {
                adoptsFrom: {
                  module: '../person',
                  name: 'Person',
                },
              },
            },
          },
        },
      }),
    );
  });

  test('fetches card JSON for an existing card', async function (assert) {
    let toolService = getService('tool-service');
    let command = new FetchCardJsonCommand(toolService.commandContext);
    let result = await command.execute({
      cardIdentifier: `${testRealmURL}Person/alice`,
    });
    assert.ok(result.document, 'document is returned');
    assert.strictEqual(
      (result.document as any).data?.attributes?.firstName,
      'Alice',
    );
  });
});
