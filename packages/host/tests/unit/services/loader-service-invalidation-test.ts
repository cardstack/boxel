import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type NetworkService from '@cardstack/host/services/network';

import { setupRenderingTest } from '../../helpers/setup';

const userRealmURL = 'https://loader-invalidation.example/user/';
const trustedRealmURL = 'https://loader-invalidation.example/trusted/';

const sources = new Map([
  [
    `${userRealmURL}a.js`,
    `import { b } from './b.js'; export const value = 'a' + b;`,
  ],
  [
    `${userRealmURL}b.js`,
    `import { c } from './c.js'; export const b = 'b' + c;`,
  ],
  [`${userRealmURL}c.js`, `export const c = 'c';`],
  [`${userRealmURL}unrelated.js`, `export const value = 'unrelated';`],
]);

module('Unit | service | loader targeted invalidation', function (hooks) {
  setupRenderingTest(hooks);

  let network: NetworkService;
  let handler: (request: Request) => Promise<Response | null>;

  hooks.beforeEach(function () {
    network = getService('network');
    handler = async (request) => {
      let source = sources.get(request.url);
      return source == null
        ? null
        : new Response(source, {
            headers: { 'content-type': 'text/javascript' },
          });
    };
    network.virtualNetwork.mount(handler, { prepend: true });
  });

  hooks.afterEach(function () {
    network.virtualNetwork.unmount(handler);
  });

  test('[LDR-01] user source invalidation preserves trusted loader graphs and unrelated modules', async function (assert) {
    let loaderService = getService('loader-service');
    let hostLoader = loaderService.loader;
    let baseLoader = loaderService.baseLoader;
    let unrelatedTrustedLoader =
      loaderService.loaderForTrustedRealm(trustedRealmURL);

    await hostLoader.import(`${userRealmURL}a.js`);
    let unrelated = await hostLoader.import(`${userRealmURL}unrelated.js`);

    let result = loaderService.invalidateModule(`${userRealmURL}c.js`, {
      codeChange: true,
    });

    assert.strictEqual(
      loaderService.loader,
      hostLoader,
      'host loader survives',
    );
    assert.strictEqual(
      loaderService.baseLoader,
      baseLoader,
      'the app-wide Base loader survives',
    );
    assert.strictEqual(
      loaderService.loaderForTrustedRealm(trustedRealmURL),
      unrelatedTrustedLoader,
      'an unrelated trusted-realm loader survives',
    );
    assert.true(result.wasLoaded, 'the edited dependency was live');
    assert.strictEqual(
      result.invalidated,
      3,
      'the edited module and its known b and a dependants were evicted',
    );
    assert.false(hostLoader.isModuleLoaded(`${userRealmURL}a.js`));
    assert.false(hostLoader.isModuleLoaded(`${userRealmURL}b.js`));
    assert.false(hostLoader.isModuleLoaded(`${userRealmURL}c.js`));
    assert.true(
      hostLoader.isModuleLoaded(`${userRealmURL}unrelated.js`),
      'an unrelated module remains warm',
    );
    assert.strictEqual(
      await hostLoader.import(`${userRealmURL}unrelated.js`),
      unrelated,
      'the unrelated module retains its evaluated identity',
    );
    assert.true(
      loaderService.wasModuleFlushedForCodeChange(`${userRealmURL}c.js`),
      'the source generation waits for its realm acknowledgement',
    );
    loaderService.acknowledgeModuleInvalidation(`${userRealmURL}c.js`);
    assert.false(
      loaderService.wasModuleFlushedForCodeChange(`${userRealmURL}c.js`),
      'the matching realm acknowledgement consumes only that generation',
    );
  });
});
