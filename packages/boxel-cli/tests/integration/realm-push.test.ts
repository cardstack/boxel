import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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

interface SyncManifest {
  realmUrl: string;
  files: Record<string, string>;
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

  it('does not upload .realm.json (protected file) even if present locally', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const card = true;\n');
    writeLocalFile(localDir, '.realm.json', '{"name":"locally-edited-marker"}');

    await pushCommand(localDir, realmUrl, { profileManager });

    expect(await remoteFileExists(realmUrl, 'card.gts')).toBe(true);
    let remoteRealmJson = await fetchRemoteFile(realmUrl, '.realm.json');
    expect(remoteRealmJson).not.toContain('locally-edited-marker');

    let manifest = readManifest(localDir);
    expect(manifest.files['.realm.json']).toBeUndefined();
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
});
