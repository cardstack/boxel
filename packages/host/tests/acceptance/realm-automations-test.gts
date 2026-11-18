import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { testRealmInfo } from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const ME = '@testuser:localhost';
const NIGHTLY = `${testRealmURL}automations/nightly`;
const WEEKLY = `${testRealmURL}automations/weekly`;

function summary(
  id: string,
  attributes: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: 'automation-summary',
    id,
    attributes: {
      title: null,
      switchedOn: false,
      state: null,
      pauseReason: null,
      triggers: [],
      nextRun: null,
      payer: null,
      viewerIsPayer: false,
      monthlyCredits: null,
      spentThisMonth: 0,
      lastResult: null,
      lastFinishedAt: null,
      currentRun: null,
      ...attributes,
    },
  };
}

const ACTIVE = summary(NIGHTLY, {
  title: 'Nightly import',
  switchedOn: true,
  state: 'active',
  triggers: [
    {
      label: 'nightly',
      kind: 'cron',
      expression: '30 2 * * *',
      timeZone: 'America/Chicago',
    },
    { label: 'push', kind: 'webhook', webhookPath: 'github-push' },
  ],
  nextRun: '2030-01-01T10:00:00.000Z',
  payer: ME,
  viewerIsPayer: true,
  monthlyCredits: 500,
  spentThisMonth: 42,
  lastResult: 'complete',
  lastFinishedAt: '2030-01-01T09:00:00.000Z',
});

const PAUSED = summary(WEEKLY, {
  title: 'Weekly digest',
  switchedOn: true,
  state: 'paused',
  pauseReason: 'payer-lost-access',
  payer: null,
  monthlyCredits: 80,
});

type Answer = { status: number; data?: Record<string, unknown>[] };

module('Acceptance | realm config | Automations', function (hooks) {
  let answer: Answer;
  let asked: number;

  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: ME,
    activeRealms: [testRealmURL],
  });

  async function setupRealm(permissions: string[]) {
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      permissions: { [ME]: permissions as any },
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'realm.json': realmConfigCardJSON({ name: 'Research Notes' }),
      },
    });
    // The realm's automation list answers from the server's automation rows,
    // which an in-browser test realm doesn't have. Each test says what the
    // route answers.
    answer = { status: 403 };
    asked = 0;
    getService('network').virtualNetwork.mount(
      async (request: Request) => {
        let url = new URL(request.url);
        if (url.href !== `${testRealmURL}_automations`) {
          return null;
        }
        asked++;
        if (answer.status !== 200) {
          return new Response(JSON.stringify({ errors: [] }), {
            status: answer.status,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(JSON.stringify({ data: answer.data ?? [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      { prepend: true },
    );
  }

  async function visitConfig() {
    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}realm`, format: 'isolated' }]],
    });
    await waitFor('[data-test-realm-config-isolated]');
  }

  function sendRealmEvent(content: Record<string, unknown>) {
    mockMatrixUtils.simulateRemoteMessage(
      mockMatrixUtils.getRoomIdForRealmAndUser(testRealmURL, ME),
      testRealmInfo.realmUserId!,
      { ...content, realmURL: testRealmURL },
      { type: APP_BOXEL_REALM_EVENT_TYPE },
    );
  }

  module('a direct writer', function (hooks) {
    hooks.beforeEach(async function () {
      await setupRealm(['read', 'write', 'realm-owner']);
    });

    test('sees each automation with its state and next run', async function (assert) {
      answer = { status: 200, data: [ACTIVE, PAUSED] };
      await visitConfig();
      await waitFor('[data-test-realm-automation]');

      assert
        .dom('[data-test-realm-automations] h2')
        .hasText('Automations', 'the entry is a section of the config');
      assert.deepEqual(
        [...document.querySelectorAll('[data-test-realm-automation]')].map(
          (el) => el.getAttribute('data-test-realm-automation'),
        ),
        [NIGHTLY, WEEKLY],
      );
      let nightly = `[data-test-realm-automation="${NIGHTLY}"]`;
      assert.dom(nightly).containsText('Nightly import');
      assert.dom(`${nightly} [data-test-realm-automation-state="On"]`).exists();
      assert
        .dom(`${nightly} [data-test-realm-automation-next-run]`)
        .hasAttribute('datetime');
      let weekly = `[data-test-realm-automation="${WEEKLY}"]`;
      assert
        .dom(`${weekly} [data-test-realm-automation-state="Paused"]`)
        .exists();
      assert
        .dom(`${weekly} [data-test-realm-automation-glance]`)
        .hasText(
          'Boxel paused the automation because the payer can no longer edit this workspace.',
        );
    });

    test('sees an empty state when the realm has no automations', async function (assert) {
      answer = { status: 200, data: [] };
      await visitConfig();
      await waitFor('[data-test-realm-automations-empty]');
      assert
        .dom('[data-test-realm-automations-empty]')
        .containsText('No automations');
      assert.dom('[data-test-open-automations-console]').exists();
    });

    test('a job or automation event updates the list live', async function (assert) {
      answer = { status: 200, data: [ACTIVE] };
      await visitConfig();
      await waitFor('[data-test-realm-automation-state="On"]');

      answer = {
        status: 200,
        data: [
          summary(NIGHTLY, {
            ...(ACTIVE.attributes as Record<string, unknown>),
            currentRun: {
              runId: 'run-live',
              startedAt: '2030-01-01T10:00:00.000Z',
              milestone: 'Import',
              done: 3,
              total: 9,
            },
          }),
        ],
      };
      sendRealmEvent({
        eventName: 'job',
        runId: 'run-live',
        automation: NIGHTLY,
        state: 'running',
        step: 'script',
        milestone: 'Import',
      });
      await waitFor('[data-test-realm-automation-state="Running"]');
      assert
        .dom('[data-test-realm-automation-glance]')
        .hasText('Running “Import” (3 of 9)');

      answer = { status: 200, data: [PAUSED] };
      sendRealmEvent({ eventName: 'automation', automation: WEEKLY });
      await waitFor(`[data-test-realm-automation="${WEEKLY}"]`);
      assert.dom(`[data-test-realm-automation="${NIGHTLY}"]`).doesNotExist();
    });

    test('opens the console from the entry and from the "…" menu', async function (assert) {
      answer = { status: 200, data: [ACTIVE, PAUSED] };
      await visitConfig();
      await waitFor('[data-test-realm-automation]');

      await click('[data-test-open-automations-console]');
      await waitFor('[data-test-automations-console-automation]');
      let nightly = `[data-test-automations-console-automation="${NIGHTLY}"]`;
      assert.dom(nightly).containsText('Nightly import');
      assert
        .dom(`${nightly} [data-test-automations-console-triggers]`)
        .containsText('nightly');
      assert
        .dom(`${nightly} [data-test-automations-console-triggers]`)
        .containsText('30 2 * * *');
      assert
        .dom(`${nightly} [data-test-automations-console-value="payer"]`)
        .hasText('You');
      assert
        .dom(`${nightly} [data-test-automations-console-value="spend"]`)
        .hasText('42 of 500 credits this month');
      assert
        .dom(`${nightly} [data-test-automations-console-last-result]`)
        .hasText('Completed');
      let weekly = `[data-test-automations-console-automation="${WEEKLY}"]`;
      assert
        .dom(`${weekly} [data-test-automations-console-value="payer"]`)
        .hasText('A person who shares no workspace with you');

      getService('operator-mode-state-service').dismissAutomationsConsole();
      await settled();
      assert.dom('[data-test-automations-console]').doesNotExist();

      await click(
        `[data-test-stack-card="${testRealmURL}realm"] [data-test-more-options-button]`,
      );
      await click('[data-test-boxel-menu-item-text="Automations Console"]');
      await waitFor('[data-test-automations-console-automation]');
      assert
        .dom('[data-test-automations-console-modal]')
        .containsText('Automations in Research Notes');
    });
  });

  module('a reader', function (hooks) {
    hooks.beforeEach(async function () {
      await setupRealm(['read']);
    });

    test("doesn't see the entry or the menu item", async function (assert) {
      answer = { status: 403 };
      await visitConfig();
      await waitUntil(() => asked > 0);
      await settled();

      assert.dom('[data-test-realm-automations] h2').doesNotExist();
      assert.dom('[data-test-realm-automation]').doesNotExist();
      assert.dom('[data-test-realm-config-policy]').exists();

      await click(
        `[data-test-stack-card="${testRealmURL}realm"] [data-test-more-options-button]`,
      );
      assert
        .dom('[data-test-boxel-menu-item-text="Automations Console"]')
        .doesNotExist();
    });
  });
});
