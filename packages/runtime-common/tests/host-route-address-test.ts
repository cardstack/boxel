import {
  hostRouteAddress,
  type HostRouteAddressResult,
  type HostRouteAddressTarget,
} from '../host-route-address.ts';
import {
  validateHostRoutes,
  type HostRoute,
  type HostRouteTypeInfo,
} from '../host-routes.ts';
import type { CardAPIForMatching } from '../instance-filter-matcher.ts';
import type { RawHostRoutingRule } from '../realm.ts';
import {
  fillCardIdPattern,
  matchRoutePathPattern,
  parseCardIdPattern,
  parseRoutePathPattern,
} from '../route-pattern.ts';
import type { SharedTests } from '../helpers/index.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';
import { VirtualNetwork } from '../virtual-network.ts';
import type { BaseDef } from '@cardstack/base/card-api';

// These tests use card id templates, fixed routes and redirects, which read
// only card ids, and field matches given only ids. Field matches that read
// loaded cards are tested in the host's `host-route-address` unit test.

const REALM = 'http://realm.test/site/';
// The realm is also named by a prefix, as a well-known realm is.
const PREFIX = '@example/site/';
const OTHER_REALM = 'http://other.test/site/';
const OTHER_PREFIX = '@example/other/';

function network(): VirtualNetwork {
  let virtualNetwork = new VirtualNetwork();
  virtualNetwork.addRealmMapping(PREFIX, REALM);
  virtualNetwork.addRealmMapping(OTHER_PREFIX, OTHER_REALM);
  return virtualNetwork;
}

// Only the virtual network is read: these tests have no loaded cards.
const API = { virtualNetwork: network() } as CardAPIForMatching;

const POST_MODULE = `${REALM}post`;
const POST: HostRouteTypeInfo = {
  key: `${POST_MODULE}/Post`,
  types: [`${POST_MODULE}/Post`],
  isCardType: true,
  fields: { slug: { type: 'contains', isPrimitive: true } },
};
const postType = { module: POST_MODULE, name: 'Post' } as ResolvedCodeRef;

function routesFor(rules: RawHostRoutingRule[]): readonly HostRoute[] {
  let { routes, warnings } = validateHostRoutes(rules, {
    realmURL: new URL(REALM),
    lookupType: (type) => (type.name === 'Post' ? POST : undefined),
  });
  if (warnings.length > 0) {
    throw new Error(
      `unexpected warnings: ${warnings.map((w) => w.message).join('; ')}`,
    );
  }
  return routes;
}

function lookup(
  rules: RawHostRoutingRule[],
  target: HostRouteAddressTarget,
): HostRouteAddressResult {
  return hostRouteAddress(target, {
    routes: routesFor(rules),
    realmURL: new URL(REALM),
    api: API,
  });
}

function cards(...ids: string[]): HostRouteAddressTarget {
  return { kind: 'cards', cards: ids.map((id) => `${REALM}${id}`) };
}

function named(
  name: string,
  ...args: (string | number)[]
): HostRouteAddressTarget {
  return { kind: 'route-name', name, args };
}

// The address, or the reason there is none, with the route's full path.
function outcome(result: HostRouteAddressResult) {
  return result.ok
    ? { address: result.address, route: result.route.fullPath }
    : { reason: result.reason, route: result.route?.fullPath };
}

function instance(local: string) {
  return { id: `${REALM}${local}` };
}

const PEOPLE: RawHostRoutingRule[] = [
  { path: '/people/:person_id', card: './Person/:person_id' },
];

// A category route with a nested product route whose card id carries the
// category, then a later top-level route that also fits products.
const CATALOG: RawHostRoutingRule[] = [
  {
    path: '/c/:category',
    name: 'category',
    card: './Category/:category',
    routes: [
      {
        path: '/:product',
        name: 'product',
        card: './c/:category/:product',
      },
    ],
  },
  { path: '/p/:a/:b', card: './c/:a/:b' },
];

const tests: SharedTests<unknown> = Object.freeze({
  'hostRouteAddress: a card id fills its card id template': async (assert) => {
    assert.deepEqual(outcome(lookup(PEOPLE, cards('Person/robin'))), {
      address: '/people/robin',
      route: '/people/:person_id',
    });
    assert.deepEqual(
      outcome(
        lookup(PEOPLE, {
          kind: 'cards',
          cards: [instance('Person/robin') as unknown as BaseDef],
        }),
      ),
      { address: '/people/robin', route: '/people/:person_id' },
      'a card gives the same address as its id',
    );
    assert.deepEqual(
      outcome(lookup(PEOPLE, cards('Person/archive/abc'))),
      { reason: 'no-route', route: undefined },
      'an id with one segment too many does not fit the pattern',
    );
    assert.deepEqual(
      outcome(lookup(PEOPLE, cards('Pet/rex'))),
      { reason: 'no-route', route: undefined },
      'an id that differs in a literal does not fit',
    );
  },

  'hostRouteAddress: a card id in prefix form': async (assert) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/about', instance: instance('Page/about') },
      ...PEOPLE,
    ];
    let prefixed = (local: string): HostRouteAddressTarget => ({
      kind: 'cards',
      cards: [`${PREFIX}${local}`],
    });
    assert.deepEqual(outcome(lookup(rules, prefixed('Person/robin'))), {
      address: '/people/robin',
      route: '/people/:person_id',
    });
    assert.deepEqual(
      outcome(lookup(rules, prefixed('Page/about'))),
      { address: '/about', route: '/about' },
      'a fixed route matches its card in either form',
    );
    assert.deepEqual(
      outcome(
        lookup(rules, {
          kind: 'cards',
          cards: [`${OTHER_PREFIX}Person/robin`],
        }),
      ),
      { reason: 'other-realm', route: undefined },
      "another realm's prefix",
    );
    assert.deepEqual(
      outcome(
        lookup(rules, { kind: 'cards', cards: ['@example/unknown/Person/x'] }),
      ),
      { reason: 'other-realm', route: undefined },
      'a prefix the network does not know',
    );
  },

  'hostRouteAddress: an undecided route ends the search': async (assert) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/posts/:slug', type: postType, match: { slug: ':slug' } },
      { path: '/p/:id', card: './Post/:id' },
    ];
    assert.deepEqual(
      outcome(lookup(rules, cards('Post/1'))),
      { reason: 'card-not-loaded', route: '/posts/:slug' },
      'a bare id does not fall through to the later card id template',
    );
    let reversed = [rules[1]!, rules[0]!];
    assert.deepEqual(
      outcome(lookup(reversed, cards('Post/1'))),
      { address: '/p/1', route: '/p/:id' },
      'a card id template ahead of the field match decides with the id',
    );
  },

  'hostRouteAddress: a fixed route gives its card its path': async (assert) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/about/', instance: instance('Page/about') },
      { path: '/über', instance: instance('Page/uber') },
      ...PEOPLE,
    ];
    assert.deepEqual(outcome(lookup(rules, cards('Page/about'))), {
      address: '/about',
      route: '/about',
    });
    assert.deepEqual(
      outcome(lookup(rules, cards('Page/uber'))),
      { address: '/über', route: '/über' },
      'a path the parser rejects is used as it routes',
    );
    assert.deepEqual(
      outcome(lookup(rules, cards('Page/other'))),
      { reason: 'no-route', route: undefined },
      'another card gets nothing from the fixed route',
    );
  },

  'hostRouteAddress: the canonical route is the first declared': async (
    assert,
  ) => {
    let rules: RawHostRoutingRule[] = [
      // An alias that redirects is never canonical.
      {
        path: '/old/:person_id',
        card: './Person/:person_id',
        statusCode: 301,
      },
      { path: '/u/:handle', redirectTo: '/people/:handle' },
      ...CATALOG,
      ...PEOPLE,
      { path: '/me', instance: instance('Person/robin') },
    ];
    assert.deepEqual(
      outcome(lookup(rules, cards('Person/robin'))),
      { address: '/people/robin', route: '/people/:person_id' },
      'the 301 alias and the redirect are skipped, and the template comes before the later fixed route',
    );
    assert.deepEqual(
      outcome(lookup(rules, cards('c/shoes/trail-runner'))),
      { address: '/c/shoes/trail-runner', route: '/c/:category/:product' },
      "a route's children come before its later siblings",
    );

    let fixedFirst: RawHostRoutingRule[] = [
      { path: '/me', instance: instance('Person/robin') },
      ...PEOPLE,
    ];
    assert.deepEqual(
      outcome(lookup(fixedFirst, cards('Person/robin'))),
      { address: '/me', route: '/me' },
      'a fixed route declared first is canonical',
    );

    let onlyAlias: RawHostRoutingRule[] = [
      {
        path: '/old/:person_id',
        card: './Person/:person_id',
        statusCode: 301,
      },
    ];
    assert.deepEqual(
      outcome(lookup(onlyAlias, cards('Person/robin'))),
      { reason: 'no-route', route: undefined },
      'a card that only a 301 alias fits gets no address',
    );
  },

  'hostRouteAddress: one card or one per level fills a nested route': async (
    assert,
  ) => {
    assert.deepEqual(
      outcome(lookup(CATALOG, cards('c/shoes/trail-runner'))),
      { address: '/c/shoes/trail-runner', route: '/c/:category/:product' },
      "one card whose id carries its parent's segment",
    );
    assert.deepEqual(
      outcome(lookup(CATALOG, cards('Category/shoes', 'c/shoes/trail-runner'))),
      { address: '/c/shoes/trail-runner', route: '/c/:category/:product' },
      'one card per level',
    );
    assert.deepEqual(
      outcome(lookup(CATALOG, cards('Category/hats', 'c/shoes/trail-runner'))),
      { reason: 'not-member', route: '/c/:category/:product' },
      'two cards that do not belong together',
    );
    assert.deepEqual(
      outcome(lookup(CATALOG, cards('Category/shoes'))),
      { address: '/c/shoes', route: '/c/:category' },
      'the parent alone gets its own route',
    );
  },

  'hostRouteAddress: a route name and values': async (assert) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/about', name: 'about', instance: instance('Page/about') },
      {
        path: '/u/:handle',
        name: 'alias',
        redirectTo: '/people/:handle',
        statusCode: 301,
      },
      { path: '/people/:id', name: 'person', card: './Person/:id' },
      ...CATALOG,
    ];
    assert.deepEqual(outcome(lookup(rules, named('about'))), {
      address: '/about',
      route: '/about',
    });
    assert.deepEqual(outcome(lookup(rules, named('person', 'robin'))), {
      address: '/people/robin',
      route: '/people/:id',
    });
    assert.deepEqual(
      outcome(lookup(rules, named('person', `${REALM}Person/robin`))),
      {
        address: `/people/${encodeURIComponent(`${REALM}Person/robin`)}`,
        route: '/people/:id',
      },
      'a string is a segment value, never an id',
    );
    assert.deepEqual(outcome(lookup(rules, named('person', 42))), {
      address: '/people/42',
      route: '/people/:id',
    });
    assert.deepEqual(
      outcome(lookup(rules, named('alias', 'robin'))),
      { address: '/u/robin', route: '/u/:handle' },
      'a named redirect gives its own path',
    );
    assert.deepEqual(
      outcome(lookup(rules, named('product', 'shoes', 'trail-runner'))),
      { address: '/c/shoes/trail-runner', route: '/c/:category/:product' },
      'one value per level of a nested route',
    );
    assert.deepEqual(
      outcome(
        lookup(rules, {
          kind: 'route-name',
          name: 'product',
          args: [`${REALM}Category/shoes`, 'trail-runner'],
        }),
      ).address,
      `/c/${encodeURIComponent(`${REALM}Category/shoes`)}/trail-runner`,
      'a string is a value at every level',
    );
  },

  'hostRouteAddress: the reasons a route name gives no address': async (
    assert,
  ) => {
    let rules: RawHostRoutingRule[] = [
      { path: '/about', name: 'about', instance: instance('Page/about') },
      { path: '/people/:id', name: 'person', card: './Person/:id' },
    ];
    assert.deepEqual(outcome(lookup(rules, named('nobody'))), {
      reason: 'no-route',
      route: undefined,
    });
    assert.deepEqual(outcome(lookup(rules, named('person'))), {
      reason: 'wrong-argument-count',
      route: '/people/:id',
    });
    assert.deepEqual(outcome(lookup(rules, named('person', 'a', 'b'))), {
      reason: 'wrong-argument-count',
      route: '/people/:id',
    });
    assert.deepEqual(outcome(lookup(rules, named('about', 'x'))), {
      reason: 'wrong-argument-count',
      route: '/about',
    });
    for (let value of ['', '.', '..', 1e21, NaN, Infinity]) {
      assert.deepEqual(
        outcome(lookup(rules, named('person', value))),
        { reason: 'invalid-segment-value', route: '/people/:id' },
        `${String(value) || 'an empty string'} is not a valid segment`,
      );
    }
  },

  'hostRouteAddress: the reasons cards give no address': async (assert) => {
    assert.deepEqual(
      outcome(lookup(PEOPLE, { kind: 'cards', cards: [] })),
      { reason: 'wrong-argument-count', route: undefined },
      'no cards',
    );
    assert.deepEqual(
      outcome(
        lookup(PEOPLE, {
          kind: 'cards',
          cards: ['http://other.test/site/Person/robin'],
        }),
      ),
      { reason: 'other-realm', route: undefined },
      'a card in another realm keeps its own URL',
    );
    assert.deepEqual(
      outcome(
        lookup(PEOPLE, { kind: 'cards', cards: [{} as unknown as BaseDef] }),
      ),
      { reason: 'card-without-id', route: undefined },
      'a card with no id',
    );
    assert.deepEqual(
      outcome(lookup(PEOPLE, cards('Person/a', 'Person/b', 'Person/c'))),
      { reason: 'no-route', route: undefined },
      'more cards than any route has levels',
    );
    assert.deepEqual(
      outcome(lookup([], cards('Person/robin'))),
      { reason: 'no-route', route: undefined },
      'no routes',
    );
  },

  'hostRouteAddress: addresses round-trip through the parser': async (
    assert,
  ) => {
    let routes = routesFor(PEOPLE);
    let pathPattern = parseRoutePathPattern('/people/:person_id');
    let cardPattern = parseCardIdPattern('./Person/:person_id');
    if (!pathPattern.ok || !cardPattern.ok) {
      throw new Error('patterns must parse');
    }
    let realmURL = new URL(REALM);
    for (let value of [
      'robin',
      'über café',
      '日本語',
      'a+b,c;d=e',
      "it's (fine)!*",
      'a%2Fb',
      'question?mark#hash',
      'emoji-🦊',
      '~tilde_dot.dash-',
    ]) {
      let id = fillCardIdPattern(
        cardPattern.pattern,
        { person_id: value },
        realmURL,
      );
      if (!id) {
        throw new Error(`no id for ${value}`);
      }
      let result = hostRouteAddress(
        { kind: 'cards', cards: [id] },
        { routes, realmURL, api: API },
      );
      if (!result.ok) {
        assert.ok(false, `no address for ${value}: ${result.reason}`);
        continue;
      }
      assert.deepEqual(
        matchRoutePathPattern(pathPattern.pattern, result.address),
        { person_id: value },
        `${value} round-trips through ${result.address}`,
      );
      assert.ok(
        /^\/people\/[A-Za-z0-9\-._~%]+$/.test(result.address),
        `${result.address} uses only unreserved characters and %XX`,
      );
      assert.ok(
        !/%[0-9a-f]{2}/.test(result.address.replace(/%[0-9A-F]{2}/g, '')),
        `${result.address} has upper-case hex digits`,
      );
    }
    assert.deepEqual(
      outcome(lookup(PEOPLE, cards('Person/%C3%BCber'))),
      { address: '/people/%C3%BCber', route: '/people/:person_id' },
      'a unicode id',
    );
    assert.deepEqual(
      outcome(lookup(PEOPLE, cards("Person/it's"))),
      { address: '/people/it%27s', route: '/people/:person_id' },
      'reserved characters are encoded',
    );
  },
});

export default tests;
