import QUnit from 'qunit';
const { module, test } = QUnit;
import {
  createPacklist,
  intakeReadiness,
  parsePacklist,
  serializePacklist,
  type PackProvenance,
} from '../src/packlist.ts';
import { hashBytes } from '../src/tree-hash.ts';

const FILES = [
  { path: 'index.js', bytes: Buffer.from('export const a = 1;\n') },
  { path: 'importmap.json', bytes: Buffer.from('{"imports":{}}\n') },
].map((f) => ({
  path: f.path,
  size: f.bytes.length,
  sha256: hashBytes(f.bytes),
}));

const FULL: PackProvenance = {
  sourceDepot: 'site',
  sourceBase: 'https://realms.example/chris/notes/',
  package: 'chris/notes',
  version: '1.4.0',
  mode: 'bare',
  pruned: {
    external: [
      { specifier: '@cardstack/base/', from: 'https://cardstack.com/base/' },
    ],
    unresolved: ['https://other-realm.example/someone/card.json'],
  },
  resolved: { imports: { 'notes/theme': '/site/chris/notes@1.4.0/theme.js' } },
  toolchain: { terser: '5.49.2' },
};

module('provenance: what a pack says about itself', function () {
  test('a full block round-trips through serialize and parse', function (assert) {
    let packlist = createPacklist(FILES, FULL);
    let back = parsePacklist(serializePacklist(packlist));
    assert.deepEqual(back.provenance, FULL);
  });

  // A canonical pack has to be byte-reproducible (L2), so nothing in the
  // packlist may come from a clock or the environment. Absence of
  // provenance must stay absence, not become an empty object with a
  // timestamp in it.
  test('no provenance is supplied by default', function (assert) {
    let packlist = createPacklist(FILES);
    assert.strictEqual(packlist.provenance, undefined);
    assert.true(
      serializePacklist(packlist).equals(
        serializePacklist(createPacklist(FILES)),
      ),
      'two packlists over the same files are byte-identical',
    );
  });

  test('provenance does not disturb the tree hash', function (assert) {
    assert.strictEqual(
      createPacklist(FILES, FULL).treeHash.hash,
      createPacklist(FILES).treeHash.hash,
      'the tree is the subject; provenance describes it',
    );
  });
});

module('provenance: fail closed on malformed input', function () {
  function refuses(mutate: (p: Record<string, unknown>) => void, like: RegExp) {
    let packlist = createPacklist(FILES, FULL);
    let raw = JSON.parse(serializePacklist(packlist).toString('utf8'));
    mutate(raw.provenance);
    return { raw, like };
  }

  test('an unknown mode is refused rather than ignored', function (assert) {
    let { raw, like } = refuses((p) => {
      p.mode = 'negotiated';
    }, /unknown pack mode/);
    assert.throws(
      () => parsePacklist(Buffer.from(JSON.stringify(raw))),
      like,
      'a mode this build cannot honour must not be read as "bare"',
    );
  });

  test('a mistyped field is refused', function (assert) {
    let { raw } = refuses((p) => {
      p.sourceBase = 42;
    }, /sourceBase/);
    assert.throws(
      () => parsePacklist(Buffer.from(JSON.stringify(raw))),
      /provenance.sourceBase must be a string/,
    );
  });

  test('a malformed prune record is refused', function (assert) {
    let { raw } = refuses((p) => {
      (p.pruned as Record<string, unknown>).external = [{ specifier: 'x' }];
    }, /external/);
    assert.throws(
      () => parsePacklist(Buffer.from(JSON.stringify(raw))),
      /pruned.external entry is malformed/,
    );
  });

  function hermeticRaw(): {
    provenance: { mode: string; carried: Record<string, unknown>[] };
  } {
    return JSON.parse(
      serializePacklist(
        createPacklist(FILES, {
          mode: 'hermetic',
          carried: [
            {
              specifier: 'three',
              from: 'https://esm.sh/three@0.160.0',
              entry: '_vendor/esm.sh/three@0.160.0.mjs',
              modules: 2,
              bytes: 900,
            },
          ],
        }),
      ).toString('utf8'),
    );
  }

  test('a carried record round-trips, and a malformed one is refused', function (assert) {
    let raw = hermeticRaw();
    assert.strictEqual(
      parsePacklist(Buffer.from(JSON.stringify(raw))).provenance?.carried?.[0]
        .from,
      'https://esm.sh/three@0.160.0',
      'the canonical upstream URL survives the trip',
    );
    delete raw.provenance.carried[0].modules;
    assert.throws(
      () => parsePacklist(Buffer.from(JSON.stringify(raw))),
      /carried entry is malformed/,
    );
  });

  // The two halves of one fact must agree. A pack that declares it carries
  // nothing while listing what it carried leaves intake to pick a side.
  test('a bare pack that claims to have carried something is refused', function (assert) {
    let raw = hermeticRaw();
    raw.provenance.mode = 'bare';
    assert.throws(
      () => parsePacklist(Buffer.from(JSON.stringify(raw))),
      /mode "bare" carries nothing/,
    );
  });

  test('a packlist with no provenance still parses', function (assert) {
    let bytes = serializePacklist(createPacklist(FILES));
    assert.strictEqual(parsePacklist(bytes).provenance, undefined);
  });
});

module('provenance: readiness for intake', function () {
  // A pack that cannot answer these is still a good pack — it verifies and
  // restores in place. It just cannot be MOVED without guessing.
  test('a pack with no provenance is not re-homeable, and says which parts are missing', function (assert) {
    let { ready, missing } = intakeReadiness(createPacklist(FILES));
    assert.false(ready);
    assert.strictEqual(missing.length, 3);
    assert.true(
      missing.some((m) => m.startsWith('provenance.sourceBase')),
      'the field intake cannot do without',
    );
  });

  test('the three required answers make it ready', function (assert) {
    let packlist = createPacklist(FILES, {
      sourceBase: 'https://realms.example/chris/notes/',
      version: '1.4.0',
      mode: 'bare',
    });
    assert.deepEqual(intakeReadiness(packlist), { ready: true, missing: [] });
  });

  test('a partial block reports only what it lacks', function (assert) {
    let packlist = createPacklist(FILES, {
      sourceBase: 'https://realms.example/chris/notes/',
      mode: 'hermetic',
    });
    let { ready, missing } = intakeReadiness(packlist);
    assert.false(ready);
    assert.deepEqual(missing, [
      'provenance.version — the ancestor a merge would need',
    ]);
  });
});
