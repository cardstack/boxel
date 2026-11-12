import { waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, rri } from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  visitOperatorMode,
  setupAuthEndpoints,
  setupUserSubscription,
} from '../helpers';
import { setupCatalogTestSubset } from '../helpers/catalog-test-subset';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

const AUTOMATION = `${testRealmURL}automations/nightly`;
const AUTOMATION_MODULE = rri('@cardstack/catalog/automation/automation');

function trigger(kind: string, extra: Record<string, unknown> = {}) {
  return {
    kind,
    label: null,
    expression: null,
    timeZone: 'America/Chicago',
    untilDate: null,
    untilTime: null,
    count: null,
    date: null,
    time: null,
    webhookPath: null,
    ...extra,
  };
}

// One trigger of each kind, and a bounded and an unbounded schedule.
const automationJSON = {
  data: {
    type: 'card',
    attributes: {
      cardInfo: { name: 'Nightly import', summary: null },
      triggers: [
        trigger('cron', {
          label: 'nightly',
          expression: '30 2 * * *',
          untilDate: '2030-01-15',
          count: 30,
        }),
        trigger('cron', { label: 'hourly', expression: '0 * * * *' }),
        trigger('once', {
          label: 'kickoff',
          date: '2030-06-10',
          time: '09:00',
        }),
        trigger('webhook', {
          label: 'push',
          timeZone: null,
          webhookPath: 'github-push',
        }),
      ],
      operations: [],
      caps: {
        callApiCalls: 0,
        responseBytes: 0,
        resolveCalls: 0,
        writes: 1,
        seconds: 60,
        dailyCredits: 5,
        monthlyCredits: 10,
      },
      params: [],
      batchedAI: false,
      batchDeadlineMinutes: null,
    },
    relationships: { script: { links: { self: '../scripts/nightly.js' } } },
    meta: { adoptsFrom: { module: AUTOMATION_MODULE, name: 'Automation' } },
  },
};

// Shows the automation embedded and fitted, as a list or a link would.
const HOLDER = `
  import { CardDef, Component, field, linksTo } from '@cardstack/base/card-api';
  import { Automation } from '@cardstack/catalog/automation/automation';
  export class Holder extends CardDef {
    static displayName = 'Holder';
    @field automation = linksTo(() => Automation);
    static isolated = class Isolated extends Component<typeof this> {
      <template>
        <div data-test-holder-embedded><@fields.automation @format='embedded' /></div>
        <div data-test-holder-fitted style='width: 250px; height: 170px'>
          <@fields.automation @format='fitted' />
        </div>
      </template>
    };
  }
`;

const ACTIVE = {
  switchedOn: true,
  state: 'active',
  pauseReason: null,
  payer: '@testuser:localhost',
  viewerIsPayer: true,
  nextRun: '2030-01-01T10:00:00.000Z',
  lastResult: 'complete',
  lastFinishedAt: '2030-01-01T09:00:00.000Z',
  triggers: [
    {
      label: 'nightly',
      runs: 4,
      runsLeft: 26,
      until: '2030-01-16T05:59:00.000Z',
      nextRun: '2030-01-02T08:30:00.000Z',
      spent: false,
    },
    {
      label: 'hourly',
      runs: 12,
      nextRun: '2030-01-01T10:00:00.000Z',
      spent: false,
    },
    {
      label: 'kickoff',
      runs: 0,
      runsLeft: 1,
      until: '2030-06-10T14:00:00.000Z',
      nextRun: '2030-06-10T14:00:00.000Z',
      spent: false,
    },
    { label: 'push', runs: 3, spent: false },
  ],
};

type Answer = { status: number; attributes?: Record<string, unknown> };

module('Acceptance | automation view', function (hooks) {
  let answer: Answer;
  let asked: string[];

  setupApplicationTest(hooks);
  setupCatalogTestSubset(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  hooks.beforeEach(async function () {
    mockMatrixUtils.setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
    });
    setupUserSubscription();
    setupAuthEndpoints();
    await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'scripts/nightly.js': `const { cards } = await realm.cards.search({});\n`,
        'automations/nightly.json': automationJSON,
        'holder.gts': HOLDER,
        'holders/one.json': {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'Holder' } },
            relationships: {
              automation: { links: { self: '../automations/nightly' } },
            },
            meta: { adoptsFrom: { module: '../holder', name: 'Holder' } },
          },
        },
      },
    });

    // The realm's status route answers from the server's automation row,
    // which an in-browser test realm doesn't have. Each test says what the
    // route answers.
    answer = { status: 403 };
    asked = [];
    getService('network').virtualNetwork.mount(
      async (request: Request) => {
        let url = new URL(request.url);
        if (!url.pathname.endsWith('/_automation-status')) {
          return null;
        }
        asked.push(url.searchParams.get('automation') ?? '');
        if (answer.status !== 200) {
          return new Response(JSON.stringify({ errors: [] }), {
            status: answer.status,
            headers: { 'content-type': 'application/json' },
          });
        }
        return new Response(
          JSON.stringify({
            data: {
              type: 'automation-status',
              id: AUTOMATION,
              attributes: answer.attributes,
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      { prepend: true },
    );
  });

  async function openIsolated() {
    await visitOperatorMode({
      stacks: [[{ id: AUTOMATION, format: 'isolated' }]],
    });
    await waitFor('[data-test-automation-trigger-icon], .automation', {
      timeout: 10000,
    });
  }

  function text(selector: string) {
    return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ');
  }

  async function waitForStatus() {
    await waitFor('[data-test-automation-status]', { timeout: 10000 });
  }

  test('a viewer the route refuses sees the card alone, with who turns the automation on and who pays', async function (assert) {
    await openIsolated();
    await waitUntil(() => asked.length > 0, { timeout: 10000 });
    assert.deepEqual(
      [...new Set(asked)],
      [AUTOMATION],
      'the view asks about this card',
    );
    assert.dom('[data-test-automation-who-pays]').exists();
    assert.dom('[data-test-automation-status]').doesNotExist();
    assert.dom('[data-test-automation-header-state]').doesNotExist();
    assert.dom('[data-test-automation-trigger-progress]').doesNotExist();
    assert
      .dom('.automation')
      .includesText(
        'This trigger stops after 30 runs or at the end of Jan 15, 2030, whichever comes first.',
        "the card's own bounds still read",
      );

    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}holders/one`, format: 'isolated' }]],
    });
    await waitFor('[data-test-automation-embedded]', { timeout: 30000 });
    await waitFor('[data-test-automation-fitted]', { timeout: 30000 });
    assert.dom('[data-test-automation-embedded-state]').doesNotExist();
    assert.dom('[data-test-automation-fitted-state]').doesNotExist();
    assert
      .dom('[data-test-automation-embedded-trigger]')
      .exists({ count: 4 }, 'the embedded view lists each trigger in words');
  });

  test('an automation nobody has switched on reads as off', async function (assert) {
    answer = { status: 200, attributes: { switchedOn: false } };
    await openIsolated();
    await waitForStatus();
    assert.dom('[data-test-automation-state="Off"]').exists();
    assert.dom('[data-test-automation-header-state="Off"]').exists();
    assert
      .dom('[data-test-automation-state-sentence]')
      .hasText(
        'Nobody has turned this automation on, so Boxel runs nothing. Anyone who can edit this workspace can turn the automation on, and that person then pays for every run.',
      );
    assert.dom('[data-test-automation-status]').includesText('Nobody yet');
    assert.dom('[data-test-automation-trigger-progress]').doesNotExist();
  });

  test("an active automation shows its payer, next run and each trigger's progress", async function (assert) {
    answer = { status: 200, attributes: ACTIVE };
    await openIsolated();
    await waitForStatus();
    assert.dom('[data-test-automation-state="On"]').exists();
    assert.dom('[data-test-automation-status]').includesText('Paid by You');
    assert
      .dom('[data-test-automation-status]')
      .includesText('Last run: Completed');

    let nightly = text('[data-test-automation-trigger-progress="nightly"]');
    assert.ok(nightly?.includes('Runs so far 4'), nightly);
    assert.ok(nightly?.includes('Runs left 26'), nightly);
    assert.ok(nightly?.includes('Ends no later than'), nightly);

    let hourly = text('[data-test-automation-trigger-progress="hourly"]');
    assert.ok(hourly?.includes('Runs so far 12'), hourly);
    assert.notOk(
      hourly?.includes('Runs left'),
      'an unbounded schedule has no runs left',
    );

    let kickoff = text('[data-test-automation-trigger-progress="kickoff"]');
    assert.ok(kickoff?.includes('Runs left 1'), kickoff);

    let push = text('[data-test-automation-trigger-progress="push"]');
    assert.ok(push?.includes('Runs so far 3'), push);
    assert.notOk(push?.includes('Next run'), 'a webhook has no next run');

    await visitOperatorMode({
      stacks: [[{ id: `${testRealmURL}holders/one`, format: 'isolated' }]],
    });
    await waitFor('[data-test-automation-embedded-state="On"]', {
      timeout: 10000,
    });
    await waitFor('[data-test-automation-fitted-state="On"]', {
      timeout: 10000,
    });
    assert.dom('[data-test-automation-embedded-state="On"]').exists();
    assert.dom('[data-test-automation-fitted-state="On"]').exists();
  });

  test('a payer who shares no workspace with the viewer is not named', async function (assert) {
    answer = {
      status: 200,
      attributes: { ...ACTIVE, payer: null, viewerIsPayer: false },
    };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-status]')
      .includesText('Paid by A person who shares no workspace with you');
  });

  test('a paused, waiting and done automation each read with that state', async function (assert) {
    let cases: [Record<string, unknown>, string, string][] = [
      [
        { state: 'paused', pauseReason: 'requested' },
        'Paused',
        'Someone who can edit this workspace paused the automation, so Boxel runs nothing until someone resumes the automation.',
      ],
      [
        { state: 'paused', pauseReason: 'caps-raised' },
        'Paused',
        'An edit raised a limit above what the payer agreed to pay for, so Boxel paused the automation. Boxel runs nothing until someone who can edit this workspace resumes the automation and agrees to the new limits.',
      ],
      [
        { state: 'paused', pauseReason: 'payer-lost-access' },
        'Paused',
        'The payer can no longer edit this workspace, so Boxel paused the automation. Boxel runs nothing until someone who can edit this workspace resumes the automation and becomes the new payer.',
      ],
      [
        { state: 'waiting-for-credits', pauseReason: null },
        'Waiting for credits',
        'The payer has no credits left, so Boxel holds every run. Boxel runs the automation again once the payer adds credits.',
      ],
      [
        {
          state: 'done',
          pauseReason: null,
          nextRun: null,
          triggers: ACTIVE.triggers.map((t) => ({
            ...t,
            runsLeft: t.runsLeft === undefined ? undefined : 0,
            nextRun: undefined,
            spent: t.label !== 'push' && t.label !== 'hourly',
          })),
        },
        'Done',
        'Every trigger has started as many runs as the trigger allows, so Boxel runs nothing more. Adding a trigger starts the automation again.',
      ],
    ];
    for (let [change, label, sentence] of cases) {
      answer = { status: 200, attributes: { ...ACTIVE, ...change } };
      // A view asks once when it mounts, so each state gets a fresh view.
      await visitOperatorMode({
        stacks: [[{ id: `${testRealmURL}holders/one`, format: 'isolated' }]],
      });
      await waitFor('[data-test-automation-embedded]', { timeout: 30000 });
      await openIsolated();
      await waitUntil(
        () =>
          text('[data-test-automation-state-sentence]')?.trim() === sentence,
        { timeout: 10000, timeoutMessage: `${label} never read "${sentence}"` },
      );
      assert.dom(`[data-test-automation-state="${label}"]`).exists();
      if (label === 'Paused') {
        assert
          .dom('[data-test-automation-status]')
          .includesText('Next run None while paused');
        assert
          .dom('[data-test-automation-trigger-progress="hourly"]')
          .doesNotIncludeText('Next run', 'a paused trigger has no next run');
      }
      assert
        .dom('[data-test-automation-state-sentence]')
        .hasText(sentence, `${label}: ${String(change.pauseReason)}`);
    }
    assert
      .dom('[data-test-automation-trigger-progress="nightly"]')
      .includesText('Runs left None', 'a spent trigger has no runs left');
    assert
      .dom('[data-test-automation-status]')
      .includesText('None scheduled', 'a done automation has no next run');
  });
});
