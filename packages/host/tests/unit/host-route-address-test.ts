import { module, test } from 'qunit';

import {
  Loader,
  VirtualNetwork,
  baseRealm,
  fetcher,
  maybeHandleScopedCSSRequest,
  rri,
  hostRouteAddress,
  matchRoutePathPattern,
  validateHostRoutes,
  type CardAPIForMatching,
  type HostRoute,
  type HostRouteAddressResult,
  type HostRouteAddressTarget,
  type HostRouteTypeInfo,
  type RawHostRoutingRule,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import ENV from '@cardstack/host/config/environment';
import { shimExternals } from '@cardstack/host/lib/externals';

import { testRealmURL } from '../helpers';

import { tagTestModuleExports } from '../helpers/identity-tags';

import type { BaseDef, CardDef } from '@cardstack/base/card-api';

let { resolvedBaseRealmURL } = ENV;

// Field-match routes read loaded cards: the type and `where` checks run
// through `matchInstanceAgainstFilter`, and the segments come from the
// cards' fields. Card id templates, fixed routes, names and the encoding are
// covered by the shared `host-route-address` tests in runtime-common.
module('Unit | host-route-address', function (hooks) {
  let api: CardAPIForMatching;
  let realmURL = new URL(testRealmURL);
  let classes: Record<string, typeof CardDef> = {};
  let typeInfo: Record<string, HostRouteTypeInfo> = {};

  function ref(name: string): ResolvedCodeRef {
    return {
      module: rri(`${testRealmURL}${name.toLowerCase()}`),
      name,
    } as ResolvedCodeRef;
  }

  function routes(rules: RawHostRoutingRule[]): readonly HostRoute[] {
    let { routes, warnings } = validateHostRoutes(rules, {
      realmURL,
      lookupType: (type) => typeInfo[type.name],
    });
    let dropped = warnings.filter((w) => w.dropped);
    if (dropped.length > 0) {
      throw new Error(dropped.map((w) => w.message).join('; '));
    }
    return routes;
  }

  function lookup(
    rules: RawHostRoutingRule[],
    target: HostRouteAddressTarget,
  ): HostRouteAddressResult {
    return hostRouteAddress(target, {
      routes: routes(rules),
      realmURL,
      api,
    });
  }

  function outcome(result: HostRouteAddressResult) {
    return result.ok
      ? { address: result.address, route: result.route.fullPath }
      : { reason: result.reason, route: result.route?.fullPath };
  }

  function make(
    name: string,
    local: string,
    values: Record<string, unknown>,
  ): CardDef {
    let card = new classes[name]!(values);
    card.id = rri(`${testRealmURL}${local}`);
    return card;
  }

  hooks.beforeEach(async function () {
    let virtualNetwork = new VirtualNetwork();
    virtualNetwork.addURLMapping(
      new URL(baseRealm.url),
      new URL(resolvedBaseRealmURL),
    );
    virtualNetwork.addRealmMapping('@cardstack/base/', resolvedBaseRealmURL);
    virtualNetwork.addImportMap('@cardstack/boxel-icons/', (rest) => {
      return `${ENV.iconsURL}/@cardstack/boxel-icons/v1/icons/${rest}.js`;
    });
    shimExternals(virtualNetwork);
    let fetch = fetcher(virtualNetwork.fetch, [
      async (req, next) => {
        return (await maybeHandleScopedCSSRequest(req)) || next(req);
      },
    ]);
    let loader = new Loader(fetch, virtualNetwork.resolveImport, {
      virtualNetwork,
    });

    let cardApi = await loader.import<
      typeof import('@cardstack/base/card-api')
    >('@cardstack/base/card-api');
    let string = await loader.import<any>('@cardstack/base/string');
    let number = await loader.import<any>('@cardstack/base/number');

    api = {
      getQueryableValue: cardApi.getQueryableValue,
      formatQueryValue: cardApi.formatQueryValue,
      peekAtField: cardApi.peekAtField,
      isQueryTaintedField: cardApi.isQueryTaintedField,
      isNonPresentLink: cardApi.isNonPresentLink,
      getCardMeta: cardApi.getCardMeta as CardAPIForMatching['getCardMeta'],
      primitive: cardApi.primitive,
      virtualNetwork,
    };

    let { field, contains, linksTo, linksToMany, CardDef } = cardApi;
    let { default: StringField } = string;
    let { default: NumberField } = number;

    class Post extends CardDef {
      @field slug = contains(StringField);
      @field status = contains(StringField);
      @field number = contains(NumberField);
    }
    class Tag extends CardDef {
      @field name = contains(StringField);
    }
    class FancyTag extends Tag {
      @field color = contains(StringField);
    }
    class Category extends CardDef {
      @field slug = contains(StringField);
    }
    class Product extends CardDef {
      @field slug = contains(StringField);
      @field category = linksTo(() => Category);
    }
    class Item extends CardDef {
      @field slug = contains(StringField);
    }
    class Shelf extends CardDef {
      @field slug = contains(StringField);
      @field items = linksToMany(() => Item);
    }

    classes = { Post, Tag, FancyTag, Category, Product, Item, Shelf };
    for (let [name, klass] of Object.entries(classes)) {
      tagTestModuleExports(`${testRealmURL}${name.toLowerCase()}`, {
        [name]: klass,
      });
    }

    let key = (name: string) => `${testRealmURL}${name.toLowerCase()}/${name}`;
    let info = (
      name: string,
      fields: HostRouteTypeInfo['fields'],
    ): HostRouteTypeInfo => ({
      key: key(name),
      types: [key(name)],
      isCardType: true,
      fields,
    });
    let contained = { type: 'contains' as const };
    typeInfo = {
      Post: info('Post', {
        slug: contained,
        status: contained,
        number: contained,
      }),
      Tag: info('Tag', { name: contained }),
      Category: info('Category', { slug: contained }),
      Product: info('Product', {
        slug: contained,
        category: { type: 'linksTo', target: key('Category') },
      }),
      Item: info('Item', { slug: contained }),
      Shelf: info('Shelf', {
        slug: contained,
        items: { type: 'linksToMany', target: key('Item') },
      }),
    };
  });

  const POSTS = (): RawHostRoutingRule[] => [
    {
      path: '/posts/:slug',
      type: ref('Post'),
      where: { eq: { status: 'published' } },
      match: { slug: ':slug' },
    },
  ];

  test('a field match reads the segment from the card', function (assert) {
    let post = make('Post', 'Post/1', {
      slug: 'hello-world',
      status: 'published',
    });
    assert.deepEqual(
      outcome(lookup(POSTS(), { kind: 'cards', cards: [post] })),
      { address: '/posts/hello-world', route: '/posts/:slug' },
    );

    let numbered: RawHostRoutingRule[] = [
      { path: '/n/:number', type: ref('Post'), match: { number: ':number' } },
    ];
    assert.deepEqual(
      outcome(
        lookup(numbered, {
          kind: 'cards',
          cards: [make('Post', 'Post/2', { number: 42 })],
        }),
      ),
      { address: '/n/42', route: '/n/:number' },
      'a number field',
    );
  });

  test('a field match checks the type and the where', function (assert) {
    let draft = make('Post', 'Post/1', { slug: 'draft', status: 'draft' });
    assert.deepEqual(
      outcome(lookup(POSTS(), { kind: 'cards', cards: [draft] })),
      { reason: 'where-not-matched', route: '/posts/:slug' },
    );
    let tag = make('Tag', 'Tag/1', { name: 'crag' });
    assert.deepEqual(
      outcome(lookup(POSTS(), { kind: 'cards', cards: [tag] })),
      { reason: 'no-route', route: undefined },
      'a card of another type',
    );
  });

  test('a field value that is not a valid segment gives no address', function (assert) {
    for (let slug of [undefined, '', '.', '..']) {
      let post = make('Post', 'Post/1', { slug, status: 'published' });
      assert.deepEqual(
        outcome(lookup(POSTS(), { kind: 'cards', cards: [post] })),
        { reason: 'invalid-segment-value', route: '/posts/:slug' },
        `slug ${JSON.stringify(slug)}`,
      );
    }
  });

  test('a field match round-trips through the encoding', function (assert) {
    let [route] = routes(POSTS());
    for (let slug of ['über café', '日本語', 'a/b?c#d', "it's+(1),2;3=4"]) {
      let post = make('Post', 'Post/1', { slug, status: 'published' });
      let result = lookup(POSTS(), { kind: 'cards', cards: [post] });
      if (!result.ok) {
        assert.ok(false, `no address for ${slug}: ${result.reason}`);
        continue;
      }
      assert.deepEqual(
        matchRoutePathPattern(route!.pattern!, result.address),
        { slug },
        `${slug} round-trips through ${result.address}`,
      );
    }
  });

  test('a field match with only an id has no address until the card loads', function (assert) {
    assert.deepEqual(
      outcome(
        lookup(POSTS(), {
          kind: 'cards',
          cards: [`${testRealmURL}Post/1`],
        }),
      ),
      { reason: 'card-not-loaded', route: '/posts/:slug' },
    );
  });

  test('a 301 alias is never canonical for a field match', function (assert) {
    let rules: RawHostRoutingRule[] = [
      {
        path: '/old/:slug',
        type: ref('Post'),
        match: { slug: ':slug' },
        statusCode: 301,
      },
      { path: '/drafts/:slug', type: ref('Post'), match: { slug: ':slug' } },
      ...POSTS(),
    ];
    let post = make('Post', 'Post/1', { slug: 'hi', status: 'published' });
    assert.deepEqual(
      outcome(lookup(rules, { kind: 'cards', cards: [post] })),
      { address: '/drafts/hi', route: '/drafts/:slug' },
      'the first route that is not an alias',
    );
    let reordered = [rules[0]!, ...POSTS(), rules[1]!];
    assert.deepEqual(
      outcome(lookup(reordered, { kind: 'cards', cards: [post] })),
      { address: '/posts/hi', route: '/posts/:slug' },
      'order decides',
    );
    let draft = make('Post', 'Post/2', { slug: 'wip', status: 'draft' });
    assert.deepEqual(
      outcome(lookup(reordered, { kind: 'cards', cards: [draft] })),
      { address: '/drafts/wip', route: '/drafts/:slug' },
      'a card that fails the first where gets the next route',
    );
  });

  test('a type and field values', function (assert) {
    let rules: RawHostRoutingRule[] = [
      { path: '/tags/:name', type: ref('Tag'), match: { name: ':name' } },
    ];
    let target = (
      type: typeof BaseDef,
      values: Record<string, unknown>,
    ): HostRouteAddressTarget => ({ kind: 'type', type, values });

    assert.deepEqual(
      outcome(lookup(rules, target(classes.Tag!, { name: 'crag' }))),
      { address: '/tags/crag', route: '/tags/:name' },
    );
    assert.deepEqual(
      outcome(lookup(rules, target(classes.FancyTag!, { name: 'crag' }))),
      { address: '/tags/crag', route: '/tags/:name' },
      'a type that descends from the route type',
    );
    assert.deepEqual(
      outcome(lookup(rules, target(classes.Tag!, { name: 'sport climbing' }))),
      { address: '/tags/sport%20climbing', route: '/tags/:name' },
      'the value is encoded',
    );
    assert.deepEqual(
      outcome(lookup(rules, target(classes.Tag!, { name: '' }))),
      { reason: 'invalid-segment-value', route: '/tags/:name' },
    );
    assert.deepEqual(
      outcome(lookup(rules, target(classes.Tag!, { slug: 'crag' }))),
      { reason: 'no-route', route: undefined },
      'fields the route does not match',
    );
    assert.deepEqual(
      outcome(lookup(rules, target(classes.Post!, { name: 'crag' }))),
      { reason: 'no-route', route: undefined },
      'a type with no route',
    );
  });

  test('one child card fills its parent from its link', function (assert) {
    let rules: RawHostRoutingRule[] = [
      {
        path: '/c/:category',
        type: ref('Category'),
        match: { slug: ':category' },
        routes: [
          {
            path: '/:product',
            type: ref('Product'),
            match: { slug: ':product' },
          },
        ],
      },
    ];
    let shoes = make('Category', 'Category/shoes', { slug: 'shoes' });
    let hats = make('Category', 'Category/hats', { slug: 'hats' });
    let runner = make('Product', 'Product/runner', {
      slug: 'trail-runner',
      category: shoes,
    });
    assert.deepEqual(
      outcome(lookup(rules, { kind: 'cards', cards: [runner] })),
      { address: '/c/shoes/trail-runner', route: '/c/:category/:product' },
      'one card',
    );
    assert.deepEqual(
      outcome(lookup(rules, { kind: 'cards', cards: [shoes, runner] })),
      { address: '/c/shoes/trail-runner', route: '/c/:category/:product' },
      'one card per level',
    );
    assert.deepEqual(
      outcome(lookup(rules, { kind: 'cards', cards: [hats, runner] })),
      { reason: 'not-member', route: '/c/:category/:product' },
      'a pair that does not belong together',
    );
    let orphan = make('Product', 'Product/orphan', { slug: 'orphan' });
    assert.deepEqual(
      outcome(lookup(rules, { kind: 'cards', cards: [orphan] })),
      { reason: 'parent-not-loaded', route: '/c/:category/:product' },
      'a child with no parent',
    );
  });

  test('one child card gives no address when only the parent holds the link', function (assert) {
    let rules: RawHostRoutingRule[] = [
      {
        path: '/shelves/:shelf',
        type: ref('Shelf'),
        match: { slug: ':shelf' },
        routes: [
          { path: '/:item', type: ref('Item'), match: { slug: ':item' } },
        ],
      },
    ];
    let item = make('Item', 'Item/1', { slug: 'lamp' });
    let shelf = make('Shelf', 'Shelf/1', { slug: 'top', items: [item] });
    let other = make('Shelf', 'Shelf/2', { slug: 'bottom', items: [] });
    assert.deepEqual(outcome(lookup(rules, { kind: 'cards', cards: [item] })), {
      reason: 'parent-holds-link',
      route: '/shelves/:shelf/:item',
    });
    assert.deepEqual(
      outcome(lookup(rules, { kind: 'cards', cards: [shelf, item] })),
      { address: '/shelves/top/lamp', route: '/shelves/:shelf/:item' },
      'with the parent given',
    );
    assert.deepEqual(
      outcome(lookup(rules, { kind: 'cards', cards: [other, item] })),
      { reason: 'not-member', route: '/shelves/:shelf/:item' },
      'a parent that does not hold the child',
    );
  });

  test('a route name with cards', function (assert) {
    let rules: RawHostRoutingRule[] = [{ name: 'post', ...POSTS()[0]! }];
    let post = make('Post', 'Post/1', { slug: 'hi', status: 'published' });
    assert.deepEqual(
      outcome(
        lookup(rules, { kind: 'route-name', name: 'post', args: [post] }),
      ),
      { address: '/posts/hi', route: '/posts/:slug' },
    );
    assert.deepEqual(
      outcome(
        lookup(rules, { kind: 'route-name', name: 'post', args: ['hi'] }),
      ),
      { address: '/posts/hi', route: '/posts/:slug' },
      'a value skips the where check',
    );
  });
});
