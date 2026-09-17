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
  DEFAULT_FIELDSET,
  describeFieldset,
  fieldsetWireMembers,
  isFieldsetName,
} from '../scripts/load-harness/lib/fieldset.ts';
import {
  describeConnectionSetup,
  measureConnectionSetup,
} from '../scripts/load-harness/lib/connection.ts';
import { LINK_SHAPE_LOAD_HALF_LIFE_MS } from '@cardstack/runtime-common';
import {
  DEFAULT_LOAD_HALF_LIFE_MS,
  describeInFlight,
  InFlightReading,
} from '../scripts/load-harness/lib/in-flight.ts';
import {
  readOnlyReason,
  workloadFromCardTypeSummary,
  type CardTypeSummaryEntry,
} from '../scripts/load-harness/lib/derive-workload.ts';
import {
  loadWorkload,
  parseWorkload,
  queryForPass,
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

    test('rejects an option the spec does not define', function (assert) {
      // A flag that parses but is never read reports a number for a test nobody
      // asked for, which is the failure this harness is careful about
      // everywhere else.
      assert.throws(
        () => parseArgs(['--duration', '45'], { minutes: 10 }),
        /Unknown option: --duration/,
      );
      assert.throws(
        () => parseArgs(['--duration=45'], { minutes: 10 }),
        /Unknown option: --duration/,
        'the inline-value spelling is caught too',
      );
    });

    test('a near-miss on a flag that changes what runs is caught', function (assert) {
      // `--writer 0` silently leaving the default two writers would put writes
      // on a realm the operator may only be able to read.
      assert.throws(
        () => parseArgs(['--writer', '0'], { writers: 2, readers: 12 }),
        /Unknown option: --writer/,
      );
    });

    test('names every unknown option at once, and what is valid', function (assert) {
      try {
        parseArgs(['--duration', '45', '--writer', '0'], {
          minutes: 10,
          writeEveryMs: 20000,
        });
        assert.true(false, 'should have thrown');
      } catch (e) {
        let message = (e as Error).message;
        assert.true(message.includes('--duration'), 'first unknown');
        assert.true(message.includes('--writer'), 'second unknown');
        assert.true(
          message.includes('--write-every-ms'),
          'valid options are listed in the spelling they are typed in',
        );
      }
    });

    test('a boolean flag accepts an explicit value so an on-by-default option can be turned off', function (assert) {
      // `--prime-connections` defaults to on, and the only way to disable it is
      // an explicit value. Reading 'false' as truthy would leave it on while
      // the operator believed they had turned it off — and the whole point of
      // that option is what the reported numbers mean.
      for (let off of ['false', '0', 'no', 'off', 'FALSE']) {
        assert.false(
          parseArgs([`--prime-connections=${off}`], { primeConnections: true })
            .primeConnections,
          `--prime-connections=${off} disables it`,
        );
      }
      assert.true(
        parseArgs(['--prime-connections'], { primeConnections: true })
          .primeConnections,
        'a bare flag is still true',
      );
      assert.true(
        parseArgs(['--prime-connections=true'], { primeConnections: false })
          .primeConnections,
        'and an explicit true turns an off-by-default option on',
      );
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
          workload.write!.path,
          'Report',
          'the write path defaults to the type name',
        );
        assert.deepEqual(workload.write!.adoptsFrom, {
          module: `${realm}schema/report`,
          name: 'Report',
        });
      });
    });

    test('an arbitrary wire filter passes through whole', function (assert) {
      // The mitigation under investigation is "add a predicate to a query that
      // has none", so a workload has to be able to carry eq / contains / range
      // alongside the type anchor for a run to A/B it.
      withTempDir((dir) => {
        let filter = {
          'item.on': { module: '${realm}schema/widget', name: 'Widget' },
          eq: { 'item.category': 'active', 'item.isActive': true },
          contains: { 'item.title': 'draft' },
          range: { 'item.updatedAt': { gt: '2026-01-01' } },
          any: [{ eq: { 'item.status': 'open' } }],
        };
        let path = writeWorkload(dir, {
          queries: [{ label: 'Widget', filter }],
          write: {
            adoptsFrom: { module: '${realm}schema/report', name: 'Report' },
          },
        });
        let [spec] = loadWorkload(path, realm).queries;
        assert.deepEqual(
          spec.query.filter,
          {
            ...filter,
            'item.on': { module: `${realm}schema/widget`, name: 'Widget' },
          },
          'nothing is stripped; only ${realm} is expanded',
        );
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
        assert.deepEqual(workload.write!.attributes, {});
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
      });
    });

    test('a workload may omit write, and that makes it read-only', function (assert) {
      withTempDir((dir) => {
        let workload = loadWorkload(
          writeWorkload(dir, {
            queries: [
              {
                label: 'W',
                filter: { 'item.on': { module: '${realm}w', name: 'W' } },
              },
            ],
          }),
          realm,
        );
        assert.strictEqual(
          workload.write,
          undefined,
          'run-load refuses to start writers against this',
        );
      });
    });

    test('a half-written write block is still rejected', function (assert) {
      withTempDir((dir) => {
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
                write: { adoptsFrom: { module: 'm' } },
              }),
              realm,
            ),
          /needs string "module" and "name"/,
          'omitting write is a choice; a half-written one is a mistake',
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
        workload.write!.adoptsFrom.module,
        workload.write!.adoptsFrom.name,
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
        assert.ok(write, 'this workload declares a write block');
        let first = writeAttributes(write!, 1);
        let second = writeAttributes(write!, 2);
        assert.strictEqual(first.title, 'Load harness report 1');
        assert.strictEqual(second.title, 'Load harness report 2');
        assert.deepEqual(first.nested, { labels: ['run-1'] });
        assert.strictEqual(first.count, 3, 'non-strings pass through');
        assert.true(
          /^\d{4}-\d{2}-\d{2}$/.test(String(first.reportedOn)),
          '${date} expands to an ISO date',
        );
        assert.strictEqual(write!.path, 'Reports', 'an explicit path wins');
      });
    });
  });

  module('query variants — the spread a run asks over', function () {
    const realm = 'https://example.test/owner/load-test/';

    function oneShape(variants?: unknown) {
      return parseWorkload(
        {
          queries: [
            {
              label: 'Day scoped',
              filter: {
                'item.on': { module: '${realm}schema/widget', name: 'Widget' },
              },
              page: { size: 100 },
              fields: { entry: ['item'] },
              ...(variants === undefined ? {} : { variants }),
            },
          ],
        },
        realm,
        'inline',
      ).queries[0]!;
    }

    test('a shape cycles its variants by pass and offsets them by reader', function (assert) {
      let spec = oneShape([
        { eq: { 'item.day': 'a' } },
        { eq: { 'item.day': 'b' } },
        { eq: { 'item.day': 'c' } },
      ]);
      let day = (readerIndex: number, pass: number) =>
        (
          (queryForPass(spec, readerIndex, pass).filter as any).eq as {
            'item.day': string;
          }
        )['item.day'];

      assert.strictEqual(day(0, 0), 'a', 'first reader opens on the first');
      assert.strictEqual(day(0, 1), 'b', 'its next re-run advances');
      assert.strictEqual(day(0, 3), 'a', 'and wraps');
      // Offset by reader as well, so readers running concurrently ask
      // different questions. In step they would issue one identical query and
      // the first answer would serve the rest from cache.
      assert.strictEqual(day(1, 0), 'b', 'a second reader starts elsewhere');
      assert.strictEqual(day(2, 0), 'c', 'and a third elsewhere again');
    });

    test('a variant merges over the filter without displacing the type anchor or the rest of the query', function (assert) {
      let spec = oneShape([{ eq: { 'item.day': 'a' } }]);
      let query = queryForPass(spec, 0, 0);
      assert.deepEqual(
        (query.filter as any)['item.on'],
        { module: `${realm}schema/widget`, name: 'Widget' },
        'the anchor survives the merge',
      );
      assert.deepEqual(
        query.fields,
        { entry: ['item'] },
        'a per-query fieldset survives too',
      );
      assert.deepEqual(query.page, { size: 100 }, 'as does the page');
      assert.notOk(
        'variants' in query,
        'and variants never reach the wire body',
      );
    });

    test('${realm} expands inside a variant', function (assert) {
      let spec = oneShape([{ eq: { 'item.owner': '${realm}Person/1' } }]);
      assert.strictEqual(
        ((queryForPass(spec, 0, 0).filter as any).eq as any)['item.owner'],
        `${realm}Person/1`,
        'so a variant-bearing workload stays portable across clones',
      );
    });

    test('a shape with no variants hands back its own query, so its wire body is unchanged', function (assert) {
      let spec = oneShape();
      assert.strictEqual(
        queryForPass(spec, 3, 7),
        spec.query,
        'the same object, whatever the reader and pass',
      );
    });

    test('an unusable variants member is rejected at load rather than on some later pass', function (assert) {
      assert.throws(
        () => oneShape([]),
        /"variants" must be a non-empty array/,
        'an empty list would silently mean "no spread"',
      );
      assert.throws(
        () => oneShape({ eq: { 'item.day': 'a' } }),
        /"variants" must be a non-empty array/,
        'one fragment still has to be a list of them',
      );
      assert.throws(
        () => oneShape([{ eq: { 'item.day': 'a' } }, 'b']),
        /variants\[1\] must be an object/,
        'and every entry has to be a filter fragment',
      );
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
        workload.write!.adoptsFrom,
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
        workload.write!.attributes,
        {},
        'the summary reports counts, not field schemas, so nothing is guessed',
      );
    });

    test('omits the write block when no selected type belongs to the realm', function (assert) {
      let external = [
        entry('@cardstack/base/spec/Spec', 117),
        entry('@cardstack/catalog/catalog-app/listing/listing/CardListing', 26),
      ];
      let raw = workloadFromCardTypeSummary(external, {
        realmUrl: realm,
        top: 8,
        pageSize: 20,
      });
      assert.strictEqual(
        raw.write,
        undefined,
        'an external module is not addressable relative to this realm, and ' +
          'guessing one would fail at write time',
      );
      let workload = parseWorkload(raw, realm, '_types');
      assert.strictEqual(workload.queries.length, 2, 'the reads still stand');
      assert.strictEqual(workload.write, undefined);
      assert.true(
        readOnlyReason(raw, 8).includes('Spec'),
        'the reason names the types that ranked, so the operator can judge it',
      );
      assert.true(
        readOnlyReason(raw, 8).includes('--writers 0'),
        'and says what to do about it',
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

  module('fieldset — which code path a run measures', function () {
    test('entries sends no fieldset, which is what selects the renderings', function (assert) {
      // The default resolution policy is chosen by the ABSENCE of the member,
      // so this has to stay an empty object rather than any explicit value.
      assert.deepEqual(fieldsetWireMembers('entries'), {});
      assert.strictEqual(DEFAULT_FIELDSET, 'entries');
    });

    test('item sends the card-data-only fieldset store.search uses', function (assert) {
      assert.deepEqual(fieldsetWireMembers('item'), {
        fields: { entry: ['item'] },
      });
    });

    test('item-html is its own value, not a combination of flags', function (assert) {
      assert.deepEqual(fieldsetWireMembers('item-html'), {
        fields: { entry: ['item', 'html'] },
      });
    });

    test('only the three known names are accepted', function (assert) {
      for (let name of ['entries', 'item', 'item-html']) {
        assert.true(isFieldsetName(name), `${name} is a fieldset`);
      }
      for (let bad of ['items', 'html', '', 'item,html', undefined, 3]) {
        assert.false(isFieldsetName(bad), `${String(bad)} is not`);
      }
    });

    test('every fieldset describes the client behaviour it stands for', function (assert) {
      assert.true(describeFieldset('entries').includes('grid'));
      assert.true(
        describeFieldset('item').includes('store.search'),
        'names the call site, so the claim is checkable',
      );
      assert.true(describeFieldset('item-html').includes('renderings'));
    });

    test('a workload can pin the fieldset, and a bad one is rejected', function (assert) {
      withTempDir((dir) => {
        let write = (fieldset: unknown) => {
          let path = join(dir, 'workload.json');
          writeFileSync(
            path,
            JSON.stringify({
              fieldset,
              queries: [
                {
                  label: 'W',
                  filter: { 'item.on': { module: 'm', name: 'N' } },
                },
              ],
            }),
          );
          return loadWorkload(path, 'https://example.test/o/r/');
        };
        assert.strictEqual(write('item').fieldset, 'item');
        assert.strictEqual(
          write(undefined).fieldset,
          undefined,
          'absent means the driver decides',
        );
        assert.throws(
          () => write('items'),
          /"fieldset" must be "entries", "item", or "item-html"/,
        );
      });
    });

    test('a workload that pins no fieldset leaves the path unstated, which the loader surfaces as a member to add', function (assert) {
      // The run refuses such a file rather than defaulting, because a default
      // is recorded nowhere: the figure it produces cannot be read back to a
      // path. The refusal lives in run-load, which a test cannot execute, so
      // what is pinned here is the condition it tests — that a parsed workload
      // reports the member as absent rather than filling it in.
      let workload = parseWorkload(
        {
          queries: [
            {
              label: 'Widget',
              filter: {
                'item.on': { module: '${realm}schema/widget', name: 'Widget' },
              },
            },
          ],
        },
        'https://example.test/owner/load-test/',
        'inline',
      );
      assert.strictEqual(
        workload.fieldset,
        undefined,
        'absent stays absent, so the caller decides what to do about it',
      );
    });

    test('both committed workloads pin a fieldset rather than leaving it implicit', function (assert) {
      for (let name of ['workload.example.json', 'workload.experiments.json']) {
        let workload = loadWorkload(
          join(import.meta.dirname, '..', 'scripts', 'load-harness', name),
          'https://example.test/o/r/',
        );
        assert.true(
          isFieldsetName(workload.fieldset),
          `${name} says which path it measures`,
        );
      }
    });
  });

  module('connection setup measurement', function () {
    // A probe that replays a recorded sequence of request durations.
    function replay(samples: number[]) {
      let i = 0;
      return () => Promise.resolve(samples[Math.min(i++, samples.length - 1)]);
    }
    const noYield = () => Promise.resolve();

    test('a cold second sample cannot be mistaken for a warm one', async function (assert) {
      // Six back-to-back preflights over a real link. The first TWO are cold:
      // a socket returns to undici's pool a tick after its response settles, so
      // the second request opens its own connection. Subtracting sample 2 from
      // sample 1 compares two handshakes against each other and reports the
      // jitter between them as the cost of a handshake.
      let setup = await measureConnectionSetup(
        replay([427, 380, 122, 122, 121, 120]),
        { yieldTick: noYield },
      );
      assert.strictEqual(setup.coldMs, 427);
      assert.strictEqual(
        setup.warmMs,
        122,
        'the cheapest warm sample, not the first',
      );
      assert.strictEqual(
        setup.setupMs,
        305,
        'the real cost, not the 47ms two cold samples differ by',
      );
    });

    test('a slow warm sample cannot shrink the reported cost', async function (assert) {
      // Under-reporting is the damaging direction: this number exists to stop
      // someone reading connection setup as server time.
      let setup = await measureConnectionSetup(replay([400, 390, 300, 120]), {
        yieldTick: noYield,
      });
      assert.strictEqual(setup.warmMs, 120);
      assert.strictEqual(setup.setupMs, 280);
    });

    test('an in-region link reports the difference rather than clamping it', async function (assert) {
      let setup = await measureConnectionSetup(replay([14, 12, 11, 11]), {
        yieldTick: noYield,
      });
      assert.strictEqual(setup.setupMs, 3);
      let flat = await measureConnectionSetup(replay([11, 12, 11, 13]), {
        yieldTick: noYield,
      });
      assert.strictEqual(
        flat.setupMs,
        0,
        'no clamp dressing jitter up as a measurement',
      );
    });

    test('yields between samples so the warm ones are genuinely warm', async function (assert) {
      let order: string[] = [];
      let probe = () => {
        order.push('probe');
        return Promise.resolve(100);
      };
      await measureConnectionSetup(probe, {
        warmSamples: 2,
        yieldTick: () => {
          order.push('yield');
          return Promise.resolve();
        },
      });
      assert.deepEqual(order, ['probe', 'yield', 'probe', 'yield', 'probe']);
    });

    test('the report shows what the subtraction was computed from', async function (assert) {
      let line = describeConnectionSetup('realms.example.test', {
        coldMs: 427,
        warmMs: 122,
        setupMs: 305,
      });
      assert.true(line.includes('~305ms'), 'the cost');
      // Both raw samples, so a wrong subtraction is visible rather than
      // authoritative.
      assert.true(line.includes('cold 427ms'), 'the cold sample');
      assert.true(line.includes('warm 122ms'), 'the warm sample');
    });

    test('a link with no measurable setup says so instead of reporting ~0ms', function (assert) {
      let line = describeConnectionSetup('realms.example.test', {
        coldMs: 12,
        warmMs: 11,
        setupMs: 1,
      });
      assert.true(line.includes('under 3ms'));
      assert.true(line.includes('close to the server'));
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

  // The concurrency a run holds, which is the only figure in a summary that
  // can be compared against a realm server's own thresholds. Getting it wrong
  // is silent in the direction that matters: a mean that tracked the
  // instantaneous count would report every burst as sustained load and put a
  // run over a rung it never approached.
  module('driver concurrency', function () {
    test('the mean is time-weighted, so a request only counts for as long as it is open', function (assert) {
      let clock = 0;
      let reading = new InFlightReading({
        halfLifeMs: 10_000,
        now: () => clock,
      });
      assert.strictEqual(reading.mean, 0, 'a driver that has sent nothing');

      let close = reading.open();
      assert.strictEqual(reading.inFlight, 1);
      assert.strictEqual(
        reading.mean,
        0,
        'a request that has only just been sent has contributed no time',
      );

      clock += 10_000; // one half-life held at 1
      assert.ok(
        Math.abs(reading.mean - 0.5) < 0.01,
        `after one half-life at 1 the mean is ~0.5, got ${reading.mean}`,
      );
      close();
    });

    test('a burst moves the mean far less than the same count held', function (assert) {
      let clock = 0;
      function meanAfter(burstMs: number, totalMs: number): number {
        clock = 0;
        let reading = new InFlightReading({
          halfLifeMs: DEFAULT_LOAD_HALF_LIFE_MS,
          now: () => clock,
        });
        let closes = [];
        for (let i = 0; i < 30; i++) {
          closes.push(reading.open());
        }
        clock += burstMs;
        for (let close of closes) {
          close();
        }
        clock += totalMs - burstMs;
        return reading.peakMean;
      }
      // The same peak count over the same wall clock, held for 5s against 10
      // minutes. This separation is the whole reason a run reports a mean: a
      // reader firing its whole query set at once produces the first shape,
      // and a policy tuned against the second must not see it as such.
      let burst = meanAfter(5_000, 600_000);
      let sustained = meanAfter(600_000, 600_000);
      assert.ok(
        burst < 1,
        `30 requests open for 5s over 10 minutes peak under 1, got ${burst}`,
      );
      assert.ok(
        sustained > 25,
        `the same 30 held for 10 minutes peak above 25, got ${sustained}`,
      );
    });

    test('the peak mean outlives the quiet stretch at the end of a run', function (assert) {
      let clock = 0;
      let reading = new InFlightReading({
        halfLifeMs: 10_000,
        now: () => clock,
      });
      let closes = [reading.open(), reading.open(), reading.open()];
      clock += 100_000; // ten half-lives held at 3
      assert.ok(
        reading.mean > 2.9,
        `held at 3 for ten half-lives, got ${reading.mean}`,
      );

      for (let close of closes) {
        close();
      }
      clock += 100_000;
      assert.ok(
        reading.mean < 0.01,
        `the mean decays back toward zero unattended, got ${reading.mean}`,
      );
      assert.ok(
        reading.peakMean > 2.9,
        `while the peak the run reached is still reportable, got ${reading.peakMean}`,
      );
    });

    test('the peak count keeps the burst the mean flattens', function (assert) {
      let clock = 0;
      let reading = new InFlightReading({
        halfLifeMs: DEFAULT_LOAD_HALF_LIFE_MS,
        now: () => clock,
      });
      let closes = [];
      for (let i = 0; i < 12; i++) {
        closes.push(reading.open());
      }
      clock += 50;
      for (let close of closes) {
        close();
      }
      clock += 600_000;
      // The admission gate acts on the instantaneous count, so a burst that
      // leaves the mean at nothing is still the thing a 429 would have come
      // from. Both numbers are reported for that reason.
      assert.strictEqual(reading.peakInFlight, 12);
      assert.ok(
        reading.peakMean < 0.1,
        `while the mean barely registers it, got ${reading.peakMean}`,
      );
    });

    test('a request closed twice is only returned once', function (assert) {
      let clock = 0;
      let reading = new InFlightReading({
        halfLifeMs: 10_000,
        now: () => clock,
      });
      let first = reading.open();
      let second = reading.open();
      first();
      first();
      assert.strictEqual(
        reading.inFlight,
        1,
        'the second request is still open',
      );
      second();
      assert.strictEqual(reading.inFlight, 0);
    });

    // The harness is copied to the box that runs it and imports nothing from
    // the repo, so its copy of the server's smoothing window can only be kept
    // honest from here. A drift would be silent in the worst way: the run would
    // still print a mean, and the mean would describe a different measurement
    // from the one the policy takes.
    test('the driver smooths over the window the server ships', function (assert) {
      assert.strictEqual(
        DEFAULT_LOAD_HALF_LIFE_MS,
        LINK_SHAPE_LOAD_HALF_LIFE_MS,
        'the harness default follows the constant the realm server defaults to',
      );
    });

    // A figure quoted without its window is not comparable to the server's, and
    // the window is a per-deployment setting rather than a constant.
    test('the summary names the window it measured over', function (assert) {
      let clock = 0;
      let shipped = new InFlightReading({
        halfLifeMs: DEFAULT_LOAD_HALF_LIFE_MS,
        now: () => clock,
      });
      assert.ok(
        describeInFlight(shipped).includes(
          `(${Math.round(DEFAULT_LOAD_HALF_LIFE_MS / 1000)}s mean)`,
        ),
        'the shipped window is named',
      );
      assert.ok(
        describeInFlight(shipped).includes('shipped default'),
        'and said to be the default, so a mismatched target is visible',
      );

      let retuned = new InFlightReading({
        halfLifeMs: 30_000,
        now: () => clock,
      });
      let summary = describeInFlight(retuned);
      assert.ok(
        summary.includes('(30s mean)'),
        `a reading over another window says so: ${summary}`,
      );
      assert.notOk(
        summary.includes('120s'),
        'and does not also claim the shipped one',
      );
    });

    test('the summary states both figures, and which is which', function (assert) {
      let clock = 0;
      let reading = new InFlightReading({
        halfLifeMs: 10_000,
        now: () => clock,
      });
      let closes = [];
      for (let i = 0; i < 7; i++) {
        closes.push(reading.open());
      }
      clock += 100_000;
      for (let close of closes) {
        close();
      }
      let summary = describeInFlight(reading);
      assert.ok(
        summary.includes('peak 7.0 searches in flight (10s mean)'),
        `the mean is reported as the mean, over its own window: ${summary}`,
      );
      assert.ok(
        summary.includes('7 at once'),
        `and the count as the count: ${summary}`,
      );
      assert.ok(
        summary.includes('boxel:link-shape-policy'),
        'and the reader is sent to the server figure this one bounds',
      );
    });
  });
});
