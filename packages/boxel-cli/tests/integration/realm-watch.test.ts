import '../helpers/setup-realm-server';
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  RealmWatcher,
  watchRealms,
} from '../../src/commands/realm/watch/start';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';
import { ProfileManager } from '../../src/lib/profile-manager';
import type { RealmAuthenticator } from '../../src/lib/realm-authenticator';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupJwtTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';
import { TINY_PNG_BYTES } from '../helpers/binary-fixtures';

let profileManager: ProfileManager;
let cleanupProfile: (() => void) | undefined;
let realmUrl: string;
const localDirs: string[] = [];
const REMOTE_REQUEST_TIMEOUT_MS = 30_000;
const REMOTE_VISIBILITY_TIMEOUT_MS = 5_000;
const JWT_TEST_USER = '@cli-watch-test:localhost';

function currentTestName(): string {
  return expect.getState().currentTestName ?? 'unknown test';
}

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-watch-int-'));
  localDirs.push(dir);
  return dir;
}

function buildFileUrl(realm: string, relPath: string): string {
  let base = realm.endsWith('/') ? realm : `${realm}/`;
  return `${base}${relPath.replace(/^\/+/, '')}`;
}

function watchFixture(name: string): string {
  return `${name}.txt`;
}

function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  let details = [`${error.name}: ${error.message}`];
  let cause = (error as Error & { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    let code = 'code' in cause ? (cause as { code?: unknown }).code : undefined;
    if (typeof code === 'string') {
      details.push(`code=${code}`);
    }
    let socket =
      'socket' in cause
        ? (
            cause as {
              socket?: {
                localPort?: number;
                remotePort?: number;
                bytesRead?: number;
                bytesWritten?: number;
              };
            }
          ).socket
        : undefined;
    if (socket) {
      details.push(
        `socket(localPort=${socket.localPort ?? 'n/a'}, remotePort=${socket.remotePort ?? 'n/a'}, bytesRead=${socket.bytesRead ?? 'n/a'}, bytesWritten=${socket.bytesWritten ?? 'n/a'})`,
      );
    }
  }

  return details.join(' | ');
}

async function remoteMutation(
  realm: string,
  relPath: string,
  init: RequestInit,
): Promise<Response> {
  let controller = new AbortController();
  let upstreamSignal = init.signal;
  let removeAbortListener: (() => void) | undefined;
  let timedOut = false;
  let timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REMOTE_REQUEST_TIMEOUT_MS);
  let startedAt = Date.now();
  let testName = currentTestName();
  let url = buildFileUrl(realm, relPath);

  if (upstreamSignal) {
    if (upstreamSignal.aborted) {
      controller.abort(upstreamSignal.reason);
    } else {
      let onAbort = () => controller.abort(upstreamSignal.reason);
      upstreamSignal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () =>
        upstreamSignal.removeEventListener('abort', onAbort);
    }
  }

  try {
    return await profileManager.authedRealmFetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    let elapsedMs = Date.now() - startedAt;
    let detail = timedOut
      ? `timed out after ${REMOTE_REQUEST_TIMEOUT_MS}ms`
      : formatFetchError(error);
    throw new Error(
      `remote ${init.method ?? 'GET'} ${relPath} failed during "${testName}" after ${elapsedMs}ms: ${detail}`,
      { cause: error instanceof Error ? error : undefined },
    );
  } finally {
    clearTimeout(timeout);
    removeAbortListener?.();
  }
}

async function fetchRemoteMtimes(
  realm: string,
): Promise<Record<string, number>> {
  let response = await remoteMutation(realm, '_mtimes', {
    method: 'GET',
    headers: { Accept: 'application/vnd.api+json' },
  });
  if (!response.ok) {
    throw new Error(
      `_mtimes fetch failed: ${response.status} ${response.statusText}`,
    );
  }

  let data = (await response.json()) as {
    data?: { attributes?: { mtimes?: Record<string, number> } };
  };
  return data.data?.attributes?.mtimes ?? {};
}

async function waitForRemoteVisibility(
  realm: string,
  relPath: string,
  mode: 'present' | 'absent',
  opts?: { previousMtime?: number },
): Promise<void> {
  let targetUrl = buildFileUrl(realm, relPath);
  let deadline = Date.now() + REMOTE_VISIBILITY_TIMEOUT_MS;
  let lastSeen: number | undefined;

  while (Date.now() < deadline) {
    let mtimes = await fetchRemoteMtimes(realm);
    lastSeen = mtimes[targetUrl];
    if (
      mode === 'present'
        ? lastSeen !== undefined &&
          (opts?.previousMtime === undefined || lastSeen !== opts.previousMtime)
        : lastSeen === undefined
    ) {
      return;
    }
    await sleep(50);
  }

  throw new Error(
    `remote ${relPath} did not become ${mode} in _mtimes within ${REMOTE_VISIBILITY_TIMEOUT_MS}ms (lastSeen=${lastSeen ?? 'missing'}, previousMtime=${opts?.previousMtime ?? 'missing'})`,
  );
}

async function writeRemoteFile(
  realm: string,
  relPath: string,
  content: string,
): Promise<void> {
  let previousMtime = (await fetchRemoteMtimes(realm))[
    buildFileUrl(realm, relPath)
  ];
  let response = await remoteMutation(realm, relPath, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.card+source',
      'Content-Type': 'text/plain;charset=UTF-8',
    },
    body: content,
  });
  if (!response.ok) {
    throw new Error(
      `writeRemoteFile ${relPath} failed: ${response.status} ${response.statusText}`,
    );
  }
  await waitForRemoteVisibility(realm, relPath, 'present', { previousMtime });
}

async function writeRemoteBytes(
  realm: string,
  relPath: string,
  bytes: Uint8Array,
): Promise<void> {
  let previousMtime = (await fetchRemoteMtimes(realm))[
    buildFileUrl(realm, relPath)
  ];
  let response = await remoteMutation(realm, relPath, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(
      `writeRemoteBytes ${relPath} failed: ${response.status} ${response.statusText}`,
    );
  }
  await waitForRemoteVisibility(realm, relPath, 'present', { previousMtime });
}

async function deleteRemoteFile(realm: string, relPath: string): Promise<void> {
  let response = await remoteMutation(realm, relPath, {
    method: 'DELETE',
    headers: { Accept: 'application/vnd.card+source' },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `deleteRemoteFile ${relPath} failed: ${response.status} ${response.statusText}`,
    );
  }
  await waitForRemoteVisibility(realm, relPath, 'absent');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeAll(async () => {
  // Realm starts empty; tests seed remote files via authedRealmFetch so they
  // produce realistic mtimes that change between writes.
  await startTestRealmServer({
    registerMatrixUser: false,
    realms: [
      {
        realmURL: new URL(`${TEST_REALM_SERVER_URL}/test/`),
        permissions: {
          '*': ['read', 'write'],
          [JWT_TEST_USER]: ['read', 'write', 'realm-owner'],
        },
      },
    ],
  });
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
});

beforeEach(async () => {
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupJwtTestProfile(profileManager, {
    user: JWT_TEST_USER,
    realmServerUrl: `${TEST_REALM_SERVER_URL}/`,
  });
});

afterEach(() => {
  cleanupProfile?.();
  cleanupProfile = undefined;
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  await stopTestRealmServer();
});

describe('realm watch (integration)', () => {
  it('treats remote files as added on the first poll and pulls them', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(
      realmUrl,
      watchFixture('first-poll'),
      'export const a = 1;\n',
    );

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    try {
      await watcher.initialize();

      let hasChanges = await watcher.poll();
      expect(hasChanges).toBe(true);
      expect(watcher.pendingCount).toBeGreaterThanOrEqual(1);

      let result = await watcher.flushPending();
      expect(result.pulled).toContain(watchFixture('first-poll'));
      expect(
        fs.readFileSync(
          path.join(localDir, watchFixture('first-poll')),
          'utf8',
        ),
      ).toContain('a = 1');

      expect(result.checkpoint).not.toBeNull();
      expect(result.checkpoint!.source).toBe('remote');

      let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
      expect(checkpoints.length).toBe(1);
    } finally {
      watcher.shutdown();
    }
  });

  it('detects remote modifications across ticks and pulls them', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(
      realmUrl,
      watchFixture('mod'),
      'export const v = 1;\n',
    );

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    try {
      await watcher.initialize();
      await watcher.poll();
      await watcher.flushPending();

      expect(
        fs.readFileSync(path.join(localDir, watchFixture('mod')), 'utf8'),
      ).toContain('v = 1');

      // Realm mtimes are second-precision — wait so the next write bumps it.
      await sleep(1100);
      await writeRemoteFile(
        realmUrl,
        watchFixture('mod'),
        'export const v = 2;\n',
      );

      let hasChanges = await watcher.poll();
      expect(hasChanges).toBe(true);
      let result = await watcher.flushPending();
      expect(result.pulled).toContain(watchFixture('mod'));
      expect(
        fs.readFileSync(path.join(localDir, watchFixture('mod')), 'utf8'),
      ).toContain('v = 2');

      let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
      // One per applied poll.
      expect(checkpoints.length).toBe(2);
    } finally {
      watcher.shutdown();
    }
  });

  it('detects remote deletions and removes the local copy', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(
      realmUrl,
      watchFixture('doomed'),
      'export const x = 1;\n',
    );

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    try {
      await watcher.initialize();
      await watcher.poll();
      await watcher.flushPending();
      expect(fs.existsSync(path.join(localDir, watchFixture('doomed')))).toBe(
        true,
      );

      await deleteRemoteFile(realmUrl, watchFixture('doomed'));

      let hasChanges = await watcher.poll();
      expect(hasChanges).toBe(true);
      let result = await watcher.flushPending();
      expect(result.deleted).toContain(watchFixture('doomed'));
      expect(fs.existsSync(path.join(localDir, watchFixture('doomed')))).toBe(
        false,
      );
    } finally {
      watcher.shutdown();
    }
  });

  it('groups bursts of remote changes into a single debounced flush', async () => {
    let localDir = makeLocalDir();
    let debounceMs = 2_000;

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs,
      quiet: true,
    });
    try {
      await watcher.initialize();
      await watcher.poll();
      await watcher.flushPending();

      let flushes: Array<{ pulled: string[]; deleted: string[] }> = [];
      let resolveFlush!: () => void;
      let flushTimeout: ReturnType<typeof setTimeout>;
      let flushSettled = new Promise<void>((resolve, reject) => {
        flushTimeout = setTimeout(() => {
          reject(
            new Error(
              `debounced flush did not settle within ${debounceMs + 1_000}ms during "${currentTestName()}"`,
            ),
          );
        }, debounceMs + 1_000);
        resolveFlush = () => {
          clearTimeout(flushTimeout);
          resolve();
        };
      });
      let onFlush = (result: { pulled: string[]; deleted: string[] }) => {
        flushes.push(result);
        resolveFlush();
      };

      await writeRemoteFile(
        realmUrl,
        watchFixture('burst-a'),
        'export const a = 1;\n',
      );
      await watcher.poll();
      watcher.scheduleFlush(onFlush);

      await writeRemoteFile(
        realmUrl,
        watchFixture('burst-b'),
        'export const b = 2;\n',
      );
      await watcher.poll();
      watcher.scheduleFlush(onFlush);

      await flushSettled;
      await sleep(60);

      expect(flushes.length).toBe(1);
      expect(flushes[0].pulled.sort()).toEqual([
        watchFixture('burst-a'),
        watchFixture('burst-b'),
      ]);
    } finally {
      watcher.shutdown();
    }
  });

  it('runs the watchRealms loop end-to-end and stops on AbortSignal', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(
      realmUrl,
      watchFixture('loop'),
      'export const loop = 1;\n',
    );

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
    expect(
      fs.readFileSync(path.join(localDir, watchFixture('loop')), 'utf8'),
    ).toContain('loop = 1');

    let checkpoints = await new CheckpointManager(localDir).getCheckpoints();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
    expect(checkpoints[0].source).toBe('remote');
  });

  it('pulls a remote PNG byte-identically (CS-11075)', async () => {
    let localDir = makeLocalDir();
    await writeRemoteBytes(realmUrl, 'image.png', TINY_PNG_BYTES);

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    try {
      await watcher.initialize();
      await watcher.poll();
      let result = await watcher.flushPending();
      expect(result.pulled).toContain('image.png');

      let pulled = fs.readFileSync(path.join(localDir, 'image.png'));
      expect(pulled.equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
    } finally {
      watcher.shutdown();
    }
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
    await writeRemoteFile(
      realmUrl,
      watchFixture('survives'),
      'export const s = 1;\n',
    );

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    try {
      await watcher.initialize();
      await watcher.poll();
      await watcher.flushPending();
      expect(fs.existsSync(path.join(localDir, watchFixture('survives')))).toBe(
        true,
      );

      // Force the next poll to fail (simulating a transient fetch error). The
      // file must remain on disk and `lastKnownMtimes` must be untouched, so a
      // subsequent successful poll observes no change.
      (watcher as any).getRemoteMtimes = async () => {
        throw new Error('simulated network failure');
      };
      await expect(watcher.poll()).rejects.toThrow('simulated network failure');
      expect(watcher.pendingCount).toBe(0);
      expect(fs.existsSync(path.join(localDir, watchFixture('survives')))).toBe(
        true,
      );
    } finally {
      watcher.shutdown();
    }
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
    await writeRemoteFile(
      realmUrl,
      watchFixture('race'),
      'export const r = 1;\n',
    );

    // Pre-sync so the watch starts in a steady state — initialize() and the
    // initial tickAll find no new changes and no flush is scheduled.
    let primer = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    try {
      await primer.initialize();
      await primer.poll();
      await primer.flushPending();
    } finally {
      primer.shutdown();
    }

    let baseline = await new CheckpointManager(localDir).getCheckpoints();
    expect(baseline.length).toBe(1);

    // Bump the remote so the next-tick poll WOULD detect a change and call
    // scheduleFlush() — which is the path the fix gates.
    await sleep(1100); // mtime is second-precision
    await writeRemoteFile(
      realmUrl,
      watchFixture('race'),
      'export const r = 2;\n',
    );

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
    expect(
      fs.readFileSync(path.join(localDir, watchFixture('race')), 'utf8'),
    ).toContain('r = 1');
    expect(fs.existsSync(path.join(localDir, '.boxel-watch.lock'))).toBe(false);
  });

  it('removes SIGINT/SIGTERM handlers when the watch is stopped via signal', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(
      realmUrl,
      watchFixture('sigint'),
      'export const x = 1;\n',
    );

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
  });

  it('downgrades a pending modify to a delete when the remote file disappears', async () => {
    let localDir = makeLocalDir();
    await writeRemoteFile(
      realmUrl,
      watchFixture('flip'),
      'export const x = 1;\n',
    );

    let watcher = new RealmWatcher({ realmUrl, localDir }, profileManager, {
      debounceMs: 0,
      quiet: true,
    });
    try {
      await watcher.initialize();
      await watcher.poll();
      await watcher.flushPending();

      await sleep(1100);
      await writeRemoteFile(
        realmUrl,
        watchFixture('flip'),
        'export const x = 2;\n',
      );
      await watcher.poll();
      expect(watcher.pendingCount).toBe(1);

      await deleteRemoteFile(realmUrl, watchFixture('flip'));
      await watcher.poll();

      let result = await watcher.flushPending();
      expect(result.deleted).toContain(watchFixture('flip'));
      expect(result.pulled).not.toContain(watchFixture('flip'));
      expect(fs.existsSync(path.join(localDir, watchFixture('flip')))).toBe(
        false,
      );
    } finally {
      watcher.shutdown();
    }
  });
});
