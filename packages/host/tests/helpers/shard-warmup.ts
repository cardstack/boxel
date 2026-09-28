// Synthetic warmup module — registered first on every shard so that the
// per-shard "boot cost" (Ember app boot, base-realm imports, mock matrix,
// initial test realm setup) lands on this module rather than on whichever
// real test file ember-exam happens to schedule first. The MEMPROBE_FILE
// line for this module then becomes the "shard boot cost" baseline, and
// real modules report a clean per-file delta independent of position.
//
// Operator mode, code submode's editor and the AI assistant panel load their
// code on first use and keep over 100MB of it for the rest of the shard, so the
// warmup opens each of them rather than stopping at the index route.
//
// Exposed as registerShardWarmup() so test-helper.js can invoke it only
// inside ember-exam partitioned runs — the only context where a per-shard
// warmup makes sense. In live-test mode (software-factory factory-test-realm)
// the warmup module's mock-matrix / acceptance-test-realm setup conflicts
// with the real running realm server, so it must not register there.

import { visit, waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { setupMockMatrix } from './mock-matrix';
import { setupApplicationTest } from './setup';
import visitOperatorMode from './visit-operator-mode';

import {
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupUserSubscription,
  testRealmURL,
} from './index';

// Each surface's first load happens here, cold, on a busy CI runner.
const FIRST_LOAD_TIMEOUT_MS = 30_000;

const warmupCardSource = `
import { CardDef, Component, field, contains } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class WarmupCard extends CardDef {
  static displayName = 'Warmup Card';
  @field name = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template><h1>{{@model.name}}</h1></template>
  };
}
`;

export function registerShardWarmup() {
  module('__shard_warmup__', function (hooks) {
    setupApplicationTest(hooks);
    setupLocalIndexing(hooks);

    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
    });

    let { createAndJoinRoom } = mockMatrixUtils;

    hooks.beforeEach(async function () {
      createAndJoinRoom({
        sender: '@testuser:localhost',
        name: 'room-warmup',
      });
      setupUserSubscription();
      setupAuthEndpoints();

      let loaderService = getService('loader-service');
      let loader = loaderService.loader;
      // Prime the loader with the most commonly imported base-realm modules
      // so subsequent real tests don't pay the import cost.
      await loader.import('@cardstack/base/card-api');
      await loader.import('@cardstack/base/string');
      await loader.import('@cardstack/base/spec');

      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'warmup-card.gts': warmupCardSource,
          'WarmupCard/1.json': {
            data: {
              type: 'card',
              attributes: { name: 'Warmup' },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}warmup-card`,
                  name: 'WarmupCard',
                },
              },
            },
          },
        },
      });
    });

    test('warm boot the test environment', async function (assert) {
      await visit('/');

      let cardId = `${testRealmURL}WarmupCard/1`;
      await visitOperatorMode({
        stacks: [[{ id: cardId, format: 'isolated' }]],
        aiAssistantOpen: true,
      });
      await waitFor(`[data-test-stack-card="${cardId}"]`, {
        timeout: FIRST_LOAD_TIMEOUT_MS,
      });
      await waitFor('[data-test-room-settled]', {
        timeout: FIRST_LOAD_TIMEOUT_MS,
      });

      await visitOperatorMode({
        submode: 'code',
        codePath: `${testRealmURL}warmup-card.gts`,
      });
      await waitFor('[data-test-editor]', {
        timeout: FIRST_LOAD_TIMEOUT_MS,
      });

      assert.ok(true, 'shard warmup completed');
    });
  });
}
