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
// the classrooms they teach, and anyone it judges to the realm's bulletins. A
// caller the ACL refuses is handed to that policy, and learns the realm is
// archived only where a grant would have admitted them to something.
// Everywhere else they get the answer the realm gives them while it is active.
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
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };
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

const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
`;

// Every classroom grant rests on the one predicate, so a caller who teaches no
// classroom is matched by each grant's type and admitted by none of them. A
// create's predicate reads the classroom it would mint. A bulletin's writes
// are granted outright, to every caller the policy judges, and only the
// requests that say so touch a bulletin.
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
            { operation: 'create', where: TEACHES },
            { operation: 'update', where: TEACHES },
            { operation: 'delete', where: TEACHES },
          ],
        },
        {
          targetType: BULLETIN,
          grants: [
            { operation: 'create' },
            { operation: 'update' },
            { operation: 'delete' },
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

// A card+json write's document, naming its type by URL, as a caller the ACL
// declined names the type a create mints.
function cardDocument(
  type: { module: string; name: string },
  attributes: Record<string, unknown>,
  rest: { included?: unknown[] } = {},
) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes,
      meta: { adoptsFrom: { module: rri(type.module), name: type.name } },
    },
    ...rest,
  });
}

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const BULLETIN_1 = `${EDUCATION}bulletins/b1`;

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
            'bulletin.gts': BULLETIN_MODULE,
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
            'bulletins/b1.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: { body: 'Picture day is Friday' },
                meta: {
                  adoptsFrom: { module: '../bulletin', name: 'Bulletin' },
                },
              },
            }),
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
      operations(auth, 'QUERY', { 'boxel:name': 'read', href: ROOM_204 }),
    'a batch that writes': (auth) =>
      operations(auth, 'POST', {
        'boxel:name': 'rename',
        href: ROOM_204,
        data: { title: 'Renamed' },
      }),
    // A classroom the teacher teaches, which a stranger's grant does not admit.
    'a batch that creates': (auth) =>
      operations(auth, 'POST', {
        'boxel:name': 'create',
        data: {
          type: 'card',
          attributes: { title: 'Room 301', teacherIds: [TEACHER] },
          meta: {
            adoptsFrom: { module: rri(CLASSROOM.module), name: 'Classroom' },
          },
        },
      }),
    'an empty batch': (auth) => operations(auth, 'POST'),
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
              { target: CLASSROOM, operation: 'create' },
            ],
          }),
        ),
    // A classroom the teacher would teach, so a create's predicate admits the
    // teacher against the card it would mint, and no one else.
    'a card+json create': (auth) =>
      createCard(
        auth,
        cardDocument(CLASSROOM, { title: 'Room 301', teacherIds: [TEACHER] }),
      ),
    'a card+json update': (auth) =>
      patchCard(ROOM_204, auth, cardDocument(CLASSROOM, { title: 'Patched' })),
    'a card+json delete': (auth) => deleteCard(ROOM_204, auth),
  };

  function createCard(auth: string, body: string) {
    return request
      .post(new URL(EDUCATION).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth)
      .send(body);
  }

  function patchCard(url: string, auth: string, body: string) {
    return request
      .patch(new URL(url).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth)
      .send(body);
  }

  function deleteCard(url: string, auth: string) {
    return request
      .delete(new URL(url).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
  }

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
    entry?: Record<string, unknown>,
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
        'boxel:operations': entry ? [{ op: 'invoke', ...entry }] : [],
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

  function assertNotSealed(
    assert: Assert,
    archived: Response,
    active: Response,
    label: string,
  ) {
    assert.strictEqual(
      archived.status,
      active.status,
      `${label}: the status it has while the realm is active`,
    );
    assert.strictEqual(
      archived.text,
      active.text,
      `${label}: the body it has while the realm is active`,
    );
    assert.notOk(
      archived.get('X-Boxel-Realm-Archived'),
      `${label}: nothing says the realm is archived`,
    );
  }

  // How many cards of a type a create has minted in the Education realm. A
  // create stores its card beneath a directory named for its type, which no
  // fixture uses.
  async function minted(type: { name: string }) {
    let listing = await request
      .get(`${new URL(EDUCATION).pathname}${type.name}/`)
      .set('Accept', SupportedMimeType.DirectoryListing)
      .set('Authorization', bearer(ADMIN, ['read', 'write', 'realm-owner']));
    if (listing.status === 404) {
      return 0;
    }
    return Object.keys(
      (listing.body as { data: { relationships: Record<string, unknown> } })
        .data.relationships,
    ).length;
  }

  async function bulletinBody() {
    let response = await request
      .get(new URL(BULLETIN_1).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', bearer(ADMIN, ['read', 'write', 'realm-owner']));
    return JSON.parse(response.text).data.attributes.body;
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
    assert.strictEqual(
      active['a batch that creates'].status,
      404,
      'while active, a create the grant does not admit is refused',
    );
    assert.strictEqual(
      active['an empty batch'].status,
      200,
      'while active, an empty batch is a no-op',
    );
    assert.deepEqual(
      JSON.parse(active['a capability check'].text).checks.map(
        (answer: { allowed: boolean }) => answer.allowed,
      ),
      [false, false, true],
      'while active, a create against the type answers true, since its predicate is still to run',
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
    let refusedCreate = await createCard(
      auth,
      cardDocument(CLASSROOM, { title: 'Room 302', teacherIds: [STRANGER] }),
    );
    assert.strictEqual(
      refusedCreate.status,
      404,
      'while active, a create of a classroom the teacher would not teach is refused',
    );

    await archiveRealm(db, new URL(EDUCATION));
    let archived = await answers(auth);
    for (let label of [
      'the card+json read',
      'a named search',
      'a batch that reads',
      'a batch that writes',
      'a capability check',
      'a card+json update',
      'a card+json delete',
    ]) {
      assertSealed(assert, archived[label], label);
    }
    assert.deepEqual(
      JSON.parse(archived['an ad-hoc search'].text).data,
      [],
      'an ad-hoc search reaches no grant, so it has no rows, archived or not',
    );
    // A create whose predicate reads the card it would mint has nothing
    // stored to judge before the write lock stages that card, and nothing is
    // staged in an archived realm, so it is refused as a create no grant
    // admits is.
    assertNotSealed(
      assert,
      archived['a card+json create'],
      refusedCreate,
      'a card+json create',
    );
    assert.strictEqual(
      archived['an empty batch'].status,
      200,
      'an empty batch runs nothing, so it is the no-op it is while active',
    );
    // What a create's predicate judges is the card it would mint, which does
    // not exist until the batch stages it, and an archived realm stages
    // nothing. So the create is refused as one no grant admits.
    assert.strictEqual(
      archived['a batch that creates'].status,
      404,
      'a create whose predicate reads the card it would mint is refused, not sealed',
    );
    assert.notOk(
      archived['a batch that creates'].get('X-Boxel-Realm-Archived'),
      'and the refusal is not the seal',
    );

    await unarchiveRealm(db, new URL(EDUCATION));
    assert.strictEqual(
      await title(),
      'Room 204',
      'the rename, the update and the delete never ran',
    );
    assert.strictEqual(await minted(CLASSROOM), 0, 'nor did the create');
  });

  test('a card+json write the gate grants outright meets the seal, and nothing is written', async function (assert) {
    let auth = bearer(STRANGER);
    await archiveRealm(db, new URL(EDUCATION));
    assertSealed(
      assert,
      await createCard(auth, cardDocument(BULLETIN, { body: 'Bake sale' })),
      'a create',
    );
    assertSealed(
      assert,
      await patchCard(
        BULLETIN_1,
        auth,
        cardDocument(BULLETIN, { body: 'Picture day is Monday' }),
      ),
      'an update',
    );
    assertSealed(assert, await deleteCard(BULLETIN_1, auth), 'a delete');

    await unarchiveRealm(db, new URL(EDUCATION));
    assert.strictEqual(
      await bulletinBody(),
      'Picture day is Friday',
      'the update and the delete never ran',
    );
    assert.strictEqual(await minted(BULLETIN), 0, 'nor did the create');
  });

  test('a card+json write refused before it would run is refused as it is while the realm is active', async function (assert) {
    // Each is a write the teacher's grants would admit, refused before the
    // gate's decision is acted on: a body that is not a card document, a
    // side-load no grant on the classroom reaches, and a create naming the
    // type it mints by a module relative to a card not stored yet.
    let auth = bearer(TEACHER);
    const REFUSED: Record<string, () => Test> = {
      'a body that is not a card document': () =>
        patchCard(
          ROOM_204,
          auth,
          JSON.stringify({ data: { type: 'not-a-card' } }),
        ),
      'a side-load': () =>
        patchCard(
          ROOM_204,
          auth,
          cardDocument(
            CLASSROOM,
            { title: 'Patched' },
            {
              included: [
                {
                  type: 'card',
                  lid: 'room-301',
                  attributes: { title: 'Room 301', teacherIds: [TEACHER] },
                  meta: {
                    adoptsFrom: {
                      module: rri(CLASSROOM.module),
                      name: 'Classroom',
                    },
                  },
                },
              ],
            },
          ),
        ),
      'a relative type': () =>
        createCard(
          auth,
          JSON.stringify({
            data: {
              type: 'card',
              attributes: { title: 'Room 301', teacherIds: [TEACHER] },
              meta: {
                adoptsFrom: { module: './classroom', name: 'Classroom' },
              },
            },
          }),
        ),
    };
    let active: Record<string, Response> = {};
    for (let [label, send] of Object.entries(REFUSED)) {
      active[label] = await send();
    }
    assert.deepEqual(
      Object.values(active).map((response) => response.status),
      [400, 404, 400],
      'while active, each is refused',
    );

    await archiveRealm(db, new URL(EDUCATION));
    for (let [label, send] of Object.entries(REFUSED)) {
      assertNotSealed(assert, await send(), active[label], label);
    }

    await unarchiveRealm(db, new URL(EDUCATION));
    assert.strictEqual(await title(), 'Room 204', 'the classroom is untouched');
    assert.strictEqual(await minted(CLASSROOM), 0, 'and nothing was created');
  });

  test('a caller the ACL lets read meets the seal, whatever the policy grants them', async function (assert) {
    await archiveRealm(db, new URL(EDUCATION));
    let archived = await answers(bearer(READER, ['read']));
    for (let label of Object.keys(REQUESTS)) {
      assertSealed(assert, archived[label], label);
    }

    await unarchiveRealm(db, new URL(EDUCATION));
    assert.strictEqual(
      await title(),
      'Room 204',
      'the rename, the update and the delete never ran',
    );
    assert.strictEqual(await minted(CLASSROOM), 0, 'nor did the create');
  });
});
