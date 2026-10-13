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
    let refused: [string, unknown][] = [
      ['empty', ''],
      ['blank', ' \u00a0 '],
      ['too long', 'x'.repeat(81)],
      ['markup', 'Archive <b>now</b>'],
      ['line feed', 'Archive\nnow'],
      ['carriage return', 'Archive\rnow'],
      ['line separator', 'Archive\u2028now'],
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
