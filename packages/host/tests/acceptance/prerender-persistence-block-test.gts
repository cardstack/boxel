import { visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import { Command, type RenderRouteOptions } from '@cardstack/runtime-common';

import SaveCardTool from '@cardstack/host/tools/save-card';

import {
  capturePrerenderResult,
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
} from '../helpers';

import {
  CardDef,
  Component,
  contains,
  field,
  setupBaseRealm,
  StringField,
} from '../helpers/base-realm';

import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// `__boxelPrerenderApp` is the prerender app's blanket persistence block: while
// it is raised, every store in the app drops writes rather than aiming them at
// a realm whose sole indexing worker the render is occupying. The render route
// raises it, and its lifetime is bounded by that route being entered.
//
// A prerender pool tab can be retagged from a realm affinity onto a user
// affinity, and it enters the command route through an in-app transition — so
// the app carries across whatever globals the render left behind. Commands
// write, which makes that hand-off the case worth pinning: a command running
// under the block answers with a card that was never saved.
//
// Outside tests the render route raises the flag itself. Here it is raised by
// hand, because these tests also run an interactive app whose own saves the
// flag would swallow.
module('Acceptance | prerender | persistence block', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  setupBaseRealm(hooks);

  const RENDER_OPTIONS_SEGMENT = encodeURIComponent(
    JSON.stringify({ clearCache: true } as RenderRouteOptions),
  );

  async function renderCard(id: string) {
    await visit(
      `/render/${encodeURIComponent(
        id,
      )}/0/${RENDER_OPTIONS_SEGMENT}/html/isolated/0`,
    );
    return await capturePrerenderResult('textContent');
  }

  function setCommandRunnerRequest(
    requestId: string,
    nonce: string,
    command: string,
  ) {
    window.localStorage.setItem(
      `boxel-command-request:${requestId}`,
      JSON.stringify({
        command,
        input: null,
        nonce,
        createdAt: Date.now(),
      }),
    );
  }

  function raisePersistenceBlock() {
    (globalThis as any).__boxelPrerenderApp = true;
  }

  hooks.beforeEach(async function () {
    class Pet extends CardDef {
      static displayName = 'Pet';
      @field name = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <h2 data-test-pet><@fields.name /></h2>
        </template>
      };
    }

    class SavePetResult extends CardDef {
      static displayName = 'SavePetResult';
      @field savedId = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <span data-test-saved-pet-id><@fields.savedId /></span>
        </template>
      };
    }

    // Reports the id its save came back with, so a dropped write is
    // distinguishable from a durable one: an instance handed back from a
    // blocked store carries no id, which reads as success to every caller.
    class SavePetCommand extends Command<undefined, typeof SavePetResult> {
      static displayName = 'SavePetCommand';
      async getInputType() {
        return undefined;
      }
      protected async run(): Promise<SavePetResult> {
        let saved = await new SaveCardTool(this.toolContext).execute({
          card: new Pet({ name: 'Ringo' }),
          realm: testRealmURL,
        });
        return new SavePetResult({ savedId: saved?.id ?? '' });
      }
    }

    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'pet.gts': { Pet },
        'Pet/mango.json': new Pet({ name: 'Mango' }),
        'save-pet-command.gts': {
          SavePetResult,
          default: SavePetCommand,
        },
      },
    });
  });

  hooks.afterEach(function () {
    delete (globalThis as any).__boxelPrerenderApp;
  });

  test('the block does not outlive the render route', async function (assert) {
    raisePersistenceBlock();
    let { value } = await renderCard(`${testRealmURL}Pet/mango`);
    assert.true(value.includes('Mango'), 'the card rendered');

    await visit('/_standby');
    assert.strictEqual(
      (globalThis as any).__boxelPrerenderApp,
      undefined,
      'leaving the render route drops the persistence block',
    );
  });

  test('a command saves a durable card on a tab that has served a card render', async function (assert) {
    raisePersistenceBlock();
    await renderCard(`${testRealmURL}Pet/mango`);

    let requestId = 'prerender-persistence-block-save';
    let nonce = '1';
    setCommandRunnerRequest(
      requestId,
      nonce,
      `${testRealmURL}save-pet-command/default`,
    );
    await visit(`/command-runner/${requestId}/${nonce}`);
    await waitFor('[data-prerender][data-prerender-status="ready"]');

    let savedId =
      document.querySelector('[data-test-saved-pet-id]')?.textContent?.trim() ??
      '';
    assert.ok(
      savedId.startsWith(testRealmURL),
      `the save came back with a realm id: ${savedId || '<empty>'}`,
    );

    // Read the realm's own source rather than the store, so a card that only
    // ever existed in memory cannot satisfy this.
    let source = await getService('card-service').getSource(
      new URL(`${savedId}.json`),
    );
    assert.strictEqual(source.status, 200, 'the saved card is durable');
    assert.true(
      source.content.includes('Ringo'),
      'the durable document holds what the command wrote',
    );
  });
});
