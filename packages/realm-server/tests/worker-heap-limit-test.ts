import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';

import {
  cgroupMemoryLimitMb,
  taskMemoryLimitMb,
  workerHeapLimitMb,
} from '../lib/worker-heap-limit.ts';

module(basename(import.meta.filename), function () {
  module('workerHeapLimitMb', function () {
    test('every worker at its limit still fits in the task', function (assert) {
      let limit = workerHeapLimitMb(4096, 4);
      assert.strictEqual(limit, 696, 'a 4 GB task with 4 workers');
      assert.true(limit * 4 < 4096, 'the workers fit with room to spare');
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

  module('taskMemoryLimitMb', function (hooks) {
    let server: Server;
    let metadataURI: string;
    let taskResponse: { status: number; body: unknown };

    hooks.beforeEach(async function () {
      server = createServer((req, res) => {
        if (req.url === '/v4/container-id/task') {
          res.writeHead(taskResponse.status, {
            'content-type': 'application/json',
          });
          res.end(JSON.stringify(taskResponse.body));
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      let { port } = server.address() as AddressInfo;
      metadataURI = `http://127.0.0.1:${port}/v4/container-id`;
    });

    hooks.afterEach(async function () {
      await new Promise<void>((r) => server.close(() => r()));
    });

    test('reads the task-level limit from the ECS task metadata endpoint', async function (assert) {
      taskResponse = {
        status: 200,
        body: { Limits: { CPU: 2, Memory: 4096 } },
      };
      assert.strictEqual(
        await taskMemoryLimitMb({ ECS_CONTAINER_METADATA_URI_V4: metadataURI }),
        4096,
      );
    });

    test('a metadata response without a memory limit falls back to the cgroup', async function (assert) {
      taskResponse = { status: 200, body: { Limits: { CPU: 2 } } };
      assert.strictEqual(
        await taskMemoryLimitMb({ ECS_CONTAINER_METADATA_URI_V4: metadataURI }),
        await cgroupMemoryLimitMb(),
      );
    });

    test('a failing metadata endpoint falls back to the cgroup', async function (assert) {
      taskResponse = { status: 500, body: {} };
      assert.strictEqual(
        await taskMemoryLimitMb({ ECS_CONTAINER_METADATA_URI_V4: metadataURI }),
        await cgroupMemoryLimitMb(),
      );
    });
  });
});
