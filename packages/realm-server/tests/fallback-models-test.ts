import { module, test } from 'qunit';
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import fallbackModelsTests from '@cardstack/runtime-common/tests/fallback-models-test';

module(basename(import.meta.filename), function () {
  module('DEFAULT_FALLBACK_MODELS', function () {
    test('ships at least one curated model', async function (assert) {
      await runSharedTest(fallbackModelsTests, assert, {});
    });

    test('has no duplicate modelId', async function (assert) {
      await runSharedTest(fallbackModelsTests, assert, {});
    });

    test('DEFAULT_FALLBACK_MODEL_ID matches a curated row', async function (assert) {
      await runSharedTest(fallbackModelsTests, assert, {});
    });

    test('every row has valid typed fields', async function (assert) {
      await runSharedTest(fallbackModelsTests, assert, {});
    });

    test('every row is shaped like FallbackModelConfig', async function (assert) {
      await runSharedTest(fallbackModelsTests, assert, {});
    });
  });
});
