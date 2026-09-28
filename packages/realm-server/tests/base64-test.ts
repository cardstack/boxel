import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import base64Tests from '@cardstack/runtime-common/tests/base64-test';

module(basename(import.meta.filename), function () {
  module('uint8ArrayToBase64', function () {
    test('encodes an empty array', async function (assert) {
      await runSharedTest(base64Tests, assert, {});
    });

    test('encodes bytes including the high range via the Buffer path', async function (assert) {
      await runSharedTest(base64Tests, assert, {});
    });

    test('the btoa fallback matches the Buffer path', async function (assert) {
      await runSharedTest(base64Tests, assert, {});
    });

    test('the btoa fallback chunks past String.fromCharCode argument limits', async function (assert) {
      await runSharedTest(base64Tests, assert, {});
    });

    test('the btoa fallback handles a length on a chunk boundary', async function (assert) {
      await runSharedTest(base64Tests, assert, {});
    });
  });
});
