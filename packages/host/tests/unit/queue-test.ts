import { module, test } from 'qunit';

import { type Queue } from '@cardstack/runtime-common';
import { runSharedTest } from '@cardstack/runtime-common/helpers';
// eslint-disable-next-line ember/no-test-import-export
import queueTests from '@cardstack/runtime-common/tests/queue-test';

import { BrowserQueue } from '@cardstack/host/lib/browser-queue';

module('Unit | queue | browser implementation', function (hooks) {
  let queue: Queue;

  hooks.beforeEach(async function () {
    queue = new BrowserQueue();
    await queue.start();
  });

  hooks.afterEach(async function () {
    await queue.destroy();
  });

  test('it can run a job', async function (assert) {
    await runSharedTest(queueTests, assert, { queue });
  });

  test(`a job can throw an exception`, async function (assert) {
    await runSharedTest(queueTests, assert, { queue });
  });

  test('jobs are processed serially within a particular queue', async function (assert) {
    await runSharedTest(queueTests, assert, { queue });
  });
});
