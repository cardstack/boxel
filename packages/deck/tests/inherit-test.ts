import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  EXTENDS_MAX_DEPTH,
  flattenInheritance,
  isExactParent,
  parseExtends,
  parseLink,
  resolveInheritance,
  type DecklistLink,
} from '../src/inherit.ts';
import { resolveSpecifier } from '../src/resolve.ts';

module('extends: naming a parent', function () {
  test('a parent must be an exact version, never a tag', function (assert) {
    assert.true(isExactParent('acme/blog@1.2.3'));
    assert.true(isExactParent('acme/blog@1.2.3-dev.4'));
    // L4 is the whole reason inheritance is safe. A tag moves, so a child
    // that inherited through one would change meaning with nobody editing it.
    assert.false(isExactParent('acme/blog@latest'));
    assert.false(isExactParent('acme/blog@^1.2.3'));
    assert.false(isExactParent('acme/blog'));
  });

  // L4's requirement is that the parent cannot move. WHERE it lives is the
  // host's business, and a host that is not a depot has to be able to say so:
  // a Boxel realm names a parent with a fully-qualified URL today, and with a
  // scoped alias once the RRI migration lands. Refusing both made `extends`
  // a depot-only feature by accident.
  test('a parent may be depot-local, fully qualified, or a scoped alias', function (assert) {
    for (let ok of [
      'acme/blog@1.2.3',
      'https://app.example/catalog/acme/blog@1.2.3',
      'https://app.example/catalog/acme/blog@1.2.3/',
      'http://localhost:4201/catalog/acme/blog@1.2.3/',
      '@catalog/acme/blog@1.2.3',
      '@catalog/acme/blog@1.2.3/',
      '@catalog/acme/blog@2.0.0-dev.7/',
    ]) {
      assert.true(isExactParent(ok), ok);
    }
    // Exactness is still the rule in every space, and a name without a
    // version is not a parent in any of them.
    for (let no of [
      'https://app.example/catalog/acme/blog@latest/',
      'https://app.example/catalog/acme/blog@^1.2.3/',
      'https://app.example/catalog/acme/blog/',
      '@catalog/acme/blog@latest/',
      '@catalog/acme/blog/',
      '@catalog',
      'ftp://app.example/catalog/acme/blog@1.2.3/',
      'blog@1.2.3',
    ]) {
      assert.false(isExactParent(no), no);
    }
  });

  test('a decklist that does not inherit reports nothing', function (assert) {
    assert.strictEqual(parseExtends('{"deck":{"packages":{}}}'), undefined);
    assert.strictEqual(parseExtends('not json'), undefined);
  });

  test('a decklist that inherits reports its parent', function (assert) {
    assert.strictEqual(
      parseExtends('{"deck":{"extends":"acme/blog@3.2.0"}}'),
      'acme/blog@3.2.0',
    );
  });

  // Silently ignoring a bad parent would strip an app of most of its
  // dependencies and report it much later as unrelated import errors.
  test('an unusable parent throws rather than resolving to no parent', function (assert) {
    assert.throws(
      () => parseExtends('{"deck":{"extends":"acme/blog@latest"}}'),
      /exact version/,
    );
    assert.throws(
      () => parseExtends('{"deck":{"extends":42}}'),
      /exact version/,
    );
  });
});

module('extends: flattening a chain', function () {
  test('a child inherits what it does not mention', function (assert) {
    let flat = flattenInheritance([
      { imports: { a: '/parent/a.js', b: '/parent/b.js' } },
      { imports: { b: '/child/b.js' } },
    ]);
    assert.deepEqual(flat.imports, {
      a: '/parent/a.js',
      b: '/child/b.js',
    });
  });

  // The remix claim, as arithmetic: 200 entries in, one overridden, and the
  // child's decklist is one line.
  test('overriding one of many leaves the rest pointing at the parent', function (assert) {
    let parent: Record<string, string> = {};
    for (let i = 0; i < 200; i++) {
      parent[`app/mod-${i}`] = `/catalog/app@3.2.0/mod-${i}.js`;
    }
    let flat = flattenInheritance([
      { imports: parent },
      { imports: { 'app/mod-7': '/me/mine@1.0.0/mod-7.js' } },
    ]);
    assert.strictEqual(Object.keys(flat.imports).length, 200);
    assert.strictEqual(flat.imports['app/mod-7'], '/me/mine@1.0.0/mod-7.js');
    assert.strictEqual(
      flat.imports['app/mod-8'],
      '/catalog/app@3.2.0/mod-8.js',
    );
  });

  test('null removes an inherited entry outright', function (assert) {
    let flat = flattenInheritance([
      { imports: { a: '/parent/a.js', analytics: '/parent/spy.js' } },
      { imports: { analytics: null } },
    ]);
    assert.deepEqual(flat.imports, { a: '/parent/a.js' });
    // Removed means unresolvable, not blank: importing it is a load-time
    // error rather than something that looks present until it is called.
    assert.strictEqual(
      resolveSpecifier({
        specifier: 'analytics',
        fromUrl: '/me/app.js',
        imports: flat.imports,
        scopes: flat.scopes,
      }),
      undefined,
    );
  });

  test('chains apply ancestor first, child last', function (assert) {
    let flat = flattenInheritance([
      { imports: { a: '/g/a.js', b: '/g/b.js', c: '/g/c.js' } },
      { imports: { b: '/p/b.js', c: '/p/c.js' } },
      { imports: { c: '/c/c.js' } },
    ]);
    assert.deepEqual(flat.imports, {
      a: '/g/a.js',
      b: '/p/b.js',
      c: '/c/c.js',
    });
  });

  test('a chain past the depth limit is refused', function (assert) {
    let chain = Array.from({ length: EXTENDS_MAX_DEPTH + 1 }, () => ({
      imports: {},
    }));
    assert.throws(() => flattenInheritance(chain), /limit is 8/);
  });
});

module('extends: walking the chain', function () {
  const shelf: Record<string, string> = {
    'acme/base@1.0.0': JSON.stringify({
      imports: { a: '/acme/base@1.0.0/a.js', b: '/acme/base@1.0.0/b.js' },
    }),
    'acme/blog@3.2.0': JSON.stringify({
      deck: { extends: 'acme/base@1.0.0' },
      imports: { b: '/acme/blog@3.2.0/b.js', c: '/acme/blog@3.2.0/c.js' },
    }),
  };
  const load = async (parent: string) => {
    let text = shelf[parent];
    return text ? parseLink(text) : undefined;
  };

  test('a grandchild collects the whole ancestry', async function (assert) {
    let flat = await resolveInheritance({
      start: parseLink(
        JSON.stringify({
          deck: { extends: 'acme/blog@3.2.0' },
          imports: { c: '/me/mine@1.0.0/c.js' },
        }),
      ),
      load,
    });
    assert.deepEqual(flat.imports, {
      a: '/acme/base@1.0.0/a.js',
      b: '/acme/blog@3.2.0/b.js',
      c: '/me/mine@1.0.0/c.js',
    });
  });

  test('a decklist with no parent needs no loading', async function (assert) {
    let flat = await resolveInheritance({
      start: parseLink(JSON.stringify({ imports: { a: '/a.js' } })),
      load: async () => {
        assert.true(false, 'load must not be called');
        return undefined;
      },
    });
    assert.deepEqual(flat.imports, { a: '/a.js' });
  });

  // L11. An app quietly missing the entries it inherited is worse than a
  // startup error, and far harder to read.
  test('a parent that cannot be loaded fails closed, naming it', async function (assert) {
    await assert.rejects(
      resolveInheritance({
        start: { extends: 'acme/gone@9.9.9' },
        load: async () => undefined,
      }),
      /not available: acme\/gone@9\.9\.9/,
    );
  });

  test('a cycle is reported rather than followed', async function (assert) {
    const loop: Record<string, DecklistLink> = {
      'a/one@1.0.0': { extends: 'a/two@1.0.0' },
      'a/two@1.0.0': { extends: 'a/one@1.0.0' },
    };
    await assert.rejects(
      resolveInheritance({
        start: { extends: 'a/one@1.0.0' },
        load: async (p) => loop[p],
      }),
      /inheritance cycle/,
    );
  });

  test('parseLink reads imports, scopes and the parent together', function (assert) {
    let link = parseLink(
      JSON.stringify({
        imports: { a: '/a.js' },
        scopes: { '/x/': { a: '/x/a.js' } },
        deck: { extends: 'acme/base@1.0.0', packages: {} },
      }),
    );
    assert.deepEqual(link.imports, { a: '/a.js' });
    assert.deepEqual(link.scopes, { '/x/': { a: '/x/a.js' } });
    assert.strictEqual(link.extends, 'acme/base@1.0.0');
  });
});

module('extends: overrides and scopes', function () {
  // L7's dedupe corollary. Rebinding only the top level would leave every
  // vendored package importing the parent's copy — two copies of one library
  // in one document. Same rule `?with=` already applies to a trial.
  test('an override reaches inside an inherited scope', function (assert) {
    let flat = flattenInheritance([
      {
        imports: { three: '/catalog/three@0.169.0/three.js' },
        scopes: {
          '/catalog/widget@2.0.0/': {
            three: '/catalog/three@0.169.0/three.js',
          },
        },
      },
      { imports: { three: '/me/three@0.170.0/three.js' } },
    ]);
    assert.strictEqual(
      resolveSpecifier({
        specifier: 'three',
        fromUrl: '/catalog/widget@2.0.0/widget.js',
        imports: flat.imports,
        scopes: flat.scopes,
      }),
      '/me/three@0.170.0/three.js',
    );
  });

  // The escape hatch, and the reason rule 3 runs after rule 2: a dependency
  // that genuinely needs a different version says so, and keeps it.
  test('a scope the child declares itself outranks the rebind', function (assert) {
    let flat = flattenInheritance([
      {
        imports: { three: '/catalog/three@0.169.0/three.js' },
        scopes: {
          '/catalog/csg@0.0.16/': { three: '/catalog/three@0.160.0/three.js' },
        },
      },
      {
        imports: { three: '/me/three@0.170.0/three.js' },
        scopes: {
          '/catalog/csg@0.0.16/': { three: '/catalog/three@0.160.0/three.js' },
        },
      },
    ]);
    assert.strictEqual(
      resolveSpecifier({
        specifier: 'three',
        fromUrl: '/catalog/csg@0.0.16/index.js',
        imports: flat.imports,
        scopes: flat.scopes,
      }),
      '/catalog/three@0.160.0/three.js',
    );
    assert.strictEqual(
      resolveSpecifier({
        specifier: 'three',
        fromUrl: '/me/app.js',
        imports: flat.imports,
        scopes: flat.scopes,
      }),
      '/me/three@0.170.0/three.js',
    );
  });

  test('a child may drop an inherited scope entirely', function (assert) {
    let flat = flattenInheritance([
      { scopes: { '/catalog/old@1.0.0/': { a: '/catalog/a@1.js' } } },
      { scopes: { '/catalog/old@1.0.0/': null } },
    ]);
    assert.deepEqual(flat.scopes, {});
  });

  test('scope entries merge rather than replace the table', function (assert) {
    let flat = flattenInheritance([
      { scopes: { '/x/': { a: '/p/a.js', b: '/p/b.js' } } },
      { scopes: { '/x/': { b: '/c/b.js' } } },
    ]);
    assert.deepEqual(flat.scopes, { '/x/': { a: '/p/a.js', b: '/c/b.js' } });
  });
});
