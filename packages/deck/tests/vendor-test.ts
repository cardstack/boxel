import QUnit from 'qunit';
const { module, test } = QUnit;
import { pack, unpack } from '../src/pack.ts';
import {
  urlToTreePath,
  vendorFromCdn,
  vendorImportMap,
} from '../src/vendor.ts';

// A fake CDN shaped like esm.sh: the entry redirects a range to a pinned
// version, modules reference each other by absolute URL, and a dependency
// lives under its own versioned path.
const CDN: Record<string, { url?: string; body: string }> = {
  'https://esm.sh/three@0.160.0': {
    url: 'https://esm.sh/three@0.160.0/es2022/three.mjs',
    body: `import { Vector3 } from "https://esm.sh/three@0.160.0/es2022/math.mjs";\nimport "https://esm.sh/three@0.160.0/es2022/side-effect.mjs";\nexport { Vector3 };\nexport const VERSION = '0.160.0';\n`,
  },
  'https://esm.sh/three@0.160.0/es2022/three.mjs': {
    url: 'https://esm.sh/three@0.160.0/es2022/three.mjs',
    body: `import { Vector3 } from "https://esm.sh/three@0.160.0/es2022/math.mjs";\nimport "https://esm.sh/three@0.160.0/es2022/side-effect.mjs";\nexport { Vector3 };\nexport const VERSION = '0.160.0';\n`,
  },
  'https://esm.sh/three@0.160.0/es2022/math.mjs': {
    body: `export class Vector3 {}\n`,
  },
  'https://esm.sh/three@0.160.0/es2022/side-effect.mjs': {
    body: `globalThis.__three = true;\n`,
  },
  'https://esm.sh/leaky@1.0.0': {
    body: `export * from "https://cdn.example.com/other@1.0.0/index.mjs";\n`,
  },
  'https://esm.sh/withquery@1.0.0': {
    body: `import x from "https://esm.sh/withquery@1.0.0/dep.mjs?target=es2022";\nexport default x;\n`,
  },
  'https://esm.sh/withquery@1.0.0/dep.mjs?target=es2022': {
    body: `export default 42;\n`,
  },
};

const fetchImpl = (async (input: string | URL) => {
  let href = typeof input === 'string' ? input : input.href;
  let entry = CDN[href];
  if (!entry) {
    return new Response('not found', { status: 404 });
  }
  return new Response(entry.body, {
    status: 200,
    headers: { 'content-type': 'text/javascript' },
  });
}) as unknown as typeof fetch;

// Node's Response.url is empty for synthesized responses, so redirects are
// modeled by resolving the alias before the walker sees it.
const redirectingFetch = (async (input: string | URL) => {
  let href = typeof input === 'string' ? input : input.href;
  let entry = CDN[href];
  if (!entry) {
    return new Response('not found', { status: 404 });
  }
  let response = new Response(entry.body, { status: 200 });
  Object.defineProperty(response, 'url', { value: entry.url ?? href });
  return response;
}) as unknown as typeof fetch;

module('vendor: bring a CDN library in-house', function () {
  test('url → tree path is readable and collision-safe', function (assert) {
    assert.strictEqual(
      urlToTreePath(new URL('https://esm.sh/three@0.160.0/es2022/three.mjs')),
      'esm.sh/three@0.160.0/es2022/three.mjs',
    );
    assert.strictEqual(
      urlToTreePath(new URL('https://esm.sh/pkg/')),
      'esm.sh/pkg/index.js',
    );
    let a = urlToTreePath(new URL('https://esm.sh/x.mjs?target=es2022'));
    let b = urlToTreePath(new URL('https://esm.sh/x.mjs?target=es2015'));
    assert.notStrictEqual(a, b, 'query variants get distinct paths');
    assert.true(a.endsWith('.mjs'), 'the extension survives');

    // A CDN entry URL has no extension, and its dots belong to the version.
    // Without a real extension the server would serve octet-stream and the
    // browser would refuse to execute the module.
    assert.strictEqual(
      urlToTreePath(new URL('https://esm.sh/three@0.160.0')),
      'esm.sh/three@0.160.0.mjs',
    );
    assert.strictEqual(
      urlToTreePath(new URL('https://unpkg.com/lit@3.1.0/index.js')),
      'unpkg.com/lit@3.1.0/index.js',
      'a real extension is left alone',
    );
  });

  test('the whole graph comes in and every reference points inside', async function (assert) {
    let result = await vendorFromCdn({
      entryUrl: 'https://esm.sh/three@0.160.0',
      fetchImpl: redirectingFetch,
    });
    assert.strictEqual(
      result.entryPath,
      'esm.sh/three@0.160.0/es2022/three.mjs',
      'the redirect resolved to the pinned URL',
    );
    assert.deepEqual(
      result.modules.map((m) => m.path),
      [
        'esm.sh/three@0.160.0/es2022/math.mjs',
        'esm.sh/three@0.160.0/es2022/side-effect.mjs',
        'esm.sh/three@0.160.0/es2022/three.mjs',
      ],
      'entry + static import + side-effect import all vendored',
    );
    let entry = result.files.find((f) => f.path === result.entryPath)!;
    let source = entry.bytes.toString();
    assert.false(
      source.includes('https://esm.sh'),
      'no absolute CDN URL survives in the vendored source',
    );
    assert.true(source.includes(`"./math.mjs"`), source);
    assert.true(source.includes(`"./side-effect.mjs"`), source);
  });

  test('a vendored graph packs, verifies, and declares itself', async function (assert) {
    let result = await vendorFromCdn({
      entryUrl: 'https://esm.sh/three@0.160.0',
      fetchImpl: redirectingFetch,
    });
    let files = [
      {
        path: 'importmap.json',
        bytes: vendorImportMap(
          'three',
          '0.160.0',
          result.entryPath,
          'https://esm.sh/three@0.160.0',
        ),
      },
      ...result.files,
    ];
    let opened = unpack(pack(files));
    assert.strictEqual(opened.files.size, 4);
    let map = JSON.parse(opened.files.get('importmap.json')!.toString());
    assert.strictEqual(map.deck.packages.three.version, '0.160.0');
    assert.strictEqual(
      map.deck.packages.three.entry,
      `$DECK/${result.entryPath}`,
    );
    assert.strictEqual(
      map.deck.packages.three.vendoredFrom,
      'https://esm.sh/three@0.160.0',
      'the canonical identity travels with the bytes',
    );
  });

  test('hermetic by default: a reference off-host is refused', async function (assert) {
    await assert.rejects(
      vendorFromCdn({
        entryUrl: 'https://esm.sh/leaky@1.0.0',
        fetchImpl,
      }),
      /would not be hermetic/,
      'a live CDN reference inside a "vendored" pack is not vendoring',
    );
    let allowed = await vendorFromCdn({
      entryUrl: 'https://esm.sh/leaky@1.0.0',
      fetchImpl,
      allowExternal: true,
    });
    assert.deepEqual(allowed.externals, [
      'https://cdn.example.com/other@1.0.0/index.mjs',
    ]);
    await assert.rejects(
      vendorFromCdn({
        entryUrl: 'https://esm.sh/leaky@1.0.0',
        fetchImpl,
        allowHosts: ['cdn.example.com'],
      }),
      /404 fetching https:\/\/cdn\.example\.com/,
      'an allowed host is FOLLOWED — a fetch failure there is a hard error, not a silent skip',
    );
  });

  test('query-bearing dependency URLs are followed and rewritten', async function (assert) {
    let result = await vendorFromCdn({
      entryUrl: 'https://esm.sh/withquery@1.0.0',
      fetchImpl,
    });
    assert.strictEqual(result.modules.length, 2);
    let entry = result.files.find((f) => f.path === result.entryPath)!;
    assert.false(entry.bytes.toString().includes('?target='));
  });

  test('caps refuse runaway graphs', async function (assert) {
    await assert.rejects(
      vendorFromCdn({
        entryUrl: 'https://esm.sh/three@0.160.0',
        fetchImpl: redirectingFetch,
        maxModules: 1,
      }),
      /module cap exceeded/,
    );
    await assert.rejects(
      vendorFromCdn({
        entryUrl: 'https://esm.sh/three@0.160.0',
        fetchImpl: redirectingFetch,
        maxBytes: 10,
      }),
      /byte cap exceeded/,
    );
  });
});
