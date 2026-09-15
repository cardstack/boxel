import QUnit from 'qunit';
const { module, test } = QUnit;
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  assertNotProduction,
  ensureTrailingSlash,
  parseArgs,
  percentile,
  readCredentials,
  summarize,
} from '../scripts/load-harness/lib/common.ts';
import { eventCannotMatch } from '../scripts/load-harness/lib/realm-events.ts';
import {
  workloadFromCardTypeSummary,
  type CardTypeSummaryEntry,
} from '../scripts/load-harness/lib/derive-workload.ts';
import {
  loadWorkload,
  parseWorkload,
  typeKey,
  writeAttributes,
} from '../scripts/load-harness/lib/workload.ts';

// The load harness runs against deployed environments with real credentials, so
// none of it can be exercised from a test. Its decision-making can: the guard
// that keeps it off production, the parsing that turns files and flags into a
// run, and the skip test that decides whether an event re-runs a query. Those
// are the parts whose failure would be silent — a guard that lets a host
// through, or a skip test that reports quiet where a browser would be busy.

function withTempDir(fn: (dir: string) => void): void {
  let dir = mkdtempSync(join(tmpdir(), 'load-harness-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

module(basename(import.meta.filename), function () {
  module('production guard', function () {
    test('refuses every spelling of the production host', function (assert) {
      for (let url of [
        'https://boxel.ai',
        'https://app.boxel.ai',
        'https://realms.boxel.ai/some/realm/',
        'https://matrix.boxel.ai',
        'https://BOXEL.AI/x',
      ]) {
        assert.throws(
          () => assertNotProduction(url),
          /Refusing to run a load harness against production/,
          `${url} is refused`,
        );
      }
    });

    test('refuses when any one of several URLs is production', function (assert) {
      assert.throws(
        () =>
          assertNotProduction(
            'https://matrix-staging.stack.cards',
            'https://realms-staging.stack.cards',
            'https://realms.boxel.ai/owner/realm/',
          ),
        /Refusing to run a load harness against production/,
      );
    });

    test('allows staging and local hosts', function (assert) {
      assertNotProduction(
        'https://matrix-staging.stack.cards',
        'https://realms-staging.stack.cards',
        'https://realms-staging.stack.cards/owner/load-test/',
        'http://localhost:4201/',
        undefined,
      );
      assert.ok(true, 'no throw');
    });

    test('a host that merely contains the production domain is not production', function (assert) {
      assertNotProduction('https://boxel.ai.example.com/');
      assert.ok(true, 'no throw');
    });

    test('rejects a value that is not a URL', function (assert) {
      assert.throws(() => assertNotProduction('not a url'), /Not a URL/);
    });
  });

  module('credential file', function () {
    test('reads username and password columns by name, ignoring the rest', function (assert) {
      withTempDir((dir) => {
        let path = join(dir, 'accounts.csv');
        writeFileSync(
          path,
          [
            'name,username,temporary_email,initial_password',
            'One,user-one,one@example.com,pw-one',
            'Two,user-two,two@example.com,pw-two',
            '',
          ].join('\n'),
        );
        assert.deepEqual(readCredentials(path), [
          { username: 'user-one', password: 'pw-one' },
          { username: 'user-two', password: 'pw-two' },
        ]);
      });
    });

    test('handles quoted cells, embedded commas, and doubled quotes', function (assert) {
      withTempDir((dir) => {
        let path = join(dir, 'accounts.csv');
        writeFileSync(
          path,
          [
            'name,username,initial_password',
            '"Last, First",user-one,"pw,with,commas"',
            '"He said ""hi""",user-two,"pw""quoted"',
          ].join('\n'),
        );
        assert.deepEqual(readCredentials(path), [
          { username: 'user-one', password: 'pw,with,commas' },
          { username: 'user-two', password: 'pw"quoted' },
        ]);
      });
    });

    test('rejects a file missing either required column', function (assert) {
      withTempDir((dir) => {
        let path = join(dir, 'accounts.csv');
        writeFileSync(path, 'name,user,password\nOne,user-one,pw-one');
        assert.throws(
          () => readCredentials(path),
          /must have 'username' and 'initial_password' columns/,
        );
      });
    });

    test('rejects a file with a header and no rows', function (assert) {
      withTempDir((dir) => {
        let path = join(dir, 'accounts.csv');
        writeFileSync(path, 'username,initial_password\n');
        assert.throws(() => readCredentials(path), /has no data rows/);
      });
    });
  });

  module('argument parsing', function () {
    test('maps kebab-case flags onto camelCase keys and coerces by spec type', function (assert) {
      let args = parseArgs(
        [
          '--csv',
          './accounts.csv',
          '--write-every-ms',
          '5000',
          '--subscribe',
          '--realm=https://example.test/o/r/',
        ],
        {
          csv: '',
          realm: '',
          writeEveryMs: 20000,
          subscribe: false,
        },
      );
      assert.strictEqual(args.csv, './accounts.csv');
      assert.strictEqual(args.realm, 'https://example.test/o/r/');
      assert.strictEqual(args.writeEveryMs, 5000, 'coerced to a number');
      assert.true(args.subscribe, 'a boolean key is a bare flag');
    });

    test('leaves unsupplied keys at their defaults', function (assert) {
      let args = parseArgs([], { readers: 12, subscribe: false });
      assert.strictEqual(args.readers, 12);
      assert.false(args.subscribe);
    });

    test('a number flag given a non-number yields NaN rather than a string', function (assert) {
      let args = parseArgs(['--readers', 'lots'], { readers: 12 });
      assert.true(Number.isNaN(args.readers));
    });
  });

  module('realm-event skip test', function () {
    let widget = typeKey('https://example.test/o/r/schema/widget', 'Widget');
    let gadget = typeKey('https://example.test/o/r/schema/gadget', 'Gadget');

    test('an event that invalidated a disjoint type set cannot match', function (assert) {
      assert.true(
        eventCannotMatch(
          { eventName: 'index', invalidatedTypes: [gadget] },
          new Set([widget]),
        ),
      );
    });

    test('an event that invalidated the query type does match', function (assert) {
      assert.false(
        eventCannotMatch(
          { eventName: 'index', invalidatedTypes: [gadget, widget] },
          new Set([widget]),
        ),
      );
    });

    test('an event carrying no type information re-runs unconditionally', function (assert) {
      assert.false(
        eventCannotMatch({ eventName: 'index' }, new Set([widget])),
        'absent invalidatedTypes',
      );
      assert.false(
        eventCannotMatch(
          { eventName: 'index', invalidatedTypes: 'all' },
          new Set([widget]),
        ),
        'a non-array value is not type information',
      );
    });

    test('a query whose types cannot be named re-runs unconditionally', function (assert) {
      assert.false(
        eventCannotMatch(
          { eventName: 'index', invalidatedTypes: [gadget] },
          undefined,
        ),
      );
      assert.false(
        eventCannotMatch(
          { eventName: 'index', invalidatedTypes: [gadget] },
          new Set(),
        ),
      );
    });

    test('a non-index event never triggers a re-run', function (assert) {
      assert.true(
        eventCannotMatch(
          { eventName: 'update', invalidatedTypes: [widget] },
          new Set([widget]),
        ),
      );
      assert.true(eventCannotMatch(undefined, new Set([widget])));
    });
  });

  module('workload file', function () {
    const realm = 'https://example.test/owner/load-test/';

    function writeWorkload(dir: string, contents: unknown): string {
      let path = join(dir, 'workload.json');
      writeFileSync(path, JSON.stringify(contents));
      return path;
    }

    test('expands ${realm} and derives the type keys the skip test reads', function (assert) {
      withTempDir((dir) => {
        let path = writeWorkload(dir, {
          queries: [
            {
              label: 'Widget',
              filter: {
                'item.on': { module: '${realm}schema/widget', name: 'Widget' },
              },
              sort: [{ by: 'item.createdAt' }],
            },
          ],
          write: {
            adoptsFrom: { module: '${realm}schema/report', name: 'Report' },
            attributes: { title: 'x' },
          },
        });
        let workload = loadWorkload(path, realm);
        let [spec] = workload.queries;
        assert.strictEqual(spec.label, 'Widget');
        assert.deepEqual(
          spec.query,
          {
            filter: {
              'item.on': { module: `${realm}schema/widget`, name: 'Widget' },
            },
            sort: [{ by: 'item.createdAt' }],
          },
          'every key other than label is passed through, with ${realm} expanded',
        );
        assert.deepEqual(
          [...(spec.typeKeys ?? [])],
          [`${realm}schema/widget/Widget`],
        );
        assert.strictEqual(
          workload.write.path,
          'Report',
          'the write path defaults to the type name',
        );
        assert.deepEqual(workload.write.adoptsFrom, {
          module: `${realm}schema/report`,
          name: 'Report',
        });
      });
    });

    test('a query with no nameable type anchor gets no type keys', function (assert) {
      withTempDir((dir) => {
        let path = writeWorkload(dir, {
          queries: [{ label: 'Anything', filter: { eq: { 'item.x': 1 } } }],
          write: {
            adoptsFrom: { module: '${realm}schema/report', name: 'Report' },
          },
        });
        let workload = loadWorkload(path, realm);
        assert.strictEqual(workload.queries[0].typeKeys, undefined);
        assert.false(
          eventCannotMatch(
            { eventName: 'index', invalidatedTypes: ['anything/Else'] },
            workload.queries[0].typeKeys,
          ),
          'an unnameable query re-runs on every index event',
        );
      });
    });

    test('secondary and extra query lists default to empty', function (assert) {
      withTempDir((dir) => {
        let path = writeWorkload(dir, {
          queries: [
            {
              label: 'Widget',
              filter: {
                'item.on': { module: '${realm}schema/widget', name: 'Widget' },
              },
            },
          ],
          write: {
            adoptsFrom: { module: '${realm}schema/report', name: 'Report' },
          },
        });
        let workload = loadWorkload(path, realm);
        assert.deepEqual(workload.secondaryQueries, []);
        assert.deepEqual(workload.extraQueries, []);
        assert.deepEqual(workload.write.attributes, {});
      });
    });

    test('rejects a workload that would silently measure nothing', function (assert) {
      withTempDir((dir) => {
        assert.throws(
          () =>
            loadWorkload(
              writeWorkload(dir, {
                queries: [],
                write: { adoptsFrom: { module: 'm', name: 'N' } },
              }),
              realm,
            ),
          /"queries" must list at least one query/,
        );
        assert.throws(
          () =>
            loadWorkload(
              writeWorkload(dir, {
                queries: [{ label: 'Widget' }],
                write: { adoptsFrom: { module: 'm', name: 'N' } },
              }),
              realm,
            ),
          /needs a "filter" object/,
        );
        assert.throws(
          () =>
            loadWorkload(
              writeWorkload(dir, {
                queries: [
                  { filter: { 'item.on': { module: 'm', name: 'N' } } },
                ],
                write: { adoptsFrom: { module: 'm', name: 'N' } },
              }),
              realm,
            ),
          /needs a non-empty string "label"/,
        );
        assert.throws(
          () =>
            loadWorkload(
              writeWorkload(dir, {
                queries: [
                  {
                    label: 'W',
                    filter: { 'item.on': { module: 'm', name: 'N' } },
                  },
                ],
              }),
              realm,
            ),
          /"write" must be an object/,
        );
      });
    });

    test('reports an unreadable or malformed workload file by path', function (assert) {
      withTempDir((dir) => {
        let path = join(dir, 'workload.json');
        writeFileSync(path, '{ not json');
        assert.throws(
          () => loadWorkload(path, realm),
          /Could not read workload file/,
        );
        assert.throws(
          () => loadWorkload(join(dir, 'absent.json'), realm),
          /Could not read workload file/,
        );
      });
    });

    test('the committed files parse, so they stay usable starting points', function (assert) {
      for (let name of ['workload.example.json', 'workload.experiments.json']) {
        let workload = loadWorkload(
          join(import.meta.dirname, '..', 'scripts', 'load-harness', name),
          realm,
        );
        assert.true(workload.queries.length > 0, `${name} has queries`);
        assert.true(workload.extraQueries.length > 0, `${name} has extras`);
        assert.true(
          workload.queries.every((q) => (q.typeKeys?.size ?? 0) > 0),
          `every ${name} query names a type, so the skip test can compare`,
        );
        assert.true(
          JSON.stringify(workload).includes(realm),
          `${name} expanded \${realm} rather than leaving it literal`,
        );
      }
    });

    test('the standard workload writes a type its own readers query', function (assert) {
      let workload = loadWorkload(
        join(
          import.meta.dirname,
          '..',
          'scripts',
          'load-harness',
          'workload.experiments.json',
        ),
        realm,
      );
      let written = typeKey(
        workload.write.adoptsFrom.module,
        workload.write.adoptsFrom.name,
      );
      assert.true(
        [...workload.queries, ...workload.secondaryQueries].some((q) =>
          q.typeKeys?.has(written),
        ),
        'otherwise every write would be skipped under --subscribe',
      );
    });

    test('write attributes vary per write so each one invalidates something', function (assert) {
      withTempDir((dir) => {
        let path = writeWorkload(dir, {
          queries: [
            {
              label: 'Widget',
              filter: {
                'item.on': { module: '${realm}schema/widget', name: 'Widget' },
              },
            },
          ],
          write: {
            path: 'Reports',
            adoptsFrom: { module: '${realm}schema/report', name: 'Report' },
            attributes: {
              title: 'Load harness report ${n}',
              reportedOn: '${date}',
              nested: { labels: ['run-${n}'] },
              count: 3,
            },
          },
        });
        let { write } = loadWorkload(path, realm);
        let first = writeAttributes(write, 1);
        let second = writeAttributes(write, 2);
        assert.strictEqual(first.title, 'Load harness report 1');
        assert.strictEqual(second.title, 'Load harness report 2');
        assert.deepEqual(first.nested, { labels: ['run-1'] });
        assert.strictEqual(first.count, 3, 'non-strings pass through');
        assert.true(
          /^\d{4}-\d{2}-\d{2}$/.test(String(first.reportedOn)),
          '${date} expands to an ISO date',
        );
        assert.strictEqual(write.path, 'Reports', 'an explicit path wins');
      });
    });
  });

  module('summary statistics', function () {
    test('percentile indexes a sorted sample and clamps at the end', function (assert) {
      let sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      assert.strictEqual(percentile(sorted, 50), 6);
      assert.strictEqual(percentile(sorted, 90), 10);
      assert.strictEqual(percentile(sorted, 100), 10);
      assert.strictEqual(percentile([], 50), 0);
    });

    test('summarize reports the distribution without mutating its input', function (assert) {
      let samples = [30, 10, 20];
      let line = summarize('search', samples);
      assert.strictEqual(
        line,
        'search: n=3 p50=20ms p90=30ms p99=30ms max=30ms mean=20ms',
      );
      assert.deepEqual(
        samples,
        [30, 10, 20],
        'caller sample order is preserved',
      );
    });

    test('summarize says so rather than printing zeros for an empty sample', function (assert) {
      assert.strictEqual(summarize('write', []), 'write: (none)');
    });
  });

  module('derived workload', function () {
    const realm = 'https://example.test/owner/experiments/';

    // Shaped like a real GET <realm>/_types payload: a flat `data` array of
    // card-type-summary entries discriminated by `kind`, ids in both the
    // prefix and the URL spelling.
    function entry(
      id: string,
      total: number,
      kind = 'instance',
      displayName?: string,
    ): CardTypeSummaryEntry {
      return {
        type: 'card-type-summary',
        id,
        attributes: {
          displayName: displayName ?? id.slice(id.lastIndexOf('/') + 1),
          total,
          iconHTML: '<svg/>',
          kind,
        },
      };
    }

    const sample: CardTypeSummaryEntry[] = [
      entry('@cardstack/base/spec/Spec', 117),
      entry(`${realm}author/Author`, 30),
      entry(`${realm}llm-model-environment/model/Model`, 30),
      entry('@cardstack/catalog/catalog-app/listing/listing/CardListing', 26),
      entry(`${realm}crm/company/Company`, 25),
      entry(`${realm}some/markdown/Markdown`, 999, 'file'),
    ];

    test('ranks instance types by count and keeps the top N', function (assert) {
      let raw = workloadFromCardTypeSummary(sample, {
        realmUrl: realm,
        top: 3,
        pageSize: 20,
      });
      let workload = parseWorkload(raw, realm, '_types');
      assert.deepEqual(
        workload.queries.map((q) => q.label),
        ['Spec', 'Author', 'Model'],
        'highest counts first, file entries excluded',
      );
    });

    test('a file entry is never queried, whatever its count', function (assert) {
      let raw = workloadFromCardTypeSummary(sample, {
        realmUrl: realm,
        top: 99,
        pageSize: 0,
      });
      assert.false(
        JSON.stringify(raw).includes('Markdown'),
        'the 999-instance file type outranks everything and is still dropped',
      );
    });

    test('splits a type id at the last separator, in both spellings', function (assert) {
      let raw = workloadFromCardTypeSummary(sample, {
        realmUrl: realm,
        top: 4,
        pageSize: 0,
      });
      let workload = parseWorkload(raw, realm, '_types');
      assert.deepEqual(
        workload.queries.map((q) => [...(q.typeKeys ?? [])][0]),
        [
          '@cardstack/base/spec/Spec',
          `${realm}author/Author`,
          `${realm}llm-model-environment/model/Model`,
          '@cardstack/catalog/catalog-app/listing/listing/CardListing',
        ],
        'the anchor round-trips back to the id it came from',
      );
      assert.deepEqual(
        (workload.queries[0].query.filter as Record<string, unknown>)[
          'item.on'
        ],
        { module: '@cardstack/base/spec', name: 'Spec' },
      );
    });

    test('page size is applied, and 0 leaves the query unbounded', function (assert) {
      let bounded = parseWorkload(
        workloadFromCardTypeSummary(sample, {
          realmUrl: realm,
          top: 1,
          pageSize: 20,
        }),
        realm,
        '_types',
      );
      assert.deepEqual(bounded.queries[0].query.page, { size: 20 });

      let unbounded = parseWorkload(
        workloadFromCardTypeSummary(sample, {
          realmUrl: realm,
          top: 1,
          pageSize: 0,
        }),
        realm,
        '_types',
      );
      assert.strictEqual(unbounded.queries[0].query.page, undefined);
    });

    test('a tied count still yields one stable ordering', function (assert) {
      let forwards = workloadFromCardTypeSummary(sample, {
        realmUrl: realm,
        top: 3,
        pageSize: 0,
      });
      let backwards = workloadFromCardTypeSummary([...sample].reverse(), {
        realmUrl: realm,
        top: 3,
        pageSize: 0,
      });
      assert.deepEqual(
        forwards,
        backwards,
        'Author and Model are both at 30; input order must not decide',
      );
    });

    test('duplicate display names stay distinct labels', function (assert) {
      let raw = workloadFromCardTypeSummary(
        [
          entry(`${realm}a/Thing`, 10, 'instance', 'Thing'),
          entry(`${realm}b/Thing`, 9, 'instance', 'Thing'),
        ],
        { realmUrl: realm, top: 2, pageSize: 0 },
      );
      let workload = parseWorkload(raw, realm, '_types');
      assert.deepEqual(
        workload.queries.map((q) => q.label),
        ['Thing', 'Thing #2'],
        'the per-shape summary table is keyed by label, so it cannot collide',
      );
    });

    test('the write targets a realm-local type that the readers query', function (assert) {
      let raw = workloadFromCardTypeSummary(sample, {
        realmUrl: realm,
        top: 8,
        pageSize: 0,
      });
      let workload = parseWorkload(raw, realm, '_types');
      assert.deepEqual(
        workload.write.adoptsFrom,
        { module: `${realm}author`, name: 'Author' },
        'Spec outranks it but is not addressable relative to this realm',
      );
      assert.true(
        workload.queries.some(
          (q) => [...(q.typeKeys ?? [])][0] === `${realm}author/Author`,
        ),
        'so each write invalidates something a reader is querying',
      );
      assert.deepEqual(
        workload.write.attributes,
        {},
        'the summary reports counts, not field schemas, so nothing is guessed',
      );
    });

    test('refuses a realm with nothing queryable rather than inventing one', function (assert) {
      assert.throws(
        () =>
          workloadFromCardTypeSummary(
            [entry(`${realm}some/markdown/Markdown`, 5, 'file')],
            { realmUrl: realm, top: 8, pageSize: 0 },
          ),
        /No instance types found/,
      );
      assert.throws(
        () =>
          workloadFromCardTypeSummary([entry('NoSeparator', 5)], {
            realmUrl: realm,
            top: 8,
            pageSize: 0,
          }),
        /No instance types found/,
        'an id with no module part names no type',
      );
    });
  });

  module('url helpers', function () {
    test('ensureTrailingSlash is idempotent', function (assert) {
      assert.strictEqual(
        ensureTrailingSlash('https://example.test/o/r'),
        'https://example.test/o/r/',
      );
      assert.strictEqual(
        ensureTrailingSlash('https://example.test/o/r/'),
        'https://example.test/o/r/',
      );
    });
  });
});
