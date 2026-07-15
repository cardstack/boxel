import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import toolRequestDecodingTests from '@cardstack/runtime-common/tests/tool-request-decoding-test';

module(basename(import.meta.filename), function () {
  module('tool request decoding', function () {
    test('decodes an encoded request with stringified arguments', async function (assert) {
      await runSharedTest(toolRequestDecodingTests, assert, {});
    });

    test('a partial (still-streaming) arguments string decodes without throwing, leaving arguments undefined', async function (assert) {
      await runSharedTest(toolRequestDecodingTests, assert, {});
    });

    test('a doubly-encoded attributes string is decoded', async function (assert) {
      await runSharedTest(toolRequestDecodingTests, assert, {});
    });

    test('malformed nested attributes keep the outer decode', async function (assert) {
      await runSharedTest(toolRequestDecodingTests, assert, {});
    });
  });
});
