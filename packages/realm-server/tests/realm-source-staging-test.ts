import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
import realmSourceStagingTests from '@cardstack/runtime-common/tests/realm-source-staging-test';

module(basename(import.meta.filename), function () {
  module('stageRealmSources', function () {
    test('never reads the prefix map for files that import no prefix realm', async function (assert) {
      await runSharedTest(realmSourceStagingTests, assert, {});
    });

    test('shims every referenced prefix, naming the cause, when the map cannot be read', async function (assert) {
      await runSharedTest(realmSourceStagingTests, assert, {});
    });
  });
});
