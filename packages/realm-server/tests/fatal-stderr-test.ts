import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { StderrLines, classifyStderrLine } from '../lib/fatal-stderr.ts';

const HEAP =
  'FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory';

module(basename(import.meta.filename), function () {
  module('StderrLines', function () {
    test('a diagnostic split across chunks is one line', function (assert) {
      let lines = new StderrLines();
      let cut = HEAP.indexOf('JavaScript');
      assert.deepEqual(
        lines.push(`<--- Last few GCs --->\n${HEAP.slice(0, cut)}`),
        ['<--- Last few GCs --->'],
      );
      assert.deepEqual(lines.push(`${HEAP.slice(cut)}\n`), [HEAP]);
      assert.deepEqual(
        lines
          .push(`${HEAP.slice(0, cut)}`)
          .concat(lines.push(`${HEAP.slice(cut)}\n`))
          .map(classifyStderrLine),
        ['heap-exhausted'],
        'the halves alone are never classified',
      );
    });

    test('an unterminated last line is read when the stream ends', function (assert) {
      let lines = new StderrLines();
      assert.deepEqual(lines.push(HEAP), []);
      assert.deepEqual(lines.flush(), [HEAP]);
      assert.deepEqual(lines.flush(), [], 'flushed once');
    });
  });

  module('classifyStderrLine', function () {
    test('heap exhaustion, another fatal error, and noise', function (assert) {
      assert.strictEqual(classifyStderrLine(HEAP), 'heap-exhausted');
      assert.strictEqual(
        classifyStderrLine(
          'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
        ),
        'heap-exhausted',
      );
      assert.strictEqual(
        classifyStderrLine('FATAL ERROR: v8::ToLocalChecked Empty MaybeLocal'),
        'fatal',
      );
      assert.strictEqual(
        classifyStderrLine(
          'FATAL ERROR: Ineffective mark-compacts near heap limit',
        ),
        'fatal',
        'the first half of a split heap diagnostic, on its own, is not heap exhaustion',
      );
      assert.strictEqual(classifyStderrLine('a warning'), undefined);
    });
  });
});
