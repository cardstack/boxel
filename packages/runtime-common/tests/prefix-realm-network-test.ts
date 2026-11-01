import {
  PREFIX_REALMS_ENDPOINT,
  PrefixRealmNetwork,
  clearPrefixRealmNetworkCache,
  fetchPrefixRealmURLs,
  prefixRealmNetworkFor,
  prefixRealmURLsFromDocument,
  prefixRealmURLsOf,
  prefixRealmsDocument,
} from '../prefix-realm-network.ts';
import type { RealmIdentifier } from '../realm-identifiers.ts';
import { baseRealmAliasURL } from '../realm-prefixes.ts';
import { VirtualNetwork } from '../virtual-network.ts';
import type { SharedTests } from '../helpers/index.ts';

// The prefix resolution `PrefixRealmNetwork` shares with `VirtualNetwork`,
// typed loosely enough that either class can be passed.
interface PrefixResolver {
  addRealmMapping(prefix: string, realmURL: string): void;
  knownRealms(): RealmIdentifier[];
  toURL(rri: string): URL;
  toURLHref(rri: string): string;
  realmForReference(reference: string): string | undefined;
  pathBelowNamespace(identifier: string): string;
  unresolveURL(url: string): string;
}

// Runs `check` against a `VirtualNetwork` and a `PrefixRealmNetwork` holding
// the same prefix map, so the subset cannot drift from the class it stands in
// for. Their one difference, an aliased realm, has a case of its own.
function eachNetwork(
  prefixRealmURLs: Record<string, string>,
  check: (network: PrefixResolver, name: string) => void,
) {
  let virtualNetwork = new VirtualNetwork();
  for (let [prefix, realmURL] of Object.entries(prefixRealmURLs)) {
    virtualNetwork.addRealmMapping(prefix, realmURL);
  }
  check(virtualNetwork, 'VirtualNetwork');
  check(new PrefixRealmNetwork(prefixRealmURLs), 'PrefixRealmNetwork');
}

// A served map whose catalog is deliberately away from `<server>/catalog/`,
// so a resolution that guessed from the prefix's spelling would come out
// wrong.
const SERVED = {
  '@cardstack/base/': 'https://realms.example.test/base/',
  '@cardstack/catalog/': 'https://catalog.example.test/',
};

function prefixMapFetch(
  calls: string[] = [],
  status = 200,
): typeof globalThis.fetch {
  return (async (input: string | URL | Request) => {
    let url = input instanceof Request ? input.url : String(input);
    calls.push(url);
    if (status !== 200) {
      return new Response('down', { status });
    }
    return Response.json(prefixRealmsDocument(new PrefixRealmNetwork(SERVED)));
  }) as typeof globalThis.fetch;
}

const tests = Object.freeze({
  'resolves a prefix-form identifier through its registered mapping': async (
    assert,
  ) => {
    eachNetwork(SERVED, (network, name) => {
      assert.strictEqual(
        network.toURLHref('@cardstack/catalog/blog/author.gts'),
        'https://catalog.example.test/blog/author.gts',
        name,
      );
      assert.strictEqual(
        network.toURL('@cardstack/base/').href,
        'https://realms.example.test/base/',
        name,
      );
    });
  },

  'passes a URL-form identifier through and refuses an unregistered prefix':
    async (assert) => {
      eachNetwork(SERVED, (network, name) => {
        assert.strictEqual(
          network.toURLHref('https://elsewhere.example.test/card.json'),
          'https://elsewhere.example.test/card.json',
          name,
        );
        assert.throws(
          () => network.toURL('@other/realm/card.json'),
          /no registered realm prefix matches it \(registered: @cardstack\/base\/, @cardstack\/catalog\/\)/,
          name,
        );
      });
    },

  'normalizes trailing slashes on registration': async (assert) => {
    eachNetwork({}, (network, name) => {
      network.addRealmMapping(
        '@cardstack/skills',
        'https://realms.example.test/skills',
      );
      assert.deepEqual(
        prefixRealmURLsOf(network),
        { '@cardstack/skills/': 'https://realms.example.test/skills/' },
        name,
      );
      assert.deepEqual(network.knownRealms(), ['@cardstack/skills/'], name);
    });
  },

  'places a reference in its realm by prefix or by served URL, longest match first':
    async (assert) => {
      // The inner realm is served below the outer one's URL and registered
      // after it, so a first match would place its references in the outer
      // realm.
      eachNetwork(
        {
          ...SERVED,
          '@example/outer/': 'https://nested.example.test/',
          '@example/inner/': 'https://nested.example.test/inner/',
        },
        (network, name) => {
          assert.strictEqual(
            network.realmForReference(
              'https://nested.example.test/inner/x.gts',
            ),
            'https://nested.example.test/inner/',
            `${name}: the deeper realm wins over the one it sits in`,
          );
          assert.strictEqual(
            network.realmForReference('@example/inner/x.gts'),
            'https://nested.example.test/inner/',
            `${name}: a prefix-form reference answers in URL form`,
          );
          assert.strictEqual(
            network.realmForReference('https://catalog.example.test/a/b.gts'),
            'https://catalog.example.test/',
            `${name}: a served URL is placed too`,
          );
          assert.strictEqual(
            network.realmForReference('https://elsewhere.example.test/x'),
            undefined,
            name,
          );
        },
      );
    },

  'reads the path below the namespace from the spelling alone': async (
    assert,
  ) => {
    eachNetwork(SERVED, (network, name) => {
      assert.strictEqual(
        network.pathBelowNamespace('@cardstack/catalog/a/b.gts'),
        'a/b.gts',
        name,
      );
      assert.strictEqual(
        network.pathBelowNamespace('@cardstack/catalog/'),
        '',
        name,
      );
      assert.strictEqual(
        network.pathBelowNamespace(
          'https://realms.example.test/base/a%20b.gts',
        ),
        'base/a b.gts',
        name,
      );
    });
  },

  'folds a served URL back onto its prefix': async (assert) => {
    eachNetwork(SERVED, (network, name) => {
      assert.strictEqual(
        network.unresolveURL('https://catalog.example.test/a.gts'),
        '@cardstack/catalog/a.gts',
        name,
      );
      assert.strictEqual(
        network.unresolveURL('https://elsewhere.example.test/a.gts'),
        'https://elsewhere.example.test/a.gts',
        name,
      );
    });
  },

  'knows an aliased realm only by its served URL, where VirtualNetwork also knows the alias':
    async (assert) => {
      // Registered the way the realm server registers the base realm: the
      // alias URL-mapped onto where the realm is served, and the prefix mapped
      // there too. The map a client builds from carries only the prefix.
      let virtualNetwork = new VirtualNetwork();
      virtualNetwork.addURLMapping(
        new URL(baseRealmAliasURL),
        new URL('https://realms.example.test/base/'),
      );
      virtualNetwork.addRealmMapping(
        '@cardstack/base/',
        'https://realms.example.test/base/',
      );
      let network = new PrefixRealmNetwork(prefixRealmURLsOf(virtualNetwork));

      assert.strictEqual(
        network.toURLHref('@cardstack/base/card-api.gts'),
        virtualNetwork.toURLHref('@cardstack/base/card-api.gts'),
        'a prefix resolves alike',
      );
      assert.strictEqual(
        virtualNetwork.realmForReference('@cardstack/base/card-api.gts'),
        baseRealmAliasURL,
        'VirtualNetwork folds back to the alias the realm is known by',
      );
      assert.strictEqual(
        network.realmForReference('@cardstack/base/card-api.gts'),
        'https://realms.example.test/base/',
        'PrefixRealmNetwork answers where the realm is served',
      );
      assert.strictEqual(
        virtualNetwork.unresolveURL(`${baseRealmAliasURL}card-api.gts`),
        '@cardstack/base/card-api.gts',
        'VirtualNetwork folds an alias URL onto the prefix',
      );
      assert.strictEqual(
        network.unresolveURL(`${baseRealmAliasURL}card-api.gts`),
        `${baseRealmAliasURL}card-api.gts`,
        'PrefixRealmNetwork leaves an alias URL as written',
      );
    },

  'the served document round-trips through the client parser': async (
    assert,
  ) => {
    let network = new PrefixRealmNetwork(SERVED);
    let document = prefixRealmsDocument(network);
    assert.deepEqual(document, {
      data: [
        {
          type: 'prefix-realm',
          id: '@cardstack/base/',
          attributes: { realmURL: 'https://realms.example.test/base/' },
        },
        {
          type: 'prefix-realm',
          id: '@cardstack/catalog/',
          attributes: { realmURL: 'https://catalog.example.test/' },
        },
      ],
    });
    assert.deepEqual(prefixRealmURLsFromDocument(document, 'test'), SERVED);
    assert.deepEqual(prefixRealmURLsOf(network), SERVED);
  },

  'rejects a document that is not a prefix realm map': async (assert) => {
    assert.throws(
      () => prefixRealmURLsFromDocument({ hello: 'world' }, 'the server'),
      /the server did not answer with a prefix realm document/,
    );
    assert.throws(
      () =>
        prefixRealmURLsFromDocument(
          {
            data: [
              {
                type: 'prefix-realm',
                id: 'https://not-a-prefix.example.test/',
                attributes: { realmURL: 'https://x.example.test/' },
              },
            ],
          },
          'the server',
        ),
      /malformed prefix realm entry/,
    );
  },

  'fetches the map from the endpoint below the server URL': async (assert) => {
    let calls: string[] = [];
    let map = await fetchPrefixRealmURLs(
      'https://realms.example.test',
      prefixMapFetch(calls),
    );
    assert.deepEqual(map, SERVED);
    assert.deepEqual(calls, [
      `https://realms.example.test/${PREFIX_REALMS_ENDPOINT}`,
    ]);
  },

  'builds one network per server, and asks again after a failed read': async (
    assert,
  ) => {
    clearPrefixRealmNetworkCache();
    try {
      let failedCalls: string[] = [];
      await assert.rejects(
        prefixRealmNetworkFor(
          'https://realms.example.test/',
          prefixMapFetch(failedCalls, 503),
        ),
        /HTTP 503/,
      );

      let calls: string[] = [];
      let fetch = prefixMapFetch(calls);
      let first = await prefixRealmNetworkFor(
        'https://realms.example.test/',
        fetch,
      );
      let second = await prefixRealmNetworkFor(
        'https://realms.example.test',
        fetch,
      );
      assert.strictEqual(first, second, 'the same network, slash or not');
      assert.strictEqual(calls.length, 1, 'read once after the failure');
      assert.deepEqual(first.prefixRealmURLs(), SERVED);
    } finally {
      clearPrefixRealmNetworkCache();
    }
  },

  'gives up on a server that never answers, and asks again next time': async (
    assert,
  ) => {
    clearPrefixRealmNetworkCache();
    try {
      // Accepts the request and never answers, as a hung server does; only
      // the request's own signal ends it.
      let hangingFetch = ((_input: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal!.reason),
          );
        })) as typeof globalThis.fetch;
      await assert.rejects(
        prefixRealmNetworkFor('https://realms.example.test/', hangingFetch, 20),
        /Could not read the prefix realm map from https:\/\/realms\.example\.test\/_prefix-realms: .*timeout/i,
      );

      let calls: string[] = [];
      let network = await prefixRealmNetworkFor(
        'https://realms.example.test/',
        prefixMapFetch(calls),
      );
      assert.strictEqual(calls.length, 1, 'the timed-out read was dropped');
      assert.deepEqual(network.prefixRealmURLs(), SERVED);
    } finally {
      clearPrefixRealmNetworkCache();
    }
  },

  'names the server, and the cause, when the request fails': async (assert) => {
    // Shaped as Node's fetch rejects a refused connection. `Object.assign`
    // rather than the `cause` option: not every package that type-checks this
    // file has a lib that knows the option.
    let refusedFetch = (async () => {
      throw Object.assign(new TypeError('fetch failed'), {
        cause: new Error('connect ECONNREFUSED 127.0.0.1:4201'),
      });
    }) as typeof globalThis.fetch;
    await assert.rejects(
      fetchPrefixRealmURLs('http://127.0.0.1:4201/', refusedFetch),
      new RegExp(
        'Could not read the prefix realm map from http://127\\.0\\.0\\.1:4201/_prefix-realms: ' +
          'fetch failed \\(connect ECONNREFUSED 127\\.0\\.0\\.1:4201\\)',
      ),
    );
  },
} as SharedTests<{}>);

export default tests;
