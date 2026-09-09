import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { Loader, VirtualNetwork } from '@cardstack/runtime-common';

import { setupRenderingTest } from '../helpers/setup';

const realmURL = 'https://example.com/realm/';

function networkWithRealm() {
  let vn = new VirtualNetwork(
    async () => new Response('', { status: 404 }),
    {},
  );
  vn.addRealmMapping('@scope/realm/', realmURL);
  return vn;
}

module('Unit | VirtualNetwork reset', function () {
  test('clears every registered mapping', function (assert) {
    let vn = networkWithRealm();
    assert.true(vn.isRegisteredPrefix('@scope/realm/thing'), 'registered');

    vn.reset();

    assert.false(
      vn.isRegisteredPrefix('@scope/realm/thing'),
      'the prefix is gone after a reset',
    );
  });

  test('notifies mapping-change listeners, because clearing every mapping is a mapping change', function (assert) {
    let vn = networkWithRealm();
    let fired = 0;
    vn.onMappingChange(() => fired++);

    vn.reset();

    assert.strictEqual(fired, 1, 'the listener was told');
  });

  test('keeps listeners subscribed across a reset', function (assert) {
    let vn = networkWithRealm();
    let fired = 0;
    vn.onMappingChange(() => fired++);

    vn.reset();
    vn.addRealmMapping('@scope/other/', 'https://example.com/other/');

    assert.strictEqual(
      fired,
      2,
      'a subscriber registered before the reset still hears later changes',
    );
  });

  test('stops folding identifiers through mappings it no longer has', function (assert) {
    let vn = networkWithRealm();
    let resolved = `${realmURL}thing`;
    assert.strictEqual(
      vn.unresolveURL(resolved),
      '@scope/realm/thing',
      'folds to the prefix while the mapping is registered',
    );

    vn.reset();

    assert.strictEqual(
      vn.unresolveURL(resolved),
      resolved,
      'the derived cache did not outlive the mapping it was keyed under',
    );
  });

  test('a Loader holding the network sees mappings registered after a reset', function (assert) {
    let vn = networkWithRealm();
    let loader = new Loader(vn.fetch, vn.resolveImport, {
      virtualNetwork: vn,
    });

    vn.reset();
    vn.addRealmMapping('@scope/fresh/', 'https://example.com/fresh/');

    assert.strictEqual(
      loader.moduleKey('https://example.com/fresh/mod'),
      '@scope/fresh/mod',
      'the loader folds through the post-reset mapping without being rebuilt',
    );
  });
});

module('Unit | network service reset', function (hooks) {
  setupRenderingTest(hooks);

  test('resets its network in place rather than replacing it', function (assert) {
    let network = getService('network');
    let before = network.virtualNetwork;

    network.resetState();

    assert.strictEqual(
      network.virtualNetwork,
      before,
      'consumers holding the network — the loader, the fetcher chain — still hold the live one',
    );
  });

  test('re-registers the mappings every boot installs', function (assert) {
    let network = getService('network');

    network.resetState();

    assert.true(
      network.virtualNetwork.isRegisteredPrefix('@cardstack/base/card-api'),
      'the base realm prefix is registered again after a reset',
    );
  });
});
