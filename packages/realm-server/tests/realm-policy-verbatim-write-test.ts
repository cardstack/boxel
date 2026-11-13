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

// The verbatim writes — the card+source write, its octet-stream spelling, the
// card+source removal and `/_atomic` — reach the policy gate for a caller the
// realm ACL declined, each write as the operation it amounts to on its path:
// a card's document as the card's `create`, `update` or `delete`, and any
// other file as the file's `update`. So such a caller writes through them
// exactly what the operations envelope admits them to write, and is refused
// what it refuses.
//
// The Education realm's policy card lives in an Org realm nobody the Education
// realm serves can read. A teacher holds no permission on the Education realm,
// and a reader may read it but not write it.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const POLICY_CARD = `${ORG}policies/education`;
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';
const COLLEAGUE = '@colleague:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};
const GTS_FILE_DEF = {
  module: rri('@cardstack/base/gts-file-def'),
  name: 'GtsFileDef',
};
const TEXT_FILE_DEF = {
  module: rri('@cardstack/base/text-file-def'),
  name: 'TextFileDef',
};

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };
const BULLETIN = { module: `${EDUCATION}bulletin`, name: 'Bulletin' };
const NOTICE = { module: `${EDUCATION}notice`, name: 'Notice' };

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

const NOTICE_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Notice extends CardDef {
    @field body = contains(StringField);
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

// Classroom writes rest on a predicate, which the write lock decides. Bulletin
// and Notice writes are granted outright, so a replacement that turns one into
// the other is matched on a type each grant covers. A module's source is
// granted its update outright, and a text file's update rests on a predicate,
// which no file write is admitted on.
const EDUCATION_RULES: Rule[] = [
  {
    targetType: CLASSROOM,
    grants: [
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
  {
    targetType: NOTICE,
    grants: [
      { operation: 'create' },
      { operation: 'update' },
      { operation: 'delete' },
    ],
  },
  { targetType: GTS_FILE_DEF, grants: [{ operation: 'update' }] },
  {
    targetType: TEXT_FILE_DEF,
    grants: [{ operation: 'update', where: TEACHES }],
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
  return JSON.stringify(
    { data: { type: 'card', attributes, meta: { adoptsFrom: type } } },
    null,
    2,
  );
}

const relative = {
  classroom: { module: '../classroom', name: 'Classroom' },
  bulletin: { module: '../bulletin', name: 'Bulletin' },
  notice: { module: '../notice', name: 'Notice' },
};

function classroom(title: string, teacherIds: string[]) {
  return card(relative.classroom, { title, teacherIds });
}

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
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
            'notes.txt': 'Bring a coat',
            'minutes.txt': 'Approved',
            'classrooms/room-204.json': classroom('Room 204', [TEACHER]),
            'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
            'bulletins/b1.json': card(relative.bulletin, {
              body: 'Picture day is Friday',
            }),
            'bulletins/b2.json': card(relative.bulletin, {
              body: 'The library opens at eight',
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
            'policies/education.json': policyCard(EDUCATION_RULES),
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

  async function stop() {
    for (let realm of [education, org]) {
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

  const AUTH = {
    admin: () =>
      `Bearer ${createJWT(education, ADMIN, ['read', 'write', 'realm-owner'])}`,
    reader: () => `Bearer ${createJWT(education, READER, ['read'])}`,
    teacher: () => `Bearer ${createJWT(education, TEACHER, [])}`,
  };

  function path(localPath: string) {
    return `${new URL(EDUCATION).pathname}${localPath}`;
  }

  async function stored(localPath: string) {
    return await education.operationCore.readFileAsText(localPath as LocalPath);
  }

  async function storedAttributes(localPath: string) {
    let text = await stored(localPath);
    return text === undefined
      ? undefined
      : (JSON.parse(text) as { data: { attributes: Record<string, unknown> } })
          .data.attributes;
  }

  function writeSource(localPath: string, auth: string, text: string) {
    return request
      .post(path(localPath))
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', auth)
      .send(text);
  }

  function writeBytes(localPath: string, auth: string, text: string) {
    return request
      .post(path(localPath))
      .set('Accept', SupportedMimeType.OctetStream)
      .set('Content-Type', 'application/octet-stream')
      .set('Authorization', auth)
      .send(Buffer.from(text));
  }

  function removeSource(localPath: string, auth: string) {
    return request
      .delete(path(localPath))
      .set('Accept', SupportedMimeType.CardSource)
      .set('Authorization', auth);
  }

  type AtomicEntry = {
    op: 'add' | 'update';
    href: string;
    text?: string;
    card?: string;
  };

  // Each entry writes a card's document as a card resource, or any text as a
  // source resource, the way the Realm Runner saves a card's source.
  function atomic(auth: string, ...entries: AtomicEntry[]) {
    return request
      .post(path('_atomic'))
      .set('Accept', SupportedMimeType.JSONAPI)
      .set('Authorization', auth)
      .send(
        JSON.stringify({
          'atomic:operations': entries.map(({ op, href, text, card }) => ({
            op,
            href,
            data:
              card !== undefined
                ? (JSON.parse(card) as { data: unknown }).data
                : { type: 'source', attributes: { content: text }, meta: {} },
          })),
        }),
      );
  }

  function operations(auth: string, ...entries: unknown[]) {
    return request
      .post(path('_operations'))
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations)
      .set('Authorization', auth)
      .send(JSON.stringify({ 'boxel:operations': entries }));
  }

  function classroomUpdate(href: string, title: string) {
    return {
      op: 'invoke',
      'boxel:name': 'update',
      href,
      data: {
        type: 'card',
        attributes: { title },
        meta: {
          adoptsFrom: { module: rri(CLASSROOM.module), name: 'Classroom' },
        },
      },
    };
  }

  function status(response: Response) {
    return `${response.status} ${response.text.slice(0, 300)}`;
  }

  module('/_atomic', function () {
    test('a batch every write of which a grant admits lands whole', async function (assert) {
      let response = await atomic(
        AUTH.teacher(),
        {
          op: 'update',
          href: './classrooms/room-204.json',
          text: classroom('Room 204, renamed', [TEACHER]),
        },
        {
          op: 'update',
          href: './bulletins/b1.json',
          card: card(relative.bulletin, { body: 'Picture day moved' }),
        },
      );
      assert.strictEqual(response.status, 201, status(response));
      assert.strictEqual(
        (await storedAttributes('classrooms/room-204.json'))?.title,
        'Room 204, renamed',
        'the classroom the teacher teaches, which a predicate admits, is written',
      );
      assert.strictEqual(
        (await storedAttributes('bulletins/b1.json'))?.body,
        'Picture day moved',
        'and so is the bulletin a grant admits outright',
      );
    });

    test('a batch with one write no grant admits is refused whole, and nothing lands', async function (assert) {
      let response = await atomic(
        AUTH.teacher(),
        {
          op: 'update',
          href: './bulletins/b1.json',
          text: card(relative.bulletin, { body: 'Picture day moved' }),
        },
        {
          op: 'update',
          href: './classrooms/room-205.json',
          text: classroom('Room 205, renamed', [COLLEAGUE]),
        },
      );
      assert.strictEqual(
        response.status,
        404,
        `a caller who may not read the realm is told the refused card is not there: ${status(response)}`,
      );
      assert.strictEqual(
        (await storedAttributes('bulletins/b1.json'))?.body,
        'Picture day is Friday',
        'the write the grant admits did not land either',
      );
      assert.strictEqual(
        (await storedAttributes('classrooms/room-205.json'))?.title,
        'Room 205',
      );

      let reader = await atomic(AUTH.reader(), {
        op: 'update',
        href: './classrooms/room-205.json',
        text: classroom('Room 205, renamed', [COLLEAGUE]),
      });
      assert.strictEqual(
        reader.status,
        403,
        `a reader is told the write is not permitted: ${status(reader)}`,
      );
    });

    test('a write the predicate admits at the gate is judged again under the lock', async function (assert) {
      let response = await atomic(AUTH.teacher(), {
        op: 'update',
        href: './classrooms/room-204.json',
        text: classroom('Room 204, handed over', [COLLEAGUE]),
      });
      assert.strictEqual(
        response.status,
        201,
        `the predicate reads the card the write changes, which the teacher teaches: ${status(response)}`,
      );
      let again = await atomic(AUTH.teacher(), {
        op: 'update',
        href: './classrooms/room-204.json',
        text: classroom('Room 204, taken back', [TEACHER]),
      });
      assert.strictEqual(
        again.status,
        404,
        `once the card names another teacher, the predicate refuses: ${status(again)}`,
      );
      assert.strictEqual(
        (await storedAttributes('classrooms/room-204.json'))?.title,
        'Room 204, handed over',
      );
    });

    test('a reader creates a card a grant admits at the path the write names; a caller who may not read the realm does not', async function (assert) {
      let created = await atomic(AUTH.reader(), {
        op: 'add',
        href: './bulletins/b3.json',
        card: card(relative.bulletin, { body: 'Bake sale' }),
      });
      assert.strictEqual(created.status, 201, status(created));
      assert.strictEqual(
        (await storedAttributes('bulletins/b3.json'))?.body,
        'Bake sale',
      );
      let teacher = await atomic(AUTH.teacher(), {
        op: 'add',
        href: './bulletins/b4.json',
        card: card(relative.bulletin, { body: 'Book fair' }),
      });
      assert.strictEqual(
        teacher.status,
        404,
        `the realm mints the ids of what such a caller creates, and this write names its own: ${status(teacher)}`,
      );
      assert.strictEqual(await stored('bulletins/b4.json'), undefined);
    });

    test('the write the envelope admits and refuses is the write /_atomic admits and refuses', async function (assert) {
      let enveloped = await operations(
        AUTH.teacher(),
        classroomUpdate(`${EDUCATION}classrooms/room-204`, 'Envelope'),
      );
      let atomicWrite = await atomic(AUTH.teacher(), {
        op: 'update',
        href: './classrooms/room-204.json',
        text: classroom('Atomic', [TEACHER]),
      });
      assert.deepEqual(
        [enveloped.status, atomicWrite.status],
        [200, 201],
        `both admit the classroom the teacher teaches: ${status(enveloped)} / ${status(atomicWrite)}`,
      );
      let refusedEnvelope = await operations(
        AUTH.teacher(),
        classroomUpdate(`${EDUCATION}classrooms/room-205`, 'Envelope'),
      );
      let refusedAtomic = await atomic(AUTH.teacher(), {
        op: 'update',
        href: './classrooms/room-205.json',
        text: classroom('Atomic', [COLLEAGUE]),
      });
      assert.deepEqual(
        [refusedEnvelope.status, refusedAtomic.status],
        [404, 404],
        'and both refuse the one the teacher does not',
      );
    });
  });

  module('a replacement that changes a card’s type', function () {
    test('is refused on every verbatim route, though a grant covers each type', async function (assert) {
      let notice = card(relative.notice, { body: 'Picture day is Friday' });
      let responses = [
        await writeSource('bulletins/b1.json', AUTH.reader(), notice),
        await writeBytes('bulletins/b1.json', AUTH.reader(), notice),
        await atomic(AUTH.reader(), {
          op: 'update',
          href: './bulletins/b1.json',
          text: notice,
        }),
        await atomic(AUTH.reader(), {
          op: 'update',
          href: './bulletins/b1.json',
          card: notice,
        }),
      ];
      assert.deepEqual(
        responses.map((response) => response.status),
        [403, 403, 403, 403],
        responses.map(status).join(' / '),
      );
      let notACard = await writeSource(
        'bulletins/b1.json',
        AUTH.reader(),
        JSON.stringify({ body: 'Picture day is Friday' }),
      );
      assert.strictEqual(
        notACard.status,
        403,
        `and so is one that leaves bytes that are not a card: ${status(notACard)}`,
      );
      assert.deepEqual(
        JSON.parse((await stored('bulletins/b1.json'))!).data.meta.adoptsFrom,
        relative.bulletin,
        'the card keeps its type',
      );

      let sameType = await writeSource(
        'bulletins/b1.json',
        AUTH.reader(),
        card(
          { module: rri(BULLETIN.module), name: 'Bulletin' },
          { body: 'Picture day moved' },
        ),
      );
      assert.strictEqual(
        sameType.status,
        204,
        `a type named another way is the same type: ${status(sameType)}`,
      );
    });
  });

  module('card+source', function () {
    test('a write and a removal are judged as the card’s update and delete', async function (assert) {
      let written = await writeSource(
        'classrooms/room-204.json',
        AUTH.teacher(),
        classroom('Room 204, renamed', [TEACHER]),
      );
      assert.strictEqual(written.status, 204, status(written));
      assert.strictEqual(
        (await storedAttributes('classrooms/room-204.json'))?.title,
        'Room 204, renamed',
      );
      let refused = await writeSource(
        'classrooms/room-205.json',
        AUTH.teacher(),
        classroom('Room 205, renamed', [COLLEAGUE]),
      );
      let missing = await writeSource(
        'classrooms/room-999.json',
        AUTH.teacher(),
        classroom('Room 999', [COLLEAGUE]),
      );
      assert.strictEqual(refused.status, 404, status(refused));
      assert.strictEqual(
        refused.text.replaceAll('room-205', 'room-999'),
        missing.text,
        'a card no grant admits is told as a card that is not there, byte for byte',
      );

      let removed = await removeSource('bulletins/b2.json', AUTH.teacher());
      assert.strictEqual(removed.status, 204, status(removed));
      assert.strictEqual(await stored('bulletins/b2.json'), undefined);
      let notRemoved = await removeSource(
        'classrooms/room-205.json',
        AUTH.teacher(),
      );
      assert.strictEqual(notRemoved.status, 404, status(notRemoved));
      assert.ok(
        await stored('classrooms/room-205.json'),
        'the classroom no grant admits is still there',
      );
    });

    test('a module’s source is written on a grant on its type, and only an existing module', async function (assert) {
      let changed = BULLETIN_MODULE.replace('body', 'text');
      let written = await writeSource('bulletin.gts', AUTH.teacher(), changed);
      assert.strictEqual(written.status, 204, status(written));
      assert.strictEqual(await stored('bulletin.gts'), changed);

      let created = await writeSource(
        'flyer.gts',
        AUTH.teacher(),
        BULLETIN_MODULE,
      );
      assert.strictEqual(
        created.status,
        404,
        `a file def carries no create, so no grant creates a module: ${status(created)}`,
      );
      assert.strictEqual(await stored('flyer.gts'), undefined);
      let removed = await removeSource('notice.gts', AUTH.teacher());
      assert.strictEqual(
        removed.status,
        404,
        `nor a delete, so no grant removes one: ${status(removed)}`,
      );
      assert.ok(await stored('notice.gts'));

      let viaAtomic = await atomic(AUTH.teacher(), {
        op: 'update',
        href: './notice.gts',
        text: NOTICE_MODULE.replace('body', 'text'),
      });
      assert.strictEqual(viaAtomic.status, 201, status(viaAtomic));
    });

    test('a data file’s update is admitted only by a grant with no predicate', async function (assert) {
      let written = await writeBytes(
        'notes.txt',
        AUTH.teacher(),
        'Bring a hat',
      );
      assert.strictEqual(
        written.status,
        404,
        `the only grant on a text file rests on a predicate: ${status(written)}`,
      );
      assert.strictEqual(await stored('notes.txt'), 'Bring a coat');
      let admin = await writeBytes('notes.txt', AUTH.admin(), 'Bring a hat');
      assert.strictEqual(
        admin.status,
        204,
        'a caller the ACL allows is not judged',
      );
    });
  });
});
