import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RealmWatcher, watchRealms } from '../../src/commands/realm/watch';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';
import { ProfileManager } from '../../src/lib/profile-manager';
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
let localDirs: string[] = [];

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
