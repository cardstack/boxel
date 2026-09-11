import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type { DBAdapter, Realm } from '@cardstack/runtime-common';
import {
  setupPermissionedRealmCached,
  createJWT,
  withRealmPath,
  type RealmRequest,
} from './helpers/index.ts';
import {
  depsForIndexEntry,
  settlePrerenderHtmlJobs,
} from './helpers/indexing.ts';

const testRealm = new URL('http://127.0.0.1:4445/test/');

// One card definition with a `friend` link that its templates RENDER, and
// that is deliberately NOT `searchable`. Rendering is what records the link
// target as a dependency of the card that links to it, and those recorded
// dependencies are what the invalidation walk reads to find a written URL's
// dependents. A link the templates never read is not captured, however the
// field is declared, and a card with no recorded dependency on the target
// never reaches the pass's fan-out at all.
//
// Leaving `searchable` off is what makes these scenarios exercise the
// ordering under test. A `searchable` link is followed by the search-doc
// walk, whose collected targets the meta route unions into the index
// channel's own `deps` — an edge the dependency ordering reads, which would
// put the target first on its own. Recorded only by the render, the edge
// lands on the render channel, which the invalidation walk reads and the
// ordering does not: the fan-out still finds the dependents, and nothing but
// the write's own URL can put the target ahead of them.
//
// `friend` renders as `atom`, which reads only `firstName`, so the render
// follows the link exactly one hop rather than recursing through the graph.
function makeFileSystem() {
  return {
    'person.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person);
        static atom = class Atom extends Component<typeof this> {
          <template>
            <span><@fields.firstName /></span>
          </template>
        }
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /></h1>
            <p>friend <@fields.friend @format='atom' /></p>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1>Embedded: <@fields.firstName/></h1>
            <p>friend <@fields.friend @format='atom' /></p>
          </template>
        }
        static fitted = class Fitted extends Component<typeof this> {
          <template>
            <h1>Fitted: <@fields.firstName/></h1>
          </template>
        }
      }
    `,
  };
}

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let testDbAdapter: DBAdapter;
  let request: RealmRequest;

  setupPermissionedRealmCached(hooks, {
    mode: 'beforeEach',
    realmURL: testRealm,
    permissions: {
      '*': ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'write', 'realm-owner'],
    },
    fileSystem: makeFileSystem(),
    onRealmSetup(args) {
      realm = args.testRealm;
      testDbAdapter = args.dbAdapter;
      request = withRealmPath(args.request, testRealm);
    },
  });

  // A push, then both channels drained: the index job so its rows are
  // written and attributed to a finished pass, and the prerender_html job it
  // spawns so the next push starts from a quiet queue. Every `/_atomic`
  // response is 201, add and update alike.
  async function push(
    assert: Assert,
    label: string,
    operations: Record<string, unknown>[],
  ): Promise<void> {
    let response = await request
      .post('/_atomic')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
      )
      .send(JSON.stringify({ 'atomic:operations': operations }));
    assert.strictEqual(response.status, 201, label);
    await realm.incrementalIndexing();
    await settlePrerenderHtmlJobs(testDbAdapter, realm.url);
  }

  // The dependencies an instance records across both channels — the index
  // visit's own edges plus the ones only a format render discovers — which is
  // the union the invalidation walk consults. A dependent reaches a pass's
  // fan-out only by naming the written URL somewhere in here, so every
  // scenario asserts this before it asserts an order: a fan-out that came
  // back empty would otherwise read as an ordering failure.
  async function depsOf(path: string): Promise<string[]> {
    return depsForIndexEntry(testDbAdapter, `${realm.url}${path}`);
  }

  async function assertDependsOnTarget(
    assert: Assert,
    dependent: string,
    target: string,
  ): Promise<void> {
    let deps = await depsOf(dependent);
    assert.ok(
      deps.some((dep) => dep === `${realm.url}${target}`),
      `precondition: ${dependent} records a dependency on ${target} (deps: ${JSON.stringify(deps)})`,
    );
  }

  // Every stamped row in the realm, newest pass first. Carried into the
  // ordering assertions' messages so a failure names what the pass actually
  // wrote rather than only what it did not.
  async function stampedRows(): Promise<string> {
    let rows = (await testDbAdapter.execute(
      `select url, type,
              diagnostics->>'invalidationId' as invalidation_id,
              diagnostics->>'writeSeq'       as seq,
              diagnostics->>'indexedAt'      as indexed_at,
              is_deleted
         from boxel_index
        where realm_url = $1
        order by (diagnostics->>'indexedAt')::bigint desc nulls last, url`,
      { bind: [realm.url] },
    )) as {
      url: string;
      type: string;
      invalidation_id: string | null;
      seq: string | null;
      indexed_at: string | null;
      is_deleted: boolean | null;
    }[];
    return rows
      .map(
        (row) =>
          `${row.url.slice(realm.url.length)}/${row.type} seq=${row.seq ?? '-'} ` +
          `pass=${(row.invalidation_id ?? '-').slice(0, 8)} at=${row.indexed_at ?? '-'}` +
          `${row.is_deleted ? ' deleted' : ''}`,
      )
      .join('; ');
  }

  function person(
    op: 'add' | 'update',
    href: string,
    firstName: string,
    friendHref?: string,
  ): Record<string, unknown> {
    return {
      op,
      href,
      data: {
        type: 'card',
        attributes: { firstName },
        ...(friendHref
          ? { relationships: { friend: { links: { self: friendHref } } } }
          : {}),
        meta: { adoptsFrom: { module: rri('./person'), name: 'Person' } },
      },
    };
  }

  // The write order of the most recent indexing pass, read back off the rows
  // it wrote: `diagnostics.invalidationId` groups a pass's rows and
  // `diagnostics.writeSeq` orders them. Reduced to each URL's lowest sequence
  // because a visit writes both a `file` and an `instance` row, and the
  // question is when the URL's visit started writing. Scoped to the pass with
  // the newest `indexedAt`, so the fixture build's own pass — and the earlier
  // pushes each scenario needs to set its graph up — cannot bleed in.
  async function writeOrderOfLatestPass(): Promise<string[]> {
    let rows = (await testDbAdapter.execute(
      `select url, min((diagnostics->>'writeSeq')::int) as seq
         from boxel_index
        where realm_url = $1
          and diagnostics->>'writeSeq' is not null
          and diagnostics->>'invalidationId' = (
            select diagnostics->>'invalidationId'
              from boxel_index
             where realm_url = $1
               and diagnostics->>'writeSeq' is not null
             order by (diagnostics->>'indexedAt')::bigint desc, url
             limit 1
          )
        group by url
        order by seq`,
      { bind: [realm.url] },
    )) as { url: string; seq: number | string }[];
    return rows.map((row) => row.url);
  }

  test('a pass stamps every row it writes with its sequence and the pass it belongs to', async function (assert) {
    assert.timeout(120_000);

    await push(assert, 'the card is created', [
      person('add', 'solo.json', 'Solo'),
    ]);

    let rows = (await testDbAdapter.execute(
      `select type, diagnostics->>'writeSeq' as seq,
              diagnostics->>'invalidationId' as invalidation_id
         from boxel_index
        where url = $1
        order by type`,
      { bind: [`${realm.url}solo.json`] },
    )) as {
      type: string;
      seq: string | null;
      invalidation_id: string | null;
    }[];

    assert.strictEqual(
      rows.length,
      2,
      'the visit wrote the URL a file row and an instance row',
    );
    for (let row of rows) {
      let seq = row.seq === null ? NaN : Number(row.seq);
      assert.true(
        Number.isInteger(seq),
        `the ${row.type} row carries an integer writeSeq (got ${row.seq})`,
      );
      assert.ok(
        row.invalidation_id,
        `the ${row.type} row names the pass that wrote it`,
      );
    }
    assert.strictEqual(
      new Set(rows.map((row) => row.invalidation_id)).size,
      1,
      'both rows are attributed to the same pass',
    );
  });

  test("a write's own row is written before the dependents its fan-out found", async function (assert) {
    assert.timeout(300_000);

    // `aaa` and `bbb` both link to `zzz` and render the link, so writing
    // `zzz` fans out to all three, and `zzz` sorts last of the three. The
    // target links to neither of them, so no dependency of its own pins it
    // ahead: what the pass falls back on is the order the URLs arrived in,
    // where the target came last. Leading with the write's own URL is the
    // only thing that puts it first.
    await push(assert, 'the target is created', [
      person('add', 'zzz.json', 'Zeta'),
    ]);
    await push(assert, 'the dependents are created', [
      person('add', 'aaa.json', 'Alpha', './zzz'),
      person('add', 'bbb.json', 'Beta', './zzz'),
    ]);

    // Both dependents have to name the target for the fan-out to reach them.
    await assertDependsOnTarget(assert, 'aaa.json', 'zzz.json');
    await assertDependsOnTarget(assert, 'bbb.json', 'zzz.json');

    // The pass under test: one write naming `zzz.json`.
    await push(assert, 'the target is written', [
      person('update', 'zzz.json', 'Zeta the Second'),
    ]);

    let order = await writeOrderOfLatestPass();
    let rows = await stampedRows();
    assert.deepEqual(
      [...order].sort(),
      [`${realm.url}aaa.json`, `${realm.url}bbb.json`, `${realm.url}zzz.json`],
      `the pass visited the target and both dependents (order: ${order.join(', ')}) (rows: ${rows})`,
    );
    assert.strictEqual(
      order[0],
      `${realm.url}zzz.json`,
      `the target's row is written first (order: ${order.join(', ')})`,
    );
  });

  test('a batch writes every target before any dependent', async function (assert) {
    assert.timeout(300_000);

    // Two targets, each with one dependent linking to it, and each sorting
    // after both dependents lexically.
    await push(assert, 'the targets are created', [
      person('add', 'yyy.json', 'Ypsilon'),
      person('add', 'zzz.json', 'Zeta'),
    ]);
    await push(assert, 'the dependents are created', [
      person('add', 'aaa.json', 'Alpha', './zzz'),
      person('add', 'bbb.json', 'Beta', './yyy'),
    ]);

    await assertDependsOnTarget(assert, 'aaa.json', 'zzz.json');
    await assertDependsOnTarget(assert, 'bbb.json', 'yyy.json');

    // The pass under test: one write naming both targets.
    await push(assert, 'both targets are written', [
      person('update', 'yyy.json', 'Ypsilon the Second'),
      person('update', 'zzz.json', 'Zeta the Second'),
    ]);

    let order = await writeOrderOfLatestPass();
    let rows = await stampedRows();
    assert.deepEqual(
      [...order].sort(),
      [
        `${realm.url}aaa.json`,
        `${realm.url}bbb.json`,
        `${realm.url}yyy.json`,
        `${realm.url}zzz.json`,
      ],
      `the pass visited both targets and both dependents (order: ${order.join(', ')}) (rows: ${rows})`,
    );
    assert.deepEqual(
      order.slice(0, 2).sort(),
      [`${realm.url}yyy.json`, `${realm.url}zzz.json`],
      `both targets are written before either dependent (order: ${order.join(', ')})`,
    );
  });
});
