import {
  hostRouteCanonicalAddress,
  type HostRouteFindCardRequest,
} from '../host-route-canonical-address.ts';
import { hostRouteAddress } from '../host-route-address.ts';
import type { HostRouteLoadRequest } from '../host-route-resolver.ts';
import {
  validateHostRoutes,
  type HostRoute,
  type HostRouteTypeInfo,
} from '../host-routes.ts';
import type { CardAPIForMatching } from '../instance-filter-matcher.ts';
import type { RawHostRoutingRule } from '../realm.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';
import type { SharedTests } from '../helpers/index.ts';
import { VirtualNetwork } from '../virtual-network.ts';

// The canonical address from the index, against a fake index. Where a route
// reads only card ids (card id templates, fixed routes), the reverse lookup
// `hostRouteAddress` decides from the same ids, and the two must agree.

const REALM = 'http://realm.test/site/';
const MODULE = `${REALM}types`;

const contains = { type: 'contains' as const, isPrimitive: true };
const linksTo = (name: string) => ({
  type: 'linksTo' as const,
  isPrimitive: false,
  target: `${MODULE}/${name}`,
});

function cardType(
  name: string,
  fields: HostRouteTypeInfo['fields'],
): HostRouteTypeInfo {
  return {
    key: `${MODULE}/${name}`,
    types: [`${MODULE}/${name}`],
    isCardType: true,
    fields,
  };
}

const TYPES: Record<string, HostRouteTypeInfo> = {
  Post: cardType('Post', { slug: contains, status: contains }),
  Category: cardType('Category', { slug: contains }),
  Product: cardType('Product', {
    slug: contains,
    category: linksTo('Category'),
  }),
  // Only the shelf holds the link to its items.
  Shelf: cardType('Shelf', {
    slug: contains,
    items: { ...linksTo('Item'), type: 'linksToMany' as const },
  }),
  Item: cardType('Item', { slug: contains }),
};

function type(name: string): ResolvedCodeRef {
  return { module: MODULE, name } as ResolvedCodeRef;
}

function routesFor(rules: RawHostRoutingRule[]): readonly HostRoute[] {
  let { routes, warnings } = validateHostRoutes(rules, {
    realmURL: new URL(REALM),
    virtualNetwork: new VirtualNetwork(),
    lookupType: (ref) => (ref.module === MODULE ? TYPES[ref.name] : undefined),
  });
  let dropped = warnings.filter((w) => w.dropped);
  if (dropped.length > 0) {
    throw new Error(`test routes were dropped: ${JSON.stringify(dropped)}`);
  }
  return routes;
}

interface FakeCard {
  type: string;
  values?: Record<string, unknown>;
  links?: Record<string, string[]>;
}

// A fake index keyed by local id. `findCard` checks the type and an `eq`
// `where`, as the realm's search would.
class FakeIndex {
  finds: HostRouteFindCardRequest[] = [];
  loads: HostRouteLoadRequest[] = [];
  fail = false;
  private cards: Map<string, FakeCard>;

  constructor(cards: Record<string, FakeCard>) {
    this.cards = new Map(
      Object.entries(cards).map(([id, card]) => [`${REALM}${id}`, card]),
    );
  }

  private links(card: FakeCard, fields: readonly string[]) {
    return Object.fromEntries(
      fields.map((f) => [f, (card.links?.[f] ?? []).map((l) => REALM + l)]),
    );
  }

  load = async (request: HostRouteLoadRequest) => {
    this.loads.push(request);
    let card = this.cards.get(request.cardHref);
    return card
      ? {
          cardHref: request.cardHref,
          linkHrefs: this.links(card, request.linkFields),
        }
      : undefined;
  };

  findCard = async (request: HostRouteFindCardRequest) => {
    this.finds.push(request);
    if (this.fail) {
      throw new Error('the search failed');
    }
    let card = this.cards.get(request.cardHref);
    if (!card || card.type !== request.type.name) {
      return undefined;
    }
    let eq = (request.where as { eq?: Record<string, unknown> } | undefined)
      ?.eq;
    if (eq && Object.entries(eq).some(([f, v]) => card!.values?.[f] !== v)) {
      return undefined;
    }
    return {
      cardHref: request.cardHref,
      values: Object.fromEntries(
        request.valueFields.map((f) => [f, card!.values?.[f]]),
      ),
      linkHrefs: this.links(card, request.linkFields),
    };
  };
}

async function canonical(
  rules: RawHostRoutingRule[],
  index: FakeIndex,
  id: string,
) {
  let result = await hostRouteCanonicalAddress(`${REALM}${id}`, {
    routes: routesFor(rules),
    realmURL: new URL(REALM),
    load: index.load,
    findCard: index.findCard,
  });
  return result
    ? { address: result.address, route: result.route.fullPath }
    : undefined;
}

// What the reverse lookup gives for a card id, in the same shape.
function reverse(rules: RawHostRoutingRule[], id: string) {
  let result = hostRouteAddress(
    { kind: 'cards', cards: [`${REALM}${id}`] },
    {
      routes: routesFor(rules),
      realmURL: new URL(REALM),
      api: { virtualNetwork: new VirtualNetwork() } as CardAPIForMatching,
    },
  );
  return result.ok
    ? { address: result.address, route: result.route.fullPath }
    : undefined;
}

const POSTS: Record<string, FakeCard> = {
  'Post/hello': {
    type: 'Post',
    values: { slug: 'hello', status: 'published' },
  },
  'Post/draft': {
    type: 'Post',
    values: { slug: 'draft-one', status: 'draft' },
  },
  'Post/spaced': {
    type: 'Post',
    values: { slug: 'hello world', status: 'published' },
  },
};

const CATALOG: Record<string, FakeCard> = {
  'Category/shoes': { type: 'Category', values: { slug: 'shoes' } },
  'Product/trail': {
    type: 'Product',
    values: { slug: 'trail-runner' },
    links: { category: ['Category/shoes'] },
  },
  'Product/loose': { type: 'Product', values: { slug: 'loose' } },
  'Shelf/top': {
    type: 'Shelf',
    values: { slug: 'top' },
    links: { items: ['Item/cap'] },
  },
  'Item/cap': { type: 'Item', values: { slug: 'cap' } },
};

const tests: SharedTests<unknown> = Object.freeze({
  'hostRouteCanonicalAddress: id routes agree with the reverse lookup': async (
    assert,
  ) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/about', instance: { id: `${REALM}Page/about` } },
      { path: '/p/:id', card: './Post/:id', statusCode: 301 },
      {
        path: '/c/:category',
        card: './Category/:category',
        routes: [{ path: '/:product', card: './c/:category/:product' }],
      },
      { path: '/posts/:id', card: './Post/:id' },
      { path: '/later/:id', card: './Post/:id' },
    ];
    let index = new FakeIndex({});
    for (let [id, expected] of [
      ['Page/about', { address: '/about', route: '/about' }],
      ['Post/hello', { address: '/posts/hello', route: '/posts/:id' }],
      [
        'c/shoes/trail',
        { address: '/c/shoes/trail', route: '/c/:category/:product' },
      ],
      ['Category/shoes', { address: '/c/shoes', route: '/c/:category' }],
      ['Elsewhere/x', undefined],
    ] as const) {
      let fromIndex = await canonical(rules, index, id);
      assert.deepEqual(fromIndex, expected, `${id}: the expected address`);
      assert.deepEqual(
        fromIndex,
        reverse(rules, id),
        `${id}: the same address as the reverse lookup`,
      );
    }
  },

  'hostRouteCanonicalAddress: a field match reads its values from the index':
    async (assert) => {
      let rules: RawHostRoutingRule[] = [
        { path: '/a/:id', card: './Post/:id', statusCode: 301 },
        {
          path: '/posts/:slug',
          type: type('Post'),
          where: { eq: { status: 'published' } },
          match: { slug: ':slug' },
        },
        { path: '/archive/:id', card: './Post/:id' },
      ];
      let index = new FakeIndex(POSTS);
      assert.deepEqual(await canonical(rules, index, 'Post/hello'), {
        address: '/posts/hello',
        route: '/posts/:slug',
      });
      assert.deepEqual(
        index.finds[0],
        {
          cardHref: `${REALM}Post/hello`,
          type: type('Post'),
          where: { eq: { status: 'published' } },
          valueFields: ['slug'],
          linkFields: [],
        },
        "the search names the card, the route's type and its where",
      );
      assert.deepEqual(
        await canonical(rules, index, 'Post/spaced'),
        { address: '/posts/hello%20world', route: '/posts/:slug' },
        'the value is encoded as the reverse lookup encodes it',
      );
      assert.deepEqual(
        await canonical(rules, index, 'Post/draft'),
        { address: '/archive/draft', route: '/archive/:id' },
        "a card that fails the route's where falls to the next route",
      );
    },

  'hostRouteCanonicalAddress: a nested route fills its parent from the link':
    async (assert) => {
      let rules: RawHostRoutingRule[] = [
        { path: '/p/:id', card: './Product/:id', statusCode: 301 },
        {
          path: '/c/:category',
          type: type('Category'),
          match: { slug: ':category' },
          routes: [
            {
              path: '/:product',
              type: type('Product'),
              match: { slug: ':product' },
            },
          ],
        },
        {
          path: '/shelf/:shelf',
          type: type('Shelf'),
          match: { slug: ':shelf' },
          routes: [
            { path: '/:item', type: type('Item'), match: { slug: ':item' } },
          ],
        },
      ];
      let index = new FakeIndex(CATALOG);
      assert.deepEqual(await canonical(rules, index, 'Product/trail'), {
        address: '/c/shoes/trail-runner',
        route: '/c/:category/:product',
      });
      assert.strictEqual(
        await canonical(rules, index, 'Product/loose'),
        undefined,
        'a card whose link to the parent is empty has no address',
      );
      assert.strictEqual(
        await canonical(rules, index, 'Item/cap'),
        undefined,
        'a card whose parent holds the link has no address from it alone',
      );
      assert.deepEqual(
        await canonical(rules, index, 'Shelf/top'),
        { address: '/shelf/top', route: '/shelf/:shelf' },
        'the parent itself has its address',
      );
    },

  'hostRouteCanonicalAddress: an alias is never canonical': async (assert) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/n/:id', card: './Note/:id', statusCode: 301 },
    ];
    let index = new FakeIndex({});
    assert.strictEqual(await canonical(rules, index, 'Note/one'), undefined);
    assert.strictEqual(reverse(rules, 'Note/one'), undefined);
  },

  'hostRouteCanonicalAddress: a failed lookup rejects': async (assert) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/posts/:slug', type: type('Post'), match: { slug: ':slug' } },
    ];
    let index = new FakeIndex(POSTS);
    index.fail = true;
    try {
      await canonical(rules, index, 'Post/hello');
      assert.ok(false, 'it should reject');
    } catch (error) {
      assert.strictEqual((error as Error).message, 'the search failed');
    }
  },
});

export default tests;
