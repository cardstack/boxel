import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sync } from '../../src/commands/realm/sync';
import { status, statusAll } from '../../src/commands/realm/status';
import { createRealm } from '../../src/commands/realm/create';
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
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-status-int-'));
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

function manifestMtime(localDir: string): number {
  return fs.statSync(path.join(localDir, '.boxel-sync.json')).mtimeMs;
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

async function establishBaseline(
  localDir: string,
  realmUrl: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relPath, content] of Object.entries(files)) {
    writeLocalFile(localDir, relPath, content);
  }
  await sync(localDir, realmUrl, { preferLocal: true, profileManager });
  // Remote mtimes are second-precision — wait so subsequent edits get a new mtime.
  await sleep(1100);
}

function statusesFor(
  result: { changes: Array<{ file: string; status: string }> },
  file: string,
): string[] {
  return result.changes.filter((c) => c.file === file).map((c) => c.status);
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

describe('realm sync status (integration)', () => {
  it('reports inSync when nothing has changed since baseline', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });

    let result = await status(localDir, { profileManager });

    expect(result.inSync).toBe(true);
    expect(result.changes).toEqual([]);
    expect(result.realmUrl.replace(/\/+$/, '')).toBe(
      realmUrl.replace(/\/+$/, ''),
    );
    expect(result.hasError).toBe(false);
  });

  it('detects new remote file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    await writeRemoteFile(realmUrl, 'b.gts', 'export const b = 1;\n');

    let result = await status(localDir, { profileManager });

    expect(result.inSync).toBe(false);
    expect(statusesFor(result, 'b.gts')).toEqual(['new-remote']);
  });

  it('detects modified remote file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = 2;\n');

    let result = await status(localDir, { profileManager });

    expect(statusesFor(result, 'a.gts')).toEqual(['modified-remote']);
  });

  it('detects new local file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'c.gts', 'export const c = 1;\n');

    let result = await status(localDir, { profileManager });

    expect(statusesFor(result, 'c.gts')).toEqual(['new-local']);
  });

  it('detects modified local file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'a.gts', 'export const a = 99;\n');

    let result = await status(localDir, { profileManager });

    expect(statusesFor(result, 'a.gts')).toEqual(['modified-local']);
  });

  it('detects conflict when both sides modify the same file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'a.gts', 'export const a = "local";\n');
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = "remote";\n');

    let result = await status(localDir, { profileManager });

    expect(statusesFor(result, 'a.gts')).toEqual(['conflict']);
  });

  it('detects deleted local file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    fs.unlinkSync(path.join(localDir, 'a.gts'));

    let result = await status(localDir, { profileManager });

    expect(statusesFor(result, 'a.gts')).toEqual(['deleted-local']);
  });

  it('detects deleted remote file', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    await deleteRemoteFile(realmUrl, 'a.gts');

    let result = await status(localDir, { profileManager });

    expect(statusesFor(result, 'a.gts')).toEqual(['deleted-remote']);
  });

  it('--pull downloads safe remote changes and clears the diff', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    // New + modified remote, no local changes
    await writeRemoteFile(realmUrl, 'b.gts', 'export const b = 1;\n');
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = 2;\n');

    let result = await status(localDir, { profileManager, pull: true });

    expect(result.pulled.sort()).toEqual(['a.gts', 'b.gts']);
    expect(readLocalFile(localDir, 'a.gts')).toContain('a = 2');
    expect(readLocalFile(localDir, 'b.gts')).toContain('b = 1');

    let after = await status(localDir, { profileManager });
    expect(after.inSync).toBe(true);
  });

  it('--pull leaves conflicts untouched', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    writeLocalFile(localDir, 'a.gts', 'export const a = "local";\n');
    await writeRemoteFile(realmUrl, 'a.gts', 'export const a = "remote";\n');

    let result = await status(localDir, { profileManager, pull: true });

    expect(result.pulled).not.toContain('a.gts');
    // Local file untouched
    expect(readLocalFile(localDir, 'a.gts')).toContain('a = "local"');
  });

  it('--pull with zero safe pulls does not touch the manifest', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });
    let mtimeBefore = manifestMtime(localDir);
    // Wait long enough that a real write would change mtime measurably
    await sleep(50);

    let result = await status(localDir, { profileManager, pull: true });

    expect(result.pulled).toEqual([]);
    expect(manifestMtime(localDir)).toBe(mtimeBefore);
  });

  it('errors when manifest is missing', async () => {
    let localDir = makeLocalDir();

    let result = await status(localDir, { profileManager });

    expect(result.hasError).toBe(true);
    expect(result.error).toMatch(/\.boxel-sync\.json/);
  });

  it('--all walks current root and reports each sync dir', async () => {
    let root = makeLocalDir();
    let realmUrl1 = await createTestRealm();
    let realmUrl2 = await createTestRealm();
    let dirA = path.join(root, 'a');
    let dirB = path.join(root, 'nested', 'b');
    fs.mkdirSync(dirA, { recursive: true });
    fs.mkdirSync(dirB, { recursive: true });
    writeLocalFile(dirA, 'one.gts', 'export const x = 1;\n');
    await sync(dirA, realmUrl1, { preferLocal: true, profileManager });
    writeLocalFile(dirB, 'two.gts', 'export const y = 1;\n');
    await sync(dirB, realmUrl2, { preferLocal: true, profileManager });

    // Nested dir under an ignored node_modules should NOT be discovered
    let ignored = path.join(root, 'node_modules', 'pkg');
    fs.mkdirSync(ignored, { recursive: true });
    writeLocalFile(ignored, 'ignored.gts', 'export const z = 1;\n');
    fs.writeFileSync(
      path.join(ignored, '.boxel-sync.json'),
      JSON.stringify({ realmUrl: realmUrl1, files: {} }, null, 2),
    );

    let result = await statusAll(root, { profileManager });

    let discovered = result.workspaces.map((w) => w.localDir).sort();
    expect(discovered).toEqual([dirA, dirB].sort());
  });

  it('--all continues past a malformed manifest', async () => {
    let root = makeLocalDir();
    let realmUrl = await createTestRealm();
    let dirOk = path.join(root, 'ok');
    let dirBad = path.join(root, 'bad');
    fs.mkdirSync(dirOk, { recursive: true });
    fs.mkdirSync(dirBad, { recursive: true });
    writeLocalFile(dirOk, 'one.gts', 'export const x = 1;\n');
    await sync(dirOk, realmUrl, { preferLocal: true, profileManager });
    fs.writeFileSync(path.join(dirBad, '.boxel-sync.json'), '{ not valid json');

    let result = await statusAll(root, { profileManager });

    let bad = result.workspaces.find((w) => w.localDir === dirBad);
    expect(bad).toBeDefined();
    expect(bad!.skipped).toBe('malformed');
    let ok = result.workspaces.find((w) => w.localDir === dirOk);
    expect(ok).toBeDefined();
    expect(ok!.hasError).toBe(false);
  });

  it('--all flags a valid-JSON-but-wrong-shape manifest as malformed', async () => {
    let root = makeLocalDir();
    let dirShape = path.join(root, 'shape');
    fs.mkdirSync(dirShape, { recursive: true });
    // Valid JSON, but missing required `realmUrl` and `files` fields.
    fs.writeFileSync(
      path.join(dirShape, '.boxel-sync.json'),
      JSON.stringify({ wrong: 'shape' }),
    );

    let result = await statusAll(root, { profileManager });

    let entry = result.workspaces.find((w) => w.localDir === dirShape);
    expect(entry).toBeDefined();
    expect(entry!.skipped).toBe('malformed');
  });

  it('--all walker discovers sync dirs under non-ignored dot-prefixed dirs', async () => {
    let root = makeLocalDir();
    let realmUrl = await createTestRealm();
    let dotDir = path.join(root, '.workspaces', 'project');
    fs.mkdirSync(dotDir, { recursive: true });
    writeLocalFile(dotDir, 'one.gts', 'export const x = 1;\n');
    await sync(dotDir, realmUrl, { preferLocal: true, profileManager });

    let result = await statusAll(root, { profileManager });

    let discovered = result.workspaces.map((w) => w.localDir);
    expect(discovered).toContain(dotDir);
  });

  it('rejects --all combined with --pull', async () => {
    let root = makeLocalDir();

    let result = await statusAll(root, {
      profileManager,
      pull: true,
    });

    expect(result.hasError).toBe(true);
    expect(result.workspaces).toEqual([]);
  });

  it('localDir defaults are the caller responsibility; status accepts an explicit dir', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    await establishBaseline(localDir, realmUrl, {
      'a.gts': 'export const a = 1;\n',
    });

    // Note: CLI action layer is what defaults to process.cwd(); the
    // programmatic API requires an explicit dir. This test pins that contract.
    let result = await status(localDir, { profileManager });
    expect(result.localDir).toBe(localDir);
    expect(localFileExists(localDir, 'a.gts')).toBe(true);
  });
});
