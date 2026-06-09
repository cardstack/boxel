import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CheckDomainAvailabilityCommand from '@cardstack/host/commands/check-domain-availability';
import RealmService from '@cardstack/host/services/realm';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmServerEndpoints,
  testRealmInfo,
  testRealmURL,
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

let availabilityResponse: {
  available: boolean;
  domain: string;
  error?: string;
};
let checkedSubdomains: string[];

module('Integration | commands | check-domain-availability', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  setupRealmServerEndpoints(hooks, [
    {
      route: '_check-boxel-domain-availability',
      getResponse: async (req: Request) => {
        checkedSubdomains.push(
          new URL(req.url).searchParams.get('subdomain') ?? '',
        );
        return new Response(JSON.stringify(availabilityResponse), {
          status: 200,
        });
      },
    },
  ]);

  setupRealmCacheTeardown(hooks);

  hooks.beforeEach(async function (this: RenderingTestContext) {
    getOwner(this)!.register('service:realm', StubRealmService);
    availabilityResponse = { available: true, domain: '' };
    checkedSubdomains = [];

    await withCachedRealmSetup(async () =>
      setupIntegrationTestRealm({
        mockMatrixUtils,
        realmURL: testRealmURL,
        contents: {},
      }),
    );
  });

  function makeCommand() {
    let commandService = getService('command-service');
    return new CheckDomainAvailabilityCommand(commandService.commandContext);
  }

  test('reports an available custom subdomain with its published URL', async function (assert) {
    availabilityResponse = { available: true, domain: 'my-site' };

    let result = await makeCommand().execute({
      type: 'custom',
      name: 'my-site',
    });

    assert.deepEqual(checkedSubdomains, ['my-site'], 'checked the subdomain');
    assert.true(result.available);
    assert.ok(
      /^https:\/\/my-site\..+\/$/.test(result.publishedRealmURL),
      `publishedRealmURL "${result.publishedRealmURL}" is the my-site custom URL`,
    );
  });

  test('reports an unavailable subdomain with the reason', async function (assert) {
    availabilityResponse = {
      available: false,
      domain: 'taken',
      error: 'This name is already taken',
    };

    let result = await makeCommand().execute({ type: 'custom', name: 'taken' });

    assert.false(result.available);
    assert.strictEqual(result.reason, 'This name is already taken');
  });

  test('rejects a non-custom target type', async function (assert) {
    await assert.rejects(
      makeCommand().execute({ type: 'subdirectory', name: 'my-space' }),
      /custom domains only/,
    );
    assert.deepEqual(
      checkedSubdomains,
      [],
      'did not hit the availability endpoint',
    );
  });
});
