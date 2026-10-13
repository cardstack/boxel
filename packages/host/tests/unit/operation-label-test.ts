import { module, test } from 'qunit';

import {
  operationDisplayLabel,
  operationLabelProblem,
  operationNameAsWords,
} from '@cardstack/runtime-common';

module('Unit | operation label', function () {
  test('a name is split into words, the first capitalized', function (assert) {
    let cases: [string, string][] = [
      ['archive', 'Archive'],
      ['listOpenIssues', 'List open issues'],
      ['markAsRead', 'Mark as read'],
      ['ListMine', 'List mine'],
      ['snake_case_name', 'Snake case name'],
      ['getA', 'Get a'],
    ];
    for (let [name, expected] of cases) {
      assert.strictEqual(operationNameAsWords(name), expected, name);
    }
  });

  test('an acronym stays one word, as written', function (assert) {
    let cases: [string, string][] = [
      ['listOpenPRs', 'List open PRs'],
      ['getURL', 'Get URL'],
      ['getAPIKey', 'Get API key'],
      ['parseHTMLDocument', 'Parse HTML document'],
      ['fetchURLsForPR', 'Fetch URLs for PR'],
      ['URLsToCheck', 'URLs to check'],
      ['IDs', 'IDs'],
    ];
    for (let [name, expected] of cases) {
      assert.strictEqual(operationNameAsWords(name), expected, name);
    }
  });

  test('digits are a word of their own, unless they follow capitals', function (assert) {
    let cases: [string, string][] = [
      ['fetchPage2', 'Fetch page 2'],
      ['base64Encode', 'Base 64 encode'],
      ['listS3Buckets', 'List S3 buckets'],
      ['getMD5', 'Get MD5'],
      ['top10Cards', 'Top 10 cards'],
    ];
    for (let [name, expected] of cases) {
      assert.strictEqual(operationNameAsWords(name), expected, name);
    }
  });

  test('a name in any script splits the same way', function (assert) {
    let cases: [string, string][] = [
      ['öffnen', 'Öffnen'],
      ['listÄpfel', 'List äpfel'],
      ['ÖffneDatei', 'Öffne datei'],
    ];
    for (let [name, expected] of cases) {
      assert.strictEqual(operationNameAsWords(name), expected, name);
    }
  });

  test('the display label is the declared label, or the name as words', function (assert) {
    assert.strictEqual(
      operationDisplayLabel('listOpenPRs', {
        label: 'List your open pull requests',
      }),
      'List your open pull requests',
    );
    assert.strictEqual(
      operationDisplayLabel('listOpenPRs', {}),
      'List open PRs',
      'an operation declaring no label is shown under its name',
    );
    assert.strictEqual(operationDisplayLabel('getURL'), 'Get URL');
  });

  test('a label is a short line of plain text', function (assert) {
    assert.strictEqual(operationLabelProblem('Archive this inbox'), undefined);
    assert.strictEqual(
      operationLabelProblem('Send “hello” & wave 👋'),
      undefined,
      'punctuation and emoji are plain text',
    );
    assert.strictEqual(
      operationLabelProblem('👋'.repeat(80)),
      undefined,
      'the limit counts characters, not UTF-16 code units',
    );
    assert.strictEqual(
      operationLabelProblem('🇺🇸'.repeat(80)),
      undefined,
      'a flag counts once, though it is two code points',
    );
    assert.strictEqual(
      operationLabelProblem(
        'Invite \u{1F468}\u200D\u{1F469}\u200D\u{1F467} to the trip',
      ),
      undefined,
      'the joiners in an emoji sequence are plain text',
    );
    assert.strictEqual(
      operationLabelProblem('🇺🇸'.repeat(81)),
      'a label must be at most 80 characters, and this one is 81',
    );
    let refused: [string, unknown][] = [
      ['empty', ''],
      ['blank', ' \u00a0 '],
      ['too long', 'x'.repeat(81)],
      ['markup', 'Archive <b>now</b>'],
      ['line feed', 'Archive\nnow'],
      ['carriage return', 'Archive\rnow'],
      ['line separator', 'Archive\u2028now'],
      ['right-to-left override', 'Read \u202Eetirw'],
      ['bidirectional isolate', 'Read \u2066this\u2069'],
      ['only a zero-width space', '\u200B'],
      ['an unpaired surrogate half', 'Archive \uD800'],
      ['not a string', 42],
    ];
    for (let [what, value] of refused) {
      assert.strictEqual(
        typeof operationLabelProblem(value),
        'string',
        `${what} is refused`,
      );
    }
  });
});
