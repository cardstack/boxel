import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import {
  fetchLiveRealmEventWatchers,
  rri,
  upsertRealmEventWatcher,
  watcherListedCopy,
} from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
  RealmAdapter,
  SessionRoomEvent,
} from '@cardstack/runtime-common';
import type { RealmEventContent } from '@cardstack/base/matrix-event';
import type { PgAdapter } from '@cardstack/postgres';
import { resetCatalogRealms } from '../handlers/handle-fetch-catalog-realms.ts';
import type { RealmHttpServer as Server } from '../server.ts';
import {
  closeServer,
  createVirtualNetwork,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
  waitUntil,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// A user who reaches a private realm only through its policy watches it, and
// the realm sends them its index completions filtered to the cards the policy
// lets them read.
//
// The Education realm's policy, kept in an Org realm, lets a teacher read the
// classrooms that list them. The teacher holds no permission on the Education
// realm; a reader holds a read grant, so the normal paths already reach them.
// The Staff realm's policy names the teacher alone, so it could never admit
// anyone else.

const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const STAFF = 'http://127.0.0.1:4444/staff/';
const POLICY_CARD = `${ORG}policies/education`;
const STAFF_POLICY_CARD = `${ORG}policies/staff`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const TEACHES = '.teacherIds | any(. == actor())';

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
  }
`;

const POLICY = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      rules: [
        {
          targetType: CLASSROOM,
          grants: [{ operation: 'read', where: TEACHES }],
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

const STAFF_POLICY = JSON.stringify({
  data: {
    type: 'card',
    attributes: {
      rules: [
        {
          targetType: { module: `${STAFF}classroom`, name: 'Classroom' },
          grants: [{ operation: 'read', where: `actor() == "${TEACHER}"` }],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
});

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const ROOM_205 = `${EDUCATION}classrooms/room-205`;

// Every member a watcher's copy of an index completion may carry.
const ALLOWED_MEMBERS = [
  'eventName',
  'indexType',
  'invalidations',
  'clientRequestId',
  'clientAuthored',
  'coalescedWrites',
  'realmWide',
  'realmURL',
];

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let staff: Realm;
  let request: SuperTest<Test>;
  let server: Server;
  let db: PgAdapter;
  // Each index completion the Education and Staff realms broadcast, with
  // what their watchers would have been sent for it. The adapters' sends are
  // replaced by a recorder, so what is asserted is the realm's decision.
  let deliveries: {
    realmURL: string;
    original: RealmEventContent | undefined;
    sent: SessionRoomEvent[];
  }[];

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
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: POLICY_CARD,
            }),
            'classroom.gts': CLASSROOM_MODULE,
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
            'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
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
            'policies/staff.json': STAFF_POLICY,
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(STAFF),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Staff',
              policy: STAFF_POLICY_CARD,
            }),
            'classroom.gts': CLASSROOM_MODULE,
          },
          permissions: {
            [ADMIN]: ['read', 'write', 'realm-owner'],
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
    db = dbAdapter;
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
    staff = result.realms.find((realm) => realm.url === STAFF)!;

    deliveries = [];
    record(result.realmAdapters[0], EDUCATION);
    record(result.realmAdapters[2], STAFF);
  }

  function record(adapter: RealmAdapter, realmURL: string) {
    // The realm queues its watchers' copy straight after the original, so the
    // most recent original is the one a copy belongs to.
    let lastOriginal: RealmEventContent | undefined;
    let broadcast = adapter.broadcastRealmEvent.bind(adapter);
    adapter.broadcastRealmEvent = (event, ...rest) => {
      lastOriginal = event;
      return broadcast(event, ...rest);
    };
    adapter.broadcastToSessionRooms = async (
      _realmURL,
      _matrixClient,
      _dbAdapter,
      events,
    ) => {
      let original = lastOriginal;
      deliveries.push({ realmURL, original, sent: await events() });
    };
  }

  async function stop() {
    for (let realm of [education, org, staff]) {
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

  function realmEventRooms(user: string, realms: string[]) {
    return request
      .post('/_realm-event-rooms')
      .set('Accept', 'application/json')
      .set('Content-Type', 'application/json')
      .set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user, sessionRoom: `session-room-${user}` },
          realmSecretSeed,
        )}`,
      )
      .send(JSON.stringify({ realms }));
  }

  async function watch(user: string, realmURL = EDUCATION) {
    await upsertRealmEventWatcher(db, realmURL, user, {
      maxRealmsPerUser: 20,
    });
  }

  // What the watchers were sent for the first completion `matches`.
  async function sentWhere(
    matches: (original: RealmEventContent | undefined) => boolean,
    description: string,
  ): Promise<SessionRoomEvent[]> {
    let delivery = await waitUntil(
      async () => deliveries.find(({ original }) => matches(original)),
      {
        timeout: 15_000,
        timeoutMessage: `no index completion ${description}`,
      },
    );
    return delivery!.sent;
  }

  // What the watchers were sent for the completion that invalidated `url`.
  async function sentFor(url: string): Promise<SessionRoomEvent[]> {
    return await sentWhere(
      (original) =>
        original?.eventName === 'index' &&
        original.indexType === 'incremental' &&
        'invalidations' in original &&
        original.invalidations.includes(url),
      `invalidated ${url}`,
    );
  }

  // What the watchers were sent for the completion naming `clientRequestId`.
  async function sentForRequest(
    clientRequestId: string,
  ): Promise<SessionRoomEvent[]> {
    return await sentWhere(
      (original) =>
        original?.eventName === 'index' &&
        original.indexType === 'incremental' &&
        original.clientRequestId === clientRequestId,
      `named request ${clientRequestId}`,
    );
  }

  module('registration', function () {
    test('a user the policy alone reaches is registered as a watcher', async function (assert) {
      let response = await realmEventRooms(TEACHER, [EDUCATION]);
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body, { rooms: {}, watched: [EDUCATION] });
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, EDUCATION), [
        TEACHER,
      ]);
    });

    test('a realm that names no policy is not watched', async function (assert) {
      let response = await realmEventRooms(TEACHER, [ORG]);
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.deepEqual(response.body, { rooms: {} });
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, ORG), []);
    });

    test('a grantee is answered as before and not registered', async function (assert) {
      let response = await realmEventRooms(READER, [EDUCATION]);
      assert.strictEqual(response.status, 200, 'HTTP 200 status');
      assert.ok(response.body.rooms[EDUCATION], 'the grantee gets the room');
      assert.strictEqual(response.body.watched, undefined);
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, EDUCATION), []);
    });

    test('a user the policy could never admit is not registered', async function (assert) {
      assert.true(await staff.policyMayAdmit(TEACHER), 'the teacher could be');
      assert.false(
        await staff.policyMayAdmit(COLLEAGUE),
        'nobody else could be',
      );
      let refused = await realmEventRooms(COLLEAGUE, [STAFF]);
      assert.strictEqual(refused.status, 200, 'HTTP 200 status');
      assert.deepEqual(refused.body, { rooms: {} });
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, STAFF), []);

      let admitted = await realmEventRooms(TEACHER, [STAFF]);
      assert.deepEqual(admitted.body, { rooms: {}, watched: [STAFF] });
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, STAFF), [TEACHER]);
    });

    test('a watch that fails to register fails the request, so the host asks again', async function (assert) {
      education.policyMayAdmit = async () => {
        throw new Error('the policy could not be read');
      };
      let response = await realmEventRooms(TEACHER, [EDUCATION]);
      assert.strictEqual(response.status, 503, 'HTTP 503 status');
      assert.deepEqual(response.body, { rooms: {} });
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, EDUCATION), []);
    });

    test('a realm may have only so many watchers, but a watcher may always renew', async function (assert) {
      let limits = { maxRealmsPerUser: 20, maxWatchersPerRealm: 1 };
      assert.true(
        await upsertRealmEventWatcher(db, EDUCATION, TEACHER, limits),
      );
      assert.false(
        await upsertRealmEventWatcher(db, EDUCATION, COLLEAGUE, limits),
        'a second watcher is refused',
      );
      assert.true(
        await upsertRealmEventWatcher(db, EDUCATION, TEACHER, limits),
        'the first is renewed',
      );
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, EDUCATION), [
        TEACHER,
      ]);
    });

    test('a lapsed watch is not live', async function (assert) {
      await upsertRealmEventWatcher(db, EDUCATION, TEACHER, {
        maxRealmsPerUser: 20,
        ttlMs: 1_000,
        now: Date.now() - 5_000,
      });
      assert.deepEqual(await fetchLiveRealmEventWatchers(db, EDUCATION), []);
    });

    test('a user may watch only so many realms, but may always renew one', async function (assert) {
      assert.true(
        await upsertRealmEventWatcher(db, `${EDUCATION}a/`, TEACHER, {
          maxRealmsPerUser: 1,
        }),
      );
      assert.false(
        await upsertRealmEventWatcher(db, `${EDUCATION}b/`, TEACHER, {
          maxRealmsPerUser: 1,
        }),
        'a second realm is refused',
      );
      assert.true(
        await upsertRealmEventWatcher(db, `${EDUCATION}a/`, TEACHER, {
          maxRealmsPerUser: 1,
        }),
        'the first is renewed',
      );
    });
  });

  module('delivery', function () {
    test('a watcher is sent only the cards its read grants admit', async function (assert) {
      await watch(TEACHER);
      await education.writeMany(
        new Map([
          ['classrooms/room-204.json', classroom('Room 204 A', [TEACHER])],
          ['classrooms/room-205.json', classroom('Room 205 A', [COLLEAGUE])],
        ]),
      );
      let sent = await sentFor(ROOM_205);
      assert.deepEqual(
        sent.map(({ user }) => user),
        [TEACHER],
      );
      let event = sent[0].event as { invalidations: string[] };
      assert.true(event.invalidations.includes(ROOM_204));
      assert.false(
        event.invalidations.includes(ROOM_205),
        "a classroom that doesn't list the teacher is not named",
      );
    });

    test('nothing is sent to a watcher when no card is admitted', async function (assert) {
      await watch(TEACHER);
      await education.write(
        'classrooms/room-205.json',
        classroom('Room 205 B', [COLLEAGUE]),
      );
      assert.deepEqual(await sentFor(ROOM_205), []);
    });

    test("a watcher's copy carries only allowlisted members", async function (assert) {
      await watch(TEACHER);
      await education.writeMany(
        new Map([
          ['classrooms/room-204.json', classroom('Room 204 C', [TEACHER])],
          ['classrooms/room-205.json', classroom('Room 205 C', [COLLEAGUE])],
        ]),
        {
          clientRequestId: 'admin-request-c',
          clientAuthored: [ROOM_204, ROOM_205],
          initiatingUser: ADMIN,
        },
      );
      let delivery = await waitUntil(
        async () =>
          deliveries.find(
            ({ original }) =>
              original?.eventName === 'index' &&
              'invalidations' in original &&
              original.invalidations.includes(ROOM_205),
          ),
        { timeout: 15_000 },
      );
      let original = delivery!.original as unknown as Record<string, unknown>;
      assert.ok(
        ['generation', 'invalidatedTypes', 'versions'].some(
          (key) => original[key] !== undefined,
        ),
        'the original carries members a watcher must not get',
      );
      let [{ event }] = delivery!.sent;
      for (let key of Object.keys(event)) {
        assert.true(ALLOWED_MEMBERS.includes(key), `${key} is allowlisted`);
      }
      assert.deepEqual(
        event,
        {
          eventName: 'index',
          indexType: 'incremental',
          invalidations: [ROOM_204],
          realmURL: EDUCATION,
        },
        "the copy names the card the teacher may read, and none of the admin's request",
      );
    });

    test("another writer's request id and authorship never reach a watcher", async function (assert) {
      await watch(TEACHER);
      let clientRequestId = 'bot-patch:!private-room:localhost:1';
      await education.write(
        'classrooms/room-204.json',
        classroom('Room 204 F', [TEACHER]),
        { clientRequestId, clientAuthored: [ROOM_204], initiatingUser: ADMIN },
      );
      let sent = await sentForRequest(clientRequestId);
      assert.deepEqual(sent, [
        {
          user: TEACHER,
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [ROOM_204],
            realmURL: EDUCATION,
          },
        },
      ]);
      assert.false(
        JSON.stringify(sent).includes('private-room'),
        "nothing of the admin's request id is sent",
      );
    });

    test("a watcher's own write carries their own request id", async function (assert) {
      await watch(TEACHER);
      await education.write(
        'classrooms/room-204.json',
        classroom('Room 204 G', [TEACHER]),
        {
          clientRequestId: 'teacher-request-g',
          clientAuthored: [ROOM_204],
          initiatingUser: TEACHER,
        },
      );
      assert.deepEqual(await sentForRequest('teacher-request-g'), [
        {
          user: TEACHER,
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [ROOM_204],
            clientRequestId: 'teacher-request-g',
            clientAuthored: [ROOM_204],
            realmURL: EDUCATION,
          },
        },
      ]);
    });

    test('a watcher hears their own write that changed nothing', async function (assert) {
      let content = classroom('Room 204 H', [TEACHER]);
      await education.write('classrooms/room-204.json', content, {
        initiatingUser: ADMIN,
      });
      await watch(TEACHER);
      await education.write('classrooms/room-204.json', content, {
        clientRequestId: 'teacher-request-h',
        initiatingUser: TEACHER,
      });
      assert.deepEqual(await sentForRequest('teacher-request-h'), [
        {
          user: TEACHER,
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [],
            clientRequestId: 'teacher-request-h',
            realmURL: EDUCATION,
          },
        },
      ]);
    });

    test('a pass larger than one gate chunk is gated in chunks, not sent realm-wide', async function (assert) {
      await watch(TEACHER);
      let missing = Array.from(
        { length: 299 },
        (_, i) => `${EDUCATION}classrooms/missing-${i}`,
      );
      await education.broadcastEvent({
        eventName: 'index',
        indexType: 'incremental',
        invalidations: [...missing, ROOM_204],
        realmURL: EDUCATION,
      });
      assert.deepEqual(await sentFor(`${EDUCATION}classrooms/missing-0`), [
        {
          user: TEACHER,
          event: {
            eventName: 'index',
            indexType: 'incremental',
            invalidations: [ROOM_204],
            realmURL: EDUCATION,
          },
        },
      ]);
    });

    test('a full index reaches only a watcher the policy could admit', async function (assert) {
      await watch(TEACHER, STAFF);
      await watch(COLLEAGUE, STAFF);
      await staff.broadcastEvent({
        eventName: 'index',
        indexType: 'full',
        realmURL: STAFF,
      });
      assert.deepEqual(
        await sentWhere(
          (original) =>
            original?.eventName === 'index' && original.indexType === 'full',
          'was a full index',
        ),
        [
          {
            user: TEACHER,
            event: { eventName: 'index', indexType: 'full', realmURL: STAFF },
          },
        ],
      );
    });

    test('a watcher the ACL lets read the realm is skipped', async function (assert) {
      await watch(READER);
      await education.write(
        'classrooms/room-204.json',
        classroom('Room 204 D', [TEACHER, READER]),
      );
      assert.deepEqual(await sentFor(ROOM_204), []);
    });

    test('a lapsed watcher is sent nothing', async function (assert) {
      await upsertRealmEventWatcher(db, EDUCATION, TEACHER, {
        maxRealmsPerUser: 20,
        ttlMs: 1_000,
        now: Date.now() - 5_000,
      });
      await education.write(
        'classrooms/room-204.json',
        classroom('Room 204 E', [TEACHER]),
      );
      assert.deepEqual(await sentFor(ROOM_204), []);
    });
  });
});

module(`${basename(import.meta.filename)}: watcher copies`, function () {
  const TEACHER_ID = '@teacher:localhost';
  const ADMIN_ID = '@admin:localhost';
  const REALM = 'http://127.0.0.1:4444/education/';
  const A = `${REALM}a`;
  const B = `${REALM}b`;
  const C = `${REALM}c`;

  test('a watcher whose write shared a pass hears only their own entry', function (assert) {
    let copy = watcherListedCopy(
      {
        kind: 'listed',
        invalidations: [A, B, C],
        write: {
          actor: ADMIN_ID,
          clientRequestId: 'bot-patch:!private-room:localhost:2',
          clientAuthored: [A],
        },
        coalescedWrites: [
          {
            actor: ADMIN_ID,
            clientRequestId: 'bot-patch:!private-room:localhost:2',
            changed: [A],
            clientAuthored: [A],
          },
          {
            actor: TEACHER_ID,
            clientRequestId: 'teacher-request',
            changed: [B, C],
            clientAuthored: [B, C],
          },
        ],
      },
      TEACHER_ID,
      [A, B],
      REALM,
    );
    assert.deepEqual(copy, {
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [A, B],
      coalescedWrites: [
        {
          clientRequestId: 'teacher-request',
          changed: [B],
          clientAuthored: [B],
        },
      ],
      realmURL: REALM,
    });
  });

  test("a card another writer also changed is not the watcher's own content", function (assert) {
    let copy = watcherListedCopy(
      {
        kind: 'listed',
        invalidations: [A, B],
        coalescedWrites: [
          { actor: ADMIN_ID, clientRequestId: 'admin', changed: [A] },
          { actor: TEACHER_ID, clientRequestId: 'teacher', changed: [A, B] },
        ],
      },
      TEACHER_ID,
      [A, B],
      REALM,
    );
    assert.deepEqual(copy?.coalescedWrites, [
      { clientRequestId: 'teacher', changed: [A, B], clientAuthored: [B] },
    ]);
  });

  test('a writer the realm cannot name shares their id with nobody', function (assert) {
    let copy = watcherListedCopy(
      {
        kind: 'listed',
        invalidations: [A],
        write: { actor: undefined, clientRequestId: 'unknown' },
      },
      TEACHER_ID,
      [A],
      REALM,
    );
    assert.deepEqual(copy, {
      eventName: 'index',
      indexType: 'incremental',
      invalidations: [A],
      realmURL: REALM,
    });
  });

  test('nothing is sent when no card is readable and no write is theirs', function (assert) {
    assert.strictEqual(
      watcherListedCopy(
        {
          kind: 'listed',
          invalidations: [A],
          write: { actor: ADMIN_ID, clientRequestId: 'admin' },
        },
        TEACHER_ID,
        [],
        REALM,
      ),
      undefined,
    );
  });
});
