import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, rm, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { preparePostgresSocketDirectory } from '../src/postgres-socket.ts';

test('keeps long plugin data paths within the Unix socket limit', async (t) => {
  const root = await mkdtemp('/tmp/boxel-socket-test-');
  const data = path.join(root, 'nested-plugin-data-'.repeat(8));
  await mkdir(data, { recursive: true });
  const socket = await preparePostgresSocketDirectory(data);
  t.after(async () => {
    await rm(socket, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
  });
  assert.ok(Buffer.byteLength(path.join(socket, '.s.PGSQL.65535')) <= 103);
  assert.equal((await stat(socket)).mode & 0o077, 0);
  assert.equal(await preparePostgresSocketDirectory(data), socket);
});

test('rejects a socket directory that is public or redirected by a symlink', async (t) => {
  const root = await mkdtemp('/tmp/boxel-socket-test-');
  t.after(() => rm(root, { recursive: true, force: true }));
  const socket = await preparePostgresSocketDirectory(root);
  await chmod(socket, 0o755);
  await assert.rejects(
    preparePostgresSocketDirectory(root),
    /private socket directory/,
  );
  await rm(socket, { recursive: true });
  await mkdir(path.join(root, 'redirect'));
  await symlink(path.join(root, 'redirect'), socket);
  await assert.rejects(
    preparePostgresSocketDirectory(root),
    /private socket directory/,
  );
});
