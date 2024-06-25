import { click, waitFor } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { setupRenderingTest } from 'ember-qunit';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import AiAssistantPanel from '@cardstack/host/components/ai-assistant/panel';
import CardCatalogModal from '@cardstack/host/components/card-catalog/modal';
// import { addRoomEvent } from '@cardstack/host/lib/matrix-handlers';

import {
  lookupLoaderService,
  setupLocalIndexing,
  setupServerSentEvents,
  setupIntegrationTestRealm,
  testRealmURL,
} from '../../helpers';
import {
  setupMatrixServiceMock,
  type MockMatrixService,
} from '../../helpers/mock-matrix-service';
import { renderComponent } from '../../helpers/render-component';

module('Integration | Component | AiAssistantSkillMenu', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);
  setupServerSentEvents(hooks);
  setupMatrixServiceMock(hooks);

  let matrixService: MockMatrixService;

  hooks.beforeEach(async function () {
    let loader = lookupLoaderService().loader;
    let cardApi: typeof import('https://cardstack.com/base/card-api');
    let skillCard: typeof import('https://cardstack.com/base/skill-card');

    cardApi = await loader.import(`${baseRealm.url}card-api`);
    skillCard = await loader.import(`${baseRealm.url}skill-card`);

    matrixService = this.owner.lookup(
      'service:matrixService',
    ) as MockMatrixService;
    matrixService.cardAPI = cardApi;
    matrixService.getRoomModule = async function () {
      return await loader.import(`${baseRealm.url}room`);
    };

    let { SkillCard } = skillCard;

    await setupIntegrationTestRealm({
      loader,
      contents: {
        'seo.json': new SkillCard({ title: 'SEO' }),
        'pirate.json': new SkillCard({ title: 'Talk Like a Pirate' }),
        'card-editing.json': new SkillCard({ title: 'Card Editing' }),
      },
    });
  });

  async function renderAiAssistantPanel() {
    await renderComponent(
      class TestDriver extends GlimmerComponent {
        <template>
          <AiAssistantPanel class='panel' />
          <CardCatalogModal />
          <style>
            .panel {
              width: 370px;
            }
          </style>
        </template>
      },
    );
    await waitFor('[data-test-room-settled]');
    let roomId = document
      .querySelector('[data-test-room]')
      ?.getAttribute('data-test-room');
    if (!roomId) {
      throw new Error('Expected a room ID');
    }
    console.log('Room ID:', roomId);
    return roomId;
  }

  test('it renders', async function (assert) {
    await renderAiAssistantPanel();

    assert.dom('[data-test-ai-assistant-panel]').exists();
    assert.dom('[data-test-room="New AI Assistant Chat"]').exists();
    assert.dom('[data-test-skill-menu-toggle]').exists();
    await click('[data-test-skill-menu-toggle]');
    assert
      .dom('[data-test-skill-menu-toggle]')
      .hasText('0 of 0 Skills Active Hide');

    await click('[data-test-add-skill-button]');
    await waitFor('[data-test-card-catalog]');
    assert.dom('[data-test-boxel-header-title]').hasText('Choose a Skill card');
    await waitFor('[data-test-select]', { count: 3 });
    await click(`[data-test-select="${testRealmURL}card-editing"]`);
    // await this.pauseTest();

    // await addRoomEvent(matrixService, {
    //   event_id: 'event1',
    //   room_id: roomId,
    //   state_key: 'state',
    //   type: 'm.room.message',
    //   origin_server_ts: new Date(2024, 5, 25).getTime(),
    //   sender: matrixService.userId!,
    //   content: {
    //     msgtype: 'org.boxel.message',
    //     formatted_body: 'Hello world!',
    //     format: 'org.matrix.custom.html',
    //   },
    //   status: null,
    // });
  });
});
