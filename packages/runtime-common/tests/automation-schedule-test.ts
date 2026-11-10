import {
  computeAutomationSchedule,
  countCronTimes,
  lastCronTime,
  cronExpressionError,
  isValidTimeZone,
  nextCronTime,
  nextCronTimes,
  parseCronExpression,
  zonedDateTimeToUnixSeconds,
  REMAINING_RUNS_LIMIT,
  type AutomationTrigger,
} from '../automation-schedule.ts';
import type { SharedTests } from '../helpers/index.ts';

const NEW_YORK = 'America/New_York';
const CHICAGO = 'America/Chicago';
const SYDNEY = 'Australia/Sydney';
const NUUK = 'America/Nuuk';

// In 2026, New York springs forward at 02:00 local on Mar 8 (07:00Z) and
// falls back at 02:00 local on Nov 1 (06:00Z). Sydney springs forward at
// 02:00 local on Oct 4 (Oct 3 16:00Z).

function at(iso: string): number {
  return Date.parse(iso) / 1000;
}

function iso(seconds: number | undefined): string | undefined {
  return seconds === undefined
    ? undefined
    : new Date(seconds * 1000).toISOString().replace('.000', '');
}

function local(dateTime: string, timeZone: string): number {
  return zonedDateTimeToUnixSeconds(dateTime, timeZone);
}

const tests = Object.freeze({
  'parses lists, ranges, steps and names': async (assert) => {
    let s = parseCronExpression('0,15-20/5 */6 1,15 JAN-mar mon-FRI');
    assert.deepEqual(s.minutes, [0, 15, 20]);
    assert.deepEqual(s.hours, [0, 6, 12, 18]);
    assert.deepEqual(
      [...s.daysOfMonth].sort((a, b) => a - b),
      [1, 15],
    );
    assert.deepEqual(
      [...s.months].sort((a, b) => a - b),
      [1, 2, 3],
    );
    assert.deepEqual(
      [...s.daysOfWeek].sort((a, b) => a - b),
      [1, 2, 3, 4, 5],
    );
    assert.true(s.daysOfMonthRestricted);
    assert.true(s.daysOfWeekRestricted);
    assert.true(
      s.followsElapsedTime,
      'an hour field starting with * follows elapsed time',
    );

    let fromStart = parseCronExpression('10/20 9 * * *');
    assert.deepEqual(fromStart.minutes, [10, 30, 50], 'n/step runs to the max');
    assert.false(fromStart.followsElapsedTime);
    assert.true(
      parseCronExpression('*/15 1 * * *').followsElapsedTime,
      'so does a minute field starting with *',
    );
    assert.false(fromStart.daysOfMonthRestricted);
  },

  'folds day-of-week 7 into Sunday': async (assert) => {
    assert.deepEqual([...parseCronExpression('0 0 * * 7').daysOfWeek], [0]);
    assert.deepEqual(
      [...parseCronExpression('0 0 * * 5-7').daysOfWeek].sort(),
      [0, 5, 6],
    );
  },

  'expands macros': async (assert) => {
    let after = at('2026-11-10T12:34:00Z');
    assert.strictEqual(
      iso(nextCronTime('@hourly', 'UTC', after)),
      '2026-11-10T13:00:00Z',
    );
    assert.strictEqual(
      iso(nextCronTime('@daily', 'UTC', after)),
      '2026-11-11T00:00:00Z',
    );
    assert.strictEqual(
      iso(nextCronTime('@weekly', 'UTC', after)),
      '2026-11-15T00:00:00Z',
      'Sunday midnight',
    );
    assert.strictEqual(
      iso(nextCronTime('@monthly', 'UTC', after)),
      '2026-12-01T00:00:00Z',
    );
    assert.strictEqual(
      iso(nextCronTime('@yearly', 'UTC', after)),
      '2027-01-01T00:00:00Z',
    );
  },

  'reports malformed expressions': async (assert) => {
    for (let bad of [
      '',
      '* * * *',
      '0 0 * * * *',
      '60 * * * *',
      '* 24 * * *',
      '* * 0 * *',
      '* * * 13 *',
      '* * * * 8',
      '5-1 * * * *',
      '*/0 * * * *',
      '1/2/3 * * * *',
      '1,,2 * * * *',
      'MON * * * *',
      '* * * FOO *',
      '@reboot',
      '? * * * *',
    ]) {
      assert.strictEqual(
        typeof cronExpressionError(bad),
        'string',
        `"${bad}" is reported`,
      );
    }
    assert.strictEqual(cronExpressionError('30 5 * * *'), undefined);
  },

  'reports an expression that names no real day': async (assert) => {
    assert.ok(cronExpressionError('0 0 30 2 *')?.includes('never fires'));
    assert.ok(
      cronExpressionError('0 0 31 4,6,9,11 *')?.includes('never fires'),
    );
    assert.strictEqual(
      cronExpressionError('0 0 31 2 MON'),
      undefined,
      'with both day fields restricted, the day of week still matches',
    );
    assert.strictEqual(cronExpressionError('0 0 29 2 *'), undefined);
  },

  'validates time zones': async (assert) => {
    assert.true(isValidTimeZone('America/Chicago'));
    assert.true(isValidTimeZone('UTC'));
    assert.false(isValidTimeZone('America/Atlantis'));
    assert.false(isValidTimeZone(''));
  },

  'converts a local date and time in a zone to unix seconds': async (
    assert,
  ) => {
    assert.strictEqual(
      iso(local('2026-11-09T15:00', CHICAGO)),
      '2026-11-09T21:00:00Z',
    );
    assert.strictEqual(
      iso(local('2026-07-01T09:30:15', NEW_YORK)),
      '2026-07-01T13:30:15Z',
    );
    assert.strictEqual(
      iso(local('2026-03-08T02:30', NEW_YORK)),
      '2026-03-08T07:30:00Z',
      'a time skipped by the forward change lands as far past it (03:30 EDT)',
    );
    assert.strictEqual(
      iso(local('2026-11-01T01:30', NEW_YORK)),
      '2026-11-01T05:30:00Z',
      'a time that happens twice resolves to the first (01:30 EDT)',
    );
    assert.throws(() => local('2026-02-30T00:00', 'UTC'), /real date/);
    assert.throws(() => local('2026-11-09 15:00', 'UTC'), /local date/);
    assert.throws(() => local('2026-11-09T15:00', 'Nowhere/Land'));
  },

  "finds the next time in the trigger's time zone": async (assert) => {
    let after = at('2026-11-10T12:00:00Z');
    assert.strictEqual(
      iso(nextCronTime('30 5 * * *', CHICAGO, after)),
      '2026-11-11T11:30:00Z',
      '05:30 Chicago (CST) is 11:30Z',
    );
    assert.strictEqual(
      iso(nextCronTime('30 5 * * *', 'UTC', after)),
      '2026-11-11T05:30:00Z',
    );
    assert.strictEqual(
      iso(nextCronTime('0 12 1 * *', CHICAGO, after)),
      '2026-12-01T18:00:00Z',
    );
  },

  'the next time is strictly after the given instant': async (assert) => {
    let exactly = at('2026-11-10T12:00:00Z');
    assert.strictEqual(
      iso(nextCronTime('0 12 * * *', 'UTC', exactly)),
      '2026-11-11T12:00:00Z',
    );
    assert.strictEqual(
      iso(nextCronTime('0 12 * * *', 'UTC', exactly - 1)),
      '2026-11-10T12:00:00Z',
    );
  },

  'keeps a fixed-hour time at the same local time across daylight saving':
    async (assert) => {
      assert.deepEqual(
        nextCronTimes(
          '30 5 * * *',
          NEW_YORK,
          at('2026-03-07T00:00:00Z'),
          3,
        ).map(iso),
        [
          '2026-03-07T10:30:00Z',
          '2026-03-08T09:30:00Z',
          '2026-03-09T09:30:00Z',
        ],
        'spring forward: 05:30 EST, then 05:30 EDT',
      );
      assert.deepEqual(
        nextCronTimes(
          '30 5 * * *',
          NEW_YORK,
          at('2026-10-31T00:00:00Z'),
          3,
        ).map(iso),
        [
          '2026-10-31T09:30:00Z',
          '2026-11-01T10:30:00Z',
          '2026-11-02T10:30:00Z',
        ],
        'fall back: 05:30 EDT, then 05:30 EST',
      );
      assert.deepEqual(
        nextCronTimes('0 9 * * *', SYDNEY, at('2026-10-02T00:00:00Z'), 3).map(
          iso,
        ),
        [
          '2026-10-02T23:00:00Z',
          '2026-10-03T22:00:00Z',
          '2026-10-04T22:00:00Z',
        ],
        'southern hemisphere: 09:00 AEST, then 09:00 AEDT',
      );
    },

  'fires a fixed-hour time skipped by a forward change at the same distance past it':
    async (assert) => {
      assert.deepEqual(
        nextCronTimes(
          '30 2 * * *',
          NEW_YORK,
          at('2026-03-07T12:00:00Z'),
          2,
        ).map(iso),
        ['2026-03-08T07:30:00Z', '2026-03-09T06:30:00Z'],
        '02:30 on the change day fires at 03:30 EDT',
      );
      assert.deepEqual(
        nextCronTimes(
          '30 2,3 * * *',
          NEW_YORK,
          at('2026-03-08T05:00:00Z'),
          2,
        ).map(iso),
        ['2026-03-08T07:30:00Z', '2026-03-09T06:30:00Z'],
        'a skipped time landing on another scheduled time fires once',
      );
    },

  'fires a fixed-hour time that happens twice only once': async (assert) => {
    assert.deepEqual(
      nextCronTimes('30 1 * * *', NEW_YORK, at('2026-10-31T12:00:00Z'), 2).map(
        iso,
      ),
      ['2026-11-01T05:30:00Z', '2026-11-02T06:30:00Z'],
      '01:30 EDT on the change day, not 01:30 EST as well',
    );
  },

  'an hourly schedule follows elapsed time across daylight-saving changes':
    async (assert) => {
      assert.deepEqual(
        nextCronTimes('0 * * * *', NEW_YORK, at('2026-03-08T05:30:00Z'), 3).map(
          iso,
        ),
        [
          '2026-03-08T06:00:00Z',
          '2026-03-08T07:00:00Z',
          '2026-03-08T08:00:00Z',
        ],
        'spring forward: 01:00 EST, then 03:00 EDT; 02:00 never happens',
      );
      assert.deepEqual(
        nextCronTimes(
          '30 * * * *',
          NEW_YORK,
          at('2026-11-01T04:00:00Z'),
          4,
        ).map(iso),
        [
          '2026-11-01T04:30:00Z',
          '2026-11-01T05:30:00Z',
          '2026-11-01T06:30:00Z',
          '2026-11-01T07:30:00Z',
        ],
        'fall back: 01:30 fires as EDT and again as EST',
      );
      assert.strictEqual(
        countCronTimes(
          '0 * * * *',
          NEW_YORK,
          local('2026-11-01T00:00', NEW_YORK) - 1,
          local('2026-11-02T00:00', NEW_YORK) - 1,
        ),
        25,
        'the 25-hour day has 25 hourly runs',
      );
      assert.strictEqual(
        countCronTimes(
          '0 * * * *',
          NEW_YORK,
          local('2026-03-08T00:00', NEW_YORK) - 1,
          local('2026-03-09T00:00', NEW_YORK) - 1,
        ),
        23,
        'the 23-hour day has 23 hourly runs',
      );
    },

  'matches either day field when both are restricted': async (assert) => {
    assert.deepEqual(
      nextCronTimes('0 0 13 * FRI', 'UTC', at('2026-11-01T00:00:00Z'), 3).map(
        iso,
      ),
      ['2026-11-06T00:00:00Z', '2026-11-13T00:00:00Z', '2026-11-20T00:00:00Z'],
      'every Friday and every 13th',
    );
    assert.deepEqual(
      nextCronTimes('0 0 */10 * FRI', 'UTC', at('2026-11-01T00:00:00Z'), 2).map(
        iso,
      ),
      ['2026-12-11T00:00:00Z', '2027-01-01T00:00:00Z'],
      'a day-of-month field starting with * is unrestricted, so both must match: Fridays on the 1st, 11th, 21st or 31st',
    );
  },

  'finds Feb 29 across a skipped leap year': async (assert) => {
    assert.strictEqual(
      iso(nextCronTime('0 0 29 2 *', 'UTC', at('2096-03-01T00:00:00Z'))),
      '2104-02-29T00:00:00Z',
      '2100 is not a leap year',
    );
  },

  'counts the times in a range': async (assert) => {
    assert.strictEqual(
      countCronTimes(
        '0 * * * *',
        'UTC',
        at('2026-11-10T00:00:00Z'),
        at('2026-11-11T00:00:00Z'),
      ),
      24,
      'after is exclusive, until inclusive',
    );
    assert.strictEqual(
      countCronTimes(
        '* * * * *',
        'UTC',
        at('2026-01-01T00:00:00Z'),
        at('2027-01-01T00:00:00Z'),
      ),
      525600,
    );
    assert.strictEqual(
      countCronTimes(
        '* * * * *',
        'UTC',
        at('2026-01-01T00:00:00Z'),
        at('2027-01-01T00:00:00Z'),
        10,
      ),
      10,
      'stops at the limit',
    );
    assert.strictEqual(
      countCronTimes(
        '0 * * * *',
        'UTC',
        at('2026-11-11T00:00:00Z'),
        at('2026-11-10T00:00:00Z'),
      ),
      0,
    );
  },

  'a once trigger fires at its time and is then spent': async (assert) => {
    let triggers: AutomationTrigger[] = [
      {
        kind: 'once',
        label: 'backfill',
        at: local('2026-11-10T15:00', CHICAGO),
      },
    ];
    let since = local('2026-11-10T14:00', CHICAGO);
    let before = computeAutomationSchedule({
      triggers,
      since,
      includeRemainingRuns: true,
    });
    assert.strictEqual(iso(before.nextRun), '2026-11-10T21:00:00Z');
    assert.deepEqual(before.dueTriggers, ['backfill']);
    assert.deepEqual(before.triggers[0], {
      label: 'backfill',
      kind: 'once',
      spent: false,
      nextRun: local('2026-11-10T15:00', CHICAGO),
      remainingRuns: 1,
    });
    assert.false(before.done);

    let after = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers,
      since,
      runState: {
        backfill: { runs: 1, lastSlot: local('2026-11-10T15:00', CHICAGO) },
      },
    });
    assert.strictEqual(after.nextRun, undefined);
    assert.deepEqual(after.dueTriggers, []);
    assert.true(after.triggers[0].spent);
    assert.strictEqual(after.triggers[0].remainingRuns, 0);
    assert.true(after.done);
  },

  'a once trigger in the past is spent': async (assert) => {
    let schedule = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers: [
        {
          kind: 'once',
          label: 'backfill',
          at: local('2026-11-09T15:00', CHICAGO),
        },
      ],
      since: local('2026-11-10T09:00', CHICAGO),
    });
    assert.true(schedule.triggers[0].spent);
    assert.strictEqual(schedule.nextRun, undefined);
    assert.true(schedule.done);
  },

  'a slot that came due but was not enqueued stays due': async (assert) => {
    let triggers: AutomationTrigger[] = [
      {
        kind: 'cron',
        label: 'hourly',
        expression: '0 * * * *',
        timeZone: 'UTC',
      },
      { kind: 'once', label: 'once', at: at('2026-11-10T12:30:00Z') },
    ];
    // Recomputed at 12:45 (say the card was edited), with the 12:00 run
    // enqueued and nothing since: 13:00 is next for the cron trigger, and the
    // once trigger's 12:30 is still due.
    let schedule = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers,
      since: at('2026-11-10T09:00:00Z'),
      runState: { hourly: { runs: 4, lastSlot: at('2026-11-10T12:00:00Z') } },
    });
    assert.strictEqual(iso(schedule.nextRun), '2026-11-10T12:30:00Z');
    assert.deepEqual(schedule.dueTriggers, ['once']);
    assert.strictEqual(
      iso(schedule.triggers[0].nextRun),
      '2026-11-10T13:00:00Z',
    );
  },

  'a cron trigger with count is spent after count runs': async (assert) => {
    let triggers: AutomationTrigger[] = [
      {
        kind: 'cron',
        label: 'next-day',
        expression: '0 * * * *',
        timeZone: CHICAGO,
        count: 24,
      },
    ];
    let since = at('2026-11-10T12:10:00Z');
    let fresh = computeAutomationSchedule({
      triggers,
      since,
      includeRemainingRuns: true,
    });
    assert.strictEqual(iso(fresh.nextRun), '2026-11-10T13:00:00Z');
    assert.strictEqual(fresh.triggers[0].remainingRuns, 24);

    let partway = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers,
      since,
      runState: {
        'next-day': { runs: 23, lastSlot: at('2026-11-11T11:00:00Z') },
      },
    });
    assert.strictEqual(iso(partway.nextRun), '2026-11-11T12:00:00Z');
    assert.strictEqual(partway.triggers[0].remainingRuns, 1);

    let spent = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers,
      since,
      runState: {
        'next-day': { runs: 24, lastSlot: at('2026-11-11T12:00:00Z') },
      },
    });
    assert.true(spent.triggers[0].spent);
    assert.strictEqual(spent.triggers[0].remainingRuns, 0);
    assert.strictEqual(spent.nextRun, undefined);
    assert.true(spent.done);
  },

  'a cron trigger with until is spent past until': async (assert) => {
    let until = local('2026-11-10T08:00', CHICAGO);
    let triggers: AutomationTrigger[] = [
      {
        kind: 'cron',
        label: 'hourly',
        expression: '0 * * * *',
        timeZone: CHICAGO,
        until,
      },
    ];
    let early = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers,
      since: local('2026-11-10T05:30', CHICAGO),
    });
    assert.strictEqual(iso(early.nextRun), '2026-11-10T12:00:00Z', '06:00 CST');
    assert.strictEqual(
      early.triggers[0].remainingRuns,
      3,
      '06:00, 07:00 and 08:00: until is inclusive',
    );
    assert.strictEqual(early.triggers[0].until, until);

    let last = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers,
      since: local('2026-11-10T05:30', CHICAGO),
      runState: {
        hourly: { runs: 2, lastSlot: local('2026-11-10T07:00', CHICAGO) },
      },
    });
    assert.strictEqual(last.nextRun, until);
    assert.strictEqual(last.triggers[0].remainingRuns, 1);

    let spent = computeAutomationSchedule({
      includeRemainingRuns: true,
      triggers,
      since: local('2026-11-10T05:30', CHICAGO),
      runState: { hourly: { runs: 3, lastSlot: until } },
    });
    assert.true(spent.triggers[0].spent);
    assert.strictEqual(spent.triggers[0].remainingRuns, 0);
    assert.true(spent.done);
  },

  'until and count together: whichever comes first': async (assert) => {
    let since = at('2026-11-10T00:00:00Z');
    let countFirst = computeAutomationSchedule({
      includeRemainingRuns: true,
      since,
      triggers: [
        {
          kind: 'cron',
          label: 't',
          expression: '0 * * * *',
          timeZone: 'UTC',
          count: 5,
          until: at('2026-11-11T00:00:00Z'),
        },
      ],
      runState: { t: { runs: 5, lastSlot: at('2026-11-10T05:00:00Z') } },
    });
    assert.true(countFirst.triggers[0].spent, 'count reached before until');

    let untilFirst = computeAutomationSchedule({
      includeRemainingRuns: true,
      since,
      triggers: [
        {
          kind: 'cron',
          label: 't',
          expression: '0 * * * *',
          timeZone: 'UTC',
          count: 100,
          until: at('2026-11-10T03:00:00Z'),
        },
      ],
      runState: { t: { runs: 3, lastSlot: at('2026-11-10T03:00:00Z') } },
    });
    assert.true(untilFirst.triggers[0].spent, 'until passed before count');

    let both = computeAutomationSchedule({
      includeRemainingRuns: true,
      since,
      triggers: [
        {
          kind: 'cron',
          label: 't',
          expression: '0 * * * *',
          timeZone: 'UTC',
          count: 10,
          until: at('2026-11-10T06:00:00Z'),
        },
        {
          kind: 'cron',
          label: 'u',
          expression: '0 * * * *',
          timeZone: 'UTC',
          count: 4,
          until: at('2026-11-10T06:00:00Z'),
        },
      ],
    });
    assert.deepEqual(
      both.triggers.map((t) => t.remainingRuns),
      [6, 4],
      'runs left is the smaller of what until and count allow',
    );
  },

  'a count of zero is spent at once': async (assert) => {
    let schedule = computeAutomationSchedule({
      includeRemainingRuns: true,
      since: at('2026-11-10T00:00:00Z'),
      triggers: [
        {
          kind: 'cron',
          label: 't',
          expression: '0 * * * *',
          timeZone: 'UTC',
          count: 0,
        },
      ],
    });
    assert.true(schedule.triggers[0].spent);
    assert.true(schedule.done);
  },

  'the next run is the earliest across unspent cron and once triggers': async (
    assert,
  ) => {
    let since = local('2026-11-10T11:00', CHICAGO);
    let schedule = computeAutomationSchedule({
      includeRemainingRuns: true,
      since,
      triggers: [
        {
          kind: 'cron',
          label: 'daily',
          expression: '30 5 * * *',
          timeZone: CHICAGO,
        },
        {
          kind: 'cron',
          label: 'month-start',
          expression: '0 12 1 * *',
          timeZone: CHICAGO,
        },
        {
          kind: 'once',
          label: 'backfill',
          at: local('2026-11-10T15:00', CHICAGO),
        },
        {
          kind: 'cron',
          label: 'spent',
          expression: '0 * * * *',
          timeZone: CHICAGO,
          count: 1,
        },
        { kind: 'webhook', label: 'stripe' },
      ],
      runState: {
        spent: { runs: 1, lastSlot: local('2026-11-10T11:00', CHICAGO) },
      },
    });
    assert.strictEqual(schedule.nextRun, local('2026-11-10T15:00', CHICAGO));
    assert.deepEqual(schedule.dueTriggers, ['backfill']);
    assert.false(schedule.done);
    assert.deepEqual(
      schedule.triggers.map((t) => [
        t.label,
        t.spent,
        iso(t.nextRun),
        t.remainingRuns,
      ]),
      [
        ['daily', false, '2026-11-11T11:30:00Z', undefined],
        ['month-start', false, '2026-12-01T18:00:00Z', undefined],
        ['backfill', false, '2026-11-10T21:00:00Z', 1],
        ['spent', true, undefined, 0],
        ['stripe', false, undefined, undefined],
      ],
    );
  },

  'every trigger due at the next run is listed': async (assert) => {
    let schedule = computeAutomationSchedule({
      includeRemainingRuns: true,
      since: at('2026-11-10T00:00:00Z'),
      triggers: [
        { kind: 'cron', label: 'a', expression: '0 6 * * *', timeZone: 'UTC' },
        { kind: 'once', label: 'b', at: at('2026-11-10T06:00:00Z') },
        { kind: 'cron', label: 'c', expression: '0 7 * * *', timeZone: 'UTC' },
      ],
    });
    assert.strictEqual(iso(schedule.nextRun), '2026-11-10T06:00:00Z');
    assert.deepEqual(schedule.dueTriggers, ['a', 'b']);
  },

  'an automation with a webhook trigger is never done': async (assert) => {
    let schedule = computeAutomationSchedule({
      includeRemainingRuns: true,
      since: at('2026-11-10T00:00:00Z'),
      triggers: [
        { kind: 'once', label: 'past', at: at('2026-11-09T00:00:00Z') },
        { kind: 'webhook', label: 'stripe' },
      ],
    });
    assert.strictEqual(schedule.nextRun, undefined);
    assert.false(schedule.done);
    assert.false(schedule.triggers[1].spent);
  },

  'an elapsed-time expression fires in both copies of a repeated hour and not in a skipped one':
    async (assert) => {
      assert.strictEqual(
        countCronTimes(
          '*/15 1 * * *',
          NEW_YORK,
          at('2026-11-01T04:00:00Z'),
          at('2026-11-01T12:00:00Z'),
        ),
        8,
        'a minute field starting with * follows elapsed time: 01:00–01:45 as EDT and again as EST',
      );
      assert.strictEqual(
        countCronTimes(
          '*/15 2 * * *',
          NEW_YORK,
          at('2026-03-08T05:00:00Z'),
          at('2026-03-08T12:00:00Z'),
        ),
        0,
        '02:00–02:45 never happen on the spring-forward day',
      );
    },

  'a time pushed past a gap that ends at midnight lands on the next day':
    async (assert) => {
      // America/Nuuk springs forward at 23:00 local on Sat Mar 28 2026, straight
      // to midnight (01:00Z).
      assert.strictEqual(
        iso(nextCronTime('30 23 * * *', NUUK, at('2026-03-29T01:10:00Z'))),
        '2026-03-29T01:30:00Z',
        "Saturday's 23:30 resolves to 00:30 Sunday, after Sunday's local day has begun",
      );
      assert.strictEqual(
        countCronTimes(
          '0 0,23 * * *',
          NUUK,
          at('2026-03-28T12:00:00Z'),
          at('2026-03-29T12:00:00Z'),
        ),
        1,
        "Saturday's 23:00 and Sunday's 00:00 are one instant, counted once",
      );
    },

  'finds days that match rarely': async (assert) => {
    assert.deepEqual(
      nextCronTimes('0 0 */31 2 1', 'UTC', at('2026-01-01T00:00:00Z'), 2).map(
        iso,
      ),
      ['2027-02-01T00:00:00Z', '2038-02-01T00:00:00Z'],
      'Feb 1 on a Monday: eleven years apart',
    );
    let [first, second] = nextCronTimes(
      '0 0 29 2 */7',
      'UTC',
      at('2026-01-01T00:00:00Z'),
      2,
    );
    assert.strictEqual(iso(first), '2032-02-29T00:00:00Z');
    assert.strictEqual(
      iso(second),
      '2060-02-29T00:00:00Z',
      'Feb 29 on a Sunday: 28 years apart',
    );
  },

  'finds the latest time in a range': async (assert) => {
    assert.strictEqual(
      iso(
        lastCronTime(
          '0 * * * *',
          'UTC',
          at('2026-11-10T00:00:00Z'),
          at('2026-11-10T06:30:00Z'),
        ),
      ),
      '2026-11-10T06:00:00Z',
    );
    assert.strictEqual(
      lastCronTime(
        '0 * * * *',
        'UTC',
        at('2026-11-10T00:00:00Z'),
        at('2026-11-10T00:59:00Z'),
      ),
      undefined,
      'after is exclusive',
    );
    assert.strictEqual(
      iso(
        lastCronTime(
          '30 1 * * *',
          NEW_YORK,
          at('2026-10-31T12:00:00Z'),
          at('2026-11-01T12:00:00Z'),
        ),
      ),
      '2026-11-01T05:30:00Z',
      'a wall-clock time that happens twice is only its first',
    );
  },

  'with now, missed slots collapse into one make-up run at the latest': async (
    assert,
  ) => {
    let triggers: AutomationTrigger[] = [
      {
        kind: 'cron',
        label: 'hourly',
        expression: '0 * * * *',
        timeZone: 'UTC',
        count: 10,
      },
    ];
    // The 06:00 run was the last; the tick was down until 12:30.
    let runState = {
      hourly: { runs: 3, lastSlot: at('2026-11-10T06:00:00Z') },
    };
    let catchUp = computeAutomationSchedule({
      triggers,
      since: at('2026-11-10T00:00:00Z'),
      now: at('2026-11-10T12:30:00Z'),
      runState,
      includeRemainingRuns: true,
    });
    assert.strictEqual(
      iso(catchUp.nextRun),
      '2026-11-10T12:00:00Z',
      'one make-up run, for the latest missed slot',
    );
    assert.strictEqual(
      catchUp.triggers[0].remainingRuns,
      7,
      'the make-up run counts as one of the runs left',
    );

    let withoutNow = computeAutomationSchedule({
      triggers,
      since: at('2026-11-10T00:00:00Z'),
      runState,
    });
    assert.strictEqual(
      iso(withoutNow.nextRun),
      '2026-11-10T07:00:00Z',
      'without now every slot after the cursor is scheduled in turn',
    );

    let onTime = computeAutomationSchedule({
      triggers,
      since: at('2026-11-10T00:00:00Z'),
      now: at('2026-11-10T06:30:00Z'),
      runState,
    });
    assert.strictEqual(
      iso(onTime.nextRun),
      '2026-11-10T07:00:00Z',
      'nothing missed: the next slot',
    );

    let bounded = computeAutomationSchedule({
      triggers: [
        {
          kind: 'cron',
          label: 'hourly',
          expression: '0 * * * *',
          timeZone: 'UTC',
          until: at('2026-11-10T09:00:00Z'),
        },
      ],
      since: at('2026-11-10T00:00:00Z'),
      now: at('2026-11-10T12:30:00Z'),
      runState,
    });
    assert.strictEqual(
      iso(bounded.nextRun),
      '2026-11-10T09:00:00Z',
      'the make-up run is never past until',
    );
  },

  "a trigger's own since keeps an edit from making a passed slot due": async (
    assert,
  ) => {
    // Edited at 08:30 from 09:00 daily to 08:00 daily; yesterday's 09:00 ran.
    let schedule = computeAutomationSchedule({
      triggers: [
        {
          kind: 'cron',
          label: 'daily',
          expression: '0 8 * * *',
          timeZone: 'UTC',
        },
      ],
      since: at('2026-11-01T00:00:00Z'),
      now: at('2026-11-10T08:30:00Z'),
      runState: {
        daily: {
          runs: 9,
          lastSlot: at('2026-11-09T09:00:00Z'),
          since: at('2026-11-10T08:30:00Z'),
        },
      },
    });
    assert.strictEqual(iso(schedule.nextRun), '2026-11-11T08:00:00Z');
  },

  'a once trigger edited to a later time fires again': async (assert) => {
    let schedule = computeAutomationSchedule({
      triggers: [
        { kind: 'once', label: 'backfill', at: at('2026-11-12T15:00:00Z') },
      ],
      since: at('2026-11-01T00:00:00Z'),
      runState: {
        backfill: { runs: 1, lastSlot: at('2026-11-10T15:00:00Z') },
      },
    });
    assert.false(schedule.triggers[0].spent);
    assert.strictEqual(iso(schedule.nextRun), '2026-11-12T15:00:00Z');
  },

  'a trigger with a bad expression or time zone is reported and the rest are scheduled':
    async (assert) => {
      let schedule = computeAutomationSchedule({
        triggers: [
          {
            kind: 'cron',
            label: 'bad-zone',
            expression: '0 * * * *',
            timeZone: 'Nowhere/Land',
          },
          {
            kind: 'cron',
            label: 'bad-cron',
            expression: '0 25 * * *',
            timeZone: 'UTC',
          },
          {
            kind: 'cron',
            label: 'good',
            expression: '0 6 * * *',
            timeZone: 'UTC',
          },
        ],
        since: at('2026-11-10T00:00:00Z'),
      });
      assert.strictEqual(iso(schedule.nextRun), '2026-11-10T06:00:00Z');
      assert.deepEqual(schedule.dueTriggers, ['good']);
      assert.ok(schedule.triggers[0].error?.includes('Nowhere/Land'));
      assert.ok(schedule.triggers[1].error?.includes('hour'));
      assert.false(schedule.triggers[0].spent);
      assert.strictEqual(schedule.triggers[0].nextRun, undefined);

      let onlyBad = computeAutomationSchedule({
        triggers: [
          { kind: 'cron', label: 'x', expression: 'nope', timeZone: 'UTC' },
        ],
        since: at('2026-11-10T00:00:00Z'),
      });
      assert.false(
        onlyBad.done,
        'a trigger in error keeps the automation from being done',
      );
    },

  'runs left is counted only when asked, and bounded for a distant until':
    async (assert) => {
      let triggers: AutomationTrigger[] = [
        {
          kind: 'cron',
          label: 'minutely',
          expression: '* * * * *',
          timeZone: 'UTC',
          until: at('9999-12-31T00:00:00Z'),
        },
        {
          kind: 'cron',
          label: 'yearly',
          expression: '0 0 1 1 *',
          timeZone: 'UTC',
          until: at('9999-12-31T00:00:00Z'),
        },
        {
          kind: 'cron',
          label: 'short',
          expression: '0 0 1 1 *',
          timeZone: 'UTC',
          until: at('2030-12-31T00:00:00Z'),
        },
      ];
      let since = at('2026-01-01T00:00:00Z');
      let plain = computeAutomationSchedule({ triggers, since });
      assert.strictEqual(plain.triggers[0].remainingRuns, undefined);

      let counted = computeAutomationSchedule({
        triggers,
        since,
        includeRemainingRuns: true,
      });
      assert.deepEqual(
        counted.triggers.map((t) => [t.remainingRuns, t.remainingRunsAtLeast]),
        [
          [REMAINING_RUNS_LIMIT, true],
          [101, true],
          [4, undefined],
        ],
        'stops at the run limit or the hundred-year horizon, and says so',
      );
    },

  'an automation with no triggers is done': async (assert) => {
    let schedule = computeAutomationSchedule({
      includeRemainingRuns: true,
      since: at('2026-11-10T00:00:00Z'),
      triggers: [],
    });
    assert.true(schedule.done);
    assert.strictEqual(schedule.nextRun, undefined);
  },
}) as SharedTests<{}>;

export default tests;
