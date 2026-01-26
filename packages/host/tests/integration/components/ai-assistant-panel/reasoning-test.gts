import { waitFor, waitUntil, click } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { APP_BOXEL_REASONING_CONTENT_KEY } from '@cardstack/runtime-common/matrix-constants';

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
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../../../helpers/base-realm';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | reasoning', function (hooks) {
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

  let { simulateRemoteMessage } = mockMatrixUtils;

  let noop = () => {};

  hooks.beforeEach(async function () {
    operatorModeStateService = getService('operator-mode-state-service');

    class Person extends CardDef {
      static displayName = 'Person';
      @field firstName = contains(StringField);
      @field firstLetterOfTheName = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName[0];
        },
      });
      @field cardTitle = contains(StringField, {
        computeVia: function (this: Person) {
          return this.firstName;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-person={{@model.firstName}}>
            <@fields.firstName />
          </h2>
          <p data-test-first-letter-of-the-name={{@model.firstLetterOfTheName}}>
            <@fields.firstLetterOfTheName />
          </p>
        </template>
      };
    }

    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'person.gts': { Person },
        'Person/fadhlan.json': new Person({
          firstName: 'Fadhlan',
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
        <template><OperatorMode @onClose={{noop}} /></template>
      },
    );
    let roomId = await openAiAssistant();
    return roomId;
  }

  test('it can render reasoning from ai bot', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });
    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .containsText('they want to know what kind of dog to get');
  });

  test('by default reasoning content expands when reasoning starts streaming, then collapses when body starts streaming', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: 'Thinking...',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });

    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    assert
      .dom('[data-test-message-idx="0"] .reasoning-content')
      .containsText('Thinking...');
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .doesNotExist();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await waitUntil(() => {
      const element = document.querySelector(
        '[data-test-message-idx="0"] details[data-test-reasoning]',
      );
      return element?.textContent?.includes?.(
        'they want to know what kind of dog to get',
      );
    });
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .containsText('they want to know what kind of dog to get');
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .hasAttribute('open');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.',
      body: 'You should get a',
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await waitUntil(() => {
      const element = document.querySelector('[data-test-message-idx="0"]');
      return element?.textContent?.includes?.('You should get a');
    });
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .doesNotHaveAttribute('open');
  });

  test('if user explicity collapses or expands reasoning content, that state is remembered', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: 'Thinking...',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });
    await settled();
    assert
      .dom('[data-test-message-idx="0"] .reasoning-content')
      .containsText('Thinking...');
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .doesNotExist();

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await settled();
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .containsText('they want to know what kind of dog to get');
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .hasAttribute('open');

    await click(
      '[data-test-message-idx="0"] details[data-test-reasoning] summary',
    );
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .doesNotHaveAttribute('open');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.\n\nThey like beagles.',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await settled();
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .doesNotHaveAttribute('open');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.\n\nThey like beagles.',
      body: 'You should get a beagle.',
      msgtype: 'm.text',
      isStreamingFinished: false,
    });
    await settled();
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .doesNotHaveAttribute('open');
    await click(
      '[data-test-message-idx="0"] details[data-test-reasoning] summary',
    );
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .hasAttribute('open');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]:
        'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.\n\nThey like beagles.',
      body: 'You should get a beagle. They are great companions.',
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await settled();
    assert
      .dom('[data-test-message-idx="0"] details[data-test-reasoning]')
      .hasAttribute('open');
  });
});
