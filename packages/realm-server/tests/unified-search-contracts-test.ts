import { module, test } from 'qunit';
import { basename } from 'path';
import {
  combineSearchResults,
  cssResourceId,
  isCardResource,
  isCssResource,
  isIdentityOnlyCardResource,
  isRenderedHtmlResource,
  parseUnifiedSearchRequestFromPayload,
  rri,
  type CardResource,
  type CssResource,
  type RenderedHtmlResource,
  type UnifiedSearchCollectionDocument,
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

function identityOnlyCard(): CardResource {
  return {
    type: 'card',
    id: cardUrl,
    relationships: {
      'rendered-html': {
        data: { type: 'rendered-html', id: cardUrl },
      },
    },
    meta: { adoptsFrom: authorRef, identityOnly: true },
    links: { self: cardUrl },
  };
}

function renderedHtml(): RenderedHtmlResource {
  return {
    type: 'rendered-html',
    id: cardUrl,
    attributes: { html: '<div>Mango</div>', cardType: 'Author' },
    relationships: { styles: { data: [{ type: 'css', id: 'abc123' }] } },
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

module(basename(__filename), function () {
  module('unified search contracts', function () {
    // --- predicates ---------------------------------------------------------

    test('isIdentityOnlyCardResource keys on meta.identityOnly, not attribute-absence', function (assert) {
      assert.true(isCardResource(fullCard()), 'full card is a card resource');
      assert.false(
        isIdentityOnlyCardResource(fullCard()),
        'a full card (attributes, no flag) is not identity-only',
      );
      assert.true(
        isIdentityOnlyCardResource(identityOnlyCard()),
        'a flagged identity-only card is identity-only',
      );

      // The flag — not the relationship and not attribute-absence — is the
      // discriminator.
      let relWithoutFlag = identityOnlyCard();
      relWithoutFlag.meta = { adoptsFrom: authorRef };
      assert.false(
        isIdentityOnlyCardResource(relWithoutFlag),
        'a rendered-html relationship without the flag is not identity-only',
      );

      let noAttributesNoFlag: CardResource = {
        type: 'card',
        id: cardUrl,
        relationships: {
          friend: { links: { self: `${realmURL}Author/2` } },
        },
        meta: { adoptsFrom: authorRef },
      };
      assert.false(
        isIdentityOnlyCardResource(noAttributesNoFlag),
        'a full card that merely lacks attributes is not identity-only',
      );
    });

    test('isRenderedHtmlResource recognizes a rendered-html resource', function (assert) {
      assert.true(isRenderedHtmlResource(renderedHtml()));
      assert.false(
        isRenderedHtmlResource(fullCard()),
        'a card is not a rendered-html resource',
      );
      assert.false(
        isRenderedHtmlResource({
          type: 'rendered-html',
          id: cardUrl,
          attributes: { cardType: 'Author' },
          relationships: { styles: { data: [] } },
        }),
        'a rendered-html resource without html is rejected',
      );
      assert.false(
        isRenderedHtmlResource({
          type: 'rendered-html',
          id: cardUrl,
          attributes: { html: '<div></div>' },
          relationships: { styles: { data: [] } },
        }),
        'a rendered-html resource without cardType is rejected',
      );
      assert.false(
        isRenderedHtmlResource({
          type: 'rendered-html',
          id: cardUrl,
          attributes: { html: '<div></div>', cardType: 'Author' },
        }),
        'a rendered-html resource without a styles relationship is rejected',
      );
    });

    test('isCssResource recognizes a css resource', function (assert) {
      assert.true(isCssResource(css()));
      assert.false(
        isCssResource(renderedHtml()),
        'a rendered-html resource is not a css resource',
      );
      assert.false(
        isCssResource({ type: 'css', id: 'abc', attributes: {} }),
        'a css resource without href is rejected',
      );
    });

    // --- request parse ------------------------------------------------------

    test('parse: render.format is used when provided', function (assert) {
      let { render, dataOnly } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        render: { format: 'embedded' },
      });
      assert.strictEqual(render?.format, 'embedded');
      assert.notOk(dataOnly, 'a render request is not data-only');
    });

    test('parse: render.format defaults to fitted when omitted', function (assert) {
      let { render } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        render: {},
      });
      assert.strictEqual(render?.format, 'fitted');
    });

    test('parse: render.renderType accepts a CodeRef', function (assert) {
      let { render } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        render: { renderType: authorRef },
      });
      assert.deepEqual(render?.renderType, authorRef);
    });

    test('parse: render.renderType accepts the "native" escape valve', function (assert) {
      let { render } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        render: { renderType: 'native' },
      });
      assert.strictEqual(render?.renderType, 'native');
    });

    test('parse: render.renderType omitted leaves renderType unset', function (assert) {
      let { render } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        render: { format: 'fitted' },
      });
      assert.strictEqual(render?.renderType, undefined);
    });

    test('parse: invalid renderType is rejected', function (assert) {
      assert.throws(() =>
        parseUnifiedSearchRequestFromPayload({
          realms: [realmURL],
          render: { renderType: 'bogus' },
        }),
      );
    });

    test('parse: a non-object body is rejected', function (assert) {
      // null / string / number must not coerce to an empty broad search.
      for (let bad of [null, 'a string', 42, true]) {
        assert.throws(
          () => parseUnifiedSearchRequestFromPayload(bad as unknown),
          /must be a JSON object/,
          `rejects ${JSON.stringify(bad)}`,
        );
      }
    });

    test('parse: an invalid render.format is rejected', function (assert) {
      assert.throws(
        () =>
          parseUnifiedSearchRequestFromPayload({
            realms: [realmURL],
            render: { format: 'bogus' },
          }),
        /render\.format/,
      );
    });

    test('parse: a non-object render is rejected', function (assert) {
      assert.throws(
        () =>
          parseUnifiedSearchRequestFromPayload({
            realms: [realmURL],
            render: 'oops',
          }),
        /render must be an object/,
      );
    });

    test('parse: render combined with dataOnly is rejected', function (assert) {
      // The two are mutually exclusive modes; a contradictory payload must not
      // silently succeed (and a malformed render must not be swallowed).
      assert.throws(
        () =>
          parseUnifiedSearchRequestFromPayload({
            realms: [realmURL],
            dataOnly: true,
            render: { format: 'fitted' },
          }),
        /mutually exclusive/,
      );
    });

    test('parse: dataOnly true yields live-only with no render', function (assert) {
      let { dataOnly, render } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        dataOnly: true,
      });
      assert.true(dataOnly, 'dataOnly is honored');
      assert.strictEqual(render, undefined, 'data-only carries no render spec');
    });

    test('parse: a body with no render is not data-only', function (assert) {
      let { dataOnly, render } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
      });
      assert.notOk(dataOnly, 'a missing render must NOT be read as data-only');
      assert.strictEqual(
        render?.format,
        'fitted',
        'prefer-HTML is the default with the fitted format',
      );
    });

    test('parse: cardUrls round-trips', function (assert) {
      let urls = [`${realmURL}Author/1`, `${realmURL}Author/2`];
      let { cardUrls } = parseUnifiedSearchRequestFromPayload({
        realms: [realmURL],
        cardUrls: urls,
      });
      assert.deepEqual(cardUrls, urls);
    });

    // --- css hash helper ----------------------------------------------------

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

  // The unified federated merge. Its `included` dedup keys on the JSON:API
  // identity pair `(type, id)` — not `id` alone — so it can carry a `card` and
  // its `rendered-html` (which share the card's URL as their id) side by side
  // while still collapsing a `css` or a linked `card` shared across realms to a
  // single entry.
  module('combineSearchResults (unified federated merge)', function () {
    test('dedupes `included` by (type, id): a shared css and a shared linked card travel once across realms', function (assert) {
      let linkedId = rri(`${realmURL}Tag/1`);
      let linkedCard = (): CardResource => ({
        type: 'card',
        id: linkedId,
        attributes: { name: 'green' },
        meta: { adoptsFrom: { module: rri(`${realmURL}tag`), name: 'Tag' } },
        links: { self: linkedId },
      });

      let docA: UnifiedSearchCollectionDocument = {
        data: [identityOnlyCard()],
        included: [renderedHtml(), css(), linkedCard()],
        meta: { page: { total: 1 } },
      };

      // A second realm's result: a distinct card + rendering, but it links the
      // same Tag and references the same scoped stylesheet (identical href →
      // identical css hash id).
      let url2 = rri(`${realmURL}Author/2`);
      let docB: UnifiedSearchCollectionDocument = {
        data: [
          {
            type: 'card',
            id: url2,
            relationships: {
              'rendered-html': { data: { type: 'rendered-html', id: url2 } },
            },
            meta: { adoptsFrom: authorRef, identityOnly: true },
            links: { self: url2 },
          },
        ],
        included: [
          {
            type: 'rendered-html',
            id: url2,
            attributes: { html: '<div>Van Gogh</div>', cardType: 'Author' },
            relationships: {
              styles: { data: [{ type: 'css', id: css().id }] },
            },
          },
          css(),
          linkedCard(),
        ],
        meta: { page: { total: 1 } },
      };

      let merged = combineSearchResults([docA, docB]);
      let included = merged.included ?? [];

      assert.strictEqual(merged.data.length, 2, 'both result cards survive');
      assert.strictEqual(
        included.filter((r) => r.type === 'css').length,
        1,
        'the shared css resource appears exactly once',
      );
      assert.strictEqual(
        included.filter((r) => r.type === 'card' && r.id === linkedId).length,
        1,
        'the shared linked card appears exactly once',
      );
      assert.strictEqual(
        included.filter((r) => r.type === 'rendered-html').length,
        2,
        'distinct renderings (different ids) both survive',
      );
      assert.strictEqual(merged.meta.page.total, 2, 'page totals sum');
    });

    test('keeps a `card` and a `rendered-html` that share an id — `(type, id)` discriminates where `id` alone would collapse them', function (assert) {
      let url = rri(`${realmURL}Author/9`);
      let doc: UnifiedSearchCollectionDocument = {
        data: [],
        included: [
          {
            type: 'card',
            id: url,
            attributes: { name: 'Mango' },
            meta: { adoptsFrom: authorRef },
            links: { self: url },
          },
          {
            type: 'rendered-html',
            id: url,
            attributes: { html: '<div>Mango</div>', cardType: 'Author' },
            relationships: { styles: { data: [] } },
          },
        ],
        meta: { page: { total: 1 } },
      };

      let included = combineSearchResults([doc]).included ?? [];
      assert.strictEqual(
        included.length,
        2,
        'both the card and its rendered-html (same id) survive',
      );
      assert.ok(
        included.some((r) => r.type === 'card' && r.id === url),
        'the card is kept',
      );
      assert.ok(
        included.some((r) => r.type === 'rendered-html' && r.id === url),
        'the rendered-html is kept',
      );
    });

    test('concatenates `data` in realm order, sums `meta.page.total`, and omits an empty `included`', function (assert) {
      let a = rri(`${realmURL}A`);
      let b = rri(`${realmURL}B`);
      let mk = (
        id: ReturnType<typeof rri>,
        total: number,
      ): UnifiedSearchCollectionDocument => ({
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
});
