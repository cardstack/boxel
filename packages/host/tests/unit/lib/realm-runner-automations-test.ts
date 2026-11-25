import { module, test } from 'qunit';

import {
  automationCardURL,
  keyApprovalReport,
  namedAutomationCalls,
  summarizeTriggers,
} from '@cardstack/host/lib/realm-runner/automations';

const REALM = 'http://test-realm/test/';

module('Unit | Lib | realm-runner automations', function () {
  test('a script names a start call by a literal card path, each call and path once', function (assert) {
    let code = `
      await realm.automations.preview('automations/a.json');
      await realm.automations.preview("automations/a.json");
      await realm.automations.switchOn(\`automations/b\`);
      await realm.automations.runNow(path);
      await realm.automations.runNow(\`automations/\${name}\`);
      await realm.automations.estimate('automations/c.json');
    `;
    assert.deepEqual(namedAutomationCalls(code), [
      { call: 'realm.automations.preview', path: 'automations/a.json' },
      { call: 'realm.automations.switchOn', path: 'automations/b' },
    ]);
    assert.deepEqual(namedAutomationCalls(undefined), []);
  });

  test("an automation card's URL is the card's id, inside the run's workspace", function (assert) {
    assert.strictEqual(
      automationCardURL('automations/a.json', REALM),
      `${REALM}automations/a`,
    );
    assert.strictEqual(
      automationCardURL(`${REALM}automations/a.json`, REALM),
      `${REALM}automations/a`,
      'a full URL inside the workspace names the card too',
    );
    for (let path of [
      '/automations/a',
      'automations/../a.json',
      './automations/a.json',
      'automations//a.json',
      'automations/a.json?x=1',
      'automations/a.json#x',
    ]) {
      assert.throws(
        () => automationCardURL(path, REALM),
        /path from the workspace root/,
        `${path} is refused`,
      );
    }
    assert.throws(
      () =>
        automationCardURL('http://test-realm/other/automations/a.json', REALM),
      /by its path inside the workspace/,
    );
  });

  test('a one-time trigger reads in its own zone, and in the viewer’s when the zones differ', function (assert) {
    let [once] = summarizeTriggers(
      [
        {
          kind: 'once',
          label: 'end-sale',
          date: '2030-01-02',
          time: '15:00',
          timeZone: 'America/Chicago',
        },
      ],
      'Europe/London',
    );
    assert.strictEqual(once.at, Date.UTC(2030, 0, 2, 21, 0) / 1000);
    assert.strictEqual(
      once.text,
      'Once, Wednesday, January 2, 2030 at 3:00 PM CST (America/Chicago)',
    );
    assert.strictEqual(
      once.viewerText,
      'Wednesday, January 2, 2030 at 9:00 PM GMT (Europe/London), your time',
    );

    let [same] = summarizeTriggers(
      [
        {
          kind: 'once',
          label: 'end-sale',
          date: '2030-01-02',
          time: '15:00',
          timeZone: 'America/Chicago',
        },
      ],
      'America/Chicago',
    );
    assert.strictEqual(same.viewerText, undefined, 'one zone reads once');
  });

  test('cron, webhook and unreadable triggers read in words', function (assert) {
    let [cron, webhook, bad, badZone] = summarizeTriggers(
      [
        {
          kind: 'cron',
          label: 'daily',
          expression: '30 5 * * *',
          timeZone: 'America/Chicago',
          count: 24,
        },
        { kind: 'webhook', label: 'stripe', webhookPath: 'whk_abc' },
        { kind: 'hourly', label: 'odd' },
        {
          kind: 'once',
          label: 'zone',
          date: '2030-01-02',
          time: '15:00',
          timeZone: 'Mars/Base',
        },
      ],
      'America/Chicago',
    );
    assert.strictEqual(
      cron.text,
      'On the schedule 30 5 * * * in America/Chicago, at most 24 runs',
    );
    assert.strictEqual(webhook.text, 'On each delivery to the webhook whk_abc');
    assert.strictEqual(bad.kind, 'unknown');
    assert.strictEqual(badZone.at, undefined);
  });

  test('key approvals sort by who gives each one', function (assert) {
    let report = keyApprovalReport({
      approved: false,
      operations: [
        { operation: 'ok', state: 'approved' },
        {
          operation: 'mine',
          state: 'missing',
          missing: [{ slot: 'userKey', canApprove: 'payer' }],
        },
        {
          operation: 'theirs',
          state: 'missing',
          missing: [
            {
              slot: 'apiKey',
              canApprove: 'another-key-owner',
              shares: [{ id: 's', label: 'Mail key', owner: null }],
            },
          ],
        },
        {
          operation: 'none',
          state: 'missing',
          missing: [{ slot: 'apiKey', canApprove: 'nobody-yet' }],
        },
        {
          operation: 'paused',
          state: 'missing',
          missing: [
            {
              slot: 'apiKey',
              canApprove: 'payer',
              shares: [
                {
                  id: 'p',
                  label: 'Paused key',
                  owner: '@me:localhost',
                  suspended: true,
                },
              ],
            },
          ],
        },
      ],
    });
    assert.deepEqual(report, {
      approved: false,
      forYou: ['mine'],
      // An owner Boxel may not name to the reader stays unnamed.
      byOthers: [{ operation: 'theirs', key: 'Mail key' }],
      needShare: ['none'],
      // A suspended share is resumed by its owner before any approval.
      suspended: [
        { operation: 'paused', key: 'Paused key', owner: '@me:localhost' },
      ],
    });
  });
});
