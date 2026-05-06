import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RealmWatcher, watchRealms } from '../../src/commands/realm/watch';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';
import { ProfileManager } from '../../src/lib/profile-manager';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;
const localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-watch-int-'));
  localDirs.push(dir);
  return dir;
}

function buildFileUrl(realm: string, relPath: string): string {
  let base = realm.endsWith('/') ? realm : `${realm}/`;
  return `${base}${relPath.replace(/^\/+/, '')}`;
}

async function writeRemoteFile(
  realm: string,
  relPath: string,
  content: string,
): Promise<void> {
  let response = await profileManager.authedRealmFetch(
    buildFileUrl(realm, relPath),
    {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=UTF-8',
        Accept: 'application/vnd.card+source',
      },
      body: content,
    },
  );
  if (!response.ok) {
    throw new Error(
      `writeRemoteFile ${relPath} failed: ${response.status} ${response.statusText}`,
    );
  }
}

async function deleteRemoteFile(realm: string, relPath: string): Promise<void> {
  let response = await profileManager.authedRealmFetch(
    buildFileUrl(realm, relPath),
    {
      method: 'DELETE',
      headers: { Accept: 'application/vnd.card+source' },
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `deleteRemoteFile ${relPath} failed: ${response.status} ${response.statusText}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  // Realm starts empty; tests seed remote files via authedRealmFetch so they
  // produce realistic mtimes that change between writes.
  await startTestRealmServer();
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;

  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm watch (integration)', () => {
  it('treats remote files as added on the first poll and pulls them', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'first-poll.gts', 'export const a = 1;\n');

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    await watcher.initialize();

    let hasChanges = await watcher.poll();
    expect(hasChanges).toBe(true);
    expect(watcher.pendingCount).toBeGreaterThanOrEqual(1);

    let result = await watcher.flushPending();
    expect(result.pulled).toContain('first-poll.gts');
    expect(
      fs.readFileSync(path.join(localDir, 'first-poll.gts'), 'utf8'),
    ).toContain('a = 1');

    expect(result.checkpoint).not.toBeNull();
    expect(result.checkpoint!.source).toBe('remote');

    let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
    expect(checkpoints.length).toBe(1);

    watcher.shutdown();
    await deleteRemoteFile(realmUrl, 'first-poll.gts');
  });

  it('detects remote modifications across ticks and pulls them', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'mod.gts', 'export const v = 1;\n');

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    await watcher.initialize();
    await watcher.poll();
    await watcher.flushPending();

    expect(fs.readFileSync(path.join(localDir, 'mod.gts'), 'utf8')).toContain(
      'v = 1',
    );

    // Realm mtimes are second-precision — wait so the next write bumps it.
    await sleep(1100);
    await writeRemoteFile(realmUrl, 'mod.gts', 'export const v = 2;\n');

    let hasChanges = await watcher.poll();
    expect(hasChanges).toBe(true);
    let result = await watcher.flushPending();
    expect(result.pulled).toContain('mod.gts');
    expect(fs.readFileSync(path.join(localDir, 'mod.gts'), 'utf8')).toContain(
      'v = 2',
    );

    let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
    // One per applied poll.
    expect(checkpoints.length).toBe(2);

    watcher.shutdown();
    await deleteRemoteFile(realmUrl, 'mod.gts');
  });

  it('detects remote deletions and removes the local copy', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'doomed.gts', 'export const x = 1;\n');

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    await watcher.initialize();
    await watcher.poll();
    await watcher.flushPending();
    expect(fs.existsSync(path.join(localDir, 'doomed.gts'))).toBe(true);

    await deleteRemoteFile(realmUrl, 'doomed.gts');

    let hasChanges = await watcher.poll();
    expect(hasChanges).toBe(true);
    let result = await watcher.flushPending();
    expect(result.deleted).toContain('doomed.gts');
    expect(fs.existsSync(path.join(localDir, 'doomed.gts'))).toBe(false);

    watcher.shutdown();
  });

  it('groups bursts of remote changes into a single debounced flush', async () => {
    let localDir = makeLocalDir();

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 75,
      quiet: true,
    });
    await watcher.initialize();

    let flushes: Array<{ pulled: string[]; deleted: string[] }> = [];
    let flushSettled = new Promise<void>((resolve) => {
      // Trigger two polls in quick succession; debounce should coalesce.
      let onFlush = (result: { pulled: string[]; deleted: string[] }) => {
        flushes.push(result);
        resolve();
      };

      (async () => {
        await writeRemoteFile(realmUrl, 'burst-a.gts', 'export const a = 1;\n');
        await watcher.poll();
        watcher.scheduleFlush(onFlush);

        await writeRemoteFile(realmUrl, 'burst-b.gts', 'export const b = 2;\n');
        await watcher.poll();
        // Reset the timer — second call within debounceMs.
        watcher.scheduleFlush(onFlush);
      })();
    });

    await flushSettled;
    // Allow a brief grace period in case a stray timer slipped through.
    await sleep(40);

    expect(flushes.length).toBe(1);
    expect(flushes[0].pulled.sort()).toEqual(['burst-a.gts', 'burst-b.gts']);

    watcher.shutdown();
    await deleteRemoteFile(realmUrl, 'burst-a.gts');
    await deleteRemoteFile(realmUrl, 'burst-b.gts');
  });

  it('runs the watchRealms loop end-to-end and stops on AbortSignal', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'loop.gts', 'export const loop = 1;\n');

    let controller = new AbortController();
    let runPromise = watchRealms([{ realmUrl, localDir }], {
      profileManager,
      intervalMs: 50,
      debounceMs: 25,
      quiet: true,
      signal: controller.signal,
    });

    // Wait long enough for the initial tick + debounced flush + at least one
    // re-poll, then trigger shutdown.
    await sleep(400);
    controller.abort();
    let result = await runPromise;

    expect(result.error).toBeUndefined();
    expect(result.watchers.length).toBe(1);
    expect(fs.readFileSync(path.join(localDir, 'loop.gts'), 'utf8')).toContain(
      'loop = 1',
    );

    let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[0].source).toBe('remote');

    await deleteRemoteFile(realmUrl, 'loop.gts');
  });

  it('returns an error when the realm URL is unreachable', async () => {
    let localDir = makeLocalDir();
    let result = await watchRealms(
      [{ realmUrl: 'http://127.0.0.1:1/nope/', localDir }],
      { profileManager, intervalMs: 50, debounceMs: 0, quiet: true },
    );
    expect(result.error).toBeDefined();
    expect(result.watchers).toEqual([]);
  });

  it('returns an error when no active profile is configured', async () => {
    let localDir = makeLocalDir();
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-watch-empty-'));
    let emptyManager = new ProfileManager(emptyDir);
    try {
      let result = await watchRealms([{ realmUrl, localDir }], {
        profileManager: emptyManager,
        intervalMs: 50,
        debounceMs: 0,
        quiet: true,
      });
      expect(result.error).toContain('No active profile');
      expect(result.watchers).toEqual([]);
    } finally {
      fs.rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('rejects an empty list of realms', async () => {
    let result = await watchRealms([], {
      profileManager,
      quiet: true,
    });
    expect(result.error).toContain('No realms');
  });

  it('does not delete local files when a poll fails', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'survives.gts', 'export const s = 1;\n');

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    await watcher.initialize();
    await watcher.poll();
    await watcher.flushPending();
    expect(fs.existsSync(path.join(localDir, 'survives.gts'))).toBe(true);

    // Force the next poll to fail (simulating a transient fetch error). The
    // file must remain on disk and `lastKnownMtimes` must be untouched, so a
    // subsequent successful poll observes no change.
    (watcher as any).getRemoteMtimes = async () => {
      throw new Error('simulated network failure');
    };
    await expect(watcher.poll()).rejects.toThrow('simulated network failure');
    expect(watcher.pendingCount).toBe(0);
    expect(fs.existsSync(path.join(localDir, 'survives.gts'))).toBe(true);

    watcher.shutdown();
    await deleteRemoteFile(realmUrl, 'survives.gts');
  });

  it('blocks a second concurrent watch against the same localDir', async () => {
    let localDir = makeLocalDir();

    let firstController = new AbortController();
    let firstRun = watchRealms([{ realmUrl, localDir }], {
      profileManager,
      intervalMs: 1000,
      debounceMs: 25,
      quiet: true,
      signal: firstController.signal,
    });

    // Wait for the first run to acquire the lock.
    await sleep(150);

    let lockPath = path.join(localDir, '.boxel-watch.lock');
    expect(fs.existsSync(lockPath)).toBe(true);

    let secondResult = await watchRealms([{ realmUrl, localDir }], {
      profileManager,
      intervalMs: 1000,
      debounceMs: 25,
      quiet: true,
    });
    expect(secondResult.error).toBeDefined();
    expect(secondResult.error).toContain(`pid ${process.pid}`);
    expect(secondResult.watchers).toEqual([]);

    firstController.abort();
    await firstRun;
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('overwrites a stale lock left by a process that no longer exists', async () => {
    let localDir = makeLocalDir();
    let lockPath = path.join(localDir, '.boxel-watch.lock');
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 999_999_999,
        startedAt: '2020-01-01T00:00:00.000Z',
        realmUrl,
      }),
    );

    let controller = new AbortController();
    let run = watchRealms([{ realmUrl, localDir }], {
      profileManager,
      intervalMs: 1000,
      debounceMs: 25,
      quiet: true,
      signal: controller.signal,
    });

    await sleep(150);
    let parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(parsed.pid).toBe(process.pid);

    controller.abort();
    let result = await run;
    expect(result.error).toBeUndefined();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('does not arm a debounceTimer after shutdown when a poll resolves post-cleanup', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'race.gts', 'export const r = 1;\n');

    // Pre-sync so the watch starts in a steady state — initialize() and the
    // initial tickAll find no new changes and no flush is scheduled.
    let primer = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    await primer.initialize();
    await primer.poll();
    await primer.flushPending();
    primer.shutdown();

    let baseline = await new CheckpointManager(localDir).getCheckpoints();
    expect(baseline.length).toBe(1);

    // Bump the remote so the next-tick poll WOULD detect a change and call
    // scheduleFlush() — which is the path the fix gates.
    await sleep(1100); // mtime is second-precision
    await writeRemoteFile(realmUrl, 'race.gts', 'export const r = 2;\n');

    // Gate the 3rd _mtimes call (1: initialize, 2: initial tickAll's poll,
    // 3: the next scheduled tick — the one we want in flight at abort time).
    let mtimesCallCount = 0;
    let releaseGate: () => void = () => {};
    let gateOpened: () => void = () => {};
    let gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    let entered = new Promise<void>((resolve) => {
      gateOpened = resolve;
    });
    let gatedAuth: RealmAuthenticator = {
      authedRealmFetch: async (input, init) => {
        let url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('_mtimes')) {
          mtimesCallCount++;
          if (mtimesCallCount === 3) {
            gateOpened();
            await gate;
          }
        }
        return profileManager.authedRealmFetch(input, init);
      },
    };

    let controller = new AbortController();
    let runPromise = watchRealms([{ realmUrl, localDir }], {
      authenticator: gatedAuth,
      intervalMs: 50,
      debounceMs: 100,
      quiet: true,
      signal: controller.signal,
    });

    // Wait for the next tick to enter the gated _mtimes call.
    await entered;

    // Abort while the in-flight poll is blocked. cleanup() runs synchronously
    // through stopped=true → w.shutdown() before awaiting releaseWatchLock.
    controller.abort();
    let result = await runPromise;
    expect(result.error).toBeUndefined();

    // Now release the poll. Without the fix, its continuation calls
    // scheduleFlush() on the (already shut down) watcher and arms a fresh
    // debounceTimer that fires post-cleanup, writing files and a new
    // checkpoint after watchRealms() has returned.
    releaseGate();

    // Wait long enough for any (buggy) debounceTimer to fire (debounceMs=100).
    await sleep(300);

    let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
    expect(checkpoints.length).toBe(baseline.length);
    // The bumped remote content was NOT pulled — the gated scheduleFlush is a
    // no-op after shutdown, so the local file stays at r = 1.
    expect(fs.readFileSync(path.join(localDir, 'race.gts'), 'utf8')).toContain(
      'r = 1',
    );
    expect(fs.existsSync(path.join(localDir, '.boxel-watch.lock'))).toBe(false);

    await deleteRemoteFile(realmUrl, 'race.gts');
  });

  it('removes SIGINT/SIGTERM handlers when the watch is stopped via signal', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'sigint.gts', 'export const x = 1;\n');

    // Snapshot pre-existing listeners so we don't conflate with vitest's own
    // signal handling — just check that watchRealms registers exactly one
    // and removes it on cleanup.
    let originalSigint = [...process.listeners('SIGINT')];
    let originalSigterm = [...process.listeners('SIGTERM')];

    // No `signal` supplied → the SIGINT/SIGTERM branch in watchRealms runs.
    let runPromise = watchRealms([{ realmUrl, localDir }], {
      profileManager,
      intervalMs: 1000,
      debounceMs: 25,
      quiet: true,
    });

    await sleep(150);

    let addedSigint = process
      .listeners('SIGINT')
      .filter((l) => !originalSigint.includes(l));
    let addedSigterm = process
      .listeners('SIGTERM')
      .filter((l) => !originalSigterm.includes(l));
    expect(addedSigint).toHaveLength(1);
    expect(addedSigterm).toHaveLength(1);

    // Invoke the registered handler directly instead of process.emit('SIGINT'),
    // which would also trigger any unrelated SIGINT listeners on the runner.
    (addedSigint[0] as () => void)();

    let result = await runPromise;
    expect(result.error).toBeUndefined();
    expect(process.listeners('SIGINT')).toEqual(originalSigint);
    expect(process.listeners('SIGTERM')).toEqual(originalSigterm);
    expect(fs.existsSync(path.join(localDir, '.boxel-watch.lock'))).toBe(false);

    await deleteRemoteFile(realmUrl, 'sigint.gts');
  });

  it('downgrades a pending modify to a delete when the remote file disappears', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(realmUrl, 'flip.gts', 'export const x = 1;\n');

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    await watcher.initialize();
    await watcher.poll();
    await watcher.flushPending();

    await sleep(1100);
    await writeRemoteFile(realmUrl, 'flip.gts', 'export const x = 2;\n');
    await watcher.poll();
    expect(watcher.pendingCount).toBe(1);

    await deleteRemoteFile(realmUrl, 'flip.gts');
    await watcher.poll();

    let result = await watcher.flushPending();
    expect(result.deleted).toContain('flip.gts');
    expect(result.pulled).not.toContain('flip.gts');
    expect(fs.existsSync(path.join(localDir, 'flip.gts'))).toBe(false);

    watcher.shutdown();
  });
});
