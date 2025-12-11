import Service from '@ember/service';
import { waitFor, click, findAll } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, skip } from 'qunit';

import { baseRealm, Loader, type Realm } from '@cardstack/runtime-common';

import { ensureTrailingSlash } from '@cardstack/runtime-common';
import {
  APP_BOXEL_COMMAND_REQUESTS_KEY,
  APP_BOXEL_MESSAGE_MSGTYPE,
  APP_BOXEL_ROOM_SKILLS_EVENT_TYPE,
} from '@cardstack/runtime-common/matrix-constants';

import OperatorMode from '@cardstack/host/components/operator-mode/container';
import ENV from '@cardstack/host/config/environment';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { CardMessageContent } from 'https://cardstack.com/base/matrix-event';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOperatorModeStateCleanup,
  setupSnapshotRealm,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';
import { getService } from '@universal-ember/test-support';

class MockRouterService extends Service {
  replaceWith(_route: any, _args: any) {
    // This is a stub method that does nothing
  }
}

module('Integration | create app module via ai-assistant', function (hooks) {
  const noop = () => {};
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  const catalogRealmURL = ensureTrailingSlash(ENV.resolvedCatalogRealmURL);

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });

  let { getRoomEvents, simulateRemoteMessage, getRoomState } = mockMatrixUtils;

  let snapshot = setupSnapshotRealm<{ loader: Loader }>(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      return { loader };
    },
  });

  hooks.beforeEach(function () {
    ({ loader } = snapshot.get());
    this.owner.register('service:router', MockRouterService);
  });

  setupLocalIndexing(hooks);
  setupCardLogs(
    hooks,
    async () => await snapshot.get().loader.import(`${baseRealm.url}card-api`),
  );

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');
  });

  // TODO: extract test helper
  function setCardInOperatorModeState(
    cardURL?: string,
    format: 'isolated' | 'edit' = 'isolated',
  ) {
    operatorModeStateService.restore({
      stacks: cardURL ? [[{ id: cardURL, format }]] : [[]],
    });
  }

  async function openAiAssistant(): Promise<string> {
    await waitFor('[data-test-open-ai-assistant]');
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-test-room-settled]');
    let roomId = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    return roomId;
  }

  async function renderAiAssistantPanel(id?: string) {
    setCardInOperatorModeState(id);
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <OperatorMode @onClose={{noop}} />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  async function getModule(realm: Realm, url: URL) {
    let maybeInstance = await realm.realmIndexQueryEngine.module(url);
    if (maybeInstance?.type === 'error') {
      return undefined;
    }
    return maybeInstance;
  }

  // This doesn’t work when the generator is in experiments instead of catalog
  skip('it can create a module using a tool call', async function (assert) {
    let { realm } = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'PRD/1.json': {
          data: {
            type: 'card',
            attributes: {
              appTitle: 'Preschool CRM',
              shortDescription:
                'A CRM tailored specifically for preschools to manage tours and other administrative tasks efficiently.',
              thumbnail: {
                altText: null,
                size: 'actual',
                height: null,
                width: null,
                base64: null,
              },
              prompt:
                'I want to create a CRM tailored for a preschool that includes features such as tracking tours.',
              overview:
                'The Preschool CRM is designed to streamline the administrative tasks of preschools, with a particular emphasis on tracking tours. This system will facilitate better communication with parents, streamline the scheduling of tours, and allow for efficient record-keeping and follow-up. It aims to enhance the overall management of the preschool, ensuring that all interactions with potential and current enrollees are handled smoothly and professionally.\n\nIn addition to tour tracking, the Preschool CRM can be expanded to include features such as attendance management, student performance tracking, and parent-teacher communications. This comprehensive approach will help preschools focus on their primary mission of providing quality education while efficiently managing their administrative tasks.',
              schema:
                'The schema for the Preschool CRM app might include the following entities:\n1. **Tours**: Tour ID, Date, Time, Parent(s) Name(s), Contact Information, Notes.\n2. **Students**: Student ID, Name, Age, Enrollment Date, Parent(s) Information, Allergies/Medical Notes, Attendance Records.\n3. **Parents**: Parent ID, Name, Contact Information, Student(s) Linked.\n4. **Staff**: Staff ID, Name, Role, Contact Information, Schedule.\n5. **Classes**: Class ID, Name, Instructor, Schedule, Enrolled Students.\n6. **Communications**: Communication ID, Date, Type (Email/Phone/In-Person), Content, Follow-Up Date.',
              layoutAndNavigation:
                "The layout of the Preschool CRM will have a clean and intuitive interface, with the following primary sections accessible from a navigation bar:\n1. **Dashboard**: Overview of the day's tours, tasks, and alerts.\n2. **Tours**: A section to schedule, view, and manage tours.\n3. **Students**: A comprehensive database of all students, with options for adding, editing, and viewing student profiles.\n4. **Parents**: A database of parents linked to their respective students, with contact information and interaction history.\n5. **Staff**: A section to manage staff information and schedules.\n6. **Classes**: Manage class schedules and rosters.\n7. **Communications**: Log and review communications with parents and staff.",
              moduleURL: null,
              thumbnailURL: null,
            },
            meta: {
              adoptsFrom: {
                module: `${catalogRealmURL}product-requirement-document`,
                name: 'ProductRequirementDocument',
              },
            },
          },
        },
      },
    });

    const prdCardId = `${testRealmURL}PRD/1`;
    await renderAiAssistantPanel(prdCardId);

    const stackCard = `[data-test-stack-card="${prdCardId}"]`;

    assert.dom(stackCard).exists();
    await click('[data-test-generate-app]');
    await click('[data-test-past-sessions-button]');
    let newRoomButton = findAll('[data-test-enter-room]').filter((el) =>
      el.textContent?.includes('AI Assistant Room'),
    )[0];

    assert.ok(newRoomButton, 'new room button exists');

    let roomId = newRoomButton.getAttribute('data-test-enter-room')!;

    await click(`[data-test-enter-room="${roomId}"]`);

    assert
      .dom(
        `[data-test-room-name="AI Assistant Room"] [data-test-message-idx="0"]`,
      )
      .containsText('Generate code');
    let events = getRoomEvents(roomId);
    let lastEvContent = events[events.length - 1].content as CardMessageContent;
    assert.strictEqual(
      lastEvContent.body,
      'Generate code for the application given the product requirements, you do not need to strictly follow the schema if it does not seem appropriate for the application.',
      'Event content is correct',
    );
    assert.strictEqual(
      getRoomState(roomId, APP_BOXEL_ROOM_SKILLS_EVENT_TYPE).enabledSkillCards
        .length,
      1,
      'Only added skill is present',
    );
    let skillFileDef = getRoomState(roomId, APP_BOXEL_ROOM_SKILLS_EVENT_TYPE)
      .enabledSkillCards[0];
    assert.strictEqual(
      skillFileDef.sourceUrl,
      'CodeGeneratorHelper',
      'skill card is attached',
    );

    const moduleCode = `import { Component, CardDef, FieldDef, linksTo, linksToMany, field, contains, containsMany } from 'https://cardstack.com/base/card-api';\nimport StringField from 'https://cardstack.com/base/string';\nimport BooleanField from 'https://cardstack.com/base/boolean';\nimport DateField from 'https://cardstack.com/base/date';\nimport DateTimeField from 'https://cardstack.com/base/datetime';\nimport NumberField from 'https://cardstack.com/base/number';\nimport MarkdownField from 'https://cardstack.com/base/markdown';\nimport { AppCard } from '${catalogRealmURL}app-card';\n\nexport class Tour extends CardDef {\n  static displayName = 'Tour';\n\n  @field tourID = contains(StringField);\n  @field date = contains(DateField);\n  @field time = contains(DateTimeField);\n  @field parentNames = contains(StringField);\n  @field contactInformation = contains(StringField);\n  @field notes = contains(MarkdownField);\n\n  @field parents = linksToMany(() => Parent);\n}\n\nexport class Student extends CardDef {\n  static displayName = 'Student';\n\n  @field studentID = contains(StringField);\n  @field name = contains(StringField);\n  @field age = contains(NumberField);\n  @field enrollmentDate = contains(DateField);\n  @field parentInformation = contains(MarkdownField);\n  @field allergiesMedicalNotes = contains(MarkdownField);\n  @field attendanceRecords = containsMany(MarkdownField);\n  \n  @field parents = linksToMany(() => Parent);\n  @field classes = linksToMany(() => Class);\n}\n\nexport class Parent extends CardDef {\n  static displayName = 'Parent';\n\n  @field parentID = contains(StringField);\n  @field name = contains(StringField);\n  @field contactInformation = contains(StringField);\n  \n  @field students = linksToMany(Student);\n  @field tours = linksToMany(Tour);\n}\n\nexport class Staff extends CardDef {\n  static displayName = 'Staff';\n\n  @field staffID = contains(StringField);\n  @field name = contains(StringField);\n  @field role = contains(StringField);\n  @field contactInformation = contains(StringField);\n  @field schedule = contains(MarkdownField);\n}\n\nexport class Class extends CardDef {\n  static displayName = 'Class';\n\n  @field classID = contains(StringField);\n  @field name = contains(StringField);\n  @field schedule = contains(MarkdownField);\n  \n  @field instructor = linksTo(Staff);\n  @field enrolledStudents = linksToMany(Student);\n}\n\nexport class Communication extends CardDef {\n  static displayName = 'Communication';\n\n  @field communicationID = contains(StringField);\n  @field date = contains(DateField);\n  @field type = contains(StringField);\n  @field content = contains(MarkdownField);\n  @field followUpDate = contains(DateField);\n}\n\nexport class PreschoolCRMApp extends AppCard {\n  static displayName = 'Preschool CRM';\n\n  @field tours = containsMany(Tour);\n  @field students = containsMany(Student);\n  @field parents = containsMany(Parent);\n  @field staff = containsMany(Staff);\n  @field classes = containsMany(Class);\n  @field communications = containsMany(Communication);\n}\n`;

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      body: 'Generate code for Preschool CRM based on product requirement document.',
      [APP_BOXEL_COMMAND_REQUESTS_KEY]: [
        {
          id: 'generateAppModule',
          name: 'Generate App Module',
          arguments: JSON.stringify({
            attached_card_id: prdCardId,
            description:
              'Generate code for Preschool CRM based on product requirement document.',
            appTitle: 'Preschool CRM',
            moduleCode,
          }),
        },
      ],
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: 'event0',
      },
    });

    await waitFor('[data-test-command-apply="ready"]');
    await click('[data-test-command-apply="ready"]');
    assert.dom('[data-test-view-module]').exists();
    let moduleURL = (
      document.querySelector('[data-test-view-module]') as HTMLElement
    )?.innerText;
    let module = await getModule(realm, new URL(moduleURL));
    assert.strictEqual(module?.canonicalURL, moduleURL);

    await click('[data-test-view-module]');
    assert.dom('[data-test-code-mode]').exists();
    assert.dom('[data-test-editor]').hasAnyText();
    assert.dom('[data-test-syntax-error]').doesNotExist();
  });
});
