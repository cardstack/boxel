import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sync } from '../../src/commands/realm/sync';
import { pushCommand } from '../../src/commands/realm/push';
import { createRealm } from '../../src/commands/realm/create';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration';
import type { ProfileManager } from '../../src/lib/profile-manager';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-sync-int-'));
  localDirs.push(dir);
  return dir;
}

function writeLocalFile(localDir: string, relPath: string, content: string) {
  let fullPath = path.join(localDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function readLocalFile(localDir: string, relPath: string): string {
  return fs.readFileSync(path.join(localDir, relPath), 'utf8');
}

function localFileExists(localDir: string, relPath: string): boolean {
  return fs.existsSync(path.join(localDir, relPath));
}

interface SyncManifest {
  realmUrl: string;
  files: Record<string, string>;
  remoteMtimes?: Record<string, number>;
}

function readManifest(localDir: string): SyncManifest {
  return JSON.parse(
    fs.readFileSync(path.join(localDir, '.boxel-sync.json'), 'utf8'),
  );
}

function manifestExists(localDir: string): boolean {
  return fs.existsSync(path.join(localDir, '.boxel-sync.json'));
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

function buildFileUrl(realmUrl: string, relPath: string): string {
  let base = realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`;
  return `${base}${relPath.replace(/^\/+/, '')}`;
}

async function fetchRemoteFile(
  realmUrl: string,
  relPath: string,
): Promise<string> {
  let url = buildFileUrl(realmUrl, relPath);
  let response = await profileManager.authedRealmFetch(url, {
    headers: { Accept: 'application/vnd.card+source' },
  });
  if (!response.ok) {
    throw new Error(
      `Fetching ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

async function remoteFileExists(
  realmUrl: string,
  relPath: string,
): Promise<boolean> {
  let url = buildFileUrl(realmUrl, relPath);
  let response = await profileManager.authedRealmFetch(url, {
    headers: { Accept: 'application/vnd.card+source' },
  });
  return response.ok;
}

// Fetch the realm's `_mtimes` payload as a raw string for diagnostic dumps.
// Returns the body (or the error message) — never throws — so on-failure
// instrumentation can include "what does the realm think exists right now?"
// without risking a secondary failure in the catch path.
async function fetchRemoteMtimesRaw(realmUrl: string): Promise<string> {
  try {
    let base = realmUrl.endsWith('/') ? realmUrl : `${realmUrl}/`;
    let response = await profileManager.authedRealmFetch(`${base}_mtimes`, {
      headers: { Accept: 'application/vnd.api+json' },
    });
    return await response.text();
  } catch (err) {
    return `<fetch error: ${err instanceof Error ? err.message : String(err)}>`;
  }
}

async function writeRemoteFile(
  realmUrl: string,
  relPath: string,
  content: string,
): Promise<void> {
  let url = buildFileUrl(realmUrl, relPath);
  let response = await profileManager.authedRealmFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      Accept: 'application/vnd.card+source',
    },
    body: content,
  });
  if (!response.ok) {
    throw new Error(
      `Write ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
}

async function deleteRemoteFile(
  realmUrl: string,
  relPath: string,
): Promise<void> {
  let url = buildFileUrl(realmUrl, relPath);
  let response = await profileManager.authedRealmFetch(url, {
    method: 'DELETE',
    headers: { Accept: 'application/vnd.card+source' },
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(
      `Delete ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Helper: establish a synced baseline by pushing local files.
// Waits 1s after push so that subsequent remote writes get a different mtime
// (realm server mtimes use second-precision).
async function establishBaseline(
  localDir: string,
  realmUrl: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    writeLocalFile(localDir, relPath, content);
  }
  await pushCommand(localDir, realmUrl, { profileManager });
  await sleep(1100);
}

// Read a remote source file, retrying for up to `timeoutMs` if the body
// doesn't yet contain `expectedSubstring`. Returns the final body either way
// — callers assert on it. `retries` is the number of additional fetches
// performed beyond the first attempt (0 = matched on first read), so
// `retries > 0` is the unambiguous signal that the post-sync read had to
// wait for the realm to settle. `elapsedMs` is for context only; it tracks
// network + sleep, so it is non-zero even on a first-shot success.
async function fetchRemoteFileEventually(
  realmUrl: string,
  relPath: string,
  expectedSubstring: string,
  timeoutMs = 2000,
): Promise<{ body: string; elapsedMs: number; retries: number }> {
  const start = Date.now();
  let attempts = 0;
  let body = '';
  while (Date.now() - start < timeoutMs) {
    attempts++;
    body = await fetchRemoteFile(realmUrl, relPath);
    if (body.includes(expectedSubstring)) {
      return { body, elapsedMs: Date.now() - start, retries: attempts - 1 };
    }
    await sleep(100);
  }
  return { body, elapsedMs: Date.now() - start, retries: attempts - 1 };
}

// Symmetric to fetchRemoteFileEventually for delete-side assertions. Polls
// `remoteFileExists` until it returns false (the expected post-delete state)
// or the timeout elapses. Returns `{ isGone: true, retries: 0 }` when the
// first probe already sees 404; `retries > 0` means the realm needed time
// after sync returned for the DELETE to become visible to a subsequent GET,
// which is the post-write race shape (the realm's DELETE handler responds
// 204 once #adapter.remove returns, but a follow-up GET in the same process
// has been observed to still return 200 for a few tens of ms; cache-
// invalidation echoes, the deferred delete-indexing chain that fires after
// the response, or watcher event reordering are all plausible). `isGone:
// false` with `finalStatus: 200` means it never went away — the DELETE
// didn't take effect. The final-state fields let on-miss diagnostics
// distinguish "DELETE didn't run" from "DELETE ran but visibility lagged".
async function remoteFileGoneEventually(
  realmUrl: string,
  relPath: string,
  timeoutMs = 2000,
): Promise<{
  isGone: boolean;
  elapsedMs: number;
  retries: number;
  finalStatus: number;
  finalBody: string;
}> {
  const start = Date.now();
  let attempts = 0;
  let url = buildFileUrl(realmUrl, relPath);
  let finalStatus = 0;
  let finalBody = '';
  while (Date.now() - start < timeoutMs) {
    attempts++;
    let response = await profileManager.authedRealmFetch(url, {
      headers: { Accept: 'application/vnd.card+source' },
    });
    finalStatus = response.status;
    // Drain the body so the connection can be reused.
    finalBody = await response.text().catch(() => '');
    // Only 404 is the unambiguous "file is gone" signal. Treating every
    // non-OK status as success would silently green-light the assertion on
    // a transient 5xx or an auth glitch and mask a real sync failure
    // (e.g. the DELETE never landed). For any non-404 / non-200 status we
    // keep polling — if the realm is consistently 5xx-ing we'll time out
    // and the diagnostic dump records the final status so the failure
    // mode is attributable.
    if (response.status === 404) {
      return {
        isGone: true,
        elapsedMs: Date.now() - start,
        retries: attempts - 1,
        finalStatus,
        finalBody,
      };
    }
    await sleep(100);
  }
  return {
    isGone: false,
    elapsedMs: Date.now() - start,
    retries: attempts - 1,
    finalStatus,
    finalBody,
  };
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

describe('realm sync (integration)', () => {
  it('pushes local-only files to remote', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const card = true;\n');
    writeLocalFile(localDir, 'data.json', '{"title":"Hello"}\n');

    await sync(localDir, realmUrl, {
      preferLocal: true,
      profileManager,
    });

    expect(await remoteFileExists(realmUrl, 'card.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'data.json')).toBe(true);
    expect(await fetchRemoteFile(realmUrl, 'card.gts')).toContain(
      'card = true',
    );

    expect(manifestExists(localDir)).toBe(true);
    let manifest = readManifest(localDir);
    expect(manifest.realmUrl).toBe(realmUrl);
    expect(Object.keys(manifest.files).sort()).toContain('card.gts');
    expect(Object.keys(manifest.files).sort()).toContain('data.json');
  });

  it('pulls remote-only files to local', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    // Write files directly to remote
    await writeRemoteFile(realmUrl, 'remote-only.gts', 'export const r = 1;\n');

    await sync(localDir, realmUrl, {
      preferRemote: true,
      profileManager,
    });

    expect(localFileExists(localDir, 'remote-only.gts')).toBe(true);
    expect(readLocalFile(localDir, 'remote-only.gts')).toContain('r = 1');
  });

  it('syncs bidirectionally: pushes local changes and pulls remote changes', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    // Establish baseline with two files
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
      'b.gts': 'export const b = 1;\n',
    });

    // Modify a.gts locally, modify b.gts remotely
    writeLocalFile(localDir, 'a.gts', 'export const a = 2;\n');
    await writeRemoteFile(realmUrl, 'b.gts', 'export const b = 2;\n');

    await sync(localDir, realmUrl, { profileManager });

    // a.gts should be pushed (local change)
    expect(await fetchRemoteFile(realmUrl, 'a.gts')).toContain('a = 2');
    // b.gts should be pulled (remote change)
    expect(readLocalFile(localDir, 'b.gts')).toContain('b = 2');
  });

  it('resolves conflict with --prefer-local: local version wins', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'conflict.gts': 'export const v = 1;\n',
    });

    // Modify both sides
    writeLocalFile(localDir, 'conflict.gts', 'export const v = "local";\n');
    await writeRemoteFile(
      realmUrl,
      'conflict.gts',
      'export const v = "remote";\n',
    );

    // Pre-sync snapshot — captures whether each side actually has the
    // content we just wrote. If a future failure shows mismatched state
    // here, the bug is upstream of sync (writeLocalFile / writeRemoteFile
    // didn't land), not in conflict resolution.
    const preLocal = readLocalFile(localDir, 'conflict.gts');
    const preRemote = await fetchRemoteFile(realmUrl, 'conflict.gts');

    await sync(localDir, realmUrl, {
      preferLocal: true,
      profileManager,
    });

    // Poll-retry to distinguish "sync didn't push" from "push landed but a
    // brief visibility race made the GET read stale bytes". `retries > 0`
    // on a passing assertion points at the latter; a miss with retries
    // exhausted means the bytes never settled within the timeout.
    const {
      body: remoteAfter,
      elapsedMs,
      retries,
    } = await fetchRemoteFileEventually(
      realmUrl,
      'conflict.gts',
      'v = "local"',
    );
    const localAfter = readLocalFile(localDir, 'conflict.gts');

    if (!remoteAfter.includes('v = "local"')) {
      console.error(
        `[conflict-prefer-local diagnostics] preLocal=${JSON.stringify(preLocal)} ` +
          `preRemote=${JSON.stringify(preRemote)} ` +
          `localAfter=${JSON.stringify(localAfter)} ` +
          `remoteAfter=${JSON.stringify(remoteAfter)} ` +
          `retries=${retries} elapsedMs=${elapsedMs} realmUrl=${realmUrl}`,
      );
    }

    expect(remoteAfter).toContain('v = "local"');
    expect(localAfter).toContain('v = "local"');
  });

  it('resolves conflict with --prefer-remote: remote version wins', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'conflict.gts': 'export const v = 1;\n',
    });

    // Modify both sides
    writeLocalFile(localDir, 'conflict.gts', 'export const v = "local";\n');
    await writeRemoteFile(
      realmUrl,
      'conflict.gts',
      'export const v = "remote";\n',
    );

    const preLocal = readLocalFile(localDir, 'conflict.gts');
    const preRemote = await fetchRemoteFile(realmUrl, 'conflict.gts');

    await sync(localDir, realmUrl, {
      preferRemote: true,
      profileManager,
    });

    // For prefer-remote the local file is overwritten by the pulled
    // remote bytes. The local-side read is a direct fs read with no
    // visibility race, so no retry helper is needed — but the diagnostic
    // dump on miss mirrors the prefer-local test so a regression on
    // either side surfaces the same shape of evidence.
    const localAfter = readLocalFile(localDir, 'conflict.gts');
    const remoteAfter = await fetchRemoteFile(realmUrl, 'conflict.gts');

    if (!localAfter.includes('v = "remote"')) {
      console.error(
        `[conflict-prefer-remote diagnostics] preLocal=${JSON.stringify(preLocal)} ` +
          `preRemote=${JSON.stringify(preRemote)} ` +
          `localAfter=${JSON.stringify(localAfter)} ` +
          `remoteAfter=${JSON.stringify(remoteAfter)} ` +
          `realmUrl=${realmUrl}`,
      );
    }

    expect(localAfter).toContain('v = "remote"');
  });

  it('deletes remote file when local is deleted with --prefer-local', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'to-delete.gts': 'export const d = 1;\n',
      'keep.gts': 'export const k = 1;\n',
    });

    // Delete locally
    fs.unlinkSync(path.join(localDir, 'to-delete.gts'));

    await sync(localDir, realmUrl, {
      preferLocal: true,
      profileManager,
    });

    expect(await remoteFileExists(realmUrl, 'to-delete.gts')).toBe(false);
    expect(await remoteFileExists(realmUrl, 'keep.gts')).toBe(true);
  });

  it('deletes local file when remote is deleted with --prefer-remote', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'to-delete.gts': 'export const d = 1;\n',
      'keep.gts': 'export const k = 1;\n',
    });

    // Delete remotely
    await deleteRemoteFile(realmUrl, 'to-delete.gts');

    await sync(localDir, realmUrl, {
      preferRemote: true,
      profileManager,
    });

    expect(localFileExists(localDir, 'to-delete.gts')).toBe(false);
    expect(localFileExists(localDir, 'keep.gts')).toBe(true);
  });

  it('syncs deletions both ways with --delete', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'local-del.gts': 'export const ld = 1;\n',
      'remote-del.gts': 'export const rd = 1;\n',
      'keep.gts': 'export const k = 1;\n',
    });

    // Delete local-del locally, remote-del remotely
    fs.unlinkSync(path.join(localDir, 'local-del.gts'));
    await deleteRemoteFile(realmUrl, 'remote-del.gts');

    await sync(localDir, realmUrl, {
      delete: true,
      profileManager,
    });

    // local-del should be deleted from remote
    expect(await remoteFileExists(realmUrl, 'local-del.gts')).toBe(false);
    // remote-del should be deleted from local
    expect(localFileExists(localDir, 'remote-del.gts')).toBe(false);
    // keep should remain
    expect(await remoteFileExists(realmUrl, 'keep.gts')).toBe(true);
    expect(localFileExists(localDir, 'keep.gts')).toBe(true);
  });

  it('dry-run makes no changes', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'local-only.gts', 'export const lo = 1;\n');
    await writeRemoteFile(
      realmUrl,
      'remote-only.gts',
      'export const ro = 1;\n',
    );

    await sync(localDir, realmUrl, {
      preferLocal: true,
      dryRun: true,
      profileManager,
    });

    // Nothing should have changed
    expect(await remoteFileExists(realmUrl, 'local-only.gts')).toBe(false);
    expect(localFileExists(localDir, 'remote-only.gts')).toBe(false);
    expect(manifestExists(localDir)).toBe(false);
  });

  it('manifest is updated correctly after bidirectional sync', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
      'b.gts': 'export const b = 1;\n',
    });

    let oldManifest = readManifest(localDir);
    let oldHashA = oldManifest.files['a.gts'];
    let oldHashB = oldManifest.files['b.gts'];

    // Modify a locally, b remotely
    writeLocalFile(localDir, 'a.gts', 'export const a = 2;\n');
    await writeRemoteFile(realmUrl, 'b.gts', 'export const b = 2;\n');

    await sync(localDir, realmUrl, { profileManager });

    let newManifest = readManifest(localDir);
    // Both hashes should have changed
    expect(newManifest.files['a.gts']).not.toBe(oldHashA);
    expect(newManifest.files['b.gts']).not.toBe(oldHashB);
    // Both should have valid hashes
    expect(newManifest.files['a.gts']).toMatch(/^[0-9a-f]{32}$/);
    expect(newManifest.files['b.gts']).toMatch(/^[0-9a-f]{32}$/);
    // remoteMtimes should be present
    expect(newManifest.remoteMtimes).toBeDefined();
    expect(typeof newManifest.remoteMtimes!['a.gts']).toBe('number');
    expect(typeof newManifest.remoteMtimes!['b.gts']).toBe('number');
  });

  it('incremental sync is a no-op when nothing changed', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'stable.gts': 'export const s = 1;\n',
    });

    // First sync to pull any realm-default files (e.g. index.json) and stabilize
    await sync(localDir, realmUrl, { profileManager });

    let cm = new CheckpointManager(localDir);
    let before = await cm.getCheckpoints();

    // Sync again with no changes
    await sync(localDir, realmUrl, { profileManager });

    let after = await cm.getCheckpoints();
    // No new checkpoint should be created
    expect(after.length).toBe(before.length);
  });

  it('protected files (.realm.json) are never synced', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, '.realm.json', '{"name":"hacked"}\n');
    writeLocalFile(localDir, 'normal.gts', 'export const n = 1;\n');

    await sync(localDir, realmUrl, {
      preferLocal: true,
      profileManager,
    });

    // .realm.json should not appear in manifest
    let manifest = readManifest(localDir);
    expect(manifest.files['.realm.json']).toBeUndefined();
  });

  it('creates checkpoint after sync with changes', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'new-file.gts', 'export const nf = 1;\n');

    await sync(localDir, realmUrl, {
      preferLocal: true,
      profileManager,
    });

    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBeGreaterThanOrEqual(1);
  });

  it('first sync with overlapping files resolves with --prefer-local', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    // Write same-named file to both sides without a prior sync
    writeLocalFile(localDir, 'overlap.gts', 'export const v = "local";\n');
    await writeRemoteFile(
      realmUrl,
      'overlap.gts',
      'export const v = "remote";\n',
    );

    await sync(localDir, realmUrl, {
      preferLocal: true,
      profileManager,
    });

    // Local should win
    expect(await fetchRemoteFile(realmUrl, 'overlap.gts')).toContain(
      'v = "local"',
    );
  });

  it('delete-vs-change conflict with --prefer-local deletes remote', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'dvc.gts': 'export const dvc = 1;\n',
    });

    // Delete locally, modify remotely. Snapshot the local + remote state
    // before sync so the diagnostic dump on a future failure proves whether
    // the conflict setup actually landed (rather than guessing whether
    // `fs.unlinkSync` / `writeRemoteFile` were the failure point).
    fs.unlinkSync(path.join(localDir, 'dvc.gts'));
    await writeRemoteFile(realmUrl, 'dvc.gts', 'export const dvc = 2;\n');
    let preSyncLocalExists = localFileExists(localDir, 'dvc.gts');
    let preSyncRemote = await fetchRemoteFile(realmUrl, 'dvc.gts');

    await sync(localDir, realmUrl, {
      preferLocal: true,
      profileManager,
    });

    // Local delete wins - remote should be gone. Poll up to 2s rather than
    // a single immediate read: the realm's DELETE handler is observed in
    // CI to return 204 ~50ms before a follow-up GET stops returning 200
    // (deferred delete-indexing chain still settling, watcher echoes, or
    // an in-process cache-invalidation race are all plausible — see the
    // PR description). `retries > 0` after a successful poll proves the
    // delete eventually became visible (a brief post-write visibility
    // race that the sync caller doesn't need to care about); a timeout
    // dumps every relevant state snapshot so the next CI failure has
    // enough signal to attribute root cause without re-running.
    let result = await remoteFileGoneEventually(realmUrl, 'dvc.gts');
    if (!result.isGone) {
      let postCheckMtimes = await fetchRemoteMtimesRaw(realmUrl);
      console.error(
        `[delete-vs-change diagnostic] dvc.gts still present ${result.elapsedMs}ms after sync (${result.retries} retries, final status ${result.finalStatus}); ` +
          `preSyncLocalExists=${preSyncLocalExists}, ` +
          `preSyncRemoteBody=${JSON.stringify(preSyncRemote)}, ` +
          `postCheckRemoteBody=${JSON.stringify(result.finalBody)}, ` +
          `postCheckMtimesIncludesDvc=${postCheckMtimes.includes('dvc.gts')}, ` +
          `realmUrl=${realmUrl}`,
      );
    }
    expect(result.isGone).toBe(true);
  });

  it('change-vs-delete conflict with --prefer-remote deletes local', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    await establishBaseline(localDir, realmUrl, {
      'cvd.gts': 'export const cvd = 1;\n',
    });

    // Modify locally, delete remotely
    writeLocalFile(localDir, 'cvd.gts', 'export const cvd = 2;\n');
    await deleteRemoteFile(realmUrl, 'cvd.gts');

    await sync(localDir, realmUrl, {
      preferRemote: true,
      profileManager,
    });

    // Remote delete wins - local should be gone
    expect(localFileExists(localDir, 'cvd.gts')).toBe(false);
  });
});
