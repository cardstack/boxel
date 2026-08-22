import QUnit from 'qunit';
const { module, test } = QUnit;
import { pack, unpack } from '../src/pack.ts';
import { carryHermetic, VENDOR_PREFIX } from '../src/pack-hermetic.ts';

// A CDN small enough to read. `three` has a two-module graph; `leaky`
// reaches a host the walker will not follow, which is the hermeticity
// failure this whole mode exists to refuse.
const CDN: Record<string, string> = {
  'https://esm.sh/three@0.160.0':
    `import { Vector3 } from "https://esm.sh/three@0.160.0/math.mjs";\nexport { Vector3 };\n`,
  'https://esm.sh/three@0.160.0/math.mjs': `export class Vector3 {}\n`,
  'https://esm.sh/leaky@1.0.0':
    `export * from "https://cdn.example.com/other@1.0.0/index.mjs";\n`,
};

let fetched: string[] = [];
const fetchImpl = (async (input: string | URL) => {
  let href = typeof input === 'string' ? input : input.href;
  fetched.push(href);
  let body = CDN[href];
  return body === undefined
    ? new Response('not found', { status: 404 })
    : new Response(body, { status: 200 });
}) as unknown as typeof fetch;

const MAP = {
  imports: { three: 'https://esm.sh/three@0.160.0' },
  deck: { packages: { app: { version: '1.0.0', entry: '$DECK/app.js' } } },
};

function tree(
  map: Record<string, unknown> = MAP,
): { path: string; bytes: Buffer }[] {
  return [
    {
      path: 'app.js',
      bytes: Buffer.from("import { Vector3 } from 'three';\n", 'utf8'),
    },
    {
      path: 'importmap.json',
      bytes: Buffer.from(JSON.stringify(map, null, 2) + '\n', 'utf8'),
    },
  ];
}

module('hermetic carriage', function (hooks) {
  hooks.beforeEach(() => {
    fetched = [];
  });

  test('the dependency rides inside, and the map points at it', async function (assert) {
    let carried = await carryHermetic({
      files: tree(),
      imports: MAP.imports,
      fetchImpl,
    });

    assert.deepEqual(
      carried.files.map((f) => f.path).sort(),
      [
        `${VENDOR_PREFIX}/esm.sh/three@0.160.0.mjs`,
        `${VENDOR_PREFIX}/esm.sh/three@0.160.0/math.mjs`,
        'app.js',
        'importmap.json',
      ].sort(),
      'the graph landed under the reserved prefix',
    );
    assert.strictEqual(
      carried.imports.three,
      `$DECK/${VENDOR_PREFIX}/esm.sh/three@0.160.0.mjs`,
      'the specifier now resolves inside the tree',
    );
    assert.strictEqual(carried.provenance.mode, 'hermetic');
    assert.deepEqual(carried.provenance.pruned, undefined, 'nothing pruned');
    assert.deepEqual(carried.provenance.carried, [
      {
        specifier: 'three',
        from: 'https://esm.sh/three@0.160.0',
        entry: `${VENDOR_PREFIX}/esm.sh/three@0.160.0.mjs`,
        modules: 2,
        bytes: carried.provenance.carried![0].bytes,
      },
    ]);
    assert.true(carried.provenance.carried![0].bytes > 0, 'bytes counted');
  });

  test("the tree's own manifest is rewritten, not just the returned map", async function (assert) {
    let carried = await carryHermetic({
      files: tree(),
      imports: MAP.imports,
      fetchImpl,
    });
    let manifest = carried.files.find((f) => f.path === 'importmap.json')!;
    let parsed = JSON.parse(manifest.bytes.toString('utf8'));
    assert.strictEqual(
      parsed.imports.three,
      `$DECK/${VENDOR_PREFIX}/esm.sh/three@0.160.0.mjs`,
      'the packlist may never contradict the map that travels with it',
    );
    assert.deepEqual(
      parsed.deck,
      MAP.deck,
      'everything the author wrote outside imports is untouched',
    );
  });

  test('the carried pack round-trips and verifies', async function (assert) {
    let carried = await carryHermetic({
      files: tree(),
      imports: MAP.imports,
      fetchImpl,
    });
    let bytes = pack(carried.files, {
      sourceBase: 'https://example.test/site/you/app/',
      version: '1.0.0',
      ...carried.provenance,
    });
    let opened = unpack(bytes);
    assert.strictEqual(
      opened.files.get(`${VENDOR_PREFIX}/esm.sh/three@0.160.0/math.mjs`)?.toString(),
      'export class Vector3 {}\n',
      'the dependency opens out of the pack',
    );
    assert.strictEqual(opened.packlist.provenance?.mode, 'hermetic');
    assert.strictEqual(opened.packlist.provenance?.carried?.length, 1);
    assert.strictEqual(pack(carried.files, {
      sourceBase: 'https://example.test/site/you/app/',
      version: '1.0.0',
      ...carried.provenance,
    }).equals(bytes), true, 'byte-reproducible');
  });

  test('a carried claim the pack cannot back is refused on unpack', async function (assert) {
    let carried = await carryHermetic({
      files: tree(),
      imports: MAP.imports,
      fetchImpl,
    });
    // The bytes stay out; only the claim travels. This is the shape a
    // hand-edited or truncated pack takes, and the one where believing the
    // provenance is worse than having none.
    let lying = pack(
      carried.files.filter((f) => !f.path.startsWith(`${VENDOR_PREFIX}/`)),
      { mode: 'hermetic', carried: carried.provenance.carried },
    );
    assert.throws(
      () => unpack(lying),
      /rides at _vendor\/esm\.sh\/three@0\.160\.0\.mjs, which the pack does not contain/,
    );
  });

  // L7's dedupe corollary: the same Version is the same bytes, so it lands
  // once no matter how many specifiers name it.
  test('two specifiers on one URL fetch once and land once', async function (assert) {
    let imports = {
      three: 'https://esm.sh/three@0.160.0',
      'vendor/three': 'https://esm.sh/three@0.160.0',
    };
    let carried = await carryHermetic({
      files: tree({ ...MAP, imports }),
      imports,
      fetchImpl,
    });
    assert.strictEqual(
      fetched.filter((u) => u === 'https://esm.sh/three@0.160.0').length,
      1,
      'fetched once',
    );
    assert.strictEqual(
      carried.files.filter((f) => f.path.startsWith(`${VENDOR_PREFIX}/`)).length,
      2,
      'two files, not four',
    );
    assert.strictEqual(carried.provenance.carried!.length, 2, 'both recorded');
    assert.strictEqual(
      carried.imports.three,
      carried.imports['vendor/three'],
      'both specifiers resolve to the same copy',
    );
  });

  test('a dependency that would stay live is refused, not quietly pruned', async function (assert) {
    let imports = { leaky: 'https://esm.sh/leaky@1.0.0' };
    try {
      await carryHermetic({
        files: tree({ ...MAP, imports }),
        imports,
        fetchImpl,
      });
      assert.true(false, 'expected a refusal');
    } catch (error) {
      let message = (error as Error).message;
      assert.true(/would not be hermetic/.test(message), `says why: ${message}`);
      assert.true(
        /no escape hatch/.test(message),
        'and says what to do instead',
      );
      assert.false(
        /allowExternal/.test(message),
        'without offering a flag this command does not have',
      );
    }
  });

  test('a tree that already uses the reserved prefix is refused', async function (assert) {
    try {
      await carryHermetic({
        files: [
          ...tree(),
          { path: `${VENDOR_PREFIX}/mine.js`, bytes: Buffer.from('x\n') },
        ],
        imports: MAP.imports,
        fetchImpl,
      });
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.true(
        /reserved for carried bytes/.test((error as Error).message),
        (error as Error).message,
      );
    }
  });

  test('a relative dependency with no sourceBase is refused, not guessed', async function (assert) {
    let imports = { palette: 'https://other.test/site/acme/palette@1.0.0/p.js' };
    // Same value, expressed the way a depot actually writes it.
    let relative = { palette: '/site/acme/palette@1.0.0/p.js' };
    try {
      await carryHermetic({
        files: tree({ ...MAP, imports: relative }),
        imports: relative,
        fetchImpl,
      });
      assert.true(false, 'expected a refusal');
    } catch (error) {
      assert.true(
        /no sourceBase says what it is relative to/.test(
          (error as Error).message,
        ),
        (error as Error).message,
      );
    }
    assert.strictEqual(Object.keys(imports).length, 1, 'fixture sanity');
  });

  test('a tree with nothing external is hermetic already', async function (assert) {
    let imports = { './local': './local.js', lodash: 'lodash' };
    let carried = await carryHermetic({
      files: tree({ ...MAP, imports }),
      imports,
      fetchImpl,
    });
    assert.deepEqual(fetched, [], 'nothing fetched');
    assert.strictEqual(carried.provenance.mode, 'hermetic');
    assert.strictEqual(carried.provenance.carried, undefined);
    assert.strictEqual(
      carried.files.filter((f) => f.path.startsWith(`${VENDOR_PREFIX}/`)).length,
      0,
    );
  });

  test('foreign references are recorded as pruned — no mode can carry them', async function (assert) {
    let carried = await carryHermetic({
      files: tree(),
      imports: MAP.imports,
      foreign: ['https://images.example/logo.png'],
      fetchImpl,
    });
    assert.deepEqual(carried.provenance.pruned, {
      unresolved: ['https://images.example/logo.png'],
    });
  });
});
