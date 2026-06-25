import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  buildCssResource,
  combineSearchResults,
  cssResourceId,
  isCssResource,
  parseUsedRenderType,
  rri,
  scopedCssHrefsFromDeps,
  type CardResource,
  type CssResource,
  type LinkableCollectionDocument,
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
  module('combineSearchResults (federated merge)', function () {
    test('dedupes `included` by (type, id): a linked card shared across realms travels once', function (assert) {
      let linkedId = rri(`${realmURL}Tag/1`);
      let linkedCard = (): CardResource => ({
        type: 'card',
        id: linkedId,
        attributes: { name: 'green' },
        meta: { adoptsFrom: { module: rri(`${realmURL}tag`), name: 'Tag' } },
        links: { self: linkedId },
      });

      let docA: LinkableCollectionDocument = {
        data: [fullCard()],
        included: [linkedCard()],
        meta: { page: { total: 1 } },
      };

      // A second realm's result: a distinct card that links the same Tag.
      let url2 = rri(`${realmURL}Author/2`);
      let docB: LinkableCollectionDocument = {
        data: [
          {
            type: 'card',
            id: url2,
            attributes: { name: 'Van Gogh' },
            meta: { adoptsFrom: authorRef },
            links: { self: url2 },
          },
        ],
        included: [linkedCard()],
        meta: { page: { total: 1 } },
      };

      let merged = combineSearchResults([docA, docB]);
      let included = merged.included ?? [];

      assert.strictEqual(merged.data.length, 2, 'both result cards survive');
      assert.strictEqual(
        included.filter((r) => r.type === 'card' && r.id === linkedId).length,
        1,
        'the shared linked card appears exactly once',
      );
      assert.strictEqual(merged.meta.page.total, 2, 'page totals sum');
    });

    test('concatenates `data` in realm order, sums `meta.page.total`, and omits an empty `included`', function (assert) {
      let a = rri(`${realmURL}A`);
      let b = rri(`${realmURL}B`);
      let mk = (
        id: ReturnType<typeof rri>,
        total: number,
      ): LinkableCollectionDocument => ({
        data: [
          {
            type: 'card',
            id,
            attributes: {},
            meta: { adoptsFrom: authorRef },
            links: { self: id },
          },
        ],
        meta: { page: { total } },
      });

      let merged = combineSearchResults([mk(a, 3), mk(b, 5)]);
      assert.deepEqual(
        merged.data.map((r) => r.id),
        [a, b],
        'data preserves realm order',
      );
      assert.strictEqual(merged.meta.page.total, 8, 'page totals sum');
      assert.notOk(
        'included' in merged,
        'no included key when nothing to include',
      );
    });
  });

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
