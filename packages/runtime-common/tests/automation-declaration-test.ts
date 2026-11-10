import {
  cronFrequencyError,
  readAutomationDeclaration,
  type AutomationIndexEntry,
  type AutomationProblemCode,
  type AutomationReadResult,
} from '../automation-declaration.ts';
import { zonedDateTimeToUnixSeconds } from '../automation-schedule.ts';
import type { SharedTests } from '../helpers/index.ts';

const REALM = 'https://realm.example/team/';
const CARD = `${REALM}automations/nightly`;
const TYPE_KEY = '@cardstack/catalog/automation/automation/Automation';
const SUBTYPE_KEY = `${REALM}my-automation/MyAutomation`;

const CAPS = {
  callApiCalls: 10,
  responseBytes: 1_000_000,
  resolveCalls: 2,
  writes: 5,
  seconds: 300,
  monthlyCredits: 500,
};

function cron(expression: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'cron',
    label: 'nightly',
    expression,
    timeZone: 'America/Chicago',
    untilDate: null,
    untilTime: { value: null },
    count: null,
    date: null,
    time: { value: null },
    webhookPath: null,
    params: [],
    ...extra,
  };
}

function entry({
  attributes = {},
  script = '../scripts/nightly.js',
  types = [`${REALM}automations/Automation`, TYPE_KEY],
}: {
  attributes?: Record<string, unknown>;
  script?: string | null;
  types?: string[] | null;
} = {}): AutomationIndexEntry {
  return {
    url: CARD,
    realmURL: REALM,
    types,
    instance: {
      id: CARD,
      type: 'card',
      attributes: {
        triggers: [cron('30 2 * * *')],
        operations: [],
        caps: CAPS,
        params: [],
        milestones: [],
        batchedAI: null,
        ...attributes,
      },
      relationships:
        script === null ? {} : { script: { links: { self: script } } },
      meta: {
        adoptsFrom: {
          module: '@cardstack/catalog/automation/automation',
          name: 'Automation',
        },
      },
    },
  };
}

function read(e: AutomationIndexEntry): AutomationReadResult {
  return readAutomationDeclaration(e, { automationTypeKey: TYPE_KEY });
}

function codes(
  result: AutomationReadResult,
): [AutomationProblemCode, string][] {
  return result.ok ? [] : result.problems.map((p) => [p.code, p.path]);
}

const tests = Object.freeze({
  'reads a valid automation into its declaration': async (assert) => {
    let result = read(
      entry({
        attributes: {
          triggers: [
            cron('30 2 * * *', {
              count: 10,
              untilDate: '2026-12-31',
              params: [{ name: 'mode', value: 'full' }],
            }),
            {
              ...cron(''),
              kind: 'once',
              label: 'launch',
              expression: null,
              date: '2026-11-20',
              time: { value: '15:00' },
            },
            {
              ...cron(''),
              kind: 'webhook',
              label: 'push',
              expression: null,
              timeZone: null,
              webhookPath: 'github-push',
            },
          ],
          operations: [
            {
              targetType: { module: '../github/repo', name: 'Repo' },
              operation: 'openIssues',
            },
          ],
          params: [{ name: 'owner', value: 'cardstack' }],
          milestones: ['fetch', 'write'],
          batchedAI: true,
        },
      }),
    );
    assert.true(result.ok, JSON.stringify(codes(result)));
    if (!result.ok) {
      return;
    }
    assert.deepEqual(result.declaration, {
      url: CARD,
      realmURL: REALM,
      script: `${REALM}scripts/nightly.js`,
      triggers: [
        {
          kind: 'cron',
          label: 'nightly',
          expression: '30 2 * * *',
          timeZone: 'America/Chicago',
          until: zonedDateTimeToUnixSeconds(
            '2026-12-31T23:59',
            'America/Chicago',
          ),
          count: 10,
          params: { mode: 'full' },
        },
        {
          kind: 'once',
          label: 'launch',
          at: zonedDateTimeToUnixSeconds('2026-11-20T15:00', 'America/Chicago'),
          timeZone: 'America/Chicago',
          params: {},
        },
        {
          kind: 'webhook',
          label: 'push',
          webhookPath: 'github-push',
          params: {},
        },
      ],
      operations: [
        {
          targetType: { module: `${REALM}github/repo`, name: 'Repo' },
          operation: 'openIssues',
        },
      ],
      caps: CAPS,
      params: { owner: 'cardstack' },
      milestones: ['fetch', 'write'],
      batchedAI: true,
    });
  },

  'batchedAI is off unless set to true': async (assert) => {
    let result = read(entry());
    assert.true(result.ok);
    assert.false(result.ok && result.declaration.batchedAI);
  },

  'an until time is read in the trigger time zone': async (assert) => {
    let result = read(
      entry({
        attributes: {
          triggers: [
            cron('0 * * * *', {
              timeZone: 'Australia/Sydney',
              untilDate: '2026-11-30',
              untilTime: { value: '08:15' },
            }),
          ],
        },
      }),
    );
    assert.true(result.ok);
    assert.strictEqual(
      result.ok && result.declaration.triggers[0].kind === 'cron'
        ? result.declaration.triggers[0].until
        : undefined,
      Date.parse('2026-11-29T21:15:00Z') / 1000,
    );
  },

  'accepts a subtype of Automation': async (assert) => {
    let result = read(entry({ types: [SUBTYPE_KEY, TYPE_KEY] }));
    assert.true(result.ok);
  },

  'refuses a card that does not adopt from Automation': async (assert) => {
    assert.deepEqual(
      codes(read(entry({ types: [`${REALM}automations/Automation`] }))),
      [['not-an-automation', '']],
      'a type that is only named Automation is not the catalog type',
    );
    assert.deepEqual(codes(read(entry({ types: null }))), [
      ['not-an-automation', ''],
    ]);
  },

  'refuses a row with no indexed document': async (assert) => {
    assert.deepEqual(codes(read({ ...entry(), instance: null })), [
      ['not-indexed', ''],
    ]);
  },

  'reports a missing script and a script outside the realm': async (assert) => {
    assert.deepEqual(codes(read(entry({ script: null }))), [
      ['missing-script', 'script'],
    ]);
    assert.deepEqual(
      codes(read(entry({ script: 'https://other.example/team/x.js' }))),
      [['script-outside-realm', 'script']],
    );
    assert.deepEqual(
      codes(read(entry({ script: '../../../elsewhere/x.js' }))),
      [['script-outside-realm', 'script']],
      'a relative link that climbs out of the realm',
    );
  },

  'reports a bad cron expression without throwing': async (assert) => {
    assert.deepEqual(
      codes(read(entry({ attributes: { triggers: [cron('every day')] } }))),
      [['invalid-cron', 'triggers.0.expression']],
    );
    assert.deepEqual(
      codes(read(entry({ attributes: { triggers: [cron('0 0 30 2 *')] } }))),
      [['invalid-cron', 'triggers.0.expression']],
      'an expression that never fires',
    );
  },

  'a cron trigger fires at most once every 5 minutes': async (assert) => {
    for (let expression of ['*/5 * * * *', '0,5 * * * *', '@hourly']) {
      assert.true(
        read(entry({ attributes: { triggers: [cron(expression)] } })).ok,
        `"${expression}" passes`,
      );
    }
    for (let expression of [
      '* * * * *',
      '*/2 * * * *',
      '0,3 * * * *',
      '*/4 * * * *',
    ]) {
      assert.deepEqual(
        codes(read(entry({ attributes: { triggers: [cron(expression)] } }))),
        [['cron-too-frequent', 'triggers.0.expression']],
        `"${expression}" is refused`,
      );
    }
  },

  'the 5-minute minimum spans the hour and midnight': async (assert) => {
    assert.strictEqual(
      cronFrequencyError('57 * * * *'),
      undefined,
      'once an hour',
    );
    assert.ok(
      cronFrequencyError('2,58 * * * *'),
      '58 and the next hour’s 2 are 4 minutes apart',
    );
    assert.strictEqual(
      cronFrequencyError('3,58 * * * *'),
      undefined,
      '58 and the next hour’s 3 are 5 minutes apart',
    );
    assert.ok(
      cronFrequencyError('58 23 * * *') === undefined &&
        cronFrequencyError('58,1 0,23 * * *') !== undefined,
      '23:58 and the next day’s 00:01 are 3 minutes apart',
    );
    assert.strictEqual(
      cronFrequencyError('58,1 0,23 * * MON'),
      undefined,
      'on Mondays only, 23:58 is never followed by a 00:01 the next day',
    );
    assert.ok(
      cronFrequencyError('58,1 0,23 * * MON,TUE'),
      'Monday 23:58 is followed by Tuesday 00:01',
    );
    assert.ok(
      cronFrequencyError('58,1 0,23 28-31 * *'),
      'the 28th 23:58 is followed by the 29th 00:01',
    );
    assert.strictEqual(
      cronFrequencyError('58,1 0,23 1,15 * *'),
      undefined,
      'the 1st and the 15th are never consecutive',
    );
    assert.ok(
      cronFrequencyError('58,1 0,23 31,1 * *'),
      'the 31st 23:58 is followed by the 1st 00:01',
    );
  },

  'the 5-minute minimum holds across daylight-saving changes': async (
    assert,
  ) => {
    // New York skips 02:00–03:00 in March: a skipped 02:58 fires at 03:58.
    assert.strictEqual(cronFrequencyError('1,58 2,4 * * *', 'UTC'), undefined);
    assert.ok(
      cronFrequencyError('1,58 2,4 * * *', 'America/New_York'),
      'the skipped 02:58 fires at 03:58, 3 minutes before 04:01',
    );
    assert.strictEqual(
      cronFrequencyError('0 2,3 * * *', 'America/New_York'),
      undefined,
      'a skipped 02:00 and 03:00 are the same instant, which fires once',
    );
    // Berlin repeats 02:00–03:00 in October: an hourly-style expression fires
    // those times twice.
    assert.strictEqual(cronFrequencyError('1,58 */2 * * *', 'UTC'), undefined);
    assert.ok(
      cronFrequencyError('1,58 */2 * * *', 'Europe/Berlin'),
      'the first 02:58 is 3 minutes before the repeated 02:01',
    );
    assert.strictEqual(
      cronFrequencyError('30 */2 * * *', 'Europe/Berlin'),
      undefined,
      'one time in the repeated hour fires twice, an hour apart',
    );
    assert.strictEqual(
      cronFrequencyError('1,58 1 * * *', 'America/New_York'),
      undefined,
      'a fixed-hour expression fires a repeated time once',
    );
    // Lord Howe skips half an hour, 02:00–02:30.
    assert.ok(
      cronFrequencyError('1,32 2 * * *', 'Australia/Lord_Howe'),
      'the skipped 02:01 fires at 02:31, a minute before 02:32',
    );
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              triggers: [
                cron('1,58 2,4 * * *', { timeZone: 'America/New_York' }),
              ],
            },
          }),
        ),
      ),
      [['cron-too-frequent', 'triggers.0.expression']],
      'the reader checks in the trigger’s time zone',
    );
  },

  'reports an unknown or missing time zone': async (assert) => {
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              triggers: [cron('0 9 * * *', { timeZone: 'Mars/Olympus_Mons' })],
            },
          }),
        ),
      ),
      [['invalid-time-zone', 'triggers.0.timeZone']],
    );
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: { triggers: [cron('0 9 * * *', { timeZone: null })] },
          }),
        ),
      ),
      [['missing-time-zone', 'triggers.0.timeZone']],
    );
  },

  'reports a seconds cap over 20 minutes': async (assert) => {
    assert.true(
      read(entry({ attributes: { caps: { ...CAPS, seconds: 1200 } } })).ok,
      '20 minutes passes',
    );
    assert.deepEqual(
      codes(read(entry({ attributes: { caps: { ...CAPS, seconds: 1201 } } }))),
      [['seconds-cap-too-high', 'caps.seconds']],
    );
  },

  'reports missing and invalid caps': async (assert) => {
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              caps: {
                ...CAPS,
                writes: null,
                resolveCalls: -1,
                callApiCalls: 1.5,
              },
            },
          }),
        ),
      ),
      [
        ['invalid-cap', 'caps.callApiCalls'],
        ['invalid-cap', 'caps.resolveCalls'],
        ['missing-cap', 'caps.writes'],
      ],
    );
    assert.deepEqual(
      codes(read(entry({ attributes: { caps: null } }))).map(([code]) => code),
      [
        'missing-cap',
        'missing-cap',
        'missing-cap',
        'missing-cap',
        'missing-cap',
        'missing-cap',
      ],
    );
  },

  'reports trigger labels that are missing or repeated': async (assert) => {
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              triggers: [
                cron('0 9 * * *', { label: 'daily' }),
                cron('0 18 * * *', { label: 'daily' }),
                cron('0 12 * * *', { label: '  ' }),
              ],
            },
          }),
        ),
      ),
      [
        ['duplicate-label', 'triggers.1.label'],
        ['missing-label', 'triggers.2.label'],
      ],
    );
  },

  'reports bad trigger kinds, counts, dates and webhook paths': async (
    assert,
  ) => {
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              triggers: [
                cron('0 9 * * *', { label: 'a', kind: 'hourly' }),
                cron('0 9 * * *', { label: 'b', count: 0 }),
                cron('0 9 * * *', { label: 'c', untilDate: '2026-02-30' }),
                cron('0 9 * * *', {
                  label: 'd',
                  untilTime: { value: '10:00' },
                }),
                cron('', {
                  label: 'e',
                  kind: 'once',
                  date: '2026-11-20',
                  time: { value: null },
                }),
                cron('', { label: 'f', kind: 'webhook', webhookPath: '' }),
              ],
            },
          }),
        ),
      ),
      [
        ['invalid-trigger-kind', 'triggers.0.kind'],
        ['invalid-count', 'triggers.1.count'],
        ['invalid-date-time', 'triggers.2.untilDate'],
        ['invalid-date-time', 'triggers.3.untilDate'],
        ['invalid-date-time', 'triggers.4.time'],
        ['missing-webhook-path', 'triggers.5.webhookPath'],
      ],
    );
  },

  'reports operations, params and milestones it cannot read': async (
    assert,
  ) => {
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              operations: [
                { targetType: { module: '../repo' }, operation: 'list' },
                {
                  targetType: { module: '../repo', name: 'Repo' },
                  operation: '',
                },
              ],
              params: [
                { name: 'owner', value: 'a' },
                { name: 'owner', value: 'b' },
                { name: '', value: 'c' },
              ],
              milestones: ['fetch', 'fetch', ''],
            },
          }),
        ),
      ),
      [
        ['invalid-operation', 'operations.0.targetType'],
        ['invalid-operation', 'operations.1.operation'],
        ['invalid-param', 'params.1.name'],
        ['invalid-param', 'params.2.name'],
        ['invalid-milestone', 'milestones.1'],
        ['invalid-milestone', 'milestones.2'],
      ],
    );
  },

  'reports every problem at once': async (assert) => {
    let result = read(
      entry({
        script: null,
        attributes: {
          triggers: [cron('* * * * *', { timeZone: 'Nowhere/Land' })],
          caps: { ...CAPS, seconds: 3600 },
        },
      }),
    );
    assert.deepEqual(codes(result), [
      ['missing-script', 'script'],
      ['cron-too-frequent', 'triggers.0.expression'],
      ['invalid-time-zone', 'triggers.0.timeZone'],
      ['seconds-cap-too-high', 'caps.seconds'],
    ]);
  },
}) as SharedTests<{}>;

export default tests;
