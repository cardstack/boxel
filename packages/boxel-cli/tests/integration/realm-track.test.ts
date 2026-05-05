import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RealmTracker, trackRealms } from '../../src/commands/realm/track';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';
import type { ProfileManager } from '../../src/lib/profile-manager';
import { createRealm } from '../../src/commands/realm/create';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
const localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-track-int-'));
  localDirs.push(dir);
  return dir;
}

function writeLocal(localDir: string, relPath: string, content: string): void {
  let full = path.join(localDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function deleteLocal(localDir: string, relPath: string): void {
  fs.unlinkSync(path.join(localDir, relPath));
}

function buildFileUrl(realmUrl: string, relPath: string): string {
  let base = realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`;
  return `${base}${relPath.replace(/^\/+/, '')}`;
}

async function remoteFileExists(
  realmUrl: string,
  relPath: string,
): Promise<boolean> {
  let response = await profileManager.authedRealmFetch(
    buildFileUrl(realmUrl, relPath),
    { headers: { Accept: 'application/vnd.card+source' } },
  );
  return response.ok;
}

async function fetchRemoteFile(
  realmUrl: string,
  relPath: string,
): Promise<string> {
  let response = await profileManager.authedRealmFetch(
    buildFileUrl(realmUrl, relPath),
    { headers: { Accept: 'application/vnd.card+source' } },
  );
  if (!response.ok) {
    throw new Error(
      `fetchRemoteFile ${relPath} failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

async function writeRemoteFile(
  realmUrl: string,
  relPath: string,
  content: string,
): Promise<void> {
  let response = await profileManager.authedRealmFetch(
    buildFileUrl(realmUrl, relPath),
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

function seedManifest(
  localDir: string,
  realmUrl: string,
  files: Record<string, string> = {},
): void {
  fs.writeFileSync(
    path.join(localDir, '.boxel-sync.json'),
    JSON.stringify({ realmUrl, files, remoteMtimes: {} }, null, 2),
  );
}

async function createTestRealm(): Promise<string> {
  let name = uniqueRealmName();
  await createRealm(name, `Test ${name}`, { profileManager });
  let realmTokens =
    profileManager.getActiveProfile()!.profile.realmTokens ?? {};
  let entry = Object.entries(realmTokens).find(([url]) => url.includes(name));
  if (!entry) {
    throw new Error(`No realm JWT stored for ${name}`);
  }
  return entry[0];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  await startTestRealmServer();
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

describe('realm track (integration) — local behavior', () => {
  it('detects an added file and writes a local checkpoint', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/track-add/';

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: false,
    });
    await tracker.initialize();

    writeLocal(localDir, 'cards/foo.gts', 'export const foo = 1;\n');

    let hasNew = await tracker.scanForChanges();
    expect(hasNew).toBe(true);
    expect(tracker.pendingCount).toBe(1);

    let result = await tracker.flushPending(true);
    expect(result).not.toBeNull();
    expect(result!.added).toEqual(['cards/foo.gts']);
    expect(result!.modified).toEqual([]);
    expect(result!.deleted).toEqual([]);
    expect(result!.checkpoint).not.toBeNull();
    expect(result!.checkpoint!.source).toBe('local');

    tracker.shutdown();
  });

  it('detects a modification and writes a local checkpoint', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/track-mod/';
    writeLocal(localDir, 'a.gts', 'export const a = 1;\n');

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: false,
    });
    await tracker.initialize();

    // Realm mtimes are second-precision; wait so the next write bumps it.
    await sleep(1100);
    writeLocal(localDir, 'a.gts', 'export const a = 2;\n');

    let hasNew = await tracker.scanForChanges();
    expect(hasNew).toBe(true);
    let result = await tracker.flushPending(true);
    expect(result!.modified).toEqual(['a.gts']);
    expect(result!.added).toEqual([]);

    tracker.shutdown();
  });

  it('detects a deletion and writes a local checkpoint', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/track-del/';

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: false,
    });
    await tracker.initialize();

    // Baseline: tracker must have already checkpointed the file at least
    // once before the delete; otherwise .boxel-history has nothing to
    // diff against and createCheckpoint returns null. This mirrors the
    // real-world flow (file edited or added under track's watch) and
    // matches the watch test's pre-flush pattern.
    writeLocal(localDir, 'doomed.gts', 'export const x = 1;\n');
    await tracker.scanForChanges();
    await tracker.flushPending(true);

    deleteLocal(localDir, 'doomed.gts');
    await tracker.scanForChanges();
    let result = await tracker.flushPending(true);
    expect(result!.deleted).toEqual(['doomed.gts']);
    expect(result!.checkpoint).not.toBeNull();

    tracker.shutdown();
  });

  it('coalesces a burst of edits into one debounced checkpoint', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/track-burst/';

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 75,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: false,
    });
    await tracker.initialize();

    let flushes: Array<{ added: string[]; modified: string[] }> = [];
    let flushSettled = new Promise<void>((resolve) => {
      let onFlush = (result: { added: string[]; modified: string[] }) => {
        flushes.push(result);
        resolve();
      };

      (async () => {
        writeLocal(localDir, 'b1.gts', '1');
        await tracker.scanForChanges();
        tracker.scheduleFlush(onFlush);

        writeLocal(localDir, 'b2.gts', '2');
        await tracker.scanForChanges();
        tracker.scheduleFlush(onFlush);
      })();
    });

    await flushSettled;
    await sleep(40);

    expect(flushes.length).toBe(1);
    expect(flushes[0].added.sort()).toEqual(['b1.gts', 'b2.gts']);

    tracker.shutdown();
  });

  it('defers a second batch when min-interval has not elapsed', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/track-int/';

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 200,
      quiet: true,
      verbose: false,
      push: false,
    });
    await tracker.initialize();

    writeLocal(localDir, 'first.gts', '1');
    await tracker.scanForChanges();
    let r1 = await tracker.flushPending();
    expect(r1!.added).toEqual(['first.gts']);

    // Second batch within minIntervalMs — should be deferred.
    writeLocal(localDir, 'second.gts', '2');
    await tracker.scanForChanges();
    let r2 = await tracker.flushPending();
    expect(r2).toBeNull();
    // Pending entry stays buffered until the interval timer fires.
    expect(tracker.pendingCount).toBe(1);

    // Wait past the min interval; the interval timer should drain it.
    await sleep(300);
    expect(tracker.pendingCount).toBe(0);

    tracker.shutdown();
  });

  it('hash-gates a noop modify when the manifest has the same hash', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/track-hash/';
    let content = 'export const noop = 1;\n';
    writeLocal(localDir, 'noop.gts', content);

    // md5 of `content`.
    let crypto = await import('crypto');
    let hash = crypto.createHash('md5').update(content).digest('hex');
    seedManifest(localDir, realmUrl, { 'noop.gts': hash });

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: false,
    });
    await tracker.initialize();

    // Touch (rewrite identical content) so mtime/size diff is recorded.
    await sleep(1100);
    writeLocal(localDir, 'noop.gts', content);

    await tracker.scanForChanges();
    let result = await tracker.flushPending(true);
    expect(result).not.toBeNull();
    // Hash gate dropped the modify; nothing to checkpoint.
    expect(result!.modified).toEqual([]);
    expect(result!.added).toEqual([]);
    expect(result!.checkpoint).toBeNull();

    tracker.shutdown();
  });
});

describe('realm track (integration) — --push', () => {
  it('uploads adds and updates via /_atomic, then updates the manifest', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    seedManifest(localDir, realmUrl);

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: true,
    });
    await tracker.initialize();
    // Write AFTER init so seedFileStates doesn't capture it as already-known.
    writeLocal(localDir, 'thing.gts', 'export const t = 1;\n');
    await tracker.scanForChanges();
    let result = await tracker.flushPending(true);

    expect(result!.added).toEqual(['thing.gts']);
    expect(result!.pushed).toEqual(['thing.gts']);
    expect(result!.pushFailed).toEqual([]);
    expect(await remoteFileExists(realmUrl, 'thing.gts')).toBe(true);
    expect(await fetchRemoteFile(realmUrl, 'thing.gts')).toContain('t = 1');

    let manifest = JSON.parse(
      fs.readFileSync(path.join(localDir, '.boxel-sync.json'), 'utf8'),
    );
    expect(manifest.files['thing.gts']).toBeTypeOf('string');
    expect(manifest.files['thing.gts'].length).toBeGreaterThan(0);

    tracker.shutdown();
  });

  it('orders .gts modules before .json instances inside the atomic POST', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    seedManifest(localDir, realmUrl);

    // Spy on authedRealmFetch to capture the atomic POST body.
    let capturedBody: string | null = null;
    let originalFetch = profileManager.authedRealmFetch.bind(profileManager);
    profileManager.authedRealmFetch = async (input, init) => {
      let urlString =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (urlString.endsWith('_atomic') && init?.body) {
        capturedBody = init.body as string;
      }
      return originalFetch(input, init);
    };

    try {
      let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
        debounceMs: 0,
        minIntervalMs: 0,
        quiet: true,
        verbose: false,
        push: true,
      });
      await tracker.initialize();
      // Write AFTER init so seedFileStates doesn't pre-capture the files.
      writeLocal(
        localDir,
        'cards/Person/Person.gts',
        'export const p = 1;\n',
      );
      writeLocal(localDir, 'cards/Person/instance-1.json', '{"x":1}\n');
      await tracker.scanForChanges();
      await tracker.flushPending(true);
      tracker.shutdown();
    } finally {
      profileManager.authedRealmFetch = originalFetch;
    }

    expect(capturedBody).not.toBeNull();
    let parsed = JSON.parse(capturedBody!);
    let ops: Array<{ op: string; href: string }> = parsed['atomic:operations'];
    let gtsIdx = ops.findIndex((o) => o.href.endsWith('Person.gts'));
    let jsonIdx = ops.findIndex((o) => o.href.endsWith('instance-1.json'));
    expect(gtsIdx).toBeGreaterThanOrEqual(0);
    expect(jsonIdx).toBeGreaterThanOrEqual(0);
    expect(gtsIdx).toBeLessThan(jsonIdx);
  });

  it('skips deletions on push, recording them in the local checkpoint only', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    seedManifest(localDir, realmUrl);

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: true,
    });
    await tracker.initialize();

    // Establish the file via a normal track add+push cycle so manifest,
    // remote, and .boxel-history all agree on its existence.
    writeLocal(localDir, 'persistent.gts', 'export const x = 1;\n');
    await tracker.scanForChanges();
    await tracker.flushPending(true);
    expect(await remoteFileExists(realmUrl, 'persistent.gts')).toBe(true);

    deleteLocal(localDir, 'persistent.gts');
    await tracker.scanForChanges();
    let result = await tracker.flushPending(true);

    expect(result!.deleted).toEqual(['persistent.gts']);
    expect(result!.pushed).toEqual([]);
    expect(result!.pushFailed).toEqual([]);
    expect(result!.checkpoint).not.toBeNull();
    // Remote file untouched — deferred deletion semantics.
    expect(await remoteFileExists(realmUrl, 'persistent.gts')).toBe(true);

    tracker.shutdown();
  });

  it('fails fast when --push is enabled but no manifest exists', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/no-manifest/';

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: true,
    });
    await expect(tracker.initialize()).rejects.toThrow(
      /requires a synced workspace/,
    );

    tracker.shutdown();
  });

  it('retains entries whose push fails (e.g. concurrent 409) for the next cycle', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    seedManifest(localDir, realmUrl);

    // Pre-create the file on the realm so an 'add' op gets a 409. Since
    // the manifest is empty, our addPaths logic will use op:add, but the
    // server already has the resource → 409.
    await writeRemoteFile(realmUrl, 'race.gts', 'export const r = 1;\n');

    let tracker = new RealmTracker({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      minIntervalMs: 0,
      quiet: true,
      verbose: false,
      push: true,
    });
    await tracker.initialize();
    // Write AFTER init so scanForChanges sees the file as new.
    writeLocal(localDir, 'race.gts', 'export const r = 2;\n');
    await tracker.scanForChanges();
    let result = await tracker.flushPending(true);

    // Push failed; entry is retained for retry.
    expect(result!.pushFailed.length).toBe(1);
    expect(result!.pushFailed[0].path).toBe('race.gts');
    expect(tracker.pendingCount).toBe(1);

    tracker.shutdown();
  });
});

describe('realm track (integration) — locks and orchestration', () => {
  it('blocks a second concurrent track against the same localDir', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/lock-self/';

    let firstController = new AbortController();
    let firstRun = trackRealms([{ realmUrl, localDir }], {
      debounceMs: 25,
      intervalMs: 1000,
      quiet: true,
      push: false,
      signal: firstController.signal,
    });

    await sleep(150);
    let lockPath = path.join(localDir, '.boxel-track.lock');
    expect(fs.existsSync(lockPath)).toBe(true);

    let second = await trackRealms([{ realmUrl, localDir }], {
      debounceMs: 25,
      intervalMs: 1000,
      quiet: true,
      push: false,
    });
    expect(second.error).toBeDefined();
    expect(second.error).toContain(`pid ${process.pid}`);
    expect(second.trackers).toEqual([]);

    firstController.abort();
    await firstRun;
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('refuses to start when a live watch lock exists at the same localDir', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/lock-cross/';
    fs.mkdirSync(localDir, { recursive: true });
    let watchLockPath = path.join(localDir, '.boxel-watch.lock');
    fs.writeFileSync(
      watchLockPath,
      JSON.stringify({
        pid: process.pid,
        startedAt: new Date().toISOString(),
        realmUrl,
      }),
    );

    let result = await trackRealms([{ realmUrl, localDir }], {
      debounceMs: 25,
      intervalMs: 1000,
      quiet: true,
      push: false,
    });
    expect(result.error).toBeDefined();
    expect(result.error).toContain('boxel realm watch');
    expect(result.error).toContain(`pid ${process.pid}`);
    expect(result.trackers).toEqual([]);
    // Track refused — must not have written its own lock or touched the
    // watch lock.
    expect(fs.existsSync(path.join(localDir, '.boxel-track.lock'))).toBe(false);
    expect(fs.existsSync(watchLockPath)).toBe(true);
    fs.rmSync(watchLockPath);
  });

  it('overwrites a stale track lock from a process that no longer exists', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/lock-stale/';
    let lockPath = path.join(localDir, '.boxel-track.lock');
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      lockPath,
      JSON.stringify({
        pid: 999_999_999,
        startedAt: '2020-01-01T00:00:00.000Z',
        realmUrl,
      }),
    );

    let controller = new AbortController();
    let run = trackRealms([{ realmUrl, localDir }], {
      debounceMs: 25,
      intervalMs: 1000,
      quiet: true,
      push: false,
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

  it('flushes pending changes before exit when the abort signal fires', async () => {
    let localDir = makeLocalDir();
    let realmUrl = 'https://example.test/abort-flush/';

    let controller = new AbortController();
    let run = trackRealms([{ realmUrl, localDir }], {
      debounceMs: 0,
      intervalMs: 5000, // long min-interval — exit must force-flush past it
      quiet: true,
      push: false,
      signal: controller.signal,
    });

    await sleep(150);
    writeLocal(localDir, 'last-minute.gts', '1');
    // Give the poll loop one tick to detect.
    await sleep(2200);

    controller.abort();
    let result = await run;
    expect(result.error).toBeUndefined();

    // Final force-flush should have written a checkpoint covering the file.
    let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
    expect(
      checkpoints.some((c) =>
        c.message.toLowerCase().includes('last-minute'),
      ) ||
        // Some checkpoint message conventions just say "X file added".
        checkpoints.length >= 1,
    ).toBe(true);
  });
});
