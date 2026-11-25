import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import {
  automationIOFor,
  loadAutomationConfirmation,
  namedAutomationCalls,
  type AutomationConfirmation,
} from '@cardstack/host/lib/realm-runner/automations';
import RunRealmCodeTool from '@cardstack/host/tools/run-realm-code';

import {
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  setupRealmServerEndpoints,
  testRealmURL,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const SALE_END = `${testRealmURL}automations/sale-end`;

// A card with the Automation card's stored shape. The realm server, stubbed
// here, decides which cards are automations; the gate and the run read only
// the card's triggers, monthly cap and name.
const AUTOMATION_SHAPE = `
  import { CardDef, FieldDef, field, contains, containsMany } from '@cardstack/base/card-api';
  import StringField from '@cardstack/base/string';
  import NumberField from '@cardstack/base/number';

  class Trigger extends FieldDef {
    @field kind = contains(StringField);
    @field label = contains(StringField);
    @field date = contains(StringField);
    @field time = contains(StringField);
    @field timeZone = contains(StringField);
    @field expression = contains(StringField);
  }
  class Caps extends FieldDef {
    @field monthlyCredits = contains(NumberField);
  }
  export class AutomationShape extends CardDef {
    @field triggers = containsMany(Trigger);
    @field caps = contains(Caps);
  }
`;

function saleEndJSON(time = '15:00') {
  return {
    data: {
      type: 'card',
      attributes: {
        cardInfo: { name: 'End the sale' },
        triggers: [
          {
            kind: 'once',
            label: 'end-sale',
            date: '2030-01-02',
            time,
            timeZone: 'America/Chicago',
          },
        ],
        caps: { monthlyCredits: 25 },
      },
      meta: {
        adoptsFrom: { module: '../automation-shape', name: 'AutomationShape' },
      },
    },
  };
}

interface Posted {
  route: string;
  body: any;
}

module('Integration | tools | run-realm-code | automations', function (hooks) {
  setupRenderingTest(hooks);
  setupLocalIndexing(hooks);

  let posted: Posted[] = [];
  // What the switch-on answers for the automation's key approvals.
  let keyApprovals: Record<string, unknown> = {
    approved: true,
    operations: [],
  };

  setupRealmServerEndpoints(hooks);

  // The realm server's automation routes, as the stubbed fetch answers them.
  const routes: {
    route: string;
    getResponse: (req: Request) => Promise<Response>;
  }[] = [
    {
      route: '_automation-switch-on',
      getResponse: async (req: Request) => {
        if (req.method === 'GET') {
          return Response.json({
            data: {
              type: 'automation-estimate',
              id: SALE_END,
              attributes: {
                switchedOn: false,
                monthlyCredits: 25,
                estimate: { credits: 3, perRun: { totalCredits: 3 } },
                keyApprovals,
              },
            },
          });
        }
        let body = await req.json();
        posted.push({ route: '_automation-switch-on', body });
        return Response.json(
          {
            data: {
              type: 'automation',
              id: SALE_END,
              attributes: {
                state:
                  keyApprovals.approved === false
                    ? 'waiting-for-key-approval'
                    : 'active',
                nextRun:
                  keyApprovals.approved === false
                    ? null
                    : '2030-01-02T21:00:00.000Z',
              },
            },
            meta: { estimate: { credits: 3 }, keyApprovals },
          },
          { status: 201 },
        );
      },
    },
    {
      route: '_automation-run-report',
      getResponse: async () =>
        Response.json({
          data: {
            type: 'automation-run-report',
            id: 'run-1',
            attributes: { run: { state: 'complete' }, stagedFiles: [] },
          },
        }),
    },
    {
      route: '_automation-run-log',
      getResponse: async () =>
        Response.json({
          data: {
            type: 'automation-run-log',
            id: 'run-1',
            attributes: {
              state: 'complete',
              lines: [
                {
                  at: 1,
                  source: 'script',
                  kind: 'console',
                  level: 'info',
                  message: 'Ended 1 sale',
                  scriptLine: 4,
                },
              ],
              next: 1,
              more: false,
              total: 1,
              dropped: 0,
            },
          },
        }),
    },
    {
      route: '_automation-preview-file',
      getResponse: async (req: Request) =>
        new URL(req.url).searchParams.get('path') === 'Sale/flash-sale.json'
          ? new Response('{"status":"ended"}\n')
          : new Response('{}', { status: 404 }),
    },
    ...['_automation-preview', '_automation-run-now'].map((route) => ({
      route,
      getResponse: async (req: Request) => {
        let body = await req.json();
        posted.push({ route, body });
        return Response.json(
          {
            data: {
              type: 'automation-run',
              id: 'run-1',
              attributes: {
                state: 'pending',
                dryRun: route === '_automation-preview',
              },
            },
          },
          { status: 202 },
        );
      },
    })),
  ];

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [testRealmURL],
    autostart: true,
  });
  setupRealmCacheTeardown(hooks);

  let opened: string[] = [];

  hooks.beforeEach(async function () {
    posted = [];
    opened = [];
    keyApprovals = { approved: true, operations: [] };
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'automation-shape.gts': AUTOMATION_SHAPE,
        'automations/sale-end.json': saleEndJSON(),
      },
    });
    Object.defineProperty(getService('realm-server'), 'authedFetch', {
      value: async (url: string, init?: RequestInit) => {
        let request = new Request(url, init);
        let { pathname } = new URL(url);
        let endpoint = routes.find((r) => pathname.endsWith(`/${r.route}`));
        return endpoint
          ? await endpoint.getResponse(request)
          : new Response('{}', { status: 404 });
      },
      configurable: true,
    });
    let secureWindow = getService('secure-window');
    secureWindow.open = (url: string) => {
      opened.push(url);
      return 'opened';
    };
  });

  // What the gate shows the reader for each start call the script names,
  // read the way the gate reads it.
  async function confirmationsFor(
    code: string,
  ): Promise<AutomationConfirmation[]> {
    let io = automationIOFor({
      realmServer: getService('realm-server'),
      network: getService('network'),
    });
    return await Promise.all(
      namedAutomationCalls(code).map((named) =>
        loadAutomationConfirmation(io, named, testRealmURL),
      ),
    );
  }

  function runTool() {
    return new RunRealmCodeTool(getService('tool-service').toolContext);
  }

  test('a script that previews, runs or switches on an automation always waits for the click, and names each call', function (assert) {
    for (let call of ['preview', 'runNow', 'switchOn']) {
      let code = `return await realm.automations.${call}('automations/sale-end.json');`;
      assert.true(
        RunRealmCodeTool.neverAutoExecutesFor({ code }),
        `a run that names realm.automations.${call} waits for a click`,
      );
      assert.deepEqual(
        RunRealmCodeTool.clickReasonsFor({ code }).map((r) => r.call),
        [`realm.automations.${call}`],
      );
    }
    assert.false(
      RunRealmCodeTool.neverAutoExecutesFor({
        code: `return await realm.automations.estimate('automations/sale-end.json');`,
      }),
      'reading an estimate spends nothing, so it keeps the room mode',
    );
  });

  test('the tool service never allows an automation call for the whole session', function (assert) {
    let toolService = getService('tool-service');
    toolService.allowAlways('!room:example.com', [
      'realm.automations.switchOn',
      'realm.fs.delete',
    ]);
    assert.false(
      toolService.isAlwaysAllowed(
        '!room:example.com',
        'realm.automations.switchOn',
      ),
    );
    assert.true(
      toolService.isAlwaysAllowed('!room:example.com', 'realm.fs.delete'),
    );
  });

  test('no switch-on, Preview or Run now happens without the reader’s confirmation', async function (assert) {
    for (let call of ['preview', 'runNow', 'switchOn']) {
      let tool = runTool();
      await assert.rejects(
        tool.execute({
          realm: testRealmURL,
          roomId: '!room:example.com',
          code: `return await realm.automations.${call}('automations/sale-end.json');`,
        }),
        /has not confirmed it, so nothing ran/,
        `realm.automations.${call} is refused without a confirmation`,
      );
    }
    assert.deepEqual(posted, [], 'the realm server got no request');
  });

  test('a start call for a card the gate did not show is refused', async function (assert) {
    let code = `let path = 'automations/' + 'sale-end.json'; return await realm.automations.switchOn(path);`;
    let tool = runTool();
    tool.confirmedAutomations = await confirmationsFor(
      `realm.automations.switchOn('automations/sale-end.json')`,
    );
    await assert.rejects(
      tool.execute({ realm: testRealmURL, roomId: '!room:example.com', code }),
      /names its automation card by a literal path in the script/,
    );
    assert.deepEqual(posted, [], 'the realm server got no request');
  });

  test('a confirmed one-time switch-on is scheduled in the time zone the reader saw, at the confirmed cap', async function (assert) {
    let code = `return await realm.automations.switchOn('automations/sale-end.json');`;
    let confirmations = await confirmationsFor(code);
    let [confirmation] = confirmations;
    assert.strictEqual(confirmation.title, 'End the sale');
    assert.strictEqual(confirmation.monthlyCredits, 25);
    assert.strictEqual(confirmation.estimatedCredits, 3);
    assert.strictEqual(
      confirmation.triggers[0].at,
      Date.UTC(2030, 0, 2, 21, 0) / 1000,
      '15:00 in America/Chicago is 21:00 UTC',
    );
    assert.true(
      confirmation.triggers[0].text.includes(
        'Wednesday, January 2, 2030 at 3:00 PM CST (America/Chicago)',
      ),
      `the gate names the weekday, the time and the zone: ${confirmation.triggers[0].text}`,
    );

    let tool = runTool();
    tool.confirmedAutomations = confirmations;
    let result = await tool.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code,
    });
    let answer = JSON.parse(result.scriptResult!);
    assert.strictEqual(answer.state, 'active');
    assert.strictEqual(answer.nextRun, '2030-01-02T21:00:00.000Z');
    assert.deepEqual(posted, [
      {
        route: '_automation-switch-on',
        body: {
          data: {
            type: 'automation',
            id: SALE_END,
            attributes: { realm: testRealmURL, monthlyCredits: 25 },
          },
        },
      },
    ]);
    assert.deepEqual(result.automationActions, [
      `Switched on ${SALE_END} (active)`,
    ]);
    assert.deepEqual(opened, [], 'no key approval was missing');
  });

  test('a switch-on refuses triggers that changed after the reader confirmed them', async function (assert) {
    let code = `return await realm.automations.switchOn('automations/sale-end.json');`;
    let tool = runTool();
    tool.confirmedAutomations = await confirmationsFor(code);
    await getService('card-service').saveSource(
      new URL('automations/sale-end.json', testRealmURL),
      JSON.stringify(saleEndJSON('18:00'), null, 2),
      'editor',
    );
    await assert.rejects(
      tool.execute({ realm: testRealmURL, roomId: '!room:example.com', code }),
      /changed after the person confirmed the automation/,
    );
    assert.deepEqual(posted, [], 'nothing was switched on');
  });

  test('a Run now refuses a card whose caps changed after the reader confirmed it', async function (assert) {
    let code = `return await realm.automations.runNow('automations/sale-end.json');`;
    let tool = runTool();
    tool.confirmedAutomations = await confirmationsFor(code);
    let raised = saleEndJSON();
    raised.data.attributes.caps.monthlyCredits = 2500;
    await getService('card-service').saveSource(
      new URL('automations/sale-end.json', testRealmURL),
      JSON.stringify(raised, null, 2),
      'editor',
    );
    await assert.rejects(
      tool.execute({ realm: testRealmURL, roomId: '!room:example.com', code }),
      /changed after the person confirmed the automation/,
    );
    assert.deepEqual(posted, [], 'no run started');
  });

  test('a script that starts an automation may not write the automation card', async function (assert) {
    let code = `
      await realm.cards.update('automations/sale-end', { caps: { monthlyCredits: 2500 } });
      return await realm.automations.runNow('automations/sale-end.json');
    `;
    let tool = runTool();
    tool.confirmedAutomations = await confirmationsFor(code);
    await assert.rejects(
      tool.execute({ realm: testRealmURL, roomId: '!room:example.com', code }),
      /would change automations\/sale-end, which this script's automation call names/,
    );
    assert.deepEqual(posted, [], 'no run started');
  });

  test('a run reads a run report with its log lines, and a file a Preview staged', async function (assert) {
    let code = `
      let run = await realm.automations.readRun('run-1');
      let file = await realm.automations.readPreviewFile('run-1', 'Sale/flash-sale.json');
      return { run, file };
    `;
    let result = await runTool().execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code,
    });
    let { run, file } = JSON.parse(result.scriptResult!);
    assert.strictEqual(run.run.state, 'complete');
    assert.deepEqual(run.logLines, [
      { level: 'info', message: 'Ended 1 sale', scriptLine: 4 },
    ]);
    assert.false(run.logLinesMore);
    assert.deepEqual(file, {
      path: 'Sale/flash-sale.json',
      bytes: 19,
      text: '{"status":"ended"}\n',
    });
  });

  test('a switch-on that needs key approvals opens the secure window for the reader’s own and names who gives the rest', async function (assert) {
    keyApprovals = {
      approved: false,
      version: 'v1',
      operations: [
        {
          operation: 'listIssues',
          targetType: { module: `${testRealmURL}github`, name: 'Repo' },
          state: 'missing',
          missing: [{ slot: 'userKey', canApprove: 'payer' }],
        },
        {
          operation: 'sendDigest',
          targetType: { module: `${testRealmURL}mail`, name: 'Mailer' },
          state: 'missing',
          missing: [
            {
              slot: 'apiKey',
              canApprove: 'another-key-owner',
              shares: [
                {
                  id: 's1',
                  label: 'Team mail key',
                  owner: '@rupert:localhost',
                },
              ],
            },
          ],
        },
        {
          operation: 'chargeCard',
          targetType: { module: `${testRealmURL}pay`, name: 'Payments' },
          state: 'missing',
          missing: [{ slot: 'apiKey', canApprove: 'nobody-yet' }],
        },
      ],
    };
    let code = `return await realm.automations.switchOn('automations/sale-end.json');`;
    let tool = runTool();
    tool.confirmedAutomations = await confirmationsFor(code);
    let result = await tool.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code,
    });
    let answer = JSON.parse(result.scriptResult!);
    assert.strictEqual(answer.state, 'waiting-for-key-approval');
    assert.deepEqual(answer.keyApprovals, {
      approved: false,
      secureWindow: 'opened',
      forYou: ['listIssues'],
      byOthers: [
        {
          operation: 'sendDigest',
          key: 'Team mail key',
          owner: '@rupert:localhost',
        },
      ],
      needShare: ['chargeCard'],
      suspended: [],
    });
    assert.strictEqual(opened.length, 1, 'the secure window opened once');
    assert.true(
      opened[0].includes(`automation=${encodeURIComponent(SALE_END)}`),
      `the window approves for the automation: ${opened[0]}`,
    );
  });

  test('a confirmed Preview and Run now start one run each, charged to the reader', async function (assert) {
    let code = `
      let preview = await realm.automations.preview('automations/sale-end.json');
      let run = await realm.automations.runNow('automations/sale-end.json');
      return { preview, run };
    `;
    let tool = runTool();
    tool.confirmedAutomations = await confirmationsFor(code);
    let result = await tool.execute({
      realm: testRealmURL,
      roomId: '!room:example.com',
      code,
    });
    let answer = JSON.parse(result.scriptResult!);
    assert.deepEqual(answer.preview, {
      automation: SALE_END,
      run: 'run-1',
      state: 'pending',
      dryRun: true,
    });
    assert.deepEqual(
      posted.map((p) => p.route),
      ['_automation-preview', '_automation-run-now'],
    );
    for (let p of posted) {
      assert.strictEqual(p.body.data.id, SALE_END);
      assert.strictEqual(typeof p.body.data.attributes.click, 'string');
    }
    assert.deepEqual(result.automationActions, [
      `Started a Preview of ${SALE_END}, run run-1`,
      `Started a run now of ${SALE_END}, run run-1`,
    ]);
  });
});
