import { setupTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';

import type NetworkService from '@cardstack/host/services/network';
import type RealmService from '@cardstack/host/services/realm';

const OUTER_REALM = 'http://realm-lookup.test/outer/';
const NESTED_REALM = 'http://realm-lookup.test/outer/nested/';

module('Unit | Service | realm | realm lookup', function (hooks) {
  setupTest(hooks);

  let realm: RealmService;
  let network: NetworkService;
  let prefixes: string[];

  hooks.beforeEach(function () {
    // Realm resources made here don't start refreshing their tokens against a
    // realm server.
    (globalThis as any).__boxelRenderContext = true;
    realm = this.owner.lookup('service:realm') as RealmService;
    network = this.owner.lookup('service:network') as NetworkService;
    prefixes = [];
  });

  hooks.afterEach(function () {
    for (let prefix of prefixes) {
      network.virtualNetwork.removeRealmMapping(prefix);
    }
    delete (globalThis as any).__boxelRenderContext;
  });

  function mapPrefix(prefix: string, url: string) {
    network.virtualNetwork.addRealmMapping(prefix, url);
    prefixes.push(prefix);
  }

  function learn(identifier: string) {
    realm.getOrCreateRealmResource(identifier, undefined, { exact: true });
  }

  test('a realm nested under another owns its resources, whichever was learned first', function (assert) {
    learn(OUTER_REALM);
    let card = `${NESTED_REALM}Pet/mango`;
    assert.strictEqual(
      realm.realmOf(rri(card)),
      OUTER_REALM,
      'before the nested realm is known, the outer one owns the card',
    );

    learn(NESTED_REALM);
    assert.strictEqual(
      realm.realmOf(rri(card)),
      NESTED_REALM,
      'learning the nested realm replaces the answer given before it',
    );
    assert.strictEqual(realm.url(card), NESTED_REALM);
    assert.strictEqual(realm.realmURLOf(card), NESTED_REALM);
    assert.strictEqual(
      realm.realmOf(rri(`${OUTER_REALM}Pet/vangogh`)),
      OUTER_REALM,
      'the outer realm keeps the resources outside the nested one',
    );
  });

  test('a nested realm keyed by its prefix owns its URLs inside a realm keyed by URL', function (assert) {
    mapPrefix('@realm-lookup/nested/', NESTED_REALM);
    learn(OUTER_REALM);
    learn('@realm-lookup/nested/');

    let card = `${NESTED_REALM}Pet/mango`;
    assert.strictEqual(realm.realmOf(rri(card)), '@realm-lookup/nested/');
    assert.strictEqual(realm.url(card), '@realm-lookup/nested/');
    assert.strictEqual(
      realm.realmOf(rri('@realm-lookup/nested/Pet/mango')),
      '@realm-lookup/nested/',
    );
  });

  test('nesting is measured by the identifiers, not the URLs they map to', function (assert) {
    mapPrefix(
      '@realm-lookup/',
      'http://a-much-longer-host.realm-lookup.test/org/',
    );
    mapPrefix('@realm-lookup/app/', 'http://short.test/');
    learn('@realm-lookup/');
    learn('@realm-lookup/app/');

    assert.strictEqual(
      realm.realmOf(rri('@realm-lookup/app/Pet/mango')),
      '@realm-lookup/app/',
    );
  });
});
