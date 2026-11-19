import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import type { LocalPath } from '@cardstack/runtime-common/paths';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createJWT,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// Every route that writes a card carries the write out as the operation its
// verb is named for, `create`, `update` or `delete`, as the card's type
// declares it: the card+json `POST`, `PATCH` and `DELETE`, the operations
// envelope, `/_atomic`, and the card+source write and removal. It does for a
// writer the realm ACL allows and for one a policy grant admits alike.
//
// A memo's type declares all three. Its `create` stamps the memo it mints,
// its `update` stamps the memo it changes, and its `delete` withdraws the memo
// rather than removing it. The Office realm's policy, in an Org realm nobody
// the Office realm serves can read, grants all three on memos to everyone. An
// admin writes the Office realm; a reader may read it but not write it, so the
// reader's every write is admitted by the policy.
const OFFICE = 'http://127.0.0.1:4444/office/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/office`;
const ADMIN = '@office-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const MEMO = { module: `${OFFICE}memo`, name: 'Memo' };
const URGENT_MEMO = { module: `${OFFICE}urgent-memo`, name: 'UrgentMemo' };
const NOTE = { module: `${OFFICE}note`, name: 'Note' };
const LEDGER = { module: `${OFFICE}ledger`, name: 'Ledger' };

const MEMO_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { bxl, operation, params } from "@cardstack/base/operations";
  export class Memo extends CardDef {
    @field body = contains(StringField);
    @field stamp = contains(StringField);
    @field status = contains(StringField);

    @operation static create = {
      base: 'create',
      of: () => Memo,
      params: { body: StringField },
      input: bxl\`{body: (.attributes.body // .body)}\`,
      fill: { body: params('body'), stamp: 'created' },
    };

    @operation static update = {
      base: 'update',
      input: bxl\`. + {attributes: ((.attributes // {}) + {stamp: "updated"})}\`,
    };

    @operation static delete = {
      base: 'transform',
      set: { status: 'withdrawn' },
    };
  }
`;

// Inherits the memo's `create` and `delete`, and declares its own `update`.
const URGENT_MEMO_MODULE = `
  import { bxl, operation } from "@cardstack/base/operations";
  import { Memo } from "./memo";
  export class UrgentMemo extends Memo {
    @operation static update = {
      base: 'update',
      input: bxl\`. + {attributes: ((.attributes // {}) + {stamp: "urgent"})}\`,
    };
  }
`;

// Declares its `update` only to label it, which changes nothing it does.
const NOTE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";
  export class Note extends CardDef {
    @field body = contains(StringField);

    @operation static update = { base: 'update', label: 'Save the note' };
  }
`;

// Declares its `update` on a behavior that writes nothing.
const LEDGER_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";
  export class Ledger extends CardDef {
    @field body = contains(StringField);

    @operation static update = { base: 'read' };
  }
`;

type Rule = {
  targetType: { module: string; name: string };
  grants: { operation: string }[];
};

const OFFICE_RULES: Rule[] = [MEMO, NOTE, LEDGER].map((targetType) => ({
  targetType,
  grants: [
    { operation: 'create' },
    { operation: 'update' },
    { operation: 'delete' },
  ],
}));

function document(
  type: { module: string; name: string },
  attributes: Record<string, unknown>,
) {
  return JSON.stringify(
    {
      data: {
        type: 'card',
        attributes,
        meta: { adoptsFrom: { module: rri(type.module), name: type.name } },
      },
    },
    null,
    2,
  );
}

module(basename(import.meta.filename), function (hooks) {
  let office: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;

  setupCatalogTestSubset(hooks);

  async function start({
    dbAdapter,
    publisher,
    runner,
  }: {
    dbAdapter: PgAdapter;
    publisher: QueuePublisher;
    runner: QueueRunner;
  }) {
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(OFFICE),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Office',
              policy: POLICY_CARD,
            }),
            'memo.gts': MEMO_MODULE,
            'urgent-memo.gts': URGENT_MEMO_MODULE,
            'note.gts': NOTE_MODULE,
            'ledger.gts': LEDGER_MODULE,
            'memos/admin.json': document(MEMO, {
              body: 'Kept by the admin',
              status: 'posted',
            }),
            'memos/reader.json': document(MEMO, {
              body: 'Kept by the reader',
              status: 'posted',
            }),
            'memos/urgent.json': document(URGENT_MEMO, {
              body: 'Fire drill',
              status: 'posted',
            }),
            'notes/admin.json': document(NOTE, { body: 'A note' }),
            'notes/reader.json': document(NOTE, { body: 'A note' }),
            'ledgers/l1.json': document(LEDGER, { body: 'Ledger' }),
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
            [READER]: ['read'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/office.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: { rules: OFFICE_RULES },
                meta: { adoptsFrom: REALM_POLICY },
              },
            }),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    server = result.testRealmHttpServer;
    request = supertest(server);
    office = result.realms.find((realm) => realm.url === OFFICE)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  async function stop() {
    for (let realm of [office, org]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
  }

  let templateDatabase = setupTestDatabaseTemplate(hooks, {
    key: import.meta.filename,
    build: async (args) => {
      await start(args);
      return stop;
    },
  });

  setupDB(hooks, {
    templateDatabase,
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: stop,
  });

  // Each writer writes its own cards, so one writer's write never decides
  // what the other's finds.
  const WRITERS = [
    {
      name: 'a writer the realm ACL allows',
      key: 'admin',
      auth: () =>
        `Bearer ${createJWT(office, ADMIN, ['read', 'write', 'realm-owner'])}`,
    },
    {
      name: 'a writer a policy grant admits',
      key: 'reader',
      auth: () => `Bearer ${createJWT(office, READER, ['read'])}`,
    },
  ];

  function path(localPath: string) {
    return `${new URL(OFFICE).pathname}${localPath}`;
  }

  // The realm-relative path of a card's stored document, from its URL or its
  // document's URL.
  function localPathOf(url: string): string {
    let local = url.replace(OFFICE, '');
    return local.endsWith('.json') ? local : `${local}.json`;
  }

  async function stored(localPath: string) {
    return await office.operationCore.readFileAsText(localPath as LocalPath);
  }

  async function storedAttributes(localPath: string) {
    let text = await stored(localPath);
    return text === undefined
      ? undefined
      : (JSON.parse(text) as { data: { attributes: Record<string, unknown> } })
          .data.attributes;
  }

  function status(response: Response) {
    return `${response.status} ${response.text.slice(0, 300)}`;
  }

  function memoResource(attributes: Record<string, unknown>) {
    return (JSON.parse(document(MEMO, attributes)) as { data: unknown }).data;
  }

  function postCard(auth: string, resource: unknown) {
    return request
      .post(path(''))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth)
      .send(JSON.stringify({ data: resource }));
  }

  function patchCard(localPath: string, auth: string, resource: unknown) {
    return request
      .patch(path(localPath))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth)
      .send(JSON.stringify({ data: resource }));
  }

  function deleteCard(localPath: string, auth: string) {
    return request
      .delete(path(localPath))
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(path('_operations'))
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(JSON.stringify({ 'boxel:operations': entries }));
  }

  function atomic(
    auth: string,
    ...entries: { op: 'add' | 'update'; href: string; data: unknown }[]
  ) {
    return request
      .post(path('_atomic'))
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Authorization', auth)
      .send(JSON.stringify({ 'atomic:operations': entries }));
  }

  function writeSource(localPath: string, auth: string, text: string) {
    return request
      .post(path(localPath))
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', auth)
      .send(text);
  }

  function removeSource(localPath: string, auth: string) {
    return request
      .delete(path(localPath))
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', auth);
  }

  function atomicResults(response: Response) {
    return (
      JSON.parse(response.text) as {
        'atomic:results': { data: { id: string } }[];
      }
    )['atomic:results'];
  }

  module('a type that declares its own create, update and delete', function () {
    test('card+json carries out each', async function (assert) {
      for (let writer of WRITERS) {
        let auth = writer.auth();
        let created = await postCard(
          auth,
          memoResource({ body: `Posted by the ${writer.key}` }),
        );
        assert.strictEqual(created.status, 201, `${writer.name}: POST`);
        let id = (created.body as { data: { id: string } }).data.id;
        assert.deepEqual(
          await storedAttributes(localPathOf(id)),
          { body: `Posted by the ${writer.key}`, stamp: 'created' },
          `${writer.name}: the type’s create minted the memo`,
        );

        let mine = `memos/${writer.key}`;
        let patched = await patchCard(
          mine,
          auth,
          memoResource({ body: 'Revised' }),
        );
        assert.strictEqual(patched.status, 200, `${writer.name}: PATCH`);
        assert.deepEqual(
          await storedAttributes(`${mine}.json`),
          { body: 'Revised', status: 'posted', stamp: 'updated' },
          `${writer.name}: the type’s update changed the memo`,
        );
        assert.strictEqual(
          (patched.body as { data: { attributes: { stamp: string } } }).data
            .attributes.stamp,
          'updated',
          `${writer.name}: and the answer is the memo as it left it`,
        );

        let deleted = await deleteCard(mine, auth);
        assert.strictEqual(deleted.status, 204, `${writer.name}: DELETE`);
        assert.strictEqual(
          (await storedAttributes(`${mine}.json`))?.status,
          'withdrawn',
          `${writer.name}: the type’s delete withdrew the memo, and kept it`,
        );
      }
    });

    test('the operations envelope carries out each', async function (assert) {
      for (let writer of WRITERS) {
        let auth = writer.auth();
        let mine = `${OFFICE}memos/${writer.key}`;
        let response = await operations(
          auth,
          {
            op: 'invoke',
            'boxel:name': 'create',
            data: memoResource({ body: `Posted by the ${writer.key}` }),
          },
          {
            op: 'invoke',
            'boxel:name': 'update',
            href: mine,
            data: memoResource({ body: 'Revised' }),
          },
        );
        assert.strictEqual(response.status, 200, status(response));
        let [created] = atomicResults(response);
        assert.deepEqual(
          await storedAttributes(localPathOf(created.data.id)),
          { body: `Posted by the ${writer.key}`, stamp: 'created' },
          `${writer.name}: the type’s create minted the memo`,
        );
        assert.deepEqual(
          await storedAttributes(localPathOf(mine)),
          { body: 'Revised', status: 'posted', stamp: 'updated' },
          `${writer.name}: the type’s update changed the memo`,
        );
        let deleted = await operations(auth, {
          op: 'invoke',
          'boxel:name': 'delete',
          href: mine,
        });
        assert.strictEqual(deleted.status, 200, status(deleted));
        assert.strictEqual(
          (await storedAttributes(localPathOf(mine)))?.status,
          'withdrawn',
          `${writer.name}: the type’s delete withdrew the memo`,
        );
      }
    });

    test('/_atomic carries out a create and an update', async function (assert) {
      for (let writer of WRITERS) {
        let auth = writer.auth();
        let mine = `memos/${writer.key}`;
        let response = await atomic(
          auth,
          {
            op: 'add',
            href: `${OFFICE}memos/new-${writer.key}.json`,
            data: memoResource({ body: `Synced by the ${writer.key}` }),
          },
          {
            op: 'update',
            href: `${OFFICE}${mine}.json`,
            data: memoResource({ body: 'Synced', status: 'posted' }),
          },
        );
        assert.strictEqual(response.status, 201, status(response));
        let [created, updated] = atomicResults(response);
        assert.deepEqual(
          await storedAttributes(localPathOf(created.data.id)),
          { body: `Synced by the ${writer.key}`, stamp: 'created' },
          `${writer.name}: the type’s create minted the memo, where it mints`,
        );
        assert.strictEqual(
          await stored(`memos/new-${writer.key}.json`),
          undefined,
          `${writer.name}: and the bytes sent were not written at the path`,
        );
        assert.strictEqual(
          localPathOf(updated.data.id),
          `${mine}.json`,
          `${writer.name}: the update reports the memo it changed`,
        );
        assert.deepEqual(
          await storedAttributes(`${mine}.json`),
          { body: 'Synced', status: 'posted', stamp: 'updated' },
          `${writer.name}: the type’s update changed the memo`,
        );
      }
    });

    test('/_atomic commits a write a type declares together with the bytes beside it', async function (assert) {
      let auth = WRITERS[0].auth();
      let response = await atomic(
        auth,
        {
          op: 'add',
          href: `${OFFICE}notes/plain.json`,
          data: (
            JSON.parse(document(NOTE, { body: 'Plain' })) as { data: unknown }
          ).data,
        },
        {
          op: 'update',
          href: `${OFFICE}memos/admin.json`,
          data: memoResource({ body: 'Synced', status: 'posted' }),
        },
      );
      assert.strictEqual(response.status, 201, status(response));
      assert.deepEqual(
        await storedAttributes('notes/plain.json'),
        { body: 'Plain' },
        'the card no type’s declaration carries out lands at its path',
      );
      assert.strictEqual(
        (await storedAttributes('memos/admin.json'))?.stamp,
        'updated',
        'beside the memo the type’s update changed',
      );

      let refused = await atomic(
        auth,
        {
          op: 'update',
          href: `${OFFICE}memos/admin.json`,
          data: memoResource({ body: 'Never', status: 'posted' }),
        },
        {
          op: 'add',
          href: `${OFFICE}notes/plain.json`,
          data: (
            JSON.parse(document(NOTE, { body: 'Again' })) as { data: unknown }
          ).data,
        },
      );
      assert.strictEqual(refused.status, 409, status(refused));
      assert.strictEqual(
        (await storedAttributes('memos/admin.json'))?.body,
        'Synced',
        'a request refused for any of its writes writes none of them',
      );
    });

    test('card+source carries out a create, an update and a removal', async function (assert) {
      for (let writer of WRITERS) {
        let auth = writer.auth();
        let mine = `memos/${writer.key}`;
        let created = await writeSource(
          `memos/new-${writer.key}.json`,
          auth,
          document(MEMO, { body: `Saved by the ${writer.key}` }),
        );
        assert.strictEqual(created.status, 204, status(created));
        let location = created.get('location');
        assert.ok(location, `${writer.name}: the answer says where it landed`);
        assert.deepEqual(
          await storedAttributes(localPathOf(location!)),
          { body: `Saved by the ${writer.key}`, stamp: 'created' },
          `${writer.name}: the type’s create minted the memo`,
        );

        let updated = await writeSource(
          `${mine}.json`,
          auth,
          document(MEMO, { body: 'Saved', status: 'posted' }),
        );
        assert.strictEqual(updated.status, 204, status(updated));
        assert.deepEqual(
          await storedAttributes(`${mine}.json`),
          { body: 'Saved', status: 'posted', stamp: 'updated' },
          `${writer.name}: the type’s update changed the memo`,
        );

        let removed = await removeSource(`${mine}.json`, auth);
        assert.strictEqual(removed.status, 204, status(removed));
        assert.strictEqual(
          (await storedAttributes(`${mine}.json`))?.status,
          'withdrawn',
          `${writer.name}: the type’s delete withdrew the memo, and kept it`,
        );
      }
    });
  });

  module('which declaration a write carries out', function () {
    test('a subclass’s own update, over the one it inherits', async function (assert) {
      for (let writer of WRITERS) {
        let patched = await patchCard('memos/urgent', writer.auth(), {
          ...(memoResource({ body: `Revised by the ${writer.key}` }) as object),
          meta: {
            adoptsFrom: { module: rri(URGENT_MEMO.module), name: 'UrgentMemo' },
          },
        });
        assert.strictEqual(patched.status, 200, status(patched));
        assert.strictEqual(
          (await storedAttributes('memos/urgent.json'))?.stamp,
          'urgent',
          `${writer.name}: the subclass’s update`,
        );
      }
    });

    test('a declaration that only describes the built-in writes the bytes it was sent', async function (assert) {
      for (let writer of WRITERS) {
        let mine = `notes/${writer.key}.json`;
        let text = JSON.stringify(
          JSON.parse(
            document(NOTE, { body: `Kept as sent by the ${writer.key}` }),
          ),
        );
        let written = await writeSource(mine, writer.auth(), text);
        assert.strictEqual(written.status, 204, status(written));
        assert.strictEqual(
          await stored(mine),
          text,
          `${writer.name}: the bytes, as sent`,
        );
      }
    });

    test('a write name declared on a behavior that writes nothing is refused', async function (assert) {
      for (let writer of WRITERS) {
        let patched = await patchCard(
          'ledgers/l1',
          writer.auth(),
          (
            JSON.parse(document(LEDGER, { body: 'Changed' })) as {
              data: unknown;
            }
          ).data,
        );
        assert.strictEqual(patched.status, 405, status(patched));
        assert.strictEqual(
          (await storedAttributes('ledgers/l1.json'))?.body,
          'Ledger',
          `${writer.name}: and nothing is written`,
        );
      }
    });
  });
});
