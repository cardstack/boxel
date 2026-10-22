import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pack } from '../src/pack.ts';
import { publishToStore } from '../src/store.ts';
import {
  applyLock,
  lockDeck,
  lockDepot,
  lineageOnlyImportMap,
  parseDepotLock,
  parseDependencyValue,
  resolveDependencies,
  resolveScopes,
  decksFromTreePaths,
  rewriteLiveTargetsIntoStep,
  rewriteImportMapIntoStep,
  unfrozenBindingsFromDepot,
  unfrozenBindingsFromTree,
  unfrozenKeysMissingFromLock,
} from '../src/lock.ts';
import { resolveSpecifier } from '../src/resolve.ts';
import {
  parseRRI,
  projectRRIImportMap,
  type RRIImportMap,
} from '../src/rri.ts';

let depotDir: string;
let storeDir: string;

function confetti(version: string) {
  return pack([
    {
      path: 'package.json',
      bytes: Buffer.from(
        JSON.stringify({
          name: 'confetti',
          version,
          type: 'module',
          exports: { '.': './confetti.js' },
        }),
      ),
    },
    {
      path: 'confetti.js',
      bytes: Buffer.from(`export const V = '${version}';\n`),
    },
  ]);
}

function projectForDemo(
  imports: Record<string, string>,
  scopes: Record<string, Record<string, string>>,
) {
  return projectRRIImportMap(
    { imports, scopes } as unknown as RRIImportMap,
    (value) => {
      let parsed = parseRRI(value);
      return `https://depot.test/demo/${parsed.scope}/${parsed.name}${parsed.version ? `@${parsed.version}` : ''}/${parsed.path}`;
    },
  );
}

function projectPathsForDemo(
  imports: Record<string, string>,
  scopes: Record<string, Record<string, string>>,
) {
  let projected = projectForDemo(imports, scopes);
  return {
    imports: Object.fromEntries(
      Object.entries(projected.imports).map(([key, value]) => [
        key,
        new URL(value).pathname,
      ]),
    ),
    scopes: Object.fromEntries(
      Object.entries(projected.scopes).map(([scope, table]) => [
        new URL(scope).pathname,
        Object.fromEntries(
          Object.entries(table).map(([key, value]) => [
            key,
            new URL(value).pathname,
          ]),
        ),
      ]),
    ),
  };
}

async function writeAppPackage(dependencies: Record<string, string>) {
  await writeFile(
    join(depotDir, 'me', 'app', 'package.json'),
    JSON.stringify(
      {
        name: 'app',
        version: '0.1.0',
        type: 'module',
        exports: { '.': './app.js' },
        dependencies,
      },
      null,
      2,
    ) + '\n',
  );
}

function lockApp() {
  return lockDepot({ depotDir, depotName: 'demo', storeDir });
}

module('the decklist lock: ranges in, pins out', function (hooks) {
  hooks.beforeEach(async function () {
    depotDir = join(await mkdtemp(join(tmpdir(), 'deck-lock-')), 'demo');
    storeDir = join(depotDir, '.deck', 'store');
    await mkdir(join(depotDir, 'me', 'app'), { recursive: true });
    await mkdir(join(depotDir, 'acme', 'confetti'), { recursive: true });
    await writeFile(
      join(depotDir, 'acme', 'confetti', 'package.json'),
      JSON.stringify({
        name: 'confetti',
        version: '2.0.0',
        type: 'module',
        exports: { '.': './confetti.js' },
      }),
    );
    await publishToStore(storeDir, 'acme/confetti', '1.0.0', confetti('1.0.0'));
    await publishToStore(
      storeDir,
      'acme/confetti',
      '1.2.0',
      confetti('1.2.0'),
      {
        tag: 'latest',
      },
    );
    await publishToStore(storeDir, 'acme/confetti', '2.0.0', confetti('2.0.0'));
    await publishToStore(
      storeDir,
      'acme/confetti',
      '1.3.0-dev.4',
      confetti('1.3.0-dev.4'),
      { tag: 'dev' },
    );
  });

  hooks.afterEach(async function () {
    await rm(join(depotDir, '..'), { recursive: true, force: true });
  });

  test('a range resolves to the highest STABLE that satisfies it', async function (assert) {
    await writeAppPackage({ 'acme/confetti': '^1.0.0' });
    let { resolutions, text, changed } = await lockApp();
    assert.true(changed);
    assert.strictEqual(resolutions[0].version, '1.2.0');
    assert.deepEqual(resolutions[0].imports, {
      'acme/confetti': '@acme/confetti@1.2.0/confetti.js',
      'acme/confetti/': '@acme/confetti@1.2.0/',
    });
    let map = JSON.parse(text);
    assert.strictEqual(
      map.imports['acme/confetti'],
      '@acme/confetti@1.2.0/confetti.js',
      'the lock records logical identity; the host projects it for browsers',
    );
    assert.deepEqual(
      JSON.parse(
        await readFile(join(depotDir, 'me', 'app', 'package.json'), 'utf8'),
      ).dependencies,
      { 'acme/confetti': '^1.0.0' },
      'the RANGE stays in package.json: intent is not overwritten by what it resolved to',
    );
  });

  test('a range never picks up a prerelease; the dev tag is how you opt in', async function (assert) {
    await writeAppPackage({ 'acme/confetti': '^1.0.0' });
    let ranged = await lockApp();
    assert.strictEqual(
      ranged.resolutions[0].version,
      '1.2.0',
      '1.3.0-dev.4 satisfies ^1.0.0 numerically, and is still not chosen',
    );

    await writeAppPackage({ 'acme/confetti': 'dev' });
    let tagged = await lockApp();
    assert.strictEqual(tagged.resolutions[0].version, '1.3.0-dev.4');
    assert.deepEqual(tagged.resolutions[0].imports, {
      'acme/confetti': '@acme/confetti@1.3.0-dev.4/confetti.js',
      'acme/confetti/': '@acme/confetti@1.3.0-dev.4/',
    });
  });

  test('"workspace:*" pins to the working tree; "live" is a read synonym', async function (assert) {
    await writeAppPackage({ 'acme/confetti': 'workspace:*' });
    let canonical = await lockApp();
    assert.strictEqual(canonical.resolutions[0].version, undefined);
    assert.deepEqual(canonical.resolutions[0].imports, {
      'acme/confetti': '@acme/confetti/confetti.js',
      'acme/confetti/': '@acme/confetti/',
    });

    await writeAppPackage({ 'acme/confetti': 'live' });
    let synonym = await lockApp();
    assert.deepEqual(
      synonym.resolutions[0].imports,
      canonical.resolutions[0].imports,
    );
  });

  test('an exact pin, and a tag, resolve as themselves', async function (assert) {
    await writeAppPackage({ 'acme/confetti': '2.0.0' });
    let exact = await lockApp();
    assert.strictEqual(exact.resolutions[0].version, '2.0.0');

    await writeAppPackage({ 'acme/confetti': 'latest' });
    let tagged = await lockApp();
    assert.strictEqual(tagged.resolutions[0].version, '1.2.0');
    assert.deepEqual(
      tagged.resolutions[0].imports,
      {
        'acme/confetti': '@acme/confetti@1.2.0/confetti.js',
        'acme/confetti/': '@acme/confetti@1.2.0/',
      },
      'a dist-tag resolves to an exact Version in the canonical lock',
    );
  });

  test('locking twice is a no-op; moving the range moves the pin', async function (assert) {
    await writeAppPackage({ 'acme/confetti': '^1.0.0' });
    let first = await lockApp();
    await writeFile(join(depotDir, 'importmap.json'), first.text);

    let again = await lockApp();
    assert.false(again.changed, 'a settled lock writes nothing');

    await writeAppPackage({ 'acme/confetti': '^2.0.0' });
    let moved = await lockApp();
    assert.true(moved.changed);
    assert.strictEqual(moved.resolutions[0].version, '2.0.0');
    assert.strictEqual(
      moved.resolutions[0].previous,
      '@acme/confetti@1.2.0/confetti.js',
      'the report says what it moved from',
    );
  });

  // A fork stands in for its base under the BASE's specifier, so the
  // consumer's own `import … from 'acme/confetti'` keeps working.
  test('a dependency value may alias another deck', async function (assert) {
    assert.deepEqual(parseDependencyValue('^1.0.0'), { spec: '^1.0.0' });
    assert.deepEqual(parseDependencyValue('live'), { spec: 'live' });
    assert.deepEqual(parseDependencyValue('you/confetti@live'), {
      target: 'you/confetti',
      spec: 'live',
    });
    assert.deepEqual(parseDependencyValue('you/confetti@^1.0.0'), {
      target: 'you/confetti',
      spec: '^1.0.0',
    });
    assert.deepEqual(
      parseDependencyValue('you/confetti'),
      { target: 'you/confetti', spec: 'live' },
      'a bare deck name means live — what a fork wants',
    );
  });

  test('an alias repoints a specifier without renaming it', async function (assert) {
    await mkdir(join(depotDir, 'you', 'confetti'), { recursive: true });
    await writeFile(
      join(depotDir, 'you', 'confetti', 'package.json'),
      JSON.stringify({
        name: 'confetti',
        version: '1.2.0',
        type: 'module',
        exports: { '.': './confetti.js' },
      }),
    );
    await writeAppPackage({ 'acme/confetti': 'you/confetti@live' });
    let { resolutions, text } = await lockApp();
    assert.strictEqual(resolutions[0].key, 'acme/confetti');
    assert.strictEqual(resolutions[0].alias, 'you/confetti');
    assert.strictEqual(resolutions[0].publisher, 'you');
    let map = JSON.parse(text);
    assert.strictEqual(
      map.imports['acme/confetti'],
      '@you/confetti/confetti.js',
      'the specifier the consumer writes now resolves to the fork',
    );
    assert.strictEqual(
      map.imports['you/confetti'],
      undefined,
      'no second specifier appears — nothing in the consumer has to change',
    );
  });

  test('an alias to a published fork resolves its range', async function (assert) {
    await publishToStore(storeDir, 'you/confetti', '1.5.0', confetti('1.5.0'));
    await writeAppPackage({ 'acme/confetti': 'you/confetti@^1.0.0' });
    let { resolutions } = await lockApp();
    assert.strictEqual(resolutions[0].version, '1.5.0');
    assert.deepEqual(resolutions[0].imports, {
      'acme/confetti': '@you/confetti@1.5.0/confetti.js',
      'acme/confetti/': '@you/confetti@1.5.0/',
    });
  });

  test('an alias to a deck that does not parse is refused', async function (assert) {
    await writeAppPackage({ 'acme/confetti': 'a/b/c/d@live' });
    await assert.rejects(lockApp(), /aliases "a\/b\/c\/d"/);
  });

  test('unsatisfiable, unknown, and cross-depot dependencies are refused', async function (assert) {
    await assert.rejects(
      resolveDependencies({
        depotDir,
        depotName: 'demo',
        storeDir,
        dependencies: { 'acme/confetti': '^9.0.0' },
      }),
      /no published version satisfies "\^9\.0\.0"/,
    );
    await assert.rejects(
      resolveDependencies({
        depotDir,
        depotName: 'demo',
        storeDir,
        dependencies: { 'acme/nope': '^1.0.0' },
      }),
      /has no published versions/,
    );
    await assert.rejects(
      resolveDependencies({
        depotDir,
        depotName: 'demo',
        storeDir,
        dependencies: { 'other/acme/confetti': '^1.0.0' },
      }),
      /only demo can be locked from here/,
      'a pin nobody can serve is worse than an error',
    );
    await assert.rejects(
      resolveDependencies({
        depotDir,
        depotName: 'demo',
        storeDir,
        dependencies: { 'definitely-not-a-package': '^1.0.0' },
      }),
      /is not an npm name/,
    );
  });

  test('dropping a dependency drops its pins', function (assert) {
    let text = JSON.stringify(
      {
        imports: {
          'acme/palette': '@acme/palette@1.1.0/palette.js',
          'acme/palette/': '@acme/palette@1.1.0/',
          'some-other/': '/elsewhere/',
          'acme/kept': '@acme/kept@1.0.0/k.js',
        },
      },
      null,
      2,
    );
    let { text: locked, changed } = applyLock(text, [
      {
        key: 'acme/kept',
        depot: 'demo',
        publisher: 'acme',
        package: 'kept',
        spec: '^1.0.0',
        version: '1.0.0',
        imports: { 'acme/kept': '@acme/kept@1.0.0/k.js' },
      },
    ]);
    assert.true(changed);
    assert.deepEqual(JSON.parse(locked).imports, {
      'acme/kept': '@acme/kept@1.0.0/k.js',
      'some-other/': '/elsewhere/',
    });
  });

  // A page importing `app/gallery` gets a top-level pin for it — but the
  // gallery's OWN bare specifiers only resolve if a scope carries them. That
  // scope was emitted for aliased dependencies and silently skipped for
  // un-aliased ones, which is the ordinary spelling, so pages that composed
  // decks by name broke in the browser while every test passed.
  test('a scope is emitted for a dependency declared by its own name', async function (assert) {
    await publishToStore(
      storeDir,
      'me/widget',
      '1.0.0',
      pack([
        {
          path: 'package.json',
          bytes: Buffer.from(
            JSON.stringify({
              name: 'widget',
              version: '1.0.0',
              type: 'module',
              exports: { '.': './w.js' },
              dependencies: { 'acme/confetti': '^1.0.0' },
            }),
          ),
        },
        { path: 'w.js', bytes: Buffer.from("import 'acme/confetti';\n") },
      ]),
      { tag: 'latest' },
    );
    await writeAppPackage({ 'me/widget': '^1.0.0' });
    let resolutions = await resolveDependencies({
      depotDir,
      depotName: 'demo',
      storeDir,
      dependencies: { 'me/widget': '^1.0.0' },
    });
    let scopes = await resolveScopes({
      depotName: 'demo',
      storeDir,
      roots: resolutions,
    });
    assert.deepEqual(
      scopes,
      [
        {
          scope: '@me/widget@1.0.0/',
          imports: {
            'acme/confetti/': '@acme/confetti@1.2.0/',
            'acme/confetti': '@acme/confetti@1.2.0/confetti.js',
          },
        },
      ],
      "the widget's own specifier resolves inside the widget's URL prefix",
    );
  });

  // W10's first proof, and P1's acceptance test for the Boxel backport.
  //
  // `~/boxel-workspaces` holds three@0.160.0 and three@0.169.0, live, in
  // different cards. A flat prefix map — all `VirtualNetwork.resolveImport`
  // can express today — cannot serve both under one specifier, because it is
  // never told who is importing. Scopes can, and this is the whole mechanism
  // in one test: one specifier, two versions, chosen by the importer's URL,
  // with no query string and no second document.
  test('two versions of one library are live at once, chosen by the importer', async function (assert) {
    await publishToStore(
      storeDir,
      'me/widget',
      '1.0.0',
      pack([
        {
          path: 'package.json',
          bytes: Buffer.from(
            JSON.stringify({
              name: 'widget',
              version: '1.0.0',
              type: 'module',
              exports: { '.': './w.js' },
              dependencies: { 'acme/confetti': '^1.0.0' },
            }),
          ),
        },
        { path: 'w.js', bytes: Buffer.from("import 'acme/confetti';\n") },
      ]),
      { tag: 'latest' },
    );
    // The app is on 2.x, and also uses the widget.
    let dependencies = { 'me/widget': '^1.0.0', 'acme/confetti': '^2.0.0' };
    await writeAppPackage(dependencies);
    let resolutions = await resolveDependencies({
      depotDir,
      depotName: 'demo',
      storeDir,
      dependencies,
    });
    let imports = Object.fromEntries(
      resolutions.flatMap((r) =>
        r.version
          ? [
              [
                `${r.publisher}/${r.package}`,
                `@${r.publisher}/${r.package}@${r.version}/`,
              ],
            ]
          : [],
      ),
    );
    let scopes = Object.fromEntries(
      (
        await resolveScopes({ depotName: 'demo', storeDir, roots: resolutions })
      ).map((s) => [s.scope, s.imports]),
    );

    assert.strictEqual(
      imports['acme/confetti'],
      '@acme/confetti@2.0.0/',
      'the app gets 2.0.0 at the top level',
    );
    assert.strictEqual(
      scopes['@me/widget@1.0.0/']['acme/confetti'],
      '@acme/confetti@1.2.0/confetti.js',
      'and the widget keeps 1.2.0 inside its own prefix',
    );

    let projected = projectForDemo(imports, scopes);

    // The resolver is what has to agree, not only the map. Same specifier,
    // two answers, and the only thing that differs is who asked.
    assert.strictEqual(
      resolveSpecifier({
        specifier: 'acme/confetti',
        fromUrl: 'https://depot.test/demo/me/app/app.js',
        imports: projected.imports,
        scopes: projected.scopes,
      }),
      'https://depot.test/demo/acme/confetti@2.0.0/',
    );
    assert.strictEqual(
      resolveSpecifier({
        specifier: 'acme/confetti',
        fromUrl: 'https://depot.test/demo/me/widget@1.0.0/w.js',
        imports: projected.imports,
        scopes: projected.scopes,
      }),
      'https://depot.test/demo/acme/confetti@1.2.0/confetti.js',
      'two live versions, one document, distinguished only by the importer',
    );
  });

  test('a live dependency gets no scope — there is no sealed state to name', async function (assert) {
    await publishToStore(
      storeDir,
      'me/widget',
      '1.0.0',
      pack([
        {
          path: 'package.json',
          bytes: Buffer.from(
            JSON.stringify({
              name: 'widget',
              version: '1.0.0',
              type: 'module',
              exports: { '.': './w.js' },
              dependencies: { 'acme/confetti': 'workspace:*' },
            }),
          ),
        },
        { path: 'w.js', bytes: Buffer.from("import 'acme/confetti';\n") },
      ]),
      { tag: 'latest' },
    );
    let scopes = await resolveScopes({
      depotName: 'demo',
      storeDir,
      roots: await resolveDependencies({
        depotDir,
        depotName: 'demo',
        storeDir,
        dependencies: { 'me/widget': '^1.0.0' },
      }),
    });
    assert.deepEqual(scopes, []);
  });

  test('applyLock only touches the specifiers it owns', function (assert) {
    let text = JSON.stringify({ imports: { 'a/': '/a/' } }, null, 2);
    let { text: locked } = applyLock(text, [
      {
        key: 'acme/confetti',
        depot: 'demo',
        publisher: 'acme',
        package: 'confetti',
        spec: '^1.0.0',
        version: '1.2.0',
        imports: { 'acme/confetti/': '@acme/confetti@1.2.0/' },
      },
    ]);
    assert.deepEqual(JSON.parse(locked).imports, {
      'a/': '/a/',
      'acme/confetti/': '@acme/confetti@1.2.0/',
    });
  });

  test('a per-pack import map keeps lineage and drops pins', function (assert) {
    assert.strictEqual(
      lineageOnlyImportMap(
        JSON.stringify({
          imports: { 'acme/confetti': '@acme/confetti@1.2.0/confetti.js' },
          deck: {
            packages: {
              app: {
                version: '1.0.0',
                entry: '$DECK/app.js',
                forkedFrom: { package: 'acme/app', version: '1.0.0' },
              },
            },
            dependencies: { 'acme/confetti': '^1.0.0' },
          },
        }),
      ),
      JSON.stringify(
        {
          deck: {
            packages: {
              app: { forkedFrom: { package: 'acme/app', version: '1.0.0' } },
            },
          },
        },
        null,
        2,
      ) + '\n',
    );
    assert.strictEqual(
      lineageOnlyImportMap(
        JSON.stringify({
          imports: { x: '/x' },
          deck: {
            packages: { app: { version: '1.0.0', entry: '$DECK/a.js' } },
          },
        }),
      ),
      '',
      'no lineage → the file should go',
    );
  });

  test('lockDeck no longer writes pins into the package map', async function (assert) {
    await writeAppPackage({ 'acme/confetti': '^1.0.0' });
    await writeFile(
      join(depotDir, 'me', 'app', 'importmap.json'),
      JSON.stringify({
        imports: { 'acme/confetti': '@acme/confetti@1.0.0/confetti.js' },
        deck: {
          packages: { app: { version: '0.1.0', entry: '$DECK/app.js' } },
          dependencies: { 'acme/confetti': '^1.0.0' },
        },
      }) + '\n',
    );
    let stripped = await lockDeck({
      depotDir,
      depotName: 'demo',
      storeDir,
      deckDir: join(depotDir, 'me', 'app'),
    });
    assert.strictEqual(stripped.text, '');
    assert.true(stripped.changed);
    assert.strictEqual(stripped.resolutions[0].version, '1.2.0');
  });
});

module(
  'the depot lock: package.json suggests, importmap decides',
  function (hooks) {
    hooks.beforeEach(async function () {
      depotDir = join(
        await mkdtemp(join(tmpdir(), 'deck-depot-lock-')),
        'demo',
      );
      storeDir = join(depotDir, '.deck', 'store');
      await mkdir(join(depotDir, 'me', 'app'), { recursive: true });
      await writeFile(
        join(depotDir, 'me', 'app', 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '0.1.0',
          exports: { '.': './app.js' },
          dependencies: { confetti: '^1.0.0' },
        }) + '\n',
      );
      await writeFile(join(depotDir, 'me', 'app', 'app.js'), 'export {}\n');
      await publishToStore(
        storeDir,
        'acme/confetti',
        '1.0.0',
        pack([
          {
            path: 'package.json',
            bytes: Buffer.from(
              JSON.stringify({
                name: 'confetti',
                version: '1.0.0',
                exports: { '.': './confetti.js' },
              }),
            ),
          },
          {
            path: 'confetti.js',
            bytes: Buffer.from(`export const V = '1.0.0';\n`),
          },
        ]),
      );
      await publishToStore(
        storeDir,
        'acme/confetti',
        '1.2.0',
        pack([
          {
            path: 'package.json',
            bytes: Buffer.from(
              JSON.stringify({
                name: 'confetti',
                version: '1.2.0',
                exports: { '.': './confetti.js' },
              }),
            ),
          },
          {
            path: 'confetti.js',
            bytes: Buffer.from(`export const V = '1.2.0';\n`),
          },
        ]),
        { tag: 'latest' },
      );
      await publishToStore(
        storeDir,
        'acme/confetti',
        '2.0.0',
        pack([
          {
            path: 'package.json',
            bytes: Buffer.from(
              JSON.stringify({
                name: 'confetti',
                version: '2.0.0',
                exports: { '.': './confetti.js' },
              }),
            ),
          },
          {
            path: 'confetti.js',
            bytes: Buffer.from(`export const V = '2.0.0';\n`),
          },
        ]),
      );
    });

    hooks.afterEach(async function () {
      await rm(join(depotDir, '..'), { recursive: true, force: true });
    });

    test('create lock picks the newest version that satisfies the range', async function (assert) {
      let { resolutions, text, changed, integrity } = await lockDepot({
        depotDir,
        depotName: 'demo',
        storeDir,
      });
      assert.true(changed);
      assert.strictEqual(resolutions[0].version, '1.2.0');
      assert.strictEqual(
        resolutions[0].imports.confetti,
        '@acme/confetti@1.2.0/confetti.js',
      );
      let lock = parseDepotLock(text);
      assert.strictEqual(
        lock.imports.confetti,
        '@acme/confetti@1.2.0/confetti.js',
      );
      assert.true(
        lock.integrity['@acme/confetti@1.2.0/confetti.js']?.startsWith(
          'sha256-',
        ),
        'integrity is SRI of the pinned entry',
      );
      assert.ok(integrity['@acme/confetti@1.2.0/confetti.js']);
      assert.equal(
        lock.scopes['@me/app/'],
        undefined,
        'importer scope that copies imports is omitted',
      );
    });

    test('a second lock without --update keeps the pin even if a newer in-range version appears', async function (assert) {
      let first = await lockDepot({ depotDir, depotName: 'demo', storeDir });
      await writeFile(join(depotDir, 'importmap.json'), first.text);
      await publishToStore(
        storeDir,
        'acme/confetti',
        '1.9.0',
        pack([
          {
            path: 'package.json',
            bytes: Buffer.from(
              JSON.stringify({
                name: 'confetti',
                version: '1.9.0',
                exports: { '.': './confetti.js' },
              }),
            ),
          },
          {
            path: 'confetti.js',
            bytes: Buffer.from(`export const V = '1.9.0';\n`),
          },
        ]),
      );
      let again = await lockDepot({ depotDir, depotName: 'demo', storeDir });
      assert.strictEqual(again.resolutions[0].version, '1.2.0');
      let updated = await lockDepot({
        depotDir,
        depotName: 'demo',
        storeDir,
        update: true,
      });
      assert.strictEqual(updated.resolutions[0].version, '1.9.0');
    });

    test('widening the range without --update keeps the existing pin', async function (assert) {
      let first = await lockDepot({ depotDir, depotName: 'demo', storeDir });
      await writeFile(join(depotDir, 'importmap.json'), first.text);
      await writeFile(
        join(depotDir, 'me', 'app', 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '0.1.0',
          exports: { '.': './app.js' },
          dependencies: { confetti: '*' },
        }) + '\n',
      );
      let stale = await lockDepot({ depotDir, depotName: 'demo', storeDir });
      assert.strictEqual(
        stale.resolutions[0].version,
        '1.2.0',
        'the owner has not asked to update, so 1.2.0 stays even though 2.0.0 matches *',
      );
    });

    test('overrides beat the suggestion', async function (assert) {
      let locked = await lockDepot({
        depotDir,
        depotName: 'demo',
        storeDir,
        overrides: { confetti: '2.0.0' },
      });
      assert.strictEqual(locked.resolutions[0].version, '2.0.0');
      assert.deepEqual(parseDepotLock(locked.text).overrides, {
        confetti: '2.0.0',
      });
    });

    test('continuous is recorded on the lock', async function (assert) {
      let locked = await lockDepot({
        depotDir,
        depotName: 'demo',
        storeDir,
        continuous: true,
      });
      assert.true(parseDepotLock(locked.text).continuous);
    });

    test('integrity hashes sealed pins, not live workspace files', async function (assert) {
      await mkdir(join(depotDir, 'acme', 'palette'), { recursive: true });
      await writeFile(
        join(depotDir, 'acme', 'palette', 'package.json'),
        JSON.stringify({
          name: 'palette',
          version: '0.1.0',
          exports: { '.': './palette.js' },
        }) + '\n',
      );
      await writeFile(
        join(depotDir, 'acme', 'palette', 'palette.js'),
        'export {}\n',
      );
      await writeFile(
        join(depotDir, 'me', 'app', 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '0.1.0',
          exports: { '.': './app.js' },
          dependencies: {
            confetti: '^1.0.0',
            'acme/palette': 'workspace:*',
          },
        }) + '\n',
      );
      let lock = parseDepotLock(
        (await lockDepot({ depotDir, depotName: 'demo', storeDir })).text,
      );
      assert.ok(lock.integrity['@acme/confetti@1.2.0/confetti.js']);
      assert.equal(
        lock.integrity['@acme/palette/palette.js'],
        undefined,
        'live files are not hashed into the lock',
      );
    });

    test('a nested scope is kept when it disagrees with imports', async function (assert) {
      await publishToStore(
        storeDir,
        'me/widget',
        '1.0.0',
        pack([
          {
            path: 'package.json',
            bytes: Buffer.from(
              JSON.stringify({
                name: 'widget',
                version: '1.0.0',
                type: 'module',
                exports: { '.': './w.js' },
                dependencies: { 'acme/confetti': '^1.0.0' },
              }),
            ),
          },
          { path: 'w.js', bytes: Buffer.from("import 'acme/confetti';\n") },
        ]),
        { tag: 'latest' },
      );
      await writeFile(
        join(depotDir, 'me', 'app', 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '0.1.0',
          exports: { '.': './app.js' },
          dependencies: { 'me/widget': '^1.0.0', confetti: '^2.0.0' },
        }) + '\n',
      );
      let lock = parseDepotLock(
        (await lockDepot({ depotDir, depotName: 'demo', storeDir })).text,
      );
      assert.strictEqual(
        lock.imports.confetti,
        '@acme/confetti@2.0.0/confetti.js',
      );
      assert.strictEqual(
        lock.scopes['@me/widget@1.0.0/']?.['acme/confetti'],
        '@acme/confetti@1.2.0/confetti.js',
      );
    });

    test('unfrozenKeysMissingFromLock is empty when the depot lock already pins', async function (assert) {
      await writeFile(
        join(depotDir, 'me', 'app', 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '0.1.0',
          exports: { '.': './app.js' },
          dependencies: {
            confetti: 'latest',
            'acme/palette': 'workspace:*',
          },
        }) + '\n',
      );
      assert.deepEqual(
        await unfrozenKeysMissingFromLock({
          depotDir,
          lockImports: {},
        }),
        ['acme/palette', 'confetti'],
        'no lock → every unfrozen key is a gap',
      );
      assert.deepEqual(
        await unfrozenKeysMissingFromLock({
          depotDir,
          lockImports: {
            confetti: '@acme/confetti@1.2.0/confetti.js',
            'acme/palette': '@acme/palette/palette.js',
          },
        }),
        [],
        'compiled lock → serve skips the store walk',
      );
      assert.deepEqual(
        await unfrozenKeysMissingFromLock({
          depotDir,
          lockImports: {
            confetti: '@acme/confetti@1.2.0/confetti.js',
          },
        }),
        ['acme/palette'],
        'partial lock → only the missing unfrozen key',
      );
    });

    test('unfrozenBindingsFromDepot skips ranges and floats tags and workspace:*', async function (assert) {
      await writeFile(
        join(depotDir, 'me', 'app', 'package.json'),
        JSON.stringify({
          name: 'app',
          version: '0.1.0',
          exports: { '.': './app.js' },
          dependencies: {
            confetti: 'latest',
            'acme/confetti': 'workspace:*',
          },
        }) + '\n',
      );
      await mkdir(join(depotDir, 'acme', 'confetti'), { recursive: true });
      await writeFile(
        join(depotDir, 'acme', 'confetti', 'package.json'),
        JSON.stringify({
          name: 'confetti',
          version: '1.2.0',
          exports: { '.': './confetti.js' },
        }) + '\n',
      );
      await writeFile(
        join(depotDir, 'acme', 'confetti', 'confetti.js'),
        'export const V = "live";\n',
      );
      let unfrozen = await unfrozenBindingsFromDepot({
        depotDir,
        depotName: 'demo',
        storeDir,
      });
      assert.strictEqual(
        unfrozen.imports.confetti,
        '@acme/confetti@1.2.0/confetti.js',
      );
      assert.strictEqual(
        unfrozen.imports['acme/confetti'],
        '@acme/confetti/confetti.js',
      );
      assert.strictEqual(
        unfrozen.scopes['@me/app/']?.confetti,
        '@acme/confetti@1.2.0/confetti.js',
      );
    });

    test('decksFromTreePaths only takes depth-two package.json', function (assert) {
      assert.deepEqual(
        decksFromTreePaths([
          'importmap.json',
          'me/app/package.json',
          'me/app/index.html',
          'acme/palette/package.json',
          'acme/palette/nested/package.json',
          'bad/package.json',
        ]),
        [
          { publisher: 'acme', package: 'palette', name: 'acme/palette' },
          { publisher: 'me', package: 'app', name: 'me/app' },
        ],
      );
    });

    test('rewriteLiveTargetsIntoStep rewrites versionless URLs only', function (assert) {
      assert.strictEqual(
        rewriteLiveTargetsIntoStep(
          'demo',
          'aabbccdd',
          '/demo/acme/palette/palette.js',
        ),
        '/demo/_history/aabbccdd/acme/palette/palette.js',
      );
      assert.strictEqual(
        rewriteLiveTargetsIntoStep(
          'demo',
          'aabbccdd',
          '/demo/acme/confetti@latest/confetti.js',
        ),
        '/demo/acme/confetti@latest/confetti.js',
        'dist-tags stay store identity',
      );
      assert.strictEqual(
        rewriteLiveTargetsIntoStep(
          'demo',
          'aabbccdd',
          '/demo/acme/confetti@1.2.0/confetti.js',
        ),
        '/demo/acme/confetti@1.2.0/confetti.js',
      );
      assert.strictEqual(
        rewriteLiveTargetsIntoStep(
          'demo',
          'aabbccdd',
          '/demo/_history/oldrev/acme/palette/palette.js',
        ),
        '/demo/_history/oldrev/acme/palette/palette.js',
        'already-at-step URLs are left alone',
      );
    });

    test('unfrozenBindingsFromTree reads a Step tree, not the live disk', async function (assert) {
      let stepFiles: Record<string, string> = {
        'me/app/package.json': JSON.stringify({
          name: 'app',
          version: '0.1.0',
          exports: { '.': './app.js' },
          dependencies: { 'acme/palette': 'workspace:*' },
        }),
        'acme/palette/package.json': JSON.stringify({
          name: 'palette',
          version: '0.1.0',
          exports: { '.': './old.js' },
        }),
      };
      // Live disk says a different entry — the Step must not see it.
      await mkdir(join(depotDir, 'acme', 'palette'), { recursive: true });
      await writeFile(
        join(depotDir, 'acme', 'palette', 'package.json'),
        JSON.stringify({
          name: 'palette',
          version: '9.9.9',
          exports: { '.': './live.js' },
        }) + '\n',
      );
      let unfrozen = await unfrozenBindingsFromTree({
        depotName: 'demo',
        storeDir,
        decks: decksFromTreePaths(Object.keys(stepFiles)),
        readTreeFile: async (path) => stepFiles[path],
      });
      assert.strictEqual(
        unfrozen.imports['acme/palette'],
        '@acme/palette/old.js',
        'entry comes from the Step package.json',
      );
      let projected = projectPathsForDemo(unfrozen.imports, unfrozen.scopes);
      let rewritten = rewriteImportMapIntoStep(
        'demo',
        'step0001',
        projected.imports,
        projected.scopes,
      );
      assert.strictEqual(
        rewritten.imports['acme/palette'],
        '/demo/_history/step0001/acme/palette/old.js',
      );
      assert.strictEqual(
        rewritten.scopes['/demo/_history/step0001/me/app/']?.['acme/palette'],
        '/demo/_history/step0001/acme/palette/old.js',
      );
    });
  },
);
