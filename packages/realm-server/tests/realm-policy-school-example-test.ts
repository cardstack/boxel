import QUnit from 'qunit';
const { module, test } = QUnit;
import sinon from 'sinon';
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { readdirSync, readFileSync } from 'fs';
import { basename, join, relative } from 'path';
import { dirSync } from 'tmp';
import { SupportedMimeType } from '@cardstack/runtime-common';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import type {
  PolicyExplanation,
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
  indexReads,
  matrixURL,
  realmConfigCardJSON,
  realmSecretSeed,
  runTestRealmServerWithRealms,
  setupDB,
  setupTestDatabaseTemplate,
} from './helpers/index.ts';
import { setupCatalogTestSubset } from './helpers/catalog-test-subset.ts';
import { createJWT as createRealmServerJWT } from '../utils/jwt.ts';

// The school example realms, served exactly as they ship in
// `packages/school-example-realm`. The three realms are mounted side by side,
// as a deployment mounts them, so the relative links between them resolve as
// they do there. The one value a deployment sets for itself is the Education
// realm's pointer to its policy, which must be an absolute URL.
const SERVER = 'http://127.0.0.1:4444/';
const CODE = `${SERVER}school-code/`;
const ORG = `${SERVER}school-org/`;
const EDUCATION = `${SERVER}school-education/`;
const EXAMPLE_ROOT = join(
  import.meta.dirname,
  '..',
  '..',
  'school-example-realm',
);

const POLICY_CARD = `${ORG}policies/education`;
const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const ROOM_205 = `${EDUCATION}classrooms/room-205`;
const ROOM_206 = `${EDUCATION}classrooms/room-206`;
const ROOM_999 = `${EDUCATION}classrooms/room-999`;
const SPEECH_JORDAN = `${EDUCATION}schedules/speech-jordan`;
const SPEECH_MAYA = `${EDUCATION}schedules/speech-maya`;
const READING_SAM = `${EDUCATION}schedules/reading-sam`;
const CLASSROOM = { module: `${CODE}classroom`, name: 'Classroom' };
const SCHEDULE = {
  module: `${CODE}service-plan-schedule`,
  name: 'ServicePlanSchedule',
};

// The staff the shipped roster names. Alice teaches Room 204 and leads Room
// 205; Ben teaches Rooms 205 and 206 and provides Sam's reading intervention;
// Carmen provides two speech-therapy schedules. None of them holds any
// permission on the Org or Education realm.
const ALICE = '@alice:school.example';
const BEN = '@ben:school.example';
const CARMEN = '@carmen:school.example';
// The realms' owner. The indexer reads each realm as its owner on the test
// homeserver, so the owner is a user of that server. They write all three.
const IT_ADMIN = '@it-admin:localhost';
// Reads the Education realm, and is granted nothing by its policy.
const OFFICE = '@office:school.example';

// Every file under one of the example's realm directories, keyed by its path
// in the realm.
function shippedRealm(name: string): Record<string, string> {
  let root = join(EXAMPLE_ROOT, name);
  let files: Record<string, string> = {};
  for (let entry of readdirSync(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      let full = join(entry.parentPath, entry.name);
      files[relative(root, full)] = readFileSync(full, 'utf8');
    }
  }
  return files;
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

function path(url: string) {
  return new URL(url).pathname;
}

function errorOf(response: Response) {
  return (response.body as { errors?: { code?: string }[] }).errors?.[0];
}

module(basename(import.meta.filename), function (hooks) {
  let code: Realm;
  let org: Realm;
  let education: Realm;
  let db: PgAdapter;
  let server: Server;
  let request: SuperTest<Test>;

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
          realmURL: new URL(CODE),
          fileSystem: shippedRealm('school-code'),
          permissions: {
            users: ['read'],
            [IT_ADMIN]: ['read', 'write', 'realm-owner'],
          },
        },
        {
          realmURL: new URL(ORG),
          fileSystem: shippedRealm('school-org'),
          permissions: { [IT_ADMIN]: ['read', 'write', 'realm-owner'] },
        },
        {
          realmURL: new URL(EDUCATION),
          fileSystem: {
            ...shippedRealm('school-education'),
            'realm.json': realmConfigCardJSON({
              name: 'School Education',
              policy: POLICY_CARD,
            }),
          },
          permissions: {
            [IT_ADMIN]: ['read', 'write', 'realm-owner'],
            [OFFICE]: ['read'],
          },
        },
      ],
      dbAdapter,
      publisher,
      runner,
      matrixURL,
    });
    db = dbAdapter;
    server = result.testRealmHttpServer;
    request = supertest(server);
    code = result.realms.find((realm) => realm.url === CODE)!;
    org = result.realms.find((realm) => realm.url === ORG)!;
    education = result.realms.find((realm) => realm.url === EDUCATION)!;
  }

  // Every test boots the three realms in its `beforeEach`, from a template
  // database they were indexed into once, inside the test's own budget.
  hooks.beforeEach(function (assert) {
    assert.timeout(180_000);
  });

  // The current test's boot. The teardown waits for it, so a test that timed
  // out while its boot was still running still closes what that boot opens.
  let booting: Promise<void> | undefined;

  async function stop() {
    for (let realm of [code, org, education]) {
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
      booting = start({ dbAdapter, publisher, runner });
      await booting;
    },
    afterEach: async () => {
      let booted = await booting?.then(
        () => true,
        () => false,
      );
      booting = undefined;
      if (booted) {
        await stop();
      } else {
        resetCatalogRealms();
      }
    },
  });

  // A session on the Education realm carrying what that realm grants the
  // user, which for every member of staff is nothing.
  function onEducation(user: string) {
    let permissions: Parameters<typeof createJWT>[2] =
      user === IT_ADMIN
        ? ['read', 'write', 'realm-owner']
        : user === OFFICE
          ? ['read']
          : [];
    return `Bearer ${createJWT(education, user, permissions)}`;
  }

  function onOrg(user: string) {
    return `Bearer ${createJWT(
      org,
      user,
      user === IT_ADMIN ? ['read', 'write', 'realm-owner'] : [],
    )}`;
  }

  function getCard(url: string, auth?: string) {
    let req = request.get(path(url)).set('Accept', SupportedMimeType.CardJson);
    return auth ? req.set('Authorization', auth) : req;
  }

  function operations(
    realm: string,
    auth: string | undefined,
    method: 'post' | 'query',
    ...entries: unknown[]
  ) {
    let req = request.post(`${path(realm)}_operations`);
    if (method === 'query') {
      req = req.set('X-HTTP-Method-Override', 'QUERY');
    }
    req = req
      .set('Accept', SupportedMimeType.BoxelOperations)
      .set('Content-Type', SupportedMimeType.BoxelOperations);
    return (auth ? req.set('Authorization', auth) : req).send(
      envelope(...entries),
    );
  }

  function federatedSearch(body: Record<string, unknown>, user?: string) {
    let req = request
      .post('/_federated-search')
      .set('Accept', 'application/vnd.card+json')
      .set('Content-Type', 'application/json')
      .set('X-HTTP-Method-Override', 'QUERY');
    if (user) {
      req = req.set(
        'Authorization',
        `Bearer ${createRealmServerJWT(
          { user, sessionRoom: `session-room-${user}` },
          realmSecretSeed,
        )}`,
      );
    }
    return req.send(body);
  }

  function listMySchedules(
    user?: string,
    page?: { number: number; size: number },
  ) {
    return federatedSearch(
      {
        operation: 'listMySchedules',
        on: SCHEDULE,
        realms: [EDUCATION],
        ...(page ? { page } : {}),
      },
      user,
    );
  }

  function gateStats() {
    return education.__testOnlyPolicyGateStats();
  }

  // How far each counter moved while `run` ran.
  async function gateStatsDuring(run: () => Promise<unknown>) {
    let before = gateStats();
    await run();
    let after = gateStats();
    let moved = { ...after };
    for (let key of Object.keys(after) as (keyof typeof after)[]) {
      moved[key] = after[key] - before[key];
    }
    return moved;
  }

  // The definitions the Education realm looks up while `run` runs.
  async function definitionLookupsDuring(run: () => Promise<unknown>) {
    let lookup = education.operationCore.definitionLookup;
    let original = lookup.lookupDefinition;
    let count = 0;
    lookup.lookupDefinition = (...args) => {
      count++;
      return original.apply(lookup, args);
    };
    try {
      await run();
    } finally {
      lookup.lookupDefinition = original;
    }
    return count;
  }

  // Every index read the database is asked for while `run` runs.
  async function indexReadsDuring(run: () => Promise<unknown>) {
    let statements: { sql: string; bind: unknown }[] = [];
    let execute = db.execute;
    db.execute = function (this: PgAdapter, ...args) {
      statements.push({ sql: args[0], bind: args[1]?.bind });
      return execute.apply(this, args);
    };
    try {
      await run();
    } finally {
      db.execute = execute;
    }
    return indexReads(statements);
  }

  function explain(
    auth: string,
    question: { actor: string; target: string; operation: string },
  ) {
    return operations(
      ORG,
      auth,
      'query',
      invoke('explain', { href: POLICY_CARD, data: question }),
    );
  }

  test('the shipped policy compiles with every grant active', async function (assert) {
    let compiled = await education.getCompiledPolicy();
    assert.ok(compiled, 'the Education realm has a policy');
    // The one remark is the compiler's caution about rendered pages: a
    // schedule links to its provider's roster card, and the compiler cannot
    // tell which of a type's formats draw a linked card, so it remarks on any
    // format the listing leaves shareable. The formats a listing row shows draw
    // only the schedule's own fields, and the listing declares the isolated
    // and head formats, which can draw more, unshareable.
    assert.deepEqual(
      compiled?.issues.map(({ code, path, severity }) => ({
        code,
        path,
        severity,
      })),
      [
        {
          code: 'render-reaches-ungranted-type',
          path: 'rules[1].grants[1]',
          severity: 'warning',
        },
      ],
    );
  });

  module('a teacher opens their classroom', function () {
    test('the classroom is served, judged on its stored teacher ids', async function (assert) {
      let response: Response | undefined;
      let moved = await gateStatsDuring(async () => {
        response = await getCard(ROOM_204, onEducation(ALICE));
      });
      assert.strictEqual(response!.status, 200, 'HTTP 200');
      assert.strictEqual(response!.body.data.id, ROOM_204);
      assert.strictEqual(response!.body.data.attributes.name, 'Room 204');
      assert.deepEqual(
        response!.body.data.relationships['teachers.0'].links.self,
        `${ORG}StaffMember/alice`,
        'the classroom names its teacher’s roster card',
      );
      assert.notOk(
        response!.body.included?.length,
        'and carries none of the roster, since its read declares `links: ids`',
      );
      assert.strictEqual(
        moved.predicateEvaluations,
        1,
        'the read grant’s predicate decided it',
      );
      assert.strictEqual(
        moved.snapshotReads,
        0,
        'against the classroom’s stored source, not a snapshot of the index',
      );
    });

    test('a lead teacher reads the classroom they lead through the same grant', async function (assert) {
      let response = await getCard(ROOM_205, onEducation(ALICE));
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.attributes.name, 'Room 205');
    });

    test('an IT admin reads the realm outright, and the policy is never loaded', async function (assert) {
      let response: Response | undefined;
      let moved = await gateStatsDuring(async () => {
        response = await getCard(ROOM_206, onEducation(IT_ADMIN));
      });
      assert.strictEqual(response!.status, 200);
      assert.deepEqual(
        moved,
        {
          policyLoads: 0,
          predicateEvaluations: 0,
          pendingDischarges: 0,
          definitionLookups: 0,
          snapshotReads: 0,
          ancestorDefinitionReads: 0,
          lockedTypeReads: 0,
        },
        'a caller the realm ACL allows pays nothing for the policy',
      );
    });
  });

  module('the same teacher opens a colleague’s classroom', function () {
    test('they are told it is not there, exactly as for a classroom that does not exist', async function (assert) {
      let denied = await getCard(ROOM_206, onEducation(ALICE));
      let missing = await getCard(ROOM_999, onEducation(ALICE));
      assert.strictEqual(denied.status, 404, 'a 404, not a 403');
      assert.strictEqual(missing.status, 404);
      assert.strictEqual(
        denied.text.replaceAll('room-206', 'room-999'),
        missing.text,
        'the two bodies are the same, byte for byte, but for the path each names',
      );

      let deniedEntry = await operations(
        EDUCATION,
        onEducation(ALICE),
        'query',
        invoke('read', { href: ROOM_206 }),
      );
      let missingEntry = await operations(
        EDUCATION,
        onEducation(ALICE),
        'query',
        invoke('read', { href: ROOM_999 }),
      );
      assert.strictEqual(deniedEntry.status, 404);
      assert.strictEqual(errorOf(deniedEntry)?.code, 'target-not-found');
      assert.strictEqual(
        deniedEntry.text,
        missingEntry.text,
        'and so are the envelope’s',
      );
    });

    test('a member of staff who reads the realm is told appending is not permitted', async function (assert) {
      let response = await operations(
        EDUCATION,
        onEducation(OFFICE),
        'post',
        invoke('appendActivity', { href: ROOM_206, data: { note: 'Hi' } }),
      );
      assert.strictEqual(response.status, 403, 'a 403, since they can see it');
      assert.strictEqual(errorOf(response)?.code, 'operation-not-permitted');
    });
  });

  module('a teacher appends an activity', function () {
    test('the realm mints the activity, and the operation writes the author and the classroom', async function (assert) {
      let response = await operations(
        EDUCATION,
        onEducation(ALICE),
        'post',
        invoke('appendActivity', {
          href: ROOM_204,
          data: { note: 'Planted the class garden' },
        }),
      );
      assert.strictEqual(response.status, 200, response.text);
      let [{ data: result }] = (
        JSON.parse(response.text) as {
          'atomic:results': { data: { id: string } }[];
        }
      )['atomic:results'];
      assert.true(
        result.id.startsWith(EDUCATION),
        `the activity is in the Education realm (${result.id})`,
      );

      let activity = await getCard(result.id, onEducation(IT_ADMIN));
      assert.strictEqual(activity.status, 200);
      assert.strictEqual(
        activity.body.data.attributes.note,
        'Planted the class garden',
      );
      assert.strictEqual(
        activity.body.data.attributes.author,
        ALICE,
        'the author is the caller, written by the operation',
      );
      assert.strictEqual(
        activity.body.data.relationships.classroom.links.self,
        '../classrooms/room-204',
        'and the classroom is the one it was invoked on',
      );

      let classroom = await getCard(ROOM_204, onEducation(IT_ADMIN));
      assert.deepEqual(
        classroom.body.data.attributes.teacherIds,
        [ALICE],
        'the classroom’s teacher ids are untouched',
      );
    });

    test('a lead teacher may read a classroom and still not append to it', async function (assert) {
      let response = await operations(
        EDUCATION,
        onEducation(ALICE),
        'post',
        invoke('appendActivity', { href: ROOM_205, data: { note: 'Hello' } }),
      );
      assert.strictEqual(response.status, 404);
      assert.strictEqual(errorOf(response)?.code, 'target-not-found');
    });

    test('the teacher cannot write the ids her own grant reads, through a raw update', async function (assert) {
      // Room 204 is Alice's, so her grants hold there; only the absence of an
      // `update` grant refuses this.
      let response = await operations(
        EDUCATION,
        onEducation(ALICE),
        'post',
        invoke('update', {
          href: ROOM_204,
          data: {
            type: 'card',
            attributes: { teacherIds: [BEN, ALICE] },
            meta: { adoptsFrom: CLASSROOM },
          },
        }),
      );
      assert.strictEqual(
        response.status,
        404,
        'the policy grants no update, so it is refused',
      );
      let classroom = await getCard(ROOM_204, onEducation(IT_ADMIN));
      assert.deepEqual(classroom.body.data.attributes.teacherIds, [ALICE]);
    });
  });

  module('a teacher follows a shared link into code mode', function () {
    test('the file tree and the stored source answer as if nothing were there', async function (assert) {
      let root = await request
        .get(path(EDUCATION))
        .set('Accept', SupportedMimeType.DirectoryListing)
        .set('Authorization', onEducation(ALICE));
      assert.strictEqual(root.status, 404, 'the realm root is not listed');
      let listing = await request
        .get(path(`${EDUCATION}classrooms/`))
        .set('Accept', SupportedMimeType.DirectoryListing)
        .set('Authorization', onEducation(ALICE));
      let nothing = await request
        .get(path(`${EDUCATION}nowhere/`))
        .set('Accept', SupportedMimeType.DirectoryListing)
        .set('Authorization', onEducation(ALICE));
      assert.strictEqual(listing.status, 404, 'nor is a directory in it');
      assert.strictEqual(
        listing.text.replaceAll('classrooms/', 'nowhere/'),
        nothing.text,
        'the same answer as for a directory that does not exist',
      );

      // The classroom's own `.json` is its stored source, which is reached
      // through `readSource`, and the policy grants `read` only.
      let source = await request
        .get(path(`${ROOM_204}.json`))
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', onEducation(ALICE));
      let noSource = await request
        .get(path(`${ROOM_999}.json`))
        .set('Accept', SupportedMimeType.CardSource)
        .set('Authorization', onEducation(ALICE));
      assert.strictEqual(source.status, 404, 'the card source is refused');
      assert.strictEqual(
        source.text.replaceAll('room-204', 'room-999'),
        noSource.text,
        'with the answer a missing card gets',
      );
    });

    test('an IT admin reads the stored source without a definition lookup', async function (assert) {
      let response: Response | undefined;
      let lookups = await definitionLookupsDuring(async () => {
        response = await request
          .get(path(`${ROOM_204}.json`))
          .set('Accept', SupportedMimeType.CardSource)
          .set('Authorization', onEducation(IT_ADMIN));
      });
      assert.strictEqual(response!.status, 200);
      assert.strictEqual(
        lookups,
        0,
        'a coarse-allowed source read is definition-free',
      );
    });

    test('the definitions every staff member renders with are in the Code realm, which every signed-in user reads', async function (assert) {
      // The `users` row admits a caller the homeserver has a profile for. The
      // staff ids here name no test homeserver, so the lookup answers as a
      // homeserver that knows them would.
      let profile = sinon
        .stub(MatrixClient.prototype, 'getProfile')
        .resolves({ displayname: 'Alice Rivera' });
      try {
        let response = await request
          .get(path(`${CODE}classroom.gts`))
          .set('Accept', SupportedMimeType.CardSource)
          .set('Authorization', `Bearer ${createJWT(code, ALICE, ['read'])}`);
        assert.strictEqual(response.status, 200);
        profile.resolves(undefined);
        let unknown = await request
          .get(path(`${CODE}classroom.gts`))
          .set('Accept', SupportedMimeType.CardSource)
          .set('Authorization', `Bearer ${createJWT(code, ALICE, ['read'])}`);
        assert.notStrictEqual(
          unknown.status,
          200,
          'and refuses a caller the homeserver does not know',
        );
      } finally {
        profile.restore();
      }
    });
  });

  module('a service provider lists their schedules', function () {
    test('the named query answers the schedules the provider provides, and no others', async function (assert) {
      let carmen = await listMySchedules(CARMEN);
      assert.strictEqual(carmen.status, 200, carmen.text);
      assert.deepEqual(
        (carmen.body.data as { id: string }[]).map((entry) => entry.id),
        [SPEECH_JORDAN, SPEECH_MAYA],
        'Carmen’s two speech-therapy schedules, in the declared order',
      );
      assert.deepEqual(
        carmen.body.meta.policyScopedRealms,
        [EDUCATION],
        'and the answer says the Education realm scoped it',
      );

      let ben = await listMySchedules(BEN);
      assert.deepEqual(
        (ben.body.data as { id: string }[]).map((entry) => entry.id),
        [READING_SAM],
      );

      let alice = await listMySchedules(ALICE);
      assert.strictEqual(alice.status, 200);
      assert.deepEqual(alice.body.data, [], 'a teacher who provides nothing');
    });

    test('the listing pages through the caller’s schedules', async function (assert) {
      let first = await listMySchedules(CARMEN, { number: 0, size: 1 });
      let second = await listMySchedules(CARMEN, { number: 1, size: 1 });
      assert.deepEqual(
        (first.body.data as { id: string }[]).map((entry) => entry.id),
        [SPEECH_JORDAN],
      );
      assert.deepEqual(
        (second.body.data as { id: string }[]).map((entry) => entry.id),
        [SPEECH_MAYA],
      );
      assert.strictEqual(first.body.meta.page.total, 2);
    });

    test('a scoped listing reads the index as many times as the IT admin’s unscoped one', async function (assert) {
      // Revalidating the compiled policy is an index read of its own, so it is
      // done here, outside the window measured.
      await education.getCompiledPolicy();
      let scoped = await indexReadsDuring(() => listMySchedules(CARMEN));
      let unscoped = await indexReadsDuring(() => listMySchedules(IT_ADMIN));
      assert.true(unscoped.length > 0, 'the unscoped listing read the index');
      assert.strictEqual(
        scoped.length,
        unscoped.length,
        'one query plan either way',
      );
      assert.true(
        scoped.some(({ bind }) => JSON.stringify(bind).includes(CARMEN)),
        'and the scoped one is bound to the caller',
      );
    });

    // The declared filter and the grant's predicate compare the same field
    // with the caller, so a listing alone cannot show the grant at work. These
    // two can: without a grant naming the search, a provider finds nothing,
    // and the grant naming `listMySchedules` compiles to the fragment the
    // realm composes into it.
    test('a provider finds no schedules by a search no grant names', async function (assert) {
      let adHoc = { filter: { 'item.on': SCHEDULE }, realms: [EDUCATION] };
      let carmen = await federatedSearch(adHoc, CARMEN);
      assert.strictEqual(carmen.status, 200, carmen.text);
      assert.deepEqual(carmen.body.data, [], 'no `query` grant, no rows');
      assert.deepEqual(carmen.body.meta.policyScopedRealms, [EDUCATION]);
      let admin = await federatedSearch(adHoc, IT_ADMIN);
      assert.strictEqual(
        (admin.body.data as unknown[]).length,
        3,
        'where the IT admin, who reads the realm, finds every schedule',
      );
    });

    test('the listMySchedules grant compiles to a fragment over the provider id, bound to the caller', async function (assert) {
      let response = await operations(
        ORG,
        onOrg(IT_ADMIN),
        'query',
        invoke('explain', {
          href: POLICY_CARD,
          data: {
            actor: CARMEN,
            target: EDUCATION,
            operation: 'listMySchedules',
            search: { on: SCHEDULE },
          },
        }),
      );
      assert.strictEqual(response.status, 200, response.text);
      let explanation = (
        response.body as { 'atomic:results': PolicyExplanation[] }
      )['atomic:results'][0];
      assert.strictEqual(explanation.decision, 'allowed');
      assert.strictEqual(explanation.reason, 'granted');
      let fragment = JSON.stringify(explanation.search?.fragment);
      assert.true(fragment.includes('providerId'), fragment);
      assert.true(fragment.includes(JSON.stringify(CARMEN)), fragment);
    });

    test('a provider reads a schedule they provide and not another', async function (assert) {
      assert.strictEqual(
        (await getCard(SPEECH_JORDAN, onEducation(CARMEN))).status,
        200,
      );
      assert.strictEqual(
        (await getCard(READING_SAM, onEducation(CARMEN))).status,
        404,
      );
    });
  });

  module('an anonymous visitor tries any of the above', function () {
    test('they are asked to sign in before anything about the target is resolved', async function (assert) {
      let answers: Response[] = [];
      let moved = await gateStatsDuring(async () => {
        for (let url of [ROOM_204, ROOM_999]) {
          answers.push(await getCard(url));
          answers.push(
            await operations(
              EDUCATION,
              undefined,
              'post',
              invoke('appendActivity', { href: url, data: { note: 'Hi' } }),
            ),
          );
        }
      });
      let [card, append, missingCard, missingAppend] = answers;
      for (let response of answers) {
        assert.strictEqual(response.status, 401);
      }
      assert.strictEqual(errorOf(append)?.code, 'actor-required');
      assert.strictEqual(
        missingCard.text,
        card.text,
        'a classroom that does not exist gets the same answer',
      );
      assert.strictEqual(missingAppend.text, append.text);
      assert.strictEqual(moved.policyLoads, 0, 'and the policy is not loaded');

      assert.strictEqual(
        (await listMySchedules()).status,
        401,
        'and so is a search of a realm that is not public',
      );
    });
  });

  module('an IT admin asks what a change would do', function () {
    test('explain reports the teacher’s refused read of a colleague’s classroom', async function (assert) {
      let response = await explain(onOrg(IT_ADMIN), {
        actor: ALICE,
        target: ROOM_206,
        operation: 'read',
      });
      assert.strictEqual(response.status, 200, response.text);
      let explanation = (
        response.body as { 'atomic:results': PolicyExplanation[] }
      )['atomic:results'][0];
      assert.deepEqual(explanation, {
        actor: ALICE,
        target: ROOM_206,
        operation: 'read',
        acl: { read: false, write: false },
        decision: 'denied',
        reason: 'predicate-false',
        refusal: { status: 404, code: 'target-not-found' },
        rules: [
          {
            targetType: CLASSROOM,
            path: 'rules[0]',
            grants: [
              {
                path: 'rules[0].grants[0]',
                where:
                  '(.teacherIds | any(. == actor())) or (.leadTeacherIds | any(. == actor()))',
                tier: 'stored',
                outcome: 'did-not-hold',
              },
            ],
          },
        ],
      });
    });

    test('and the read of a classroom that lists the teacher', async function (assert) {
      let response = await explain(onOrg(IT_ADMIN), {
        actor: ALICE,
        target: ROOM_204,
        operation: 'read',
      });
      let explanation = (
        response.body as { 'atomic:results': PolicyExplanation[] }
      )['atomic:results'][0];
      assert.strictEqual(explanation.decision, 'allowed');
      assert.strictEqual(explanation.reason, 'granted');
      assert.deepEqual(
        explanation.rules[0].grants.map((grant) => grant.outcome),
        ['held'],
      );
      assert.deepEqual(explanation.admittedBy, { rule: 0, grant: 0 });
    });

    test('the teacher cannot ask, since no grant reaches explain', async function (assert) {
      // The Org realm names no policy of its own, so its permissions alone
      // answer the teacher, who holds none there, before anything about the
      // question is read.
      let asked = await explain(onOrg(ALICE), {
        actor: ALICE,
        target: ROOM_206,
        operation: 'read',
      });
      let invented = await explain(onOrg(ALICE), {
        actor: ALICE,
        target: ROOM_999,
        operation: 'read',
      });
      assert.strictEqual(asked.status, 403);
      assert.strictEqual(
        asked.text,
        invented.text,
        'the same answer whether or not the classroom exists',
      );
    });
  });
});
