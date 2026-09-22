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
import {
  bootDocumentUrl,
  buildLabel,
  describeFleet,
  describePin,
  fleetDrift,
  fleetStraddle,
  parseServedBuild,
  pinIsConfirmable,
  pinIsReadable,
  readFleet,
  replicaIdFromHeaders,
  type FleetReading,
  type ServedBuild,
} from '../scripts/load-harness/lib/deploy-pin.ts';
import { LINK_SHAPE_LOAD_HALF_LIFE_MS } from '@cardstack/runtime-common';
import {
  DEFAULT_LOAD_HALF_LIFE_MS,
  describeInFlight,
  InFlightReading,
  inFlightProgressLabel,
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
import {
  classify,
  describeFairness,
  fairnessScore,
  readFairness,
  type WriteRecord,
} from '../scripts/load-harness/lib/fairness.ts';
import {
  decodeJwtClaims,
  matrixDomainFor,
  matrixIdFor,
  realmPermissionsFor,
} from '../scripts/load-harness/lib/permissions.ts';
import type { Session } from '../scripts/load-harness/lib/auth.ts';

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
          workload.writes[0]!.path,
          'Report',
          'the write path defaults to the type name',
        );
        assert.deepEqual(workload.writes[0]!.adoptsFrom, {
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
        assert.deepEqual(workload.writes[0]!.attributes, {});
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
        assert.deepEqual(
          workload.writes,
          [],
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
        workload.writes[0]!.adoptsFrom.module,
        workload.writes[0]!.adoptsFrom.name,
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
        let [write] = loadWorkload(path, realm).writes;
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
        workload.writes[0]!.adoptsFrom,
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
        workload.writes[0]!.attributes,
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
      assert.deepEqual(workload.writes, []);
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

  module('deploy pin — did the deployment hold still', function () {
    // The boot document the realm server serves, in the shape it serves it:
    // the host's config in a percent-encoded meta, an inline script, the chunk
    // preloads, and then the entry module in a `type="module"` script whose
    // src points at whichever origin holds the assets.
    function bootDocument({
      bundle = 'main-CThYvmXC.js',
      version = '0.0.0+38d67f96' as string | undefined,
      assets = 'https://assets.example.test/',
    }: {
      bundle?: string;
      version?: string;
      assets?: string;
    } = {}): string {
      let config = encodeURIComponent(
        JSON.stringify({
          modulePrefix: '@cardstack/host',
          environment: 'production',
          ...(version ? { APP: { version } } : {}),
          assetsURL: assets,
        }),
      );
      return [
        '<!DOCTYPE html><html lang="en"><head>',
        `<meta name="@cardstack/host/config/environment" content="${config}">`,
        '<script>globalThis.__boxelAssetsURL = "/";</script>',
        `<link rel="modulepreload" href="${assets}assets/chunk-Bv0JxpqV.js">`,
        `<link rel="modulepreload" href="${assets}assets/common-BZtn9ioa.js">`,
        `<script type="module" crossorigin="" src="${assets}assets/${bundle}"></script>`,
        `<link rel="stylesheet" crossorigin="" href="${assets}assets/main-BlRjxoZ5.css">`,
        '</head><body></body></html>',
      ].join('\n');
    }

    function bootResponse({
      replicaId,
      status = 200,
      ...build
    }: {
      replicaId?: string;
      status?: number;
      bundle?: string;
      version?: string | undefined;
      assets?: string;
    } = {}): Response {
      let headers = new Headers({ 'content-type': 'text/html' });
      if (replicaId) {
        headers.set(
          'x-ecs-container-metadata-uri-v4',
          `http://169.254.170.2/v4/${replicaId}`,
        );
      }
      return new Response(bootDocument(build), { status, headers });
    }

    // A load balancer handing each connection to the next replica, which is
    // what makes a wave of concurrent probes a fan-out rather than a repeat.
    function roundRobin(
      replicas: Parameters<typeof bootResponse>[0][],
    ): typeof fetch {
      let next = 0;
      return (() =>
        Promise.resolve(
          bootResponse(replicas[next++ % replicas.length]),
        )) as unknown as typeof fetch;
    }

    const build = (
      bundle: string | undefined,
      hostVersion: string | undefined,
    ): ServedBuild => ({ bundle, hostVersion });

    // A reading, written as what each replica answered with: a build, or
    // `undefined` for a replica that answered without a usable document.
    function reading(
      replicas: Record<string, ServedBuild | undefined>,
      {
        probes = 8,
        responses = Object.keys(replicas).length,
      }: { probes?: number; responses?: number } = {},
    ): FleetReading {
      // Mirrors what a reading can actually hold: a document that named
      // neither identifier is not a build, so it never reaches `builds`.
      let served = (
        Object.values(replicas).filter(Boolean) as ServedBuild[]
      ).filter((b) => b.bundle !== undefined || b.hostVersion !== undefined);
      return {
        replicas: new Set(Object.keys(replicas)),
        builds: new Map(served.map((b) => [buildLabel(b), b])),
        probes,
        responses,
      };
    }

    const EMPTY_READING: FleetReading = {
      replicas: new Set(),
      builds: new Map(),
      probes: 8,
      responses: 0,
    };

    test('reads the entry bundle and the host build version from a boot document', function (assert) {
      let served = parseServedBuild(bootDocument());
      assert.strictEqual(served.bundle, 'main-CThYvmXC.js');
      assert.strictEqual(served.hostVersion, '0.0.0+38d67f96');
    });

    test('the entry is the module script, not the first script and not a preload', function (assert) {
      // The document names dozens of chunks and one entry, and the chunks come
      // first. Reading one of those, or the inline script that precedes the
      // entry, would pin the run to something that changes on a different
      // schedule from the build a browser boots.
      let html = bootDocument();
      assert.true(
        html.indexOf('modulepreload') < html.indexOf('type="module"'),
        'the preloads precede the entry, as they do in the served document',
      );
      assert.true(
        html.indexOf('<script>') < html.indexOf('type="module"'),
        'so does an inline script',
      );
      assert.strictEqual(parseServedBuild(html).bundle, 'main-CThYvmXC.js');
    });

    test('a document that is not the host app pins nothing rather than pinning a guess', function (assert) {
      let served = parseServedBuild('<html><body>Bad Gateway</body></html>');
      assert.strictEqual(served.bundle, undefined);
      assert.strictEqual(served.hostVersion, undefined);
      assert.false(
        pinIsReadable(reading({ 'task-a': served })),
        'an unreadable pin has to say so, or a number gets quoted as one build’s',
      );
    });

    test('an unreadable config still leaves the bundle pinned', function (assert) {
      let html = bootDocument().replace(
        /content="[^"]*"/,
        'content="%E0%A4%A"',
      );
      let served = parseServedBuild(html);
      assert.strictEqual(served.bundle, 'main-CThYvmXC.js');
      assert.strictEqual(served.hostVersion, undefined);
      assert.true(pinIsReadable(reading({ 'task-a': served })));
    });

    test('the replica id comes off the container metadata header', function (assert) {
      assert.strictEqual(
        replicaIdFromHeaders(
          new Headers({
            'x-ecs-container-metadata-uri-v4':
              'http://169.254.170.2/v4/6654a7425d164a77803fe13a88ae21ab-3236013547',
          }),
        ),
        '6654a7425d164a77803fe13a88ae21ab-3236013547',
      );
      assert.strictEqual(
        replicaIdFromHeaders(new Headers()),
        undefined,
        'a deployment that identifies no replica is not a deployment that turned over',
      );
    });

    test('the boot document is probed on the host-app route', function (assert) {
      assert.strictEqual(
        bootDocumentUrl('https://realms.example.test'),
        'https://realms.example.test/_standby',
      );
      assert.strictEqual(
        bootDocumentUrl('https://realms.example.test/'),
        'https://realms.example.test/_standby',
      );
    });

    test('a wave probes concurrently, which is what reaches more than one replica', async function (assert) {
      let inFlight = 0;
      let peak = 0;
      let fetchImpl = (() => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        return new Promise<Response>((resolve) =>
          setTimeout(() => {
            inFlight--;
            resolve(bootResponse({ replicaId: 'task-a' }));
          }, 0),
        );
      }) as unknown as typeof fetch;
      await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
        maxWaves: 1,
      });
      assert.strictEqual(
        peak,
        4,
        'all four probes of a wave were open at once',
      );
    });

    test('every probe asks for its own connection, and for HTML', async function (assert) {
      // Concurrency alone only widens the sample WITHIN a wave: by the time
      // the next wave is issued the pool's sockets are free again, and undici
      // prefers a free socket to a new one — so a keep-alive reading converges
      // on the connections its first wave opened and never meets the rest of a
      // fleet. Measured against a server reporting the socket each request
      // arrived on: 4, 5, 5 distinct sockets over three waves of four with
      // keep-alive; 4, 8, 12 without it. The Accept matters as much: the realm
      // server answers a request that does not ask for HTML from a different
      // handler, and the reading would name no build at all.
      let sent: Record<string, string>[] = [];
      let fetchImpl = ((_url: string, init: RequestInit) => {
        sent.push(init.headers as Record<string, string>);
        return Promise.resolve(bootResponse({ replicaId: 'task-a' }));
      }) as unknown as typeof fetch;
      await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 2,
        maxWaves: 2,
      });
      assert.true(sent.length > 0, 'probes were issued');
      for (let headers of sent) {
        assert.strictEqual(headers.Connection, 'close');
        assert.strictEqual(headers.Accept, 'text/html');
      }
    });

    test('probing stops once a wave discovers nobody new', async function (assert) {
      let fetchImpl = roundRobin([
        { replicaId: 'task-a' },
        { replicaId: 'task-b' },
      ]);
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
        maxWaves: 4,
      });
      assert.deepEqual([...fleet.replicas], ['task-a', 'task-b']);
      assert.strictEqual(
        fleet.probes,
        8,
        'a second wave confirms the first found everyone; a third would only cost requests',
      );
      assert.strictEqual(fleet.responses, 8);
    });

    test('probing keeps going while a replica it was told to expect has not answered', async function (assert) {
      // Which is what separates "this replica is gone" from "this reading did
      // not happen to reach it" — and a departure refuses a run.
      let calls = 0;
      let lateFleet = () =>
        (() =>
          Promise.resolve(
            bootResponse({ replicaId: ++calls > 8 ? 'task-b' : 'task-a' }),
          )) as unknown as typeof fetch;

      calls = 0;
      let unaware = await readFleet('https://realms.example.test/_standby', {
        fetchImpl: lateFleet(),
        waveSize: 4,
        maxWaves: 4,
      });
      assert.deepEqual(
        [...unaware.replicas],
        ['task-a'],
        'a reading with nothing to look for stops as soon as a wave adds nobody',
      );

      calls = 0;
      let expecting = await readFleet('https://realms.example.test/_standby', {
        fetchImpl: lateFleet(),
        waveSize: 4,
        maxWaves: 4,
        expect: ['task-a', 'task-b'],
      });
      assert.deepEqual([...expecting.replicas].sort(), ['task-a', 'task-b']);
    });

    test('probing is capped however much each wave keeps finding', async function (assert) {
      let n = 0;
      let fetchImpl = (() =>
        Promise.resolve(
          bootResponse({ replicaId: `task-${n++}` }),
        )) as unknown as typeof fetch;
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
        maxWaves: 3,
      });
      assert.strictEqual(fleet.probes, 12, 'three waves of four, and no more');
    });

    test('a target that answers nothing is reported unpinned rather than unchanged', async function (assert) {
      let fetchImpl = (() =>
        Promise.reject(
          new Error('connect ECONNREFUSED'),
        )) as unknown as typeof fetch;
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
        maxWaves: 4,
      });
      assert.strictEqual(fleet.responses, 0);
      assert.strictEqual(
        fleet.probes,
        8,
        'one unlucky moment gets a second wave before the target is called unreachable',
      );
      assert.true(
        describeFleet(fleet, 'https://realms.example.test/_standby').includes(
          'not pinned',
        ),
      );
    });

    test('an error keeps the replica that sent it and drops only its document', async function (assert) {
      // A replica answering 502 has still said it is there. Discarding its id
      // with the unusable document would report it as departed at the close
      // and refuse a run over a transient error.
      let fetchImpl = roundRobin([{ replicaId: 'task-a', status: 502 }]);
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 2,
        maxWaves: 2,
      });
      assert.deepEqual([...fleet.replicas], ['task-a']);
      assert.strictEqual(fleet.builds.size, 0, 'and names no build');
      assert.false(pinIsReadable(fleet));
    });

    test('a 200 that is not the boot document names no build', async function (assert) {
      // A proxy's interstitial parses to a build with nothing in it. Recording
      // that would stand a second "build" beside the real one — a straddle
      // before the run, or a build that moved at the close, out of a fleet
      // that never changed.
      let interstitial = new Response(
        '<html><body>Service temporarily unavailable</body></html>',
        {
          status: 200,
          headers: new Headers({
            'content-type': 'text/html',
            'x-ecs-container-metadata-uri-v4': 'http://169.254.170.2/v4/task-b',
          }),
        },
      );
      let next = 0;
      let fetchImpl = (() =>
        Promise.resolve(
          next++ % 2
            ? bootResponse({ replicaId: 'task-a' })
            : interstitial.clone(),
        )) as unknown as typeof fetch;
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
      });
      assert.deepEqual([...fleet.replicas].sort(), ['task-a', 'task-b']);
      assert.deepEqual(
        [...fleet.builds.keys()],
        ['main-CThYvmXC.js (0.0.0+38d67f96)'],
        'only the document that named something',
      );
      assert.deepEqual(fleetStraddle(fleet), []);
    });

    test('a replica erroring at the close is not a replica that left', function (assert) {
      let good = build('main-CThYvmXC.js', '0.0.0+38d67f96');
      let drift = fleetDrift(
        reading({ 'task-a': good, 'task-b': good }),
        reading({ 'task-a': good, 'task-b': undefined }),
      );
      assert.deepEqual(drift, []);
    });

    test('a close that answered only errors is unconfirmed, not unchanged', function (assert) {
      // Every answer identifying a replica and none carrying a document would
      // otherwise compare an empty build set against the opening one, find
      // nothing missing, and report the pin as held.
      let before = reading({
        'task-a': build('main-CThYvmXC.js', '0.0.0+38d67f96'),
      });
      let after = reading({ 'task-a': undefined });
      assert.false(pinIsConfirmable(after));
      assert.deepEqual(fleetDrift(before, after), []);
      assert.true(describePin(before, after).includes('NOT CONFIRMED'));
    });

    test('a fleet already serving two builds is caught before the run, not after', async function (assert) {
      // Each replica caches the boot document for the life of its process, so
      // replicas that started either side of a host deploy serve two builds at
      // once and a browser gets whichever answers.
      let fetchImpl = roundRobin([
        { replicaId: 'task-a', bundle: 'main-BPZqYHJZ.js' },
        { replicaId: 'task-b', bundle: 'main-CFoh7RJ4.js' },
      ]);
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
      });
      let straddle = fleetStraddle(fleet);
      assert.strictEqual(straddle.length, 1);
      assert.true(straddle[0].includes('main-BPZqYHJZ.js'));
      assert.true(straddle[0].includes('main-CFoh7RJ4.js'));
    });

    test('a straddle is caught on a target that identifies no replicas at all', async function (assert) {
      // Builds are recorded apart from replica identity for this case: file
      // them under the replica key and every probe overwrites the last, so a
      // fleet mid-rollout reports whichever response happened to finish last
      // and the run proceeds across two builds.
      let fetchImpl = roundRobin([
        { bundle: 'main-BPZqYHJZ.js' },
        { bundle: 'main-CFoh7RJ4.js' },
      ]);
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
      });
      assert.strictEqual(
        fleet.replicas.size,
        1,
        'nothing identifies the replicas',
      );
      assert.strictEqual(fleet.builds.size, 2, 'both builds are kept anyway');
      assert.strictEqual(fleetStraddle(fleet).length, 1);
    });

    test('one build across every replica is not a straddle', async function (assert) {
      let fetchImpl = roundRobin([
        { replicaId: 'task-a' },
        { replicaId: 'task-b' },
      ]);
      let fleet = await readFleet('https://realms.example.test/_standby', {
        fetchImpl,
        waveSize: 4,
      });
      assert.deepEqual(fleetStraddle(fleet), []);
      assert.true(
        describeFleet(fleet, 'https://realms.example.test/_standby').includes(
          '2 replicas',
        ),
      );
    });

    test('a run whose deployment held still reports no drift', function (assert) {
      let before = reading({
        'task-a': build('main-CThYvmXC.js', '0.0.0+38d67f96'),
        'task-b': build('main-CThYvmXC.js', '0.0.0+38d67f96'),
      });
      let after = reading({
        'task-b': build('main-CThYvmXC.js', '0.0.0+38d67f96'),
        'task-a': build('main-CThYvmXC.js', '0.0.0+38d67f96'),
      });
      assert.deepEqual(
        fleetDrift(before, after),
        [],
        'the same replicas serving the same build, in whatever order they answered',
      );
      let pin = describePin(before, after);
      assert.true(pin.includes('main-CThYvmXC.js'), 'the bundle');
      assert.true(pin.includes('0.0.0+38d67f96'), 'the host build version');
    });

    test('a host bundle that moved mid-run is reported with both builds', function (assert) {
      let drift = fleetDrift(
        reading({ 'task-a': build('main-BPZqYHJZ.js', '0.0.0+fdcc601a') }),
        reading({ 'task-a': build('main-CFoh7RJ4.js', '0.0.0+fdcc601a') }),
      );
      assert.strictEqual(drift.length, 1);
      assert.true(drift[0].includes('main-BPZqYHJZ.js'), 'what it was');
      assert.true(drift[0].includes('main-CFoh7RJ4.js'), 'what it became');
    });

    test('a host version that moved is caught even when the bundle name did not', function (assert) {
      // The two are separate facts about the same build, and a check that
      // reads only one of them is a check that can be passed by the other.
      let drift = fleetDrift(
        reading({ 'task-a': build('main-CThYvmXC.js', '0.0.0+38d67f96') }),
        reading({ 'task-a': build('main-CThYvmXC.js', '0.0.0+b707165c') }),
      );
      assert.strictEqual(drift.length, 1);
      assert.true(drift[0].includes('0.0.0+b707165c'));
    });

    test('a replica that arrived mid-run is drift even when it serves the same build', function (assert) {
      // A replaced task is a cold task: its caches are empty and the part of
      // the window it served is not comparable to the rest.
      let same = build('main-CThYvmXC.js', '0.0.0+38d67f96');
      let drift = fleetDrift(
        reading({ 'task-a': same, 'task-b': same }),
        reading({ 'task-a': same, 'task-c': same }),
      );
      assert.strictEqual(drift.length, 1);
      assert.true(drift[0].includes('1 replica arrived'));
      assert.true(drift[0].includes('1 replica left'));
    });

    test('a replica that left mid-run is drift on its own', function (assert) {
      // A fleet that shrank carried a different share of the load through the
      // rest of the window, which is the number this harness reports.
      let same = build('main-CThYvmXC.js', '0.0.0+38d67f96');
      let drift = fleetDrift(
        reading({ 'task-a': same, 'task-b': same }),
        reading({ 'task-a': same }),
      );
      assert.strictEqual(drift.length, 1);
      assert.true(drift[0].includes('1 replica left'));
      assert.false(
        drift[0].includes('arrived'),
        'nothing arrived, and saying so would misdescribe the fleet',
      );
    });

    test('a deployment that identifies no replicas reports its build moving, and nothing else', function (assert) {
      // Every response files under one key, so there is no turnover to report
      // — and filing builds by replica instead would turn one host deploy into
      // a phantom fleet change as well.
      let drift = fleetDrift(
        reading({ unidentified: build('main-QY-TXAfv.js', '0.0.0+b707165c') }),
        reading({ unidentified: build('main-CowsK790.js', '0.0.0+969ffde0') }),
      );
      assert.strictEqual(drift.length, 1);
      assert.true(drift[0].includes('the host build moved'));
    });

    test('a local deployment that held still reports nothing', function (assert) {
      let same = build('main-QY-TXAfv.js', '0.0.0+b707165c');
      assert.deepEqual(
        fleetDrift(
          reading({ unidentified: same }),
          reading({ unidentified: same }),
        ),
        [],
      );
    });

    test('a closing probe that answered nothing reports an unconfirmed pin, not a deploy', function (assert) {
      // Silence says the pin is unknown, not that the deployment moved —
      // and the likeliest target to go quiet at the close is the one this
      // harness just spent an hour saturating. Throwing that hour away on a
      // question the probe could not ask is the wrong trade; saying the pin
      // was never confirmed is not.
      let before = reading({
        'task-a': build('main-CThYvmXC.js', '0.0.0+38d67f96'),
      });
      assert.deepEqual(fleetDrift(before, EMPTY_READING), []);
      assert.false(pinIsConfirmable(EMPTY_READING));
      let pin = describePin(before, EMPTY_READING);
      assert.true(pin.includes('NOT CONFIRMED'));
      assert.true(pin.includes('main-CThYvmXC.js'), 'what it was pinned to');
    });

    test('an opening probe that answered nothing cannot manufacture drift', function (assert) {
      // Nothing was pinned, so nothing can have moved — and a comparison
      // against an empty reading would otherwise announce a build that moved
      // from nothing to whatever the close saw.
      let after = reading({
        'task-a': build('main-CThYvmXC.js', '0.0.0+38d67f96'),
      });
      assert.deepEqual(fleetDrift(EMPTY_READING, after), []);
      assert.true(describePin(EMPTY_READING, after).includes('not pinned'));
    });

    test('an unpinned run says so in the summary instead of claiming a build', function (assert) {
      let unpinned = reading({ 'task-a': build(undefined, undefined) });
      assert.true(describePin(unpinned, unpinned).includes('not pinned'));
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

    // The progress line is what a long run is steered by, and it is the figure
    // most likely to be quoted away from the summary that would otherwise say
    // which window it was taken over.
    test('the live figure carries its window too', function (assert) {
      let clock = 0;
      let reading = new InFlightReading({
        halfLifeMs: DEFAULT_LOAD_HALF_LIFE_MS,
        now: () => clock,
      });
      let closes = [];
      for (let i = 0; i < 4; i++) {
        closes.push(reading.open());
      }
      clock += 10 * DEFAULT_LOAD_HALF_LIFE_MS;
      assert.strictEqual(inFlightProgressLabel(reading), '4.0@120s');

      clock = 0;
      let retuned = new InFlightReading({
        halfLifeMs: 30_000,
        now: () => clock,
      });
      let close = retuned.open();
      clock += 10 * 30_000;
      assert.strictEqual(
        inFlightProgressLabel(retuned),
        '1.0@30s',
        'a run against a target that smooths differently says so on every line',
      );
      close();
      for (let c of closes) {
        c();
      }
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

  module('write blocks — two identities on one realm', function () {
    const realm = 'https://example.test/owner/load-test/';

    function parse(raw: Record<string, unknown>) {
      return parseWorkload(
        {
          queries: [
            {
              label: 'W',
              filter: { 'item.on': { module: '${realm}w', name: 'W' } },
            },
          ],
          ...raw,
        },
        realm,
        'workload.json',
      );
    }

    test('a single "write" block is one entry in "writes"', function (assert) {
      // The spelling every existing workload file uses, and the one
      // derive-workload emits. It has to keep meaning what it meant.
      let workload = parse({
        write: {
          adoptsFrom: { module: '${realm}schema/report', name: 'Report' },
          attributes: { title: 'x' },
        },
      });
      assert.strictEqual(workload.writes.length, 1);
      assert.strictEqual(workload.writes[0].method, 'POST', 'the default');
      assert.strictEqual(
        workload.writes[0].path,
        'Report',
        'and a POST path still defaults to the type name',
      );
      assert.strictEqual(
        workload.writes[0].label,
        'Report',
        'the label defaults to the type name, so a one-block run reads the same',
      );
    });

    test('"writes" carries a block per kind of write', function (assert) {
      let workload = parse({
        writes: [
          {
            label: 'hub',
            method: 'PATCH',
            path: 'Course/intro',
            everyMs: 30000,
            adoptsFrom: { module: '${realm}course', name: 'Course' },
            attributes: { title: 'rev ${n}' },
          },
          {
            label: 'leaf',
            username: 'loadtest02',
            everyMs: 5000,
            adoptsFrom: { module: '${realm}note', name: 'Note' },
            attributes: { title: 'note ${n}' },
          },
        ],
      });
      assert.deepEqual(
        workload.writes.map((w) => [
          w.label,
          w.method,
          w.path,
          w.everyMs,
          w.username,
        ]),
        [
          ['hub', 'PATCH', 'Course/intro', 30000, undefined],
          ['leaf', 'POST', 'Note', 5000, 'loadtest02'],
        ],
      );
      assert.strictEqual(
        workload.writes[0].adoptsFrom.module,
        `${realm}course`,
        '${realm} expands inside a block like anywhere else',
      );
    });

    test('naming both "write" and "writes" is refused', function (assert) {
      // Two answers to one question. A precedence rule would be a thing to
      // misremember while reading a run's numbers back.
      assert.throws(
        () =>
          parse({
            write: {
              adoptsFrom: { module: '${realm}a', name: 'A' },
            },
            writes: [{ adoptsFrom: { module: '${realm}b', name: 'B' } }],
          }),
        /"write" and "writes" both name/,
      );
    });

    test('two blocks cannot share a label', function (assert) {
      // The label keys the fairness table, and the table exists precisely so
      // an expensive block and a cheap one are not averaged together.
      assert.throws(
        () =>
          parse({
            writes: [
              { label: 'w', adoptsFrom: { module: '${realm}a', name: 'A' } },
              { label: 'w', adoptsFrom: { module: '${realm}b', name: 'B' } },
            ],
          }),
        /labelled "w"/,
      );
    });

    test('a PATCH block must name the card it patches', function (assert) {
      // A POST addresses a collection and the realm names the card. There is
      // no such thing as patching a collection, so there is no default.
      assert.throws(
        () =>
          parse({
            writes: [
              {
                method: 'PATCH',
                adoptsFrom: { module: '${realm}a', name: 'A' },
                attributes: { title: '${n}' },
              },
            ],
          }),
        /path" is required for a PATCH block/,
      );
    });

    test('a PATCH block whose attributes never change is refused', function (assert) {
      // The realm leaves an unchanged card's file exactly as it is, so such a
      // block persists nothing and runs no index pass — it would sit in the
      // run contributing no work while the summary counted it as a writer.
      // That is a null result wearing a measurement's clothes.
      assert.throws(
        () =>
          parse({
            writes: [
              {
                method: 'PATCH',
                path: 'A/one',
                adoptsFrom: { module: '${realm}a', name: 'A' },
                attributes: { title: 'always the same' },
              },
            ],
          }),
        /same on every write/,
      );
      assert.ok(
        parse({
          writes: [
            {
              method: 'PATCH',
              path: 'A/one',
              adoptsFrom: { module: '${realm}a', name: 'A' },
              attributes: { nested: { tags: ['run-${n}'] } },
            },
          ],
        }),
        'a varying attribute anywhere in the tree satisfies it',
      );
    });

    test('a POST block needs no varying attribute', function (assert) {
      // It creates a new card per write whatever the attributes say.
      assert.strictEqual(
        parse({
          writes: [
            {
              adoptsFrom: { module: '${realm}a', name: 'A' },
              attributes: { title: 'always the same' },
            },
          ],
        }).writes.length,
        1,
      );
    });

    test('malformed block members are refused at load', function (assert) {
      for (let [block, pattern] of [
        [{ method: 'PUT' }, /must be "POST" or "PATCH"/],
        [{ everyMs: 0 }, /positive number of ms/],
        [{ everyMs: 'fast' }, /positive number of ms/],
        [{ label: 7 }, /label" must be a string/],
        [{ username: 7 }, /username" must be a string/],
      ] as [Record<string, unknown>, RegExp][]) {
        assert.throws(
          () =>
            parse({
              writes: [
                {
                  adoptsFrom: { module: '${realm}a', name: 'A' },
                  ...block,
                },
              ],
            }),
          pattern,
          `${JSON.stringify(block)} is caught before any login happens`,
        );
      }
      assert.throws(() => parse({ writes: [] }), /non-empty array/);
    });
  });

  module(
    'fairness — did a write wait on somebody else’s indexing?',
    function () {
      function record(
        block: string,
        userId: string,
        startedAt: number,
        endedAt: number,
      ): WriteRecord {
        return { block, userId, startedAt, endedAt };
      }

      test('a write nothing overlapped is clear', function (assert) {
        let records = [
          record('leaf', '@a:test', 0, 100),
          record('leaf', '@a:test', 200, 300),
        ];
        assert.strictEqual(classify(records[0], records), 'clear');
        assert.strictEqual(classify(records[1], records), 'clear');
      });

      test('starting inside another identity’s window and finishing later is behind-other', function (assert) {
        // The ordering one lane per realm forces: the second pass cannot be
        // claimed until the first releases its reservation.
        let hub = record('hub', '@a:test', 0, 1000);
        let leaf = record('leaf', '@b:test', 100, 1100);
        let records = [hub, leaf];
        assert.strictEqual(classify(leaf, records), 'behind-other');
        assert.strictEqual(
          classify(hub, records),
          'clear',
          'the blocker itself waited on nobody',
        );
      });

      test('the same identity blocking itself is reported apart', function (assert) {
        // Self-contention is a real effect and a different ticket. Folding it
        // in would inflate the figure that decides whether the lane should be
        // keyed on the writer.
        let first = record('leaf', '@a:test', 0, 1000);
        let second = record('leaf', '@a:test', 100, 1100);
        assert.strictEqual(classify(second, [first, second]), 'behind-self');
      });

      test('a different identity outranks a same-identity blocker', function (assert) {
        let mine = record('leaf', '@a:test', 0, 1000);
        let theirs = record('hub', '@b:test', 50, 1000);
        let subject = record('leaf', '@a:test', 100, 1100);
        assert.strictEqual(
          classify(subject, [mine, theirs, subject]),
          'behind-other',
        );
      });

      test('two identical windows are behind neither', function (assert) {
        // The bounds would otherwise read each as behind the other, counting
        // one pair twice in the figure whose whole job is to be counted
        // honestly. The driver cannot tell which pass ran first, so it says
        // neither rather than both.
        let a = record('leaf', '@a:test', 500, 1500);
        let b = record('hub', '@b:test', 500, 1500);
        assert.strictEqual(classify(a, [a, b]), 'clear');
        assert.strictEqual(classify(b, [a, b]), 'clear');
        let reading = readFairness([a, b]);
        assert.strictEqual(reading.behindOther, 0);
        assert.strictEqual(
          reading.overlappedOther,
          2,
          'they did overlap, and that is still reported',
        );
      });

      test('overlapping is not the same as being behind', function (assert) {
        // A write can overlap another and still finish first, which is not the
        // ordering a serial lane forces. Counting it as blocked would report
        // contention wherever two writes merely coincided.
        let long = record('hub', '@a:test', 0, 1000);
        let quick = record('leaf', '@b:test', 100, 200);
        let reading = readFairness([long, quick]);
        assert.strictEqual(reading.behindOther, 0, 'neither ran behind');
        assert.strictEqual(
          reading.overlappedOther,
          2,
          'but both overlapped the other identity, and that is reported too',
        );
      });

      test('the score compares a block against itself, not against other blocks', function (assert) {
        let records = [
          // Leaf alone: 100ms each.
          record('leaf', '@b:test', 0, 100),
          record('leaf', '@b:test', 200, 300),
          // Hub running long, with a leaf write caught inside it.
          record('hub', '@a:test', 400, 2400),
          record('leaf', '@b:test', 500, 2500),
        ];
        let reading = readFairness(records);
        assert.strictEqual(reading.behindOther, 1);
        let leaf = reading.blocks.find((b) => b.block === 'leaf')!;
        assert.deepEqual(leaf.clear, [100, 100]);
        assert.deepEqual(leaf.behindOther, [2000]);
        assert.strictEqual(
          fairnessScore(leaf)!.toFixed(2),
          '0.05',
          'the blocked leaf write cost twenty times what an unblocked one did',
        );
      });

      test('an empty bucket is "not measured", never 1.00', function (assert) {
        // The failure this whole capability exists to prevent. A run where the
        // lane was never contended scoring a perfect 1.00 reports a property
        // of the workload as a property of the fix.
        let reading = readFairness([
          record('leaf', '@a:test', 0, 100),
          record('leaf', '@a:test', 200, 300),
        ]);
        let leaf = reading.blocks[0];
        assert.strictEqual(fairnessScore(leaf), undefined);
        let summary = describeFairness(reading);
        assert.ok(
          summary.includes('not measured'),
          `the section says so in words: ${summary}`,
        );
        assert.notOk(
          /fairness\s+1\.00/.test(summary),
          'and never prints a score it did not measure',
        );
      });

      test('a one-identity run says so rather than reporting a fair lane', function (assert) {
        let summary = describeFairness(
          readFairness([
            record('leaf', '@a:test', 0, 1000),
            record('leaf', '@a:test', 100, 1100),
          ]),
        );
        assert.ok(
          summary.includes('all 2 writes came from one identity'),
          `the zero cross-writer count is attributed to the run's shape: ${summary}`,
        );
        assert.ok(summary.includes('@a:test'), 'and names the identity');
      });

      test('a read-only run says the question cannot be answered', function (assert) {
        let summary = describeFairness(readFairness([]));
        assert.ok(summary.includes('no writes completed'), summary);
        assert.notOk(summary.includes('fairness      1.00'), summary);
      });

      test('the section names the join that would confirm it', function (assert) {
        // These are HTTP windows, not queue rows, and the output has to say
        // where the server's own answer lives.
        let summary = describeFairness(
          readFairness([
            record('hub', '@a:test', 0, 1000),
            record('leaf', '@b:test', 100, 1100),
            record('leaf', '@b:test', 2000, 2100),
          ]),
        );
        assert.ok(summary.includes('x-boxel-logging-correlation-id'), summary);
        assert.ok(summary.includes('awaitIndex'), summary);
        assert.ok(summary.includes('cross-writer blocked: 1 of 3'), summary);
      });
    },
  );

  module('realm write permission', function () {
    const realm = 'https://example.test/owner/load-test/';

    function sessionWith(claims: unknown, key = realm): Session {
      let payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return {
        userId: '@a:example.test',
        username: 'a',
        accessToken: 'x',
        serverToken: 'Bearer server.token.here',
        realmTokens: { [key]: `Bearer header.${payload}.signature` },
      };
    }

    test('reads the permissions the realm put in the session token', function (assert) {
      // `_realm-auth` states each user's permissions in the JWT it mints, so
      // the answer is in hand before the run starts and costs no round trip —
      // which matters, because the endpoint that would answer it directly is
      // owner-only and a writer is not the owner.
      assert.deepEqual(
        realmPermissionsFor(sessionWith({ permissions: ['read'] }), realm),
        ['read'],
      );
      assert.deepEqual(
        realmPermissionsFor(
          sessionWith({ permissions: ['read', 'write'] }),
          realm,
        ),
        ['read', 'write'],
      );
    });

    test('a realm the session has no token for is a definite no', function (assert) {
      assert.deepEqual(
        realmPermissionsFor(
          sessionWith({ permissions: ['read', 'write'] }, 'https://other/'),
          realm,
        ),
        [],
        'no entry means no grant, which is an answer rather than a silence',
      );
    });

    test('an unreadable token is "cannot tell", not "no"', function (assert) {
      // A token shape the harness does not recognise must not refuse a run
      // that would have worked. The realm still answers 403 if the grant is
      // genuinely missing, and the summary reports a writer that landed
      // nothing.
      let session: Session = {
        userId: '@a:example.test',
        username: 'a',
        accessToken: 'x',
        serverToken: 'Bearer s',
        realmTokens: { [realm]: 'not-a-jwt' },
      };
      assert.strictEqual(realmPermissionsFor(session, realm), undefined);
      assert.strictEqual(
        realmPermissionsFor(sessionWith({ user: '@a:example.test' }), realm),
        undefined,
        'and so is a token that simply does not state permissions',
      );
    });

    test('decodes claims without verifying them', function (assert) {
      assert.deepEqual(
        decodeJwtClaims(
          `Bearer h.${Buffer.from('{"user":"@a:t"}').toString('base64url')}.s`,
        ),
        { user: '@a:t' },
      );
      for (let bad of ['', 'one.two', 'a.b.c', 'h..s']) {
        assert.strictEqual(
          decodeJwtClaims(bad),
          undefined,
          `${bad} is not a token this can read`,
        );
      }
    });

    test('matrix ids are built the way the deployments spell them', function (assert) {
      assert.strictEqual(
        matrixDomainFor('https://matrix-staging.stack.cards'),
        'stack.cards',
      );
      assert.strictEqual(
        matrixIdFor('loadtest02', 'stack.cards'),
        '@loadtest02:stack.cards',
      );
      assert.strictEqual(
        matrixIdFor('@loadtest02:stack.cards', 'stack.cards'),
        '@loadtest02:stack.cards',
        'a row that already carries a full id is left alone',
      );
    });
  });
});
