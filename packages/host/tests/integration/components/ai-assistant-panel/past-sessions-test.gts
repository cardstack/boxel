import { waitFor, click } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { APP_BOXEL_MESSAGE_MSGTYPE } from '@cardstack/runtime-common/matrix-constants';

import OperatorMode from '@cardstack/host/components/operator-mode/container';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import {
  testRealmURL,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupOnSave,
  setupOperatorModeStateCleanup,
} from '../../../helpers';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  linksTo,
  linksToMany,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | past sessions', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
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

  let { createAndJoinRoom, simulateRemoteMessage } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      @field title = contains(StringField, {
        computeVia: function (this: Pet) {
          return this.name;
        },
      });
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <h3 data-test-pet={{@model.name}}>
            <@fields.name />
          </h3>
        </template>
      };
    }

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
      @field pet = linksTo(Pet);
      @field friends = linksToMany(Pet);
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
          Pet:
          <@fields.pet />
          Friends:
          <@fields.friends />
          <div data-test-addresses>Address: <@fields.address /></div>
        </template>
      };
    }

    let petMango = new Pet({ name: 'Mango' });

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'pet.gts': { Pet },
        'address.gts': { Address },
        'person.gts': { Person },
        'Pet/mango.json': petMango,
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
          address: new Address({
            city: 'Bandung',
            country: 'Indonesia',
          }),
          pet: petMango,
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
        </template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('can close past-sessions list on outside click', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-past-sessions]').exists();
    assert.dom('[data-test-joined-room]').exists({ count: 1 });
    await click('.interact-submode'); // outside click
    assert.dom('[data-test-past-sessions]').doesNotExist();

    await click('[data-test-past-sessions-button]');
    await click('[data-test-past-sessions]');
    assert.dom('[data-test-past-sessions]').exists();
    await click(`[data-test-past-session-options-button="${roomId}"]`);
    assert.dom('[data-test-past-sessions]').exists();
    await click('[data-test-message-field]');
    assert.dom('[data-test-past-sessions]').doesNotExist();
  });

  test('it animates the sessions dropdown button when there are other sessions that have activity which was not seen by the user yet', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@matic:boxel', {
      body: 'Say one word.',
      msgtype: APP_BOXEL_MESSAGE_MSGTYPE,
      format: 'org.matrix.custom.html',
    });

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      body: 'Word.',
      msgtype: 'm.text',
      format: 'org.matrix.custom.html',
      isStreamingFinished: true,
    });

    assert
      .dom('[data-test-past-sessions-button] [data-test-has-active-sessions]')
      .doesNotExist();
    await click('[data-test-past-sessions-button]');
    assert
      .dom(`[data-test-enter-room='${roomId}'] [data-test-is-streaming]`)
      .doesNotExist();
    assert
      .dom(`[data-room-id='${roomId}']`)
      .hasAttribute('data-is-current-room');
    await click('[data-test-ai-assistant-panel]'); // close the menu

    // Create a new room with some activity (this could happen when we will have a feature that interacts with AI outside of the AI pannel, i.e. "commands")

    let anotherRoomId = createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'Another Room',
    });

    simulateRemoteMessage(
      anotherRoomId,
      '@aibot:localhost',
      {
        body: 'I sent a message from the background.',
        msgtype: 'm.text',
        format: 'org.matrix.custom.html',
        isStreamingFinished: true,
      },
      {
        origin_server_ts: Date.now(),
      },
    );

    await waitFor('[data-test-has-active-sessions]');

    assert
      .dom('[data-test-past-sessions-button][data-test-has-active-sessions]')
      .exists("'All Sessions button' is animated");

    await click('[data-test-past-sessions-button]');

    assert
      .dom(
        `[data-test-joined-room='${anotherRoomId}'] [data-test-is-unseen-message]`,
      )
      .exists('Newly created room has an unseen message');

    assert
      .dom(
        `[data-test-joined-room='${anotherRoomId}'] [data-test-is-unseen-message]`,
      )
      .containsText('Updated');

    assert
      .dom(`[data-test-joined-room='${roomId}'][data-test-is-unseen-message]`)
      .doesNotExist("Old room doesn't have an unseen message");

    assert
      .dom(`[data-test-joined-room='${roomId}']`)
      .doesNotContainText('Updated');
    assert
      .dom(`[data-room-id='${anotherRoomId}']`)
      .doesNotHaveAttribute('data-is-current-room');

    await click(`[data-test-enter-room='${anotherRoomId}']`);
    assert
      .dom(
        `[data-test-joined-room='${anotherRoomId}'] [data-test-is-unseen-message]`,
      )
      .doesNotExist(
        "Newly created room doesn't have an unseen message because we just opened it and saw the message",
      );
    assert
      .dom(`[data-test-joined-room='${roomId}'] [data-test-is-unseen-message]`)
      .doesNotExist("Old room doesn't have an unseen message");

    assert
      .dom('[data-test-past-sessions-button][data-test-has-active-sessions]')
      .doesNotExist(
        "'Past Sessions button' is not animated anymore because the other active session was seen",
      );

    await click('[data-test-past-sessions-button]');

    assert
      .dom(`[data-test-joined-room='${roomId}']`)
      .doesNotContainText('Updated');
    assert
      .dom(`[data-test-joined-room='${anotherRoomId}']`)
      .doesNotContainText('Updated');
    assert
      .dom(`[data-room-id='${anotherRoomId}']`)
      .hasAttribute('data-is-current-room');
    assert
      .dom(`[data-room-id='${roomId}']`)
      .doesNotHaveAttribute('data-is-current-room');
  });

  test('can copy room id to clipboard', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    await click('[data-test-past-sessions-button]');
    assert.dom('[data-test-past-sessions]').exists();

    await click(`[data-test-past-session-options-button="${roomId}"]`);
    assert.dom('[data-test-boxel-menu-item-text="Copy Room Id"]').exists();

    let originalWriteText = navigator.clipboard.writeText;
    let clipboardText;
    navigator.clipboard.writeText = async (text: string) => {
      clipboardText = text;
      return Promise.resolve();
    };
    await click('[data-test-boxel-menu-item-text="Copy Room Id"]');
    assert.strictEqual(
      clipboardText,
      roomId,
      'Room ID was copied to clipboard',
    );
    assert.dom('[data-test-boxel-menu-item-text="Copied!"]').exists();
    navigator.clipboard.writeText = originalWriteText;
  });
});
