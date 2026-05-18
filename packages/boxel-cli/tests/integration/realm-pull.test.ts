import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pull } from '../../src/commands/realm/pull';
import { CheckpointManager } from '../../src/lib/checkpoint-manager';
import type { ProfileManager } from '../../src/lib/profile-manager';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';
import { TINY_PNG_BYTES } from '../helpers/binary-fixtures';

let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;
let localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-pull-int-'));
  localDirs.push(dir);
  return dir;
}

beforeAll(async () => {
  // Seed files into the realm at creation time, matching the realm-server
  // test pattern of passing a fileSystem to the realm setup helpers.
  await startTestRealmServer({
    fileSystem: {
      'hello.gts': 'export const hello = "world";\n',
      'nested/card.gts': 'export const nested = true;\n',
      'nested/deep/inner.gts': 'export const inner = "deep";\n',
    },
  });

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

describe('realm pull (integration)', () => {
  it('pulls seeded files into an empty local directory', async () => {
    let localDir = makeLocalDir();

    let result = await pull(realmUrl, localDir, { profileManager });

    expect(result.error).toBeUndefined();
    expect(result.files).toContain('hello.gts');
    expect(result.files).toContain('nested/card.gts');

    let helloPath = path.join(localDir, 'hello.gts');
    let nestedPath = path.join(localDir, 'nested', 'card.gts');
    expect(fs.existsSync(helloPath)).toBe(true);
    expect(fs.existsSync(nestedPath)).toBe(true);
    expect(fs.readFileSync(helloPath, 'utf8')).toContain('hello = "world"');
    expect(fs.readFileSync(nestedPath, 'utf8')).toContain('nested = true');

    // Checkpoint history is written under .boxel-history/
    expect(fs.existsSync(path.join(localDir, '.boxel-history'))).toBe(true);

    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].source).toBe('remote');
    // 3 seeded files => summary message "Pull: 3 files (~3)" — the pull
    // command records downloaded files as 'modified', not 'added'.
    expect(checkpoints[0].message).toContain('3 files');
    expect(checkpoints[0].message).toContain('~3');
  });

  it('writes nothing when invoked with --dry-run', async () => {
    let localDir = makeLocalDir();

    let result = await pull(realmUrl, localDir, {
      dryRun: true,
      profileManager,
    });

    expect(result.error).toBeUndefined();

    let entries = fs
      .readdirSync(localDir)
      .filter((e) => e !== '.boxel-history');
    expect(entries).toEqual([]);

    let cm = new CheckpointManager(localDir);
    expect(await cm.isInitialized()).toBe(false);
    expect(await cm.getCheckpoints()).toEqual([]);
  });

  it('preserves local-only files without --delete', async () => {
    let localDir = makeLocalDir();
    let localOnlyDir = path.join(localDir, 'Notes');
    fs.mkdirSync(localOnlyDir, { recursive: true });
    fs.writeFileSync(
      path.join(localOnlyDir, 'local-only.json'),
      '{"local":"only"}',
    );

    let result = await pull(realmUrl, localDir, { profileManager });

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(localDir, 'hello.gts'))).toBe(true);
    expect(fs.existsSync(path.join(localOnlyDir, 'local-only.json'))).toBe(
      true,
    );
  });

  it('removes local files missing from the realm when --delete is set', async () => {
    let localDir = makeLocalDir();
    let staleRel = 'stale-only-local.gts';
    let stalePath = path.join(localDir, staleRel);
    fs.writeFileSync(stalePath, 'export const stale = true;\n', 'utf8');

    let result = await pull(realmUrl, localDir, {
      delete: true,
      profileManager,
    });

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(path.join(localDir, 'hello.gts'))).toBe(true);

    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    // Two checkpoints: pre-delete (custom message) + post-pull summary.
    expect(checkpoints.length).toBe(2);
    let messages = checkpoints.map((c) => c.message.trim());
    expect(
      messages.some((m) =>
        m.startsWith('Pre-delete checkpoint: 1 files not on server'),
      ),
    ).toBe(true);
    expect(checkpoints.every((c) => c.source === 'remote')).toBe(true);
  });

  it('pulls subdirectories recursively', async () => {
    let localDir = makeLocalDir();

    let result = await pull(realmUrl, localDir, { profileManager });

    expect(result.error).toBeUndefined();
    expect(fs.existsSync(path.join(localDir, 'hello.gts'))).toBe(true);
    expect(fs.existsSync(path.join(localDir, 'nested', 'card.gts'))).toBe(true);
    expect(
      fs.existsSync(path.join(localDir, 'nested', 'deep', 'inner.gts')),
    ).toBe(true);
    expect(
      fs.readFileSync(
        path.join(localDir, 'nested', 'deep', 'inner.gts'),
        'utf8',
      ),
    ).toContain('inner = "deep"');
  });

  it('does not delete or checkpoint when --delete is combined with --dry-run', async () => {
    let localDir = makeLocalDir();
    let stalePath = path.join(localDir, 'stale.gts');
    fs.writeFileSync(stalePath, 'export const stale = true;\n', 'utf8');

    await pull(realmUrl, localDir, {
      delete: true,
      dryRun: true,
      profileManager,
    });

    expect(fs.existsSync(stalePath)).toBe(true);
    expect(fs.existsSync(path.join(localDir, '.boxel-history'))).toBe(false);
  });

  it('creates only a post-pull checkpoint when --delete has nothing to delete', async () => {
    let localDir = makeLocalDir();

    await pull(realmUrl, localDir, {
      delete: true,
      profileManager,
    });

    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].source).toBe('remote');
    expect(checkpoints[0].message).not.toContain('Pre-delete checkpoint');
  });

  it('re-pulling an up-to-date directory adds no new checkpoint', async () => {
    let localDir = makeLocalDir();

    await pull(realmUrl, localDir, { profileManager });
    let cm = new CheckpointManager(localDir);
    let afterFirst = (await cm.getCheckpoints()).length;

    await pull(realmUrl, localDir, { profileManager });
    let afterSecond = (await cm.getCheckpoints()).length;

    expect(afterSecond).toBe(afterFirst);
  });

  it('creates the local directory when it does not yet exist', async () => {
    let parent = makeLocalDir();
    let localDir = path.join(parent, 'created-by-pull');
    // sanity: directory does not exist before the pull
    expect(fs.existsSync(localDir)).toBe(false);

    await pull(realmUrl, localDir, { profileManager });

    expect(fs.existsSync(localDir)).toBe(true);
    expect(fs.existsSync(path.join(localDir, 'hello.gts'))).toBe(true);

    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBe(1);
  });

  it('overwrites a locally-modified file with the remote version', async () => {
    let localDir = makeLocalDir();
    let helloPath = path.join(localDir, 'hello.gts');
    fs.writeFileSync(helloPath, 'export const hello = "local-edit";\n');

    await pull(realmUrl, localDir, { profileManager });

    expect(fs.readFileSync(helloPath, 'utf8')).toContain('hello = "world"');

    let cm = new CheckpointManager(localDir);
    let checkpoints = await cm.getCheckpoints();
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].source).toBe('remote');
  });

  it('returns an error (not process.exit) when no active profile is configured', async () => {
    let emptyProfile = createTestProfileDir();
    try {
      let result = await pull(realmUrl, makeLocalDir(), {
        profileManager: emptyProfile.profileManager,
      });
      expect(result.files).toEqual([]);
      expect(result.error).toContain('No active profile');
    } finally {
      emptyProfile.cleanup();
    }
  });

  it('returns an error when the realm URL is unreachable', async () => {
    let localDir = makeLocalDir();
    let result = await pull('http://127.0.0.1:1/nonexistent/', localDir, {
      profileManager,
    });

    expect(result.error).toBeDefined();
    expect(result.files).toEqual([]);
  });

  // --- Binary file downloads (CS-11075) ---

  it('pulls a binary PNG byte-identically', async () => {
    let localDir = makeLocalDir();

    // Seed the realm with raw bytes via the octet-stream endpoint (the
    // canonical wire format the realm-server's upsertBinaryFile route
    // expects). The startTestRealmServer fileSystem option only accepts
    // strings, so we POST after server start.
    let pngUrl = new URL('image.png', realmUrl).href;
    let seedResponse = await profileManager.authedRealmFetch(pngUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: TINY_PNG_BYTES,
    });
    expect(seedResponse.ok).toBe(true);

    await pull(realmUrl, localDir, { profileManager });

    let localPath = path.join(localDir, 'image.png');
    let pulled = fs.readFileSync(localPath);
    expect(pulled.equals(Buffer.from(TINY_PNG_BYTES))).toBe(true);
  });
});
