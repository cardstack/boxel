import { click, fillIn, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';

import ShowCardTool from '@cardstack/host/tools/show-card';
import ShowFileTool from '@cardstack/host/tools/show-file';
import SwitchSubmodeTool from '@cardstack/host/tools/switch-submode';

import {
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  realmConfigCardJSON,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { CardsGrid, setupBaseRealm } from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// A realm the user holds no permission on, as a user a realm's policy admits
// to its cards does, and one they may read and write.
const unreadableRealmURL = testRealmURL;
const readableRealmURL = 'http://test-realm/test2/';

const petSource = `
  import { contains, field, CardDef } from "@cardstack/base/card-api";
  import StringField from "@cardstack/base/string";

  export class Pet extends CardDef {
    static displayName = 'Pet';
    @field name = contains(StringField);
    @field cardTitle = contains(StringField, {
      computeVia: function (this: Pet) {
        return this.name;
      },
    });
  }

  export class Exploding extends CardDef {
    static displayName = 'Exploding';
    @field cardTitle = contains(StringField, {
      computeVia: function () {
        throw new Error('Boom!');
      },
    });
  }
`;

function contents(name: string) {
  return {
    ...SYSTEM_CARD_FIXTURE_CONTENTS,
    'index.json': new CardsGrid(),
    'realm.json': realmConfigCardJSON({ name }),
    'pet.gts': petSource,
    'Pet/mango.json': {
      data: {
        type: 'card',
        attributes: { name: 'Mango' },
        meta: { adoptsFrom: { module: '../pet', name: 'Pet' } },
      },
    },
    'Exploding/boom.json': {
      data: {
        type: 'card',
        attributes: {},
        meta: { adoptsFrom: { module: '../pet', name: 'Exploding' } },
      },
    },
  };
}

module('Acceptance | code submode availability', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, unreadableRealmURL, readableRealmURL],
  });

  setupBaseRealm(hooks);

  hooks.beforeEach(async function () {
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: unreadableRealmURL,
      permissions: { '@testuser:localhost': [] },
      contents: contents('Unreadable Workspace'),
    });
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      realmURL: readableRealmURL,
      permissions: { '@testuser:localhost': ['read', 'write'] },
      contents: contents('Readable Workspace'),
    });
    mockMatrixUtils.setRealmPermissions({
      [unreadableRealmURL]: [],
      [readableRealmURL]: ['read', 'write'],
    });
    mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'room-test',
    });
    setupUserSubscription();
    getService('matrix-service').fetchMatrixHostedFile = async () =>
      new Response('');
  });

  async function openSubmodeMenu() {
    await click('[data-test-submode-switcher] button');
    await waitFor('.submode-switcher-dropdown-menu');
  }

  test('code mode is offered on a card in a realm the user can read', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${readableRealmURL}Pet/mango`, format: 'isolated' }]],
    });
    await openSubmodeMenu();
    assert.dom('[data-test-boxel-menu-item-text="Code"]').exists();
  });

  test('code mode is not offered on a card in a realm the user cannot read', async function (assert) {
    await visitOperatorMode({
      stacks: [[{ id: `${unreadableRealmURL}Pet/mango`, format: 'isolated' }]],
    });
    await waitFor(`[data-test-stack-card="${unreadableRealmURL}Pet/mango"]`);
    await openSubmodeMenu();
    assert.dom('[data-test-boxel-menu-item-text="Code"]').doesNotExist();
  });

  // Switching to code mode opens the last card of the right-most stack, so
  // that card's realm is the one that decides.
  test('code mode is not offered when the card it would open is in a realm the user cannot read', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${readableRealmURL}Pet/mango`, format: 'isolated' }],
        [{ id: `${unreadableRealmURL}Pet/mango`, format: 'isolated' }],
      ],
    });
    await openSubmodeMenu();
    assert.dom('[data-test-boxel-menu-item-text="Code"]').doesNotExist();
  });

  test('code mode is offered when the card it would open is in a realm the user can read', async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${unreadableRealmURL}Pet/mango`, format: 'isolated' }],
        [{ id: `${readableRealmURL}Pet/mango`, format: 'isolated' }],
      ],
    });
    await openSubmodeMenu();
    assert.dom('[data-test-boxel-menu-item-text="Code"]').exists();
  });

  test("a card's error offers code mode only in a realm the user can read", async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${readableRealmURL}Exploding/boom`, format: 'isolated' }],
      ],
    });
    await click('[data-test-toggle-details]');
    assert.dom('[data-test-error-details]').exists();
    assert.dom('[data-test-view-in-code-mode-button]').exists();

    await visitOperatorMode({
      stacks: [
        [{ id: `${unreadableRealmURL}Exploding/boom`, format: 'isolated' }],
      ],
    });
    await click('[data-test-toggle-details]');
    assert.dom('[data-test-error-details]').exists();
    assert.dom('[data-test-view-in-code-mode-button]').doesNotExist();
  });
  // A card the assistant panel attaches from the open stack, once sent, is a
  // pill whose menu can open it in code mode.
  async function openSentCardMenu(cardId: string) {
    await visitOperatorMode({ stacks: [[{ id: cardId, format: 'isolated' }]] });
    await click('[data-test-open-ai-assistant]');
    await waitFor('[data-room-settled]');
    await waitFor('[data-test-autoattached-card]');
    await fillIn('[data-test-message-field]', 'About this card');
    await click('[data-test-send-message-btn]');
    await click('[data-test-attached-file-dropdown-button="Mango"]');
    await waitFor('[data-test-boxel-menu-item-text="Copy Submitted Content"]');
  }

  test('an attached card offers code mode in a realm the user can read', async function (assert) {
    await openSentCardMenu(`${readableRealmURL}Pet/mango`);
    assert.dom('[data-test-boxel-menu-item-text="Open in Code Mode"]').exists();
  });

  test('an attached card does not offer code mode in a realm the user cannot read', async function (assert) {
    await openSentCardMenu(`${unreadableRealmURL}Pet/mango`);
    assert
      .dom('[data-test-boxel-menu-item-text="Open in Code Mode"]')
      .doesNotExist();
  });

  test("the assistant's tools open code mode only in a realm the user can read", async function (assert) {
    await visitOperatorMode({
      stacks: [
        [{ id: `${readableRealmURL}Pet/mango`, format: 'isolated' }],
        [{ id: `${unreadableRealmURL}Pet/mango`, format: 'isolated' }],
      ],
    });
    await waitFor(`[data-test-stack-card="${unreadableRealmURL}Pet/mango"]`);
    let { toolContext } = getService('tool-service');
    let operatorModeStateService = getService('operator-mode-state-service');
    await assert.rejects(
      new SwitchSubmodeTool(toolContext).execute({ submode: 'code' }),
      /Code mode is not available/,
      'switching opens the right-most card, which the user cannot read',
    );
    await assert.rejects(
      new ShowFileTool(toolContext).execute({
        fileIdentifier: `${unreadableRealmURL}pet.gts`,
      }),
      /Code mode is not available/,
      'nor is a module of its realm shown',
    );
    assert.strictEqual(
      operatorModeStateService.state.submode,
      'interact',
      'and the user stays in interact mode',
    );
    await new ShowFileTool(toolContext).execute({
      fileIdentifier: `${readableRealmURL}pet.gts`,
    });
    assert.strictEqual(
      operatorModeStateService.state.submode,
      'code',
      'a module of a realm the user can read is shown in code mode',
    );
    await assert.rejects(
      new ShowCardTool(toolContext).execute({
        cardId: `${unreadableRealmURL}Pet/mango`,
      }),
      /Code mode is not available/,
      'in code mode, a card whose module the user cannot read is not shown',
    );
    assert.strictEqual(
      operatorModeStateService.state.codePath?.href,
      `${readableRealmURL}pet.gts`,
      'and the editor stays where it was',
    );
  });
});
