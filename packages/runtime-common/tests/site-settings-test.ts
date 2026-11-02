import { MAX_SITE_PAGE_TYPES, readSiteSettings } from '../site-settings.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALM = 'https://realm.example/owner/site';

const pageType = (overrides: Record<string, unknown> = {}) => ({
  name: 'Products',
  cardType: { module: './product', name: 'Product' },
  path: '/shop/{handle}',
  ...overrides,
});

const tests: SharedTests<unknown> = Object.freeze({
  'readSiteSettings: an absent site reads as defaults with no problems': async (
    assert,
  ) => {
    let settings = readSiteSettings(undefined, REALM);
    assert.strictEqual(settings.language, 'en');
    assert.true(settings.listed);
    assert.deepEqual(settings.pageTypes, []);
    assert.deepEqual(settings.redirects, []);
    assert.strictEqual(settings.notFound, undefined);
    assert.deepEqual(settings.problems, []);
  },

  'readSiteSettings: a page type resolves its module and source realm against the realm':
    async (assert) => {
      let { pageTypes, problems } = readSiteSettings(
        { pageTypes: [pageType({ aliases: ['/p/{sku}', ' '] })] },
        REALM,
      );
      assert.deepEqual(problems, []);
      assert.strictEqual(pageTypes.length, 1);
      assert.strictEqual(pageTypes[0].index, 0);
      assert.strictEqual(pageTypes[0].sourceRealm, `${REALM}/`);
      assert.deepEqual(pageTypes[0].cardType, {
        module: `${REALM}/product`,
        name: 'Product',
      });
      assert.strictEqual(pageTypes[0].template?.source, '/shop/{handle}');
      assert.deepEqual(
        pageTypes[0].aliasTemplates.map((t) => t.source),
        ['/p/{sku}'],
        'blank aliases are dropped',
      );
    },

  'readSiteSettings: a card type reads from the search doc string form too':
    async (assert) => {
      let { pageTypes, problems } = readSiteSettings(
        {
          pageTypes: [
            pageType({
              cardType: 'https://realm.example/owner/store/product/Product',
            }),
          ],
        },
        REALM,
      );
      assert.deepEqual(problems, []);
      assert.deepEqual(pageTypes[0].cardType, {
        module: 'https://realm.example/owner/store/product',
        name: 'Product',
      });
    },

  'readSiteSettings: a page type with no valid path is kept without one and reported':
    async (assert) => {
      let { pageTypes, problems } = readSiteSettings(
        {
          pageTypes: [
            pageType({ name: 'Blank', path: '' }),
            pageType({ name: 'Partial', path: '/shop/item-{id}' }),
            pageType({ name: 'Alias', aliases: ['/p/{sku:3}'] }),
          ],
        },
        REALM,
      );
      assert.deepEqual(
        pageTypes.map((t) => [t.name, t.template?.source]),
        [
          ['Blank', undefined],
          ['Partial', undefined],
          ['Alias', '/shop/{handle}'],
        ],
      );
      assert.deepEqual(pageTypes[2].aliasTemplates, []);
      assert.strictEqual(problems.length, 3, problems.join('\n'));
      assert.true(problems[0].includes('no path template'));
      assert.true(problems[1].includes('whole segment'));
    },

  'readSiteSettings: an invalid page type is dropped and reported, the rest kept':
    async (assert) => {
      let { pageTypes, problems } = readSiteSettings(
        {
          pageTypes: [
            pageType({ name: 'Journal', cardType: { module: './post' } }),
            pageType({ name: 'Brands', filter: 'not json' }),
            pageType({ name: 'Bags', sourceRealm: 'ftp://elsewhere/' }),
            pageType({ name: 'Kept' }),
          ],
        },
        REALM,
      );
      assert.deepEqual(
        pageTypes.map((t) => t.name),
        ['Kept'],
      );
      assert.strictEqual(problems.length, 3, problems.join('\n'));
      assert.true(problems[0].includes('no card type'));
      assert.true(problems[1].includes('filter is not a JSON object'));
      assert.true(problems[2].includes('not an http(s) URL'));
    },

  'readSiteSettings: a bad listing is dropped but the page type kept': async (
    assert,
  ) => {
    let { pageTypes, problems } = readSiteSettings(
      {
        pageTypes: [
          pageType({ listingPath: 'shop', listingSort: '{"by":"name"}' }),
        ],
      },
      REALM,
    );
    assert.strictEqual(pageTypes.length, 1);
    assert.strictEqual(pageTypes[0].listingPath, undefined);
    assert.strictEqual(pageTypes[0].listingSort, undefined);
    assert.strictEqual(problems.length, 2, problems.join('\n'));
  },

  'readSiteSettings: a page type keeps a sort array and drops one that is not':
    async (assert) => {
      let { pageTypes, problems } = readSiteSettings(
        {
          pageTypes: [
            pageType({ sort: '[{"by": "publishedOn", "direction": "desc"}]' }),
            pageType({ name: 'Bad', sort: '{"by": "name"}' }),
          ],
        },
        REALM,
      );
      assert.strictEqual(
        pageTypes[0].sort,
        '[{"by": "publishedOn", "direction": "desc"}]',
      );
      assert.strictEqual(pageTypes[1].sort, undefined);
      assert.strictEqual(problems.length, 1, problems.join('\n'));
      assert.true(problems[0].includes('sort is not a JSON array'));
    },

  'readSiteSettings: page types past the cap are dropped and reported': async (
    assert,
  ) => {
    let many = Array.from({ length: MAX_SITE_PAGE_TYPES + 3 }, (_, i) =>
      pageType({ name: `Type ${i}` }),
    );
    let { pageTypes, problems } = readSiteSettings({ pageTypes: many }, REALM);
    assert.strictEqual(pageTypes.length, MAX_SITE_PAGE_TYPES);
    assert.true(problems[0].includes('3 dropped'));
  },

  'readSiteSettings: redirects keep template variables and default to 301':
    async (assert) => {
      let { redirects, problems } = readSiteSettings(
        {
          redirects: [
            { from: '/old/{slug}/', to: '/new/{slug}' },
            {
              from: '/blog',
              to: 'https://elsewhere.example/',
              statusCode: 302,
            },
          ],
        },
        REALM,
      );
      assert.deepEqual(problems, []);
      assert.deepEqual(redirects, [
        { from: '/old/{slug}', to: '/new/{slug}', statusCode: 301 },
        { from: '/blog', to: 'https://elsewhere.example/', statusCode: 302 },
      ]);
    },

  'readSiteSettings: a redirect whose target uses a name its source lacks is dropped':
    async (assert) => {
      let { redirects, problems } = readSiteSettings(
        {
          redirects: [
            { from: '/old/{slug}', to: '/new/{id}' },
            { from: '/a', to: 'javascript:alert(1)' },
            { from: '/b', to: '/c', statusCode: 307 },
            { from: '/d/x{y}', to: '/e' },
          ],
        },
        REALM,
      );
      assert.deepEqual(redirects, []);
      assert.strictEqual(problems.length, 4, problems.join('\n'));
      assert.true(problems[0].includes('{id}'));
    },

  'readSiteSettings: reads the not-found card, crawlers and defaults': async (
    assert,
  ) => {
    let settings = readSiteSettings(
      {
        tagline: ' Kit for the first group out. ',
        language: 'en-GB',
        listed: false,
        notFound: { id: `${REALM}/NotFoundPage/main` },
        crawlers: [
          { userAgent: 'GPTBot', allow: false },
          { userAgent: '' },
          { userAgent: 'Googlebot' },
        ],
      },
      REALM,
    );
    assert.strictEqual(settings.tagline, 'Kit for the first group out.');
    assert.strictEqual(settings.language, 'en-GB');
    assert.false(settings.listed);
    assert.strictEqual(settings.notFound, `${REALM}/NotFoundPage/main`);
    assert.deepEqual(settings.crawlers, [
      { userAgent: 'GPTBot', allow: false },
      { userAgent: 'Googlebot', allow: true },
    ]);
    assert.strictEqual(settings.problems.length, 1);
  },

  'readSiteSettings: reads the frame card, and reports one that is not a card id':
    async (assert) => {
      let settings = readSiteSettings(
        { frame: { id: `${REALM}/StoreFrame/main` } },
        REALM,
      );
      assert.strictEqual(settings.frame, `${REALM}/StoreFrame/main`);
      assert.strictEqual(settings.problems.length, 0);
      let bad = readSiteSettings({ frame: { id: 'not a url' } }, REALM);
      assert.strictEqual(bad.frame, undefined);
      assert.strictEqual(bad.problems.length, 1);
    },
  'readSiteSettings: reads the error card, and reports one that is not a card id':
    async (assert) => {
      let settings = readSiteSettings(
        { errorCard: { id: `${REALM}/ErrorPage/main` } },
        REALM,
      );
      assert.strictEqual(settings.errorCard, `${REALM}/ErrorPage/main`);
      assert.strictEqual(settings.problems.length, 0);
      let bad = readSiteSettings({ errorCard: { id: 'not a url' } }, REALM);
      assert.strictEqual(bad.errorCard, undefined);
      assert.deepEqual(bad.problems, [
        'the error card "not a url" is not a card id',
      ]);
    },
});

export default tests;
