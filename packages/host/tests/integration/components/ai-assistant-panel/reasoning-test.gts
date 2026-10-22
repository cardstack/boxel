import { waitFor, waitUntil, click } from '@ember/test-helpers';
import { settled } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

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
  setupRealmCacheTeardown,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../../helpers';
import { setupMockMatrix } from '../../../helpers/mock-matrix';
import { renderComponent } from '../../../helpers/render-component';
import { setupRenderingTest } from '../../../helpers/setup';

module('Integration | ai-assistant-panel | reasoning', function (hooks) {
  const realmName = 'Operator Mode Workspace';
  let loader: Loader;
  let operatorModeStateService: OperatorModeStateService;

  setupRenderingTest(hooks);
  setupOperatorModeStateCleanup(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
    now: (() => {
      // deterministic clock so that, for example, captures
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

    await withCachedRealmSetup(async () => {
      await setupIntegrationTestRealm({
        mockMatrixUtils,
        contents: {
          'person.gts': { Person },
          'Person/fadhlan.json': new Person({
            firstName: 'Fadhlan',
          }),
          'realm.json': realmConfigCardJSON({ name: realmName }),
        },
      });
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
      .dom('[data-test-message-idx="0"] [data-test-reasoning]')
      .containsText('they want to know what kind of dog to get');
  });

  const TOGGLE =
    '[data-test-message-idx="0"] [data-test-reasoning] [data-test-pretui-thinking-toggle]';
  const REASONING =
    'OK, they want to know what kind of dog to get. Let me think about what relevant details I know about them.';

  test('the reasoning trace is shown but closed by default, while reasoning and after the answer starts', async function (assert) {
    let roomId = await renderAiAssistantPanel();

    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: 'Thinking...',
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });

    await waitFor(`[data-test-room="${roomId}"] [data-test-message-idx="0"]`);
    assert
      .dom('[data-test-message-idx="0"] [data-test-reasoning]')
      .containsText('Thinking', 'the placeholder shows the working label');
    assert
      .dom('[data-test-message-idx="0"] [data-test-reasoning-body]')
      .doesNotExist('no reasoning text yet');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: REASONING,
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await waitUntil(() =>
      document
        .querySelector('[data-test-message-idx="0"] [data-test-reasoning-body]')
        ?.textContent?.includes('they want to know what kind of dog to get'),
    );
    assert
      .dom(TOGGLE)
      .hasAttribute('aria-expanded', 'false', 'closed while reasoning');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: REASONING,
      body: 'You should get a',
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await waitUntil(() =>
      document
        .querySelector('[data-test-message-idx="0"]')
        ?.textContent?.includes('You should get a'),
    );
    assert
      .dom(TOGGLE)
      .hasAttribute(
        'aria-expanded',
        'false',
        'still closed once the answer streams',
      );
  });

  test('if user explicity opens or closes reasoning content, that state is remembered', async function (assert) {
    let roomId = await renderAiAssistantPanel();
    let eventId = simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: REASONING,
      body: null,
      msgtype: 'm.text',
      isStreamingFinished: false,
    });
    await settled();
    assert.dom(TOGGLE).hasAttribute('aria-expanded', 'false');

    await click(TOGGLE);
    assert.dom(TOGGLE).hasAttribute('aria-expanded', 'true');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: `${REASONING}\n\nThey like beagles.`,
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
      .dom(TOGGLE)
      .hasAttribute('aria-expanded', 'true', 'stays open as reasoning grows');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: `${REASONING}\n\nThey like beagles.`,
      body: 'You should get a beagle.',
      msgtype: 'm.text',
      isStreamingFinished: false,
      'm.relates_to': {
        rel_type: 'm.replace',
        event_id: eventId,
      },
    });
    await settled();
    assert
      .dom(TOGGLE)
      .hasAttribute(
        'aria-expanded',
        'true',
        'stays open when the answer starts',
      );

    await click(TOGGLE);
    assert.dom(TOGGLE).hasAttribute('aria-expanded', 'false');

    simulateRemoteMessage(roomId, '@aibot:localhost', {
      [APP_BOXEL_REASONING_CONTENT_KEY]: `${REASONING}\n\nThey like beagles.`,
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
      .dom(TOGGLE)
      .hasAttribute(
        'aria-expanded',
        'false',
        'the reader closed it; it stays closed',
      );
  });
});
