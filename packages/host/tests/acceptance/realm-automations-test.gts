import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { rri, testRealmInfo } from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

import ShowCardTool from '@cardstack/host/tools/show-card';

import {
  realmConfigCardJSON,
  setupAcceptanceTestRealm,
  setupLocalIndexing,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  testRealmURL,
  visitOperatorMode,
} from '../helpers';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const ME = '@testuser:localhost';
const NIGHTLY = `${testRealmURL}automations/nightly`;
const WEEKLY = `${testRealmURL}automations/weekly`;
// An automation whose card the realm holds, so the section shows the card's
// own fitted view for it.
const DIGEST = `${testRealmURL}automations/digest`;
// A second automation whose card the realm holds.
const REPORT = `${testRealmURL}automations/report`;

const digestJSON = {
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Issue digest', summary: null },
      triggers: [],
      operations: [],
      caps: {
        callApiCalls: 0,
        responseBytes: 0,
        resolveCalls: 0,
        writes: 1,
        seconds: 60,
        dailyCredits: 5,
        monthlyCredits: 10,
        aiCredits: 0,
      },
      params: [],
      batchedAI: false,
      batchDeadlineMinutes: null,
    },
    meta: {
      adoptsFrom: {
        module: rri('@cardstack/catalog/automation/automation'),
        name: 'Automation',
      },
    },
  },
};

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
      notice: null,
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

type Answer = {
  status: number;
  data?: Record<string, unknown>[];
  directWriter?: boolean;
};

module('Acceptance | realm config | Automations', function (hooks) {
  let answer: Answer;
  let asked: number;
  // Whether the Automation card's status route answers that the viewer is a
  // direct writer.
  let statusForWriter: boolean;

  setupApplicationTest(hooks);
  setupCatalogTestSubset(hooks);
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
        'automations/digest.json': digestJSON,
        'automations/report.json': {
          data: {
            ...digestJSON.data,
            attributes: {
              ...digestJSON.data.attributes,
              cardInfo: { name: 'Weekly report', summary: null },
            },
          },
        },
      },
    });
    // The realm's automation list answers from the server's automation rows,
    // which an in-browser test realm doesn't have. Each test says what the
    // route answers.
    answer = { status: 200, directWriter: false };
    asked = 0;
    statusForWriter = false;
    getService('network').virtualNetwork.mount(
      async (request: Request) => {
        let url = new URL(request.url);
        // The Automation card reads its own status, which an in-browser
        // realm has no row for.
        if (url.pathname.endsWith('/_automation-status')) {
          if (statusForWriter) {
            return new Response(
              JSON.stringify({
                data: {
                  type: 'automation-status',
                  id: url.searchParams.get('automation'),
                  attributes: {
                    switchedOn: false,
                    lastRun: null,
                    currentRun: null,
                  },
                },
                meta: { directWriter: true },
              }),
              {
                status: 200,
                headers: { 'content-type': 'application/json' },
              },
            );
          }
          return new Response(JSON.stringify({ errors: [] }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          });
        }
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
        let directWriter = answer.directWriter ?? true;
        return new Response(
          JSON.stringify({
            data: directWriter ? (answer.data ?? []) : [],
            meta: { directWriter },
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        );
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
          'Boxel paused the automation because the payer is no longer a realm administrator.',
        );
    });

    test('an automation that needs the viewer leads the section with a notice whose Show marks the automation', async function (assert) {
      let notice = (reason: string, forViewer: boolean) => ({
        reason,
        audience: 'payer',
        forViewer,
        run: null,
        operation: null,
        credential: null,
      });
      answer = {
        status: 200,
        data: [
          summary(NIGHTLY, {
            ...(ACTIVE.attributes as Record<string, unknown>),
            state: 'waiting-for-credits',
            notice: notice('waiting-for-credits', true),
          }),
          summary(WEEKLY, {
            ...(PAUSED.attributes as Record<string, unknown>),
            pauseReason: 'repeated-failures',
            // Another direct writer pays: the notice is the payer's.
            notice: notice('repeated-failures', false),
          }),
        ],
      };
      await visitConfig();
      await waitFor('[data-test-realm-automations-notices]');
      assert
        .dom('[data-test-realm-automations-notices]')
        .containsText('An automation needs attention');
      assert
        .dom('[data-test-realm-automations-notice]')
        .exists({ count: 1 }, 'only the notice for the viewer is listed');
      assert
        .dom(`[data-test-realm-automations-notice="${NIGHTLY}"]`)
        .containsText(
          'Boxel holds every run of Nightly import because the payer has no credits left.',
        );
      assert
        .dom(
          `[data-test-realm-automation="${NIGHTLY}"] [data-test-realm-automation-needs-attention]`,
        )
        .exists('the automation is marked in the list');
      assert
        .dom(
          `[data-test-realm-automation="${WEEKLY}"] [data-test-realm-automation-needs-attention]`,
        )
        .doesNotExist('an automation with no notice for the viewer is not');

      await click(`[data-test-realm-automations-notice-show="${NIGHTLY}"]`);
      await waitFor(`[data-test-automation-slot-focused="true"]`);
      assert
        .dom(`[data-test-automation-slot="${NIGHTLY}"]`)
        .hasAttribute('aria-current', 'true', 'Show marks the automation');

      answer = {
        status: 200,
        data: [
          summary(NIGHTLY, {
            ...(ACTIVE.attributes as Record<string, unknown>),
          }),
        ],
      };
      sendRealmEvent({ eventName: 'automation', automation: NIGHTLY });
      await waitUntil(
        () => !document.querySelector('[data-test-realm-automations-notices]'),
      );
      assert
        .dom('[data-test-realm-automations-notices]')
        .doesNotExist('the notice ends once the automation runs again');
    });

    test('sees an empty state when the realm has no automations', async function (assert) {
      answer = { status: 200, data: [] };
      await visitConfig();
      await waitFor('[data-test-realm-automations-empty]');
      assert
        .dom('[data-test-realm-automations-empty]')
        .containsText('No automations');
      assert.dom('[data-test-new-automation]').exists();
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
              task: 'Imported the March invoices',
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
        .hasText('Running “Import” — Imported the March invoices');

      answer = { status: 200, data: [PAUSED] };
      sendRealmEvent({ eventName: 'automation', automation: WEEKLY });
      await waitFor(`[data-test-realm-automation="${WEEKLY}"]`);
      assert.dom(`[data-test-realm-automation="${NIGHTLY}"]`).doesNotExist();
    });

    test("an automation whose card the realm holds shows the card's fitted view, and opens in its isolated view", async function (assert) {
      answer = {
        status: 200,
        data: [summary(DIGEST, { title: 'Issue digest' })],
      };
      await visitConfig();
      let slot = `[data-test-automation-slot="${DIGEST}"]`;
      await waitFor(`${slot} [data-test-automation-slot-fitted]`, {
        timeout: 10000,
      });
      assert
        .dom(`${slot} [data-test-automation-fitted]`)
        .containsText('Issue digest', "the card's own fitted view");
      assert
        .dom(`${slot} [data-test-realm-automation]`)
        .doesNotExist('not the one-line summary');

      await click(slot);
      await waitFor(
        `[data-test-stack-card="${DIGEST}"] [data-test-card-format="isolated"]`,
      );
      assert
        .dom(`[data-test-stack-card="${DIGEST}"]`)
        .exists('the click opens the card in its isolated view');
    });

    test("Show in Automations on an automation's card brings the config card back on top, with only that console marking the automation's row", async function (assert) {
      answer = {
        status: 200,
        data: [
          ACTIVE,
          summary(DIGEST, { title: 'Issue digest' }),
          summary(REPORT, { title: 'Weekly report' }),
        ],
      };
      statusForWriter = true;
      // One config card open on the left, and the automation opened on top
      // of another config card on the right, which is what opening an
      // automation from the console and then the console again leaves.
      await visitOperatorMode({
        stacks: [
          [{ id: `${testRealmURL}realm`, format: 'isolated' }],
          [
            { id: `${testRealmURL}realm`, format: 'isolated' },
            { id: DIGEST, format: 'isolated' },
          ],
        ],
      });
      let action = `[data-test-stack-card="${DIGEST}"] [data-test-automation] header [data-test-automation-show-in-console]`;
      await waitFor(action, { timeout: 10000 });
      await click(action);

      let right = '[data-test-operator-mode-stack="1"]';
      await waitFor(`${right} [data-test-stack-card="${DIGEST}"]`, {
        count: 0,
      });
      let slot = `${right} [data-test-automation-slot="${DIGEST}"]`;
      await waitFor(`${slot}[data-test-automation-slot-focused="true"]`, {
        timeout: 10000,
      });
      await waitFor(`${slot} [data-test-automation-slot-fitted]`, {
        timeout: 10000,
      });
      assert
        .dom(`${right} [data-test-stack-card-index="1"]`)
        .doesNotExist(
          'the cards above the config card close, and the config card is on top',
        );
      assert
        .dom(
          `[data-test-operator-mode-stack="0"] [data-test-automation-slot-focused]`,
        )
        .doesNotExist('the console already open on the left marks nothing');
      assert
        .dom(`${right} [data-test-automation-slot="${NIGHTLY}"]`)
        .doesNotHaveAttribute(
          'data-test-automation-slot-focused',
          'only the automation the card came from is marked',
        );
      assert.strictEqual(
        document.activeElement,
        document.querySelector(slot)?.closest('li'),
        "the list's focus moves to the automation's row",
      );
      assert
        .dom(`${slot} [data-test-automation-show-in-console]`)
        .doesNotExist(
          'an automation the console lists offers no way into the console',
        );

      await waitFor(
        `${right} [data-test-automation-slot="${REPORT}"] [data-test-automation-slot-fitted]`,
        { timeout: 10000 },
      );
      await click(`${right} [data-test-automation-slot="${REPORT}"]`);
      assert
        .dom(`${slot}[data-test-automation-slot-focused="true"]`)
        .doesNotExist('opening another automation clears the mark');
    });

    test('Show in Automations reveals the automation when the config card is already on top of the stack it opens in', async function (assert) {
      answer = {
        status: 200,
        data: [ACTIVE, summary(DIGEST, { title: 'Issue digest' })],
      };
      statusForWriter = true;
      // The automation on the left, and the config card already on top of
      // the stack on the right, where the action opens the config card.
      await visitOperatorMode({
        stacks: [
          [{ id: DIGEST, format: 'isolated' }],
          [{ id: `${testRealmURL}realm`, format: 'isolated' }],
        ],
      });
      let right = '[data-test-operator-mode-stack="1"]';
      await waitFor(`${right} [data-test-automation-slot="${DIGEST}"]`, {
        timeout: 10000,
      });
      assert
        .dom(`${right} [data-test-automation-slot-focused]`)
        .doesNotExist('nothing is marked before the click');

      let action = `[data-test-operator-mode-stack="0"] [data-test-automation] header [data-test-automation-show-in-console]`;
      await waitFor(action, { timeout: 10000 });
      await click(action);

      await waitFor(
        `${right} [data-test-automation-slot="${DIGEST}"][data-test-automation-slot-focused="true"]`,
        { timeout: 10000 },
      );
      assert
        .dom(`${right} [data-test-stack-card-index="1"]`)
        .doesNotExist('the config card stays the only card on the right');
    });

    test('Show in Automations that fails to open the config card leaves no mark for a console opened later', async function (assert) {
      answer = {
        status: 200,
        data: [ACTIVE, summary(DIGEST, { title: 'Issue digest' })],
      };
      statusForWriter = true;
      let originalExecute = ShowCardTool.prototype.execute;
      let attempts = 0;
      ShowCardTool.prototype.execute = async function () {
        attempts++;
        throw new Error('the config card could not open');
      };
      try {
        await visitOperatorMode({
          stacks: [[{ id: DIGEST, format: 'isolated' }]],
        });
        let action =
          '[data-test-automation] header [data-test-automation-show-in-console]';
        await waitFor(action, { timeout: 10000 });
        await click(action);
        assert.strictEqual(attempts, 1, 'the action tried to open the card');
      } finally {
        ShowCardTool.prototype.execute = originalExecute;
      }

      await visitConfig();
      let slot = `[data-test-automation-slot="${DIGEST}"]`;
      await waitFor(`${slot} [data-test-automation-slot-fitted]`, {
        timeout: 10000,
      });
      assert
        .dom('[data-test-automation-slot-focused]')
        .doesNotExist('the failed request marks nothing');
    });

    test("New automation opens a new automation in its edit view, in the config card's own stack", async function (assert) {
      answer = { status: 200, data: [ACTIVE] };
      await visitConfig();
      await waitFor('[data-test-realm-automation]');

      await click('[data-test-new-automation]');
      let opened =
        '[data-test-operator-mode-stack="0"] [data-test-stack-card-index="1"]';
      await waitFor(`${opened} [data-test-card-format="edit"]`);
      assert
        .dom(`${opened} [data-test-card-format="edit"]`)
        .exists('the new automation opens in its edit view');
      assert
        .dom(opened)
        .containsText('Automation', 'the new card is an Automation');
      assert
        .dom('[data-test-operator-mode-stack="1"]')
        .doesNotExist('the new automation opens beside nothing');
    });
  });

  module('a reader', function (hooks) {
    hooks.beforeEach(async function () {
      await setupRealm(['read']);
    });

    test("doesn't see the section", async function (assert) {
      answer = { status: 200, directWriter: false };
      await visitConfig();
      await waitUntil(() => asked > 0);
      await settled();

      assert.dom('[data-test-realm-automations] h2').doesNotExist();
      assert.dom('[data-test-realm-automation]').doesNotExist();
      assert.dom('[data-test-new-automation]').doesNotExist();
      assert.dom('[data-test-realm-config-policy]').exists();
    });
  });
});
