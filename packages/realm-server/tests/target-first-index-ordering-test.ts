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

const testRealm = new URL('http://127.0.0.1:4445/test/');

// One card definition whose `friend` link is `searchable`, which is what puts
// the link on `boxel_index.deps` — the same rows the invalidation walk reads
// to find a card's dependents and the dependency ordering reads to learn the
// edges between them. `friend` appears in no template, so a card that never
// sets it renders identically.
function makeFileSystem() {
  return {
    'person.gts': `
      import { contains, field, linksTo, CardDef, Component } from "@cardstack/base/card-api";
      import StringField from "@cardstack/base/string";

      export class Person extends CardDef {
        @field firstName = contains(StringField);
        @field friend = linksTo(() => Person, { searchable: true });
        static isolated = class Isolated extends Component<typeof this> {
          <template>
            <h1><@fields.firstName /></h1>
          </template>
        }
        static embedded = class Embedded extends Component<typeof this> {
          <template>
            <h1>Embedded: <@fields.firstName/></h1>
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

  // `?waitForIndex=true` makes `/_atomic` return once the incremental index
  // job it enqueued has settled, so the rows a scenario asserts against are
  // all present — and all attributed to a finished pass — by the time the
  // response lands. Every `/_atomic` response is 201, add and update alike.
  async function push(
    assert: Assert,
    label: string,
    operations: Record<string, unknown>[],
  ): Promise<void> {
    let response = await request
      .post('/_atomic?waitForIndex=true')
      .set('Accept', SupportedMimeType.JSONAPI)
      .set(
        'Authorization',
        `Bearer ${createJWT(realm, 'user', ['read', 'write'])}`,
      )
      .send(JSON.stringify({ 'atomic:operations': operations }));
    assert.strictEqual(response.status, 201, label);
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

    // `zzz` and `aaa` end up linked to each other and `bbb` links to `zzz`,
    // so writing `zzz` fans out to all three and the dependency graph holds a
    // cycle through the target. A cycle has no topological order, so the
    // three fall through to the order they arrived in — where `zzz` sorts
    // last. Target-first ordering is the only thing that puts it ahead.
    await push(assert, 'the target is created', [
      person('add', 'zzz.json', 'Zeta'),
    ]);
    await push(assert, 'the dependents are created', [
      person('add', 'aaa.json', 'Alpha', './zzz'),
      person('add', 'bbb.json', 'Beta', './zzz'),
    ]);
    await push(assert, 'the link back from the target closes the cycle', [
      person('update', 'zzz.json', 'Zeta', './aaa'),
    ]);

    // The pass under test: one write naming `zzz.json`.
    await push(assert, 'the target is written', [
      person('update', 'zzz.json', 'Zeta the Second', './aaa'),
    ]);

    let order = await writeOrderOfLatestPass();
    assert.deepEqual(
      [...order].sort(),
      [`${realm.url}aaa.json`, `${realm.url}bbb.json`, `${realm.url}zzz.json`],
      `the pass visited the target and both dependents (order: ${order.join(', ')})`,
    );
    assert.strictEqual(
      order[0],
      `${realm.url}zzz.json`,
      `the target's row is written first (order: ${order.join(', ')})`,
    );
  });

  test('a batch writes every target before any dependent', async function (assert) {
    assert.timeout(300_000);

    // Two targets, each in a cycle with the dependent that links to it, and
    // each sorting after that dependent lexically.
    await push(assert, 'the targets are created', [
      person('add', 'yyy.json', 'Ypsilon'),
      person('add', 'zzz.json', 'Zeta'),
    ]);
    await push(assert, 'the dependents are created', [
      person('add', 'aaa.json', 'Alpha', './zzz'),
      person('add', 'bbb.json', 'Beta', './yyy'),
    ]);
    await push(assert, 'the links back from the targets close the cycles', [
      person('update', 'yyy.json', 'Ypsilon', './bbb'),
      person('update', 'zzz.json', 'Zeta', './aaa'),
    ]);

    // The pass under test: one write naming both targets.
    await push(assert, 'both targets are written', [
      person('update', 'yyy.json', 'Ypsilon the Second', './bbb'),
      person('update', 'zzz.json', 'Zeta the Second', './aaa'),
    ]);

    let order = await writeOrderOfLatestPass();
    assert.deepEqual(
      [...order].sort(),
      [
        `${realm.url}aaa.json`,
        `${realm.url}bbb.json`,
        `${realm.url}yyy.json`,
        `${realm.url}zzz.json`,
      ],
      `the pass visited both targets and both dependents (order: ${order.join(', ')})`,
    );
    assert.deepEqual(
      order.slice(0, 2).sort(),
      [`${realm.url}yyy.json`, `${realm.url}zzz.json`],
      `both targets are written before either dependent (order: ${order.join(', ')})`,
    );
  });
});
