import QUnit from 'qunit';
const { module, test } = QUnit;
import supertest from 'supertest';
import type { Test, SuperTest, Response } from 'supertest';
import { writeFileSync } from 'fs';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri, SupportedMimeType } from '@cardstack/runtime-common';
import type {
  QueuePublisher,
  QueueRunner,
  Realm,
} from '@cardstack/runtime-common';
import {
  isOperationFailure,
  newOperationScope,
  resolveGatedOperation,
  runOperation,
  scopeCallerFor,
} from '@cardstack/runtime-common/card-operations';
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

// A stored-bytes read is resolved before any definition, so the policy has no
// type handed to it the way every other behavior does. It types the target
// itself: a data file by the `FileDef` its extension names, and a card's raw
// `.json` by the card's own type. Most of these tests drive the operation
// directly, since that typing happens in the gate whichever route a read
// arrives by. The last module reads through the routes that serve bytes over
// HTTP, which hand a caller the realm ACL declined to that same gate.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
const READER = '@reader:localhost';
const TEACHER = '@teacher:localhost';

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const CLASSROOM = { module: `${EDUCATION}classroom`, name: 'Classroom' };

// The `FileDef` family, as a rule names it. A `.pdf` resolves to `PdfDef` and
// a `.png` to `PngDef`, both of which descend from `FileDef`.
const FILE_DEF = { module: rri('@cardstack/base/card-api'), name: 'FileDef' };
const PDF_DEF = { module: rri('@cardstack/base/pdf-file-def'), name: 'PdfDef' };
const CARD_DEF = { module: rri('@cardstack/base/card-api'), name: 'CardDef' };

// Is the caller one of the classroom's teachers — a predicate over the
// target's stored document. A data file has no document, so the same source
// reaches nothing there.
const TEACHES = '.teacherIds | any(. == actor())';
// A predicate over what a data-file target does have: the path it names and
// the caller. The path is tested at its end, so a query string that repeated
// it would satisfy the test if the query string reached the id.
const PUBLIC_AND_TEACHER = `(instance().id | endswith("/public/handbook.pdf")) and (actor() == "${TEACHER}")`;

const CLASSROOM_MODULE = `
  import { contains, containsMany, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);
    @field announcements = containsMany(StringField);
  }
`;

const BULLETIN_MODULE = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";
  export class Bulletin extends CardDef {
    @field body = contains(StringField);
  }
`;

type Grant = { operation: string; where?: unknown };
type Rule = { targetType: { module: string; name: string }; grants: Grant[] };

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
  adoptsFrom: { module: string; name: string },
  attributes: Record<string, unknown>,
) {
  return JSON.stringify({
    data: { type: 'card', attributes, meta: { adoptsFrom } },
  });
}

// Every policy this file points the realm at, each in its own card so a test
// names the posture it is about rather than rewriting one card's rules.
const POLICIES: Record<string, Rule[]> = {
  // A grant on one file type only.
  pdf: [{ targetType: PDF_DEF, grants: [{ operation: 'readSource' }] }],
  // The root of the file hierarchy: any data file.
  anyFile: [{ targetType: FILE_DEF, grants: [{ operation: 'readSource' }] }],
  // A card's raw source, on one card type.
  classroomSource: [
    { targetType: CLASSROOM, grants: [{ operation: 'readSource' }] },
  ],
  // Any card's raw source.
  anyCardSource: [
    { targetType: CARD_DEF, grants: [{ operation: 'readSource' }] },
  ],
  // The same predicate on a card and on a data file. It holds for the card,
  // whose document has the field; it reaches nothing on the file.
  documentPredicate: [
    {
      targetType: CLASSROOM,
      grants: [{ operation: 'readSource', where: TEACHES }],
    },
    {
      targetType: FILE_DEF,
      grants: [{ operation: 'readSource', where: TEACHES }],
    },
  ],
  // What a predicate on a data file may read: the path and the caller.
  pathPredicate: [
    {
      targetType: FILE_DEF,
      grants: [{ operation: 'readSource', where: PUBLIC_AND_TEACHER }],
    },
  ],
  // The instance operation itself.
  appendOnly: [
    { targetType: CLASSROOM, grants: [{ operation: 'appendContainsMany' }] },
  ],
};

const ROOM_204_SOURCE = `${EDUCATION}classrooms/room-204.json`;
const FRESH_SOURCE = `${EDUCATION}classrooms/fresh.json`;
const SCHEDULE = `${EDUCATION}public/schedule.json`;
const GHOST_PDF = `${EDUCATION}public/ghost.pdf`;
const GHOST_SOURCE = `${EDUCATION}classrooms/ghost.json`;
const ROOM_204 = `${EDUCATION}classrooms/room-204`;
const BULLETIN_SOURCE = `${EDUCATION}bulletins/b1.json`;
const BROKEN_SOURCE = `${EDUCATION}classrooms/broken.json`;
const HANDBOOK = `${EDUCATION}public/handbook.pdf`;
const LOGO = `${EDUCATION}public/logo.png`;
const STYLES = `${EDUCATION}public/styles.css`;
const PRIVATE_HANDBOOK = `${EDUCATION}private/handbook.pdf`;
const NOTES_TXT = `${EDUCATION}public/notes.txt`;
const NOTES_PDF = `${EDUCATION}public/notes.pdf`;
const MODULE_SOURCE = `${EDUCATION}classroom.gts`;
// Paths that hold nothing, each named to the length of a path above that holds
// something, so a refusal of one and a refusal of the other differ in nothing
// but the name each repeats back.
const GONE_HANDBOOK = `${EDUCATION}public/gonebook.pdf`;
const GONE_LOGO = `${EDUCATION}public/gone.png`;
const GONE_BULLETIN_SOURCE = `${EDUCATION}bulletins/b9.json`;
const GONE_PRIVATE_HANDBOOK = `${EDUCATION}private/gonebook.pdf`;
const GONE_MODULE_SOURCE = `${EDUCATION}classless.gts`;

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let server: Server;
  let request: SuperTest<Test>;
  let realmsRootPath: string;

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
    realmsRootPath = join(dirSync().name, 'realm_server_1');
    let result = await runTestRealmServerWithRealms({
      virtualNetwork: createVirtualNetwork(),
      realmsRootPath,
      realms: [
        {
          realmURL: new URL(EDUCATION),
          fileSystem: {
            'realm.json': realmConfigCardJSON({
              name: 'Education',
              policy: `${ORG}policies/pdf`,
            }),
            'classroom.gts': CLASSROOM_MODULE,
            'bulletin.gts': BULLETIN_MODULE,
            'classrooms/room-204.json': card(
              { module: '../classroom', name: 'Classroom' },
              { title: 'Room 204', teacherIds: [TEACHER], announcements: [] },
            ),
            'bulletins/b1.json': card(
              { module: '../bulletin', name: 'Bulletin' },
              { body: 'Picture day is Friday' },
            ),
            // Adopts from a module that is not there, so the realm records an
            // error row for it rather than a type.
            'classrooms/broken.json': card(
              { module: '../not-a-module', name: 'Missing' },
              { title: 'Broken' },
            ),
            'public/handbook.pdf': '%PDF-1.4 the student handbook',
            'public/logo.png': 'PNG the school crest',
            'public/styles.css': '.crest { color: navy; }',
            // A `.json` that holds no card: a data file.
            'public/schedule.json': JSON.stringify({ periods: [1, 2, 3] }),
            'public/notes.txt': 'term notes',
            'private/handbook.pdf': '%PDF-1.4 the staff handbook',
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
            ...Object.fromEntries(
              Object.entries(POLICIES).map(([name, rules]) => [
                `policies/${name}.json`,
                policyCard(rules),
              ]),
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

  // Point the realm at one of the policies above.
  async function policy(name: keyof typeof POLICIES) {
    await education.write(
      'realm.json',
      realmConfigCardJSON({
        name: 'Education',
        policy: `${ORG}policies/${name}`,
      }),
    );
    await education.indexing();
  }

  // A stored-bytes read as a caller the realm ACL declined, which is the one
  // case the policy decides.
  function readSource(url: string, actor: string = TEACHER) {
    return runOperation(education.operationCore, {
      target: { kind: 'instance' as const, url },
      name: 'readSource',
      actor,
      clientRequestId: 'source-read-test',
      coarseDeclined: true,
    });
  }

  async function served(
    assert: Assert,
    url: string,
    label: string,
    actor: string = TEACHER,
  ) {
    try {
      let result = await readSource(url, actor);
      let contentType =
        result && 'contentType' in result ? result.contentType : undefined;
      assert.ok(contentType, `${label}: served, as ${contentType}`);
    } catch (e: unknown) {
      assert.ok(
        false,
        `${label}: expected the bytes, got ${
          isOperationFailure(e) ? e.error.detail : String(e)
        }`,
      );
    }
  }

  async function refused(
    assert: Assert,
    url: string,
    label: string,
    actor: string = TEACHER,
  ) {
    try {
      await readSource(url, actor);
      assert.ok(false, `${label}: expected a refusal, the bytes were served`);
    } catch (e: unknown) {
      assert.true(
        isOperationFailure(e) && e.error.code === 'operation-not-permitted',
        `${label}: refused as not permitted`,
      );
    }
  }

  function gateStats() {
    return education.__testOnlyPolicyGateStats();
  }

  // Put bytes on the Education realm's disk the way a write does before its
  // index job lands: the file watcher is off, so nothing indexes them.
  function storeUnindexed(localPath: string, content: string) {
    writeFileSync(join(realmsRootPath, 'realm_0', localPath), content);
  }

  function classroomSource(title: string) {
    return card(
      { module: '../classroom', name: 'Classroom' },
      { title, teacherIds: [TEACHER], announcements: [] },
    );
  }

  module('a data file is matched by the type its extension names', function () {
    test('a PdfDef grant does not cover an image', async function (assert) {
      await served(assert, HANDBOOK, 'a .pdf under a PdfDef grant');
      await refused(assert, LOGO, 'a .png under a PdfDef grant');
    });

    test('a FileDef grant covers both', async function (assert) {
      await policy('anyFile');
      await served(assert, HANDBOOK, 'a .pdf under a FileDef grant');
      await served(assert, LOGO, 'a .png under a FileDef grant');
    });

    test('a FileDef grant covers an extension no def is written for', async function (assert) {
      await policy('anyFile');
      await served(assert, STYLES, 'a .css resolves to FileDef itself');
    });

    test('a FileDef grant does not reach module source', async function (assert) {
      await policy('anyFile');
      await refused(assert, MODULE_SOURCE, 'a .gts under a FileDef grant');
    });

    test('renaming a file changes which rule matches it', async function (assert) {
      await refused(assert, NOTES_TXT, 'notes.txt under a PdfDef grant');
      // The same bytes, under a name that claims to be a PDF. Resolution is by
      // extension, so the claim is what the rule is matched against — which is
      // documented behavior rather than a gap, and is why a realm that
      // distinguishes file types is distinguishing what a writer named them.
      await education.write('public/notes.pdf', 'term notes');
      await education.indexing();
      await served(assert, NOTES_PDF, 'the same bytes named notes.pdf');
    });
  });

  module("a card's raw source is matched by the card's own type", function () {
    test('a grant on one card type does not cover another', async function (assert) {
      await policy('classroomSource');
      await served(assert, ROOM_204_SOURCE, "a Classroom's .json");
      await refused(assert, BULLETIN_SOURCE, "a Bulletin's .json");
    });

    test('a CardDef grant covers any card’s raw source', async function (assert) {
      await policy('anyCardSource');
      await served(assert, ROOM_204_SOURCE, "a Classroom's .json");
      await served(assert, BULLETIN_SOURCE, "a Bulletin's .json");
    });

    test('a card whose type does not resolve is not read as a data file', async function (assert) {
      // Its document is a card, so it is not a data file, and the type it
      // names is not there, so nothing matches it. Reading it as the file its
      // extension claims would make "any data file" mean "every broken card's
      // raw source".
      await policy('anyFile');
      await refused(
        assert,
        BROKEN_SOURCE,
        "a broken card's .json under a FileDef grant",
      );
      // The contrast that makes the refusal mean something: a `.json` that
      // holds no card is a data file, and the same grant serves it.
      await served(assert, SCHEDULE, 'a .json that holds no card');
    });

    test('a card’s .json is never matched as a JsonFileDef', async function (assert) {
      // A `FileDef` grant is every data file in the realm, and a card's stored
      // document is not one: it is matched by the card it holds.
      await policy('anyFile');
      await refused(assert, ROOM_204_SOURCE, "a Classroom's .json");
      await served(assert, HANDBOOK, 'a real data file, for contrast');
    });
  });

  module('the bytes served decide, not the index', function () {
    test('a card written but not yet indexed is not read as a data file', async function (assert) {
      storeUnindexed('classrooms/fresh.json', classroomSource('Fresh'));
      await policy('anyFile');
      await refused(assert, FRESH_SOURCE, 'a fresh card under a FileDef grant');
      await policy('classroomSource');
      await served(
        assert,
        FRESH_SOURCE,
        'the same fresh card under a Classroom grant',
      );
    });

    test('a replaced document is judged by the type it now names', async function (assert) {
      await policy('classroomSource');
      await refused(assert, BULLETIN_SOURCE, 'the Bulletin, as indexed');
      // The index row still says Bulletin; the bytes a read would serve are a
      // Classroom's.
      storeUnindexed('bulletins/b1.json', classroomSource('Rehomed'));
      await served(
        assert,
        BULLETIN_SOURCE,
        'the same path, now holding a Classroom',
      );
    });

    test('a path with nothing stored at it is refused like a card is', async function (assert) {
      // A grant on `FileDef` admits every data file, so an empty path it
      // admitted would answer "not found" while a card's answered "not
      // permitted" — which would say which cards exist.
      await policy('anyFile');
      await refused(assert, GHOST_PDF, 'a .pdf that is not there');
      await refused(assert, GHOST_SOURCE, 'a .json that is not there');
      await refused(assert, ROOM_204_SOURCE, "a card's .json, for comparison");
    });

    test('the path is judged as the executor will read it', async function (assert) {
      // An encoded dot is decoded to a local path, so this spelling reads
      // room-204's document. It is judged as that document, not as a file
      // with no extension.
      let encoded = `${EDUCATION}classrooms/room-204%2Ejson`;
      let core = education.operationCore;
      let scope = () =>
        newOperationScope(core, {
          caller: scopeCallerFor(TEACHER),
          coarseDeclined: 'all' as const,
        });
      await policy('anyFile');
      await assert.rejects(
        resolveGatedOperation(
          core,
          { kind: 'instance', url: encoded },
          'readSource',
          scope(),
        ),
        /operation-not-permitted/,
        'a FileDef grant does not reach the card through an encoded spelling',
      );
      await policy('classroomSource');
      let granted = await resolveGatedOperation(
        core,
        { kind: 'instance', url: encoded },
        'readSource',
        scope(),
      );
      assert.strictEqual(
        granted.decision.kind,
        'granted',
        'the Classroom grant does',
      );
      // A query string names nothing on disk, so it does not change what the
      // bytes are.
      await policy('anyFile');
      await assert.rejects(
        resolveGatedOperation(
          core,
          { kind: 'instance', url: `${ROOM_204_SOURCE}?x=1` },
          'readSource',
          scope(),
        ),
        /operation-not-permitted/,
        "a query string does not make a card's .json a data file",
      );
      // Nor what a path predicate sees of the path.
      await policy('pathPredicate');
      await assert.rejects(
        resolveGatedOperation(
          core,
          {
            kind: 'instance',
            url: `${PRIVATE_HANDBOOK}?p=/public/handbook.pdf`,
          },
          'readSource',
          scope(),
        ),
        /operation-not-permitted/,
        'a query string does not satisfy a predicate on the path',
      );
    });
  });

  module('what a predicate may read', function () {
    test('a data-file predicate reads instance() and actor()', async function (assert) {
      await policy('pathPredicate');
      await served(assert, HANDBOOK, 'a .pdf whose path the predicate admits');
      await refused(
        assert,
        PRIVATE_HANDBOOK,
        'the same file type outside the admitted path',
      );
      await refused(
        assert,
        HANDBOOK,
        'the admitted path, read by a caller the predicate does not name',
        '@colleague:localhost',
      );
    });

    test('a data-file predicate cannot reach a document', async function (assert) {
      await policy('documentPredicate');
      // The same predicate source on both rules. The card has the field it
      // reads, so the grant on the card holds.
      await served(assert, ROOM_204_SOURCE, 'the card whose document has it');
      await refused(assert, HANDBOOK, 'the data file, which has no document');
    });
  });

  module('the gate keys on the invoked operation', function () {
    test('appendContainsMany authorizes as itself, not as readSource', async function (assert) {
      await policy('classroomSource');
      let core = education.operationCore;
      let scope = () =>
        newOperationScope(core, {
          caller: scopeCallerFor(TEACHER),
          coarseDeclined: 'all' as const,
        });
      await assert.rejects(
        resolveGatedOperation(
          core,
          { kind: 'instance', url: ROOM_204 },
          'appendContainsMany',
          scope(),
        ),
        /operation-not-permitted/,
        'a readSource grant does not admit the instance operation',
      );
      await policy('appendOnly');
      let appended = await resolveGatedOperation(
        core,
        { kind: 'instance', url: ROOM_204 },
        'appendContainsMany',
        scope(),
      );
      assert.strictEqual(
        appended.decision.kind,
        'granted',
        'its own grant admits it',
      );
      await refused(
        assert,
        ROOM_204_SOURCE,
        'and does not admit a stored-bytes read',
      );
    });
  });

  module('what typing the target costs', function () {
    test('a caller the realm ACL allows pays nothing to read bytes', async function (assert) {
      let result = await runOperation(education.operationCore, {
        target: { kind: 'instance' as const, url: HANDBOOK },
        name: 'readSource',
        actor: ADMIN,
        clientRequestId: 'source-read-test',
      });
      assert.true(
        Boolean(result && 'contentType' in result),
        'the admin reads the bytes',
      );
      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 0,
          predicateEvaluations: 0,
          pendingDischarges: 0,
          definitionLookups: 0,
        },
        'no policy load, no predicate, and no definition lookup',
      );
    });

    test('a card’s raw source costs one definition lookup', async function (assert) {
      await policy('classroomSource');
      await served(assert, ROOM_204_SOURCE, "a Classroom's .json");
      assert.strictEqual(
        gateStats().definitionLookups,
        1,
        'the type its document names, the lookup the read had skipped',
      );
    });

    test('a predicate on card source is projected through that same lookup', async function (assert) {
      await policy('documentPredicate');
      await served(assert, ROOM_204_SOURCE, "a Classroom's .json");
      assert.strictEqual(
        gateStats().predicateEvaluations,
        1,
        'one predicate evaluated',
      );
      assert.strictEqual(
        gateStats().definitionLookups,
        1,
        'and no second lookup to project it',
      );
    });

    test('a data file costs one definition lookup', async function (assert) {
      await served(assert, HANDBOOK, 'a .pdf under a PdfDef grant');
      assert.strictEqual(
        gateStats().definitionLookups,
        1,
        'the chain of the FileDef its extension names',
      );
    });

    test('a realm with no policy reads no definition for a declined read', async function (assert) {
      await education.write(
        'realm.json',
        realmConfigCardJSON({ name: 'Education' }),
      );
      await education.indexing();
      await refused(assert, HANDBOOK, 'a .pdf in a realm with no policy');
      await refused(assert, ROOM_204_SOURCE, "a card's .json, likewise");
      assert.strictEqual(
        gateStats().definitionLookups,
        0,
        'nothing was typed, since there was no policy to match it against',
      );
    });
  });

  module('the routes that serve bytes', function () {
    // The card+source read, and the realm's fallback file serve, which answers
    // an `Accept` no route claims. Both serve a path's stored bytes, so a grant
    // that admits the read is honored on both.
    const BYTE_ROUTES = [
      { label: 'card+source', accept: SupportedMimeType.CardSource },
      { label: 'the file serve', accept: '*/*' },
    ];

    function bearer(
      user: string,
      permissions: Parameters<typeof createJWT>[2] = [],
    ) {
      return `Bearer ${createJWT(education, user, permissions)}`;
    }

    const AS = {
      reader: () => bearer(READER, ['read']),
      teacher: () => bearer(TEACHER),
      colleague: () => bearer('@colleague:localhost'),
    };

    // Collect the raw bytes rather than letting supertest pick a text or JSON
    // parser from the content type.
    function binaryParser(
      res: unknown,
      callback: (err: Error | null, body: Buffer) => void,
    ) {
      let stream = res as NodeJS.ReadableStream;
      let chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => callback(null, Buffer.concat(chunks)));
    }

    function send(
      method: 'get' | 'head',
      url: string,
      accept: string,
      auth?: string,
      headers: Record<string, string> = {},
    ) {
      let { pathname, search } = new URL(url);
      let req = request[method](`${pathname}${search}`).set('Accept', accept);
      for (let [name, value] of Object.entries(headers)) {
        req = req.set(name, value);
      }
      if (auth) {
        req = req.set('Authorization', auth);
      }
      return req.buffer(true).parse(binaryParser);
    }

    function get(
      url: string,
      accept: string,
      auth?: string,
      headers?: Record<string, string>,
    ) {
      return send('get', url, accept, auth, headers);
    }

    function head(url: string, accept: string, auth?: string) {
      return send('head', url, accept, auth);
    }

    function textOf(response: Response) {
      return Buffer.isBuffer(response.body) ? response.body.toString() : '';
    }

    // Every header but the date, which differs between any two responses.
    function headersOf(response: Response) {
      return Object.entries(response.headers as Record<string, string>)
        .filter(([name]) => name !== 'date')
        .sort(([a], [b]) => a.localeCompare(b));
    }

    // The two answers are the same one: status, every header, and a body that
    // differs only in the path it repeats back.
    function assertSameAnswer(
      assert: Assert,
      actual: Response,
      expected: Response,
      names: { actual: string; expected: string },
      label: string,
    ) {
      assert.strictEqual(actual.status, expected.status, `${label}: status`);
      assert.deepEqual(
        headersOf(actual),
        headersOf(expected),
        `${label}: headers`,
      );
      assert.strictEqual(
        textOf(actual).replaceAll(names.actual, names.expected),
        textOf(expected),
        `${label}: body`,
      );
    }

    function nameOf(url: string) {
      return new URL(url).pathname;
    }

    test('a PdfDef grant serves a .pdf and refuses a .png', async function (assert) {
      for (let { label, accept } of BYTE_ROUTES) {
        let pdf = await get(HANDBOOK, accept, AS.teacher());
        assert.strictEqual(pdf.status, 200, `${label}: the .pdf is served`);
        assert.strictEqual(
          textOf(pdf),
          '%PDF-1.4 the student handbook',
          `${label}: its stored bytes`,
        );
        assert.strictEqual(
          pdf.get('content-type'),
          'application/pdf',
          `${label}: as the type its name says`,
        );
        let png = await get(LOGO, accept, AS.teacher());
        assert.strictEqual(png.status, 404, `${label}: the .png is not there`);
        assertSameAnswer(
          assert,
          png,
          await get(GONE_LOGO, accept, AS.teacher()),
          { actual: nameOf(LOGO), expected: nameOf(GONE_LOGO) },
          `${label}: the .png is refused as a missing file is`,
        );
      }
    });

    test('a FileDef grant serves both and still refuses module source', async function (assert) {
      await policy('anyFile');
      for (let { label, accept } of BYTE_ROUTES) {
        for (let url of [HANDBOOK, LOGO]) {
          let served = await get(url, accept, AS.teacher());
          assert.strictEqual(served.status, 200, `${label}: ${nameOf(url)}`);
        }
      }
      let loads = gateStats().policyLoads;
      let source = await get(
        MODULE_SOURCE,
        SupportedMimeType.CardSource,
        AS.teacher(),
      );
      assert.strictEqual(source.status, 404, 'module source is not there');
      assertSameAnswer(
        assert,
        source,
        await get(
          GONE_MODULE_SOURCE,
          SupportedMimeType.CardSource,
          AS.teacher(),
        ),
        { actual: nameOf(MODULE_SOURCE), expected: nameOf(GONE_MODULE_SOURCE) },
        'module source is refused as a missing module is',
      );
      let module = await get(`${EDUCATION}classroom`, '*/*', AS.teacher());
      assert.strictEqual(module.status, 404, 'nor is the transpiled module');
      let fallback = await get(
        `${EDUCATION}classroom`,
        SupportedMimeType.CardSource,
        AS.teacher(),
      );
      assert.strictEqual(
        fallback.status,
        404,
        'nor the module an extension-less card+source read would redirect to',
      );
      assert.strictEqual(
        gateStats().policyLoads,
        loads,
        'none of which reaches the gate',
      );
    });

    test("a card-type grant serves that card's .json and refuses another type's", async function (assert) {
      await policy('classroomSource');
      for (let { label, accept } of BYTE_ROUTES) {
        let classroom = await get(ROOM_204_SOURCE, accept, AS.teacher());
        assert.strictEqual(classroom.status, 200, `${label}: the Classroom`);
        assert.strictEqual(
          JSON.parse(textOf(classroom)).data.attributes.title,
          'Room 204',
          `${label}: its stored document`,
        );
        let bulletin = await get(BULLETIN_SOURCE, accept, AS.teacher());
        assert.strictEqual(bulletin.status, 404, `${label}: not the Bulletin`);
        assertSameAnswer(
          assert,
          bulletin,
          await get(GONE_BULLETIN_SOURCE, accept, AS.teacher()),
          {
            actual: nameOf(BULLETIN_SOURCE),
            expected: nameOf(GONE_BULLETIN_SOURCE),
          },
          `${label}: the Bulletin is refused as a missing card is`,
        );
      }
    });

    test('a caller the realm ACL declined is not redirected to what a name resolves to', async function (assert) {
      await policy('classroomSource');
      let reader = await get(
        ROOM_204,
        SupportedMimeType.CardSource,
        AS.reader(),
      );
      assert.strictEqual(reader.status, 302, 'a reader is sent to the .json');
      let teacher = await get(
        ROOM_204,
        SupportedMimeType.CardSource,
        AS.teacher(),
      );
      assert.strictEqual(
        teacher.status,
        404,
        'the teacher, whose grant reaches that .json, reads it by its own name',
      );
    });

    test('a HEAD answers as the GET does', async function (assert) {
      for (let { label, accept } of BYTE_ROUTES) {
        let refused = await head(LOGO, accept, AS.teacher());
        let missing = await head(GONE_LOGO, accept, AS.teacher());
        assert.strictEqual(
          refused.status,
          200,
          `${label}: a file no grant admits gets the discovery answer`,
        );
        assert.notOk(refused.get('etag'), `${label}: with no validator`);
        assert.deepEqual(
          headersOf(refused),
          headersOf(missing),
          `${label}: identical to a HEAD of a path that holds nothing`,
        );
        let granted = await head(HANDBOOK, accept, AS.teacher());
        assert.ok(granted.get('etag'), `${label}: a granted file's validator`);
        assert.deepEqual(
          headersOf(granted),
          headersOf(await head(HANDBOOK, accept, AS.reader())),
          `${label}: the headers a reader's HEAD gets`,
        );
      }
    });

    test('a grant serves the bytes as a reader gets them', async function (assert) {
      for (let { label, accept } of BYTE_ROUTES) {
        let granted = await get(HANDBOOK, accept, AS.teacher());
        let reader = await get(HANDBOOK, accept, AS.reader());
        assert.strictEqual(textOf(granted), textOf(reader), `${label}: body`);
        assert.deepEqual(
          headersOf(granted),
          headersOf(reader),
          `${label}: headers`,
        );
      }
      await policy('classroomSource');
      // Read first by a reader, so the card+source read holds it in its
      // source cache.
      let reader = await get(
        ROOM_204_SOURCE,
        SupportedMimeType.CardSource,
        AS.reader(),
      );
      let granted = await get(
        ROOM_204_SOURCE,
        SupportedMimeType.CardSource,
        AS.teacher(),
      );
      assert.strictEqual(textOf(granted), textOf(reader), "a card's .json");
      for (let name of ['etag', 'last-modified', 'content-type', 'x-created']) {
        assert.strictEqual(
          granted.get(name),
          reader.get(name),
          `a card's .json: ${name}`,
        );
      }
    });

    test('a grant-admitted response is private', async function (assert) {
      for (let { label, accept } of BYTE_ROUTES) {
        let response = await get(HANDBOOK, accept, AS.teacher());
        assert.strictEqual(response.status, 200, `${label}: served`);
        assert.true(
          /^private\b/.test(response.get('cache-control') ?? ''),
          `${label}: with a private cache policy (${response.get('cache-control')})`,
        );
      }
    });

    test('a validator is honored only once the gate admits the read', async function (assert) {
      for (let { label, accept } of BYTE_ROUTES) {
        await policy('pdf');
        let etag = (await get(HANDBOOK, accept, AS.reader())).get('etag');
        assert.ok(etag, `${label}: the reader's validator`);
        let conditional = { 'If-None-Match': etag! };
        let admitted = await get(HANDBOOK, accept, AS.teacher(), conditional);
        assert.strictEqual(
          admitted.status,
          304,
          `${label}: it matches for a caller a grant admits`,
        );
        await policy('classroomSource');
        let refused = await get(HANDBOOK, accept, AS.teacher(), conditional);
        assert.strictEqual(
          refused.status,
          404,
          `${label}: and not once the grant is gone`,
        );
        assertSameAnswer(
          assert,
          refused,
          await get(GONE_HANDBOOK, accept, AS.teacher(), conditional),
          { actual: nameOf(HANDBOOK), expected: nameOf(GONE_HANDBOOK) },
          `${label}: which is the answer for a path that holds nothing`,
        );
      }
      // A card's `.json` is kept in the card+source read's source cache once a
      // reader has read it, and the cache answers nobody the gate refused.
      await policy('pdf');
      await get(ROOM_204_SOURCE, SupportedMimeType.CardSource, AS.reader());
      let cached = await get(
        ROOM_204_SOURCE,
        SupportedMimeType.CardSource,
        AS.teacher(),
      );
      assert.strictEqual(
        cached.status,
        404,
        "a card's .json a reader's read left in the source cache",
      );
      assertSameAnswer(
        assert,
        cached,
        await get(
          `${EDUCATION}classrooms/room-999.json`,
          SupportedMimeType.CardSource,
          AS.teacher(),
        ),
        {
          actual: nameOf(ROOM_204_SOURCE),
          expected: nameOf(`${EDUCATION}classrooms/room-999.json`),
        },
        "is refused as a missing card's is",
      );
    });

    test('a file predicate sees the path and the caller', async function (assert) {
      await policy('pathPredicate');
      for (let { label, accept } of BYTE_ROUTES) {
        assert.strictEqual(
          (await get(HANDBOOK, accept, AS.teacher())).status,
          200,
          `${label}: the path the predicate admits`,
        );
        let elsewhere = await get(PRIVATE_HANDBOOK, accept, AS.teacher());
        assertSameAnswer(
          assert,
          elsewhere,
          await get(GONE_PRIVATE_HANDBOOK, accept, AS.teacher()),
          {
            actual: nameOf(PRIVATE_HANDBOOK),
            expected: nameOf(GONE_PRIVATE_HANDBOOK),
          },
          `${label}: another path is not there`,
        );
        assert.strictEqual(
          (
            await get(
              `${PRIVATE_HANDBOOK}?p=/public/handbook.pdf`,
              accept,
              AS.teacher(),
            )
          ).status,
          404,
          `${label}: however the query string spells the admitted path`,
        );
        assert.strictEqual(
          (await get(HANDBOOK, accept, AS.colleague())).status,
          404,
          `${label}: nor is the admitted path for a caller the predicate does not name`,
        );
      }
    });

    test("a reader's reads do not reach the gate", async function (assert) {
      for (let { label, accept } of BYTE_ROUTES) {
        for (let url of [HANDBOOK, LOGO, ROOM_204_SOURCE]) {
          let response = await get(url, accept, AS.reader());
          assert.strictEqual(response.status, 200, `${label}: ${nameOf(url)}`);
          let etag = response.get('etag');
          assert.ok(etag, `${label}: ${nameOf(url)} carries a validator`);
          assert.strictEqual(
            (await get(url, accept, AS.reader(), { 'If-None-Match': etag! }))
              .status,
            304,
            `${label}: ${nameOf(url)} revalidates`,
          );
          assert.strictEqual(
            (await head(url, accept, AS.reader())).get('etag'),
            etag,
            `${label}: ${nameOf(url)} has the same validator on a HEAD`,
          );
        }
      }
      assert.strictEqual(
        (await get(MODULE_SOURCE, SupportedMimeType.CardSource, AS.reader()))
          .status,
        200,
        'module source',
      );
      assert.strictEqual(
        (await get(`${EDUCATION}classroom`, '*/*', AS.reader())).status,
        200,
        'the transpiled module',
      );
      assert.deepEqual(
        gateStats(),
        {
          policyLoads: 0,
          predicateEvaluations: 0,
          pendingDischarges: 0,
          definitionLookups: 0,
        },
        'no policy load, no predicate, and no definition lookup',
      );
    });

    test('a caller who authenticated nobody is asked to', async function (assert) {
      for (let { label, accept } of BYTE_ROUTES) {
        assert.strictEqual(
          (await get(HANDBOOK, accept)).status,
          401,
          `${label}: a file a grant would admit`,
        );
        assert.strictEqual(
          (await get(GONE_HANDBOOK, accept)).status,
          401,
          `${label}: a path that holds nothing`,
        );
      }
    });
  });
});
