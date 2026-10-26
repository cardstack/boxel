import { module, test } from 'qunit';
import { waitFor } from '@ember/test-helpers';

import { setupApplicationTest } from '@cardstack/host/tests/helpers/setup';
import {
  setupLocalIndexing,
  setupOnSave,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
} from '@cardstack/host/tests/helpers';
import { setupMockMatrix } from '@cardstack/host/tests/helpers/mock-matrix';
import type NetworkService from '@cardstack/host/services/network';

// The card module resolves against this file's own URL, so it names the
// workspace mount — the shape a realm author's test has, and the one that puts
// a mounted module in front of the very first definition lookup a card GET
// makes. Walking on from there into `CardDef.cardInfo` reaches the base mount,
// and the card's template imports a Pret UI component from the pretui mount,
// so rendering this one card exercises all three.
// @ts-expect-error import.meta is ESM, not CJS
const sampleModule: string = new URL('./sample', import.meta.url).href;
const sampleId = `${testRealmURL}Sample/one`;

// Every mount is served from the origin this file was loaded from. A Pret UI
// component that renders while its prefix resolves anywhere else was served by
// a realm-server that happens to be listening, which CI does not have.
// @ts-expect-error import.meta is ESM, not CJS
const mountOrigin: string = new URL(import.meta.url).origin;

export function runTests() {
  module('local-mode card render', function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);
    setupOnSave(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    hooks.beforeEach(async function () {
      await setupAcceptanceTestRealm({
        realmURL: testRealmURL,
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'Sample/one.json': {
            data: {
              type: 'card',
              attributes: { nickname: 'probe' },
              meta: {
                adoptsFrom: { module: sampleModule, name: 'Sample' },
              },
            },
          },
        },
      });
    });

    // The card GET behind this render resolves a definition for the instance's
    // own type and then walks its field tree, and both legs land on a mounted
    // module. A mount that cannot be resolved to an owning realm, or whose
    // module cannot be modelled, fails that GET — the stack item renders the
    // error card and the probe never appears.
    test('renders a card served from the local mounts', async function (assert) {
      await visitOperatorMode({
        stacks: [[{ id: sampleId, format: 'isolated' }]],
      });
      await waitFor('[data-sample-probe]');

      assert.dom('[data-sample-probe]').hasText('probe');
      assert
        .dom('[data-test-sample-pretui-probe]')
        .hasText('Ctrl+K', 'the Pret UI component rendered its face');
      let network = this.owner.lookup('service:network') as NetworkService;
      assert.strictEqual(
        network.virtualNetwork.toURLHref('@cardstack/pretui/components/kbd'),
        `${mountOrigin}/pretui/components/kbd`,
        'Pret UI resolves to the pretui mount',
      );
      assert
        .dom('[data-test-card-error]')
        .doesNotExist('the stack item is not an error card');
    });
  });
}
