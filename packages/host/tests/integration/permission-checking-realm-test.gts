import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  CardContextName,
  OperationsError,
  ri,
  rri,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';
import { isCardErrorJSONAPI } from '@cardstack/runtime-common/error';
import type { Loader } from '@cardstack/runtime-common/loader';

import OperatorMode from '@cardstack/host/components/operator-mode/container';
import type CapabilitiesService from '@cardstack/host/services/capabilities';
import InvokeCardOperationTool from '@cardstack/host/tools/invoke-card-operation';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  provideConsumeContext,
  realmConfigCardJSON,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  settleRealmRenders,
  setupOperatorModeStateCleanup,
  testRealmURL,
} from '../helpers';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard, renderComponent } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';

import type { TestRealmAdapter } from '../helpers/adapter';

import type { CardContext, CardDef } from '@cardstack/base/card-api';
import type * as OperationsModule from '@cardstack/base/operations';

// A realm that judges the host's requests by its ACL, as a deployed realm
// does, so what a card shows and what an invocation is answered come from the
// realm's own decision for the signed-in user.
//
// The school realm's ACL gives the test user nothing, and its policy lets any
// signed-in caller read a classroom and rename one they teach. The classroom
// definition lives in a realm anyone may read, which is where a caller the
// school's ACL declines loads it from: no grant reaches a module's source.

const SCHOOL = testRealmURL;
const DEFINITIONS = 'http://test-realm/classroom-definitions/';
const TEST_USER = '@testuser:localhost';
const COLLEAGUE = '@colleague:localhost';
const SCHOOL_ADMIN = '@school-admin:localhost';

const ROOM_204 = `${SCHOOL}classrooms/room-204`;
const SCHOOL_ICON = 'https://boxel-images.boxel.ai/icons/Letter-s.png';
const ROOM_205 = `${SCHOOL}classrooms/room-205`;

// Is the caller one of the classroom's teachers.
const TEACHES = '.teacherIds | any(. == actor())';

// The control's three states are told apart, so a hidden control is the
// realm's `false` rather than an answer that never arrived.
const CLASSROOM_MODULE = `
  import { on } from '@ember/modifier';
  import { tracked } from '@glimmer/tracking';
  import {
    contains,
    containsMany,
    field,
    CardDef,
    Component,
  } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import {
    actor,
    operation,
    operations,
    params,
  } from '@cardstack/base/operations';

  export class Classroom extends CardDef {
    @field title = contains(StringField);
    @field teacherIds = containsMany(StringField);

    @operation static rename = {
      base: 'transform',
      params: { title: StringField },
      set: { title: params('title') },
    };

    static isolated = class Isolated extends Component<typeof this> {
      @tracked renamed = false;
      get mayRename() {
        let answer = this.args.context?.canInvoke?.('rename', this.args.model);
        return answer === undefined ? 'unknown' : answer ? 'yes' : 'no';
      }
      get showRename() {
        return this.mayRename === 'yes';
      }
      rename = async () => {
        await operations(this.args.model).rename({ title: 'Renamed' });
        this.renamed = true;
      };
      <template>
        <h1 data-test-classroom-title>{{@model.title}}</h1>
        <span data-test-may-rename={{this.mayRename}}>{{this.mayRename}}</span>
        {{#if this.showRename}}
          <button data-test-rename {{on 'click' this.rename}}>Rename</button>
        {{/if}}
        {{#if this.renamed}}<span data-test-renamed>Renamed</span>{{/if}}
      </template>
    };
  }

  // A student's place in a course. A school starts with none, so enrolling
  // is reached through the type: there is no enrollment to reach it through.
  export class Enrollment extends CardDef {
    @field course = contains(StringField);
    @field studentId = contains(StringField);

    @operation static enroll = {
      base: 'create',
      of: () => Enrollment,
      params: { course: StringField },
      fill: { course: params('course'), studentId: actor() },
    };
  }
`;

const REALM_POLICY = {
  module: rri('@cardstack/catalog/realm-policy/realm-policy'),
  name: 'RealmPolicy',
};

const classroomPolicy: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Classrooms' },
      rules: [
        {
          targetType: { module: `${DEFINITIONS}classroom`, name: 'Classroom' },
          grants: [
            { operation: 'read' },
            { operation: 'rename', where: TEACHES },
          ],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
};

// Lets any signed-in caller enroll themselves and read an enrollment. The
// plain create is not granted, so the declared one is the only way a caller
// the ACL declines makes an enrollment.
const enrollmentPolicy: LooseSingleCardDocument = {
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Enrollments' },
      rules: [
        {
          targetType: { module: `${DEFINITIONS}classroom`, name: 'Enrollment' },
          grants: [{ operation: 'read' }, { operation: 'enroll' }],
        },
      ],
    },
    meta: { adoptsFrom: REALM_POLICY },
  },
};

function classroom(title: string, teacherIds: string[]) {
  return {
    data: {
      type: 'card',
      attributes: { title, teacherIds },
      meta: {
        adoptsFrom: { module: `${DEFINITIONS}classroom`, name: 'Classroom' },
      },
    },
  };
}

module('Integration | a realm that checks permissions', function (hooks) {
  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  let operations: (typeof OperationsModule)['operations'];
  let hostTransport: unknown;

  let noop = () => {};

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: TEST_USER,
    activeRealms: [DEFINITIONS, SCHOOL],
    autostart: true,
  });

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
    hostTransport = (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT;
  });

  hooks.afterEach(function () {
    (globalThis as any)._CARDSTACK_OPERATIONS_TRANSPORT = hostTransport;
  });

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  async function setupSchool({
    enforcePermissions,
    readableByTestUser,
    policy = classroomPolicy,
  }: {
    enforcePermissions?: true;
    // Gives the test user read on the school realm, and nothing more.
    readableByTestUser?: true;
    // The policy card the school names, or null for a school that names none.
    policy?: LooseSingleCardDocument | null;
  }): Promise<TestRealmAdapter> {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: DEFINITIONS,
      permissions: { '*': ['read'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Classroom definitions' }),
        'classroom.gts': CLASSROOM_MODULE,
      },
    });
    let { adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: SCHOOL,
      enforcePermissions,
      permissions: {
        [SCHOOL_ADMIN]: ['read', 'write', 'realm-owner'],
        ...(readableByTestUser ? { [TEST_USER]: ['read'] } : {}),
      },
      contents: {
        'realm.json': realmConfigCardJSON({
          name: 'School',
          iconURL: SCHOOL_ICON,
          ...(policy ? { policy: `${SCHOOL}policies/classrooms` } : {}),
        }),
        'classrooms/room-204.json': classroom('Room 204', [TEST_USER]),
        'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
        ...(policy ? { 'policies/classrooms.json': policy } : {}),
      },
    });
    // Imported through the loader the realm's instances were built by, since
    // `operations()` asks what a card is an instance of.
    ({ operations } = await loader.import<typeof OperationsModule>(
      '@cardstack/base/operations',
    ));
    await getService('realm').login(SCHOOL);
    // Looking the service up arms the transport a card's `operations()` call
    // sends its batch through.
    getService('operations');
    let capabilities = getService(
      'capabilities',
    ) as unknown as CapabilitiesService;
    // The one member of a card's context the classroom reads.
    provideConsumeContext(CardContextName, {
      canInvoke: capabilities.canInvoke,
    } as unknown as CardContext);
    return adapter;
  }

  async function classroomAt(id: string): Promise<CardDef> {
    let card = await getService('store').get(id);
    if (!card || isCardErrorJSONAPI(card)) {
      throw new Error(`expected ${id} to load, got ${JSON.stringify(card)}`);
    }
    return card as CardDef;
  }

  async function renderClassroom(id: string) {
    await renderCard(loader, await classroomAt(id), 'isolated');
    await waitFor('[data-test-may-rename="yes"], [data-test-may-rename="no"]');
  }

  async function storedTitle(adapter: TestRealmAdapter, localPath: string) {
    let file = await adapter.openFile(localPath);
    return JSON.parse(file!.content as string).data.attributes.title;
  }

  test('a user the policy admits opens a classroom in the host, and its header shows the realm', async function (assert) {
    await setupSchool({ enforcePermissions: true });
    // Sign in again as the host does on its first contact with a realm,
    // holding nothing for it yet: no session, and no realm info.
    let realmService = getService('realm');
    realmService.removeRealm(SCHOOL);
    await realmService.login(SCHOOL);
    assert.false(
      realmService.canRead(SCHOOL),
      'the school realm’s ACL gives the test user nothing',
    );
    assert.strictEqual(
      realmService.info(SCHOOL).name,
      'School',
      'and the realm’s info is loaded',
    );

    getService('operator-mode-state-service').restore({
      stacks: [[{ id: ROOM_204, format: 'isolated' }]],
    });
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    await waitFor(`[data-test-stack-card="${ROOM_204}"]`);
    assert
      .dom(`[data-test-stack-card="${ROOM_204}"] [data-test-classroom-title]`)
      .hasText('Room 204', 'the classroom the policy grants renders');
    assert
      .dom(
        `[data-test-stack-card-header] [data-test-card-header-realm-icon="${SCHOOL_ICON}"]`,
      )
      .exists('with the realm’s icon in its header');
  });

  test('the AI context tells a user who can only read the realm what its policy grants', async function (assert) {
    await setupSchool({ enforcePermissions: true, readableByTestUser: true });
    let realmService = getService('realm');
    assert.true(realmService.canRead(SCHOOL), 'the test user reads the school');
    assert.false(realmService.canWrite(SCHOOL), 'and cannot write it');

    let operatorModeState = getService('operator-mode-state-service');
    operatorModeState.restore({
      stacks: [[{ id: ROOM_204, format: 'isolated' }]],
    });
    let context = await operatorModeState.getSummaryForAIBot();
    assert.strictEqual(context.realmUrl, SCHOOL, 'the user is in the school');
    assert.deepEqual(
      context.realmPolicy,
      {
        card: rri(`${SCHOOL}policies/classrooms`),
        rules: [
          {
            targetType: {
              module: rri(`${DEFINITIONS}classroom`),
              name: 'Classroom',
            },
            grants: [
              { operation: 'read' },
              { operation: 'rename', where: TEACHES },
            ],
          },
        ],
      },
      'the context carries the rules of the policy the school names',
    );
  });

  test('the AI context names a policy whose rules are too large to carry, without them', async function (assert) {
    // About 24 KB of grants, past what the context may carry with them.
    let grants = Array.from({ length: 400 }, () => ({
      operation: 'rename',
      where: TEACHES,
    }));
    await setupSchool({
      enforcePermissions: true,
      readableByTestUser: true,
      policy: {
        data: {
          ...classroomPolicy.data,
          attributes: {
            cardInfo: { name: 'Classrooms' },
            rules: [
              {
                targetType: {
                  module: `${DEFINITIONS}classroom`,
                  name: 'Classroom',
                },
                grants,
              },
            ],
          },
        },
      },
    });

    let operatorModeState = getService('operator-mode-state-service');
    operatorModeState.restore({
      stacks: [[{ id: ROOM_204, format: 'isolated' }]],
    });
    let context = await operatorModeState.getSummaryForAIBot();
    assert.deepEqual(
      context.realmPolicy,
      { card: rri(`${SCHOOL}policies/classrooms`), tooLarge: true },
      'the policy is named, and its rules are left out',
    );
  });

  test('the AI context tells a user the realm admits only through its policy that a policy judges them', async function (assert) {
    await setupSchool({ enforcePermissions: true });
    // The host asked the school for its info during setup's renders, which
    // the school answers as its own requests, without asking who sent them.
    // So the host signs in to it afresh, and the school decides whether to
    // answer: one whose policy judges the user does.
    let realmService = getService('realm');
    realmService.removeRealm(SCHOOL);
    await realmService.reauthenticate(SCHOOL);
    assert.true(
      realmService.isInfoLoaded(ri(SCHOOL)),
      'the school answered the user its info',
    );

    let operatorModeState = getService('operator-mode-state-service');
    operatorModeState.restore({
      stacks: [[{ id: ROOM_204, format: 'isolated' }]],
    });
    let context = await operatorModeState.getSummaryForAIBot();
    assert.strictEqual(context.realmUrl, SCHOOL, 'the user is in the school');
    assert.deepEqual(
      context.realmPermissions,
      { canRead: false, canWrite: false },
      'the school’s permissions give the user nothing',
    );
    assert.deepEqual(
      context.realmPolicy,
      {},
      'and the context says a policy judges them, though not which',
    );
  });

  test('the AI context names no policy for a user a realm without one does not let read', async function (assert) {
    await setupSchool({ enforcePermissions: true, policy: null });
    // As in the test above, the host signs in to the school afresh, so the
    // school decides whether to answer its info. A realm with no policy
    // answers it only to a caller its permissions let read.
    let realmService = getService('realm');
    realmService.removeRealm(SCHOOL);
    await assert.rejects(
      realmService.reauthenticate(SCHOOL),
      /Failed to fetch realm info/,
      'the school refused the user its info',
    );

    let operatorModeState = getService('operator-mode-state-service');
    operatorModeState.restore({
      stacks: [[{ id: ROOM_204, format: 'isolated' }]],
    });
    let context = await operatorModeState.getSummaryForAIBot();
    assert.strictEqual(context.realmUrl, SCHOOL, 'the user is in the school');
    assert.false(
      realmService.isInfoLoaded(ri(SCHOOL)),
      'the host still holds no info for the school',
    );
    assert.strictEqual(
      context.realmPolicy,
      undefined,
      'and the context claims no policy',
    );
  });

  test('a sign-in that fails is reported, and the next one tries again', async function (assert) {
    // A realm with no policy whose ACL gives the test user nothing: its
    // `_info` refuses them, so signing in to it fails.
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: SCHOOL,
      enforcePermissions: true,
      permissions: { [SCHOOL_ADMIN]: ['read', 'write', 'realm-owner'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'School' }),
      },
    });
    let infoRequests = 0;
    getService('network').virtualNetwork.mount(
      async (request: Request) => {
        if (request.url === `${SCHOOL}_info`) {
          infoRequests++;
        }
        return null;
      },
      { prepend: true },
    );
    // A realm the host holds nothing for yet, so signing in fetches its info.
    let realmService = getService('realm');
    realmService.removeRealm(SCHOOL);

    let [first, joined] = [
      realmService.reauthenticate(SCHOOL),
      realmService.reauthenticate(SCHOOL),
    ];
    for (let [label, attempt] of [
      ['the sign-in', first],
      ['a caller that joined it', joined],
    ] as const) {
      await assert.rejects(
        attempt,
        /Failed to fetch realm info/,
        `${label} is told it failed`,
      );
    }
    assert.strictEqual(infoRequests, 1, 'the two callers shared one sign-in');

    await assert.rejects(
      realmService.reauthenticate(SCHOOL),
      /Failed to fetch realm info/,
      'the next sign-in fails on its own account',
    );
    assert.strictEqual(
      infoRequests,
      2,
      'rather than waiting on the one that failed',
    );
  });

  test("a control gated on canInvoke shows on the card the policy's predicate admits, and not on one it does not", async function (assert) {
    await setupSchool({ enforcePermissions: true });

    await renderClassroom(ROOM_204);
    assert
      .dom('[data-test-classroom-title]')
      .hasText('Room 204', 'the policy lets the test user read the classroom');
    assert
      .dom('[data-test-may-rename]')
      .hasText('yes', 'the realm admits renaming a classroom the user teaches');
    assert.dom('[data-test-rename]').exists();

    await renderClassroom(ROOM_205);
    assert
      .dom('[data-test-classroom-title]')
      .hasText('Room 205', 'the policy lets them read a colleague’s too');
    assert
      .dom('[data-test-may-rename]')
      .hasText('no', 'and refuses renaming a classroom they do not teach');
    assert.dom('[data-test-rename]').doesNotExist();
  });

  test('invoking the operation is admitted where the predicate holds, and refused as not there where it does not', async function (assert) {
    let adapter = await setupSchool({ enforcePermissions: true });

    await renderClassroom(ROOM_204);
    await click('[data-test-rename]');
    await waitFor('[data-test-renamed]');
    assert.strictEqual(
      await storedTitle(adapter, 'classrooms/room-204.json'),
      'Renamed',
      'the rename the control offered lands',
    );
    // The realm renders what the rename changed after answering it, and the
    // next question waits for that (see `settleRealmRenders`).
    await settleRealmRenders();

    let refusal: unknown;
    try {
      await (operations(await classroomAt(ROOM_205)) as any).rename({
        title: 'Renamed',
      });
    } catch (e) {
      refusal = e;
    }
    assert.true(
      refusal instanceof OperationsError,
      `the rename the control hid is refused: ${String(refusal)}`,
    );
    let { status, code, detail } = refusal as OperationsError;
    assert.deepEqual(
      { status, code, detail },
      { status: 404, code: 'target-not-found', detail: 'no such target' },
      'as a caller who may not read the realm is refused: told nothing is there',
    );
    assert.strictEqual(
      await storedTitle(adapter, 'classrooms/room-205.json'),
      'Room 205',
      'and nothing was written',
    );
  });

  test('a Realm Runner script asks the realm which classrooms the policy lets the user rename, and renames none', async function (assert) {
    let adapter = await setupSchool({
      enforcePermissions: true,
      readableByTestUser: true,
    });

    let toolService = getService('tool-service');
    let result = await new RunRealmCodeTool(toolService.toolContext).execute({
      realm: SCHOOL,
      roomId: '!room:example.com',
      code: `return await realm.operations.capabilities([
  { path: 'classrooms/room-204', operation: 'rename' },
  { path: 'classrooms/room-205', operation: 'rename' },
  { type: { module: ${JSON.stringify(`${DEFINITIONS}classroom`)}, name: 'Classroom' }, operation: 'create' },
]);`,
    });

    let [teaches, colleagues, create] = JSON.parse(result.scriptResult!);
    assert.deepEqual(
      teaches,
      {
        path: 'classrooms/room-204.json',
        operation: 'rename',
        allowed: true,
      },
      'the realm allows renaming a classroom the user teaches',
    );
    assert.deepEqual(
      colleagues,
      {
        path: 'classrooms/room-205.json',
        operation: 'rename',
        allowed: false,
        reason: 'operation-not-permitted',
      },
      'and refuses renaming a colleague’s, telling a reader why',
    );
    assert.deepEqual(
      create,
      {
        type: { module: `${DEFINITIONS}classroom`, name: 'Classroom' },
        operation: 'create',
        allowed: false,
        reason: 'operation-not-permitted',
      },
      'and refuses a create the policy does not grant',
    );
    assert.strictEqual(
      await storedTitle(adapter, 'classrooms/room-204.json'),
      'Room 204',
      'asking renamed nothing',
    );
  });

  test('a Realm Runner script is told a create the policy grants on a condition is conditional', async function (assert) {
    await setupSchool({
      enforcePermissions: true,
      readableByTestUser: true,
      policy: {
        data: {
          ...classroomPolicy.data,
          attributes: {
            cardInfo: { name: 'Classrooms' },
            rules: [
              {
                targetType: {
                  module: `${DEFINITIONS}classroom`,
                  name: 'Classroom',
                },
                grants: [
                  { operation: 'read' },
                  { operation: 'create', where: TEACHES },
                ],
              },
            ],
          },
        },
      },
    });

    let toolService = getService('tool-service');
    let result = await new RunRealmCodeTool(toolService.toolContext).execute({
      realm: SCHOOL,
      roomId: '!room:example.com',
      code: `return await realm.operations.capabilities([
  { type: { module: ${JSON.stringify(`${DEFINITIONS}classroom`)}, name: 'Classroom' }, operation: 'create' },
]);`,
    });

    assert.deepEqual(
      JSON.parse(result.scriptResult!),
      [
        {
          type: { module: `${DEFINITIONS}classroom`, name: 'Classroom' },
          operation: 'create',
          allowed: true,
          conditional: true,
        },
      ],
      'the grant matches, and its condition is judged against the classroom the create makes',
    );
  });

  // The host asks the school for its info during setup's renders, which the
  // school answers as its own requests, without asking who sent them. Signing
  // in afresh has the school decide whether to answer: one whose policy
  // judges the user does.
  async function signInToSchoolAfresh() {
    let realmService = getService('realm');
    realmService.removeRealm(SCHOOL);
    await realmService.reauthenticate(SCHOOL);
  }

  async function runInSchool(code: string) {
    let toolService = getService('tool-service');
    let result = await new RunRealmCodeTool(toolService.toolContext).execute({
      realm: SCHOOL,
      roomId: '!room:example.com',
      code,
    });
    return JSON.parse(result.scriptResult!);
  }

  test('a Realm Runner script runs for a user the realm admits only through its policy, and asks it which operations it allows', async function (assert) {
    await setupSchool({ enforcePermissions: true });
    await signInToSchoolAfresh();
    let realmService = getService('realm');
    assert.deepEqual(
      [realmService.canRead(SCHOOL), realmService.canWrite(SCHOOL)],
      [false, false],
      'the school’s permissions give the test user neither read nor write',
    );

    let [teaches, colleagues] = await runInSchool(
      `return await realm.operations.capabilities([
  { path: 'classrooms/room-204', operation: 'rename' },
  { path: 'classrooms/room-205', operation: 'rename' },
]);`,
    );
    assert.deepEqual(
      teaches,
      { path: 'classrooms/room-204.json', operation: 'rename', allowed: true },
      'the realm allows renaming a classroom the user teaches',
    );
    assert.deepEqual(
      colleagues,
      { path: 'classrooms/room-205.json', operation: 'rename', allowed: false },
      'and refuses renaming a colleague’s',
    );
  });

  test('a Realm Runner script runs an operation the policy grants a user the realm admits only through it, and the realm refuses one it does not', async function (assert) {
    let adapter = await setupSchool({ enforcePermissions: true });
    await signInToSchoolAfresh();

    let { renamed, refused } = await runInSchool(
      `let renamed = await realm.operations.invoke('classrooms/room-204', 'rename', { title: 'Renamed' });
let refused;
try {
  await realm.operations.invoke('classrooms/room-205', 'rename', { title: 'Renamed' });
} catch (e) {
  refused = e.message;
}
return { renamed: renamed.id, refused };`,
    );
    assert.strictEqual(
      renamed,
      ROOM_204,
      'the rename the policy grants runs, and answers the classroom it wrote',
    );
    assert.strictEqual(
      await storedTitle(adapter, 'classrooms/room-204.json'),
      'Renamed',
      'and lands',
    );
    assert.true(
      /no such target/.test(refused),
      `the realm refuses the rename it does not grant: ${refused}`,
    );
    assert.strictEqual(
      await storedTitle(adapter, 'classrooms/room-205.json'),
      'Room 205',
      'and nothing was written',
    );
  });

  test('a Realm Runner script run by a user the realm admits only through its policy reads what the policy grants, and is refused a write and a folder listing before the realm is asked', async function (assert) {
    let adapter = await setupSchool({ enforcePermissions: true });
    await signInToSchoolAfresh();

    let { title, refused } = await runInSchool(
      `let card = await realm.cards.get('classrooms/room-204');
let refused = [];
try { await realm.fs.writeText('notes.txt', 'hello'); } catch (e) { refused.push(e.message); }
try { await realm.fs.list('classrooms/'); } catch (e) { refused.push(e.message); }
return { title: card.attributes.title, refused };`,
    );
    assert.strictEqual(
      title,
      'Room 204',
      'the classroom the policy grants reads',
    );
    assert.deepEqual(
      refused,
      [
        "You can't write this workspace directly; realm.fs.writeText was not run. A change the realm's policy grants runs as an operation, with realm.operations.invoke",
        "You can't read this workspace directly; realm.fs.list was not run. Read what the realm's policy grants with realm.cards.get (a read grant), realm.cards.search (a query grant) or realm.fs.readText (a readSource grant)",
      ],
      'the write and the listing are refused, each saying what does run',
    );
    assert.strictEqual(
      await adapter.openFile('notes.txt'),
      undefined,
      'nothing was written',
    );
  });

  test('a Realm Runner script run by a user the realm admits only through its policy reads a card on a read grant, and not its source, which needs a readSource grant', async function (assert) {
    await setupSchool({ enforcePermissions: true });
    await signInToSchoolAfresh();

    let { title, source, exists } = await runInSchool(
      `let card = await realm.cards.get('classrooms/room-204');
let source;
try {
  source = await realm.fs.readText('classrooms/room-204.json');
} catch (e) {
  source = e.message;
}
let exists;
try {
  exists = await realm.fs.exists('classrooms/room-204.json');
} catch (e) {
  exists = e.message;
}
return { title: card.attributes.title, source, exists };`,
    );
    assert.strictEqual(title, 'Room 204', 'the read grant serves the card');
    assert.strictEqual(
      source,
      `File not found: ${ROOM_204}.json`,
      'and the realm answers its stored source as not found, since the policy grants no readSource',
    );
    assert.strictEqual(
      exists,
      "realm.fs.exists can't tell whether classrooms/room-204.json exists: the realm answers a file the user can't read as not found",
      'asking whether the file exists gets no false answer about a file that is there',
    );
  });

  test('neither the Realm Runner nor the AI context reads realm info as the sign of a policy once the session it came with is gone', async function (assert) {
    await setupSchool({ enforcePermissions: true });
    await signInToSchoolAfresh();
    let realmService = getService('realm');
    assert.true(
      realmService.admitsOnlyThroughPolicy(ri(SCHOOL)),
      'while the user holds a session, the info the school answered says its policy judges them',
    );

    // Signing out ends the realm session and keeps the realm's info, as
    // re-authentication and a switch of account do.
    realmService.logout();
    assert.true(
      realmService.isInfoLoaded(ri(SCHOOL)),
      'the host still holds the school’s info',
    );
    assert.false(
      realmService.admitsOnlyThroughPolicy(ri(SCHOOL)),
      'but no session backs it',
    );

    let toolService = getService('tool-service');
    await assert.rejects(
      new RunRealmCodeTool(toolService.toolContext).execute({
        realm: SCHOOL,
        roomId: '!room:example.com',
        code: `return 'ran';`,
      }),
      (error: Error) =>
        error.message === `The current user cannot read or write ${SCHOOL}`,
      'the run is refused before it starts',
    );

    let operatorModeState = getService('operator-mode-state-service');
    operatorModeState.restore({
      stacks: [[{ id: ROOM_204, format: 'isolated' }]],
    });
    let context = await operatorModeState.getSummaryForAIBot();
    assert.strictEqual(
      context.realmPolicy,
      undefined,
      'and the AI context claims no policy',
    );
  });

  test('a Realm Runner script does not run for a user a realm without a policy does not let read', async function (assert) {
    await setupSchool({ enforcePermissions: true, policy: null });
    let realmService = getService('realm');
    realmService.removeRealm(SCHOOL);
    await assert.rejects(
      realmService.reauthenticate(SCHOOL),
      /Failed to fetch realm info/,
      'the school refused the user its info',
    );

    let toolService = getService('tool-service');
    await assert.rejects(
      new RunRealmCodeTool(toolService.toolContext).execute({
        realm: SCHOOL,
        roomId: '!room:example.com',
        code: `return 'ran';`,
      }),
      (error: Error) =>
        error.message === `The current user cannot read or write ${SCHOOL}`,
      'the run is refused before it starts',
    );
  });

  test('a realm set up alone serves its policy card to its owner', async function (assert) {
    // No realm is set up before this one, so the matrix boot asks this realm
    // for the default system card, which lives at its URL. Answering for the
    // policy card then has the realm render the policy's definition, which
    // fails if any of the host's requests was refused before it.
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: SCHOOL,
      enforcePermissions: true,
      permissions: { [TEST_USER]: ['read', 'write', 'realm-owner'] },
      contents: {
        'realm.json': realmConfigCardJSON({
          name: 'School',
          policy: `${SCHOOL}policies/classrooms`,
        }),
        'policies/classrooms.json': {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Classrooms' }, rules: [] },
            meta: { adoptsFrom: REALM_POLICY },
          },
        },
      },
    });

    let policy = await getService('store').get(`${SCHOOL}policies/classrooms`);
    assert.notOk(
      isCardErrorJSONAPI(policy),
      `the policy card loads: ${JSON.stringify(policy)}`,
    );
    assert.strictEqual(
      (policy as CardDef).cardInfo.name,
      'Classrooms',
      'as the card the realm stores',
    );
  });

  test('without enforcePermissions the realm answers the host as its own dispatch, and the policy decides nothing', async function (assert) {
    let adapter = await setupSchool({});

    await renderClassroom(ROOM_205);
    assert
      .dom('[data-test-may-rename]')
      .hasText(
        'yes',
        'no ACL judges the request, so nothing is declined for the policy to decide',
      );
    await click('[data-test-rename]');
    await waitFor('[data-test-renamed]');
    assert.strictEqual(
      await storedTitle(adapter, 'classrooms/room-205.json'),
      'Renamed',
      'and the rename lands',
    );
  });

  test('the AI assistant runs a create the policy grants on a type the school holds no enrollment of', async function (assert) {
    let adapter = await setupSchool({
      enforcePermissions: true,
      readableByTestUser: true,
      policy: enrollmentPolicy,
    });
    assert.false(
      getService('realm').canWrite(SCHOOL),
      'the test user cannot write the school',
    );
    await settleRealmRenders();

    let tool = new InvokeCardOperationTool(
      getService('tool-service').toolContext,
    );
    // The type as the AI context names it, from the policy's rule.
    let type = { module: `${DEFINITIONS}classroom`, name: 'Enrollment' };

    let result = await tool.execute({
      type,
      operation: 'enroll',
      payload: { course: 'Biology' },
      realm: SCHOOL,
    } as any);

    assert.true(
      result.cardId?.startsWith(SCHOOL),
      `the enrollment was made in the school: ${result.cardId}`,
    );
    let file = await adapter.openFile(
      `${result.cardId.slice(SCHOOL.length)}.json`,
    );
    let { attributes } = JSON.parse(file!.content as string).data;
    assert.deepEqual(
      { course: attributes.course, studentId: attributes.studentId },
      { course: 'Biology', studentId: TEST_USER },
      'filled from the payload and the caller, as the declaration says',
    );
    await settleRealmRenders();

    let refusal: unknown;
    try {
      await tool.execute({
        type,
        operation: 'create',
        payload: { course: 'Chemistry', studentId: TEST_USER },
        realm: SCHOOL,
      } as any);
    } catch (e) {
      refusal = e;
    }
    assert.true(
      refusal instanceof OperationsError,
      `the plain create, which the policy does not grant, is refused by the realm: ${String(refusal)}`,
    );
  });
});
