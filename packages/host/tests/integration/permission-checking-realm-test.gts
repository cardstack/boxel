import { click, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  CardContextName,
  OperationsError,
  rri,
  type LooseSingleCardDocument,
  type Realm,
} from '@cardstack/runtime-common';
import { isCardErrorJSONAPI } from '@cardstack/runtime-common/error';
import type { Loader } from '@cardstack/runtime-common/loader';

import type CapabilitiesService from '@cardstack/host/services/capabilities';

import {
  provideConsumeContext,
  realmConfigCardJSON,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  settleRealmRenders,
  testRealmURL,
} from '../helpers';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
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
  import { operation, operations, params } from '@cardstack/base/operations';

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
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);

  let loader: Loader;
  let operations: (typeof OperationsModule)['operations'];
  let hostTransport: unknown;

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
  }: {
    enforcePermissions?: true;
  }): Promise<{ realm: Realm; adapter: TestRealmAdapter }> {
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: DEFINITIONS,
      permissions: { '*': ['read'] },
      contents: {
        'realm.json': realmConfigCardJSON({ name: 'Classroom definitions' }),
        'classroom.gts': CLASSROOM_MODULE,
      },
    });
    let { realm, adapter } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      realmURL: SCHOOL,
      enforcePermissions,
      permissions: {
        [SCHOOL_ADMIN]: ['read', 'write', 'realm-owner'],
      },
      contents: {
        'realm.json': realmConfigCardJSON({
          name: 'School',
          policy: `${SCHOOL}policies/classrooms`,
        }),
        'classrooms/room-204.json': classroom('Room 204', [TEST_USER]),
        'classrooms/room-205.json': classroom('Room 205', [COLLEAGUE]),
        'policies/classrooms.json': classroomPolicy,
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
    return { realm, adapter };
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
    let { realm, adapter } = await setupSchool({ enforcePermissions: true });

    await renderClassroom(ROOM_204);
    await click('[data-test-rename]');
    await waitFor('[data-test-renamed]');
    assert.strictEqual(
      await storedTitle(adapter, 'classrooms/room-204.json'),
      'Renamed',
      'the rename the control offered lands',
    );
    // The realm renders what the rename changed after answering it, and a
    // request sent during that render would be answered as the realm's own.
    await settleRealmRenders(realm);

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

  test('without enforcePermissions the realm answers the host as its own dispatch, and the policy decides nothing', async function (assert) {
    let { adapter } = await setupSchool({});

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
});
