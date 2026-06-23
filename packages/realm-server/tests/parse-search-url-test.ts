import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  buildQuerySearchURL,
  parseSearchURL,
  rri,
} from '@cardstack/runtime-common';
import type { Query } from '@cardstack/runtime-common';

module(basename(import.meta.filename), function () {
  module('parseSearchURL realm recovery', function () {
    const realm = 'http://example.test/my-realm/';
    const query: Query = {
      filter: { type: { module: rri(`${realm}person`), name: 'Person' } },
    };

    test('recovers the realm from a built v2 search URL', async function (assert) {
      let { realm: recovered, query: recoveredQuery } = parseSearchURL(
        buildQuerySearchURL(realm, query),
      );
      assert.strictEqual(recovered.href, realm, 'realm round-trips');
      assert.deepEqual(
        recoveredQuery.filter,
        query.filter,
        'query round-trips',
      );
    });

    test('strips the _search-v2 segment without leaving a double slash', async function (assert) {
      let { realm: recovered } = parseSearchURL(
        new URL('_search-v2', realm).href,
      );
      assert.strictEqual(recovered.href, realm);
    });

    test('strips a trailing-slash _search-v2 segment without leaving a double slash', async function (assert) {
      let { realm: recovered } = parseSearchURL(`${realm}_search-v2/`);
      assert.strictEqual(recovered.href, realm);
    });

    test('strips the legacy _search segment', async function (assert) {
      let { realm: recovered } = parseSearchURL(new URL('_search', realm).href);
      assert.strictEqual(recovered.href, realm);
    });

    test('strips a trailing-slash legacy _search segment', async function (assert) {
      let { realm: recovered } = parseSearchURL(`${realm}_search/`);
      assert.strictEqual(recovered.href, realm);
    });

    test('recovers a root realm', async function (assert) {
      let { realm: recovered } = parseSearchURL(
        'http://example.test/_search-v2',
      );
      assert.strictEqual(recovered.href, 'http://example.test/');
    });
  });
});
