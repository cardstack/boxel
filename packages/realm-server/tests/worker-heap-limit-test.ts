import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';

import { LINT_THREAD_HEAP_LIMIT_MB } from '@cardstack/runtime-common/tasks/lint';

import {
  cgroupMemoryLimitMb,
  taskMemoryLimitMb,
  workerHeapLimitMb,
} from '../lib/worker-heap-limit.ts';

module(basename(import.meta.filename), function () {
  module('workerHeapLimitMb', function () {
    test('every worker at its limit, each with a lint running, still fits in the task', function (assert) {
      let limit = workerHeapLimitMb(4096, 4);
      assert.strictEqual(limit, 440, 'a 4 GB task with 4 workers');
      assert.true(
        (limit + LINT_THREAD_HEAP_LIMIT_MB) * 4 < 4096 * 0.75,
        'old generations take at most three quarters of the task',
      );
    });

    test('fewer workers each get a larger share', function (assert) {
      assert.true(workerHeapLimitMb(4096, 1) > workerHeapLimitMb(4096, 4));
    });

    test('a task too small to divide still leaves each worker a usable heap', function (assert) {
      assert.strictEqual(workerHeapLimitMb(512, 4), 256);
    });
  });

  module('cgroupMemoryLimitMb', function () {
    function reader(files: Record<string, string>) {
      return async (path: string) => {
        if (path in files) {
          return files[path];
        }
        throw new Error(`ENOENT: ${path}`);
      };
    }

    test('reads a cgroup v2 limit', async function (assert) {
      assert.strictEqual(
        await cgroupMemoryLimitMb(
          reader({ '/sys/fs/cgroup/memory.max': `${4096 * 1024 * 1024}\n` }),
        ),
        4096,
      );
    });

    test('a cgroup v2 limit of max is no limit', async function (assert) {
      assert.strictEqual(
        await cgroupMemoryLimitMb(
          reader({ '/sys/fs/cgroup/memory.max': 'max\n' }),
        ),
        undefined,
      );
    });

    test('reads a cgroup v1 limit, and treats its no-limit value as none', async function (assert) {
      let v1 = '/sys/fs/cgroup/memory/memory.limit_in_bytes';
      assert.strictEqual(
        await cgroupMemoryLimitMb(reader({ [v1]: `${2048 * 1024 * 1024}` })),
        2048,
      );
      assert.strictEqual(
        await cgroupMemoryLimitMb(reader({ [v1]: '9223372036854771712' })),
        undefined,
      );
    });

    test('no cgroup files is no limit', async function (assert) {
      assert.strictEqual(await cgroupMemoryLimitMb(reader({})), undefined);
    });
  });

  module('taskMemoryLimitMb', function () {
    test('the configured limit wins', async function (assert) {
      assert.strictEqual(await taskMemoryLimitMb(4096), 4096);
    });

    test('without a configured limit, the cgroup limit answers', async function (assert) {
      assert.strictEqual(
        await taskMemoryLimitMb(undefined),
        await cgroupMemoryLimitMb(),
      );
    });
  });
});
