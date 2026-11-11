import {
  automationRef,
  cronFrequencyError,
  readAutomationDeclaration,
  type AutomationIndexEntry,
  type AutomationProblemCode,
  type AutomationReadResult,
} from '../automation-declaration.ts';
import { zonedDateTimeToUnixSeconds } from '../automation-schedule.ts';
import type { SharedTests } from '../helpers/index.ts';
import { PrefixRealmNetwork } from '../prefix-realm-network.ts';
import { rri } from '../realm-identifiers.ts';

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
  dailyCredits: 50,
  monthlyCredits: 500,
};

function cron(expression: string, extra: Record<string, unknown> = {}) {
  return {
    kind: 'cron',
    label: 'nightly',
    expression,
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
      id: rri(CARD),
      type: 'card',
      attributes: {
        triggers: [cron('30 2 * * *')],
        operations: [],
        caps: CAPS,
        params: [],
        batchedAI: null,
        ...attributes,
      },
      relationships:
        script === null ? {} : { script: { links: { self: script } } },
      meta: { adoptsFrom: automationRef },
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
            }),
            {
              ...cron(''),
              kind: 'once',
              label: 'launch',
              expression: null,
              date: '2026-11-20',
              time: '15:00',
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
      script: rri(`${REALM}scripts/nightly.js`),
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
        },
        {
          kind: 'once',
          label: 'launch',
          at: zonedDateTimeToUnixSeconds('2026-11-20T15:00', 'America/Chicago'),
          timeZone: 'America/Chicago',
        },
        {
          kind: 'webhook',
          label: 'push',
          webhookPath: 'github-push',
        },
      ],
      operations: [
        {
          targetType: { module: rri(`${REALM}github/repo`), name: 'Repo' },
          operation: 'openIssues',
        },
      ],
      caps: CAPS,
      params: { owner: 'cardstack' },
      batchedAI: true,
      batchDeadlineMinutes: 60,
    });
  },

  'a batch deadline is whole minutes from 1 to 24 hours, an hour when unset':
    async (assert) => {
      let unset = read(entry({ attributes: { batchedAI: true } }));
      assert.strictEqual(
        unset.ok && unset.declaration.batchDeadlineMinutes,
        60,
      );
      let set = read(
        entry({ attributes: { batchedAI: true, batchDeadlineMinutes: 1440 } }),
      );
      assert.strictEqual(set.ok && set.declaration.batchDeadlineMinutes, 1440);
      for (let bad of [0, 1441, 90.5, '60']) {
        assert.deepEqual(
          codes(read(entry({ attributes: { batchDeadlineMinutes: bad } }))),
          [['invalid-batch-deadline', 'batchDeadlineMinutes']],
          `${JSON.stringify(bad)} is refused`,
        );
      }
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
              untilTime: '08:15',
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
    assert.deepEqual(
      codes(read(entry({ script: '$REALM/scripts/x.js' }))),
      [['script-outside-realm', 'script']],
      'a realm-rooted link has no realm root to resolve against in URL form',
    );
  },

  'reads a card whose id is in prefix form': async (assert) => {
    let catalogURL = 'https://catalog.example.test/';
    let prefixEntry = (): AutomationIndexEntry => {
      let e = entry({
        attributes: {
          operations: [
            {
              targetType: { module: '../github/repo', name: 'Repo' },
              operation: 'openIssues',
            },
          ],
        },
      });
      return {
        ...e,
        url: `${catalogURL}automations/nightly`,
        realmURL: catalogURL,
        instance: {
          ...e.instance!,
          id: rri('@cardstack/catalog/automations/nightly'),
        },
      };
    };
    let result = readAutomationDeclaration(prefixEntry(), {
      automationTypeKey: TYPE_KEY,
      virtualNetwork: new PrefixRealmNetwork({
        '@cardstack/catalog/': catalogURL,
      }),
    });
    assert.true(result.ok, JSON.stringify(codes(result)));
    if (result.ok) {
      assert.strictEqual(
        result.declaration.script,
        '@cardstack/catalog/scripts/nightly.js',
        'the script keeps the card id’s form',
      );
      assert.deepEqual(result.declaration.operations, [
        {
          targetType: {
            module: rri('@cardstack/catalog/github/repo'),
            name: 'Repo',
          },
          operation: 'openIssues',
        },
      ]);
    }
    assert.deepEqual(
      codes(read(prefixEntry())),
      [['script-outside-realm', 'script']],
      'without a network, a prefix-form script is not found in a realm known by its URL',
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
    // Spring-forward is a Sunday in New York, so a schedule that never fires
    // on that day or the next isn't moved by it.
    assert.strictEqual(
      cronFrequencyError('1,58 2,4 * * MON', 'America/New_York'),
      undefined,
      'on Mondays only, the skipped Sunday 02:58 never fires',
    );
    assert.ok(
      cronFrequencyError('1,58 2,4 * * SUN', 'America/New_York'),
      'on Sundays, the skipped 02:58 fires at 03:58, 3 minutes before 04:01',
    );
    // London skips 01:00–02:00 in March: an expression that follows elapsed
    // time fires 00:58 and then 02:00, which is an hour less on the clock.
    assert.strictEqual(cronFrequencyError('0,58 */2 * * *', 'UTC'), undefined);
    assert.ok(
      cronFrequencyError('0,58 */2 * * *', 'Europe/London'),
      '00:58 GMT and 02:00 BST are 2 minutes apart',
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
    // Nuuk springs forward from 23:00 straight to 00:00.
    assert.strictEqual(cronFrequencyError('1,58 1,23 * * *', 'UTC'), undefined);
    assert.ok(
      cronFrequencyError('1,58 1,23 * * *', 'America/Nuuk'),
      'the skipped 23:58 fires at 00:58 the next day, 3 minutes before 01:01',
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
        'missing-credit-cap',
      ],
      'each run limit is required, and one credit limit',
    );
  },

  'either credit limit is enough on its own': async (assert) => {
    for (let [label, caps] of [
      ['daily only', { ...CAPS, monthlyCredits: null }],
      ['monthly only', { ...CAPS, dailyCredits: null }],
    ] as const) {
      let result = read(entry({ attributes: { caps } }));
      assert.true(result.ok, label);
      if (result.ok) {
        assert.deepEqual(
          [
            result.declaration.caps.dailyCredits,
            result.declaration.caps.monthlyCredits,
          ],
          [caps.dailyCredits, caps.monthlyCredits],
          `${label}: the empty one doesn't limit spending`,
        );
      }
    }
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              caps: { ...CAPS, dailyCredits: null, monthlyCredits: null },
            },
          }),
        ),
      ),
      [['missing-credit-cap', 'caps.monthlyCredits']],
    );
  },

  'reports a daily credit cap above the monthly one': async (assert) => {
    assert.true(
      read(
        entry({
          attributes: {
            caps: { ...CAPS, dailyCredits: 500, monthlyCredits: 500 },
          },
        }),
      ).ok,
      'a daily cap equal to the monthly one passes',
    );
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              caps: { ...CAPS, dailyCredits: 501, monthlyCredits: 500 },
            },
          }),
        ),
      ),
      [['daily-credits-above-monthly', 'caps.dailyCredits']],
    );
    assert.deepEqual(
      codes(
        read(
          entry({
            attributes: {
              caps: {
                ...CAPS,
                seconds: 1201,
                dailyCredits: 501,
                monthlyCredits: 500,
              },
            },
          }),
        ),
      ),
      [
        ['seconds-cap-too-high', 'caps.seconds'],
        ['daily-credits-above-monthly', 'caps.dailyCredits'],
      ],
      'reported alongside a problem with another cap',
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
                  untilTime: '10:00',
                }),
                cron('', {
                  label: 'e',
                  kind: 'once',
                  date: '2026-11-20',
                  time: null,
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

  'reports operations and params it cannot read': async (assert) => {
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
            },
          }),
        ),
      ),
      [
        ['invalid-operation', 'operations.0.targetType'],
        ['invalid-operation', 'operations.1.operation'],
        ['invalid-param', 'params.1.name'],
        ['invalid-param', 'params.2.name'],
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
