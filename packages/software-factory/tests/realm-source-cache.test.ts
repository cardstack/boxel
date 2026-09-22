import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  clearRealmSourceCache,
  collectImportSpecifiers,
  fetchRealmSources,
} from '@cardstack/runtime-common/realm-source-cache';

const CATALOG = '@cardstack/catalog/';
const CATALOG_URL = 'https://realms.example.test/catalog/';

interface StubRealm {
  /** realm-relative path (with extension) → source */
  files: Record<string, string>;
  requests: { url: string; headers: Record<string, string> }[];
  etags?: Record<string, string>;
}

function stubFetch(realm: StubRealm): typeof globalThis.fetch {
  return (async (input: string | URL, init?: RequestInit) => {
    let url = String(input);
    let headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>),
    );
    realm.requests.push({ url, headers });

    let path = url.slice(CATALOG_URL.length);
    let source = realm.files[path];
    if (source === undefined) {
      return new Response('not found', { status: 404 });
    }

    let etag = realm.etags?.[path];
    if (etag && headers['If-None-Match'] === etag) {
      return new Response(null, { status: 304 });
    }

    return new Response(source, {
      status: 200,
      headers: etag ? { etag } : {},
    });
  }) as unknown as typeof globalThis.fetch;
}

function makeRealm(files: Record<string, string>): StubRealm {
  return { files, requests: [] };
}

// ---------------------------------------------------------------------------
// collectImportSpecifiers
// ---------------------------------------------------------------------------

module('realm-source-cache > collectImportSpecifiers', function () {
  test('finds default, named, namespace and side-effect imports', function (assert) {
    let source = [
      `import StringField from '@cardstack/base/string';`,
      `import { field, contains } from '@cardstack/base/card-api';`,
      `import * as ns from './namespace';`,
      `import './side-effect';`,
    ].join('\n');
    assert.deepEqual(collectImportSpecifiers(source), [
      '@cardstack/base/string',
      '@cardstack/base/card-api',
      './namespace',
      './side-effect',
    ]);
  });

  test('finds re-exports and dynamic imports', function (assert) {
    let source = [
      `export { Author } from '@cardstack/catalog/blog/author';`,
      `export * from './all';`,
      `let mod = await import('@cardstack/catalog/lazy');`,
    ].join('\n');
    assert.deepEqual(collectImportSpecifiers(source).sort(), [
      './all',
      '@cardstack/catalog/blog/author',
      '@cardstack/catalog/lazy',
    ]);
  });

  test('finds a multi-line named import', function (assert) {
    let source = `import {\n  CardDef,\n  field,\n} from '@cardstack/base/card-api';`;
    assert.deepEqual(collectImportSpecifiers(source), [
      '@cardstack/base/card-api',
    ]);
  });
});

// ---------------------------------------------------------------------------
// fetchRealmSources
// ---------------------------------------------------------------------------

module('realm-source-cache > fetchRealmSources', function (hooks) {
  hooks.beforeEach(function () {
    clearRealmSourceCache();
  });

  test('fetches a prefixed import and keys it under the prefix cache dir', async function (assert) {
    let realm = makeRealm({
      'blog/author.gts': `export class Author {}`,
    });
    let result = await fetchRealmSources({
      entries: [
        {
          path: 'contributor.gts',
          content: `import { Author } from '@cardstack/catalog/blog/author';`,
        },
      ],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: stubFetch(realm),
    });

    assert.deepEqual([...result.modules.keys()], ['catalog/blog/author.gts']);
    assert.strictEqual(
      result.modules.get('catalog/blog/author.gts'),
      'export class Author {}',
    );
    assert.deepEqual(result.resolvedPrefixes, [CATALOG]);
    assert.deepEqual(result.failures, []);
  });

  // The realm serves transpiled JS at the same URL — decorators lowered,
  // templates compiled — and that form resolves, so a regression to a plain
  // GET type-checks against something that is not the source and stays green.
  test('asks for source rather than the transpiled module', async function (assert) {
    let realm = makeRealm({ 'blog/author.gts': `export class Author {}` });
    await fetchRealmSources({
      entries: [
        {
          path: 'a.gts',
          content: `import { Author } from '@cardstack/catalog/blog/author';`,
        },
      ],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: stubFetch(realm),
    });

    assert.true(realm.requests.length > 0, 'the realm was asked for something');
    for (let request of realm.requests) {
      assert.strictEqual(
        request.headers.Accept,
        'application/vnd.card+source',
        `${request.url} asked for source`,
      );
    }
  });

  test('follows relative imports out of a fetched module', async function (assert) {
    let realm = makeRealm({
      'blog/author.gts': `import { Bio } from './bio';\nimport { Shared } from '../shared/tokens';\nexport class Author {}`,
      'blog/bio.gts': `export class Bio {}`,
      'shared/tokens.gts': `export class Shared {}`,
    });
    let result = await fetchRealmSources({
      entries: [
        {
          path: 'a.gts',
          content: `import { Author } from '@cardstack/catalog/blog/author';`,
        },
      ],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: stubFetch(realm),
    });

    assert.deepEqual([...result.modules.keys()].sort(), [
      'catalog/blog/author.gts',
      'catalog/blog/bio.gts',
      'catalog/shared/tokens.gts',
    ]);
  });

  test('terminates on an import cycle', async function (assert) {
    let realm = makeRealm({
      'a.gts': `import { B } from './b';\nexport class A {}`,
      'b.gts': `import { A } from './a';\nexport class B {}`,
    });
    let result = await fetchRealmSources({
      entries: [
        { path: 'x.gts', content: `import { A } from '@cardstack/catalog/a';` },
      ],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: stubFetch(realm),
    });

    assert.deepEqual([...result.modules.keys()].sort(), [
      'catalog/a.gts',
      'catalog/b.gts',
    ]);
  });

  test('stops following imports at maxDepth', async function (assert) {
    let realm = makeRealm({
      'a.gts': `import './b';`,
      'b.gts': `import './c';`,
      'c.gts': `export class C {}`,
    });
    let result = await fetchRealmSources({
      entries: [{ path: 'x.gts', content: `import '@cardstack/catalog/a';` }],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: stubFetch(realm),
      maxDepth: 1,
    });

    assert.deepEqual([...result.modules.keys()].sort(), [
      'catalog/a.gts',
      'catalog/b.gts',
    ]);
  });

  test('reports an unreachable module as a failure rather than throwing', async function (assert) {
    let result = await fetchRealmSources({
      entries: [
        {
          path: 'a.gts',
          content: `import { Gone } from '@cardstack/catalog/missing';`,
        },
      ],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: (async () => {
        throw new Error('ECONNREFUSED');
      }) as unknown as typeof globalThis.fetch,
    });

    assert.deepEqual(result.modules.size, 0);
    assert.deepEqual(result.resolvedPrefixes, []);
    assert.strictEqual(result.failures.length, 1);
    assert.strictEqual(
      result.failures[0].specifier,
      '@cardstack/catalog/missing',
    );
    assert.true(result.failures[0].reason.includes('ECONNREFUSED'));
  });

  test('ignores a specifier belonging to no registered prefix', async function (assert) {
    let realm = makeRealm({});
    let result = await fetchRealmSources({
      entries: [
        {
          path: 'a.gts',
          content: [
            `import { CardDef } from '@cardstack/base/card-api';`,
            `import { Pill } from '@cardstack/boxel-ui/components';`,
            `import { format } from 'date-fns';`,
          ].join('\n'),
        },
      ],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: stubFetch(realm),
    });

    assert.strictEqual(realm.requests.length, 0, 'nothing was fetched');
    assert.deepEqual(result.failures, []);
  });

  test('revalidates a cached module instead of refetching it', async function (assert) {
    let realm = makeRealm({ 'author.gts': `export class Author {}` });
    realm.etags = { 'author.gts': 'v1' };
    let entries = [
      {
        path: 'a.gts',
        content: `import { Author } from '@cardstack/catalog/author';`,
      },
    ];
    let fetchFn = stubFetch(realm);

    await fetchRealmSources({
      entries,
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: fetchFn,
    });
    let second = await fetchRealmSources({
      entries,
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: fetchFn,
    });

    let last = realm.requests[realm.requests.length - 1];
    assert.strictEqual(last.headers['If-None-Match'], 'v1');
    assert.strictEqual(
      second.modules.get('catalog/author.gts'),
      'export class Author {}',
      'a 304 still yields the source',
    );
  });

  // The memo must not answer one user's read with bytes fetched as another:
  // the fetch authenticates per user, and the realm decides per request what
  // each may see. A different cacheScope therefore starts cold — no
  // revalidation headers, a full fetch — while the same scope revalidates.
  test('a different cacheScope does not share memo entries', async function (assert) {
    let realm = makeRealm({ 'author.gts': `export class Author {}` });
    realm.etags = { 'author.gts': 'v1' };
    let entries = [
      {
        path: 'a.gts',
        content: `import { Author } from '@cardstack/catalog/author';`,
      },
    ];
    let fetchFn = stubFetch(realm);

    await fetchRealmSources({
      entries,
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: fetchFn,
      cacheScope: '@alice:example.test',
    });
    await fetchRealmSources({
      entries,
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: fetchFn,
      cacheScope: '@bob:example.test',
    });

    let last = realm.requests[realm.requests.length - 1];
    assert.strictEqual(
      last.headers['If-None-Match'],
      undefined,
      "bob's first read carries no validator from alice's entry",
    );
  });

  // A realm-prefixed specifier can carry `..`, a protocol-relative `//host`, or
  // an absolute `https://host` that `new URL` honors — walking the fetch to a
  // sibling realm or an arbitrary host. This runs server-side over agent-
  // authored code, so an unconstrained fetch is a blind SSRF primitive.
  test('rejects specifiers that resolve outside the realm', async function (assert) {
    let realm = makeRealm({});
    let vectors = [
      '@cardstack/catalog/https://evil.com/x',
      '@cardstack/catalog///evil.com/x',
      '@cardstack/catalog/../other-realm/secret',
    ];
    let result = await fetchRealmSources({
      entries: vectors.map((specifier, i) => ({
        path: `v${i}.gts`,
        content: `import { X } from '${specifier}';`,
      })),
      prefixRealmURLs: { [CATALOG]: CATALOG_URL },
      fetch: stubFetch(realm),
    });

    assert.strictEqual(
      realm.requests.length,
      0,
      'no fetch escaped the realm origin',
    );
    assert.strictEqual(
      result.modules.size,
      0,
      'nothing outside the realm was staged',
    );
    assert.strictEqual(
      result.failures.length,
      vectors.length,
      'each escaping specifier is reported as a failure',
    );
  });

  // The staging layer hands the full prefix set to the fetch, not just the
  // prefixes the entry files name, so a fetched module that imports a *different*
  // registered prefix is followed rather than left unresolved.
  test('follows a transitive import into a different registered prefix', async function (assert) {
    const SKILLS = '@cardstack/skills/';
    const SKILLS_URL = 'https://realms.example.test/skills/';
    let files: Record<string, string> = {
      [`${CATALOG_URL}blog/author.gts`]: `import { Tone } from '@cardstack/skills/writing/tone';\nexport class Author {}`,
      [`${SKILLS_URL}writing/tone.gts`]: `export class Tone {}`,
    };
    let fetchFn = (async (input: string | URL) => {
      let source = files[String(input)];
      return source === undefined
        ? new Response('not found', { status: 404 })
        : new Response(source, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    let result = await fetchRealmSources({
      entries: [
        {
          path: 'contributor.gts',
          content: `import { Author } from '@cardstack/catalog/blog/author';`,
        },
      ],
      prefixRealmURLs: { [CATALOG]: CATALOG_URL, [SKILLS]: SKILLS_URL },
      fetch: fetchFn,
    });

    assert.deepEqual(
      [...result.modules.keys()].sort(),
      ['catalog/blog/author.gts', 'skills/writing/tone.gts'],
      'a catalog module importing a skills module pulls both',
    );
    assert.deepEqual(result.resolvedPrefixes.sort(), [CATALOG, SKILLS]);
  });
});
