import {
  click,
  fillIn,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  baseRealm,
  rri,
  testRealmInfo,
  type Realm,
} from '@cardstack/runtime-common';
import { APP_BOXEL_REALM_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';

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
const PLANNED = `${testRealmURL}automations/planned`;
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
        aiCredits: 0,
      },
      params: [],
      batchedAI: false,
      batchDeadlineMinutes: null,
    },
    relationships: { script: { links: { self: '../scripts/nightly.js' } } },
    meta: { adoptsFrom: { module: AUTOMATION_MODULE, name: 'Automation' } },
  },
};

const ACTIVE = {
  switchedOn: true,
  state: 'active',
  pauseReason: null,
  payer: '@testuser:localhost',
  viewerIsPayer: true,
  nextRun: '2030-01-01T10:00:00.000Z',
  lastResult: 'complete',
  lastFinishedAt: '2030-01-01T09:00:00.000Z',
  failuresInARow: 0,
  lastFailure: null,
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

// A card module the realm indexes after the automation's status was asked.
const NOTE_MODULE = `
  import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  export class Note extends CardDef {
    static displayName = 'Note';
    @field body = contains(StringField);
    static isolated = class Isolated extends Component<typeof this> {
      <template><p data-test-note><@fields.body /></p></template>
    };
  }
`;

// A run as the realm's `_automation-runs` route lists it.
type Run = { id: string } & Record<string, unknown>;

function run(id: string, attributes: Record<string, unknown> = {}): Run {
  return {
    id,
    startedBy: 'trigger',
    trigger: 'nightly',
    slot: '2030-01-01T08:30:00.000Z',
    state: 'complete',
    step: 'script',
    errorReason: null,
    errorMessage: null,
    scriptLine: null,
    cap: null,
    canceledBy: null,
    canceledByAPerson: false,
    viewerCanceled: false,
    actsAs: '@testuser:localhost',
    viewerIsActsAs: true,
    createdAt: '2030-01-01T08:30:00.000Z',
    startedAt: '2030-01-01T08:30:05.000Z',
    finishedAt: '2030-01-01T08:31:00.000Z',
    joined: [],
    milestones: null,
    waitingFor: null,
    ...attributes,
  };
}

// What the status route answers: a direct writer the automation's
// attributes, and any other viewer the realm lets read that it isn't a
// direct writer.
type Answer = { status: number; attributes?: Record<string, unknown> };

module('Acceptance | automation view', function (hooks) {
  let answer: Answer;
  let asked: string[];
  let realm: Realm;

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
    ({ realm } = await setupAcceptanceTestRealm({
      mockMatrixUtils,
      contents: {
        ...SYSTEM_CARD_FIXTURE_CONTENTS,
        'scripts/nightly.js': `const { cards } = await realm.cards.search({});\n`,
        'automations/nightly.json': automationJSON,
        'scripts/planned.js': [
          "realm.progress.plan(['Fetch open issues', 'Group by label', 'Write digest']);",
          "realm.progress.milestone('Fetch open issues');",
          '',
        ].join('\n'),
        'automations/planned.json': {
          ...automationJSON,
          data: {
            ...automationJSON.data,
            relationships: {
              script: { links: { self: '../scripts/planned.js' } },
            },
          },
        },
      },
    }));

    // The realm's status route answers from the server's automation row,
    // which an in-browser test realm doesn't have. Each test says what the
    // route answers; by default, that the viewer isn't a direct writer.
    answer = { status: 200 };
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
          JSON.stringify(
            answer.attributes
              ? {
                  data: {
                    type: 'automation-status',
                    id: AUTOMATION,
                    attributes: answer.attributes,
                  },
                  meta: { directWriter: true },
                }
              : { data: null, meta: { directWriter: false } },
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
      { prepend: true },
    );
  });

  async function openIsolated(id = AUTOMATION) {
    await visitOperatorMode({
      stacks: [[{ id, format: 'isolated' }]],
    });
    await waitFor('[data-test-automation]', {
      timeout: 10000,
    });
  }

  // The automation in one format, as code mode previews it.
  async function openFormat(format: 'embedded' | 'fitted', id = AUTOMATION) {
    await visitOperatorMode({
      submode: 'code',
      codePath: `${id}.json`,
    });
    await click(`[data-test-format-chooser="${format}"]`);
    await waitFor(`[data-test-automation-${format}]`, { timeout: 10000 });
  }

  function text(selector: string) {
    return document.querySelector(selector)?.textContent?.replace(/\s+/g, ' ');
  }

  async function waitForStatus() {
    await waitFor('[data-test-automation-status]', { timeout: 10000 });
  }

  test("a viewer who isn't a direct writer sees the card alone, with who turns the automation on and who pays", async function (assert) {
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
      .dom('[data-test-automation]')
      .includesText(
        'This trigger stops after 30 runs or at the end of Jan 15, 2030, whichever comes first.',
        "the card's own bounds still read",
      );
    assert
      .dom('[data-test-automation-webhook-notice]')
      .doesNotExist(
        'without the server status, the card says nothing about webhook runs',
      );

    await openFormat('embedded');
    assert.dom('[data-test-automation-embedded-state]').doesNotExist();
    assert
      .dom('[data-test-automation-embedded-trigger]')
      .exists({ count: 4 }, 'the embedded view lists each trigger in words');
    await openFormat('fitted');
    assert.dom('[data-test-automation-fitted-state]').doesNotExist();
  });

  // The in-page indexer this test runs listens for the host's auth-error
  // event, which any 401 or 403 through `authedFetch` sends, and fails the
  // next load it races on one. The status route's answer to a viewer who
  // isn't a direct writer is no such refusal, so a card module the realm
  // indexes after that viewer opens an automation still loads.
  test("a card the realm indexes after a viewer who isn't a direct writer opens an automation still loads", async function (assert) {
    await openIsolated();
    await waitUntil(() => asked.length > 0, { timeout: 10000 });
    await settled();
    assert.dom('[data-test-automation-status]').doesNotExist();

    await realm.write('note.gts', NOTE_MODULE);
    await realm.write(
      'notes/first.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: { body: 'Loaded beside the automation' },
          meta: { adoptsFrom: { module: '../note', name: 'Note' } },
        },
      }),
    );
    await visitOperatorMode({
      stacks: [
        [{ id: AUTOMATION, format: 'isolated' }],
        [{ id: `${testRealmURL}notes/first`, format: 'isolated' }],
      ],
    });
    await waitFor('[data-test-note]', { timeout: 10000 });
    assert
      .dom('[data-test-note]')
      .hasText('Loaded beside the automation', 'the other card loads');
    assert.dom('[data-test-automation]').exists();
  });

  test('an automation nobody has switched on reads as off', async function (assert) {
    answer = {
      status: 200,
      attributes: { switchedOn: false, lastRun: null, currentRun: null },
    };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-webhook-notice]')
      .doesNotExist(
        'a server that starts runs from webhooks, or says nothing, gets no warning',
      );
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

  test('each webhook trigger warns that the trigger can’t fire while the server starts no runs from webhooks', async function (assert) {
    answer = {
      status: 200,
      attributes: {
        switchedOn: false,
        webhookDeliveriesStartRuns: false,
        lastRun: null,
        currentRun: null,
      },
    };
    await openIsolated();
    await waitFor('[data-test-automation-webhook-notice]', { timeout: 10000 });
    assert
      .dom('[data-test-automation-webhook-notice]')
      .exists({ count: 1 }, 'the webhook trigger, and no other, warns');
    assert
      .dom('[data-test-automation-webhook-notice]')
      .hasText(
        'This trigger can’t fire, Boxel doesn’t run automations from webhooks.',
      );
  });
  test("an active automation shows its payer, next run and each trigger's progress", async function (assert) {
    answer = { status: 200, attributes: ACTIVE };
    await openIsolated();
    await waitForStatus();
    assert.dom('[data-test-automation-state="On"]').exists();
    assert.dom('[data-test-automation-status]').includesText('Payer You');
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

    await openFormat('embedded');
    await waitFor('[data-test-automation-embedded-state="On"]', {
      timeout: 10000,
    });
    await openFormat('fitted');
    await waitFor('[data-test-automation-fitted-state="On"]', {
      timeout: 10000,
    });
    assert.dom('[data-test-automation-fitted-state="On"]').exists();
  });

  test("a job event naming the automation makes the view ask its status again, and one naming another automation doesn't", async function (assert) {
    // A run moving changes the automation's row and not its card, so the
    // realm tells its direct writers with a `job` event, the way the realm
    // server sends one into a writer's session room.
    function simulateJob(automation: string) {
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(
          testRealmURL,
          '@testuser:localhost',
        ),
        testRealmInfo.realmUserId!,
        {
          eventName: 'job',
          runId: 'run-live',
          automation,
          state: 'running',
          step: 'script',
          milestone: null,
          realmURL: testRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
    }

    answer = { status: 200, attributes: ACTIVE };
    await openIsolated();
    await waitFor('[data-test-automation-state="On"]', { timeout: 10000 });
    await settled();
    let askedBefore = asked.length;

    answer = {
      status: 200,
      attributes: { ...ACTIVE, state: 'paused', pauseReason: 'requested' },
    };
    simulateJob(PLANNED);
    await settled();
    assert.strictEqual(
      asked.length,
      askedBefore,
      'a job event naming another automation asks nothing',
    );
    assert.dom('[data-test-automation-state="On"]').exists();

    simulateJob(AUTOMATION);
    await waitFor('[data-test-automation-state="Paused"]', { timeout: 10000 });
    await settled();
    // One read per event: an ask the other automation's event had set off,
    // however late it landed, would show here as a second.
    assert.deepEqual(
      asked.slice(askedBefore),
      [AUTOMATION],
      'a job event naming the automation asks its status route once',
    );
    assert
      .dom('[data-test-automation-status]')
      .includesText('Next run None while paused');
  });

  test("an automation event naming the automation makes the view ask its status again, and one naming another automation doesn't", async function (assert) {
    // Switching an automation on, pausing, resuming or removing it changes
    // its row and not its card, so the realm tells its direct writers with an
    // `automation` event, the way the realm server sends one into a writer's
    // session room.
    function simulateAutomationChange(automation: string) {
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(
          testRealmURL,
          '@testuser:localhost',
        ),
        testRealmInfo.realmUserId!,
        {
          eventName: 'automation',
          automation,
          realmURL: testRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
    }

    answer = {
      status: 200,
      attributes: { ...ACTIVE, state: 'paused', pauseReason: 'requested' },
    };
    await openIsolated();
    await waitFor('[data-test-automation-state="Paused"]', { timeout: 10000 });
    await settled();
    let askedBefore = asked.length;

    answer = { status: 200, attributes: ACTIVE };
    simulateAutomationChange(PLANNED);
    await settled();
    assert.strictEqual(
      asked.length,
      askedBefore,
      'an automation event naming another automation asks nothing',
    );
    assert.dom('[data-test-automation-state="Paused"]').exists();

    simulateAutomationChange(AUTOMATION);
    await waitFor('[data-test-automation-state="On"]', { timeout: 10000 });
    await settled();
    // One read per event: an ask the other automation's event had set off,
    // however late it landed, would show here as a second.
    assert.deepEqual(
      asked.slice(askedBefore),
      [AUTOMATION],
      'an automation event naming the automation asks its status route once',
    );
    assert
      .dom('[data-test-automation-status]')
      .doesNotIncludeText('Next run None');
  });

  test("the card lists the milestones of the automation's last run from the run", async function (assert) {
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        lastRun: {
          runId: 'run-1',
          state: 'error',
          startedAt: '2030-01-01T08:59:00.000Z',
          finishedAt: '2030-01-01T09:00:00.000Z',
          plan: ['Fetch issues', 'Group by label', 'Write digest'],
          milestones: [
            {
              name: 'Fetch issues',
              planned: true,
              startedAt: '2030-01-01T08:59:00.000Z',
              endedAt: '2030-01-01T08:59:04.000Z',
              ms: 4_000,
              done: 30,
              total: 30,
            },
            {
              name: 'Retry',
              planned: false,
              startedAt: '2030-01-01T08:59:04.000Z',
              endedAt: '2030-01-01T08:59:05.000Z',
              ms: 1_000,
            },
            {
              name: 'Group by label',
              planned: true,
              startedAt: '2030-01-01T08:59:05.000Z',
              endedAt: '2030-01-01T09:00:00.000Z',
              ms: 55_000,
              done: 12,
              total: 40,
            },
          ],
          ahead: ['Write digest'],
          failedIn: 'Group by label',
          dropped: 0,
        },
      },
    };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-milestones-lead]')
      .hasText(
        'The milestones the script reported on the last run, which ended with an error.',
      );
    let milestones = text('[data-test-automation-milestones]') ?? '';
    for (let expected of [
      'Fetch issues',
      'Took 4 s · 30 of 30',
      'Retry',
      'Took 1 s · Not in the plan',
      'Group by label',
      'Failed here',
      'Ran for 55 s · 12 of 40',
      'Write digest',
      'Not started',
    ]) {
      assert.true(milestones.includes(expected), `shows "${expected}"`);
    }
    let order = ['Fetch issues', 'Retry', 'Group by label', 'Write digest'].map(
      (name) => milestones.indexOf(name),
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
      'in the order the run reached them, then the ones it never reached',
    );
    assert.deepEqual(
      [
        ...document.querySelectorAll(
          '[data-test-automation-milestones] [data-test-milestone-state]',
        ),
      ].map((step) => step.getAttribute('data-test-milestone-state')),
      ['reached', 'reached', 'failed', 'not-started'],
      'done up to the failure, failed there, and not started after it',
    );
  });

  test('a run in progress shows the milestone it is in as running, the ones before it done and the ones after it not started', async function (assert) {
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        lastRun: null,
        currentRun: {
          runId: 'run-live',
          state: 'running',
          current: 'Group by label',
          startedAt: '2030-01-01T08:59:00.000Z',
          finishedAt: null,
          plan: ['Fetch issues', 'Group by label', 'Write digest'],
          milestones: [
            {
              name: 'Fetch issues',
              planned: true,
              startedAt: '2030-01-01T08:59:00.000Z',
              endedAt: '2030-01-01T08:59:04.000Z',
              ms: 4_000,
            },
            {
              name: 'Group by label',
              planned: true,
              startedAt: '2030-01-01T08:59:04.000Z',
              endedAt: null,
              ms: 90_000,
              done: 140,
              total: 412,
            },
          ],
          ahead: ['Write digest'],
          failedIn: null,
          dropped: 0,
        },
      },
    };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-milestones-lead]')
      .hasText(
        'The milestones the script has reported on the run in progress.',
      );
    let states = [
      ...document.querySelectorAll(
        '[data-test-automation-milestones] [data-test-milestone-state]',
      ),
    ].map((step) => step.getAttribute('data-test-milestone-state'));
    assert.deepEqual(states, ['reached', 'running', 'not-started']);
    let milestones = text('[data-test-automation-milestones]') ?? '';
    for (let expected of [
      'Running for 1 min 30 s · 140 of 412',
      'Not started',
    ]) {
      assert.true(milestones.includes(expected), `shows "${expected}"`);
    }
  });

  test('the milestone a stopped run was in reads as stopped, and the ones after it as not started', async function (assert) {
    let milestone = (name: string, ms: number) => ({
      name,
      planned: true,
      startedAt: '2030-01-01T08:59:00.000Z',
      endedAt: '2030-01-01T09:00:00.000Z',
      ms,
    });
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        lastRun: {
          runId: 'run-2',
          state: 'canceled',
          startedAt: '2030-01-01T08:59:00.000Z',
          finishedAt: '2030-01-01T09:00:00.000Z',
          plan: ['Fetch', 'Write'],
          milestones: [milestone('Fetch', 3_000)],
          ahead: ['Write'],
          failedIn: null,
          dropped: 0,
        },
      },
    };
    await openIsolated();
    await waitForStatus();
    let states = [
      ...document.querySelectorAll(
        '[data-test-automation-milestones] [data-test-milestone-state]',
      ),
    ].map((step) => step.getAttribute('data-test-milestone-state'));
    assert.deepEqual(states, ['stopped', 'not-started']);
    assert
      .dom('[data-test-automation-milestones]')
      .includesText('Stopped here');
  });

  test('a run that marked more milestones than a run records says so', async function (assert) {
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        lastRun: {
          runId: 'run-3',
          state: 'complete',
          startedAt: '2030-01-01T08:59:00.000Z',
          finishedAt: '2030-01-01T09:00:00.000Z',
          plan: [],
          milestones: [
            {
              name: 'Item 200',
              planned: false,
              startedAt: '2030-01-01T08:59:00.000Z',
              endedAt: '2030-01-01T09:00:00.000Z',
              ms: 60_000,
            },
          ],
          ahead: [],
          failedIn: null,
          dropped: 12,
        },
      },
    };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-milestones-lead]')
      .includesText(
        'The script marked 12 more milestones past the 200 a run records',
      );
  });

  test('an automation with no ended run says milestones show after a run ends', async function (assert) {
    answer = { status: 200, attributes: { ...ACTIVE, lastRun: null } };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-milestones]')
      .includesText(
        'The milestones the script reports show here after a run ends.',
      );
    assert.dom('[data-test-automation-milestones-lead]').doesNotExist();
  });

  test('before any run, the section lists the milestones the script declares, each not started', async function (assert) {
    answer = { status: 200, attributes: { ...ACTIVE, lastRun: null } };
    await openIsolated(PLANNED);
    await waitFor(
      '[data-test-automation-milestones] [data-test-milestone-state]',
      {
        timeout: 10000,
      },
    );
    assert
      .dom('[data-test-automation-milestones-lead]')
      .hasText(
        'The milestones the script plans to reach, in order. Each run reports how far the script got.',
      );
    let steps = [
      ...document.querySelectorAll(
        '[data-test-automation-milestones] [data-test-milestone-state]',
      ),
    ];
    assert.deepEqual(
      steps.map((step) => step.getAttribute('data-test-milestone-state')),
      ['not-started', 'not-started', 'not-started'],
    );
    let milestones = text('[data-test-automation-milestones]') ?? '';
    for (let name of ['Fetch open issues', 'Group by label', 'Write digest']) {
      assert.true(milestones.includes(name), `lists "${name}"`);
    }
  });

  test("a viewer who isn't a direct writer still sees the milestones the script declares", async function (assert) {
    await openIsolated(PLANNED);
    await waitFor('[data-test-automation-who-pays]', { timeout: 10000 });
    await waitFor(
      '[data-test-automation-milestones] [data-test-milestone-state]',
      {
        timeout: 10000,
      },
    );
    assert
      .dom('[data-test-automation-milestones]')
      .includesText('Group by label');
  });

  test('a last run that reported no milestones says so', async function (assert) {
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        lastRun: {
          runId: 'run-4',
          state: 'complete',
          startedAt: '2030-01-01T08:59:00.000Z',
          finishedAt: '2030-01-01T09:00:00.000Z',
          plan: [],
          milestones: [],
          ahead: [],
          failedIn: null,
          dropped: 0,
        },
      },
    };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-milestones]')
      .includesText(
        'The last run reported no milestones. A script reports milestones with realm.progress.plan and realm.progress.milestone.',
      );
  });

  test("a viewer who isn't a direct writer is told who sees the milestones", async function (assert) {
    await openIsolated();
    await waitFor('[data-test-automation-who-pays]', { timeout: 10000 });
    assert
      .dom('[data-test-automation-milestones]')
      .includesText(
        'Someone who can edit this workspace sees the milestones of the last run here.',
      );
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
      .includesText('Payer A person who shares no workspace with you');
  });

  test("an automation whose runs keep failing shows the streak's last error, as stored, until a run completes", async function (assert) {
    let failing = {
      ...ACTIVE,
      lastResult: 'error',
      failuresInARow: 3,
      lastFailure: {
        runId: 'run-3',
        reason: 'script-error',
        message: 'line 3: Error: upstream said no...',
        finishedAt: '2030-01-01T09:00:00.000Z',
      },
    };
    answer = { status: 200, attributes: failing };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-status]')
      .includesText('Last error line 3: Error: upstream said no...');

    answer = {
      status: 200,
      attributes: {
        ...failing,
        lastFailure: { ...failing.lastFailure, message: null },
      },
    };
    await openFormat('embedded');
    await openIsolated();
    await waitUntil(() =>
      text('[data-test-automation-status]')?.includes(
        'Last error script-error',
      ),
    );
    assert
      .dom('[data-test-automation-status]')
      .includesText(
        'Last error script-error',
        'a failure with no message shows its code',
      );

    answer = { status: 200, attributes: ACTIVE };
    await openFormat('embedded');
    await openIsolated();
    await waitUntil(() =>
      text('[data-test-automation-status]')?.includes('Last run: Completed'),
    );
    assert
      .dom('[data-test-automation-status]')
      .doesNotIncludeText('Last error', 'no streak, no last error');
  });

  test('an automation paused for an invalid declaration lists each problem where the problem is on the card', async function (assert) {
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        state: 'paused',
        pauseReason: 'invalid-declaration',
        pauseProblems: [
          {
            code: 'cron-too-frequent',
            path: 'triggers.1.expression',
            message:
              '"58,1 0,23 * * *" can fire twice 3 minutes apart, and Boxel runs an automation\'s cron trigger at most once every 5 minutes',
          },
          {
            code: 'missing-cap',
            path: 'caps.writes',
            message: 'Set the "Saves" limit',
          },
        ],
      },
    };
    await openIsolated();
    await waitFor('[data-test-automation-pause-problems]', { timeout: 10000 });
    assert
      .dom('[data-test-automation-state-sentence]')
      .hasText(
        'Boxel paused the automation because the automation’s settings have problems. Boxel will resume the automation once someone who can edit this workspace fixes each problem below.',
      );
    assert
      .dom('[data-test-automation-pause-problem="Trigger “hourly”"]')
      .includesText('can fire twice 3 minutes apart');
    assert
      .dom('[data-test-automation-pause-problem="Limits"]')
      .includesText('Set the "Saves" limit');

    answer = {
      status: 200,
      attributes: { ...ACTIVE, state: 'paused', pauseReason: 'requested' },
    };
    await openFormat('embedded');
    await openIsolated();
    await waitUntil(
      () =>
        text('[data-test-automation-state-sentence]')?.includes(
          'Someone who can edit this workspace paused',
        ),
      { timeout: 10000 },
    );
    assert
      .dom('[data-test-automation-pause-problems]')
      .doesNotExist('another pause reason lists no problems');
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
        'Someone raised a limit above what the payer agreed to pay for, so Boxel paused the automation. Boxel runs nothing until someone who can edit this workspace resumes the automation and agrees to the new limits.',
      ],
      [
        { state: 'paused', pauseReason: 'webhook-changed' },
        'Paused',
        'A workspace administrator pointed a trigger at an incoming webhook the payer didn’t agree to, so Boxel paused the automation. Boxel runs nothing until a workspace administrator resumes the automation and agrees to the new webhook.',
      ],
      [
        { state: 'paused', pauseReason: 'payer-lost-access' },
        'Paused',
        'The payer can no longer edit this workspace, so Boxel paused the automation. Boxel runs nothing until someone who can edit this workspace resumes the automation and becomes the new payer.',
      ],
      [
        {
          state: 'paused',
          pauseReason: 'repeated-failures',
          lastResult: 'error',
          failuresInARow: 5,
          lastFailure: {
            runId: 'run-5',
            reason: 'script-error',
            message: 'line 3: Error: upstream said no',
            finishedAt: '2030-01-01T09:00:00.000Z',
          },
        },
        'Paused',
        'Boxel paused the automation after 5 runs in a row failed. Boxel runs nothing until someone who can edit this workspace fixes what the runs fail on and resumes the automation.',
      ],
      [
        {
          state: 'paused',
          pauseReason: 'repeated-failures',
          lastResult: 'error',
          failuresInARow: 0,
          lastFailure: null,
        },
        'Paused',
        'Boxel paused the automation after several runs in a row failed. Boxel runs nothing until someone who can edit this workspace fixes what the runs fail on and resumes the automation.',
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
        'The automation has no runs left on any trigger, so Boxel runs nothing more. Boxel runs the automation again when someone who can edit this workspace adds a trigger.',
      ],
    ];
    for (let [change, label, sentence] of cases) {
      answer = { status: 200, attributes: { ...ACTIVE, ...change } };
      // A view asks once when it mounts, so each state gets a fresh view.
      await openFormat('embedded');
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
      .includesText('Next run None', 'a done automation has no next run');
  });
  // A run that ended with an error in its second planned milestone, after a
  // milestone the plan didn't list.
  const FAILED_RUN = {
    runId: 'run-1',
    state: 'error',
    startedAt: '2030-01-01T08:59:00.000Z',
    finishedAt: '2030-01-01T09:00:00.000Z',
    plan: ['Fetch issues', 'Group by label', 'Write digest'],
    milestones: [
      {
        name: 'Fetch issues',
        planned: true,
        startedAt: '2030-01-01T08:59:00.000Z',
        endedAt: '2030-01-01T08:59:04.000Z',
        ms: 4_000,
      },
      {
        name: 'Retry',
        planned: false,
        startedAt: '2030-01-01T08:59:04.000Z',
        endedAt: '2030-01-01T08:59:05.000Z',
        ms: 1_000,
      },
      {
        name: 'Group by label',
        planned: true,
        startedAt: '2030-01-01T08:59:05.000Z',
        endedAt: '2030-01-01T09:00:00.000Z',
        ms: 55_000,
        done: 12,
        total: 40,
      },
    ],
    ahead: ['Write digest'],
    failedIn: 'Group by label',
    dropped: 0,
  };

  test('the fitted and embedded views show where the last run failed, from the run', async function (assert) {
    answer = {
      status: 200,
      attributes: { ...ACTIVE, lastResult: 'error', lastRun: FAILED_RUN },
    };
    await openFormat('embedded');
    await waitFor('[data-test-automation-embedded-milestones="failed"]', {
      timeout: 10000,
    });
    let embedded = text('[data-test-automation-embedded-milestones]') ?? '';
    assert.true(
      embedded.includes('Failed in Group by label'),
      'names the milestone the run failed in',
    );
    assert.true(
      /(^|\D)2 of 4(\D|$)/.test(embedded),
      "counts the run's milestones, the one the plan didn't list included",
    );
    assert.dom('[data-test-automation-embedded-last="error"]').exists();
    assert.dom('[data-test-automation-embedded-next]').exists();

    await openFormat('fitted');
    await waitFor('[data-test-automation-fitted-milestones="failed"]', {
      timeout: 10000,
    });
    assert
      .dom('[data-test-automation-fitted-milestones]')
      .includesText('Failed in Group by label');
    assert
      .dom('[data-test-automation-fitted-milestones]')
      .includesText(
        '2 of 4',
        'the fitted lists name the milestones without their counts, so this is the run count',
      );
    assert
      .dom('[data-test-automation-fitted-focus]')
      .hasText(
        'Failed in Group by label',
        'the two-line sizes lead with the failure, not the schedule',
      );
    assert.dom('[data-test-automation-fitted-last="error"]').exists();
    assert
      .dom('[data-test-automation-fitted-next]')
      .exists('an active automation shows its next run');
  });

  test('the fitted and embedded views show the milestone a run is in', async function (assert) {
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        currentRun: {
          ...FAILED_RUN,
          runId: 'run-2',
          state: 'running',
          current: 'Group by label',
          finishedAt: null,
          // The milestone the run is in hasn't ended.
          milestones: FAILED_RUN.milestones.map((milestone, index) =>
            index === FAILED_RUN.milestones.length - 1
              ? { ...milestone, endedAt: null }
              : milestone,
          ),
          failedIn: null,
        },
      },
    };
    await openFormat('embedded');
    await waitFor('[data-test-automation-embedded-milestones="running"]', {
      timeout: 10000,
    });
    assert
      .dom('[data-test-automation-embedded-milestones]')
      .includesText('Running Group by label');
    await openFormat('fitted');
    await waitFor('[data-test-automation-fitted-milestones="running"]', {
      timeout: 10000,
    });
    assert
      .dom('[data-test-automation-fitted-focus]')
      .hasText('Running Group by label');
  });

  test('a run that has reached no milestone yet reads as running', async function (assert) {
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        currentRun: {
          ...FAILED_RUN,
          runId: 'run-3',
          state: 'running',
          current: null,
          finishedAt: null,
          milestones: [],
          ahead: FAILED_RUN.plan,
          failedIn: null,
        },
      },
    };
    await openFormat('embedded');
    await waitFor('[data-test-automation-embedded-milestones="running"]', {
      timeout: 10000,
    });
    assert
      .dom('[data-test-automation-embedded-milestones]')
      .includesText('Running, before the first milestone');
    assert
      .dom('[data-test-automation-embedded-milestones]')
      .includesText('0 of 3');
  });

  test('before any run, the fitted and embedded views count the milestones the script declares', async function (assert) {
    answer = { status: 200, attributes: { ...ACTIVE, lastRun: null } };
    await openFormat('embedded', PLANNED);
    await waitFor('[data-test-automation-embedded-milestones="planned"]', {
      timeout: 10000,
    });
    assert
      .dom('[data-test-automation-embedded-milestones]')
      .includesText('3 milestones planned');
    await openFormat('fitted', PLANNED);
    await waitFor('[data-test-automation-fitted-milestones="planned"]', {
      timeout: 10000,
    });
    assert
      .dom('[data-test-automation-fitted-milestones]')
      .includesText('0 of 3');
  });

  test("a viewer who isn't a direct writer sees the declared milestones but no runs in the fitted and embedded views", async function (assert) {
    await openFormat('embedded', PLANNED);
    await waitFor('[data-test-automation-embedded-milestones="planned"]', {
      timeout: 10000,
    });
    assert.dom('[data-test-automation-embedded-next]').doesNotExist();
    assert.dom('[data-test-automation-embedded-last]').doesNotExist();
    await openFormat('fitted', PLANNED);
    await waitFor('[data-test-automation-fitted-milestones="planned"]', {
      timeout: 10000,
    });
    assert.dom('[data-test-automation-fitted-state]').doesNotExist();
    assert.dom('[data-test-automation-fitted-next]').doesNotExist();
    assert.dom('[data-test-automation-fitted-last]').doesNotExist();
  });

  test('a paused automation shows no next run in the fitted and embedded views', async function (assert) {
    answer = {
      status: 200,
      attributes: { ...ACTIVE, state: 'paused', pauseReason: 'requested' },
    };
    await openFormat('embedded');
    await waitFor('[data-test-automation-embedded-state="Paused"]', {
      timeout: 10000,
    });
    assert.dom('[data-test-automation-embedded-next]').doesNotExist();
    assert.dom('[data-test-automation-embedded-last="complete"]').exists();
    await openFormat('fitted');
    await waitFor('[data-test-automation-fitted-state="Paused"]', {
      timeout: 10000,
    });
    assert.dom('[data-test-automation-fitted-next]').doesNotExist();
  });

  // The Runs section, read from the realm's `_automation-runs` route, which
  // an in-browser test realm can't answer: each test says what the route
  // lists.
  module('runs', function (hooks) {
    // What the route lists on each page, by page number, and how many runs
    // there are in all.
    let pages: Map<string, Run[]>;
    let total: number;
    let pageCount: number;
    let directWriter: boolean;
    let runsAsked: URL[];

    hooks.beforeEach(function () {
      directWriter = true;
      pages = new Map([['1', []]]);
      total = 0;
      pageCount = 1;
      runsAsked = [];
      getService('network').virtualNetwork.mount(
        async (request: Request) => {
          let url = new URL(request.url);
          if (!url.pathname.endsWith('/_automation-runs')) {
            return null;
          }
          runsAsked.push(url);
          let page = url.searchParams.get('page') ?? '1';
          let runs = pages.get(page) ?? [];
          return new Response(
            JSON.stringify(
              directWriter
                ? {
                    data: runs.map(({ id, ...attributes }) => ({
                      type: 'automation-run-item',
                      id,
                      attributes,
                    })),
                    meta: {
                      directWriter: true,
                      page: Number(page),
                      pages: pageCount,
                      total,
                    },
                  }
                : { data: [], meta: { directWriter: false } },
            ),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        },
        { prepend: true },
      );
    });

    function list(runs: Run[]) {
      pages.set('1', runs);
      total = runs.length;
      pageCount = 1;
    }

    // The Runs section starts closed, so a card with many runs doesn't bury
    // the rest of the card; this opens the section.
    async function openRuns() {
      await openIsolated();
      await waitFor('[data-test-automation-runs-section]', { timeout: 10000 });
      await settled();
      await click(
        '[data-test-automation-runs-section] [data-test-pretui-section-toggle]',
      );
    }

    function runText(id: string) {
      return text(`[data-test-automation-run="${id}"]`) ?? '';
    }

    test("a viewer who isn't a direct writer sees no runs", async function (assert) {
      directWriter = false;
      await openIsolated();
      await waitUntil(() => runsAsked.length > 0, { timeout: 10000 });
      await settled();
      assert.dom('[data-test-automation-runs-section]').doesNotExist();
    });

    test('an automation with no runs says when runs show', async function (assert) {
      await openRuns();
      assert
        .dom('[data-test-automation-runs-empty]')
        .includesText('No runs yet');
      assert.strictEqual(
        runsAsked[0]?.searchParams.get('automation'),
        AUTOMATION,
        'the view names the automation by its card URL',
      );
    });

    test('each run shows its state and what started the run, newest first', async function (assert) {
      list([
        run('queued', {
          state: 'pending',
          step: null,
          trigger: 'hourly',
          slot: '2030-01-01T10:00:00.000Z',
          startedAt: null,
          finishedAt: null,
          waitingFor: {
            kind: 'run',
            runId: 'hourly',
            startedBy: 'trigger',
            trigger: 'hourly',
            slot: '2030-01-01T09:00:00.000Z',
            state: 'running',
          },
        }),
        run('idle', {
          state: 'pending',
          step: null,
          trigger: 'nightly',
          startedAt: null,
          finishedAt: null,
          waitingFor: { kind: 'worker' },
        }),
        run('admitting', {
          state: 'running',
          step: 'admission',
          finishedAt: null,
        }),
        run('hourly', { state: 'running', trigger: 'hourly' }),
        run('running', {
          state: 'running',
          step: 'script',
          trigger: 'push',
          slot: 'delivery-7',
        }),
        run('preview', { startedBy: 'preview', trigger: null, slot: null }),
        run('by-hand', { startedBy: 'run-now', trigger: null, slot: null }),
        run('kickoff', {
          trigger: 'kickoff',
          slot: '2030-06-10T14:00:00.000Z',
        }),
        run('done'),
      ]);
      await openRuns();
      assert.deepEqual(
        [...document.querySelectorAll('[data-test-automation-run]')].map(
          (el) => [
            el.getAttribute('data-test-automation-run'),
            el.getAttribute('data-test-automation-run-state'),
          ],
        ),
        [
          ['queued', 'Waiting'],
          ['idle', 'Waiting'],
          ['admitting', 'Running'],
          ['hourly', 'Running'],
          ['running', 'Running'],
          ['preview', 'Complete'],
          ['by-hand', 'Complete'],
          ['kickoff', 'Complete'],
          ['done', 'Complete'],
        ],
      );
      assert.ok(
        runText('queued').includes('Waiting for the hourly run for'),
        'a waiting run names the run ahead of it',
      );
      assert.ok(
        runText('queued').includes(
          'to finish first: Boxel runs one run of an automation at a time.',
        ),
      );
      assert
        .dom(
          '[data-test-automation-run="idle"] [data-test-automation-run-waiting]',
        )
        .hasText('Waiting for a Boxel worker.');
      assert
        .dom(
          '[data-test-automation-run="admitting"] [data-test-automation-run-admitting]',
        )
        .includesText('Boxel is checking that the run may start');
      assert.ok(runText('hourly').includes('hourly'), 'the trigger by label');
      assert.ok(
        runText('hourly').includes('The schedule fired the run for'),
        'a schedule names the slot the run is for',
      );
      assert.ok(
        runText('running').includes('A webhook delivery fired the run.'),
        "a webhook's run names the delivery, not the delivery's id",
      );
      assert.notOk(runText('running').includes('delivery-7'));
      assert.ok(runText('preview').includes('Preview'));
      assert.ok(
        runText('preview').includes('a Preview saves nothing'),
        'a Preview says the Preview saves nothing',
      );
      assert.ok(runText('by-hand').includes('Run now'));
      assert.ok(
        runText('kickoff').includes('The one-time trigger fired the run for'),
      );
      assert
        .dom(
          '[data-test-automation-run="done"] [data-test-automation-run-reason]',
        )
        .doesNotExist('a complete run needs no reason');
    });

    test('a failed run says why, and a script error names the line', async function (assert) {
      list([
        run('threw', {
          state: 'error',
          errorReason: 'script-error',
          errorMessage: 'TypeError: feed.items is undefined',
          scriptLine: 7,
        }),
        run('timed-out', {
          state: 'error',
          errorReason: 'timed-out',
          errorMessage: 'The run reached its 300-second time limit',
        }),
        run('capped', {
          state: 'error',
          errorReason: 'hit-a-cap',
          errorMessage: 'The run hit its writes cap',
          cap: 'writes',
        }),
        run('call', {
          state: 'error',
          errorReason: 'call-failed',
          errorMessage: 'realm.fs.read: 404 notes/missing.md',
        }),
        run('platform', {
          state: 'error',
          errorReason: 'commit-interrupted',
          errorMessage: 'The commit was interrupted',
        }),
      ]);
      await openRuns();
      assert
        .dom('[data-test-automation-run="threw"]')
        .hasAttribute('data-test-automation-run-state', 'Failed');
      assert.ok(
        runText('threw').includes('The script threw an error on line 7'),
        runText('threw'),
      );
      assert.ok(
        runText('threw').includes('TypeError: feed.items is undefined'),
      );
      assert.ok(
        runText('timed-out').includes(
          'Boxel stopped the run when the run reached the time limit.',
        ),
      );
      assert.ok(
        runText('capped').includes(
          'Boxel stopped the run when the run reached the limit on saves.',
        ),
      );
      assert.ok(
        runText('call').includes(
          'A call the script made failed, and the script didn’t catch the error.',
        ),
      );
      assert.ok(
        runText('call').includes('realm.fs.read: 404 notes/missing.md'),
      );
      assert.ok(runText('platform').includes('Boxel couldn’t finish the run.'));
      assert.ok(runText('platform').includes('The commit was interrupted'));
    });

    test("a run Boxel didn't start says why and what fixes it", async function (assert) {
      let refused = (id: string, errorReason: string, errorMessage: string) =>
        run(id, {
          state: 'error',
          step: 'admission',
          errorReason,
          errorMessage,
        });
      list([
        refused('balance', 'insufficient-credits', 'balance 2 below 5'),
        refused('month', 'monthly-credit-cap-reached', 'cap 500 reached'),
        refused('access', 'not-a-direct-writer', 'not a direct writer'),
        refused(
          'operation',
          'binding-not-approved',
          'GitHub: issues not approved',
        ),
        refused('lookup', 'target-not-found', 'no such operation'),
      ]);
      await openRuns();
      assert.deepEqual(
        [...document.querySelectorAll('[data-test-automation-run]')].map((el) =>
          el.getAttribute('data-test-automation-run-state'),
        ),
        [
          'Didn’t start',
          'Didn’t start',
          'Didn’t start',
          'Didn’t start',
          'Didn’t start',
        ],
      );
      assert.ok(
        runText('balance').includes(
          'Boxel didn’t start the run because the payer’s credit balance was too low.',
        ),
      );
      assert.ok(
        runText('month').includes(
          'Boxel didn’t start the run because the automation reached the monthly credit limit.',
        ),
      );
      assert.ok(
        runText('access').includes(
          'Boxel didn’t start the run because the person the run acts as can no longer edit this workspace.',
        ),
      );
      assert.ok(
        runText('operation').includes(
          'Boxel didn’t start the run because nobody approved an outside service the automation calls.',
        ),
      );
      assert.ok(
        runText('lookup').includes(
          'Boxel didn’t start the run because Boxel couldn’t use an outside service the automation calls.',
        ),
        'any other refusal is a refused outside service',
      );
      assert.ok(
        runText('lookup').includes('no such operation'),
        'with the server’s detail',
      );
    });

    test('a canceled run says who canceled the run, or which pause did', async function (assert) {
      list([
        run('mine', {
          state: 'canceled',
          canceledBy: '@testuser:localhost',
          canceledByAPerson: true,
          viewerCanceled: true,
        }),
        run('named', {
          state: 'canceled',
          canceledBy: '@colleague:localhost',
          canceledByAPerson: true,
        }),
        run('hidden', { state: 'canceled', canceledByAPerson: true }),
        run('raised', { state: 'canceled', errorReason: 'caps-raised' }),
      ]);
      await openRuns();
      assert
        .dom('[data-test-automation-run="mine"]')
        .hasAttribute('data-test-automation-run-state', 'Canceled');
      assert.ok(runText('mine').includes('You canceled the run.'));
      assert.ok(
        runText('named').includes('@colleague:localhost canceled the run.'),
      );
      assert.ok(
        runText('hidden').includes(
          'A person who shares no workspace with you canceled the run.',
        ),
      );
      assert.ok(
        runText('raised').includes(
          'Boxel canceled the run when Boxel paused the automation: someone raised a limit above what the payer agreed to pay for.',
        ),
      );
    });

    test('a slot that joined a run before the run started shows as skipped, naming the run the slot joined', async function (assert) {
      list([
        run('joined', {
          state: 'running',
          trigger: 'hourly',
          slot: '2030-01-01T09:00:00.000Z',
          joined: [
            {
              trigger: 'hourly',
              slot: '2030-01-01T10:00:00.000Z',
              at: '2030-01-01T10:00:30.000Z',
            },
            {
              trigger: 'hourly',
              slot: '2030-01-01T11:00:00.000Z',
              at: '2030-01-01T11:00:30.000Z',
            },
          ],
        }),
      ]);
      await openRuns();
      let rows = [
        ...document.querySelectorAll(
          '[data-test-automation-skipped], [data-test-automation-run]',
        ),
      ].map(
        (el) =>
          el.getAttribute('data-test-automation-skipped') ??
          el.getAttribute('data-test-automation-run'),
      );
      assert.deepEqual(
        rows,
        ['2030-01-01T11:00:00.000Z', '2030-01-01T10:00:00.000Z', 'joined'],
        'each skipped slot sits above the run the slot joined, newest first',
      );
      let skipped =
        text('[data-test-automation-skipped="2030-01-01T10:00:00.000Z"]') ?? '';
      assert.ok(skipped.includes('Skipped'), skipped);
      assert.ok(skipped.includes('Boxel started no run for the'), skipped);
      assert.ok(
        skipped.includes('because the hourly run for'),
        'names the run the slot joined',
      );
      assert.ok(
        skipped.includes('hadn’t started yet. The slot joined that run.'),
        skipped,
      );
    });

    test('a job event naming the automation reads the runs again', async function (assert) {
      list([run('first')]);
      await openRuns();
      let askedBefore = runsAsked.length;
      list([run('second', { state: 'running', step: 'script' }), run('first')]);
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(
          testRealmURL,
          '@testuser:localhost',
        ),
        testRealmInfo.realmUserId!,
        {
          eventName: 'job',
          runId: 'second',
          automation: AUTOMATION,
          state: 'running',
          step: 'script',
          milestone: null,
          realmURL: testRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
      await waitFor('[data-test-automation-run="second"]', { timeout: 10000 });
      assert.ok(runsAsked.length > askedBefore, 'the view asked again');
      let askedAfter = runsAsked.length;
      await settled();
      await new Promise((resolve) => setTimeout(resolve, 200));
      await settled();
      assert.strictEqual(
        runsAsked.length,
        askedAfter,
        'an answer sets off no further read: the view reads once per event',
      );
      assert
        .dom('[data-test-automation-run="second"]')
        .hasAttribute('data-test-automation-run-state', 'Running');
    });

    test('the section starts closed, with how many runs the automation has', async function (assert) {
      list([run('first'), run('second')]);
      await openIsolated();
      await waitFor('[data-test-automation-runs-section]', { timeout: 10000 });
      await settled();
      assert
        .dom(
          '[data-test-automation-runs-section] [data-test-pretui-section-toggle]',
        )
        .hasAttribute('aria-expanded', 'false');
      assert
        .dom('[data-test-automation-runs-section]')
        .includesText('2 runs', 'the count shows while the section is closed');
      assert.ok(
        document
          .querySelector('[data-test-automation-runs]')
          ?.closest('[inert][aria-hidden="true"]'),
        'a closed section keeps its rows in an inert, hidden region',
      );
    });

    test('runs come a page at a time, and the pager shows another page', async function (assert) {
      pages.set('1', [run('newer')]);
      pages.set('2', [run('older')]);
      total = 21;
      pageCount = 2;
      await openRuns();
      assert.dom('[data-test-automation-run="newer"]').exists();
      assert.dom('[data-test-automation-run="older"]').doesNotExist();
      assert.strictEqual(
        runsAsked[0]?.searchParams.get('limit'),
        '20',
        'the view asks for one page of 20 runs',
      );
      await click('[data-test-automation-runs-pager] [aria-label="Page 2"]');
      await waitFor('[data-test-automation-run="older"]', { timeout: 10000 });
      assert.dom('[data-test-automation-run="newer"]').doesNotExist();
      assert.strictEqual(
        runsAsked[runsAsked.length - 1].searchParams.get('page'),
        '2',
      );
    });

    test("each run shows how far the run got through the script's milestones, and opens to the timeline", async function (assert) {
      let plan = ['Fetch open issues', 'Group by label', 'Write digest'];
      let milestone = (name: string, extra: Record<string, unknown> = {}) => ({
        name,
        planned: true,
        startedAt: '2030-01-01T08:30:10.000Z',
        endedAt: null,
        ms: 1000,
        ...extra,
      });
      list([
        run('running', {
          state: 'running',
          finishedAt: null,
          milestones: {
            runId: 'running',
            state: 'running',
            startedAt: '2030-01-01T08:30:05.000Z',
            finishedAt: null,
            plan,
            milestones: [
              milestone('Fetch open issues', {
                endedAt: '2030-01-01T08:30:11.000Z',
              }),
              milestone('Group by label', { done: 40, total: 120 }),
            ],
            current: 'Group by label',
            ahead: ['Write digest'],
            failedIn: null,
            dropped: 0,
          },
        }),
        run('failed', {
          state: 'error',
          errorReason: 'script-error',
          errorMessage: 'TypeError: labels is undefined',
          scriptLine: 12,
          milestones: {
            runId: 'failed',
            state: 'error',
            startedAt: '2030-01-01T08:30:05.000Z',
            finishedAt: '2030-01-01T08:31:00.000Z',
            plan,
            milestones: [
              milestone('Fetch open issues', {
                endedAt: '2030-01-01T08:30:11.000Z',
              }),
              milestone('Group by label', {
                endedAt: '2030-01-01T08:31:00.000Z',
              }),
            ],
            current: null,
            ahead: ['Write digest'],
            failedIn: 'Group by label',
            dropped: 0,
          },
        }),
        run('none'),
      ]);
      await openRuns();
      assert
        .dom(
          '[data-test-automation-run="running"] [data-test-automation-run-progress]',
        )
        .hasText('Milestone 2 of 3: Group by label');
      assert
        .dom(
          '[data-test-automation-run="failed"] [data-test-automation-run-progress]',
        )
        .hasText('Failed in milestone 2 of 3: Group by label');
      assert
        .dom(
          '[data-test-automation-run="none"] [data-test-automation-run-progress]',
        )
        .doesNotExist('a run whose script reported no milestones says nothing');

      assert.dom('[data-test-automation-run-milestones]').doesNotExist();
      await click(
        '[data-test-automation-runs] button[aria-label^="Expand nightly run for"][aria-label$=", Running"]',
      );
      await waitFor('[data-test-automation-run-milestones]', {
        timeout: 10000,
      });
      assert
        .dom('[data-test-automation-run-milestones]')
        .includesText('Fetch open issues');
      assert
        .dom('[data-test-automation-run-milestones]')
        .includesText('Write digest');
    });
  });

  module('switching on', function (hooks) {
    // What the realm server's switch-on estimate answers, and each request
    // the screen makes of the switch-on and resume routes.
    let estimateAnswer: { status: number; body: Record<string, unknown> };
    let posted: { route: string; body: any }[];
    let postAnswer: { status: number; body: Record<string, unknown> };

    function estimate(attributes: Record<string, unknown> = {}) {
      return {
        status: 200,
        body: {
          data: {
            type: 'automation-estimate',
            id: AUTOMATION,
            attributes: {
              switchedOn: false,
              monthlyCredits: 10,
              estimate: {
                pricingVersion: 'test',
                credits: 1234,
                perRun: { totalCredits: 4.2 },
                unboundedRunsPerMonth: 730,
                boundedRunsPerMonth: 30,
                onceRuns: 1,
                webhookTriggers: ['push'],
                triggers: [],
                uncountedChargeKinds: ['run_indexing', 'storage'],
              },
              notices: [],
              broadReaders: {
                anyone: false,
                everySignedInUser: false,
                policyGrants: [],
                policy: null,
              },
              ...attributes,
            },
          },
        },
      };
    }

    // The monthly limit the card holds, as the realm server reads it: the
    // card's own source in the test realm.
    async function cardCap(): Promise<number | null> {
      let response = await getService('network').virtualNetwork.fetch(
        `${AUTOMATION}.json`,
        { headers: { Accept: 'application/vnd.card+source' } },
      );
      let doc = await response.json();
      return doc.data.attributes.caps?.monthlyCredits ?? null;
    }

    hooks.beforeEach(function () {
      estimateAnswer = estimate();
      posted = [];
      postAnswer = { status: 201, body: { data: { type: 'automation' } } };
      getService('network').virtualNetwork.mount(
        async (request: Request) => {
          let url = new URL(request.url);
          let route = url.pathname.split('/').pop() ?? '';
          if (
            route !== '_automation-switch-on' &&
            route !== '_automation-resume'
          ) {
            return null;
          }
          if (request.method === 'GET') {
            let answer = estimateAnswer;
            if (answer.status === 200) {
              let attributes = (answer.body as any).data.attributes;
              attributes.monthlyCredits = await cardCap();
            }
            return new Response(JSON.stringify(answer.body), {
              status: answer.status,
              headers: { 'content-type': 'application/json' },
            });
          }
          posted.push({ route, body: await request.json() });
          return new Response(JSON.stringify(postAnswer.body), {
            status: postAnswer.status,
            headers: { 'content-type': 'application/json' },
          });
        },
        { prepend: true },
      );
    });

    async function openScreen(status: Record<string, unknown>) {
      answer = { status: 200, attributes: status };
      await openIsolated();
      await waitForStatus();
      await click('[data-test-automation-switch-on]');
      await waitFor(
        '[data-test-automation-switch-on-estimate], [data-test-automation-switch-on-estimate-failure]',
        { timeout: 10000 },
      );
    }

    const OFF = { switchedOn: false, lastRun: null, currentRun: null };

    test('the screen shows the estimate, what the estimate leaves out, the monthly limit and who pays', async function (assert) {
      await openScreen(OFF);
      assert
        .dom('[data-test-automation-switch-on]')
        .hasText(
          'Turn on the automation',
          'an automation nobody turned on offers to turn the automation on',
        );
      assert
        .dom('[data-test-automation-switch-on-fact="estimate"]')
        .hasText('1,234 credits a month');
      assert
        .dom('[data-test-automation-switch-on-fact="perRun"]')
        .hasText('5 credits', 'the most one run can cost, rounded up');
      assert
        .dom('[data-test-automation-switch-on-fact="runs"]')
        .hasText('761 runs a month');
      assert
        .dom('[data-test-automation-switch-on-fact="preview"]')
        .hasText('No Preview yet');
      assert
        .dom('[data-test-automation-switch-on-left-out]')
        .includesText('The indexing that each run’s saves cause.')
        .includesText('The daily storage of the files the runs create.')
        .includesText('This automation has webhook triggers: push');
      assert
        .dom('[data-test-automation-switch-on-cap] input')
        .hasValue('10', 'the monthly limit starts as the card’s own');
      assert
        .dom('[data-test-automation-switch-on-payer]')
        .includesText('Boxel charges every scheduled run');
      assert
        .dom('[data-test-automation-switch-on-broad-read]')
        .doesNotExist('a workspace that names each reader gets no warning');
      assert.dom('[data-test-automation-switch-on-reconfirm]').doesNotExist();
    });

    test('the estimate shows what the viewer’s last Preview cost, beside the estimate', async function (assert) {
      estimateAnswer = estimate();
      (
        estimateAnswer.body as any
      ).data.attributes.estimate.recentPreviewCredits = 7;
      await openScreen(OFF);
      assert
        .dom('[data-test-automation-switch-on-fact="preview"]')
        .hasText('7 credits');
      assert
        .dom('[data-test-automation-switch-on-fact="estimate"]')
        .hasText('1,234 credits a month', 'the Preview is not in the estimate');
    });

    test('turning on agrees to the card’s monthly limit and closes the screen', async function (assert) {
      await openScreen(OFF);
      await click('[data-test-automation-switch-on-confirm]');
      await waitUntil(() => posted.length > 0, { timeout: 10000 });
      await settled();
      assert.deepEqual(posted, [
        {
          route: '_automation-switch-on',
          body: {
            data: {
              type: 'automation',
              id: AUTOMATION,
              attributes: { realm: testRealmURL, monthlyCredits: 10 },
            },
          },
        },
      ]);
      // A closed dialog keeps its content in the page; what closes is the
      // dialog element.
      assert
        .dom('dialog[open] [data-test-automation-switch-on-screen]')
        .doesNotExist('the screen closes');
    });

    test('a missing monthly limit is refused before anything is sent', async function (assert) {
      await openScreen(OFF);
      await fillIn('[data-test-automation-switch-on-cap] input', '');
      await click('[data-test-automation-switch-on-confirm]');
      assert
        .dom('[data-test-automation-switch-on-screen]')
        .includesText(
          'Enter a monthly limit. Boxel turns an automation on only with a monthly limit.',
        );
      assert.deepEqual(posted, [], 'the screen sends nothing');
    });

    test('another monthly limit is written to the card before the automation is turned on at that limit', async function (assert) {
      await openScreen(OFF);
      await fillIn('[data-test-automation-switch-on-cap] input', '40');
      await click('[data-test-automation-switch-on-confirm]');
      await waitUntil(() => posted.length > 0, { timeout: 20000 });
      assert.strictEqual(await cardCap(), 40, 'the card holds the new limit');
      assert.strictEqual(
        posted[0].body.data.attributes.monthlyCredits,
        40,
        'and the switch-on agrees to that limit',
      );
    });

    test('a monthly limit below the card’s daily limit is refused before anything is written or sent', async function (assert) {
      await openScreen(OFF);
      await fillIn('[data-test-automation-switch-on-cap] input', '3');
      await click('[data-test-automation-switch-on-confirm]');
      assert
        .dom('[data-test-automation-switch-on-screen]')
        .includesText(
          'The monthly limit can’t be below the daily limit of 5 credits.',
        );
      assert.deepEqual(posted, [], 'the screen sends nothing');
      assert.strictEqual(await cardCap(), 10, 'the card keeps its limit');
    });

    test('the screen says when webhook triggers can’t fire', async function (assert) {
      estimateAnswer = estimate({
        notices: [
          {
            code: 'webhook-triggers-start-no-runs',
            message: 'webhook triggers start no runs',
          },
        ],
      });
      await openScreen(OFF);
      assert
        .dom('[data-test-automation-switch-on-webhook-notice]')
        .hasText(
          'Boxel doesn’t run automations from webhooks, so these triggers can’t fire.',
        );
    });

    test('a limit below the estimate says Boxel may stop starting runs before the month ends', async function (assert) {
      await openScreen(OFF);
      await fillIn('[data-test-automation-switch-on-cap] input', '5');
      assert
        .dom('[data-test-automation-switch-on-screen]')
        .includesText(
          'The limit is below the estimate, so Boxel may stop starting runs before the month ends.',
        );
    });

    test('the screen warns when many people can read the workspace, and names each kind of reader', async function (assert) {
      estimateAnswer = estimate({
        broadReaders: {
          anyone: true,
          everySignedInUser: true,
          policyGrants: [
            { path: 'rules[0].grants[0]', who: 'signed-in' },
            { path: 'rules[0].grants[1]', who: 'signed-in' },
            { path: 'rules[1].grants[0]', who: 'anyone' },
          ],
          policy: `${testRealmURL}policy`,
        },
      });
      await openScreen(OFF);
      assert
        .dom('[data-test-automation-switch-on-broad-read]')
        .includesText(
          'Whoever can read this workspace can read every file the automation writes.',
        );
      assert.deepEqual(
        [
          ...document.querySelectorAll(
            '[data-test-automation-switch-on-broad-reader]',
          ),
        ].map((li) => li.textContent?.trim()),
        [
          'Anyone, signed in or not, can read this workspace.',
          'Every signed-in Boxel user can read this workspace.',
          'One grant in the workspace’s policy lets anyone, signed in or not, read cards.',
          '2 grants in the workspace’s policy let every signed-in Boxel user read cards.',
        ],
      );
    });

    test('an automation paused for a raised limit or batched AI resumes through the screen, which says why', async function (assert) {
      postAnswer = { status: 200, body: { data: { type: 'automation' } } };
      await openScreen({
        ...ACTIVE,
        state: 'paused',
        pauseReason: 'caps-raised',
      });
      assert
        .dom('[data-test-automation-switch-on]')
        .hasText('Review and resume');
      assert
        .dom('[data-test-automation-switch-on-reconfirm]')
        .hasText(
          'Someone raised one of the automation’s limits above what the payer agreed to, so Boxel paused the automation. Resuming the automation makes you the payer of the new limits.',
        );
      assert
        .dom('[data-test-automation-switch-on-confirm]')
        .hasText('Resume and pay');
      await click('[data-test-automation-switch-on-confirm]');
      await waitUntil(() => posted.length > 0, { timeout: 10000 });
      assert.strictEqual(posted[0].route, '_automation-resume');
      assert.strictEqual(posted[0].body.data.attributes.monthlyCredits, 10);
    });

    test('the screen says why Boxel paused an automation whose card turned on batched AI', async function (assert) {
      await openScreen({
        ...ACTIVE,
        state: 'paused',
        pauseReason: 'batched-ai-enabled',
      });
      assert
        .dom('[data-test-automation-switch-on-reconfirm]')
        .hasText(
          'Someone turned on batched AI after the payer agreed to the automation’s limits, so Boxel paused the automation. Resuming the automation makes you the payer, with batched AI on.',
        );
    });

    test('an active automation, or one paused for another reason, offers no switch-on screen', async function (assert) {
      answer = { status: 200, attributes: ACTIVE };
      await openIsolated();
      await waitForStatus();
      assert.dom('[data-test-automation-switch-on]').doesNotExist();
    });

    test('an estimate the realm server refuses shows the server’s message and can be read again', async function (assert) {
      estimateAnswer = {
        status: 503,
        body: {
          errors: [
            'this server has no prices, so it can neither estimate nor admit automation runs until its pricing is fixed',
          ],
        },
      };
      await openScreen(OFF);
      assert
        .dom('[data-test-automation-switch-on-estimate-failure]')
        .includesText('Boxel couldn’t read the estimate')
        .includesText('this server has no prices');
      estimateAnswer = estimate();
      await click('[data-test-automation-switch-on-retry]');
      await waitFor('[data-test-automation-switch-on-estimate]', {
        timeout: 10000,
      });
      assert
        .dom('[data-test-automation-switch-on-fact="estimate"]')
        .hasText('1,234 credits a month');
    });

    test('a switch-on the realm server refuses shows the server’s message, and the screen stays open', async function (assert) {
      postAnswer = {
        status: 422,
        body: {
          errors: [
            'the automation card sets no monthly credit cap (caps.monthlyCredits); set one on the card before switching it on',
          ],
        },
      };
      await openScreen(OFF);
      await click('[data-test-automation-switch-on-confirm]');
      await waitFor('[data-test-automation-switch-on-failure]', {
        timeout: 10000,
      });
      assert
        .dom('[data-test-automation-switch-on-failure]')
        .includesText('Boxel didn’t turn the automation on')
        .includesText('the automation card sets no monthly credit cap');
      assert
        .dom('dialog[open] [data-test-automation-switch-on-screen]')
        .exists('the screen stays open');
    });
  });
});
