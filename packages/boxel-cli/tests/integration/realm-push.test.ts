import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pushCommand } from '../../src/commands/realm/push';
import { pullCommand } from '../../src/commands/realm/pull';
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
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-push-int-'));
  localDirs.push(dir);
  return dir;
}

function writeLocalFile(localDir: string, relPath: string, content: string) {
  let fullPath = path.join(localDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

// Create a fresh realm and return its URL
async function createTestRealm(): Promise<string> {
  let name = uniqueRealmName();
  await createRealm(name, `Test ${name}`, { profileManager });

  let realmTokens =
    profileManager.getActiveProfile()!.profile.realmTokens ?? {};
  let entry = Object.entries(realmTokens).find(([url]) =>
    url.includes(name),
  );
  if (!entry) {
    throw new Error(`No realm JWT stored for ${name}`);
  }
  return entry[0];
}

// Pull remote files into a temp dir and return a map of relativePath -> content
async function pullRemoteFiles(
  realmUrl: string,
): Promise<Map<string, string>> {
  let pullDir = makeLocalDir();
  await pullCommand(realmUrl, pullDir, { profileManager });

  let files = new Map<string, string>();
  function walk(dir: string, prefix: string) {
    for (let entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.boxel-history') continue;
      let rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), rel);
      } else {
        files.set(rel, fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      }
    }
  }
  walk(pullDir, '');
  return files;
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

    // Verify manifest was created
    expect(fs.existsSync(path.join(localDir, '.boxel-sync.json'))).toBe(true);
    let manifest = JSON.parse(
      fs.readFileSync(path.join(localDir, '.boxel-sync.json'), 'utf8'),
    );
    expect(manifest.workspaceUrl).toBe(realmUrl);
    expect(Object.keys(manifest.files)).toContain('card.gts');
    expect(Object.keys(manifest.files)).toContain('data.json');

    // Verify files exist on remote via pull
    let remoteFiles = await pullRemoteFiles(realmUrl);
    expect(remoteFiles.has('card.gts')).toBe(true);
    expect(remoteFiles.get('card.gts')).toContain('card = true');
    expect(remoteFiles.has('data.json')).toBe(true);
  });

  it('incremental push skips unchanged files', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'a.gts', 'export const a = 1;\n');
    writeLocalFile(localDir, 'b.gts', 'export const b = 2;\n');

    // First push uploads both files
    await pushCommand(localDir, realmUrl, { profileManager });

    // Modify only one file
    writeLocalFile(localDir, 'a.gts', 'export const a = 999;\n');

    // Second push should only upload the changed file
    await pushCommand(localDir, realmUrl, { profileManager });

    let remoteFiles = await pullRemoteFiles(realmUrl);
    expect(remoteFiles.get('a.gts')).toContain('a = 999');
    expect(remoteFiles.get('b.gts')).toContain('b = 2');
  });

  it('push with --force uploads all files', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'file.gts', 'export const v = 1;\n');

    await pushCommand(localDir, realmUrl, { profileManager });

    // Push again with force (no changes) — should still succeed
    await pushCommand(localDir, realmUrl, { force: true, profileManager });

    let remoteFiles = await pullRemoteFiles(realmUrl);
    expect(remoteFiles.has('file.gts')).toBe(true);
  });

  it('push with --delete removes remote-only files', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    // Push two files
    writeLocalFile(localDir, 'keep.gts', 'export const keep = true;\n');
    writeLocalFile(localDir, 'remove.gts', 'export const remove = true;\n');
    await pushCommand(localDir, realmUrl, { profileManager });

    // Delete one locally, then push with --delete
    fs.unlinkSync(path.join(localDir, 'remove.gts'));
    await pushCommand(localDir, realmUrl, { delete: true, profileManager });

    let remoteFiles = await pullRemoteFiles(realmUrl);
    expect(remoteFiles.has('keep.gts')).toBe(true);
    expect(remoteFiles.has('remove.gts')).toBe(false);
  });

  it('push with --dry-run makes no changes', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'draft.gts', 'export const draft = true;\n');

    await pushCommand(localDir, realmUrl, { dryRun: true, profileManager });

    // No manifest should be created
    expect(fs.existsSync(path.join(localDir, '.boxel-sync.json'))).toBe(false);

    // Remote should not have the file (only index.json from realm creation)
    let remoteFiles = await pullRemoteFiles(realmUrl);
    expect(remoteFiles.has('draft.gts')).toBe(false);
  });

  it('push ignores .boxel-sync.json', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'card.gts', 'export const card = true;\n');
    writeLocalFile(
      localDir,
      '.boxel-sync.json',
      '{"workspaceUrl":"old","files":{}}',
    );

    await pushCommand(localDir, realmUrl, { profileManager });

    let remoteFiles = await pullRemoteFiles(realmUrl);
    expect(remoteFiles.has('card.gts')).toBe(true);
    expect(remoteFiles.has('.boxel-sync.json')).toBe(false);
  });
});
