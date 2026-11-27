// The service as a process: two `node main.ts` against one database.

import QUnit from 'qunit';
const { module, test } = QUnit;
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupTestDatabase, waitUntil } from './helpers.ts';

const MAIN = join(import.meta.dirname, '..', 'main.ts');
// A task gives up its lease when a renewal is still pending at its deadline,
// (RENEW_MS + EXPIRY_MS) / 2 after the previous renewal started. These
// timings leave each renewal about two seconds to finish while the test
// spawns another Node process beside the holder on a shared CI runner. The
// expiry stays well above the release handover, which takes about one
// renewal interval, so the handover assertion tells a release from an
// expiry even when renewals run behind schedule.
const RENEW_MS = 200;
const EXPIRY_MS = 4000;

interface Task {
  process: ChildProcess;
  port: number;
  exited: Promise<number | null>;
  log: string;
}

module('process', (hooks) => {
  let database = setupTestDatabase(hooks);
  let tasks: Task[] = [];
  let root: string;

  hooks.beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'realm-historian-'));
  });

  hooks.afterEach(async () => {
    for (let task of tasks.splice(0)) {
      if (task.process.exitCode === null && task.process.signalCode === null) {
        task.process.kill('SIGKILL');
        await task.exited;
      }
    }
    await rm(root, { recursive: true, force: true });
  });

  async function freePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      let server = createServer();
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        let { port } = server.address() as { port: number };
        server.close(() => resolve(port));
      });
    });
  }

  async function startTask(): Promise<Task> {
    let port = await freePort();
    let child = spawn(
      process.execPath,
      [
        MAIN,
        `--historyRoot=${join(root, 'history')}`,
        `--realmsRoot=${join(root, 'realms')}`,
        `--port=${port}`,
        `--leaseRenewMs=${RENEW_MS}`,
        `--leaseExpiryMs=${EXPIRY_MS}`,
      ],
      {
        env: { ...process.env, NODE_NO_WARNINGS: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let task: Task = {
      process: child,
      port,
      exited: new Promise((resolve) => child.once('exit', resolve)),
      log: '',
    };
    child.stdout!.on('data', (chunk) => (task.log += chunk));
    child.stderr!.on('data', (chunk) => (task.log += chunk));
    tasks.push(task);
    await waitUntil(() => healthy(task), {
      what: `task on port ${port} to answer /health (log: ${task.log})`,
    });
    return task;
  }

  async function healthy(task: Task): Promise<boolean> {
    try {
      let response = await fetch(`http://127.0.0.1:${task.port}/health`);
      return response.status === 200;
    } catch {
      return false;
    }
  }

  async function holderOf(shard: number): Promise<string | undefined> {
    let rows = await database.db.execute(
      `SELECT holder FROM realm_historian_leases WHERE shard = $1`,
      { bind: [String(shard)] },
    );
    return rows[0]?.holder as string | undefined;
  }

  function holderPid(holder: string | undefined): number | undefined {
    return holder ? Number(holder.split(':')[1]) : undefined;
  }

  test('a second task waits healthy, takes over on SIGTERM, and exits when its lease is taken', async (assert) => {
    let first = await startTask();
    await waitUntil(async () => (await holderOf(0)) !== undefined, {
      what: 'the first task to take the lease',
    });
    assert.strictEqual(holderPid(await holderOf(0)), first.process.pid);

    let second = await startTask();
    assert.true(await healthy(second), 'the waiting task reports healthy');
    assert.strictEqual(
      holderPid(await holderOf(0)),
      first.process.pid,
      `the first task keeps the lease (first task log: ${first.log}) (second task log: ${second.log})`,
    );

    let signalledAt = Date.now();
    first.process.kill('SIGTERM');
    assert.strictEqual(
      await first.exited,
      0,
      `SIGTERM exits 0 (log: ${first.log})`,
    );
    await waitUntil(
      async () => holderPid(await holderOf(0)) === second.process.pid,
      { what: 'the second task to take the lease' },
    );
    // A task that still holds its lease started its last renewal less than
    // (RENEW_MS + EXPIRY_MS) / 2 before the signal, or its deadline would have
    // fired, so a lease that moved on expiry would move no sooner than this.
    let handover = Date.now() - signalledAt;
    assert.true(
      handover < (EXPIRY_MS - RENEW_MS) / 2,
      `the lease moved on release, before its expiry (${handover}ms)`,
    );
    assert.true(await healthy(second), 'the new holder reports healthy');

    await database.db.execute(
      `UPDATE realm_historian_leases
       SET holder = 'intruder', expires_at = now() + interval '1 hour'
       WHERE shard = '0'`,
    );
    let code = await second.exited;
    assert.notStrictEqual(
      code,
      0,
      `a lost lease exits non-zero (log: ${second.log})`,
    );
    assert.true(
      second.log.includes('lost the lease on shard(s) 0'),
      `the loss is logged (log: ${second.log})`,
    );
  });

  async function usage(
    args: string[],
  ): Promise<{ code: number | null; stderr: string }> {
    let child = spawn(process.execPath, [MAIN, ...args], {
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr!.on('data', (chunk) => (stderr += chunk));
    let code = await new Promise<number | null>((resolve) =>
      child.once('exit', resolve),
    );
    return { code, stderr };
  }

  test('a missing option is a usage error', async (assert) => {
    let missingRoot = await usage(['--port=0']);
    assert.strictEqual(missingRoot.code, 2);
    assert.true(
      missingRoot.stderr.includes('--historyRoot is required'),
      missingRoot.stderr,
    );

    let missingPort = await usage([
      `--historyRoot=${join(root, 'history')}`,
      `--realmsRoot=${join(root, 'realms')}`,
    ]);
    assert.strictEqual(missingPort.code, 2);
    assert.true(
      missingPort.stderr.includes('--port is required'),
      missingPort.stderr,
    );
  });
});
