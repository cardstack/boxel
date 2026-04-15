import '../helpers/setup-realm-server';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { pullCommand } from '../../src/commands/realm/pull';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestProfileDir,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration';
import type { ProfileManager } from '../../src/lib/profile-manager';

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

    await pullCommand(realmUrl, localDir, { profileManager });

    let helloPath = path.join(localDir, 'hello.gts');
    let nestedPath = path.join(localDir, 'nested', 'card.gts');
    expect(fs.existsSync(helloPath)).toBe(true);
    expect(fs.existsSync(nestedPath)).toBe(true);
    expect(fs.readFileSync(helloPath, 'utf8')).toContain('hello = "world"');
    expect(fs.readFileSync(nestedPath, 'utf8')).toContain('nested = true');

    // Checkpoint history is written under .boxel-history/
    expect(fs.existsSync(path.join(localDir, '.boxel-history'))).toBe(true);
  });

  it('writes nothing when invoked with --dry-run', async () => {
    let localDir = makeLocalDir();

    await pullCommand(realmUrl, localDir, { dryRun: true, profileManager });

    let entries = fs
      .readdirSync(localDir)
      .filter((e) => e !== '.boxel-history');
    expect(entries).toEqual([]);
  });

  it('preserves local-only files without --delete', async () => {
    let localDir = makeLocalDir();
    let localOnlyDir = path.join(localDir, 'Notes');
    fs.mkdirSync(localOnlyDir, { recursive: true });
    fs.writeFileSync(
      path.join(localOnlyDir, 'local-only.json'),
      '{"local":"only"}',
    );

    await pullCommand(realmUrl, localDir, { profileManager });

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

    await pullCommand(realmUrl, localDir, {
      delete: true,
      profileManager,
    });

    expect(fs.existsSync(stalePath)).toBe(false);
    expect(fs.existsSync(path.join(localDir, 'hello.gts'))).toBe(true);
  });

  it('pulls subdirectories recursively', async () => {
    let localDir = makeLocalDir();

    await pullCommand(realmUrl, localDir, { profileManager });

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
});
