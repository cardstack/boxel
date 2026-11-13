import { module, test } from 'qunit';

import {
  automationTimeLimitMs,
  REDACTED,
  redactSecrets,
} from '@cardstack/host/lib/realm-runner/automation';
import {
  AUTOMATION_METHODS,
  INTERACTIVE_METHODS,
  METHOD_REACH,
  NOTIFY_METHODS,
  type RealmRunnerMethodReach,
} from '@cardstack/host/lib/realm-runner/surfaces';

// What an automation run may reach (ADR 025 §1.4): its own realm's reads,
// writes the realm server stages for the one batch the run commits, card
// operations (a `callApi` is the run's only way to an outside API), the
// `resolve` model call, and its own progress and console lines.
const AUTOMATION_MAY_REACH = new Set<RealmRunnerMethodReach>([
  'realm-read',
  'realm-write',
  'operation',
  'model',
  'progress',
  'log',
]);

module('Unit | Lib | realm-runner surfaces', function () {
  // The automation surface's allowlist. A change to it is a reviewed change:
  // it fails here until this list changes with it.
  test('the automation surface is exactly its pinned allowlist', function (assert) {
    assert.deepEqual([...AUTOMATION_METHODS].sort(), [
      'activity',
      'cards.get',
      'cards.search',
      'cards.update',
      'console.error',
      'console.info',
      'console.log',
      'console.warn',
      'entries.search',
      'fs.copy',
      'fs.exists',
      'fs.list',
      'fs.readText',
      'fs.replace',
      'fs.writeBytes',
      'fs.writeText',
      'operations.invoke',
      'operations.invokeBatchOperation',
      'progress.count',
      'progress.milestone',
      'progress.plan',
      'resolve',
    ]);
  });

  test('no automation method writes outside the final batch, reaches the network another way, or touches the UI or a room', function (assert) {
    for (let method of AUTOMATION_METHODS) {
      assert.true(
        AUTOMATION_MAY_REACH.has(METHOD_REACH[method]),
        `${method} reaches ${METHOD_REACH[method]}`,
      );
    }
    for (let [method, reach] of Object.entries(METHOD_REACH)) {
      if (!AUTOMATION_MAY_REACH.has(reach)) {
        assert.false(
          AUTOMATION_METHODS.has(method as keyof typeof METHOD_REACH),
          `${method}, which reaches ${reach}, is off the automation surface`,
        );
      }
    }
  });

  test('the interactive surface has none of the automation run’s own methods', function (assert) {
    for (let method of NOTIFY_METHODS) {
      assert.false(INTERACTIVE_METHODS.has(method), `${method} is not on it`);
    }
    for (let method of Object.keys(METHOD_REACH)) {
      let name = method as keyof typeof METHOD_REACH;
      let onASurface =
        INTERACTIVE_METHODS.has(name) || AUTOMATION_METHODS.has(name);
      assert.true(onASurface, `${method} is on a surface`);
    }
  });

  test("a run's time limit is its seconds cap, at most 20 minutes", function (assert) {
    assert.strictEqual(automationTimeLimitMs(30), 30_000);
    assert.strictEqual(automationTimeLimitMs(1200), 1_200_000);
    assert.strictEqual(automationTimeLimitMs(5000), 1_200_000);
    assert.throws(() => automationTimeLimitMs(0), /more than 0/);
    assert.throws(() => automationTimeLimitMs(Number.NaN), /more than 0/);
  });

  test('redactSecrets removes registered values and credentials it recognizes by shape', function (assert) {
    let runToken = 'run-token-value-1234567890';
    let jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyIjoiQGE6bG9jYWxob3N0In0.c2lnbmF0dXJlLXZhbHVl';
    let cases: [string, string][] = [
      [`token ${runToken} end`, `token ${REDACTED} end`],
      ['key ghp_abcdefghijklmnopqrstuvwxyz0123 used', `key ${REDACTED} used`],
      ['openrouter sk-or-v1-0123456789abcdef', `openrouter ${REDACTED}`],
      [`session ${jwt}`, `session ${REDACTED}`],
      [
        'Authorization: Bearer abc.def-ghi_jkl123',
        `Authorization: Bearer ${REDACTED}`,
      ],
      ['aws AKIAABCDEFGHIJKLMNOP', `aws ${REDACTED}`],
      [
        'authorization: Basic dXNlcjpwYXNzd29yZA==',
        `authorization: Basic ${REDACTED}`,
      ],
      [
        '{"api_key":"9f8e7d6c5b4a","name":"Ada","password":"hunter22"}',
        `{"api_key":"${REDACTED}","name":"Ada","password":"${REDACTED}"}`,
      ],
      [
        'GET https://api.example.com/v1/items?key=9f8e7d6c5b4a&page=2',
        `GET https://api.example.com/v1/items?key=${REDACTED}&page=2`,
      ],
      [
        'pem -----BEGIN PRIVATE KEY-----\nMIIB\n-----END PRIVATE KEY----- done',
        `pem ${REDACTED} done`,
      ],
    ];
    for (let [text, expected] of cases) {
      assert.strictEqual(redactSecrets(text, [runToken]), expected, text);
    }
  });

  test('redactSecrets leaves ordinary text alone', function (assert) {
    for (let text of [
      'Fetched 40 associates, 3 changed',
      'task-list sk- prefix alone',
      'a short registered value stays',
      'risk-assessment is a word with sk- inside',
      'Using basic configuration for 3 contacts',
      'token refreshed successfully',
      'Token refreshed successfully',
      'the bearer of good news',
      '{"name":"Ada","page":"2"}',
    ]) {
      assert.strictEqual(redactSecrets(text, ['stays']), text, text);
    }
  });
});
