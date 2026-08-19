import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  buildCssResource,
  cssResourceId,
  isCssResource,
  parseUsedRenderType,
  rri,
  scopedCssHrefsFromDeps,
  type CardResource,
  type CssResource,
} from '@cardstack/runtime-common';

const realmURL = 'http://localhost:4201/test/';
const cardUrl = rri(`${realmURL}Author/1`);

const authorRef = {
  module: rri(`${realmURL}author`),
  name: 'Author',
};

function fullCard(): CardResource {
  return {
    type: 'card',
    id: cardUrl,
    attributes: { name: 'Mango' },
    meta: { adoptsFrom: authorRef },
    links: { self: cardUrl },
  };
}

function css(
  href = `${realmURL}Author.gts.QUJD.glimmer-scoped.css`,
): CssResource {
  return {
    type: 'css',
    id: cssResourceId(href),
    attributes: { href },
  };
}

module(basename(import.meta.filename), function () {
  module('search resource helpers', function () {
    test('isCssResource recognizes a css resource', function (assert) {
      assert.true(isCssResource(css()));
      assert.false(
        isCssResource(fullCard()),
        'a card resource is not a css resource',
      );
      assert.false(
        isCssResource({ type: 'css', id: 'abc', attributes: {} }),
        'a css resource without href is rejected',
      );
    });

    test('cssResourceId is stable and dedupes identical CSS', function (assert) {
      let href = `${realmURL}Author.gts.QUJD.glimmer-scoped.css`;
      assert.strictEqual(
        cssResourceId(href),
        cssResourceId(href),
        'stable for the same href',
      );
      assert.strictEqual(
        cssResourceId(href),
        cssResourceId(`${href}`),
        'identical CSS URL → identical id (dedup)',
      );
      assert.notStrictEqual(
        cssResourceId(href),
        cssResourceId(`${realmURL}Pet.gts.WHpublished.glimmer-scoped.css`),
        'different CSS URL → different id',
      );
    });
  });

  // The federated merge for the live-card document: concatenate `data` in
  // realm order, sum `meta.page.total`, and dedupe `included` by the JSON:API
  // identity pair `(type, id)`.
  // Pure helpers shared by the search result mappers.
  module('search resource helpers (render-type + css)', function () {
    test('parseUsedRenderType splits "<module>/<name>" into a CodeRef', function (assert) {
      assert.deepEqual(parseUsedRenderType(`${realmURL}author/Author`), {
        module: rri(`${realmURL}author`),
        name: 'Author',
      });
      assert.strictEqual(
        parseUsedRenderType(undefined),
        undefined,
        'undefined → undefined',
      );
      assert.strictEqual(
        parseUsedRenderType('no-separator'),
        undefined,
        'a value with no separator → undefined',
      );
    });

    test('scopedCssHrefsFromDeps keeps only scoped-CSS deps, in order', function (assert) {
      let cssA = `${realmURL}Author.gts.QUJD.glimmer-scoped.css`;
      let cssB = `${realmURL}Pet.gts.WHp1.glimmer-scoped.css`;
      assert.deepEqual(
        scopedCssHrefsFromDeps([
          `${realmURL}author`,
          cssA,
          `${realmURL}pet`,
          cssB,
        ]),
        [cssA, cssB],
      );
      assert.deepEqual(scopedCssHrefsFromDeps(null), [], 'null deps → []');
    });

    test('buildCssResource hashes the href and is a css resource', function (assert) {
      let href = `${realmURL}Author.gts.QUJD.glimmer-scoped.css`;
      let resource = buildCssResource(href);
      assert.true(isCssResource(resource), 'is a css resource');
      assert.strictEqual(
        resource.id,
        cssResourceId(href),
        'id is the href hash',
      );
      assert.strictEqual(resource.attributes.href, href, 'href rides verbatim');
    });
  });
});
