import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  IndexWriter,
  noteRealmIndexMoved,
  rri,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  VirtualNetwork,
} from '@cardstack/runtime-common';
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
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// What becomes of a policy when part of it, or all of it, does not compile.
//
// A grant that does not compile is inactive, and the rest of the policy
// applies. A policy that does not compile at all grants nothing, and refuses
// the way a realm refuses when its policy card is missing. And a policy is
// only ever what its card holds now: nothing falls back to an earlier
// compilation, or to what an earlier index visit recorded of the card, since
// that would keep serving a grant an administrator had just removed.
//
// The worked example's topology. The Education realm holds the classrooms,
// and its policy card lives in an Org realm. A teacher holds no permission on
// the Education realm, and a reader may read it but not write it, so each of
// their requests the realm ACL declines reaches the policy gate.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };

const TEACHES = '.teacherIds | any(. == actor())';

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation, params } from "@cardstack/base/operations";

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);

    @operation static rename = {
      base: 'transform',
      params: { title: StringField },
      set: { title: params('title') },
    };

    @operation static archive = {
      base: 'transform',
      set: { title: 'Archived' },
    };
  }
`;

type Grant = { operation: string; where?: unknown };

// A policy with one rule, on `Classroom`.
function policyCard(
  grants: Grant[],
  opts: {
    adoptsFrom?: { module: string; name: string };
    attributes?: Record<string, unknown>;
  } = {},
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: {
        rules: [{ targetType: CLASSROOM, grants }],
        ...opts.attributes,
      },
      meta: { adoptsFrom: opts.adoptsFrom ?? REALM_POLICY },
    },
  });
}

// What the policy grants while it compiles: a teacher reads the classrooms
// they teach, and renames any classroom.
const GRANTS: Grant[] = [
  { operation: 'read', where: TEACHES },
  { operation: 'rename' },
];

function card(
  adoptsFrom: { module: string; name: string },
  attributes: Record<string, unknown>,
) {
  return JSON.stringify({
    data: { type: 'card', attributes, meta: { adoptsFrom } },
  });
}

function classroom(title: string, teacherIds: string[]) {
  return card(
    { module: '../classroom', name: 'Classroom' },
    {
      title,
      teacherIds,
    },
  );
}

function envelope(...operations: unknown[]) {
  return JSON.stringify({ 'boxel:operations': operations });
}

function invoke(
  name: string,
  rest: { href?: string; data?: unknown } = {},
): Record<string, unknown> {
  return { op: 'invoke', 'boxel:name': name, ...rest };
}

const ROOM_204 = `${EDUCATION}classrooms/room-204`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;
  let virtualNetwork: VirtualNetwork;

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
    db = dbAdapter;
    virtualNetwork = createVirtualNetwork();
    let result = await runTestRealmServerWithRealms({
      virtualNetwork,
      realmsRootPath: join(dirSync().name, 'realm_server_1'),
      realms: [
        {
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: POLICY_CARD,
            }),
            'classroom.gts': CLASSROOM_MODULE,
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
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
            'policies/education.json': policyCard(GRANTS),
            'note.json': card(
              { module: rri('@cardstack/base/card-api'), name: 'CardDef' },
              { cardInfo: { name: 'An org note' } },
            ),
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
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      for (let realm of [education, org]) {
        realm.__testOnlyClearCaches();
        realm.unsubscribe();
      }
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  function bearer(
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(education, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(ADMIN, ['read', 'write', 'realm-owner']),
    reader: () => bearer(READER, ['read']),
    teacher: () => bearer(TEACHER),
  };

  function readRoom(auth: string) {
    return request
      .get(new URL(ROOM_204).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(`${new URL(EDUCATION).pathname}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  function rename(auth: string, title: string) {
    return operations(
      auth,
      invoke('rename', { href: ROOM_204, data: { title } }),
    );
  }

  async function titleOfRoom() {
    let response = await readRoom(AUTH.admin());
    return (response.body as { data: { attributes: { title: string } } }).data
      .attributes.title;
  }

  async function writeTo(realm: Realm, path: string, contents: string) {
    await realm.write(path, contents);
    await realm.indexing();
  }

  async function pointAt(card: string) {
    await writeTo(
      education,
      'realm.json',
      realmConfigCardJSON({ name: 'Education', policy: card }),
    );
  }

  // The policy card's row in the Org realm's index.
  async function policyRow() {
    let [row] = (await db.execute(
      `SELECT has_error, pristine_doc FROM boxel_index WHERE url = $1 AND type = 'instance'`,
      {
        bind: [`${POLICY_CARD}.json`],
        coerceTypes: { has_error: 'BOOLEAN', pristine_doc: 'JSON' },
      },
    )) as {
      has_error: boolean | null;
      pristine_doc: { attributes?: { rules?: { grants?: Grant[] }[] } } | null;
    }[];
    return row;
  }

  function grantsOnRow(row: Awaited<ReturnType<typeof policyRow>>) {
    return row?.pristine_doc?.attributes?.rules?.[0]?.grants?.map(
      (grant) => grant.operation,
    );
  }

  // What each caller the policy governs gets from it: the teacher's read of
  // their classroom, and the reader's rename of it.
  async function answers() {
    let read = await readRoom(AUTH.teacher());
    let renamed = await rename(AUTH.reader(), 'Room 204B');
    return {
      read: { status: read.status, body: read.text },
      rename: { status: renamed.status, body: renamed.text },
    };
  }

  function assertRefused(assert: Assert, response: Response, label: string) {
    assert.true(
      response.status === 403 || response.status === 404,
      `${label} is refused (${response.status})`,
    );
  }

  module('a policy that partly compiles', function () {
    test('a grant that does not compile is inactive, and the grants beside it apply', async function (assert) {
      await writeTo(
        org,
        'policies/education.json',
        policyCard([
          ...GRANTS,
          // A predicate that does not parse. Read as having no condition, it
          // would let any caller archive any classroom.
          { operation: 'archive', where: '.teacherIds | any(. == actor()' },
        ]),
      );
      let policy = await education.getCompiledPolicy();
      assert.deepEqual(
        policy?.issues.map(({ code, path }) => ({ code, path })),
        [{ code: 'invalid-predicate', path: 'rules[0].grants[2].where' }],
        'the grant that does not compile is recorded against itself',
      );
      assert.deepEqual(
        policy?.rules.flatMap((rule) =>
          rule.grants.map(({ operation, path }) => ({ operation, path })),
        ),
        [
          { operation: 'read', path: 'rules[0].grants[0]' },
          { operation: 'rename', path: 'rules[0].grants[1]' },
        ],
        'and only the two that compiled are in the policy',
      );
      assert.notOk(policy?.uncompilable, 'the policy as a whole compiled');

      assert.strictEqual(
        (await readRoom(AUTH.teacher())).status,
        200,
        'the read grant admits the teacher',
      );
      assert.strictEqual(
        (await rename(AUTH.teacher(), 'Room 204B')).status,
        200,
        'the rename grant admits the teacher',
      );
      assertRefused(
        assert,
        await operations(AUTH.teacher(), invoke('archive', { href: ROOM_204 })),
        'the archive the inactive grant names',
      );
      assert.strictEqual(
        await titleOfRoom(),
        'Room 204B',
        'the classroom carries the rename and was not archived',
      );
    });
  });

  module('a policy that does not compile', function () {
    test('grants nothing it would have granted, and refuses as a missing policy card does', async function (assert) {
      let granted = await answers();
      assert.strictEqual(granted.read.status, 200, 'the policy admits a read');
      assert.strictEqual(granted.rename.status, 200, 'and a rename');

      await pointAt(`${ORG}policies/nowhere`);
      let missing = await answers();
      assert.strictEqual(
        missing.read.status,
        500,
        'a missing policy card refuses the read',
      );
      assert.strictEqual(missing.rename.status, 500, 'and the rename');

      await writeTo(
        org,
        'policies/unloadable.json',
        policyCard(GRANTS, {
          adoptsFrom: { module: `${ORG}no-such-module`, name: 'Nothing' },
        }),
      );
      let uncompilable: Record<string, string> = {
        [`${ORG}policies/unloadable`]: 'a card that will not load',
        [`${ORG}note`]: 'a card that is not a RealmPolicy',
      };
      for (let [pointer, label] of Object.entries(uncompilable)) {
        await pointAt(pointer);
        let policy = await education.getCompiledPolicy();
        assert.true(policy?.uncompilable, `${label} does not compile`);
        assert.deepEqual(policy?.rules, [], `${label} holds no rules`);
        assert.deepEqual(
          await answers(),
          missing,
          `${label} refuses both requests exactly as a missing card does`,
        );
      }
      assert.strictEqual(
        await titleOfRoom(),
        'Room 204B',
        'no refused rename reached the classroom',
      );
    });
  });

  module('no earlier version of a policy is served', function () {
    test('an edit that removes one grant and breaks another leaves neither in force', async function (assert) {
      assert.strictEqual(
        (await readRoom(AUTH.teacher())).status,
        200,
        'the read grant admits the teacher',
      );
      assert.strictEqual(
        (await rename(AUTH.teacher(), 'Room 204B')).status,
        200,
        'and so does the rename grant',
      );

      // An administrator takes the rename grant out, and mistypes the read
      // grant's predicate while narrowing it.
      await writeTo(
        org,
        'policies/education.json',
        policyCard([{ operation: 'read', where: `${TEACHES} and .title ==` }]),
      );
      let policy = await education.getCompiledPolicy();
      assert.deepEqual(
        policy?.issues.map(({ code }) => code),
        ['invalid-predicate'],
        'the mistyped predicate is recorded',
      );
      assert.deepEqual(policy?.rules[0].grants, [], 'and no grant is in force');

      assertRefused(
        assert,
        await readRoom(AUTH.teacher()),
        'the read, whose grant no longer compiles,',
      );
      assertRefused(
        assert,
        await rename(AUTH.teacher(), 'Room 204C'),
        'the rename, whose grant was removed,',
      );
      assert.strictEqual(await titleOfRoom(), 'Room 204B');
    });

    test('a card that stops loading grants nothing, though the index still holds its last good document', async function (assert) {
      assert.strictEqual((await readRoom(AUTH.teacher())).status, 200);

      await writeTo(
        org,
        'policies/education.json',
        policyCard(GRANTS, {
          adoptsFrom: { module: `${ORG}no-such-module`, name: 'Nothing' },
        }),
      );
      let row = await policyRow();
      assert.true(row?.has_error, 'the card no longer indexes');
      assert.deepEqual(
        grantsOnRow(row),
        ['read', 'rename'],
        'and its row still carries the document the last good visit recorded',
      );

      let policy = await education.getCompiledPolicy();
      assert.true(policy?.uncompilable, 'the policy does not compile');
      assert.deepEqual(
        policy?.issues.map(({ code }) => code),
        ['policy-card-unloadable'],
      );
      assert.strictEqual(
        (await readRoom(AUTH.teacher())).status,
        500,
        'the read is refused rather than granted by the earlier document',
      );
    });

    test('a card whose latest index visit failed for a reason outside it grants nothing until a visit succeeds', async function (assert) {
      assert.strictEqual((await readRoom(AUTH.teacher())).status, 200);

      // An administrator edits the card, and the visit that indexes the edit
      // fails on a gateway error. The index keeps such a failure off the row,
      // so the row reads as healthy and still holds the earlier document.
      let batch = await new IndexWriter(db).createBatch(
        new URL(ORG),
        virtualNetwork,
      );
      await batch.updateEntry(new URL(`${POLICY_CARD}.json`), {
        type: 'instance-error',
        error: { message: 'Bad Gateway', status: 502, additionalErrors: null },
        diagnostics: { gatewayFailure: ['instance'] },
      });
      await batch.done();
      noteRealmIndexMoved(ORG);

      let row = await policyRow();
      assert.false(row?.has_error, 'the row reads as healthy');
      assert.deepEqual(
        grantsOnRow(row),
        ['read', 'rename'],
        'and holds the document an earlier visit recorded',
      );

      let policy = await education.getCompiledPolicy();
      assert.true(policy?.uncompilable, 'the policy does not compile');
      assert.deepEqual(
        policy?.issues.map(({ code }) => code),
        ['policy-card-unloadable'],
      );
      assert.strictEqual(
        (await readRoom(AUTH.teacher())).status,
        500,
        'the read is refused rather than granted by the earlier document',
      );

      await writeTo(
        org,
        'policies/education.json',
        policyCard(GRANTS, {
          attributes: { cardInfo: { name: 'Education policy' } },
        }),
      );
      assert.notOk(
        (await education.getCompiledPolicy())?.uncompilable,
        'a visit that succeeds compiles the policy again',
      );
      assert.strictEqual(
        (await readRoom(AUTH.teacher())).status,
        200,
        'and its grants apply',
      );
    });
  });
});
