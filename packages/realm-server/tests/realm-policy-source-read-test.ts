import QUnit from 'qunit';
const { module, test } = QUnit;
import { writeFileSync } from 'fs';
import { basename, join } from 'path';
import { dirSync } from 'tmp';
import { rri } from '@cardstack/runtime-common';
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
// `.json` by the card's own type. These tests drive the operation directly,
// since that typing happens in the gate whichever route a read arrives by.
const EDUCATION = 'http://127.0.0.1:4444/education/';
const ORG = 'http://127.0.0.1:4444/org/';
const ADMIN = '@education-admin:localhost';
const ORG_ADMIN = '@org-admin:localhost';
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

module(basename(import.meta.filename), function (hooks) {
  let education: Realm;
  let org: Realm;
  let server: Server;
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
});
