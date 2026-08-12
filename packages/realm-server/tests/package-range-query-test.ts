import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import {
  collectPackageSpecs,
  expandPackageRanges,
  parsePackageModule,
  versionsSatisfying,
  isExactVersion,
} from '@cardstack/runtime-common/package-range-query';

// Searching by RANGE against an index that stores exact VERSIONS.
//
// The rewrite is where the whole feature lives: everything below it sees
// ordinary exact-key predicates, so if this is wrong the failure is a silently
// wrong result set rather than an error.

const ORIGIN = 'https://realm.example.com';
const NAME = 'experiments/greeter';
const ALL = ['1.0.0', '1.1.0', '2.0.0', '2.1.0', '2.2.0', '2.3.0'];

function mod(spec: string, rest = 'index') {
  return `${ORIGIN}/demo/_packages/${NAME}@${encodeURIComponent(spec)}/${rest}`;
}

const lookupAll = ({ spec }: { name: string; spec: string }) =>
  versionsSatisfying({ spec, versions: ALL });

module(basename(import.meta.filename), function () {
  module('parsing a package address', function () {
    test('splits name, spec and rest', function (assert) {
      assert.deepEqual(parsePackageModule(mod('^2.0.0')), {
        prefix: `${ORIGIN}/demo/_packages/`,
        name: NAME,
        spec: '^2.0.0',
        rest: 'index',
      });
    });

    test('a realm module is not a package address', function (assert) {
      assert.strictEqual(
        parsePackageModule(`${ORIGIN}/experiments/greeter/index.gts`),
        undefined,
      );
    });

    test('exactness is decided by semver, not by shape', function (assert) {
      assert.true(isExactVersion('2.0.0'));
      assert.false(isExactVersion('2.0'), 'a partial is a range');
      assert.false(isExactVersion('^2.0.0'));
      assert.false(isExactVersion('latest'));
      assert.true(
        isExactVersion('2.0.0-beta.1'),
        'a prerelease names exactly one Version',
      );
    });
  });

  module('which versions a spec admits', function () {
    test('a caret takes the whole major', function (assert) {
      assert.deepEqual(versionsSatisfying({ spec: '^2.0.0', versions: ALL }), [
        '2.3.0',
        '2.2.0',
        '2.1.0',
        '2.0.0',
      ]);
    });

    test('a tilde stays inside the minor', function (assert) {
      assert.deepEqual(versionsSatisfying({ spec: '~2.2.0', versions: ALL }), [
        '2.2.0',
      ]);
    });

    test('an explicit interval is honoured', function (assert) {
      assert.deepEqual(
        versionsSatisfying({ spec: '>=2.1.0 <2.3.0', versions: ALL }),
        ['2.2.0', '2.1.0'],
      );
    });

    test('an exact spec admits only itself, and only if published', function (assert) {
      assert.deepEqual(versionsSatisfying({ spec: '2.1.0', versions: ALL }), [
        '2.1.0',
      ]);
      assert.deepEqual(
        versionsSatisfying({ spec: '9.9.9', versions: ALL }),
        [],
      );
    });

    test('a dist-tag names one Version', function (assert) {
      assert.deepEqual(
        versionsSatisfying({
          spec: 'latest',
          versions: ALL,
          tags: { latest: '2.2.0' },
        }),
        ['2.2.0'],
      );
      assert.deepEqual(
        versionsSatisfying({ spec: 'latest', versions: ALL }),
        [],
        'and an unknown tag admits nothing rather than everything',
      );
    });

    test('nonsense admits nothing', function (assert) {
      assert.deepEqual(
        versionsSatisfying({ spec: 'not-a-range!!', versions: ALL }),
        [],
      );
    });
  });

  module('collecting the specs a filter asks about', function () {
    test('finds them through any/every/not, deduped', function (assert) {
      let specs = collectPackageSpecs({
        every: [
          { type: { module: mod('^2.0.0'), name: 'Greeter' } },
          {
            any: [
              { on: { module: mod('^2.0.0'), name: 'Greeter' }, eq: { a: 1 } },
              {
                not: { on: { module: mod('~1.0.0'), name: 'Greeter' }, eq: {} },
              },
            ],
          },
        ],
      } as any);
      assert.deepEqual(specs, [
        { name: NAME, spec: '^2.0.0' },
        { name: NAME, spec: '~1.0.0' },
      ]);
    });

    test('an exact version needs no expansion, so is not collected', function (assert) {
      assert.deepEqual(
        collectPackageSpecs({
          type: { module: mod('2.1.0'), name: 'Greeter' },
        } as any),
        [],
      );
    });

    test('a non-package type is ignored', function (assert) {
      assert.deepEqual(
        collectPackageSpecs({
          type: { module: `${ORIGIN}/experiments/task`, name: 'Task' },
        } as any),
        [],
      );
    });
  });

  module('the rewrite', function () {
    test('a type filter becomes an any over exact versions', function (assert) {
      let expanded: any = expandPackageRanges(
        { type: { module: mod('^2.0.0'), name: 'Greeter' } } as any,
        lookupAll,
      );
      assert.deepEqual(
        expanded.any.map((f: any) => f.type.module),
        [mod('2.3.0'), mod('2.2.0'), mod('2.1.0'), mod('2.0.0')].map((m) =>
          decodeURIComponent(m),
        ),
        'each branch names one published version',
      );
    });

    test('an `on` filter keeps its predicate on every branch', function (assert) {
      // The predicate has to ride along, or the rewrite silently widens the
      // query to "every instance of the type" — a wrong answer that looks
      // like a working feature.
      let expanded: any = expandPackageRanges(
        {
          on: { module: mod('~2.2.0'), name: 'Greeter' },
          eq: { person: 'Ada' },
        } as any,
        lookupAll,
      );
      assert.deepEqual(expanded.eq, { person: 'Ada' });
      assert.strictEqual(expanded.on.module, decodeURIComponent(mod('2.2.0')));
    });

    test('a single match is substituted in place, with no wrapper', function (assert) {
      let expanded: any = expandPackageRanges(
        { type: { module: mod('~2.2.0'), name: 'Greeter' } } as any,
        lookupAll,
      );
      assert.strictEqual(expanded.any, undefined);
      assert.strictEqual(
        expanded.type.module,
        decodeURIComponent(mod('2.2.0')),
      );
    });

    test('a range nothing satisfies is left alone, and so matches nothing', function (assert) {
      // Deliberately NOT rewritten to an empty `any`: leaving the unmatchable
      // key in place is already the right answer and needs no empty-set
      // semantics from the engine downstream.
      let original = { type: { module: mod('^9.0.0'), name: 'Greeter' } };
      assert.deepEqual(
        expandPackageRanges(original as any, lookupAll),
        original,
      );
    });

    test('an unknown package is left alone rather than widened', function (assert) {
      let original = { type: { module: mod('^2.0.0'), name: 'Greeter' } };
      assert.deepEqual(
        expandPackageRanges(original as any, () => undefined),
        original,
        'no answer must never mean "match everything"',
      );
    });

    test('nested filters are rewritten in place', function (assert) {
      let expanded: any = expandPackageRanges(
        {
          every: [
            { type: { module: mod('~2.2.0'), name: 'Greeter' } },
            { not: { type: { module: mod('~2.1.0'), name: 'Greeter' } } },
          ],
        } as any,
        lookupAll,
      );
      assert.strictEqual(
        expanded.every[0].type.module,
        decodeURIComponent(mod('2.2.0')),
      );
      assert.strictEqual(
        expanded.every[1].not.type.module,
        decodeURIComponent(mod('2.1.0')),
      );
    });

    test('a filter naming no package is returned unchanged', function (assert) {
      // Equal, not identical: the walk rebuilds nodes. That copy never
      // happens for a package-free query in practice, because the caller
      // short-circuits on an empty `collectPackageSpecs` before calling here.
      let original = { eq: { title: 'hello' } };
      assert.deepEqual(
        expandPackageRanges(original as any, lookupAll),
        original,
      );
    });
  });
});
