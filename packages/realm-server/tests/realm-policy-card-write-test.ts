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
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// The card+json writes — a `POST` creating a card, a `PATCH` updating one and
// a `DELETE` removing one — reach the policy gate as the `create`, `update` and
// `delete` they carry out, so a caller the realm ACL declined gets the answer
// the operations envelope gives them for the same write.
//
// The Education realm's policy card lives in an Org realm nobody the Education
// realm serves can read. A teacher holds no permission on the Education realm
// and a reader may read it but not write it, so every write either of them
// sends reaches the gate. The Open realm's policy grants every card write
// outright, which is the broadest grant there is, so what it still refuses is
// refused whatever a policy says.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const OPEN = 'http://127.0.0.1:4444/open/';
const POLICY_CARD = `${ORG}policies/education`;
const OPEN_POLICY_CARD = `${OPEN}policies/open`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';

const INSUFFICIENT = 'Insufficient permissions to perform this action';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };
const NOTICE = { module: `${EDUCATION}notice`, name: 'Notice' };

function adoptsFrom(ref: { module: string; name: string }) {
  return { module: rri(ref.module), name: ref.name };
}

// Is the caller one of the classroom's teachers, exactly. BXL's `contains`
// matches substrings, so it is not used for membership.
const TEACHES = '.teacherIds | any(. == actor())';

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
  }
`;

const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
`;

// A notice's `delete` withdraws it rather than removing it.
const NOTICE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  import { operation } from "@cardstack/base/operations";
  export class Notice extends CardDef {
    @field body = contains(StringField);
    @field status = contains(StringField);

    @operation static delete = {
      base: 'transform',
      set: { status: 'withdrawn' },
    };
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// Every Classroom write rests on a predicate, so the gate leaves each pending
// and the write lock decides it. A create's predicate reads the card it would
// mint. Bulletin writes are granted outright. A notice's `delete` is granted
// outright too, on the soft delete its type declares, and its `update` rests
// on a predicate that throws for any body that is not a number.
const EDUCATION_RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
      { operation: 'update', where: TEACHES },
      { operation: 'delete', where: TEACHES },
      { operation: 'create', where: TEACHES },
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
  {
    targetType: NOTICE,
    grants: [
      { operation: 'delete' },
      { operation: 'update', where: '(.body | tonumber) > 0' },
    ],
  },
];

const OPEN_RULES: Rule[] = [
  {
    targetType: CARD_DEF,
    grants: [
      { operation: 'create' },
      { operation: 'update' },
      { operation: 'delete' },
    ],
  },
];

function policyCard(rules: Rule[]) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { rules },
      meta: { adoptsFrom: REALM_POLICY },
    },
  });
}

function card(
  type: { module: string; name: string },
  attributes: Record<string, unknown>,
) {
  return JSON.stringify({
    data: { type: 'card', attributes, meta: { adoptsFrom: type } },
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
const ROOM_205 = `${EDUCATION}classrooms/room-205`;
const ROOM_999 = `${EDUCATION}classrooms/room-999`;
const BULLETIN_1 = `${EDUCATION}bulletins/b1`;
const BULLETIN_2 = `${EDUCATION}bulletins/b2`;
const BULLETIN_9 = `${EDUCATION}bulletins/b9`;
const NOTICE_1 = `${EDUCATION}notices/n1`;
const OPEN_NOTE = `${OPEN}notes/n1`;
const OPEN_CONFIG = `${OPEN}realm`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let open: Realm;
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
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: POLICY_CARD,
            }),
            'classroom.gts': CLASSROOM_MODULE,
            'bulletin.gts': BULLETIN_MODULE,
            'notice.gts': NOTICE_MODULE,
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
            'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
            'bulletins/b1.json': card(
              { module: '../bulletin', name: 'Bulletin' },
              { body: 'Picture day is Friday' },
            ),
            'bulletins/b2.json': card(
              { module: '../bulletin', name: 'Bulletin' },
              { body: 'The library opens at eight' },
            ),
            'notices/n1.json': card(
              { module: '../notice', name: 'Notice' },
              { body: 'Assembly', status: 'posted' },
            ),
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
            'policies/education.json': policyCard(EDUCATION_RULES),
          },
          permissions: {
            [ORG_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(OPEN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Open',
              policy: OPEN_POLICY_CARD,
            }),
            'policies/open.json': policyCard(OPEN_RULES),
            'notes/n1.json': card(CARD_DEF, { cardInfo: { name: 'A note' } }),
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
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
    open = result.realms.find((realm) => realm.url === OPEN)!;
  }

  setupDB(hooks, {
    beforeEach: async (dbAdapter, publisher, runner) => {
      await start({ dbAdapter, publisher, runner });
    },
    afterEach: async () => {
      education.__testOnlySetBeforeBatchLock(undefined);
      for (let realm of [education, org, open]) {
        realm.__testOnlyClearCaches();
        realm.unsubscribe();
      }
      await closeServer(server);
      resetCatalogRealms();
    },
  });

  function bearer(
    realm: Realm,
    user: string,
    permissions: Parameters<typeof createJWT>[2] = [],
  ) {
    return `Bearer ${createJWT(realm, user, permissions)}`;
  }

  const AUTH = {
    admin: () => bearer(education, ADMIN, ['read', 'write', 'realm-owner']),
    reader: () => bearer(education, READER, ['read']),
    teacher: () => bearer(education, TEACHER),
    openTeacher: () => bearer(open, TEACHER),
  };

  function path(url: string) {
    return new URL(url).pathname;
  }

  function withAuth(req: Test, auth: string | undefined) {
    return auth ? req.set('Authorization', auth) : req;
  }

  function patchCard(url: string, auth: string | undefined, doc: unknown) {
    return withAuth(
      request.patch(path(url)).set('Accept', SupportedMimeType.CardJson),
      auth,
    ).send(JSON.stringify(doc));
  }

  function deleteCard(url: string, auth: string | undefined) {
    return withAuth(
      request.delete(path(url)).set('Accept', SupportedMimeType.CardJson),
      auth,
    );
  }

  function createCard(realm: string, auth: string | undefined, doc: unknown) {
    return withAuth(
      request.post(path(realm)).set('Accept', SupportedMimeType.CardJson),
      auth,
    ).send(JSON.stringify(doc));
  }

  function operations(realm: string, auth: string, ...entries: unknown[]) {
    return request
      .post(`${path(realm)}_operations`)
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(envelope(...entries));
  }

  function bulletinPatch(body: string) {
    return {
      data: {
        type: 'card',
        attributes: { body },
        meta: { adoptsFrom: adoptsFrom(BULLETIN) },
      },
    };
  }

  function classroomPatch(title: string) {
    return {
      data: {
        type: 'card',
        attributes: { title },
        meta: { adoptsFrom: adoptsFrom(CLASSROOM) },
      },
    };
  }

  function newCard(
    type: { module: string; name: string },
    attributes: Record<string, unknown>,
  ) {
    return {
      data: {
        type: 'card',
        attributes,
        meta: { adoptsFrom: adoptsFrom(type) },
      },
    };
  }

  // A card's stored document as the realm holds it on disk.
  async function stored(realm: Realm, url: string) {
    let content = await realm.operationCore.readFileAsText(
      `${new URL(url).pathname.slice(new URL(realm.url).pathname.length)}.json` as LocalPath,
    );
    return content === undefined
      ? undefined
      : (
          JSON.parse(content) as {
            data: { attributes: Record<string, unknown> };
          }
        ).data.attributes;
  }

  function gateStats(realm: Realm = education) {
    return realm.__testOnlyPolicyGateStats();
  }

  // Changes what a pending write's predicate reads after the gate has matched
  // the write's grants and before the coordinator takes the write lock.
  function betweenGateAndLock(change: () => Promise<unknown>) {
    education.__testOnlySetBeforeBatchLock(async () => {
      education.__testOnlySetBeforeBatchLock(undefined);
      await change();
    });
  }

  // How many cards of a type are stored in the Education realm. A create
  // stores its card beneath a directory named for the type it mints.
  async function cardCount(type: { name: string }) {
    let listing = await request
      .get(`${path(EDUCATION)}${type.name}/`)
      .set('Accept', SupportedMimeType.DirectoryListing)
      .set('Authorization', AUTH.admin());
    if (listing.status === 404) {
      return 0;
    }
    return Object.keys(
      (listing.body as { data: { relationships: Record<string, unknown> } })
        .data.relationships,
    ).length;
  }

  // A caller who may not read the realm is told a card no grant admits is not
  // there, in the answer a card that is not there gets, byte for byte.
  function assertNotThere(
    assert: Assert,
    response: Response,
    missing: Response,
    [url, missingURL]: [string, string],
    label: string,
  ) {
    assert.strictEqual(response.status, 404, `${label}: status`);
    assert.strictEqual(missing.status, 404, `${label}: status when missing`);
    assert.strictEqual(
      response.text.replaceAll(path(url), path(missingURL)),
      missing.text,
      `${label}: the same answer as a card that does not exist`,
    );
  }

  module('a write a grant admits', function () {
    test('each card verb carries out the write a grant admits outright, as the envelope does', async function (assert) {
      let patched = await patchCard(
        BULLETIN_1,
        AUTH.teacher(),
        bulletinPatch('Picture day moved'),
      );
      assert.strictEqual(patched.status, 200, 'PATCH');
      assert.strictEqual(
        (patched.body as { data: { attributes: { body: string } } }).data
          .attributes.body,
        'Picture day moved',
        'answering with the card it wrote',
      );
      assert.strictEqual(
        (await stored(education, BULLETIN_1))?.body,
        'Picture day moved',
      );
      let enveloped = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('update', {
          href: BULLETIN_2,
          data: bulletinPatch('The library opens at nine').data,
        }),
      );
      assert.strictEqual(enveloped.status, 200, 'and the envelope update');

      let readerPatch = await patchCard(
        BULLETIN_2,
        AUTH.reader(),
        bulletinPatch('The library opens at ten'),
      );
      assert.strictEqual(
        readerPatch.status,
        200,
        'a reader, whom the ACL declines only writes, is admitted the same way',
      );

      let created = await createCard(
        EDUCATION,
        AUTH.teacher(),
        newCard(BULLETIN, { body: 'Bake sale' }),
      );
      assert.strictEqual(created.status, 201, 'POST');
      let id = (created.body as { data: { id: string } }).data.id;
      assert.strictEqual(
        (await stored(education, id))?.body,
        'Bake sale',
        'the card is stored',
      );

      let removed = await deleteCard(BULLETIN_1, AUTH.teacher());
      assert.strictEqual(removed.status, 204, 'DELETE');
      assert.strictEqual(
        await stored(education, BULLETIN_1),
        undefined,
        'the card is gone',
      );

      assert.strictEqual(
        gateStats().pendingDischarges,
        0,
        'a grant with no predicate decides nothing under the lock',
      );
    });

    test('a write whose grant rests on a predicate is decided under the write lock', async function (assert) {
      let patched = await patchCard(
        ROOM_204,
        AUTH.teacher(),
        classroomPatch('Renamed'),
      );
      assert.strictEqual(patched.status, 200, 'PATCH of a room taught');
      assert.strictEqual((await stored(education, ROOM_204))?.title, 'Renamed');

      let created = await createCard(
        EDUCATION,
        AUTH.teacher(),
        newCard(CLASSROOM, { title: 'Room 206', teacherIds: [TEACHER] }),
      );
      assert.strictEqual(
        created.status,
        201,
        'POST of a room the minted card says the caller teaches',
      );

      let removed = await deleteCard(ROOM_204, AUTH.teacher());
      assert.strictEqual(removed.status, 204, 'DELETE of a room taught');
      assert.strictEqual(await stored(education, ROOM_204), undefined);

      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 3,
          predicateEvaluations: 3,
          pendingDischarges: 3,
          definitionLookups: 0,
        },
        'each write’s predicate was evaluated once, under the lock',
      );
    });

    test('a pending write is judged by the card as the lock holds it, not as the gate saw it', async function (assert) {
      betweenGateAndLock(() =>
        education.write(
          'classrooms/room-204.json',
          classroom('Room 204', [COLLEAGUE]),
        ),
      );
      let refused = await patchCard(
        ROOM_204,
        AUTH.teacher(),
        classroomPatch('Renamed'),
      );
      let missing = await patchCard(
        ROOM_999,
        AUTH.teacher(),
        classroomPatch('Renamed'),
      );
      assertNotThere(
        assert,
        refused,
        missing,
        [ROOM_204, ROOM_999],
        'a teacher dropped from the room after the gate matched the write',
      );
      assert.deepEqual(
        await stored(education, ROOM_204),
        { title: 'Room 204', teacherIds: [COLLEAGUE] },
        'the room holds what the other writer wrote, and no rename',
      );

      betweenGateAndLock(() =>
        education.write(
          'classrooms/room-205.json',
          classroom('Room 205', [COLLEAGUE, TEACHER]),
        ),
      );
      let admitted = await deleteCard(ROOM_205, AUTH.teacher());
      assert.strictEqual(
        admitted.status,
        204,
        'a teacher added to the room after the gate matched the delete',
      );
      assert.strictEqual(await stored(education, ROOM_205), undefined);
    });

    test('a write granted outright is judged by the stored type of the card the lock holds', async function (assert) {
      // The grants were matched on a Bulletin, and the card is a Notice by
      // the time the lock is taken. That the Notice's own type grants a delete
      // outright changes nothing.
      betweenGateAndLock(() =>
        education.write(
          'bulletins/b2.json',
          card(
            { module: '../notice', name: 'Notice' },
            { body: 'Swapped', status: 'posted' },
          ),
        ),
      );
      assertNotThere(
        assert,
        await deleteCard(BULLETIN_2, AUTH.teacher()),
        await deleteCard(BULLETIN_9, AUTH.teacher()),
        [BULLETIN_2, BULLETIN_9],
        'a DELETE of a bulletin rewritten as a notice after the gate matched the write',
      );
      assert.strictEqual(
        (await stored(education, BULLETIN_2))?.body,
        'Swapped',
        'and the card is left as the other writer wrote it',
      );
    });
  });

  module('a write no grant admits', function () {
    test('a caller who may not read the realm is told the card is not there, on every verb', async function (assert) {
      assertNotThere(
        assert,
        await patchCard(ROOM_205, AUTH.teacher(), classroomPatch('Renamed')),
        await patchCard(ROOM_999, AUTH.teacher(), classroomPatch('Renamed')),
        [ROOM_205, ROOM_999],
        'PATCH of a room not taught',
      );
      assertNotThere(
        assert,
        await deleteCard(ROOM_205, AUTH.teacher()),
        await deleteCard(ROOM_999, AUTH.teacher()),
        [ROOM_205, ROOM_999],
        'DELETE of a room not taught',
      );
      let classroomsBefore = await cardCount(CLASSROOM);
      let refusedCreate = await createCard(
        EDUCATION,
        AUTH.teacher(),
        newCard(CLASSROOM, { title: 'Room 206', teacherIds: [COLLEAGUE] }),
      );
      assert.strictEqual(
        refusedCreate.status,
        404,
        'POST of a room the minted card says someone else teaches',
      );
      assert.strictEqual(
        await cardCount(CLASSROOM),
        classroomsBefore,
        'and nothing was minted',
      );
      assert.deepEqual(
        await stored(education, ROOM_205),
        { title: 'Room 205', teacherIds: [COLLEAGUE] },
        'the room not taught is untouched',
      );

      let enveloped = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('update', {
          href: ROOM_205,
          data: classroomPatch('Renamed').data,
        }),
      );
      assert.strictEqual(
        enveloped.status,
        404,
        'the envelope answers the same write with the same status',
      );
    });

    test('a caller who may read the realm is told the write is not permitted, on either transport', async function (assert) {
      let patched = await patchCard(
        ROOM_205,
        AUTH.reader(),
        classroomPatch('Renamed'),
      );
      assert.strictEqual(patched.status, 403, 'PATCH');
      let removed = await deleteCard(ROOM_205, AUTH.reader());
      assert.strictEqual(removed.status, 403, 'DELETE');
      let enveloped = await operations(
        EDUCATION,
        AUTH.reader(),
        invoke('update', {
          href: ROOM_205,
          data: classroomPatch('Renamed').data,
        }),
      );
      assert.strictEqual(enveloped.status, 403, 'the envelope update');
      assert.strictEqual(
        (enveloped.body as { errors: { code: string }[] }).errors[0].code,
        'operation-not-permitted',
      );
      assert.strictEqual(
        (await deleteCard(ROOM_999, AUTH.reader())).status,
        404,
        'and a card that does not exist is not there',
      );
      assert.strictEqual(
        (await stored(education, ROOM_205))?.title,
        'Room 205',
        'nothing was written',
      );
    });

    test('an anonymous caller is asked to authenticate, whatever the path names', async function (assert) {
      for (let [label, send] of [
        [
          'PATCH',
          (url: string) => patchCard(url, undefined, classroomPatch('x')),
        ],
        ['DELETE', (url: string) => deleteCard(url, undefined)],
      ] as const) {
        let existing = await send(ROOM_204);
        let missing = await send(ROOM_999);
        assert.strictEqual(existing.status, 401, `${label}: status`);
        assert.strictEqual(
          (existing.body as { errors: { code: string }[] }).errors[0].code,
          'actor-required',
          `${label}: the refusal a consuming route gives`,
        );
        assert.strictEqual(
          existing.text,
          missing.text,
          `${label}: the same answer for a card that does not exist`,
        );
      }
      let created = await createCard(
        EDUCATION,
        undefined,
        newCard(BULLETIN, { body: 'Bake sale' }),
      );
      assert.strictEqual(created.status, 401, 'POST');
      assert.strictEqual(gateStats().policyLoads, 0, 'no policy was loaded');
    });

    test('a predicate that throws is a fault in the policy, on either transport', async function (assert) {
      let patched = await patchCard(NOTICE_1, AUTH.teacher(), {
        data: {
          type: 'card',
          attributes: { body: 'Moved' },
          meta: { adoptsFrom: adoptsFrom(NOTICE) },
        },
      });
      assert.strictEqual(patched.status, 500, 'PATCH');
      let enveloped = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('update', {
          href: NOTICE_1,
          data: {
            type: 'card',
            attributes: { body: 'Moved' },
            meta: { adoptsFrom: adoptsFrom(NOTICE) },
          },
        }),
      );
      assert.strictEqual(enveloped.status, 500, 'the envelope update');
      assert.strictEqual(
        (enveloped.body as { errors: { code: string }[] }).errors[0].code,
        'internal-error',
      );
      assert.strictEqual(
        (await stored(education, NOTICE_1))?.body,
        'Assembly',
        'nothing was written',
      );
    });

    test('a conditional write the caller may not make says no more than a refusal', async function (assert) {
      // An `If-Match` is checked inside the lock, before the pending write is
      // judged, and a card that does not match it answers 412. So the check
      // is not allowed to answer for a card the caller was never admitted to.
      assertNotThere(
        assert,
        await patchCard(
          ROOM_205,
          AUTH.teacher(),
          classroomPatch('Renamed'),
        ).set('If-Match', '"stale"'),
        await patchCard(
          ROOM_999,
          AUTH.teacher(),
          classroomPatch('Renamed'),
        ).set('If-Match', '"stale"'),
        [ROOM_205, ROOM_999],
        'a PATCH naming a validator',
      );
      let own = await patchCard(
        ROOM_204,
        AUTH.teacher(),
        classroomPatch('Renamed'),
      ).set('If-Match', '"stale"');
      assert.strictEqual(
        own.status,
        412,
        'a room the caller teaches is told the validator does not match',
      );
    });

    test('a body the verb cannot use says no more than a refusal', async function (assert) {
      // The handler reads the body after the gate has matched the write's
      // grants and before the lock has judged its predicate, so its 400 is
      // not allowed to answer for a card the caller was never admitted to.
      assertNotThere(
        assert,
        await patchCard(ROOM_205, AUTH.teacher(), { data: {} }),
        await patchCard(ROOM_999, AUTH.teacher(), { data: {} }),
        [ROOM_205, ROOM_999],
        'a PATCH whose body is not a card document',
      );
      assert.strictEqual(
        (await patchCard(ROOM_204, AUTH.teacher(), { data: {} })).status,
        400,
        'a room the caller teaches is told what is wrong with the body',
      );
    });
  });

  module('what a grant does not reach over the card verbs', function () {
    test('a write that side-loads cards is refused, and writes nothing', async function (assert) {
      let withSideLoad = {
        data: {
          type: 'card',
          attributes: { body: 'See the attached' },
          meta: { adoptsFrom: adoptsFrom(BULLETIN) },
        },
        included: [
          {
            type: 'card',
            lid: 'b9',
            attributes: { body: 'Attached' },
            meta: { adoptsFrom: adoptsFrom(BULLETIN) },
          },
        ],
      };
      let bulletinsBefore = await cardCount(BULLETIN);
      let patched = await patchCard(BULLETIN_1, AUTH.reader(), withSideLoad);
      assert.strictEqual(
        patched.status,
        403,
        'a PATCH the grant would otherwise admit',
      );
      let created = await createCard(EDUCATION, AUTH.reader(), withSideLoad);
      assert.strictEqual(created.status, 403, 'a POST');
      assertNotThere(
        assert,
        await patchCard(BULLETIN_1, AUTH.teacher(), withSideLoad),
        await patchCard(BULLETIN_9, AUTH.teacher(), withSideLoad),
        [BULLETIN_1, BULLETIN_9],
        'to a caller who may not read the realm',
      );
      assert.strictEqual(
        (await stored(education, BULLETIN_1))?.body,
        'Picture day is Friday',
        'the card is untouched',
      );
      assert.strictEqual(
        await cardCount(BULLETIN),
        bulletinsBefore,
        'and nothing was side-loaded',
      );
      assert.strictEqual(
        await stored(education, `${EDUCATION}Bulletin/b9`),
        undefined,
      );

      let admin = await patchCard(BULLETIN_1, AUTH.admin(), withSideLoad);
      assert.strictEqual(
        admin.status,
        200,
        'a caller the ACL allows side-loads',
      );
    });

    test('a verb reaches the built-in behavior only, so a type that declares its own is refused', async function (assert) {
      let reader = await deleteCard(NOTICE_1, AUTH.reader());
      assert.strictEqual(
        reader.status,
        403,
        'a DELETE of a notice, whose type declares its delete',
      );
      assert.strictEqual(
        (await deleteCard(NOTICE_1, AUTH.teacher())).status,
        404,
        'to a caller who may not read the realm',
      );
      assert.deepEqual(
        await stored(education, NOTICE_1),
        { body: 'Assembly', status: 'posted' },
        'the notice is untouched',
      );
      let enveloped = await operations(
        EDUCATION,
        AUTH.teacher(),
        invoke('delete', { href: NOTICE_1 }),
      );
      assert.strictEqual(
        enveloped.status,
        200,
        'the envelope carries out the delete the type declares',
      );
      assert.strictEqual(
        (await stored(education, NOTICE_1))?.status,
        'withdrawn',
        'which withdraws the notice rather than removing it',
      );
    });

    test('a create names its type by URL or prefix, so the gate and the card agree on it', async function (assert) {
      let relative = await createCard(EDUCATION, AUTH.teacher(), {
        data: {
          type: 'card',
          attributes: { body: 'Bake sale' },
          meta: { adoptsFrom: { module: './bulletin', name: 'Bulletin' } },
        },
      });
      assert.strictEqual(relative.status, 400, 'a relative module');
      let nested = await createCard(EDUCATION, AUTH.teacher(), {
        data: {
          type: 'card',
          attributes: { body: 'Bake sale' },
          meta: {
            adoptsFrom: {
              type: 'ancestorOf',
              card: { module: './bulletin', name: 'Bulletin' },
            },
          },
        },
      });
      assert.strictEqual(
        nested.status,
        400,
        'a relative module inside a ref that wraps another',
      );
      let admin = await createCard(EDUCATION, AUTH.admin(), {
        data: {
          type: 'card',
          attributes: { body: 'Bake sale' },
          meta: { adoptsFrom: { module: '../bulletin', name: 'Bulletin' } },
        },
      });
      assert.strictEqual(
        admin.status,
        201,
        'a caller the ACL allows creates with one',
      );
    });
  });

  module('authorization infrastructure', function () {
    test('no grant writes the realm config card or the policy card, on any route', async function (assert) {
      let openPath = (url: string) =>
        `${new URL(url).pathname.slice(path(OPEN).length)}.json`;
      let configBefore = await open.operationCore.readFileAsText(
        openPath(OPEN_CONFIG) as LocalPath,
      );
      let policyBefore = await open.operationCore.readFileAsText(
        openPath(OPEN_POLICY_CARD) as LocalPath,
      );

      let note = await patchCard(OPEN_NOTE, AUTH.openTeacher(), {
        data: {
          type: 'card',
          attributes: { cardInfo: { name: 'Renamed' } },
          meta: { adoptsFrom: CARD_DEF },
        },
      });
      assert.strictEqual(
        note.status,
        200,
        'the grant admits a write to an ordinary card',
      );

      for (let url of [OPEN_CONFIG, OPEN_POLICY_CARD]) {
        let patched = await patchCard(url, AUTH.openTeacher(), {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Taken' } },
            meta: { adoptsFrom: CARD_DEF },
          },
        });
        assert.strictEqual(patched.status, 404, `PATCH ${url}`);
        assert.strictEqual(
          (await deleteCard(url, AUTH.openTeacher())).status,
          404,
          `DELETE ${url}`,
        );
        let enveloped = await operations(
          OPEN,
          AUTH.openTeacher(),
          invoke('delete', { href: url }),
        );
        assert.strictEqual(enveloped.status, 404, `the envelope delete ${url}`);
      }

      let source = await request
        .post(`${path(OPEN)}realm.json`)
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', AUTH.openTeacher())
        .send(realmConfigCardJSON({ name: 'Taken' }));
      assert.strictEqual(source.status, 403, 'a card+source write');
      assert.strictEqual(source.text, INSUFFICIENT);
      let atomic = await request
        .post(`${path(OPEN)}_atomic`)
        .set('Accept', SupportedMimeType.JSONAPI)
        .set('Authorization', AUTH.openTeacher())
        .send(
          JSON.stringify({
            'atomic:operations': [
              {
                op: 'update',
                href: './policies/open.json',
                data: JSON.parse(policyCard([])).data,
              },
            ],
          }),
        );
      assert.strictEqual(atomic.status, 403, 'an /_atomic write');
      assert.strictEqual(atomic.text, INSUFFICIENT);

      assert.strictEqual(
        await open.operationCore.readFileAsText(
          openPath(OPEN_CONFIG) as LocalPath,
        ),
        configBefore,
        'the realm config card is untouched',
      );
      assert.strictEqual(
        await open.operationCore.readFileAsText(
          openPath(OPEN_POLICY_CARD) as LocalPath,
        ),
        policyBefore,
        'and so is the policy card',
      );
    });
  });

  module('a caller the realm ACL allows', function () {
    test('writes with no policy loaded and no predicate evaluated', async function (assert) {
      let patched = await patchCard(
        ROOM_205,
        AUTH.admin(),
        classroomPatch('Renamed'),
      );
      assert.strictEqual(patched.status, 200, 'PATCH');
      assert.ok(patched.get('etag'), 'answered with the card’s validator');
      let created = await createCard(
        EDUCATION,
        AUTH.admin(),
        newCard(CLASSROOM, { title: 'Room 206', teacherIds: [COLLEAGUE] }),
      );
      assert.strictEqual(created.status, 201, 'POST');
      assert.strictEqual(
        (await deleteCard(NOTICE_1, AUTH.admin())).status,
        204,
        'DELETE, which removes a notice whatever its type declares',
      );
      assert.strictEqual(await stored(education, NOTICE_1), undefined);
      assert.deepEqual(gateStats(), {
        policyLoads: 0,
        predicateEvaluations: 0,
        pendingDischarges: 0,
        definitionLookups: 0,
      });
    });
  });
});
