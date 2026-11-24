import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileLockTimeoutError, withFileLock } from '../../src/lib/file-lock.ts';

const CONTENDER = fileURLToPath(
  new URL('../fixtures/lock-contender.mjs', import.meta.url),
);
const FILE_LOCK_MODULE = new URL('../../src/lib/file-lock.ts', import.meta.url)
  .href;

describe('withFileLock', () => {
  let dir: string;
  let lockPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-file-lock-'));
    lockPath = path.join(dir, 'profiles.json.lock');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('runs one holder at a time', async () => {
    let inside = 0;
    let most = 0;
    let order: string[] = [];
    let hold = (name: string) =>
      withFileLock(
        lockPath,
        async () => {
          inside++;
          most = Math.max(most, inside);
          order.push(`${name} in`);
          await new Promise((resolve) => setTimeout(resolve, 30));
          order.push(`${name} out`);
          inside--;
        },
        { pollMs: 5 },
      );

    await Promise.all([hold('a'), hold('b'), hold('c')]);

    expect(most).toBe(1);
    expect(order).toHaveLength(6);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('lets go when the work throws', async () => {
    await expect(
      withFileLock(lockPath, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('takes over a lock whose process is gone', async () => {
    // No process has PID 2^22 + 1 on Linux or macOS.
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: 4194305, id: 'gone', takenAt: Date.now() }),
    );

    await expect(withFileLock(lockPath, async () => 'ran')).resolves.toBe(
      'ran',
    );
  });

  it('gives a lock left by a process that is gone to only one of many processes', async () => {
    let contenders = 16;
    for (let trial = 0; trial < 5; trial++) {
      let trialDir = fs.mkdtempSync(path.join(dir, 'trial-'));
      let trialLock = path.join(trialDir, 'profiles.json.lock');
      let gone = spawnSync(process.execPath, ['-e', '0']).pid;
      fs.writeFileSync(
        trialLock,
        JSON.stringify({ pid: gone, id: 'gone', takenAt: Date.now() }),
      );
      let startAt = Date.now() + 1000;
      let exits = await Promise.all(
        Array.from(
          { length: contenders },
          () =>
            new Promise<number | null>((resolve) => {
              spawn(
                process.execPath,
                [
                  CONTENDER,
                  FILE_LOCK_MODULE,
                  trialLock,
                  trialDir,
                  `${startAt}`,
                ],
                { stdio: 'inherit' },
              ).on('exit', resolve);
            }),
        ),
      );

      expect(exits).toEqual(Array(contenders).fill(0));
      expect(
        fs.readdirSync(trialDir).filter((f) => f.startsWith('overlap.')),
      ).toEqual([]);
      expect(fs.existsSync(trialLock)).toBe(false);
    }
  }, 60_000);

  it('takes over a lock older than the stale limit', async () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: process.pid,
        id: 'old',
        takenAt: Date.now() - 120_000,
      }),
    );

    await expect(withFileLock(lockPath, async () => 'ran')).resolves.toBe(
      'ran',
    );
  });

  it('takes over a half-written lock once it is older than the stale limit', async () => {
    fs.writeFileSync(lockPath, '');
    let old = new Date(Date.now() - 120_000);
    fs.utimesSync(lockPath, old, old);

    await expect(withFileLock(lockPath, async () => 'ran')).resolves.toBe(
      'ran',
    );
  });

  it('gives up on a live holder after the timeout, naming the file', async () => {
    fs.writeFileSync(
      lockPath,
      JSON.stringify({ pid: process.pid, id: 'live', takenAt: Date.now() }),
    );

    let attempt = withFileLock(lockPath, async () => 'ran', {
      timeoutMs: 100,
      pollMs: 10,
    });
    await expect(attempt).rejects.toBeInstanceOf(FileLockTimeoutError);
    await expect(attempt).rejects.toThrow(lockPath);
    // The live holder's lock is left alone.
    expect(JSON.parse(fs.readFileSync(lockPath, 'utf8')).id).toBe('live');
  });
});
