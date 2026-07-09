import { getOwner } from '@ember/owner';
import type { RenderingTestContext } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import RealmService from '@cardstack/host/services/realm';
import CheckDomainAvailabilityTool from '@cardstack/host/tools/check-domain-availability';

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

// Matches the realm-server /_check-boxel-domain-availability response shape.
let availabilityResponse: {
  available: boolean;
  hostname: string;
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
    availabilityResponse = { available: true, hostname: '' };
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
    let toolService = getService('tool-service');
    return new CheckDomainAvailabilityTool(toolService.commandContext);
  }

  test('reports an available custom subdomain, deriving the URL from the server hostname', async function (assert) {
    availabilityResponse = { available: true, hostname: 'my-site.boxel.test' };

    let result = await makeCommand().execute({
      type: 'custom',
      name: 'my-site',
    });

    assert.deepEqual(checkedSubdomains, ['my-site'], 'checked the subdomain');
    assert.true(result.available);
    assert.strictEqual(
      result.publishedRealmURL,
      'https://my-site.boxel.test/',
      'published URL is built from the canonical hostname the server returned',
    );
  });

  test('reports an unavailable subdomain', async function (assert) {
    availabilityResponse = { available: false, hostname: 'taken.boxel.test' };

    let result = await makeCommand().execute({ type: 'custom', name: 'taken' });

    assert.false(result.available);
  });

  test('passes through the server validation error as the reason', async function (assert) {
    availabilityResponse = {
      available: false,
      hostname: 'xn--bad.boxel.test',
      error: 'Punycode domains are not allowed for security reasons',
    };

    let result = await makeCommand().execute({
      type: 'custom',
      name: 'xn--bad',
    });

    assert.false(result.available);
    assert.strictEqual(
      result.reason,
      'Punycode domains are not allowed for security reasons',
    );
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
