import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  rri,
  type CardResource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';
import { buildSparseItemResource } from '@cardstack/runtime-common/search-entry';

const realmURL = 'http://localhost:4201/test/';
const cardUrl = rri(`${realmURL}Author/1`);
const authorRef: ResolvedCodeRef = {
  module: rri(`${realmURL}author`),
  name: 'Author',
};

module(basename(import.meta.filename), function () {
  // A sparse field path reads and writes the card's own members only.
  test('sparse field paths follow own members only', function (assert) {
    let full = JSON.parse(
      JSON.stringify({
        type: 'card',
        id: cardUrl,
        attributes: { title: 'T' },
        meta: { adoptsFrom: authorRef, fields: {}, lastModified: 5 },
        links: { self: cardUrl },
      }).replace(
        '"attributes":{',
        '"attributes":{"data":{"__proto__":{"extra":"x"},"constructor":"c"},',
      ),
    ) as CardResource;
    try {
      let sparse = buildSparseItemResource(full, [
        'data.__proto__.extra',
        'data.constructor',
        'title',
        'toString',
        '__proto__.toString',
      ]);
      assert.strictEqual(
        ({} as Record<string, unknown>).extra,
        undefined,
        'plain objects are unchanged',
      );
      assert.strictEqual(
        JSON.stringify(sparse.attributes),
        '{"data":{"__proto__":{"extra":"x"},"constructor":"c"},"title":"T"}',
        "the card's own keys, as it holds them",
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).extra;
    }
  });
});
