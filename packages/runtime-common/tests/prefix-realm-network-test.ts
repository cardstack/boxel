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
import type { SharedTests } from '../helpers/index.ts';

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
    let network = new PrefixRealmNetwork(SERVED);
    assert.strictEqual(
      network.toURLHref('@cardstack/catalog/blog/author.gts'),
      'https://catalog.example.test/blog/author.gts',
    );
    assert.strictEqual(
      network.toURL('@cardstack/base/').href,
      'https://realms.example.test/base/',
    );
  },

  'passes a URL-form identifier through and refuses an unregistered prefix':
    async (assert) => {
      let network = new PrefixRealmNetwork(SERVED);
      assert.strictEqual(
        network.toURLHref('https://elsewhere.example.test/card.json'),
        'https://elsewhere.example.test/card.json',
      );
      assert.throws(
        () => network.toURL('@other/realm/card.json'),
        /no registered realm prefix matches it \(registered: @cardstack\/base\/, @cardstack\/catalog\/\)/,
      );
    },

  'normalizes trailing slashes on registration': async (assert) => {
    let network = new PrefixRealmNetwork();
    network.addRealmMapping(
      '@cardstack/skills',
      'https://realms.example.test/skills',
    );
    assert.deepEqual(network.prefixRealmURLs(), {
      '@cardstack/skills/': 'https://realms.example.test/skills/',
    });
    assert.deepEqual(network.knownRealms(), ['@cardstack/skills/']);
  },

  'places a reference in its realm by prefix or by served URL, longest match first':
    async (assert) => {
      let network = new PrefixRealmNetwork({
        ...SERVED,
        '@cardstack/base-extras/': 'https://realms.example.test/base-extras/',
      });
      assert.strictEqual(
        network.realmForReference('@cardstack/base-extras/x.gts'),
        'https://realms.example.test/base-extras/',
        'the deeper prefix wins over the one it extends',
      );
      assert.strictEqual(
        network.realmForReference('https://catalog.example.test/a/b.gts'),
        'https://catalog.example.test/',
        'a served URL is placed too',
      );
      assert.strictEqual(
        network.realmForReference('https://elsewhere.example.test/x'),
        undefined,
      );
    },

  'reads the path below the namespace from the spelling alone': async (
    assert,
  ) => {
    let network = new PrefixRealmNetwork(SERVED);
    assert.strictEqual(
      network.pathBelowNamespace('@cardstack/catalog/a/b.gts'),
      'a/b.gts',
    );
    assert.strictEqual(network.pathBelowNamespace('@cardstack/catalog/'), '');
    assert.strictEqual(
      network.pathBelowNamespace('https://realms.example.test/base/a%20b.gts'),
      'base/a b.gts',
    );
  },

  'folds a served URL back onto its prefix': async (assert) => {
    let network = new PrefixRealmNetwork(SERVED);
    assert.strictEqual(
      network.unresolveURL('https://catalog.example.test/a.gts'),
      '@cardstack/catalog/a.gts',
    );
    assert.strictEqual(
      network.unresolveURL('https://elsewhere.example.test/a.gts'),
      'https://elsewhere.example.test/a.gts',
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
