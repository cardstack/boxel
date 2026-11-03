import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, realpath, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const run = promisify(execFile);
const helper = fileURLToPath(
  new URL('../../mise-tasks/lib/orphaned-services.sh', import.meta.url),
);
const shellQuote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitFor(check, message) {
  for (let i = 0; i < 60; i++) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(message);
}
test('cleanup removes only checkout-owned orphans and preserves live managed services', async () => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), 'boxel-cleanup-test-')),
  );
  const checkout = path.join(root, 'checkout.with+chars');
  const sibling = path.join(root, 'checkout.with+chars-other');
  await mkdir(checkout);
  await mkdir(sibling);
  const fixture = path.join(checkout, 'main.ts');
  const body =
    "process.on('SIGTERM', () => {});require('node:fs').writeFileSync('ready-' + process.pid, 'ready');setInterval(() => {}, 1000);";
  await writeFile(fixture, body);
  await writeFile(path.join(checkout, 'worker-manager.ts'), body);
  await mkdir(path.join(checkout, 'prerender'));
  await writeFile(path.join(checkout, 'prerender/prerender-server.ts'), body);
  const marker = 'boxel-cleanup-fixture-' + path.basename(root);
  const pids = [];
  const orphan = async (cwd) => {
    const launcher =
      "const {spawn}=require('node:child_process');const p=spawn(process.execPath," +
      JSON.stringify([fixture, '--realmsRootPath=fixture', marker]) +
      ',{cwd:' +
      JSON.stringify(cwd) +
      ",detached:true,stdio:'ignore'});console.log(p.pid);p.unref();";
    const { stdout } = await run(process.execPath, ['-e', launcher]);
    const pid = Number(stdout.trim());
    assert.ok(pid > 1);
    pids.push(pid);
    await waitFor(
      async () =>
        (await run('ps', ['-p', String(pid), '-o', 'ppid='])).stdout.trim() ===
        '1',
      'fixture did not become orphaned',
    );
    return pid;
  };
  try {
    const managedPids = [];
    for (const [entry, flag] of [
      ['main.ts', '--realmsRootPath=fixture'],
      ['worker-manager.ts', '--allPriorityCount=1'],
      ['prerender/prerender-server.ts', '--port=12345'],
    ]) {
      const managed = spawn(
        process.execPath,
        [path.join(checkout, entry), flag, marker],
        { cwd: checkout, stdio: 'ignore' },
      );
      await new Promise((resolve, reject) => {
        managed.once('spawn', resolve);
        managed.once('error', reject);
      });
      pids.push(managed.pid);
      managedPids.push(managed.pid);
    }
    const own = await orphan(checkout);
    const foreign = await orphan(sibling);
    await waitFor(async () => {
      try {
        await realpath(path.join(checkout, 'ready-' + own));
        return true;
      } catch {
        return false;
      }
    }, 'owned fixture was not ready');
    const command =
      '. ' +
      shellQuote(helper) +
      '; REPO_ROOT=' +
      shellQuote(checkout) +
      '; SWEEP_FORCE=1 SWEEP_GRACE_SECS=0.05 sweep_orphaned_services';
    const { stdout } = await run('sh', ['-c', command]);
    await waitFor(() => !alive(own), 'owned orphan remained running');
    for (const pid of managedPids)
      assert.ok(alive(pid), 'live runtime-owned service was signaled');
    assert.ok(alive(foreign), 'a sibling checkout orphan was signaled');
    assert.match(
      stdout,
      new RegExp('Sent TERM to checkout orphan pid ' + own + '\\b'),
    );
    assert.match(
      stdout,
      new RegExp('Sent KILL to checkout orphan pid ' + own + '\\b'),
    );
    assert.doesNotMatch(
      stdout,
      new RegExp('pid (' + [...managedPids, foreign].join('|') + ')\\b'),
    );
  } finally {
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    await rm(root, { recursive: true, force: true });
  }
});
