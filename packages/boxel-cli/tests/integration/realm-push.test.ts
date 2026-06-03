import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
import {
  TINY_PNG_BYTES,
  TINY_PDF_BYTES,
  TINY_MP3_BYTES,
} from '../helpers/binary-fixtures';
import type { ProfileManager } from '../../src/lib/profile-manager';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-push-int-'));
  localDirs.push(dir);
  return dir;
}

function writeLocalFile(localDir: string, relPath: string, content: string) {
  let fullPath = path.join(localDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function writeLocalBytes(localDir: string, relPath: string, bytes: Uint8Array) {
  let fullPath = path.join(localDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, bytes);
}

async function fetchRemoteBytes(
  realmUrl: string,
  relPath: string,
): Promise<Buffer> {
  let url = buildFileUrl(realmUrl, relPath);
  let response = await profileManager.authedRealmFetch(url, {
    headers: { Accept: 'application/vnd.card+source' },
  });
  if (!response.ok) {
    throw new Error(
      `Fetching ${url} failed: ${response.status} ${response.statusText}`,
    );
  }
  return Buffer.from(await response.arrayBuffer());
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

// Create a fresh realm and return its URL
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

// Hit the realm file endpoint directly to verify a file's contents.
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

// Simulate an out-of-band actor modifying the realm state directly.
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

describe('realm push (integration)', () => {
  it('pushes local files to realm', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const card = true;\n');
    writeLocalFile(localDir, 'data.json', '{"title":"Hello"}\n');

    await pushCommand(localDir, realmUrl, { profileManager });

    // Manifest assertions
    expect(manifestExists(localDir)).toBe(true);
    let manifest = readManifest(localDir);
    expect(manifest.realmUrl).toBe(realmUrl);
    expect(Object.keys(manifest.files).sort()).toEqual([
      'card.gts',
      'data.json',
    ]);
    for (let hash of Object.values(manifest.files)) {
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(manifest.files['.boxel-sync.json']).toBeUndefined();

    // Verify file presence and content directly via the realm endpoints
    expect(await remoteFileExists(realmUrl, 'card.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'data.json')).toBe(true);
    expect(await fetchRemoteFile(realmUrl, 'card.gts')).toContain(
      'card = true',
    );
    expect(await fetchRemoteFile(realmUrl, 'data.json')).toContain(
      '"title":"Hello"',
    );

    // Checkpoint assertions
    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].source).toBe('local');
    expect(checkpoints[0].message).toContain('2 files');
    expect(checkpoints[0].message).toContain('~2');
  });

  it('incremental push skips unchanged files and only checkpoints the changed one', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'a.gts', 'export const a = 1;\n');
    writeLocalFile(localDir, 'b.gts', 'export const b = 2;\n');

    await pushCommand(localDir, realmUrl, { profileManager });
    let manifestAfterFirst = readManifest(localDir);
    let bHashFirst = manifestAfterFirst.files['b.gts'];
    let aHashFirst = manifestAfterFirst.files['a.gts'];

    let cm = new CheckpointManager(localDir);
    expect((await cm.getCheckpoints()).length).toBe(1);

    // Modify only one file
    writeLocalFile(localDir, 'a.gts', 'export const a = 999;\n');

    await pushCommand(localDir, realmUrl, { profileManager });
    let manifestAfterSecond = readManifest(localDir);

    expect(await fetchRemoteFile(realmUrl, 'a.gts')).toContain('a = 999');
    expect(await fetchRemoteFile(realmUrl, 'b.gts')).toContain('b = 2');

    // Manifest assertions: a's hash changes, b's stays the same
    expect(manifestAfterSecond.files['a.gts']).not.toBe(aHashFirst);
    expect(manifestAfterSecond.files['b.gts']).toBe(bHashFirst);

    // A second checkpoint mentioning only a.gts
    let afterSecond = await cm.getCheckpoints();
    expect(afterSecond.length).toBe(2);
    expect(afterSecond[0].message).toContain('a.gts');
    expect(afterSecond[0].message).not.toContain('b.gts');
  });

  it('re-pushing with no local changes adds no new checkpoint and leaves manifest byte-identical', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'noop.gts', 'export const noop = true;\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    let manifestBefore = fs.readFileSync(
      path.join(localDir, '.boxel-sync.json'),
      'utf8',
    );

    let cm = new CheckpointManager(localDir);
    let baseline = (await cm.getCheckpoints()).length;

    await pushCommand(localDir, realmUrl, { profileManager });

    let manifestAfter = fs.readFileSync(
      path.join(localDir, '.boxel-sync.json'),
      'utf8',
    );
    expect(manifestAfter).toBe(manifestBefore);
    expect((await cm.getCheckpoints()).length).toBe(baseline);
  });

  it('push with --force uploads all files but does not duplicate checkpoint when content is unchanged', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'file.gts', 'export const v = 1;\n');

    await pushCommand(localDir, realmUrl, { profileManager });
    let manifestAfterFirst = readManifest(localDir);

    await pushCommand(localDir, realmUrl, { force: true, profileManager });
    let manifestAfterForce = readManifest(localDir);

    expect(await remoteFileExists(realmUrl, 'file.gts')).toBe(true);

    // Manifest hash equals freshly recomputed hash (file content unchanged
    // so the hash must match the first push exactly)
    expect(manifestAfterForce.files['file.gts']).toBe(
      manifestAfterFirst.files['file.gts'],
    );

    // Force re-uploads bytes to the server, but CheckpointManager only
    // records a commit when the workspace state differs from the previous
    // checkpoint. Identical content → no second checkpoint.
    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].source).toBe('local');
  });

  it('push with --force creates a new checkpoint when content has actually changed', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'file.gts', 'export const v = 1;\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    writeLocalFile(localDir, 'file.gts', 'export const v = 2;\n');
    await pushCommand(localDir, realmUrl, { force: true, profileManager });

    expect(await fetchRemoteFile(realmUrl, 'file.gts')).toContain('v = 2');

    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBe(2);
    expect(checkpoints.every((c) => c.source === 'local')).toBe(true);
  });

  it('push with --delete removes remote-only files (delete alone does not checkpoint)', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'keep.gts', 'export const keep = true;\n');
    writeLocalFile(localDir, 'remove.gts', 'export const remove = true;\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    let cm = new CheckpointManager(localDir);
    let baseline = (await cm.getCheckpoints()).length;

    fs.unlinkSync(path.join(localDir, 'remove.gts'));
    await pushCommand(localDir, realmUrl, { delete: true, profileManager });

    expect(await remoteFileExists(realmUrl, 'keep.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'remove.gts')).toBe(false);

    // Manifest no longer lists the removed file
    let manifest = readManifest(localDir);
    expect(manifest.files['keep.gts']).toBeDefined();
    expect(manifest.files['remove.gts']).toBeUndefined();

    // Push only writes a checkpoint when files were uploaded; a delete-only
    // second push does not bump the checkpoint count.
    expect((await cm.getCheckpoints()).length).toBe(baseline);
  });

  it('push with --dry-run makes no changes and writes no manifest or checkpoint', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'draft.gts', 'export const draft = true;\n');

    await pushCommand(localDir, realmUrl, { dryRun: true, profileManager });

    expect(manifestExists(localDir)).toBe(false);
    expect(await remoteFileExists(realmUrl, 'draft.gts')).toBe(false);

    let cm = new CheckpointManager(localDir);
    expect(await cm.isInitialized()).toBe(false);
    expect(await cm.getCheckpoints()).toEqual([]);
  });

  it('push ignores .boxel-sync.json (does not upload it to the realm)', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const card = true;\n');
    writeLocalFile(
      localDir,
      '.boxel-sync.json',
      '{"realmUrl":"old","files":{}}',
    );

    await pushCommand(localDir, realmUrl, { profileManager });

    expect(await remoteFileExists(realmUrl, 'card.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, '.boxel-sync.json')).toBe(false);

    let manifest = readManifest(localDir);
    expect(manifest.files['.boxel-sync.json']).toBeUndefined();
  });

  it('respects .boxelignore patterns', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, '.boxelignore', '*.ignore\nignore-dir/\n');
    writeLocalFile(localDir, 'card.gts', 'export const card = true;\n');
    writeLocalFile(localDir, 'test.ignore', 'should not be uploaded');
    writeLocalFile(localDir, 'ignore-dir/ignored.json', '{"ignored":true}\n');

    await pushCommand(localDir, realmUrl, { profileManager });

    // Non-ignored file is uploaded
    expect(await remoteFileExists(realmUrl, 'card.gts')).toBe(true);
    // Files matching .boxelignore patterns are not uploaded
    expect(await remoteFileExists(realmUrl, 'test.ignore')).toBe(false);
    expect(await remoteFileExists(realmUrl, 'ignore-dir/ignored.json')).toBe(
      false,
    );
    // The .boxelignore file itself is also not uploaded (dotfile rule)
    expect(await remoteFileExists(realmUrl, '.boxelignore')).toBe(false);

    let manifest = readManifest(localDir);
    expect(Object.keys(manifest.files).sort()).toEqual(['card.gts']);
  });

  it('pushes nested subdirectories recursively', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'top.gts', 'export const top = 1;\n');
    writeLocalFile(localDir, 'a/inner.gts', 'export const inner = 2;\n');
    writeLocalFile(localDir, 'a/b/deep.gts', 'export const deep = 3;\n');

    await pushCommand(localDir, realmUrl, { profileManager });

    expect(await remoteFileExists(realmUrl, 'top.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'a/inner.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'a/b/deep.gts')).toBe(true);
    expect(await fetchRemoteFile(realmUrl, 'a/b/deep.gts')).toContain(
      'deep = 3',
    );
    expect(await fetchRemoteFile(realmUrl, 'a/inner.gts')).toContain(
      'inner = 2',
    );

    let manifest = readManifest(localDir);
    expect(Object.keys(manifest.files).sort()).toEqual([
      'a/b/deep.gts',
      'a/inner.gts',
      'top.gts',
    ]);
  });

  it('does not upload dotfiles even if present locally', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const card = true;\n');
    // .gitkeep stands in for any local dotfile a workspace might carry;
    // sync ignores anything starting with `.` (see shouldIgnoreFile in
    // realm-sync-base).
    writeLocalFile(localDir, '.gitkeep', 'locally-edited-marker');

    await pushCommand(localDir, realmUrl, { profileManager });

    expect(await remoteFileExists(realmUrl, 'card.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, '.gitkeep')).toBe(false);

    let manifest = readManifest(localDir);
    expect(manifest.files['.gitkeep']).toBeUndefined();
  });

  // --- Flag-combination scenarios ---

  it('--force --dry-run: force does not bypass dry-run', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'forced.gts', 'export const forced = true;\n');

    await pushCommand(localDir, realmUrl, {
      force: true,
      dryRun: true,
      profileManager,
    });

    expect(manifestExists(localDir)).toBe(false);
    expect(await remoteFileExists(realmUrl, 'forced.gts')).toBe(false);

    let cm = new CheckpointManager(localDir);
    expect(await cm.isInitialized()).toBe(false);
  });

  it('--delete --dry-run: stale remote files are not removed and manifest is unchanged', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'a.gts', 'export const a = 1;\n');
    writeLocalFile(localDir, 'b.gts', 'export const b = 2;\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    let manifestBefore = fs.readFileSync(
      path.join(localDir, '.boxel-sync.json'),
      'utf8',
    );
    let cm = new CheckpointManager(localDir);
    let baseline = (await cm.getCheckpoints()).length;

    fs.unlinkSync(path.join(localDir, 'b.gts'));
    await pushCommand(localDir, realmUrl, {
      delete: true,
      dryRun: true,
      profileManager,
    });

    expect(await remoteFileExists(realmUrl, 'a.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'b.gts')).toBe(true);

    let manifestAfter = fs.readFileSync(
      path.join(localDir, '.boxel-sync.json'),
      'utf8',
    );
    expect(manifestAfter).toBe(manifestBefore);
    expect((await cm.getCheckpoints()).length).toBe(baseline);
  });

  it('--force --delete: re-uploads everything locally and removes remote-only files', async () => {
    let realmUrl = await createTestRealm();
    let dirA = makeLocalDir();
    let dirB = makeLocalDir();

    // dirA has a.gts and b.gts
    writeLocalFile(dirA, 'a.gts', 'export const a = 1;\n');
    writeLocalFile(dirA, 'b.gts', 'export const b = 2;\n');
    await pushCommand(dirA, realmUrl, { profileManager });

    // Out-of-band: dirB pushes c.gts to the same realm
    writeLocalFile(dirB, 'c.gts', 'export const c = 3;\n');
    await pushCommand(dirB, realmUrl, { profileManager });

    expect(await remoteFileExists(realmUrl, 'c.gts')).toBe(true);

    let cmA = new CheckpointManager(dirA);
    let baselineA = (await cmA.getCheckpoints()).length;

    // Now push from dirA with both flags
    await pushCommand(dirA, realmUrl, {
      force: true,
      delete: true,
      profileManager,
    });

    expect(await remoteFileExists(realmUrl, 'a.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'b.gts')).toBe(true);
    // c.gts was on the realm but not in dirA: --delete removes it
    expect(await remoteFileExists(realmUrl, 'c.gts')).toBe(false);

    // dirA's manifest still tracks only a and b
    let manifest = readManifest(dirA);
    expect(Object.keys(manifest.files).sort()).toEqual(['a.gts', 'b.gts']);

    // Force re-uploaded the bytes but the local workspace state is
    // unchanged from dirA's previous checkpoint, so CheckpointManager does
    // not record a new commit. Delete-only operations also do not
    // checkpoint. Net: no checkpoint count change.
    expect((await cmA.getCheckpoints()).length).toBe(baselineA);
  });

  it('--force --delete --dry-run: all three flags together still mutate nothing', async () => {
    let realmUrl = await createTestRealm();
    let dirA = makeLocalDir();
    let dirB = makeLocalDir();

    writeLocalFile(dirA, 'a.gts', 'export const a = 1;\n');
    writeLocalFile(dirA, 'b.gts', 'export const b = 2;\n');
    await pushCommand(dirA, realmUrl, { profileManager });

    writeLocalFile(dirB, 'c.gts', 'export const c = 3;\n');
    await pushCommand(dirB, realmUrl, { profileManager });

    let manifestBefore = fs.readFileSync(
      path.join(dirA, '.boxel-sync.json'),
      'utf8',
    );
    let cmA = new CheckpointManager(dirA);
    let baselineA = (await cmA.getCheckpoints()).length;

    await pushCommand(dirA, realmUrl, {
      force: true,
      delete: true,
      dryRun: true,
      profileManager,
    });

    // Out-of-band file remains on the server
    expect(await remoteFileExists(realmUrl, 'c.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'a.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'b.gts')).toBe(true);

    let manifestAfter = fs.readFileSync(
      path.join(dirA, '.boxel-sync.json'),
      'utf8',
    );
    expect(manifestAfter).toBe(manifestBefore);
    expect((await cmA.getCheckpoints()).length).toBe(baselineA);
  });

  // --- Drift detection, atomic batching, and schema validation ---

  it('sends all uploads in a single /_atomic request', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'a.gts', 'export const a = 1;\n');
    writeLocalFile(localDir, 'b.gts', 'export const b = 2;\n');
    writeLocalFile(localDir, 'c.gts', 'export const c = 3;\n');

    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    let atomicCalls: typeof fetchSpy.mock.calls;
    try {
      await pushCommand(localDir, realmUrl, { profileManager });
      // Read mock.calls BEFORE mockRestore, which clears call history.
      atomicCalls = fetchSpy.mock.calls.filter(([input, init]) => {
        let url = typeof input === 'string' ? input : (input as URL).href;
        return url.endsWith('/_atomic') && init?.method === 'POST';
      });
    } finally {
      fetchSpy.mockRestore();
    }
    expect(atomicCalls.length).toBe(1);

    // All three files landed on the server
    expect(await remoteFileExists(realmUrl, 'a.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'b.gts')).toBe(true);
    expect(await remoteFileExists(realmUrl, 'c.gts')).toBe(true);
  });

  it('re-pushes a file that was deleted on the realm out-of-band', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'f.gts', 'export const f = 1;\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    await deleteRemoteFile(realmUrl, 'f.gts');
    expect(await remoteFileExists(realmUrl, 'f.gts')).toBe(false);

    let cm = new CheckpointManager(localDir);
    let baseline = (await cm.getCheckpoints()).length;

    let warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let warnedAboutFile = false;
    try {
      await pushCommand(localDir, realmUrl, { profileManager });
      warnedAboutFile = warnSpy.mock.calls
        .map((args) => args.join(' '))
        .some((msg) => msg.includes('f.gts'));
    } finally {
      warnSpy.mockRestore();
    }

    // Drift detection re-uploads the file.
    expect(await remoteFileExists(realmUrl, 'f.gts')).toBe(true);
    expect(await fetchRemoteFile(realmUrl, 'f.gts')).toContain('f = 1');

    // Local workspace state is unchanged, so CheckpointManager does not
    // record a new git commit.
    expect((await cm.getCheckpoints()).length).toBe(baseline);

    // The user sees a warning naming the drifted file.
    expect(warnedAboutFile).toBe(true);
  });

  it('re-pushes a file that was edited on the realm out-of-band', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'f.gts', 'export const f = "local";\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    // Overwrite the realm copy directly. The server records mtimes with
    // second resolution, so wait > 1s to guarantee a strictly newer mtime.
    await new Promise((r) => setTimeout(r, 1100));
    await writeRemoteFile(realmUrl, 'f.gts', 'export const f = "rival";\n');
    expect(await fetchRemoteFile(realmUrl, 'f.gts')).toContain('"rival"');

    let cm = new CheckpointManager(localDir);
    let baseline = (await cm.getCheckpoints()).length;

    let warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let warnedAboutFile = false;
    try {
      await pushCommand(localDir, realmUrl, { profileManager });
      warnedAboutFile = warnSpy.mock.calls
        .map((args) => args.join(' '))
        .some((msg) => msg.includes('f.gts'));
    } finally {
      warnSpy.mockRestore();
    }

    // Drift detection re-asserted local content.
    expect(await fetchRemoteFile(realmUrl, 'f.gts')).toContain('"local"');

    // Local workspace is unchanged, so no new checkpoint.
    expect((await cm.getCheckpoints()).length).toBe(baseline);

    expect(warnedAboutFile).toBe(true);
  });

  it('recovers from a malformed .boxel-sync.json instead of crashing', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const card = 1;\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    // Corrupt the manifest: parseable JSON but `files` is null — the
    // old code would crash in the incremental branch when it tried to
    // read `manifest.files[rel]`.
    fs.writeFileSync(
      path.join(localDir, '.boxel-sync.json'),
      JSON.stringify({ realmUrl, files: null }),
    );

    // Edit the local file so we have something to upload on the retry
    writeLocalFile(localDir, 'card.gts', 'export const card = 2;\n');

    // Should not throw
    await pushCommand(localDir, realmUrl, { profileManager });

    expect(await fetchRemoteFile(realmUrl, 'card.gts')).toContain('card = 2');

    // Manifest was rebuilt with a real files map
    let manifest = readManifest(localDir);
    expect(typeof manifest.files).toBe('object');
    expect(manifest.files['card.gts']).toMatch(/^[0-9a-f]{32}$/);
  });

  // --- Binary file uploads (CS-11075) ---

  it('pushes a PNG file and reads it back byte-identical', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalBytes(localDir, 'image.png', TINY_PNG_BYTES);

    await pushCommand(localDir, realmUrl, { profileManager });

    let remote = await fetchRemoteBytes(realmUrl, 'image.png');
    expect(remote.equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);

    let manifest = readManifest(localDir);
    expect(manifest.files['image.png']).toMatch(/^[0-9a-f]{32}$/);
  });

  it('pushes a PDF file byte-identically', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalBytes(localDir, 'doc.pdf', TINY_PDF_BYTES);

    await pushCommand(localDir, realmUrl, { profileManager });

    let remote = await fetchRemoteBytes(realmUrl, 'doc.pdf');
    expect(remote.equals(Buffer.from(TINY_PDF_BYTES))).toBe(true);
  });

  it('pushes an MP3 file byte-identically', async () => {
    // Audio files are binary; if `isBinaryFilename` missed `audio/*`,
    // the bytes would be UTF-8 round-tripped and corrupted on the wire.
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalBytes(localDir, 'sample.mp3', TINY_MP3_BYTES);

    await pushCommand(localDir, realmUrl, { profileManager });

    let remote = await fetchRemoteBytes(realmUrl, 'sample.mp3');
    expect(remote.equals(Buffer.from(TINY_MP3_BYTES))).toBe(true);
  });

  it('mixed batch carves binary out of /_atomic but lands every file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const c = 1;\n');
    writeLocalFile(localDir, 'data.json', '{"x":1}\n');
    writeLocalBytes(localDir, 'image.png', TINY_PNG_BYTES);
    writeLocalBytes(localDir, 'doc.pdf', TINY_PDF_BYTES);

    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    let atomicCalls: typeof fetchSpy.mock.calls;
    let octetCalls: typeof fetchSpy.mock.calls;
    try {
      await pushCommand(localDir, realmUrl, { profileManager });
      atomicCalls = fetchSpy.mock.calls.filter(([input, init]) => {
        let url = typeof input === 'string' ? input : (input as URL).href;
        return url.endsWith('/_atomic') && init?.method === 'POST';
      });
      octetCalls = fetchSpy.mock.calls.filter(([, init]) => {
        let contentType =
          (init?.headers as Record<string, string> | undefined)?.[
            'Content-Type'
          ] ?? '';
        return (
          init?.method === 'POST' && contentType === 'application/octet-stream'
        );
      });
    } finally {
      fetchSpy.mockRestore();
    }

    expect(atomicCalls.length).toBe(1);
    // One octet-stream POST per binary file (image.png, doc.pdf).
    expect(octetCalls.length).toBe(2);

    // Every file landed byte-identical on the server
    expect(await fetchRemoteFile(realmUrl, 'card.gts')).toContain('c = 1');
    expect(await fetchRemoteFile(realmUrl, 'data.json')).toContain('"x":1');
    expect(
      (await fetchRemoteBytes(realmUrl, 'image.png')).equals(
        Buffer.from(TINY_PNG_BYTES),
      ),
    ).toBe(true);
    expect(
      (await fetchRemoteBytes(realmUrl, 'doc.pdf')).equals(
        Buffer.from(TINY_PDF_BYTES),
      ),
    ).toBe(true);

    // Manifest tracks all four files
    let manifest = readManifest(localDir);
    expect(Object.keys(manifest.files).sort()).toEqual([
      'card.gts',
      'data.json',
      'doc.pdf',
      'image.png',
    ]);
  });

  it('records text successes in manifest when binary partially fails', async () => {
    // Mixed batch where the per-file binary POST fails (stubbed 413)
    // while the atomic text batch lands. The manifest must still
    // record the text file that the server actually wrote — otherwise
    // the next push sees it as missing-from-manifest and tries to
    // re-add it, hitting a 409 against the existing remote.
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const c = 1;\n');
    writeLocalBytes(localDir, 'image.png', TINY_PNG_BYTES);

    let realFetch = profileManager.authedRealmFetch.bind(profileManager);
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmFetch')
      .mockImplementation(async (input, init) => {
        let url = typeof input === 'string' ? input : (input as URL).href;
        let contentType =
          (init?.headers as Record<string, string> | undefined)?.[
            'Content-Type'
          ] ?? '';
        if (
          init?.method === 'POST' &&
          contentType === 'application/octet-stream' &&
          url.endsWith('/image.png')
        ) {
          return new Response('Payload Too Large', {
            status: 413,
            statusText: 'Payload Too Large',
          });
        }
        return realFetch(input, init);
      });

    // pushCommand exits 2 on any upload error; intercept so the test
    // can observe state instead of being terminated.
    let exitCode: number | undefined;
    let exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      if (exitCode === undefined) exitCode = code;
      return undefined as never;
    }) as never);

    try {
      await pushCommand(localDir, realmUrl, { profileManager });
    } finally {
      fetchSpy.mockRestore();
      exitSpy.mockRestore();
    }
    expect(exitCode).toBe(2);

    // The text file landed
    expect(await fetchRemoteFile(realmUrl, 'card.gts')).toContain('c = 1');

    // The manifest records the text success even though the binary failed
    let manifest = readManifest(localDir);
    expect(manifest.files['card.gts']).toMatch(/^[0-9a-f]{32}$/);
    expect(manifest.files['image.png']).toBeUndefined();
  });

  it('treats SVG as text — round-trips through /_atomic without corruption', async () => {
    // SVG is XML, so isBinaryFilename returns false. Confirm it still
    // rides the atomic batch path and comes back exactly.
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    let svg = '<svg xmlns="http://www.w3.org/2000/svg"><circle r="1"/></svg>';
    writeLocalFile(localDir, 'icon.svg', svg);

    let fetchSpy = vi.spyOn(profileManager, 'authedRealmFetch');
    let octetCount: number;
    try {
      await pushCommand(localDir, realmUrl, { profileManager });
      octetCount = fetchSpy.mock.calls.filter(([, init]) => {
        let ct =
          (init?.headers as Record<string, string> | undefined)?.[
            'Content-Type'
          ] ?? '';
        return ct === 'application/octet-stream';
      }).length;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(octetCount).toBe(0);
    expect(await fetchRemoteFile(realmUrl, 'icon.svg')).toBe(svg);
  });

  it('fails cleanly when an out-of-band create causes an atomic 409', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    // Establish a manifest first so the incremental/intent-based path
    // kicks in on the next push.
    writeLocalFile(localDir, 'baseline.gts', 'export const b = 1;\n');
    await pushCommand(localDir, realmUrl, { profileManager });
    let manifestBefore = fs.readFileSync(
      path.join(localDir, '.boxel-sync.json'),
      'utf8',
    );

    // Stage a brand-new local file that is NOT in our manifest, and
    // plant a rival copy on the realm so our `op: add` will collide.
    writeLocalFile(localDir, 'rival.gts', 'export const n = "local";\n');
    await writeRemoteFile(realmUrl, 'rival.gts', 'export const n = "rival";\n');

    let errMessages: string[] = [];
    let errSpy = vi
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        errMessages.push(args.join(' '));
      });
    let exitCode: number | undefined;
    let exitSpy = vi.spyOn(process, 'exit').mockImplementation(((
      code?: number,
    ) => {
      if (exitCode === undefined) exitCode = code;
      return undefined as never;
    }) as never);
    try {
      await pushCommand(localDir, realmUrl, { profileManager });
    } finally {
      errSpy.mockRestore();
      exitSpy.mockRestore();
    }
    expect(exitCode).toBe(2);

    // Realm still has the rival content — atomic batch was rejected
    // with 409 before any write happened.
    expect(await fetchRemoteFile(realmUrl, 'rival.gts')).toContain('"rival"');

    // Manifest was NOT overwritten (still reflects the pre-conflict state)
    let manifestAfter = fs.readFileSync(
      path.join(localDir, '.boxel-sync.json'),
      'utf8',
    );
    expect(manifestAfter).toBe(manifestBefore);

    // Error output mentions the conflict with a useful hint
    let errOutput = errMessages.join('\n');
    expect(errOutput).toMatch(/rival\.gts.*concurrently|Atomic upload failed/);
  });
});
