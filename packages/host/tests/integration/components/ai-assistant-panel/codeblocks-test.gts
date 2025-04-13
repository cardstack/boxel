import { waitFor, click } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import CardPrerender from '@cardstack/host/components/card-prerender';
import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  percySnapshot,
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  getMonacoContent,
  lookupLoaderService,
} from '../../../helpers';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | codeblocks', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = lookupLoaderService().loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      // deterministic clock so that, for example, screenshots
      // have consistent content
      let clock = new Date(2024, 8, 19).getTime();
      return () => (clock += 10);
    })(),
  });

  let { simulateRemoteMessage } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = this.owner.lookup(
      'service:operator-mode-state-service',
    ) as OperatorModeStateService;

    class Address extends FieldDef {
      static displayName = 'Address';
      @field city = contains(StringField);
      @field country = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <div data-test-address>
            <h3 data-test-city={{@model.city}}>
              <@fields.city />
            </h3>
            <h3 data-test-country={{@model.country}}>
              <@fields.country />
            </h3>
          </div>
        </template>
      };
    }

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName[0];
        },
      });
      @field title = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      @field address = contains(Address);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
          <div data-test-addresses>Address: <@fields.address /></div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      loader,
      mockMatrixUtils,
      contents: {
        'address.gts': { Address },
        'person.gts': { Person },
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
        }),
        '.realm.json': `{ "name": "${realmName}" }`,
      },
    });
  });

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
          <CardPrerender />
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('it shows the copy code to clipboard button', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        formatted_body:
          'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="0"]');
    assert
      .dom('button.code-copy-button')
      .exists('the copy code to clipboard button exists');

    // assert that new messages don't destabilize the RoomMessage component
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'this is another message',
        formatted_body: 'this is another message',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 13, 30).getTime(),
      },
    );
    await settled();

    assert
      .dom('button.code-copy-button')
      .exists('the copy code to clipboard button exists');

    assert.dom('[data-test-apply-code-button]').doesNotExist(); // no apply for code that is not a search/replace block

    // the chrome security model prevents the clipboard API
    // from working when tests are run in a headless mode, so we are unable to
    // assert the button actually copies contents to the clipboard
  });

  test('it renders codeblock in monaco', async function (assert) {
    let roomId = await renderAiAssistantPanel(`${testRealmURL}Person/fadhlan`);
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        formatted_body:
          'This is a code snippet that I made for you\n```javascript\nconsole.log("hello world");\n```\nWhat do you think about it?',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 12, 30).getTime(),
      },
    );

    await waitFor('[data-test-message-idx="0"]');
    let monacoContent = getMonacoContent();
    assert.strictEqual(
      monacoContent,
      `console.log("hello world");`,
      'monaco content is correct',
    );

    // assert that new messages don't destabilize the RoomMessage component
    simulateRemoteMessage(
      roomId,
      '@aibot:localhost',
      {
        body: 'this is another message',
        formatted_body: 'this is another message',
        msgtype: 'org.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: new Date(2024, 0, 3, 13, 30).getTime(),
      },
    );
    await settled();

    monacoContent = getMonacoContent();
    assert.strictEqual(
      monacoContent,
      `console.log("hello world");`,
      'monaco content is correct',
    );

    await waitFor('.monaco-editor'); // wait for the monaco editor to be rendered for percy

    await percySnapshot(assert);
  });
});
