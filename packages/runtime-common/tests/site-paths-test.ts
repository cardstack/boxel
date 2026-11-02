import { shareFor, type RouteCard } from '../host-routes.ts';
import {
  canonicalPathOf,
  expandPathTemplate,
  matchPathTemplate,
  matchRedirect,
  pageTypeMatchFilter,
  parsePathTemplate,
  readCardVariable,
  resolveSitePath,
  type PathTemplate,
  type SiteSearch,
} from '../site-paths.ts';
import type { SitePageType, SiteRedirect } from '../site-settings.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALM = 'https://realm.example/owner/store/';

function template(source: string): PathTemplate {
  let parsed = parsePathTemplate(source);
  if ('problem' in parsed) {
    throw new Error(parsed.problem);
  }
  return parsed;
}

function pageType(
  index: number,
  name: string,
  path: string,
  extra: Partial<SitePageType> = {},
): SitePageType {
  return {
    index,
    name,
    sourceRealm: REALM,
    cardType: { module: `${REALM}catalog`, name },
    path,
    template: template(path),
    aliasTemplates: [],
    ...extra,
  };
}

function card(
  id: string,
  attributes: Record<string, unknown>,
  linked: Record<string, RouteCard> = {},
): RouteCard {
  return {
    id: `${REALM}${id}`,
    attributes,
    links: Object.fromEntries(
      Object.entries(linked).map(([field, c]) => [field, c.id]),
    ),
    linked,
  };
}

const handTools = card('Category/hand-tools', { slug: 'hand-tools' });
const driver = card(
  'Product/7f3a',
  { slug: 'torque-driver', sku: '5MW55', status: 'active', name: 'Torque' },
  { category: handTools },
);
const kit = card('Bundle/starter', { handle: 'starter-kit' });

// A search over a fixed set of cards, for the resolver's precedence: each
// page type holds its own cards; `eq` compares string forms.
function searchOver(cardsByType: Map<SitePageType, RouteCard[]>): SiteSearch {
  let equals = (c: RouteCard, values: Record<string, string>) =>
    Object.entries(values).every(
      ([variable, value]) => String(readCardVariable(c, variable)) === value,
    );
  return {
    async matches(pageType, values, limit) {
      return (cardsByType.get(pageType) ?? [])
        .filter((c) => equals(c, values))
        .slice(0, limit);
    },
    async routes(pageType, c) {
      return (cardsByType.get(pageType) ?? []).some((x) => x.id === c.id);
    },
  };
}

const tests: SharedTests<unknown> = Object.freeze({
  'parsePathTemplate: reads literals and whole-segment variables': async (
    assert,
  ) => {
    let parsed = template('/c/{category.slug}/{slug}/');
    assert.strictEqual(parsed.source, '/c/{category.slug}/{slug}');
    assert.deepEqual(parsed.segments, [
      { literal: 'c' },
      { variable: 'category.slug' },
      { variable: 'slug' },
    ]);
    assert.deepEqual(template('/').segments, []);
  },

  'parsePathTemplate: refuses what cannot be read back': async (assert) => {
    for (let source of [
      'shop/{handle}',
      '/{slug}.html',
      '/item-{id}',
      '/{+path}',
      '/{/x}',
      '/{?q}',
      '/{x,y}',
      '/{x*}',
      '/{x:3}',
      '/{slug}/{slug}',
      '/a//b',
      '/{bad name}',
    ]) {
      assert.true(
        'problem' in parsePathTemplate(source),
        `${source} is refused`,
      );
    }
  },

  'expandPathTemplate: RFC 6570 simple expansion, one segment per value':
    async (assert) => {
      let t = template('/c/{category.slug}/{slug}');
      assert.strictEqual(
        expandPathTemplate(t, (v) => readCardVariable(driver, v)),
        '/c/hand-tools/torque-driver',
      );
      assert.strictEqual(
        expandPathTemplate(template('/p/{sku}'), () => 'a/b c'),
        '/p/a%2Fb%20c',
        'a slash stays inside its segment',
      );
      assert.strictEqual(
        expandPathTemplate(template('/y/{year}'), () => 2026),
        '/y/2026',
      );
      for (let value of [undefined, null, '', ' ', ['x'], { x: 1 }, NaN]) {
        assert.strictEqual(
          expandPathTemplate(template('/p/{sku}'), () => value),
          undefined,
          `${JSON.stringify(value)} gives no path`,
        );
      }
    },

  'matchPathTemplate: matches by segment, and round-trips an expansion': async (
    assert,
  ) => {
    let t = template('/c/{category.slug}/{slug}');
    assert.deepEqual(matchPathTemplate(t, '/c/hand-tools/torque-driver'), {
      'category.slug': 'hand-tools',
      slug: 'torque-driver',
    });
    assert.strictEqual(matchPathTemplate(t, '/c/hand-tools'), undefined);
    assert.strictEqual(matchPathTemplate(t, '/x/hand-tools/a'), undefined);
    let odd = { sku: 'a/b c ü' };
    let expanded = expandPathTemplate(template('/p/{sku}'), (v) =>
      Reflect.get(odd, v),
    )!;
    assert.deepEqual(matchPathTemplate(template('/p/{sku}'), expanded), odd);
  },

  'pageTypeMatchFilter: variables become eq values, numbers match either spelling':
    async (assert) => {
      let filter = pageTypeMatchFilter(
        { filter: '{"eq": {"status": "active"}}' },
        { slug: 'torque-driver', year: '2026' },
      );
      assert.deepEqual(filter, {
        every: [
          { eq: { status: 'active' } },
          { eq: { slug: 'torque-driver' } },
          { any: [{ eq: { year: '2026' } }, { eq: { year: 2026 } }] },
        ],
      });
      assert.deepEqual(pageTypeMatchFilter({}, { sku: '01234' }), {
        eq: { sku: '01234' },
      });
    },

  'matchRedirect: substitutes template values into the target': async (
    assert,
  ) => {
    let r: SiteRedirect = {
      from: '/products/{handle}',
      to: '/shop/{handle}',
      statusCode: 301,
    };
    assert.strictEqual(matchRedirect(r, '/products/driver'), '/shop/driver');
    assert.strictEqual(matchRedirect(r, '/products'), undefined);
  },

  'resolveSitePath: follows the precedence ladder': async (assert) => {
    let categories = pageType(0, 'Category', '/c/{slug}');
    let products = pageType(1, 'Product', '/c/{category.slug}/{slug}', {
      aliasTemplates: [template('/p/{sku}')],
      listingPath: '/shop',
    });
    let bundles = pageType(2, 'Bundle', '/shop/{handle}');
    let settings = {
      pageTypes: [categories, products, bundles],
      redirects: [
        { from: '/sale', to: '/c/hand-tools', statusCode: 302 as const },
        {
          from: '/item/{sku}',
          to: '/p/{sku}',
          statusCode: 301 as const,
        },
        // A template redirect never hides a live page.
        {
          from: '/c/{slug}',
          to: '/elsewhere',
          statusCode: 301 as const,
        },
      ],
    };
    let search = searchOver(
      new Map([
        [categories, [handTools]],
        [products, [driver]],
        [bundles, [kit]],
      ]),
    );
    let at = (path: string) => resolveSitePath(settings, path, search);

    assert.deepEqual(await at('/sale'), {
      kind: 'redirect',
      to: '/c/hand-tools',
      status: 302,
    });
    assert.strictEqual((await at('/shop')).kind, 'listing');
    let page = await at('/c/hand-tools/torque-driver');
    assert.strictEqual(page.kind === 'page' && page.card.id, driver.id);
    let category = await at('/c/hand-tools');
    assert.strictEqual(
      category.kind === 'page' && category.card.id,
      handTools.id,
    );
    assert.deepEqual(await at('/p/5MW55'), {
      kind: 'redirect',
      to: '/c/hand-tools/torque-driver',
      status: 301,
    });
    assert.deepEqual(await at('/item/5MW55'), {
      kind: 'redirect',
      to: '/p/5MW55',
      status: 301,
    });
    assert.deepEqual(await at('/c/no-such'), {
      kind: 'redirect',
      to: '/elsewhere',
      status: 301,
    });
    let bundle = await at('/shop/starter-kit');
    assert.strictEqual(bundle.kind === 'page' && bundle.card.id, kit.id);
    assert.deepEqual(await at('/shop/no-such/x'), { kind: 'none' });
  },

  'resolveSitePath: a fixed page comes after literal redirects and before listings and templates':
    async (assert) => {
      let products = pageType(0, 'Product', '/shop/{handle}', {
        listingPath: '/shop',
      });
      let search = searchOver(new Map([[products, [kit]]]));
      let settings = {
        pageTypes: [products],
        fixedPages: [
          { path: '/shop', card: 'https://example.com/r/Landing/shop' },
          {
            path: '/shop/starter-kit',
            card: 'https://other.example/r/Promo/kit',
            crossRealm: true,
          },
          { path: '/old', card: 'https://example.com/r/Old/1' },
        ],
        redirects: [{ from: '/old', to: '/shop', statusCode: 301 as const }],
      };
      let at = (path: string) => resolveSitePath(settings, path, search);
      assert.deepEqual(await at('/shop/'), {
        kind: 'fixed',
        card: 'https://example.com/r/Landing/shop',
      });
      assert.deepEqual(await at('/shop/starter-kit'), {
        kind: 'fixed',
        card: 'https://other.example/r/Promo/kit',
        crossRealm: true,
      });
      assert.deepEqual(await at('/old'), {
        kind: 'redirect',
        to: '/shop',
        status: 301,
      });
    },

  'resolveSitePath: a template whose search finds nothing falls through':
    async (assert) => {
      let products = pageType(0, 'Product', '/shop/{handle}');
      let bundles = pageType(1, 'Bundle', '/shop/{handle}');
      let search = searchOver(
        new Map([
          [products, []],
          [bundles, [kit]],
        ]),
      );
      let answer = await resolveSitePath(
        { pageTypes: [products, bundles], redirects: [] },
        '/shop/starter-kit',
        search,
      );
      assert.strictEqual(answer.kind === 'page' && answer.card.id, kit.id);
    },

  'resolveSitePath: an earlier page type that routes the card gives its canonical address':
    async (assert) => {
      let featured = pageType(0, 'Product', '/featured/{slug}');
      let all = pageType(1, 'Product', '/c/{category.slug}/{slug}');
      let search = searchOver(
        new Map([
          [featured, [driver]],
          [all, [driver]],
        ]),
      );
      assert.deepEqual(
        await resolveSitePath(
          { pageTypes: [featured, all], redirects: [] },
          '/c/hand-tools/torque-driver',
          search,
        ),
        { kind: 'redirect', to: '/featured/torque-driver', status: 301 },
      );
    },

  'canonicalPathOf: the first page type that routes the card and has its fields':
    async (assert) => {
      let byMissing = pageType(0, 'Product', '/m/{missing}');
      let products = pageType(1, 'Product', '/c/{category.slug}/{slug}');
      assert.strictEqual(
        canonicalPathOf(
          { pageTypes: [byMissing, products] },
          driver,
          () => true,
        ),
        '/c/hand-tools/torque-driver',
      );
      assert.strictEqual(
        canonicalPathOf({ pageTypes: [products] }, driver, () => false),
        undefined,
      );
    },

  'shareFor: reads share tags from the card, and leaves out what it cannot read':
    async (assert) => {
      let share = shareFor(
        {
          shareTitle: '.name & " driver"',
          shareDescription: '.nothing',
          shareImage: '"not a url"',
        },
        driver,
      );
      assert.deepEqual(share, {
        title: 'Torque driver',
        description: undefined,
        image: undefined,
      });
      assert.strictEqual(shareFor({}, driver), undefined);
    },
});

export default tests;
