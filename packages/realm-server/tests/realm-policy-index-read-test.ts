import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest } from 'supertest';
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
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';

// The realm's reads that come straight from its index, as a caller the realm's
// ACL declines meets them in a realm whose policy grants that caller a card.
// `_info` answers them, and every other such read is refused as the ACL
// refuses it.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
// A realm that names no policy.
const PLAIN = 'http://127.0.0.1:4444/plain/';
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const PLAIN_ADMIN = '@plain-admin:localhost';
// A user no realm's ACL names, whom Education's policy lets read a classroom.
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };

const CLASSROOM_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Classroom extends CardDef {
    @field title = contains(StringField);
  }
`;

function classroom(title: string) {
  return JSON.stringify({
    data: {
      type: 'card',
      attributes: { title },
      meta: { adoptsFrom: { module: '../classroom', name: 'Classroom' } },
    },
  });
}

const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const NOTES = `${EDUCATION}public/notes.txt`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let plain: Realm;
  let server: Server;
  let request: SuperTest<Test>;
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
              policy: `${ORG}policies/classrooms`,
            }),
            'classroom.gts': CLASSROOM_MODULE,
            'classrooms/room-204.json': classroom('Room 204'),
            'public/notes.txt': 'term notes',
          },
          permissions: { [ADMIN]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Org' }),
            'policies/classrooms.json': JSON.stringify({
              data: {
                type: 'card',
                attributes: {
                  rules: [
                    {
                      targetType: CLASSROOM,
                      grants: [{ operation: 'read' }],
                    },
                  ],
                },
                meta: { adoptsFrom: REALM_POLICY },
              },
            }),
          },
          permissions: { [ORG_ADMIN]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(PLAIN),
          fileSystem: {
            'realm.json': realmConfigCardJSON({ name: 'Plain' }),
          },
          permissions: { [PLAIN_ADMIN]: ['read', 'write', 'realm-owner'] },
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
    plain = result.realms.find((realm) => realm.url === PLAIN)!;
  }

  async function stop() {
    for (let realm of [education, org, plain]) {
      realm.__testOnlyClearCaches();
      realm.unsubscribe();
    }
    await closeServer(server);
    resetCatalogRealms();
  }

  // The realms are indexed once, into a template database every test starts
  // from, rather than from scratch before each test.
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

  function teacherIn(realm: Realm) {
    return `Bearer ${createJWT(realm, TEACHER, [])}`;
  }

  function info(realmURL: string, method: 'GET' | 'QUERY', auth?: string) {
    let path = new URL('_info', realmURL).pathname;
    let req =
      method === 'GET'
        ? request.get(path)
        : request.post(path).set('X-HTTP-Method-Override', 'QUERY');
    req = req.set('Accept', SupportedMimeType.RealmInfo);
    return auth ? req.set('Authorization', auth) : req;
  }

  test('_info answers a signed-in caller the ACL declines in a realm that names a policy', async function (assert) {
    for (let method of ['GET', 'QUERY'] as const) {
      let response = await info(EDUCATION, method, teacherIn(education));
      assert.strictEqual(response.status, 200, `${method}: answered`);
      assert.strictEqual(
        response.body.data.attributes.name,
        'Education',
        `${method}: with the realm's name`,
      );
      assert.false(
        'policy' in response.body.data.attributes,
        `${method}: and not the policy's pointer`,
      );
    }
  });

  test('an archived realm answers that caller with its info as it does while active', async function (assert) {
    let auth = teacherIn(education);
    let active = await info(EDUCATION, 'GET', auth);
    await archiveRealm(db, new URL(EDUCATION));
    try {
      let archived = await info(EDUCATION, 'GET', auth);
      assert.strictEqual(archived.status, active.status, 'the same status');
      assert.strictEqual(archived.text, active.text, 'the same body');
      assert.notOk(
        archived.get('X-Boxel-Realm-Archived'),
        'and nothing says the realm is archived',
      );
    } finally {
      await unarchiveRealm(db, new URL(EDUCATION));
    }
  });

  test('_info still refuses a non-reader in a realm that names no policy, and a caller who authenticated nobody', async function (assert) {
    for (let method of ['GET', 'QUERY'] as const) {
      assert.strictEqual(
        (await info(PLAIN, method, teacherIn(plain))).status,
        403,
        `${method}: a signed-in non-reader of a realm with no policy is forbidden`,
      );
      assert.strictEqual(
        (await info(EDUCATION, method)).status,
        401,
        `${method}: an anonymous caller in a realm with a policy is told to authenticate`,
      );
    }
  });

  test('the reads left to the ACL refuse a caller the policy grants a card', async function (assert) {
    let auth = teacherIn(education);
    let cardJson = await request
      .get(new URL(ROOM_204).pathname)
      .set('Accept', SupportedMimeType.CardJson)
      .set('Authorization', auth);
    assert.strictEqual(
      cardJson.status,
      200,
      'the policy lets the caller read the classroom as card+json',
    );

    let path = (url: string) => new URL(url).pathname;
    let at = (route: string) => new URL(route, EDUCATION).pathname;
    let reads: [string, Test][] = [
      [
        'card+html',
        request.get(path(ROOM_204)).set('Accept', SupportedMimeType.CardHtml),
      ],
      [
        'markdown',
        request.get(path(ROOM_204)).set('Accept', SupportedMimeType.Markdown),
      ],
      [
        'file-meta',
        request.get(path(NOTES)).set('Accept', SupportedMimeType.FileMeta),
      ],
      [
        'file-meta+html',
        request.get(path(NOTES)).set('Accept', SupportedMimeType.FileMetaHtml),
      ],
      [
        '_types',
        request
          .get(at('_types'))
          .set('Accept', SupportedMimeType.CardTypeSummary),
      ],
      [
        '_mtimes',
        request.get(at('_mtimes')).set('Accept', SupportedMimeType.Mtimes),
      ],
      [
        '_dependencies',
        request
          .get(`${at('_dependencies')}?url=${encodeURIComponent(ROOM_204)}`)
          .set('Accept', SupportedMimeType.JSONAPI),
      ],
      [
        '_card-dependencies',
        request
          .get(
            `${at('_card-dependencies')}?url=${encodeURIComponent(ROOM_204)}`,
          )
          .set('Accept', SupportedMimeType.CardDependencies),
      ],
      [
        '_publishability',
        request
          .get(at('_publishability'))
          .set('Accept', SupportedMimeType.JSONAPI),
      ],
      [
        '_indexing-errors',
        request
          .get(at('_indexing-errors'))
          .set('Accept', SupportedMimeType.JSONAPI),
      ],
      [
        '_lint',
        request
          .post(at('_lint'))
          .set('X-HTTP-Method-Override', 'QUERY')
          .set('Accept', SupportedMimeType.JSON)
          .send('export const x = 1;'),
      ],
    ];
    for (let [label, read] of reads) {
      let response = await read.set('Authorization', auth);
      assert.strictEqual(response.status, 403, `${label}: forbidden`);
    }
  });
});
