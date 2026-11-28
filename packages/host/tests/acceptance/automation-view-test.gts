import {
  click,
  fillIn,
  settled,
  waitFor,
  waitUntil,
} from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import windowMock from 'ember-window-mock';
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
import { stubWindowOpen } from '../helpers/window-open';

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
  let askedKeyApprovals: boolean[];
  // While set, a status read that asks for key approvals waits on it, as a
  // slow key check does.
  let holdKeyedReads: Promise<void> | undefined;
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
    askedKeyApprovals = [];
    holdKeyedReads = undefined;
    // An in-browser test realm has no storage route either. A test that
    // reads the storage mounts its own answer ahead of this one; every other
    // test answers as the route answers a viewer it refuses, so the view
    // stops asking and leaves the Storage section out.
    getService('network').virtualNetwork.mount(
      async (request: Request) =>
        new URL(request.url).pathname.endsWith('/_automation-storage')
          ? new Response(JSON.stringify({ errors: [] }), { status: 403 })
          : null,
      { prepend: true },
    );
    getService('network').virtualNetwork.mount(
      async (request: Request) => {
        let url = new URL(request.url);
        if (!url.pathname.endsWith('/_automation-status')) {
          return null;
        }
        asked.push(url.searchParams.get('automation') ?? '');
        let keyed = url.searchParams.get('keyApprovals') === 'true';
        askedKeyApprovals.push(keyed);
        if (keyed && holdKeyedReads) {
          await holdKeyedReads;
        }
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
                    // The route checks key approvals only when asked.
                    attributes: keyed
                      ? answer.attributes
                      : { ...answer.attributes, keyApprovals: undefined },
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
    assert.dom('[data-test-automation-state="Off"]').exists();
    assert.dom('[data-test-automation-header-state="Off"]').exists();
    assert
      .dom('[data-test-automation-state-sentence]')
      .hasText(
        'Nobody has turned this automation on, so Boxel runs nothing. A realm administrator can turn this automation on, and that person then pays for every run.',
      );
    assert.dom('[data-test-automation-status]').includesText('Nobody yet');
    assert.dom('[data-test-automation-trigger-progress]').doesNotExist();
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
              tasks: [
                {
                  text: 'Fetched 30 open issues',
                  at: '2030-01-01T08:59:03.000Z',
                },
              ],
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
              tasks: [
                {
                  text: 'Grouped the bug label',
                  at: '2030-01-01T08:59:10.000Z',
                },
              ],
            },
          ],
          ahead: ['Write digest'],
          failedIn: 'Group by label',
          dropped: 0,
          tasksDropped: 2,
        },
      },
    };
    await openIsolated();
    await waitForStatus();
    assert
      .dom('[data-test-automation-milestones-lead]')
      .hasText(
        'The milestones the script reported on the last run, which ended with an error. Boxel didn’t record 2 more tasks the script reported: a run records at most 200 tasks, and none inside a milestone Boxel didn’t record.',
      );
    let milestones = text('[data-test-automation-milestones]') ?? '';
    for (let expected of [
      'Fetch issues',
      'Took 4 s',
      'Retry',
      'Took 1 s · Not in the plan',
      'Group by label',
      'Failed here',
      'Ran for 55 s',
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
    assert.deepEqual(
      [
        ...document.querySelectorAll(
          '[data-test-automation-milestones] [data-test-automation-milestone-tasks]',
        ),
      ].map((list) => [
        list.getAttribute('aria-label'),
        [...list.querySelectorAll('[data-test-automation-milestone-task]')].map(
          (task) => task.textContent?.trim(),
        ),
      ]),
      [
        ['Tasks in Fetch issues', ['Fetched 30 open issues']],
        ['Tasks in Group by label', ['Grouped the bug label']],
      ],
      'each milestone lists the tasks the script reported inside the milestone, in place of a count',
    );
  });

  test('a milestone lists the latest five tasks, and a toggle shows and hides the earlier ones, keeping focus', async function (assert) {
    let tasks = Array.from({ length: 8 }, (_, i) => ({
      text: `Grouped label ${i + 1}`,
      at: '2030-01-01T08:59:10.000Z',
    }));
    answer = {
      status: 200,
      attributes: {
        ...ACTIVE,
        lastRun: {
          runId: 'run-1',
          state: 'complete',
          startedAt: '2030-01-01T08:59:00.000Z',
          finishedAt: '2030-01-01T09:00:00.000Z',
          plan: ['Group by label'],
          milestones: [
            {
              name: 'Group by label',
              planned: true,
              startedAt: '2030-01-01T08:59:00.000Z',
              endedAt: '2030-01-01T09:00:00.000Z',
              ms: 60_000,
              tasks,
            },
          ],
          ahead: [],
          failedIn: null,
          dropped: 0,
        },
      },
    };
    await openIsolated();
    await waitForStatus();
    let shown = () =>
      [
        ...document.querySelectorAll(
          '[data-test-automation-milestones] [data-test-automation-milestone-task]',
        ),
      ].map((task) => task.textContent?.trim());
    assert.deepEqual(shown(), [
      'Grouped label 4',
      'Grouped label 5',
      'Grouped label 6',
      'Grouped label 7',
      'Grouped label 8',
    ]);
    assert
      .dom(
        '[data-test-automation-milestones] [data-test-automation-milestone-earlier-tasks]',
      )
      .hasText('Show 3 earlier tasks')
      .hasAttribute('aria-expanded', 'false');
    let toggle =
      '[data-test-automation-milestones] [data-test-automation-milestone-earlier-tasks]';
    await click(toggle);
    assert.deepEqual(
      shown(),
      tasks.map(({ text }) => text),
      'every task, in the order reported',
    );
    assert
      .dom(toggle)
      .hasText('Hide 3 earlier tasks')
      .hasAttribute('aria-expanded', 'true')
      .isFocused('the toggle stays where it was, with focus on it');
    await click(toggle);
    assert.strictEqual(shown().length, 5, 'the earlier tasks hide again');
  });

  test("a milestone's earlier tasks start hidden again when the card moves on to the next run", async function (assert) {
    // The same milestone in two runs, each with more tasks than the card
    // shows at first.
    let run = (runId: string, label: string) => ({
      runId,
      state: 'complete',
      startedAt: '2030-01-01T08:59:00.000Z',
      finishedAt: '2030-01-01T09:00:00.000Z',
      plan: ['Group by label'],
      milestones: [
        {
          name: 'Group by label',
          planned: true,
          startedAt: '2030-01-01T08:59:00.000Z',
          endedAt: '2030-01-01T09:00:00.000Z',
          ms: 60_000,
          tasks: Array.from({ length: 8 }, (_, i) => ({
            text: `${label} ${i + 1}`,
            at: '2030-01-01T08:59:10.000Z',
          })),
        },
      ],
      ahead: [],
      failedIn: null,
      dropped: 0,
    });
    answer = {
      status: 200,
      attributes: { ...ACTIVE, lastRun: run('run-1', 'Grouped label') },
    };
    await openIsolated();
    await waitForStatus();
    let toggle =
      '[data-test-automation-milestones] [data-test-automation-milestone-earlier-tasks]';
    let shown = () =>
      [
        ...document.querySelectorAll(
          '[data-test-automation-milestones] [data-test-automation-milestone-task]',
        ),
      ].map((task) => task.textContent?.trim());
    await click(toggle);
    assert.strictEqual(shown().length, 8, "the first run's tasks all show");

    answer = {
      status: 200,
      attributes: { ...ACTIVE, lastRun: run('run-2', 'Sorted label') },
    };
    mockMatrixUtils.simulateRemoteMessage(
      mockMatrixUtils.getRoomIdForRealmAndUser(
        testRealmURL,
        '@testuser:localhost',
      ),
      testRealmInfo.realmUserId!,
      {
        eventName: 'job',
        runId: 'run-2',
        automation: AUTOMATION,
        state: 'complete',
        step: 'script',
        milestone: null,
        realmURL: testRealmURL,
      },
      { type: APP_BOXEL_REALM_EVENT_TYPE },
    );
    await waitUntil(() => shown().includes('Sorted label 8'), {
      timeout: 10000,
      timeoutMessage: 'the card never moved on to the next run',
    });
    assert.deepEqual(
      shown(),
      [4, 5, 6, 7, 8].map((n) => `Sorted label ${n}`),
      "the next run's milestone shows its latest five tasks",
    );
    assert
      .dom(toggle)
      .hasText('Show 3 earlier tasks')
      .hasAttribute('aria-expanded', 'false');
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
              tasks: [
                {
                  text: 'Grouped the bug label',
                  at: '2030-01-01T09:00:00.000Z',
                },
              ],
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
      'Running for 1 min 30 s',
      'Grouped the bug label',
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
        'A realm administrator sees the milestones of the last run here.',
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
        'Boxel paused the automation because the automation’s settings have problems. Boxel will resume the automation once a realm administrator fixes each problem below.',
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
          'A realm administrator paused',
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
        'A realm administrator paused the automation, so Boxel runs nothing until a realm administrator resumes the automation.',
      ],
      [
        { state: 'paused', pauseReason: 'caps-raised' },
        'Paused',
        'Someone raised a limit above what the payer agreed to pay for, so Boxel paused the automation. Boxel runs nothing until a realm administrator resumes the automation and agrees to the new limits.',
      ],
      [
        { state: 'paused', pauseReason: 'webhook-changed' },
        'Paused',
        'A realm administrator pointed a trigger at an incoming webhook the payer didn’t agree to, so Boxel paused the automation. Boxel runs nothing until a realm administrator resumes the automation and agrees to the new webhook.',
      ],
      [
        { state: 'paused', pauseReason: 'webhook-owner-lost-access' },
        'Paused',
        'The person who made a trigger’s incoming webhook is no longer a realm administrator, so Boxel paused the automation. Boxel runs nothing until a realm administrator does one of these two things and then resumes the automation:',
      ],
      [
        { state: 'paused', pauseReason: 'payer-lost-access' },
        'Paused',
        'The payer’s account can no longer pay for runs, so Boxel paused the automation. Boxel runs nothing until a realm administrator resumes the automation and becomes the new payer.',
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
        'Boxel paused the automation after 5 runs in a row failed. Boxel runs nothing until a realm administrator fixes what the runs fail on and resumes the automation.',
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
        'Boxel paused the automation after several runs in a row failed. Boxel runs nothing until a realm administrator fixes what the runs fail on and resumes the automation.',
      ],
      [
        { state: 'waiting-for-credits', pauseReason: null },
        'Waiting for credits',
        'The payer has no credits left, so Boxel has paused every run. Boxel runs the automation again once the payer adds credits.',
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
        'The automation has no runs left on any trigger, so Boxel runs nothing more. Boxel runs the automation again when a realm administrator adds a trigger.',
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
      if (change.pauseReason === 'webhook-owner-lost-access') {
        assert
          .dom('[data-test-automation-state-steps] li')
          .exists({ count: 2 }, 'the two ways to fix the pause are listed');
        assert
          .dom('[data-test-automation-state-steps] li:nth-child(1)')
          .hasText(
            'Edit the automation, and in the trigger’s Webhook field pick one of this workspace’s webhooks, or',
          );
        assert
          .dom('[data-test-automation-state-steps] li:nth-child(2)')
          .hasText(
            'Make the person who made the webhook a realm administrator again.',
          );
      } else {
        assert
          .dom('[data-test-automation-state-steps]')
          .doesNotExist(
            `${label}: ${String(change.pauseReason)} lists no steps`,
          );
      }
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
        tasks: [
          { text: 'Grouped the bug label', at: '2030-01-01T08:59:10.000Z' },
        ],
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
    assert.false(
      embedded.includes('Grouped the bug label'),
      "the embedded track's narrow columns leave the milestones' tasks out",
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
    // The sizes with room for two lines a milestone show each milestone's
    // last task beside its time.
    let showsTask = () =>
      [
        ...document.querySelectorAll(
          '[data-test-automation-fitted-milestone-list] [data-milestone-detail]',
        ),
      ].some((detail) => detail.textContent?.includes('Grouped the bug label'));
    await waitUntil(showsTask, {
      timeout: 10000,
      timeoutMessage: "no fitted size showed the milestone's last task",
    });
    assert.true(showsTask(), "a fitted size shows the milestone's last task");
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
    assert
      .dom('[data-test-automation-fitted-paused]')
      .hasText(
        'Paused by a realm administrator',
        'the fitted view says why Boxel paused the automation',
      );
  });

  test('a direct writer gets a way into the Automations console from the isolated, embedded and fitted views', async function (assert) {
    answer = { status: 200, attributes: ACTIVE };
    await openIsolated();
    await waitForStatus();
    assert
      .dom(
        '[data-test-automation] header [data-test-automation-show-in-console]',
      )
      .hasText('Show in Automations', 'the isolated header offers the action');

    await openFormat('embedded');
    await waitFor(
      '[data-test-automation-embedded] [data-test-automation-show-in-console]',
      { timeout: 10000 },
    );
    assert
      .dom(
        '[data-test-automation-embedded] [data-test-automation-show-in-console]',
      )
      .hasText('Show in Automations');

    await openFormat('fitted');
    await waitFor(
      '[data-test-automation-fitted] [data-test-automation-show-in-console]',
      { timeout: 10000 },
    );
    assert
      .dom(
        '[data-test-automation-fitted] [data-test-automation-show-in-console]',
      )
      .hasAria(
        'label',
        'Show in Automations',
        'the fitted view offers the action as a labelled icon button',
      );
  });

  test("a viewer who isn't a direct writer gets no way into the Automations console", async function (assert) {
    await openIsolated();
    await waitUntil(() => asked.length > 0, { timeout: 10000 });
    await settled();
    assert.dom('[data-test-automation-show-in-console]').doesNotExist();

    await openFormat('embedded');
    await settled();
    assert.dom('[data-test-automation-show-in-console]').doesNotExist();

    await openFormat('fitted');
    await settled();
    assert.dom('[data-test-automation-show-in-console]').doesNotExist();
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
          'Boxel didn’t start the run because the person the run acts as is no longer a realm administrator.',
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
        run('unowned', {
          state: 'canceled',
          errorReason: 'webhook-owner-lost-access',
        }),
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
          'Boxel canceled the run because someone raised a limit above what the payer agreed to pay for.',
        ),
      );
      assert.ok(
        runText('unowned').includes(
          'Boxel canceled the run because the person who made a trigger’s incoming webhook is no longer a realm administrator.',
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
              milestone('Group by label', {
                tasks: [
                  {
                    text: 'Grouped the bug label',
                    at: '2030-01-01T08:30:12.000Z',
                  },
                ],
              }),
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
        .hasText('Milestone 2 of 3: Group by label — Grouped the bug label');
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
      assert
        .dom(
          '[data-test-automation-run-milestones] [data-test-automation-milestone-task]',
        )
        .hasText(
          'Grouped the bug label',
          'the opened timeline lists the tasks under the milestone',
        );
    });

    test("a running run's new task shows live when the realm sends a job event", async function (assert) {
      let running = (tasks: string[]) =>
        run('live', {
          state: 'running',
          step: 'script',
          finishedAt: null,
          milestones: {
            runId: 'live',
            state: 'running',
            startedAt: '2030-01-01T08:30:05.000Z',
            finishedAt: null,
            plan: ['Group by label'],
            milestones: [
              {
                name: 'Group by label',
                planned: true,
                startedAt: '2030-01-01T08:30:10.000Z',
                endedAt: null,
                ms: 1000,
                tasks: tasks.map((text) => ({
                  text,
                  at: '2030-01-01T08:30:12.000Z',
                })),
              },
            ],
            current: 'Group by label',
            ahead: [],
            failedIn: null,
            dropped: 0,
          },
        });
      list([running(['Grouped the bug label'])]);
      await openRuns();
      let progress =
        '[data-test-automation-run="live"] [data-test-automation-run-progress]';
      assert
        .dom(progress)
        .hasText('Milestone 1 of 1: Group by label — Grouped the bug label');
      list([running(['Grouped the bug label', 'Grouped the docs label'])]);
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(
          testRealmURL,
          '@testuser:localhost',
        ),
        testRealmInfo.realmUserId!,
        {
          eventName: 'job',
          runId: 'live',
          automation: AUTOMATION,
          state: 'running',
          step: 'script',
          milestone: 'Group by label',
          realmURL: testRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
      await waitUntil(
        () => text(progress)?.includes('Grouped the docs label'),
        { timeout: 10000, timeoutMessage: 'the new task never showed' },
      );
      assert
        .dom(progress)
        .hasText('Milestone 1 of 1: Group by label — Grouped the docs label');
    });

    // An opened run, read from the realm server's `_automation-run-report` and
    // `_automation-run-log` routes, which an in-browser test can't answer: each
    // test says what the routes answer for each run.
    module('a run opened', function (hooks) {
      let reports: Map<string, Record<string, unknown>>;
      let logs: Map<string, { state: string; lines: LogLine[] }>;
      let logAsked: URL[];
      let reportsAsked: string[];

      type LogLine = {
        seq: number;
        at: number;
        source: 'script' | 'platform';
        kind: string;
        level?: string;
        message: string;
        scriptLine?: number;
      };

      hooks.beforeEach(function () {
        reports = new Map();
        logs = new Map();
        logAsked = [];
        reportsAsked = [];
        getService('network').virtualNetwork.mount(
          async (request: Request) => {
            let url = new URL(request.url);
            let runId = url.searchParams.get('run') ?? '';
            if (url.pathname.endsWith('/_automation-run-report')) {
              reportsAsked.push(runId);
              let attributes = reports.get(runId);
              return attributes
                ? new Response(
                    JSON.stringify({
                      data: {
                        type: 'automation-run-report',
                        id: runId,
                        attributes,
                      },
                    }),
                    {
                      status: 200,
                      headers: { 'content-type': 'application/json' },
                    },
                  )
                : new Response(JSON.stringify({ errors: [] }), { status: 404 });
            }
            if (url.pathname.endsWith('/_automation-storage')) {
              return new Response(
                JSON.stringify({
                  data: {
                    type: 'automation-storage',
                    id: AUTOMATION,
                    attributes: {
                      switchedOn: true,
                      payer: '@testuser:localhost',
                      viewerIsPayer: true,
                      files: [
                        {
                          path: 'digests/2030-01-01.md',
                          run: 'done',
                          createdAt: '2030-01-01T08:31:00.000Z',
                          fileBytes: 3000,
                          indexBytes: 1000,
                        },
                        {
                          path: 'digests/2029-12-31.md',
                          run: 'earlier',
                          createdAt: '2029-12-31T08:31:00.000Z',
                          fileBytes: 5000,
                          indexBytes: 1000,
                        },
                      ],
                      fileBytes: 8000,
                      indexBytes: 2000,
                      dailyCredits: 0.0042,
                      pricingVersion: 'test',
                      charges: [],
                    },
                  },
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              );
            }
            if (url.pathname.endsWith('/_automation-run-log')) {
              logAsked.push(url);
              let log = logs.get(runId) ?? { state: 'complete', lines: [] };
              let after = Number(url.searchParams.get('after') ?? '-1');
              let levels = url.searchParams.get('level')?.split(',');
              let past = log.lines.filter((line) => line.seq > after);
              let lines = past.filter(
                (line) => !levels || levels.includes(line.level ?? 'info'),
              );
              return new Response(
                JSON.stringify({
                  data: {
                    type: 'automation-run-log',
                    id: runId,
                    attributes: {
                      state: log.state,
                      lines,
                      next: past.length ? past[past.length - 1].seq : after,
                      more: false,
                      total: log.lines.length,
                      dropped: 0,
                    },
                  },
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              );
            }
            return null;
          },
          { prepend: true },
        );
      });

      module('notices', function () {
        function notice(attributes: Record<string, unknown>) {
          return {
            audience: 'payer',
            forViewer: true,
            run: null,
            operation: null,
            credential: null,
            ...attributes,
          };
        }

        test('a notice about a run says what happened and what fixes it, and Show the run opens the run', async function (assert) {
          list([
            run('older'),
            run('failed', {
              state: 'error',
              errorReason: 'script-error',
              errorMessage: 'Cannot read the import file',
            }),
          ]);
          answer = {
            status: 200,
            attributes: {
              ...ACTIVE,
              state: 'paused',
              pauseReason: 'repeated-failures',
              notice: notice({
                reason: 'repeated-failures',
                run: {
                  runId: 'failed',
                  reason: 'script-error',
                  message: 'Cannot read the import file',
                  finishedAt: '2030-01-01T08:31:00.000Z',
                },
              }),
            },
          };
          await openIsolated();
          await waitFor('[data-test-automation-notice="repeated-failures"]', {
            timeout: 10000,
          });
          assert
            .dom('[data-test-automation-notice]')
            .containsText(
              'Boxel paused Nightly import after the automation’s runs failed several times in a row.',
            );
          assert
            .dom('[data-test-automation-notice-fix]')
            .hasText(
              'The payer should fix what the runs fail on, check the fix with a Preview, and then resume the automation.',
            );
          assert
            .dom('[data-test-automation-notice-error]')
            .hasText('Cannot read the import file');
          assert
            .dom('[data-test-automation-notice-action]')
            .doesNotExist('a fix on the card itself opens no secure window');
          assert
            .dom(
              '[data-test-automation-runs-section] [data-test-pretui-section-toggle]',
            )
            .hasAttribute('aria-expanded', 'false', 'Runs is closed');

          await click('[data-test-automation-notice-show-run="failed"]');
          await waitFor('[data-test-automation-run-detail]', {
            timeout: 10000,
          });
          assert
            .dom('[data-test-automation-run="failed"]')
            .exists('the Runs section opens on the run');
          let opened = document
            .querySelector('[data-test-automation-run-detail]')
            ?.closest('li');
          assert.ok(
            opened?.querySelector('[data-test-automation-run="failed"]'),
            'the run the notice is about is the run opened',
          );
        });

        test('a key approval notice opens the secure window’s approve page on the automation itself', async function (assert) {
          let windowOpen = stubWindowOpen(windowMock);
          answer = {
            status: 200,
            attributes: {
              ...ACTIVE,
              state: 'waiting-for-key-approval',
              notice: notice({
                reason: 'binding-needs-reapproval',
                run: {
                  runId: 'refused',
                  reason: 'binding-needs-reapproval',
                  message: 'The declared operation "fetch" was refused',
                  finishedAt: '2030-01-01T08:31:00.000Z',
                },
                operation: {
                  name: 'fetch',
                  module: `${testRealmURL}weather`,
                  typeName: 'Weather',
                },
              }),
            },
          };
          await openIsolated();
          await waitFor('[data-test-automation-notice-action="approve"]', {
            timeout: 10000,
          });
          assert
            .dom('[data-test-automation-notice]')
            .containsText(
              'Boxel didn’t start a run of Nightly import because the operation “fetch” now sends a different request than the one the payer approved.',
            );
          await click('[data-test-automation-notice-action="approve"]');
          assert.strictEqual(
            windowOpen.calls.length,
            1,
            'the secure window opens',
          );
          let opened = new URL(windowOpen.calls[0].url);
          assert.true(
            opened.pathname.endsWith('/approve'),
            'on the approve page',
          );
          let fragment = new URLSearchParams(opened.hash.slice(1));
          assert.strictEqual(
            fragment.get('automation'),
            AUTOMATION,
            'for the automation itself, which approving ends the wait',
          );
          assert.strictEqual(fragment.get('operation'), null);
        });

        test('a notice for someone else shows no notice', async function (assert) {
          answer = {
            status: 200,
            attributes: {
              ...ACTIVE,
              state: 'waiting-for-credits',
              viewerIsPayer: false,
              notice: notice({
                reason: 'waiting-for-credits',
                forViewer: false,
              }),
            },
          };
          await openIsolated();
          await waitForStatus();
          assert.dom('[data-test-automation-notice]').doesNotExist();
        });
      });

      function line(
        seq: number,
        level: string,
        message: string,
        extra: Partial<LogLine> = {},
      ): LogLine {
        return {
          seq,
          at: Date.parse('2030-01-01T08:30:10.000Z') + seq * 1000,
          source: 'script',
          kind: 'console',
          level,
          message,
          ...extra,
        };
      }

      function report(attributes: Record<string, unknown> = {}) {
        return {
          dryRun: false,
          state: 'complete',
          timings: {
            createdAt: '2030-01-01T08:30:00.000Z',
            startedAt: '2030-01-01T08:30:05.000Z',
            commitStartedAt: '2030-01-01T08:30:58.000Z',
            committedAt: '2030-01-01T08:30:59.000Z',
            finishedAt: '2030-01-01T08:31:00.000Z',
            queuedMs: 5000,
            runMs: 55000,
            commitMs: 1000,
          },
          log: { lines: 0, dropped: 0, byLevel: {}, byKind: {} },
          callApiCalls: [],
          resolveCalls: [],
          writes: { count: 0 },
          cost: {
            credits: 0,
            creditsByKind: {},
            callApiCalls: 0,
            callApiResponseBytes: 0,
            resolveCalls: 0,
            writes: 0,
            aiCreditsSpent: 0,
            aiCreditsReserved: 0,
          },
          ...attributes,
        };
      }

      const plan = ['Fetch open issues', 'Group by label', 'Write digest'];
      function milestones(
        runId: string,
        state: string,
        reached: { name: string; ms: number; ended?: boolean }[],
        extra: Record<string, unknown> = {},
      ) {
        return {
          runId,
          state,
          startedAt: '2030-01-01T08:30:05.000Z',
          finishedAt: state === 'running' ? null : '2030-01-01T08:31:00.000Z',
          plan,
          milestones: reached.map(({ name, ms, ended }) => ({
            name,
            planned: true,
            startedAt: '2030-01-01T08:30:10.000Z',
            endedAt: ended === false ? null : '2030-01-01T08:30:20.000Z',
            ms,
            tasks: [],
          })),
          current: null,
          ahead: plan.slice(reached.length),
          failedIn: null,
          dropped: 0,
          tasksDropped: 0,
          ...extra,
        };
      }

      async function openRun(id: string, label: string) {
        await openIsolated();
        await waitFor('[data-test-automation-runs-section]', {
          timeout: 10000,
        });
        await settled();
        await click(
          '[data-test-automation-runs-section] [data-test-pretui-section-toggle]',
        );
        await click(
          `[data-test-automation-runs] button[aria-label^="Expand nightly run for"][aria-label$=", ${label}"]`,
        );
        await waitFor(`[data-test-automation-run-timeline="${id}"]`, {
          timeout: 10000,
        });
      }

      // Each marker of the opened run's timeline, in order: admission, the
      // script's milestones, then the commit.
      function markers(id: string) {
        return [
          ...document.querySelectorAll(
            `[data-test-automation-run-timeline="${id}"] [data-test-milestone-state]`,
          ),
        ].map((marker) => marker.getAttribute('data-test-milestone-state'));
      }

      function logMessages(id: string) {
        return [
          ...document.querySelectorAll(
            `[data-test-automation-run-timeline="${id}"] [data-test-automation-run-log-line]`,
          ),
        ].map((row) =>
          row
            .querySelector('td:last-child')
            ?.textContent?.replace(/\s+/g, ' ')
            .trim(),
        );
      }

      async function showTab(name: string) {
        let tab = [
          ...document.querySelectorAll(
            '[data-test-automation-run-tabs] [role="tab"]',
          ),
        ].find((element) => element.textContent?.trim() === name);
        await click(tab as HTMLElement);
      }

      function sendJobEvent(runId: string, state: string) {
        mockMatrixUtils.simulateRemoteMessage(
          mockMatrixUtils.getRoomIdForRealmAndUser(
            testRealmURL,
            '@testuser:localhost',
          ),
          testRealmInfo.realmUserId!,
          {
            eventName: 'job',
            runId,
            automation: AUTOMATION,
            state,
            step: 'script',
            milestone: 'Group by label',
            realmURL: testRealmURL,
          },
          { type: APP_BOXEL_REALM_EVENT_TYPE },
        );
      }

      test("a running run shows the run's steps, the milestone the run is in against the last run's time, and the log's lines as the run writes them", async function (assert) {
        let runningMilestones = milestones(
          'live',
          'running',
          [
            { name: 'Fetch open issues', ms: 3000 },
            { name: 'Group by label', ms: 4000, ended: false },
          ],
          { current: 'Group by label' },
        );
        list([
          run('live', {
            state: 'running',
            step: 'script',
            finishedAt: null,
            milestones: runningMilestones,
          }),
          run('earlier', {
            milestones: milestones('earlier', 'complete', [
              { name: 'Fetch open issues', ms: 2000 },
              { name: 'Group by label', ms: 9000 },
              { name: 'Write digest', ms: 6000 },
            ]),
          }),
        ]);
        reports.set(
          'live',
          report({
            state: 'running',
            milestones: runningMilestones,
            timings: {
              createdAt: '2030-01-01T08:30:00.000Z',
              startedAt: '2030-01-01T08:30:05.000Z',
              commitStartedAt: null,
              committedAt: null,
              finishedAt: null,
              queuedMs: 5000,
              runMs: null,
              commitMs: null,
            },
          }),
        );
        logs.set('live', {
          state: 'running',
          lines: [line(0, 'log', 'Fetched 12 open issues', { scriptLine: 4 })],
        });
        await openRun('live', 'Running');

        assert.deepEqual(
          markers('live'),
          ['reached', 'reached', 'running', 'not-started', 'not-started'],
          'admission is done, the run is in the second of the script’s milestones, and the third and the commit have not started',
        );
        let detail = text('[data-test-automation-run-timeline="live"]') ?? '';
        assert.true(
          detail.includes('Waited 5 s'),
          'admission says when the run started and how long the run waited',
        );
        assert
          .dom('[data-test-automation-run-time-zone]')
          .includesText(
            Intl.DateTimeFormat().resolvedOptions().timeZone,
            'one line names the viewer’s time zone, which every time reads in',
          );
        assert
          .dom('[data-test-automation-run-milestones]')
          .includesText('Running for 4 s · Last run took 9 s');
        assert
          .dom('[data-test-automation-run-milestones]')
          .includesText(
            'Last run took 6 s',
            'a milestone still ahead reads against the last run',
          );

        await waitFor('[data-test-automation-run-log-line]', {
          timeout: 10000,
        });
        assert.deepEqual(logMessages('live'), [
          'Fetched 12 open issues line 4',
        ]);

        // The card reads the report as the row opens and again once the
        // log's first page brings a line. A job event naming the run reads
        // the report once more; the log brings nothing new meanwhile, so
        // nothing else reads the report.
        await waitUntil(() => reportsAsked.length >= 2, {
          timeout: 10000,
          timeoutMessage: 'the report was never read again for the log’s line',
        });
        let readsBefore = reportsAsked.length;
        sendJobEvent('live', 'running');
        await waitUntil(() => reportsAsked.length > readsBefore, {
          timeout: 10000,
          timeoutMessage: 'a job event naming the run never read the report',
        });
        assert.true(
          reportsAsked.every((runId) => runId === 'live'),
          'every report read is of the opened run',
        );

        // A line the run writes shows while the run goes, read at the
        // follow interval or at once on a job event naming the run.
        logs
          .get('live')!
          .lines.push(line(1, 'warn', 'Skipped 3 archived issues'));
        sendJobEvent('live', 'running');
        await waitUntil(() => logMessages('live').length === 2, {
          timeout: 10000,
          timeoutMessage: 'the new line never showed',
        });
        assert.deepEqual(logMessages('live'), [
          'Fetched 12 open issues line 4',
          'Skipped 3 archived issues',
        ]);
        assert.true(
          logAsked.every(
            (url) => url.searchParams.get('realm') === testRealmURL,
          ),
          'every read names the run’s realm',
        );
      });

      test("a finished run shows every step done, the run's calls, the files the run saved, and the run's cost", async function (assert) {
        let done = milestones('done', 'complete', [
          { name: 'Fetch open issues', ms: 3000 },
          { name: 'Group by label', ms: 4000 },
          { name: 'Write digest', ms: 1000 },
        ]);
        list([run('done', { step: 'commit', milestones: done })]);
        reports.set(
          'done',
          report({
            milestones: done,
            callApiCalls: [
              {
                seq: 2,
                at: '2030-01-01T08:30:12.000Z',
                operation: 'listIssues',
                method: 'GET',
                destination:
                  'https://api.github.com/repos/acme/app/issues?state=•••',
                status: 200,
                ms: 340,
                bytes: 2048,
              },
              {
                seq: 3,
                at: '2030-01-01T08:30:13.000Z',
                operation: 'listIssues',
                code: 'destination-not-declared',
              },
            ],
            resolveCalls: [
              {
                seq: 5,
                at: '2030-01-01T08:30:20.000Z',
                model: 'anthropic/claude-haiku',
                status: 200,
                ms: 1200,
                costInUsd: 0.0021,
                inputTokens: 1200,
                outputTokens: 300,
              },
            ],
            writes: {
              count: 2,
              committed: ['digests/2030-01-01.md', 'digests/index.json'],
            },
            cost: {
              credits: 3,
              creditsByKind: { run: 1, ai: 2 },
              callApiCalls: 2,
              callApiResponseBytes: 2048,
              resolveCalls: 1,
              writes: 1,
              aiCreditsSpent: 2,
              aiCreditsReserved: 0,
            },
          }),
        );
        await openRun('done', 'Complete');

        assert.deepEqual(
          markers('done'),
          ['reached', 'reached', 'reached', 'reached', 'reached'],
          'admission, each milestone and the commit are done',
        );
        assert.true(
          (text('[data-test-automation-run-timeline="done"]') ?? '').includes(
            '55 s in all',
          ),
          'the row where the run ended says how long the run took',
        );

        await showTab('Calls');
        assert
          .dom('[data-test-automation-run-call="2"]')
          .includesText('200')
          .includesText(
            'GET https://api.github.com/repos/acme/app/issues?state=•••',
          );
        assert
          .dom('[data-test-automation-run-call="3"]')
          .includesText('Refused', 'a call Boxel refused names no status');
        assert
          .dom('[data-test-automation-run-resolve="5"]')
          .includesText('anthropic/claude-haiku');
        assert
          .dom(
            '[data-test-automation-run-resolve="5"] [data-test-automation-run-resolve-tokens]',
          )
          .hasText('1,200 in · 300 out', 'an AI request shows its tokens');
        assert
          .dom('[data-test-automation-run-calls]')
          .doesNotIncludeText('$', 'an AI request shows no unit cost');

        await showTab('Writes');
        assert
          .dom('[data-test-automation-run-writes-sentence]')
          .hasText('The run saved 2 files to the workspace.');
        assert
          .dom('[data-test-automation-run-saved]')
          .exists({ count: 2 }, 'each saved file is listed');

        await showTab('Cost');
        let charge = (kind: string) =>
          text(
            `[data-test-automation-run-receipt] [data-test-automation-run-charge="${kind}"]`,
          )?.trim();
        assert.strictEqual(charge('run'), 'Compute and network 1');
        assert.strictEqual(charge('ai'), 'AI requests 2');
        assert.strictEqual(charge('batched_ai'), 'Batched AI requests 0');
        assert.strictEqual(
          charge('run_indexing'),
          'Indexing the saved files 0',
        );
        assert.strictEqual(
          charge('total'),
          'Total charged for the run 3',
          'the total is the sum of the lines above the total',
        );
        await waitUntil(
          () =>
            text('[data-test-automation-run-storage]')?.includes(
              'day of storage',
            ),
          { timeout: 10000, timeoutMessage: 'the storage never read' },
        );
        assert
          .dom('[data-test-automation-run-storage]')
          .includesText('The run saved 1 file (4 KB) that still exists.')
          .includesText('The automation’s runs keep 2 files in all (10 KB).')
          .includesText(
            'A day of storage for those files costs 0.0042 credits.',
          );
        await showTab('Limits');
        assert
          .dom('[data-test-automation-run-limit]')
          .exists({ count: 6 }, 'every per-run limit the card sets is listed');
        assert
          .dom('[data-test-automation-run-limit="writes"]')
          .hasText('Saves 1 of 1')
          .hasAttribute(
            'data-test-automation-run-limit-reached',
            'true',
            'a run at a limit reads as reaching the limit',
          );
        assert
          .dom('[data-test-automation-run-limit="callApiCalls"]')
          .hasText('Outside calls 2 of none allowed');
        await showTab('Cost');
        assert
          .dom('[data-test-automation-run-storage-rules]')
          .includesText('Storage isn’t part of any one run’s total')
          .includesText(
            'Boxel charges for every day the automation’s status reads On',
          )
          .includesText(
            'Boxel doesn’t charge for a day the automation spends wholly paused, waiting for credits, waiting for key approval or done',
          );
      });

      test('a failed run names the milestone the run failed in', async function (assert) {
        let failed = milestones(
          'failed',
          'error',
          [
            { name: 'Fetch open issues', ms: 3000 },
            { name: 'Group by label', ms: 4000 },
          ],
          { failedIn: 'Group by label' },
        );
        list([
          run('failed', {
            state: 'error',
            step: 'script',
            errorReason: 'script-error',
            errorMessage: 'TypeError: labels is undefined',
            scriptLine: 12,
            milestones: failed,
          }),
        ]);
        reports.set('failed', report({ state: 'error', milestones: failed }));
        logs.set('failed', {
          state: 'error',
          lines: [
            line(0, 'error', 'TypeError: labels is undefined', {
              kind: 'error',
              scriptLine: 12,
            }),
          ],
        });
        await openRun('failed', 'Failed');

        assert.deepEqual(markers('failed'), [
          'reached',
          'reached',
          'failed',
          'not-started',
          'not-started',
        ]);
        let failedRow = [
          ...document.querySelectorAll(
            '[data-test-automation-run-milestones] li',
          ),
        ].find((row) => row.textContent?.includes('Group by label'));
        assert.true(
          failedRow?.textContent?.includes('Failed here'),
          'the milestone the run failed in says so',
        );
        await waitFor('[data-test-automation-run-log-line]', {
          timeout: 10000,
        });
        assert.deepEqual(logMessages('failed'), [
          'TypeError: labels is undefined line 12',
        ]);
      });

      test('the log shows the lines at the level picked and every more severe level, and asks only for those levels', async function (assert) {
        list([run('levels', { step: 'commit' })]);
        reports.set(
          'levels',
          report({
            log: {
              lines: 4,
              dropped: 0,
              byLevel: { log: 1, info: 1, warn: 1, error: 1 },
              byKind: {},
            },
          }),
        );
        logs.set('levels', {
          state: 'complete',
          lines: [
            line(0, 'log', 'Started the digest'),
            line(1, 'info', 'Fetched 12 open issues'),
            line(2, 'warn', 'Skipped 3 archived issues'),
            line(3, 'error', 'Lost the docs label'),
          ],
        });
        await openRun('levels', 'Complete');
        await waitUntil(() => logMessages('levels').length === 4, {
          timeout: 10000,
          timeoutMessage: 'the log never showed every line',
        });

        // The option names its level and counts that level's lines and every
        // more severe level's.
        assert
          .dom('[data-test-automation-run-log-levels]')
          .hasText('Errors (1) Warnings (2) Info (3) All (4)');
        for (let [level, asked, messages] of [
          ['error', 'error', ['Lost the docs label']],
          [
            'warn',
            'error,warn',
            ['Skipped 3 archived issues', 'Lost the docs label'],
          ],
          [
            'info',
            'error,warn,info',
            [
              'Fetched 12 open issues',
              'Skipped 3 archived issues',
              'Lost the docs label',
            ],
          ],
          [
            'log',
            'error,warn,info,log',
            [
              'Started the digest',
              'Fetched 12 open issues',
              'Skipped 3 archived issues',
              'Lost the docs label',
            ],
          ],
        ] as const) {
          await click(
            `[data-test-automation-run-log-levels] [data-test-pretui-segmented-option="${level}"]`,
          );
          await waitUntil(
            () =>
              JSON.stringify(logMessages('levels')) ===
              JSON.stringify(messages),
            {
              timeout: 10000,
              timeoutMessage: `the ${level} filter never showed its lines`,
            },
          );
          assert.deepEqual(logMessages('levels'), [...messages], level);
          assert.strictEqual(
            logAsked[logAsked.length - 1].searchParams.get('level'),
            asked,
            `the log asks for ${asked} lines`,
          );
        }
      });
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

    test('a limit below the estimate says Boxel may stop starting runs before the month ends', async function (assert) {
      await openScreen(OFF);
      await fillIn('[data-test-automation-switch-on-cap] input', '5');
      assert
        .dom('[data-test-automation-switch-on-screen]')
        .includesText(
          'The limit is below the estimate, so Boxel may stop starting runs before the month ends.',
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

    test('an active automation offers no switch-on screen', async function (assert) {
      answer = { status: 200, attributes: ACTIVE };
      await openIsolated();
      await waitForStatus();
      assert.dom('[data-test-automation-switch-on]').doesNotExist();
    });

    test('an automation paused for a reason other than a raised limit or batched AI offers no switch-on screen', async function (assert) {
      answer = {
        status: 200,
        attributes: { ...ACTIVE, state: 'paused', pauseReason: 'requested' },
      };
      await openIsolated();
      await waitForStatus();
      assert.dom('[data-test-automation-state="Paused"]').exists();
      assert
        .dom('[data-test-automation-switch-on]')
        .doesNotExist('a pause someone asked for resumes without the screen');
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

    module('key approvals', function () {
      const INBOX = { module: `${testRealmURL}inbox`, name: 'Inbox' };
      const SHARE = {
        id: 'share-1',
        label: 'Team GitHub',
        owner: '@writer:localhost',
      };

      function keyApprovals(
        operations: Record<string, unknown>[],
        approved = false,
      ) {
        return { approved, version: 'v1.40', operations };
      }
      const APPROVED = {
        operation: 'listPRs',
        targetType: INBOX,
        state: 'approved',
      };
      const PAYER_MISSING = {
        operation: 'listIssues',
        targetType: INBOX,
        state: 'missing',
        missing: [{ slot: 'userKey', canApprove: 'payer' }],
      };
      const OTHER_MISSING = {
        operation: 'postComment',
        targetType: INBOX,
        state: 'missing',
        missing: [
          { slot: 'apiKey', canApprove: 'another-key-owner', shares: [SHARE] },
        ],
      };
      const NOBODY_YET = {
        operation: 'postComment',
        targetType: INBOX,
        state: 'missing',
        missing: [{ slot: 'apiKey', canApprove: 'nobody-yet' }],
      };

      function keyStates() {
        return [
          ...document.querySelectorAll(
            '[data-test-automation-switch-on-key-state]',
          ),
        ].map((e) =>
          e.getAttribute('data-test-automation-switch-on-key-state'),
        );
      }

      test('every key approved: the screen lists each operation as approved, and turning on closes the screen', async function (assert) {
        let { calls } = stubWindowOpen(windowMock);
        estimateAnswer = estimate({
          keyApprovals: keyApprovals([APPROVED], true),
        });
        postAnswer = {
          status: 201,
          body: {
            data: { type: 'automation' },
            meta: { keyApprovals: keyApprovals([APPROVED], true) },
          },
        };
        await openScreen(OFF);
        assert.deepEqual(keyStates(), ['Approved']);
        assert
          .dom('[data-test-automation-switch-on-payer-approves]')
          .doesNotExist();
        await click('[data-test-automation-switch-on-confirm]');
        await waitUntil(() => posted.length > 0, { timeout: 10000 });
        await settled();
        assert
          .dom('dialog[open] [data-test-automation-switch-on-screen]')
          .doesNotExist('the screen closes');
        assert.deepEqual(calls, [], 'no secure window opens');
      });

      test('approvals the payer gives open the secure window in the same step, for the automation, and the screen shows the automation as on once the approvals land', async function (assert) {
        let { calls } = stubWindowOpen(windowMock);
        estimateAnswer = estimate({
          keyApprovals: keyApprovals([APPROVED, PAYER_MISSING]),
        });
        postAnswer = {
          status: 201,
          body: {
            data: {
              type: 'automation',
              attributes: { state: 'waiting-for-key-approval' },
            },
            meta: { keyApprovals: keyApprovals([APPROVED, PAYER_MISSING]) },
          },
        };
        await openScreen(OFF);
        assert.deepEqual(keyStates(), ['Approved', 'You approve']);
        assert
          .dom('[data-test-automation-switch-on-payer-approves]')
          .includesText(
            'Turning on the automation opens Boxel’s secure window, where you approve the calls the automation makes with your keys.',
          );
        await click('[data-test-automation-switch-on-confirm]');
        await waitFor('[data-test-automation-switch-on-waiting]', {
          timeout: 10000,
        });
        assert.strictEqual(calls.length, 1, 'one secure window opens');
        let opened = new URL(calls[0].url);
        assert.strictEqual(opened.pathname.split('/').pop(), 'approve');
        assert.deepEqual(
          Object.fromEntries(new URLSearchParams(opened.hash.slice(1))),
          {
            automation: AUTOMATION,
            reason: 'To approve the calls the automation makes with your keys',
          },
          'for the automation, which the window reads the missing approvals of',
        );
        assert
          .dom('[data-test-automation-switch-on-approve-keys]')
          .includesText('Approve the calls in the secure window');
        assert.deepEqual(keyStates(), ['Approved', 'Waiting for you']);

        estimateAnswer = estimate({
          switchedOn: true,
          keyApprovals: keyApprovals(
            [
              APPROVED,
              { ...PAYER_MISSING, state: 'approved', missing: undefined },
            ],
            true,
          ),
        });
        window.dispatchEvent(new Event('focus'));
        await waitFor('[data-test-automation-switch-on-active]', {
          timeout: 10000,
        });
        assert
          .dom('[data-test-automation-switch-on-active]')
          .includesText('The automation is on');
        assert.deepEqual(keyStates(), ['Approved', 'Approved']);
        await click('[data-test-automation-switch-on-close]');
        assert
          .dom('dialog[open] [data-test-automation-switch-on-screen]')
          .doesNotExist('the screen closes');
      });

      test('a secure window the browser blocks: the screen says so and offers to open the window', async function (assert) {
        let stub = stubWindowOpen(windowMock);
        stub.state.blocked = true;
        estimateAnswer = estimate({
          keyApprovals: keyApprovals([PAYER_MISSING]),
        });
        postAnswer = {
          status: 201,
          body: {
            data: { type: 'automation' },
            meta: { keyApprovals: keyApprovals([PAYER_MISSING]) },
          },
        };
        await openScreen(OFF);
        await click('[data-test-automation-switch-on-confirm]');
        await waitFor('[data-test-automation-switch-on-approve-keys]', {
          timeout: 10000,
        });
        await settled();
        assert
          .dom('[data-test-automation-switch-on-approve-keys]')
          .includesText('Open the secure window')
          .includesText(
            'The browser kept Boxel from opening the secure window.',
          );
        stub.state.blocked = false;
        await click('[data-test-automation-switch-on-reopen-window]');
        await waitUntil(() => stub.calls.length === 2, { timeout: 10000 });
        assert
          .dom('[data-test-automation-switch-on-approve-keys]')
          .includesText('Boxel opened the secure window');
      });

      test('a suspended share waits on the share’s owner, and never opens the secure window for the payer', async function (assert) {
        let { calls } = stubWindowOpen(windowMock);
        let suspended = {
          ...PAYER_MISSING,
          missing: [
            {
              slot: 'apiKey',
              canApprove: 'payer',
              shares: [
                { ...SHARE, owner: '@testuser:localhost', suspended: true },
              ],
            },
          ],
        };
        estimateAnswer = estimate({ keyApprovals: keyApprovals([suspended]) });
        postAnswer = {
          status: 201,
          body: {
            data: { type: 'automation' },
            meta: { keyApprovals: keyApprovals([suspended]) },
          },
        };
        await openScreen(OFF);
        assert.deepEqual(keyStates(), ['Share suspended']);
        assert
          .dom('[data-test-automation-switch-on-key-detail]')
          .hasText(
            '@testuser:localhost resumes the share Team GitHub before anyone approves the call.',
          );
        assert
          .dom('[data-test-automation-switch-on-payer-approves]')
          .doesNotExist();
        await click('[data-test-automation-switch-on-confirm]');
        await waitFor('[data-test-automation-switch-on-waiting]', {
          timeout: 10000,
        });
        assert.deepEqual(calls, [], 'no secure window opens');
      });

      test('an approval another person gives: the screen names the key and its owner, and the automation switches on waiting with no secure window', async function (assert) {
        let { calls } = stubWindowOpen(windowMock);
        estimateAnswer = estimate({
          keyApprovals: keyApprovals([OTHER_MISSING]),
        });
        postAnswer = {
          status: 201,
          body: {
            data: { type: 'automation' },
            meta: { keyApprovals: keyApprovals([OTHER_MISSING]) },
          },
        };
        await openScreen(OFF);
        assert.deepEqual(keyStates(), ['Another person approves']);
        assert
          .dom('[data-test-automation-switch-on-key-detail]')
          .hasText(
            '@writer:localhost approves the use of the key Team GitHub.',
          );
        assert
          .dom('[data-test-automation-switch-on-other-approvers]')
          .includesText(
            '@writer:localhost approves the automation’s use of the key Team GitHub.',
          )
          .includesText(
            'The automation waits and runs nothing until all approvals are in place.',
          );
        await click('[data-test-automation-switch-on-confirm]');
        await waitFor('[data-test-automation-switch-on-waiting]', {
          timeout: 10000,
        });
        assert.deepEqual(calls, [], 'no secure window opens');
        assert
          .dom('[data-test-automation-switch-on-approve-keys]')
          .doesNotExist();
      });

      test('a share’s owner the viewer may not see is named as the owner of the key', async function (assert) {
        estimateAnswer = estimate({
          keyApprovals: keyApprovals([
            {
              ...OTHER_MISSING,
              missing: [
                {
                  slot: 'apiKey',
                  canApprove: 'another-key-owner',
                  shares: [{ ...SHARE, owner: null }],
                },
              ],
            },
          ]),
        });
        await openScreen(OFF);
        assert
          .dom('[data-test-automation-switch-on-key-detail]')
          .hasText(
            'The owner of the key approves the use of the key Team GitHub.',
          );
      });

      test('no share yet: the screen says a realm administrator shares a key, and Share a key opens the secure window’s share page', async function (assert) {
        let { calls } = stubWindowOpen(windowMock);
        estimateAnswer = estimate({
          keyApprovals: keyApprovals([NOBODY_YET]),
        });
        await openScreen(OFF);
        assert.deepEqual(keyStates(), ['No key shared']);
        assert
          .dom('[data-test-automation-switch-on-no-share]')
          .includesText(
            'The automation calls a service with a key that a realm administrator shares with the realm, and nobody has shared a key yet.',
          )
          .includesText(
            'Share a key with the realm first, and then turn on the automation.',
          );
        assert
          .dom('[data-test-automation-switch-on-confirm]')
          .doesNotExist('the screen can’t turn the automation on yet');
        assert
          .dom('[data-test-automation-switch-on-share-key]')
          .exists({ count: 1 })
          .hasText('Share a key', 'Share a key is the primary action');
        await click('[data-test-automation-switch-on-share-key]');
        await waitUntil(() => calls.length > 0, { timeout: 10000 });
        let opened = new URL(calls[0].url);
        assert.strictEqual(opened.pathname.split('/').pop(), 'share-key');
        assert.strictEqual(
          new URLSearchParams(opened.hash.slice(1)).get('realm'),
          testRealmURL,
        );

        // A realm administrator shares a key meanwhile; coming back to the
        // page reads the key approvals again.
        estimateAnswer = estimate({
          keyApprovals: keyApprovals([PAYER_MISSING]),
        });
        window.dispatchEvent(new Event('focus'));
        await waitUntil(() => keyStates().join() === 'You approve', {
          timeout: 10000,
        });
        assert
          .dom('[data-test-automation-switch-on-confirm]')
          .exists('the screen can turn the automation on once a key is shared');
      });
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
  module('key approvals', function (hooks) {
    let opened: string[];

    hooks.beforeEach(function () {
      opened = [];
      let secureWindow = getService('secure-window');
      secureWindow.open = (url: string) => {
        opened.push(url);
        return 'opened';
      };
    });

    const INBOX_MODULE = `${testRealmURL}inbox`;
    const ME = '@testuser:localhost';
    const COLLEAGUE = '@colleague:localhost';

    function operationWith(operation: string, slots: object[]) {
      return {
        operation,
        targetType: { module: INBOX_MODULE, name: 'Inbox' },
        state: 'missing',
        slots,
      };
    }

    function withApprovals(
      operations: object[],
      { approved = false, state = 'waiting-for-key-approval' } = {},
    ) {
      return {
        ...ACTIVE,
        state,
        nextRun: null,
        keyApprovals: { approved, operations },
      };
    }

    // The fragment of the secure window URL the view opened, as a record,
    // leaving out the one line of reason the window shows, which every
    // opening carries.
    function openedFor(url: string) {
      let { reason, ...fragment } = Object.fromEntries(
        new URLSearchParams(new URL(url).hash.slice(1)),
      );
      return reason ? fragment : { ...fragment, reason: 'missing' };
    }

    function slotText(slot: string) {
      return text(`[data-test-automation-key-approval-slot="${slot}"]`);
    }

    test('the isolated view asks for key approvals, and the fitted view does not', async function (assert) {
      answer = { status: 200, attributes: ACTIVE };
      await openIsolated();
      await waitForStatus();
      assert.true(
        askedKeyApprovals.every(Boolean),
        'every status read of the isolated view asks for key approvals',
      );
      await openFormat('fitted');
      await settled();
      // Code mode renders the isolated view before the fitted format is
      // picked, so only the fitted view's own reads count from here: an
      // `automation` event makes it read again.
      askedKeyApprovals = [];
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(testRealmURL, ME),
        testRealmInfo.realmUserId!,
        {
          eventName: 'automation',
          automation: AUTOMATION,
          realmURL: testRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
      await waitUntil(() => askedKeyApprovals.length > 0, { timeout: 10000 });
      assert.false(
        askedKeyApprovals.some(Boolean),
        'the fitted view, which lists in the console, checks no approvals',
      );
    });

    test('all approved: each key names its owner and when the owner approved the automation', async function (assert) {
      answer = {
        status: 200,
        attributes: withApprovals(
          [
            {
              ...operationWith('list', [
                {
                  slot: 'userKey',
                  kind: 'userKey',
                  state: 'approved',
                  key: { name: 'Vendor key' },
                  viewerIsKeyOwner: true,
                  keyOwner: ME,
                  approvedAt: '2030-01-01T09:00:00.000Z',
                },
              ]),
              state: 'approved',
            },
            {
              ...operationWith('shared', [
                {
                  slot: 'apiKey',
                  kind: 'apiKey',
                  state: 'approved',
                  share: { id: 'share-1', label: 'Team vendor' },
                  viewerIsKeyOwner: false,
                  keyOwner: COLLEAGUE,
                  approvedAt: '2030-01-02T09:00:00.000Z',
                },
              ]),
              state: 'approved',
            },
          ],
          { approved: true, state: 'active' },
        ),
      };
      await openIsolated();
      await waitFor('[data-test-automation-key-approvals]', { timeout: 10000 });
      assert
        .dom('[data-test-automation-key-approval-state="approved"]')
        .exists({ count: 2 });
      assert.true(
        slotText('userKey')?.includes(
          'You approved the automation’s use of the key “Vendor key”.',
        ),
        slotText('userKey'),
      );
      assert.true(
        slotText('apiKey')?.includes(
          `${COLLEAGUE} approved the automation’s use of the shared key “Team vendor”.`,
        ),
        slotText('apiKey'),
      );
      assert
        .dom('[data-test-automation-key-approval-since]')
        .exists({ count: 2 });
      assert.dom('[data-test-automation-key-approval-fix]').doesNotExist();
    });

    test('waiting on the viewer: the approve button opens the secure window for the automation', async function (assert) {
      answer = {
        status: 200,
        attributes: withApprovals([
          operationWith('list', [
            {
              slot: 'userKey',
              kind: 'userKey',
              state: 'waiting',
              viewerIsKeyOwner: true,
              keyOwner: ME,
              fix: 'approve',
            },
          ]),
        ]),
      };
      await openIsolated();
      await waitFor('[data-test-automation-key-approval-fix="approve"]', {
        timeout: 10000,
      });
      assert.true(
        slotText('userKey')?.includes(
          'You need to approve the automation’s use of the key.',
        ),
        slotText('userKey'),
      );
      await click('[data-test-automation-key-approval-fix="approve"]');
      await waitUntil(() => opened.length > 0, { timeout: 10000 });
      assert.true(opened[0].includes('/approve'), opened[0]);
      assert.deepEqual(openedFor(opened[0]), { automation: AUTOMATION });
    });

    test('waiting on someone else: the row names who acts, only under ADR 011, and offers no link', async function (assert) {
      answer = {
        status: 200,
        attributes: withApprovals([
          operationWith('shared', [
            {
              slot: 'apiKey',
              kind: 'apiKey',
              state: 'waiting',
              share: { id: 'share-1', label: 'Team vendor' },
              viewerIsKeyOwner: false,
              keyOwner: COLLEAGUE,
              actor: 'key-owner',
            },
          ]),
          operationWith('list', [
            {
              slot: 'userKey',
              kind: 'userKey',
              state: 'waiting',
              viewerIsKeyOwner: false,
              keyOwner: null,
              actor: 'key-owner',
            },
          ]),
        ]),
      };
      await openIsolated();
      await waitFor('[data-test-automation-key-approvals]', { timeout: 10000 });
      assert.true(
        slotText('apiKey')?.includes(
          `${COLLEAGUE} needs to approve the automation’s use of the shared key “Team vendor”.`,
        ),
        slotText('apiKey'),
      );
      assert.true(
        slotText('userKey')?.includes(
          'The key’s owner needs to approve the automation’s use of the key.',
        ),
        'a key owner the viewer shares no realm grant with goes unnamed',
      );
      assert.dom('[data-test-automation-key-approval-fix]').doesNotExist();
    });

    test('needs reapproval, a suspended share, a rejected key and no share each link to the page that fixes them', async function (assert) {
      answer = {
        status: 200,
        attributes: withApprovals([
          operationWith('list', [
            {
              slot: 'userKey',
              kind: 'userKey',
              state: 'needs-reapproval',
              key: { name: 'Vendor key' },
              viewerIsKeyOwner: true,
              keyOwner: ME,
              fix: 'review-changes',
            },
          ]),
          operationWith('shared', [
            {
              slot: 'apiKey',
              kind: 'apiKey',
              state: 'share-suspended',
              share: {
                id: 'share-1',
                label: 'Team vendor',
                suspensionReason: 'owner-lost-write',
              },
              viewerIsKeyOwner: false,
              keyOwner: COLLEAGUE,
              fix: 'swap-key',
            },
          ]),
          operationWith('rejected', [
            {
              slot: 'userKey',
              kind: 'userKey',
              state: 'key-rejected',
              key: { name: 'Old key' },
              viewerIsKeyOwner: true,
              keyOwner: ME,
              approvedAt: '2030-01-01T09:00:00.000Z',
              fix: 'replace-key',
            },
          ]),
          operationWith('unshared', [
            {
              slot: 'apiKey',
              kind: 'apiKey',
              state: 'no-share',
              viewerIsKeyOwner: false,
              keyOwner: null,
              fix: 'share-key',
            },
          ]),
        ]),
      };
      await openIsolated();
      await waitFor('[data-test-automation-key-approvals]', { timeout: 10000 });
      let expected: [string, string, Record<string, string>][] = [
        [
          'review-changes',
          '/review-changes',
          {
            module: INBOX_MODULE,
            name: 'Inbox',
            realm: testRealmURL,
            operation: 'list',
          },
        ],
        ['swap-key', '/swap-key', { realm: testRealmURL, share: 'share-1' }],
        [
          'replace-key',
          '/replace-key',
          {
            module: INBOX_MODULE,
            name: 'Inbox',
            realm: testRealmURL,
            operation: 'rejected',
          },
        ],
        ['share-key', '/share-key', { realm: testRealmURL }],
      ];
      for (let [fix, page, fragment] of expected) {
        opened = [];
        await click(`[data-test-automation-key-approval-fix="${fix}"]`);
        await waitUntil(() => opened.length > 0, { timeout: 10000 });
        assert.true(opened[0].includes(page), `${fix}: ${opened[0]}`);
        assert.deepEqual(openedFor(opened[0]), fragment, fix);
      }
      for (let state of [
        'needs-reapproval',
        'share-suspended',
        'key-rejected',
        'no-share',
      ]) {
        assert
          .dom(`[data-test-automation-key-approval-state="${state}"]`)
          .exists(state);
      }
      assert
        .dom('[data-test-automation-key-approval="shared"]')
        .includesText(
          'Boxel suspended the shared key “Team vendor” because the key’s owner is no longer a realm administrator. A realm administrator needs to replace the shared key with another key.',
        );
    });

    test('a run’s event during the key check doesn’t drop the check', async function (assert) {
      let waitingSlot = {
        slot: 'userKey',
        kind: 'userKey',
        state: 'waiting',
        viewerIsKeyOwner: true,
        keyOwner: ME,
        fix: 'approve',
      };
      answer = {
        status: 200,
        attributes: withApprovals([operationWith('list', [waitingSlot])]),
      };
      await openIsolated();
      await waitFor('[data-test-automation-key-approval-state="waiting"]', {
        timeout: 10000,
      });

      function simulate(content: Record<string, unknown>) {
        mockMatrixUtils.simulateRemoteMessage(
          mockMatrixUtils.getRoomIdForRealmAndUser(testRealmURL, ME),
          testRealmInfo.realmUserId!,
          { automation: AUTOMATION, realmURL: testRealmURL, ...content },
          { type: APP_BOXEL_REALM_EVENT_TYPE },
        );
      }

      // The approval lands; the key check it sets off is slow.
      answer = {
        status: 200,
        attributes: withApprovals(
          [
            {
              ...operationWith('list', [
                {
                  ...waitingSlot,
                  state: 'approved',
                  fix: undefined,
                  approvedAt: '2030-01-01T09:00:00.000Z',
                },
              ]),
              state: 'approved',
            },
          ],
          { approved: true, state: 'active' },
        ),
      };
      let release!: () => void;
      holdKeyedReads = new Promise<void>((resolve) => (release = resolve));
      try {
        let before = askedKeyApprovals.length;
        simulate({ eventName: 'automation' });
        await waitUntil(() => askedKeyApprovals.length > before, {
          timeout: 10000,
        });
        // A run moves while the key check is still out: its read replaces
        // the keyed one, so it has to make the check itself.
        simulate({
          eventName: 'job',
          runId: 'run-live',
          state: 'running',
          step: 'script',
          milestone: null,
        });
        await waitUntil(() => askedKeyApprovals.length > before + 1, {
          timeout: 10000,
        });
        assert.true(
          askedKeyApprovals[askedKeyApprovals.length - 1],
          'the run’s read makes the key check the read it replaced still owed',
        );
      } finally {
        holdKeyedReads = undefined;
        release();
      }
      await waitFor('[data-test-automation-key-approval-state="approved"]', {
        timeout: 10000,
      });
      assert
        .dom('[data-test-automation-key-approval-state="waiting"]')
        .doesNotExist();
    });

    test('an approval that lands updates the section without a reload', async function (assert) {
      let waiting = withApprovals([
        operationWith('list', [
          {
            slot: 'userKey',
            kind: 'userKey',
            state: 'waiting',
            viewerIsKeyOwner: true,
            keyOwner: ME,
            fix: 'approve',
          },
        ]),
      ]);
      answer = { status: 200, attributes: waiting };
      await openIsolated();
      await waitFor('[data-test-automation-key-approval-state="waiting"]', {
        timeout: 10000,
      });

      answer = {
        status: 200,
        attributes: withApprovals(
          [
            {
              ...operationWith('list', [
                {
                  slot: 'userKey',
                  kind: 'userKey',
                  state: 'approved',
                  viewerIsKeyOwner: true,
                  keyOwner: ME,
                  approvedAt: '2030-01-01T09:00:00.000Z',
                },
              ]),
              state: 'approved',
            },
          ],
          { approved: true, state: 'active' },
        ),
      };
      mockMatrixUtils.simulateRemoteMessage(
        mockMatrixUtils.getRoomIdForRealmAndUser(testRealmURL, ME),
        testRealmInfo.realmUserId!,
        {
          eventName: 'automation',
          automation: AUTOMATION,
          realmURL: testRealmURL,
        },
        { type: APP_BOXEL_REALM_EVENT_TYPE },
      );
      await waitFor('[data-test-automation-key-approval-state="approved"]', {
        timeout: 10000,
      });
      assert.dom('[data-test-automation-key-approval-fix]').doesNotExist();
      assert.dom('[data-test-automation-state="On"]').exists();
    });
  });

  module('storage', function (hooks) {
    // What the storage route answers, and how many times the view asked.
    let storage: Record<string, unknown> | undefined;
    let storageAsked: number;

    // The current UTC month and the one before, as YYYY-MM, since the view
    // totals the charges of the current month.
    let now = new Date();
    let thisMonth = now.toISOString().slice(0, 7);
    let lastMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15),
    )
      .toISOString()
      .slice(0, 7);

    hooks.beforeEach(function () {
      storage = undefined;
      storageAsked = 0;
      getService('network').virtualNetwork.mount(
        async (request: Request) => {
          let url = new URL(request.url);
          if (!url.pathname.endsWith('/_automation-storage')) {
            return null;
          }
          storageAsked++;
          return storage
            ? new Response(
                JSON.stringify({
                  data: {
                    type: 'automation-storage',
                    id: AUTOMATION,
                    attributes: storage,
                  },
                }),
                {
                  status: 200,
                  headers: { 'content-type': 'application/json' },
                },
              )
            : new Response(JSON.stringify({ errors: [] }), { status: 403 });
        },
        { prepend: true },
      );
    });

    function answerStorage(attributes: Record<string, unknown>) {
      storage = {
        switchedOn: true,
        payer: '@testuser:localhost',
        viewerIsPayer: true,
        files: [],
        fileBytes: 0,
        indexBytes: 0,
        dailyCredits: 0,
        pricingVersion: 'test',
        charges: [],
        chargeStopped: null,
        ...attributes,
      };
    }

    // A YYYY-MM-DD day as the view sets it.
    function shortDay(day: string, withYear = false) {
      let [y, m, d] = day.split('-').map(Number);
      return new Date(y, m - 1, d).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' } : {}),
      });
    }

    async function openStorage() {
      await openIsolated();
      await waitFor('[data-test-automation-storage-lead]', { timeout: 10000 });
    }

    test('a direct writer sees each file the runs created, the totals and the daily charge', async function (assert) {
      answer = { status: 200, attributes: ACTIVE };
      answerStorage({
        files: [
          {
            path: 'digests/2030-01-01.md',
            run: 'done',
            createdAt: '2030-01-01T08:31:00.000Z',
            fileBytes: 3000,
            indexBytes: 1000,
          },
          {
            path: 'digests/2029-12-31.md',
            run: 'earlier',
            createdAt: '2029-12-31T08:31:00.000Z',
            fileBytes: 5000,
            indexBytes: 1000,
          },
        ],
        fileBytes: 8000,
        indexBytes: 2000,
        dailyCredits: 0.0042,
      });
      await openStorage();

      assert
        .dom('[data-test-automation-storage-file]')
        .exists({ count: 2 }, 'one row for each file');
      assert
        .dom(
          '[data-test-automation-storage-file="digests/2030-01-01.md"] [data-test-automation-storage-file-bytes]',
        )
        .hasText('3 kB');
      assert
        .dom(
          '[data-test-automation-storage-file="digests/2030-01-01.md"] [data-test-automation-storage-index-bytes]',
        )
        .hasText('1 kB');
      assert
        .dom(
          '[data-test-automation-storage-file="digests/2029-12-31.md"] [data-test-automation-storage-show-run="earlier"]',
        )
        .hasAttribute(
          'aria-label',
          'Show the run that created digests/2029-12-31.md',
        );
      let section = text('[data-test-automation-storage]') ?? '';
      assert.ok(section.includes('Files 2'), section);
      assert.ok(section.includes('On disk 8 kB'), section);
      assert.ok(section.includes('In the index 2 kB'), section);
      assert.ok(section.includes('Daily charge 0.0042 credits a day'), section);
      assert.ok(section.includes('Charged this month 0 credits'), section);
      assert
        .dom('[data-test-automation-storage-charges]')
        .doesNotExist('no charge yet, so no charge history');
      assert.dom('[data-test-automation-storage-stopped]').doesNotExist();
    });

    test('the charge history shows the days each charge covers, a month at a time with each month’s total', async function (assert) {
      answer = { status: 200, attributes: ACTIVE };
      answerStorage({
        files: [
          {
            path: 'digests/2030-01-01.md',
            run: 'done',
            createdAt: '2030-01-01T08:31:00.000Z',
            fileBytes: 3000,
            indexBytes: 1000,
          },
        ],
        fileBytes: 3000,
        indexBytes: 1000,
        dailyCredits: 0.4,
        charges: [
          {
            day: `${thisMonth}-05`,
            firstDay: `${thisMonth}-02`,
            days: 3,
            fileBytes: 2500000,
            indexBytes: 40000,
            credits: 2,
          },
          {
            day: `${thisMonth}-01`,
            firstDay: `${thisMonth}-01`,
            days: 1,
            fileBytes: 2000000,
            indexBytes: 30000,
            credits: 1,
          },
          {
            day: `${lastMonth}-20`,
            firstDay: `${lastMonth}-18`,
            days: 3,
            fileBytes: 1500000,
            indexBytes: 20000,
            credits: 1,
          },
        ],
      });
      await openStorage();

      let multiDay = `[data-test-automation-storage-charge="${thisMonth}-05"]`;
      assert
        .dom(`${multiDay} [data-test-automation-storage-charge-days]`)
        .hasText(
          `${shortDay(`${thisMonth}-02`)} – ${shortDay(`${thisMonth}-05`, true)}`,
          'a charge that covers several days shows the span',
        );
      assert
        .dom(`${multiDay} [data-test-automation-storage-charge-count]`)
        .hasText('3 days billed');
      assert
        .dom(`${multiDay} [data-test-automation-storage-charge-bytes]`)
        .hasText('2.5 MB on disk, 40 kB in the index');

      let oneDay = `[data-test-automation-storage-charge="${thisMonth}-01"]`;
      assert
        .dom(`${oneDay} [data-test-automation-storage-charge-days]`)
        .hasText(
          shortDay(`${thisMonth}-01`, true),
          'a charge for one day shows the day alone',
        );
      assert
        .dom(`${oneDay} [data-test-automation-storage-charge-count]`)
        .doesNotExist();

      assert
        .dom(`[data-test-automation-storage-month="${thisMonth}"]`)
        .includesText('3');
      assert
        .dom(`[data-test-automation-storage-month="${thisMonth}"]`)
        .includesText('Charged in');
      assert
        .dom(`[data-test-automation-storage-month="${lastMonth}"]`)
        .includesText('1');
      let rows = [
        ...document.querySelectorAll(
          '[data-test-automation-storage-charges] tbody tr',
        ),
      ].map(
        (row) =>
          row.getAttribute('data-test-automation-storage-charge') ??
          `month ${row.getAttribute('data-test-automation-storage-month')}`,
      );
      assert.deepEqual(
        rows,
        [
          `${thisMonth}-05`,
          `${thisMonth}-01`,
          `month ${thisMonth}`,
          `${lastMonth}-20`,
          `month ${lastMonth}`,
        ],
        'newest first, each month closing with the month’s total',
      );
      assert.ok(
        text('[data-test-automation-storage]')?.includes(
          'Charged this month 3 credits',
        ),
      );
    });

    test('a paused automation says Boxel isn’t charging for storage, and from which day', async function (assert) {
      answer = {
        status: 200,
        attributes: { ...ACTIVE, state: 'paused', pauseReason: 'requested' },
      };
      answerStorage({
        files: [
          {
            path: 'digests/2030-01-01.md',
            run: 'done',
            createdAt: '2030-01-01T08:31:00.000Z',
            fileBytes: 3000,
            indexBytes: 1000,
          },
        ],
        fileBytes: 3000,
        indexBytes: 1000,
        dailyCredits: 0.0042,
        chargeStopped: {
          state: 'paused',
          pauseReason: 'requested',
          since: '2030-01-14T10:00:00.000Z',
          fromDay: '2030-01-15',
        },
      });
      await openStorage();

      assert
        .dom('[data-test-automation-storage-stopped="paused"]')
        .includesText('Boxel isn’t charging for storage')
        .includesText(
          'The automation is paused, so Boxel doesn’t charge for the automation’s storage.',
        )
        .includesText(
          'The files stay in the workspace, and Boxel charges again from the day the automation’s status reads On again.',
        );
      assert
        .dom('[data-test-automation-storage-stopped-from]')
        .hasText(shortDay('2030-01-15', true));
      assert.ok(
        text('[data-test-automation-storage]')?.includes(
          'Daily charge None while the automation is paused',
        ),
      );
    });

    test('an automation whose runs created no files says storage costs nothing yet', async function (assert) {
      answer = { status: 200, attributes: ACTIVE };
      answerStorage({});
      await openStorage();

      assert
        .dom('[data-test-automation-storage-empty]')
        .includesText('Storage costs nothing yet')
        .includesText(
          'The automation’s runs haven’t created any files, so storage costs nothing yet.',
        );
      assert.dom('[data-test-automation-storage-files]').doesNotExist();
      assert.dom('[data-test-automation-storage-charges]').doesNotExist();
      assert
        .dom('[data-test-automation-storage-totals]')
        .doesNotExist('nothing to total');
    });

    test("a viewer who isn't a direct writer sees no storage", async function (assert) {
      answerStorage({});
      await openIsolated();
      await waitUntil(() => asked.length > 0, { timeout: 10000 });
      await settled();
      assert.dom('[data-test-automation-storage]').doesNotExist();
      assert.strictEqual(storageAsked, 0, 'the view never reads the storage');
    });
  });
});
