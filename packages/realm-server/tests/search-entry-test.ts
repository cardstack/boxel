import { module, test } from 'qunit';
import { basename } from 'path';
import {
  buildHtmlResource,
  buildSearchEntryResource,
  buildSparseItemResource,
  htmlResourceId,
  cssResourceId,
  htmlQueryHasRenderTypePredicate,
  htmlQueryMatches,
  isHtmlResource,
  isSearchEntryResource,
  isSparseItemResource,
  parseSearchEntryQueryFromPayload,
  resolveHtmlQuery,
  SearchRequestError,
  DEFAULT_HTML_QUERY,
  rri,
  type CardResource,
  type HtmlQuery,
  type RenderingCandidate,
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

// Evaluate an htmlQuery against a rendering universe, returning the selected
// candidates (in universe order).
function select(
  query: HtmlQuery,
  universe: RenderingCandidate[],
): RenderingCandidate[] {
  let resolved = resolveHtmlQuery(
    query,
    (ref) =>
      `${(ref as ResolvedCodeRef).module}/${(ref as ResolvedCodeRef).name}`,
  );
  return universe.filter((candidate) => htmlQueryMatches(resolved, candidate));
}

const authorKey = `${authorRef.module}/${authorRef.name}`;
const baseKey = `${baseRef.module}/${baseRef.name}`;

// A representative rendering universe: two render types across two keyed
// formats, a scalar-format rendering, and a file-style candidate that
// carries no renderType.
const universe: RenderingCandidate[] = [
  { format: 'fitted', renderTypeKey: authorKey },
  { format: 'fitted', renderTypeKey: baseKey },
  { format: 'embedded', renderTypeKey: authorKey },
  { format: 'embedded', renderTypeKey: baseKey },
  { format: 'atom', renderTypeKey: authorKey },
  { format: 'head' },
];

module(basename(__filename), function () {
  module('search-entry query parser', function () {
    test('translates the canonical search-entry query', function (assert) {
      let htmlQuery: HtmlQuery = {
        every: [
          { eq: { format: 'embedded' } },
          { eq: { renderType: baseRef } },
        ],
      };
      let parsed = parseSearchEntryQueryFromPayload({
        filter: {
          'item.on': authorRef,
          eq: {
            'item.status': 'ready',
            htmlQuery,
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
      assert.deepEqual(parsed.htmlQuery, htmlQuery);
      assert.deepEqual(parsed.fieldset, {
        html: true,
        item: { kind: 'none' },
        itemAsFallback: false,
      });
      assert.deepEqual(parsed.realms, ['http://localhost:4201/test/']);
    });

    test('defaults: no htmlQuery → fitted; no fields → html with item fallback', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({});
      assert.deepEqual(parsed.itemQuery, {} as any);
      assert.deepEqual(parsed.htmlQuery, DEFAULT_HTML_QUERY);
      assert.deepEqual(parsed.htmlQuery, { eq: { format: 'fitted' } });
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

    test('an eq that carried only the htmlQuery binding dissolves', function (assert) {
      let parsed = parseSearchEntryQueryFromPayload({
        filter: { eq: { htmlQuery: { eq: { format: 'atom' } } } },
      });
      assert.deepEqual(parsed.itemQuery, {} as any);
      assert.deepEqual(parsed.htmlQuery, { eq: { format: 'atom' } });
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

    test('htmlQuery binds exactly once, in the top-level eq', function (assert) {
      assert.strictEqual(
        parseError({
          filter: {
            any: [{ eq: { htmlQuery: { eq: { format: 'atom' } } } }],
          },
        }).code,
        'invalid-render',
        'binding in a nested node is rejected',
      );
      assert.strictEqual(
        parseError({
          filter: {
            not: { eq: { htmlQuery: { eq: { format: 'atom' } } } },
          },
        }).code,
        'invalid-render',
        'binding under not is rejected',
      );
      assert.strictEqual(
        parseError({
          filter: {
            contains: { htmlQuery: { eq: { format: 'atom' } } },
          },
        }).code,
        'invalid-render',
        'binding through another operator is rejected',
      );
      assert.strictEqual(
        parseError({
          filter: { htmlQuery: { eq: { format: 'atom' } } },
        }).code,
        'invalid-render',
        'htmlQuery is a field — it binds with eq, not as a filter member',
      );
    });

    test('rejects malformed htmlQuery values', function (assert) {
      assert.strictEqual(
        parseError({ filter: { eq: { htmlQuery: {} } } }).code,
        'invalid-render',
        'a node must have exactly one of eq/every/any/not',
      );
      assert.strictEqual(
        parseError({ filter: { eq: { htmlQuery: { eq: {} } } } }).code,
        'invalid-render',
        'an unconstrained leaf is unsupported',
      );
      assert.strictEqual(
        parseError({ filter: { eq: { htmlQuery: { every: [] } } } }).code,
        'invalid-render',
        'an empty connective is unsupported',
      );
      assert.strictEqual(
        parseError({
          filter: { eq: { htmlQuery: { eq: { format: 'bogus' } } } },
        }).code,
        'invalid-render',
        'invalid format value',
      );
      assert.strictEqual(
        parseError({
          filter: { eq: { htmlQuery: { eq: { renderType: 'Author' } } } },
        }).code,
        'invalid-render',
        'renderType must be a CodeRef',
      );
      assert.strictEqual(
        parseError({
          filter: { eq: { htmlQuery: { eq: { color: 'red' } } } },
        }).code,
        'invalid-render',
        'unknown rendering dimension',
      );
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

  module('htmlQuery evaluation', function () {
    test('eq selects by format and renderType, conjoined within a leaf', function (assert) {
      assert.deepEqual(select({ eq: { format: 'fitted' } }, universe), [
        { format: 'fitted', renderTypeKey: authorKey },
        { format: 'fitted', renderTypeKey: baseKey },
      ]);
      assert.deepEqual(select({ eq: { renderType: baseRef } }, universe), [
        { format: 'fitted', renderTypeKey: baseKey },
        { format: 'embedded', renderTypeKey: baseKey },
      ]);
      assert.deepEqual(
        select({ eq: { format: 'embedded', renderType: authorRef } }, universe),
        [{ format: 'embedded', renderTypeKey: authorKey }],
      );
    });

    test('every and any compose', function (assert) {
      assert.deepEqual(
        select(
          {
            every: [
              { eq: { format: 'embedded' } },
              { eq: { renderType: baseRef } },
            ],
          },
          universe,
        ),
        [{ format: 'embedded', renderTypeKey: baseKey }],
      );
      assert.deepEqual(
        select(
          {
            any: [{ eq: { format: 'atom' } }, { eq: { format: 'head' } }],
          },
          universe,
        ),
        [{ format: 'atom', renderTypeKey: authorKey }, { format: 'head' }],
      );
    });

    test('a renderType predicate never matches a rendering with no renderType', function (assert) {
      // the file-style candidate (no renderTypeKey) is unmatchable by a
      // positive renderType predicate...
      assert.false(
        select({ eq: { renderType: authorRef } }, universe).some(
          (candidate) => candidate.renderTypeKey === undefined,
        ),
      );
      // ...and IS matched by its negation (the complement)
      assert.true(
        select({ not: { eq: { renderType: authorRef } } }, universe).some(
          (candidate) => candidate.renderTypeKey === undefined,
        ),
      );
    });

    test('involution: not(not(q)) selects exactly what q selects', function (assert) {
      let queries: HtmlQuery[] = [
        { eq: { format: 'fitted' } },
        { eq: { renderType: authorRef } },
        { eq: { format: 'embedded', renderType: baseRef } },
        {
          any: [{ eq: { format: 'atom' } }, { eq: { renderType: baseRef } }],
        },
        {
          every: [
            { eq: { format: 'embedded' } },
            { not: { eq: { renderType: authorRef } } },
          ],
        },
      ];
      for (let q of queries) {
        assert.deepEqual(
          select({ not: { not: q } }, universe),
          select(q, universe),
          `not(not(q)) ≡ q for ${JSON.stringify(q)}`,
        );
      }
    });

    test('complement: not(q) selects exactly the universe minus q', function (assert) {
      let q: HtmlQuery = { eq: { format: 'fitted' } };
      let selected = select(q, universe);
      let complement = select({ not: q }, universe);
      assert.deepEqual(
        [...selected, ...complement].length,
        universe.length,
        'q and not(q) partition the universe',
      );
      for (let candidate of universe) {
        assert.strictEqual(
          complement.includes(candidate),
          !selected.includes(candidate),
          `candidate ${JSON.stringify(candidate)} is in exactly one side`,
        );
      }
    });

    test('htmlQueryHasRenderTypePredicate sees through connectives and negation', function (assert) {
      assert.false(
        htmlQueryHasRenderTypePredicate({ eq: { format: 'fitted' } }),
      );
      assert.true(
        htmlQueryHasRenderTypePredicate({ eq: { renderType: authorRef } }),
      );
      assert.true(
        htmlQueryHasRenderTypePredicate({
          not: { eq: { renderType: authorRef } },
        }),
      );
      assert.true(
        htmlQueryHasRenderTypePredicate({
          any: [
            { eq: { format: 'fitted' } },
            { every: [{ eq: { renderType: baseRef } }] },
          ],
        }),
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
        htmlIds: [htmlId],
        itemType: 'card',
      });
      assert.deepEqual(both, {
        type: 'search-entry',
        id: cardUrl,
        relationships: {
          html: { data: [{ type: 'html', id: htmlId }] },
          item: { data: { type: 'card', id: cardUrl } },
        },
      });
      assert.true(isSearchEntryResource(both));

      // a pinned html branch with no matching rendering: empty array
      let empty = buildSearchEntryResource({ url: cardUrl, htmlIds: [] });
      assert.deepEqual(empty.relationships.html, { data: [] });
      assert.true(isSearchEntryResource(empty));

      // the default mode's fallback rows omit the relationship entirely
      let itemOnly = buildSearchEntryResource({
        url: cardUrl,
        itemType: 'card',
      });
      assert.deepEqual(Object.keys(itemOnly.relationships), ['item']);
      assert.true(isSearchEntryResource(itemOnly));
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
