import { module, test } from 'qunit';
import { basename } from 'path';
import {
  buildHtmlResource,
  buildSearchEntryResource,
  buildSparseItemResource,
  htmlResourceId,
  cssResourceId,
  isHtmlResource,
  isSearchEntryResource,
  isSparseItemResource,
  parseSearchEntryQueryFromPayload,
  SearchRequestError,
  rri,
  type CardResource,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

const realmURL = 'http://localhost:4201/test/';
const cardUrl = rri(`${realmURL}Author/1`);

const authorRef: ResolvedCodeRef = {
  module: rri(`${realmURL}author`),
  name: 'Author',
};
const baseRef: ResolvedCodeRef = {
  module: rri(`${realmURL}base-card`),
  name: 'BaseCard',
};

function parseError(payload: unknown): SearchRequestError {
  try {
    parseSearchEntryQueryFromPayload(payload);
  } catch (e) {
    if (e instanceof SearchRequestError) {
      return e;
    }
    throw e;
  }
  throw new Error('expected parseSearchEntryQueryFromPayload to throw');
}

module(basename(__filename), function () {
  module('search-entry query parser', function () {
    test('translates the canonical search-entry query', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({
        filter: {
          'item.on': authorRef,
          eq: {
            'item.status': 'ready',
            'html.format': 'embedded',
            'html.renderType': baseRef,
          },
        },
        sort: [{ by: 'item.title', direction: 'asc' }],
        page: { size: 20 },
        realms: ['http://localhost:4201/test'],
        fields: { 'search-entry': ['html'] },
      });
      assert.deepEqual(parsed.itemQuery, {
        filter: { on: authorRef, eq: { status: 'ready' } },
        // a card-field sort without its own anchor inherits the filter's
        sort: [{ by: 'title', direction: 'asc', on: authorRef }],
        page: { size: 20 },
      } as any);
      assert.deepEqual(parsed.render, {
        format: 'embedded',
        renderType: baseRef,
      });
      assert.deepEqual(parsed.fieldset, {
        html: true,
        item: { kind: 'none' },
        itemAsFallback: false,
      });
      assert.deepEqual(parsed.realms, ['http://localhost:4201/test/']);
    });

    test('defaults: no filter → fitted/native; no fields → html with item fallback', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({});
      assert.deepEqual(parsed.itemQuery, {} as any);
      assert.deepEqual(parsed.render, { format: 'fitted' });
      assert.deepEqual(parsed.fieldset, {
        html: true,
        item: { kind: 'none' },
        itemAsFallback: true,
      });
    });

    test('a filter carrying only the item.on anchor is a pure card-type filter', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({
        filter: { 'item.on': authorRef },
      });
      assert.deepEqual(parsed.itemQuery, {
        filter: { type: authorRef },
      } as any);
    });

    test('a filter that carried only rendering config dissolves', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({
        filter: { eq: { 'html.format': 'atom' } },
      });
      assert.deepEqual(parsed.itemQuery, {} as any);
      assert.strictEqual(parsed.render.format, 'atom');
    });

    test('translates item. paths through nested connectives', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({
        filter: {
          'item.on': authorRef,
          any: [
            { contains: { 'item.title': 'draft' } },
            { not: { eq: { 'item.archived': true } } },
          ],
        },
      });
      assert.deepEqual(parsed.itemQuery.filter, {
        on: authorRef,
        any: [
          { contains: { title: 'draft' } },
          { not: { eq: { archived: true } } },
        ],
      } as any);
    });

    test('html.* under a non-eq operator (or a nested eq) is ignored', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({
        filter: {
          'item.on': authorRef,
          range: { 'item.age': { gt: 21 }, 'html.format': { gt: 'a' } },
          every: [{ eq: { 'item.x': 1, 'html.format': 'atom' } }],
        },
      });
      // the ignored html.* entries leave no residue and do not set the format
      assert.deepEqual(parsed.itemQuery.filter, {
        on: authorRef,
        range: { age: { gt: 21 } },
        every: [{ eq: { x: 1 } }],
      } as any);
      assert.strictEqual(parsed.render.format, 'fitted');
    });

    test('sort entries may carry their own item.on anchor', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({
        sort: [
          { by: 'item.title', 'item.on': authorRef, direction: 'desc' },
          { by: 'item.lastModified' },
        ],
      });
      assert.deepEqual(parsed.itemQuery.sort, [
        { by: 'title', on: authorRef, direction: 'desc' },
        // a general sort field needs no anchor
        { by: 'lastModified' },
      ] as any);
    });

    test('sparse fieldsets parse to the item selection', function (assert) {
      assert.deepEqual(
        parseSearchEntryQueryFromPayload({
          fields: { 'search-entry': ['item'] },
        }).fieldset,
        { html: false, item: { kind: 'full' }, itemAsFallback: false },
      );
      assert.deepEqual(
        parseSearchEntryQueryFromPayload({
          fields: { 'search-entry': ['item.title', 'item.status'] },
        }).fieldset,
        {
          html: false,
          item: { kind: 'sparse', fields: ['title', 'status'] },
          itemAsFallback: false,
        },
      );
      assert.deepEqual(
        parseSearchEntryQueryFromPayload({
          fields: { 'search-entry': ['html', 'item'] },
        }).fieldset,
        { html: true, item: { kind: 'full' }, itemAsFallback: false },
      );
    });

    test('rejects malformed queries', function (assert) {
      assert.strictEqual(
        parseError({ filter: { eq: { status: 'ready' } } }).code,
        'invalid-query',
        'bare field path',
      );
      assert.strictEqual(
        parseError({ filter: { 'html.format': 'embedded' } }).code,
        'invalid-query',
        'field-keyed html.* at the filter level',
      );
      assert.strictEqual(
        parseError({ filter: { eq: { 'html.format': 'bogus' } } }).code,
        'invalid-render',
        'invalid html.format value',
      );
      assert.strictEqual(
        parseError({ filter: { eq: { 'html.renderType': 'Author' } } }).code,
        'invalid-render',
        'html.renderType must be a CodeRef',
      );
      assert.strictEqual(
        parseError({ fields: { 'search-entry': ['item', 'item.title'] } }).code,
        'invalid-query',
        'full item cannot combine with item.<field>',
      );
      assert.strictEqual(
        parseError({ fields: { 'search-entry': ['html.cardType'] } }).code,
        'invalid-query',
        'html does not dot deeper in a fieldset',
      );
      assert.strictEqual(
        parseError({ fields: { card: ['title'] } }).code,
        'invalid-query',
        'only the search-entry type is selectable',
      );
      assert.strictEqual(
        parseError({ fields: { 'search-entry': [] } }).code,
        'invalid-query',
        'empty fieldset',
      );
      assert.strictEqual(
        parseError({ render: {} }).code,
        'invalid-query',
        'unknown top-level member',
      );
      assert.strictEqual(
        parseError({ sort: [{ by: 'title' }] }).code,
        'invalid-query',
        'sort by must be item.-addressed',
      );
      assert.strictEqual(
        parseError({ sort: [{ by: 'item.title', on: authorRef }] }).code,
        'invalid-query',
        'sort anchor is addressed as item.on',
      );
    });
  });

  module('html composite id', function () {
    test('encodes (url, format, renderType) with # at both joints', function (assert) {
      assert.strictEqual(
        htmlResourceId({
          url: cardUrl,
          format: 'fitted',
          renderType: authorRef,
        }),
        `${cardUrl}#fitted#${authorRef.module}/${authorRef.name}`,
      );
    });

    test('a rendering with no renderType (a file) is url#format', function (assert) {
      assert.strictEqual(
        htmlResourceId({ url: `${realmURL}notes.txt`, format: 'embedded' }),
        `${realmURL}notes.txt#embedded`,
      );
    });
  });

  module('search-entry builders', function () {
    test('buildSearchEntryResource links the requested branches', function (assert) {
      let htmlId = htmlResourceId({
        url: cardUrl,
        format: 'fitted',
        renderType: authorRef,
      });
      let both = buildSearchEntryResource({
        url: cardUrl,
        htmlId,
        itemType: 'card',
      });
      assert.deepEqual(both, {
        type: 'search-entry',
        id: cardUrl,
        relationships: {
          html: { data: { type: 'html', id: htmlId } },
          item: { data: { type: 'card', id: cardUrl } },
        },
      });
      assert.true(isSearchEntryResource(both));

      let htmlOnly = buildSearchEntryResource({ url: cardUrl, htmlId });
      assert.deepEqual(Object.keys(htmlOnly.relationships), ['html']);
      assert.true(isSearchEntryResource(htmlOnly));
    });

    test('buildHtmlResource carries the rendering attributes and styles', function (assert) {
      let cssId = cssResourceId('https://x/scoped.glimmer-scoped.css');
      let resource = buildHtmlResource({
        url: cardUrl,
        format: 'fitted',
        renderType: authorRef,
        html: '<div>hi</div>',
        cardType: 'Author',
        iconHtml: '<svg/>',
        cssIds: [cssId],
      });
      assert.deepEqual(resource, {
        type: 'html',
        id: `${cardUrl}#fitted#${authorRef.module}/${authorRef.name}`,
        attributes: {
          html: '<div>hi</div>',
          cardType: 'Author',
          iconHtml: '<svg/>',
          format: 'fitted',
          renderType: authorRef,
        },
        relationships: { styles: { data: [{ type: 'css', id: cssId }] } },
      });
      assert.true(isHtmlResource(resource));
    });

    test('an error rendering may omit html', function (assert) {
      let resource = buildHtmlResource({
        url: cardUrl,
        format: 'fitted',
        renderType: authorRef,
        cardType: 'Author',
        isError: true,
        cssIds: [],
      });
      assert.false('html' in resource.attributes);
      assert.true(resource.attributes.isError);
      assert.true(isHtmlResource(resource));
    });

    test('buildSparseItemResource projects the requested fields and stamps the marker', function (assert) {
      let full: CardResource = {
        type: 'card',
        id: cardUrl,
        attributes: {
          title: 'T',
          status: 'ready',
          bio: { city: 'X', zip: 1 },
        },
        relationships: {
          'friends.0': { links: { self: './F/1' } },
          pet: { links: { self: './P/1' } },
        },
        meta: { adoptsFrom: authorRef, fields: {}, lastModified: 5 },
        links: { self: cardUrl },
      };
      let sparse = buildSparseItemResource(full, [
        'title',
        'bio.city',
        'friends',
      ]);
      assert.deepEqual(sparse.attributes, {
        title: 'T',
        bio: { city: 'X' },
      });
      assert.deepEqual(Object.keys(sparse.relationships!), ['friends.0']);
      assert.deepEqual(sparse.meta.sparseFields, [
        'title',
        'bio.city',
        'friends',
      ]);
      assert.false('fields' in sparse.meta, 'per-field meta is dropped');
      assert.strictEqual(sparse.meta.lastModified, 5);
      assert.true(isSparseItemResource(sparse));
      assert.false(isSparseItemResource(full));
    });
  });
});
