import {
  projectHostRoutes,
  routedPathForCard,
  routeSnapshot,
  type HostRouteRow,
  type RouteCard,
} from '../host-routes.ts';
import type { SitePageType } from '../site-settings.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALM = 'https://realm.example/owner/store/';

function pageType(
  index: number,
  name: string,
  href: string,
  extra: Partial<SitePageType> = {},
): SitePageType {
  return {
    index,
    name,
    sourceRealm: REALM,
    cardType: { module: `${REALM}product`, name },
    href,
    aliases: [],
    ...extra,
  };
}

const products = pageType(0, 'Product', '"/shop/" & .handle', {
  aliases: ['/p/sku-\\(.sku)'],
  listingPath: '/shop',
});
const bundles = pageType(1, 'Bundle', '/shop/\\(.handle)');
const journal = pageType(
  2,
  'JournalPost',
  '/journal/\\(.publishedOn[0:4])/\\(.slug)',
  {
    where: '(.featured or .wordCount >= 300) and .audience != "members"',
  },
);

const card = (id: string, attributes: Record<string, unknown>): RouteCard => ({
  id: `${REALM}${id}`,
  attributes,
});

const driver = card('Product/driver', {
  handle: 'linksland-driver',
  sku: 'LD1',
});
const tees = card('Product/tees', { handle: 'birch-tees', sku: 'BT' });
const teesBundle = card('Bundle/tees', { handle: 'birch-tees' });

function rowsByPath(rows: HostRouteRow[]): Record<string, HostRouteRow> {
  return Object.fromEntries(rows.map((row) => [row.path, row]));
}

const tests: SharedTests<unknown> = Object.freeze({
  'projectHostRoutes: hrefs in either syntax give each card a path': async (
    assert,
  ) => {
    let { rows, problems } = projectHostRoutes(
      { pageTypes: [products, bundles] },
      new Map([
        [0, [driver]],
        [1, [card('Bundle/kit', { handle: 'starter-kit' })]],
      ]),
      [],
      1000,
    );
    assert.deepEqual(problems, []);
    let byPath = rowsByPath(rows);
    assert.strictEqual(byPath['/shop/linksland-driver']?.kind, 'page');
    assert.strictEqual(byPath['/shop/linksland-driver']?.cardURL, driver.id);
    assert.strictEqual(byPath['/shop/starter-kit']?.kind, 'page');
    assert.strictEqual(byPath['/shop']?.kind, 'listing');
  },

  'projectHostRoutes: an alias answers for its card at the card path': async (
    assert,
  ) => {
    let { rows } = projectHostRoutes(
      { pageTypes: [products] },
      new Map([[0, [driver]]]),
      [],
      1000,
    );
    let alias = rows.find((row) => row.path === '/p/sku-LD1');
    assert.strictEqual(alias?.kind, 'alias');
    assert.strictEqual(alias?.targetPath, '/shop/linksland-driver');
  },

  'projectHostRoutes: where keeps cards a filter cannot exclude off the site':
    async (assert) => {
      let { rows } = projectHostRoutes(
        { pageTypes: [journal] },
        new Map([
          [
            2,
            [
              card('Post/greens', {
                publishedOn: '2026-04-12',
                slug: 'reading-fast-greens',
                featured: true,
                wordCount: 900,
                audience: 'everyone',
              }),
              card('Post/members', {
                publishedOn: '2026-05-01',
                slug: 'fitting',
                featured: true,
                wordCount: 600,
                audience: 'members',
              }),
              card('Post/short', {
                publishedOn: '2026-01-02',
                slug: 'tee-height',
                featured: false,
                wordCount: 180,
                audience: 'everyone',
              }),
            ],
          ],
        ]),
        [],
        1000,
      );
      assert.deepEqual(
        rows.map((row) => row.path),
        ['/journal/2026/reading-fast-greens'],
      );
    },

  'projectHostRoutes: a contested path goes to the earlier page type, and the loser is reported':
    async (assert) => {
      let { rows, problems } = projectHostRoutes(
        { pageTypes: [products, bundles] },
        new Map([
          [0, [tees]],
          [1, [teesBundle]],
        ]),
        [],
        1000,
      );
      assert.strictEqual(
        rowsByPath(rows)['/shop/birch-tees']?.cardURL,
        tees.id,
      );
      assert.strictEqual(problems.length, 1);
      assert.true(problems[0].includes(teesBundle.id));
    },

  'projectHostRoutes: the older claim keeps a path, whatever the page type order':
    async (assert) => {
      let first = projectHostRoutes(
        { pageTypes: [products, bundles] },
        new Map([[1, [teesBundle]]]),
        [],
        1000,
      );
      let second = projectHostRoutes(
        { pageTypes: [products, bundles] },
        new Map([
          [0, [tees]],
          [1, [teesBundle]],
        ]),
        first.rows,
        2000,
      );
      let row = rowsByPath(second.rows)['/shop/birch-tees'];
      assert.strictEqual(row?.cardURL, teesBundle.id);
      assert.strictEqual(row?.claimedAt, 1000);
    },

  'projectHostRoutes: a page that is no longer served is gone, until it is claimed again':
    async (assert) => {
      let first = projectHostRoutes(
        { pageTypes: [products] },
        new Map([[0, [driver]]]),
        [],
        1000,
      );
      let second = projectHostRoutes(
        { pageTypes: [products] },
        new Map([[0, []]]),
        first.rows,
        2000,
      );
      let gone = rowsByPath(second.rows)['/shop/linksland-driver'];
      assert.strictEqual(gone?.kind, 'gone');
      assert.strictEqual(gone?.cardURL, driver.id);
      assert.strictEqual(
        rowsByPath(second.rows)['/p/sku-LD1'],
        undefined,
        'an alias goes with its page',
      );
      let third = projectHostRoutes(
        { pageTypes: [products] },
        new Map([[0, [driver]]]),
        second.rows,
        3000,
      );
      assert.strictEqual(
        rowsByPath(third.rows)['/shop/linksland-driver']?.kind,
        'page',
      );
    },

  'projectHostRoutes: an href outside the route profile is refused': async (
    assert,
  ) => {
    let { rows, problems } = projectHostRoutes(
      {
        pageTypes: [
          pageType(0, 'Product', '"/x/" & now()'),
          pageType(1, 'Bundle', '"/y/\\(.handle | test("a"))"'),
        ],
      },
      new Map([
        [0, [driver]],
        [1, [teesBundle]],
      ]),
      [],
      1000,
    );
    assert.deepEqual(rows, []);
    assert.strictEqual(problems.length, 2);
  },

  'projectHostRoutes: an href that gives no usable path is reported': async (
    assert,
  ) => {
    let { rows, problems } = projectHostRoutes(
      { pageTypes: [pageType(0, 'Product', '.handle')] },
      new Map([[0, [driver, card('Product/blank', {})]]]),
      [],
      1000,
    );
    assert.deepEqual(rows, []);
    assert.strictEqual(problems.length, 2);
  },

  'projectHostRoutes: a card without the field its href reads gets no path':
    async (assert) => {
      let { rows, problems } = projectHostRoutes(
        { pageTypes: [products] },
        new Map([[0, [driver, card('Product/nameless', { sku: 'X' })]]]),
        [],
        1000,
      );
      assert.false(
        rows.some((row) => row.path.includes('null')),
        'no path is made from a missing field',
      );
      assert.true(
        problems.some((p) => p.includes('Product/nameless')),
        problems.join('\n'),
      );
    },

  'routedPathForCard: a card is found at its page, never at an alias': async (
    assert,
  ) => {
    let rows: HostRouteRow[] = [
      {
        path: '/p/sku-1',
        kind: 'alias',
        cardURL: `${REALM}Product/driver`,
        targetPath: '/shop/driver',
        claimedAt: 1,
      },
      {
        path: '/shop/driver',
        kind: 'page',
        cardURL: `${REALM}Product/driver`,
        claimedAt: 1,
      },
    ];
    assert.strictEqual(
      routedPathForCard(rows, `${REALM}Product/driver.json`),
      '/shop/driver',
    );
    assert.strictEqual(
      routedPathForCard(rows, `${REALM}Product/putter`),
      undefined,
    );
  },

  'routeSnapshot: rows by kind, and incomplete past the cap': async (
    assert,
  ) => {
    let rows: HostRouteRow[] = [
      { path: '/shop', kind: 'listing', claimedAt: 1 },
      {
        path: '/shop/driver',
        kind: 'page',
        cardURL: `${REALM}Product/driver`,
        claimedAt: 1,
      },
      {
        path: '/p/sku-1',
        kind: 'alias',
        cardURL: `${REALM}Product/driver`,
        targetPath: '/shop/driver',
        claimedAt: 1,
      },
      { path: '/shop/old', kind: 'gone', claimedAt: 1 },
    ];
    let snapshot = routeSnapshot(rows, REALM, '/owner/store/');
    assert.deepEqual(snapshot, {
      realm: REALM,
      mount: '/owner/store/',
      pages: [['/shop/driver', `${REALM}Product/driver`]],
      aliases: [['/p/sku-1', '/shop/driver']],
      gone: ['/shop/old'],
      listings: ['/shop'],
      complete: true,
    });
    assert.false(
      routeSnapshot(rows, REALM, '/owner/store/', { max: 2 }).complete,
    );
  },
});

export default tests;
