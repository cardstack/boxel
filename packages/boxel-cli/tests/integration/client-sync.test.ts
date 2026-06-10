import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { BoxelCLIClient } from '../../src/lib/boxel-cli-client.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import { createRealm } from '../../src/commands/realm/create.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration.ts';

let profileManager: ProfileManager;
let client: BoxelCLIClient;
let cleanupProfile: () => void;
let localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-client-sync-'));
  localDirs.push(dir);
  return dir;
}

function writeLocalFile(localDir: string, relPath: string, content: string) {
  let fullPath = path.join(localDir, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
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

beforeAll(async () => {
  await startTestRealmServer();
  let testProfile = createTestProfileDir();
  profileManager = testProfile.profileManager;
  cleanupProfile = testProfile.cleanup;
  await setupTestProfile(profileManager);
  client = new BoxelCLIClient(profileManager);
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('BoxelCLIClient.sync (integration)', () => {
  it('pushes local files to remote and reports them in the result', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'hello.gts', 'export const hello = 1;\n');
    writeLocalFile(localDir, 'card.json', '{"title":"Hi"}\n');

    let result = await client.sync(realmUrl, localDir, { preferLocal: true });

    expect(result.hasError).toBe(false);
    expect(result.error).toBeUndefined();
    expect(result.pushed).toEqual(
      expect.arrayContaining(['hello.gts', 'card.json']),
    );
    expect(result.remoteDeleted).toEqual([]);
    expect(result.localDeleted).toEqual([]);
    expect(result.skippedConflicts).toEqual([]);

    // The realm now serves the pushed file.
    let read = await client.read(realmUrl, 'hello.gts');
    expect(read.ok).toBe(true);
    expect(read.content).toContain('hello = 1');
  });

  it('pulls remote-only files and reports them in the result', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    // Seed the realm with a file via client.write, then sync into an empty local dir.
    await client.write(realmUrl, 'remote.gts', 'export const remote = true;\n');

    let result = await client.sync(realmUrl, localDir, { preferRemote: true });

    expect(result.hasError).toBe(false);
    expect(result.pulled).toContain('remote.gts');
    expect(fs.existsSync(path.join(localDir, 'remote.gts'))).toBe(true);
  });

  it('dry-run makes no changes and reports no operations', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    writeLocalFile(localDir, 'only-local.gts', 'export const x = 1;\n');

    let result = await client.sync(realmUrl, localDir, {
      preferLocal: true,
      dryRun: true,
    });

    expect(result.hasError).toBe(false);
    // Nothing was persisted remotely
    let read = await client.read(realmUrl, 'only-local.gts');
    expect(read.ok).toBe(false);
    expect(read.status).toBe(404);
    // No manifest was written
    expect(fs.existsSync(path.join(localDir, '.boxel-sync.json'))).toBe(false);
  });

  it('returns an error result when no active profile', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    let emptyDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'boxel-client-empty-'),
    );
    let emptyManager = new ProfileManager(emptyDir);
    let emptyClient = new BoxelCLIClient(emptyManager);

    let result = await emptyClient.sync(realmUrl, localDir);

    expect(result.hasError).toBe(true);
    expect(result.error).toContain('No active profile');
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('returns an error result when multiple conflict strategies are passed', async () => {
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();

    let result = await client.sync(realmUrl, localDir, {
      preferLocal: true,
      preferRemote: true,
    });

    expect(result.hasError).toBe(true);
    expect(result.error).toContain('conflict strategy');
  });

  it('returns an error result when localDir does not exist', async () => {
    let realmUrl = await createTestRealm();
    let missingDir = path.join(
      os.tmpdir(),
      `boxel-does-not-exist-${Date.now()}`,
    );

    let result = await client.sync(realmUrl, missingDir, { preferLocal: true });

    expect(result.hasError).toBe(true);
    expect(result.error).toContain('does not exist');
  });

  it('returns an error result when realmUrl is malformed', async () => {
    let localDir = makeLocalDir();

    let result = await client.sync('not-a-valid-url', localDir, {
      preferLocal: true,
    });

    expect(result.hasError).toBe(true);
    expect(result.error).toContain('Invalid workspace URL');
    expect(result.pushed).toEqual([]);
    expect(result.pulled).toEqual([]);
  });

  it('paths containing a space round-trip without duplicating across syncs', async () => {
    // Regression: realm `_mtimes` returns paths URL-encoded
    // (`Knowledge%20Articles/foo.json`), but the local listing has
    // them decoded (`Knowledge Articles/foo.json`). Without
    // normalizing, the diff treated the encoded and decoded variants
    // as two different files — a second sync would "pull" the
    // remote copy, leaving the workspace with both.
    let realmUrl = await createTestRealm();
    let localDir = makeLocalDir();
    let relativePath = 'Knowledge Articles/sticky-note-brief.json';

    writeLocalFile(localDir, relativePath, '{"title":"Brief"}\n');

    let firstSync = await client.sync(realmUrl, localDir, {
      preferLocal: true,
    });
    expect(firstSync.hasError).toBe(false);
    expect(firstSync.pushed).toContain(relativePath);

    // Second sync: nothing has changed locally or remotely. The
    // expected outcome is an idempotent no-op — no pulls, no pushes,
    // no duplicates.
    let secondSync = await client.sync(realmUrl, localDir, {
      preferLocal: true,
    });
    expect(secondSync.hasError).toBe(false);
    expect(secondSync.pushed).toEqual([]);
    expect(secondSync.pulled).toEqual([]);

    // The on-disk workspace should still have only the original
    // file — not a `Knowledge%20Articles/...` duplicate.
    expect(fs.existsSync(path.join(localDir, relativePath))).toBe(true);
    expect(
      fs.existsSync(
        path.join(localDir, 'Knowledge%20Articles/sticky-note-brief.json'),
      ),
    ).toBe(false);
  });
});
