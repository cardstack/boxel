import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  archiveRealm,
  rri,
  unarchiveRealm,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
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

// An archived realm with a policy. Its ACL lets nobody but its admin and a
// reader in, and its policy, which lives in an Org realm, admits a teacher to
// the classrooms they teach. A caller the ACL refuses is handed to that
// policy, and learns the realm is archived only where a grant would have
// admitted them to something. Everywhere else they get the answer the realm
// gives them while it is active.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
const STRANGER = '@stranger:localhost';

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

    @operation static listMine = {
      base: 'query',
      query: { filter: { type: () => Classroom } },
    };
  }
`;

// Every grant rests on the one predicate, so a caller who teaches no classroom
// is matched by each grant's type and admitted by none of them.
const POLICY = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      rules: [
        {
          targetType: CLASSROOM,
          grants: [
            { operation: 'read', where: TEACHES },
            { operation: 'rename', where: TEACHES },
            { operation: 'listMine', where: TEACHES },
          ],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
});

function classroom(title: string, teacherIds: string[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title, teacherIds },
      meta: { adoptsFrom: { module: '../classroom', name: 'Classroom' } },
    },
  });
}

const ROOM_204 = `${EDUCATION}classrooms/room-204`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;

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
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
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
            'policies/education.json': POLICY,
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

  // Each request a caller the ACL refuses can put to the realm's policy, by
  // the route it reaches.
  const REQUESTS: Record<string, (auth: string) => Test> = {
    'the card+json read': (auth) =>
      request
        .get(new URL(ROOM_204).pathname)
        .set('Accept', SupportedMimeType.CardJson)
        .set('Authorization', auth),
    'a named search': (auth) =>
      search(auth, { operation: 'listMine', on: CLASSROOM }),
    'an ad-hoc search': (auth) =>
      search(auth, { filter: { 'item.on': CLASSROOM } }),
    'a batch that reads': (auth) =>
      operations(auth, 'QUERY', { 'boxel:name': 'read' }),
    'a batch that writes': (auth) =>
      operations(auth, 'POST', {
        'boxel:name': 'rename',
        data: { title: 'Renamed' },
      }),
    'a capability check': (auth) =>
      request
        .post('/education/_capabilities')
        .set('Accept', SupportedMimeType.JSON)
        .set('Content-Type', SupportedMimeType.JSON)
        .set('Authorization', auth)
        .send(
          JSON.stringify({
            checks: [
              { target: ROOM_204, operation: 'read' },
              { target: ROOM_204, operation: 'rename' },
            ],
          }),
        ),
  };

  function search(auth: string, body: Record<string, unknown>) {
    return request
      .post('/education/_search')
      .set('X-HTTP-Method-Override', 'QUERY')
      .set('Accept', SupportedMimeType.CardJson)
      .set('Content-Type', 'application/json')
      .set('Authorization', auth)
      .send(JSON.stringify(body));
  }

  function operations(
    auth: string,
    method: 'POST' | 'QUERY',
    entry: Record<string, unknown>,
  ) {
    let req = request
      .post('/education/_operations')
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth);
    if (method === 'QUERY') {
      req = req.set('X-HTTP-Method-Override', 'QUERY');
    }
    return req.send(
      JSON.stringify({
        'boxel:operations': [{ op: 'invoke', href: ROOM_204, ...entry }],
      }),
    );
  }

  async function answers(auth: string) {
    let answered: Record<string, Response> = {};
    for (let [label, send] of Object.entries(REQUESTS)) {
      answered[label] = await send(auth);
    }
    return answered;
  }

  function assertSealed(assert: Assert, response: Response, label: string) {
    assert.strictEqual(response.status, 403, `${label}: 403`);
    assert.strictEqual(
      response.get('X-Boxel-Realm-Archived'),
      'true',
      `${label}: carries the archived marker`,
    );
    assert.strictEqual(
      JSON.parse(response.text).errors?.[0]?.code,
      'archived',
      `${label}: the error is the seal`,
    );
  }

  async function title() {
    let response = await request
      .get(new URL(ROOM_204).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', bearer(ADMIN, ['read', 'write', 'realm-owner']));
    return JSON.parse(response.text).data.attributes.title;
  }

  test('a caller no grant admits is answered as the realm answers them while it is active', async function (assert) {
    let auth = bearer(STRANGER);
    let active = await answers(auth);
    assert.strictEqual(
      active['the card+json read'].status,
      404,
      'while active, the read the grant does not admit is not there',
    );
    assert.deepEqual(
      JSON.parse(active['a named search'].text).data,
      [],
      'while active, the named search the grant scopes to them has no rows',
    );
    assert.deepEqual(
      JSON.parse(active['an ad-hoc search'].text).data,
      [],
      'while active, an ad-hoc search reaches no grant and has no rows',
    );

    await archiveRealm(db, new URL(EDUCATION));
    let archived = await answers(auth);
    for (let label of Object.keys(REQUESTS)) {
      assert.strictEqual(
        archived[label].status,
        active[label].status,
        `${label}: the status it has while the realm is active`,
      );
      assert.strictEqual(
        archived[label].text,
        active[label].text,
        `${label}: the body it has while the realm is active`,
      );
      assert.notOk(
        archived[label].get('X-Boxel-Realm-Archived'),
        `${label}: nothing says the realm is archived`,
      );
    }
  });

  test('a caller a grant admits meets the seal, and nothing they asked for runs', async function (assert) {
    let auth = bearer(TEACHER);
    let active = await request
      .get(new URL(ROOM_204).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
    assert.strictEqual(active.status, 200, 'while active, the grant admits');

    await archiveRealm(db, new URL(EDUCATION));
    let archived = await answers(auth);
    for (let label of [
      'the card+json read',
      'a named search',
      'a batch that reads',
      'a batch that writes',
      'a capability check',
    ]) {
      assertSealed(assert, archived[label], label);
    }
    assert.deepEqual(
      JSON.parse(archived['an ad-hoc search'].text).data,
      [],
      'an ad-hoc search reaches no grant, so it has no rows, archived or not',
    );

    await unarchiveRealm(db, new URL(EDUCATION));
    assert.strictEqual(await title(), 'Room 204', 'the rename never ran');
  });

  test('a caller the ACL lets read meets the seal, whatever the policy grants them', async function (assert) {
    await archiveRealm(db, new URL(EDUCATION));
    let archived = await answers(bearer(READER, ['read']));
    for (let label of Object.keys(REQUESTS)) {
      assertSealed(assert, archived[label], label);
    }

    await unarchiveRealm(db, new URL(EDUCATION));
    assert.strictEqual(await title(), 'Room 204', 'the rename never ran');
  });
});
