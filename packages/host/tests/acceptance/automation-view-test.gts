import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

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
});
