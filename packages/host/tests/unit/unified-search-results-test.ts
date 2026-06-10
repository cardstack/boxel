import { module, test } from 'qunit';

import { rri } from '@cardstack/runtime-common';
import type { UnifiedSearchCollectionDocument } from '@cardstack/runtime-common/document-types';

import { buildRenderableSearchItems } from '@cardstack/host/lib/unified-search-results';

const realmURL = 'http://test-realm/test/';
const authorRef = { module: rri(`${realmURL}author`), name: 'Author' };
const cardUrl = rri(`${realmURL}Author/1`);
const cssHref = `${realmURL}Author.gts.QUJD.glimmer-scoped.css`;

function identityOnlyCard(id = cardUrl) {
  return {
    type: 'card' as const,
    id,
    relationships: {
      'rendered-html': { data: { type: 'rendered-html' as const, id } },
    },
    meta: { adoptsFrom: authorRef, identityOnly: true },
    links: { self: id },
  };
}

function recordImports() {
  let imported: string[] = [];
  let importCss = async (href: string) => {
    imported.push(href);
  };
  return { imported, importCss };
}

module('Unit | lib | unified-search-results', function () {
  test('an identity-only row yields an inert component, imports its css, and echoes the render type', async function (assert) {
    let doc: UnifiedSearchCollectionDocument = {
      data: [identityOnlyCard()],
      included: [
        {
          type: 'rendered-html',
          id: cardUrl,
          attributes: {
            html: '<div data-test-x>Mango</div>',
            cardType: 'Author',
            iconHtml: '<svg></svg>',
          },
          relationships: { styles: { data: [{ type: 'css', id: 'css-1' }] } },
        },
        { type: 'css', id: 'css-1', attributes: { href: cssHref } },
      ],
      meta: { page: { total: 1 }, renderType: authorRef },
    };

    let { imported, importCss } = recordImports();
    let items = await buildRenderableSearchItems(doc, importCss);

    assert.strictEqual(items.length, 1, 'one item');
    assert.ok(
      items[0].component,
      'the identity-only row carries an inert component',
    );
    assert.deepEqual(
      items[0].renderType,
      authorRef,
      'the collection render type is echoed onto the item',
    );
    assert.false(items[0].isError, 'not an error row');
    assert.deepEqual(
      imported,
      [cssHref],
      "the row's css was imported via the loader",
    );
  });

  test('a full live row yields no component and imports no css', async function (assert) {
    let url = rri(`${realmURL}Author/2`);
    let doc: UnifiedSearchCollectionDocument = {
      data: [
        {
          type: 'card',
          id: url,
          attributes: { name: 'Van Gogh' },
          meta: { adoptsFrom: authorRef },
          links: { self: url },
        },
      ],
      meta: { page: { total: 1 }, renderType: authorRef },
    };

    let { imported, importCss } = recordImports();
    let items = await buildRenderableSearchItems(doc, importCss);

    assert.strictEqual(items.length, 1, 'one item');
    assert.notOk(
      items[0].component,
      'a full live row carries no inert component (rendered live from the Store)',
    );
    assert.deepEqual(items[0].renderType, authorRef, 'render type echoed');
    assert.deepEqual(imported, [], 'no css imported for a live row');
  });

  test('a css shared across rows is imported exactly once', async function (assert) {
    let url2 = rri(`${realmURL}Author/2`);
    let doc: UnifiedSearchCollectionDocument = {
      data: [identityOnlyCard(), identityOnlyCard(url2)],
      included: [
        {
          type: 'rendered-html',
          id: cardUrl,
          attributes: { html: '<div>A</div>', cardType: 'Author' },
          relationships: { styles: { data: [{ type: 'css', id: 'css-1' }] } },
        },
        {
          type: 'rendered-html',
          id: url2,
          attributes: { html: '<div>B</div>', cardType: 'Author' },
          relationships: { styles: { data: [{ type: 'css', id: 'css-1' }] } },
        },
        { type: 'css', id: 'css-1', attributes: { href: cssHref } },
      ],
      meta: { page: { total: 2 }, renderType: authorRef },
    };

    let { imported, importCss } = recordImports();
    let items = await buildRenderableSearchItems(doc, importCss);

    assert.strictEqual(items.length, 2, 'two items');
    assert.ok(items[0].component, 'first row carries an inert component');
    assert.ok(items[1].component, 'second row carries an inert component');
    assert.deepEqual(
      imported,
      [cssHref],
      'the shared css imported exactly once',
    );
  });

  test('an identity-only row with no resolvable rendered-html yields no component', async function (assert) {
    let doc: UnifiedSearchCollectionDocument = {
      data: [identityOnlyCard()],
      included: [],
      meta: { page: { total: 1 }, renderType: authorRef },
    };

    let { importCss } = recordImports();
    let items = await buildRenderableSearchItems(doc, importCss);

    assert.strictEqual(items.length, 1, 'the row is still surfaced');
    assert.notOk(
      items[0].component,
      'no component when the rendered-html is missing (caller falls back)',
    );
  });

  test('an error rendered-html surfaces isError', async function (assert) {
    let doc: UnifiedSearchCollectionDocument = {
      data: [identityOnlyCard()],
      included: [
        {
          type: 'rendered-html',
          id: cardUrl,
          attributes: {
            html: '<div>last known good</div>',
            cardType: 'Author',
            isError: true,
          },
          relationships: { styles: { data: [] } },
        },
      ],
      meta: { page: { total: 1 }, renderType: authorRef },
    };

    let { importCss } = recordImports();
    let items = await buildRenderableSearchItems(doc, importCss);

    assert.true(items[0].isError, 'isError surfaced from the rendered-html');
  });
});
