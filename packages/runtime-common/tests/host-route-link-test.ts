import {
  hostRouteLink,
  type UnresolvedHostRouteLink,
} from '../host-route-link.ts';
import type { HostRouteAddressTarget } from '../host-route-address.ts';
import { validateHostRoutes, type HostRoute } from '../host-routes.ts';
import type { CardAPIForMatching } from '../instance-filter-matcher.ts';
import type { RawHostRoutingRule } from '../realm.ts';
import type { SharedTests } from '../helpers/index.ts';
import { VirtualNetwork } from '../virtual-network.ts';

// These tests use card id templates, fixed routes and redirects, which read
// only card ids. Links that read loaded cards are tested in the host's
// `host-route-address` unit test.

const REALM = 'http://realm.test/site/';
// The realm is also named by a prefix, as a well-known realm is.
const PREFIX = '@example/site/';
const OTHER_REALM = 'http://other.test/site/';

function network(): VirtualNetwork {
  let virtualNetwork = new VirtualNetwork();
  virtualNetwork.addRealmMapping(PREFIX, REALM);
  return virtualNetwork;
}

// Only the virtual network is read: these tests have no loaded cards.
const API = { virtualNetwork: network() } as CardAPIForMatching;

const RULES: RawHostRoutingRule[] = [
  { path: '/about', instance: { id: `${REALM}Page/about` } },
  { path: '/people/:person_id', name: 'people', card: './Person/:person_id' },
  { path: '/old/:person_id', redirectTo: '/people/:person_id' },
];

function routesFor(rules: RawHostRoutingRule[]): readonly HostRoute[] {
  let { routes, warnings } = validateHostRoutes(rules, {
    realmURL: new URL(REALM),
    virtualNetwork: new VirtualNetwork(),
    lookupType: () => undefined,
  });
  if (warnings.length > 0) {
    throw new Error(
      `unexpected warnings: ${warnings.map((w) => w.message).join('; ')}`,
    );
  }
  return routes;
}

function link(
  target: HostRouteAddressTarget,
  unresolved: UnresolvedHostRouteLink[] = [],
  // `null` for routes that are not known.
  rules: RawHostRoutingRule[] | null = RULES,
): string | undefined {
  return hostRouteLink(target, {
    routes: rules
      ? { realmURL: new URL(REALM), routes: routesFor(rules) }
      : undefined,
    api: API,
    unresolved: (link) => unresolved.push(link),
  });
}

function cards(...ids: string[]): HostRouteAddressTarget {
  return { kind: 'cards', cards: ids };
}

const tests: SharedTests<unknown> = Object.freeze({
  'hostRouteLink: a card id gets the routed path on the realm URL': async (
    assert,
  ) => {
    let unresolved: UnresolvedHostRouteLink[] = [];
    assert.strictEqual(
      link(cards(`${REALM}Person/robin`), unresolved),
      `${REALM}people/robin`,
    );
    assert.strictEqual(
      link(cards(`${PREFIX}Person/robin`), unresolved),
      `${REALM}people/robin`,
      'an id in prefix form',
    );
    assert.strictEqual(
      link(cards(`${REALM}Person/a b`), unresolved),
      `${REALM}people/a%20b`,
      'the segment is encoded',
    );
    assert.strictEqual(
      link(cards(`${REALM}Page/about`), unresolved),
      `${REALM}about`,
      'a fixed route',
    );
    assert.deepEqual(unresolved, []);
  },

  'hostRouteLink: a card id no route fits keeps the card URL': async (
    assert,
  ) => {
    let unresolved: UnresolvedHostRouteLink[] = [];
    assert.strictEqual(
      link(cards(`${REALM}Pet/mango`), unresolved),
      `${REALM}Pet/mango`,
    );
    assert.strictEqual(
      link(cards(`${PREFIX}Pet/mango`), unresolved),
      `${REALM}Pet/mango`,
      'an id in prefix form falls back to the URL the card is served at',
    );
    assert.deepEqual(unresolved, [
      {
        form: 'cards',
        target: `${REALM}Pet/mango`,
        reason: 'no-route',
        realmURL: REALM,
      },
      {
        form: 'cards',
        target: `${PREFIX}Pet/mango`,
        reason: 'no-route',
        realmURL: REALM,
      },
    ]);
  },

  'hostRouteLink: a link into another realm keeps the card URL': async (
    assert,
  ) => {
    let unresolved: UnresolvedHostRouteLink[] = [];
    assert.strictEqual(
      link(cards(`${OTHER_REALM}Person/robin`), unresolved),
      `${OTHER_REALM}Person/robin`,
    );
    assert.deepEqual(unresolved, [], 'it is not reported');
  },

  'hostRouteLink: a realm with no routes, or routes that are not known, keeps card URLs':
    async (assert) => {
      let unresolved: UnresolvedHostRouteLink[] = [];
      assert.strictEqual(
        link(cards(`${REALM}Person/robin`), unresolved, []),
        `${REALM}Person/robin`,
        'no routes',
      );
      assert.strictEqual(
        link(cards(`${REALM}Person/robin`), unresolved, null),
        `${REALM}Person/robin`,
        'routes not known',
      );
      assert.strictEqual(
        link(
          { kind: 'route-name', name: 'people', args: ['robin'] },
          unresolved,
          null,
        ),
        undefined,
        'a route name with routes not known has no URL',
      );
      assert.deepEqual(unresolved, [], 'none of these is reported');
    },

  'hostRouteLink: a route name': async (assert) => {
    let unresolved: UnresolvedHostRouteLink[] = [];
    assert.strictEqual(
      link({ kind: 'route-name', name: 'people', args: ['robin'] }, unresolved),
      `${REALM}people/robin`,
    );
    assert.deepEqual(unresolved, []);
    assert.strictEqual(
      link({ kind: 'route-name', name: 'team', args: [] }, unresolved),
      undefined,
      'a name no route has gives no URL',
    );
    assert.strictEqual(
      link({ kind: 'route-name', name: 'people', args: [] }, unresolved),
      undefined,
      'too few arguments give no URL',
    );
    assert.deepEqual(unresolved, [
      {
        form: 'route-name',
        target: 'team',
        reason: 'no-route',
        realmURL: REALM,
      },
      {
        form: 'route-name',
        target: 'people',
        reason: 'wrong-argument-count',
        routePath: '/people/:person_id',
        realmURL: REALM,
      },
    ]);
  },

  'hostRouteLink: a lookup that throws gives the fallback': async (assert) => {
    let throwing = {
      get virtualNetwork(): VirtualNetwork {
        throw new Error('boom');
      },
    } as CardAPIForMatching;
    assert.strictEqual(
      hostRouteLink(cards(`${REALM}Person/robin`), {
        routes: { realmURL: new URL(REALM), routes: routesFor(RULES) },
        api: throwing,
      }),
      `${REALM}Person/robin`,
      'nothing is thrown, and the link keeps the id it was given',
    );
  },
});

export default tests;
