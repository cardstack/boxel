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

// `__boxelPrerenderApp` marks the dedicated prerender app for its whole
// lifetime, and blocks persistence on every store in it: a write from a render
// would aim at a realm whose sole indexing worker that render is occupying.
// The command route is the one place that drops the block, because a command is
// expected to write and its writes index deferred.
//
// Dropping it matters — rather than simply never raising it — because a pool
// tab that has served a card render carries the flag, and the pool can retag
// that tab from its realm affinity onto the user affinity commands run on. The
// tab then enters the command route through an in-app transition, so the app
// keeps whatever globals the render left behind, and a command running under
// the block answers with a card that was never saved.
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

  // The prerender driver always hands the render route the card's `.json` file
  // URL, so render against that rather than the extensionless id.
  async function renderCard(id: string) {
    await visit(
      `/render/${encodeURIComponent(
        `${id}.json`,
      )}/0/${RENDER_OPTIONS_SEGMENT}/html/isolated/0`,
    );
    return await capturePrerenderResult('textContent');
  }

  function runCommand(requestId: string, nonce: string, command: string) {
    window.localStorage.setItem(
      `boxel-command-request:${requestId}`,
      JSON.stringify({
        command,
        input: null,
        nonce,
        createdAt: Date.now(),
      }),
    );
    return visit(`/command-runner/${requestId}/${nonce}`);
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

  test('entering the command route drops the block', async function (assert) {
    raisePersistenceBlock();
    await runCommand(
      'prerender-persistence-block-drop',
      '1',
      `${testRealmURL}save-pet-command/default`,
    );

    assert.strictEqual(
      (globalThis as any).__boxelPrerenderApp,
      undefined,
      'the command route drops the persistence block on entry',
    );
  });

  test('a command saves a durable card on a tab that has served a card render', async function (assert) {
    raisePersistenceBlock();
    let { value } = await renderCard(`${testRealmURL}Pet/mango`);
    assert.true(value.includes('Mango'), 'the card rendered');

    await runCommand(
      'prerender-persistence-block-save',
      '1',
      `${testRealmURL}save-pet-command/default`,
    );
    await waitFor('[data-prerender][data-prerender-status="ready"]');

    let savedId =
      document.querySelector('[data-test-saved-pet-id]')?.textContent?.trim() ??
      '';
    assert.ok(
      savedId.startsWith(testRealmURL),
      `the save came back with a realm id: ${savedId || '<empty>'}`,
    );
    // Read the realm's own source rather than the store, so a card that only
    // ever existed in memory cannot satisfy this. Guarded on a non-empty id:
    // a blocked save yields none, and the read would then fail on URL parsing
    // instead of on the assertion above that explains why.
    if (savedId) {
      let source = await getService('card-service').getSource(
        new URL(`${savedId}.json`),
      );
      assert.strictEqual(source.status, 200, 'the saved card is durable');
      assert.true(
        source.content.includes('Ringo'),
        'the durable document holds what the command wrote',
      );
    }
  });
});
