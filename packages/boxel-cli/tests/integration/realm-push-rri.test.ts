import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// A realm with a registered prefix mapping serves its document ids in RRI
// form (`@cli-test/prefixed/...`) rather than as URLs — the shape that made
// `realm push` crash after uploading (raw ids leaked into the succeeded list
// and were treated as local file paths). This suite pushes against such a
// realm end to end through the installed CLI binary.

const REALM_PREFIX = '@cli-test/prefixed/';

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;
let localDirs: string[] = [];

function makeLocalDir(): string {
  let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-push-rri-int-'));
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

beforeAll(async () => {
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  await startTestRealmServer({
    fileSystem: {
      'seed.txt': 'seeded\n',
    },
    realmPrefixes: { [REALM_PREFIX]: realmUrl },
  });

  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  for (let dir of localDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm push against a prefix-form RRI realm (integration)', () => {
  it('the realm serves atomic result ids in prefix form', async () => {
    // Pins the precondition the regression test below relies on: if the
    // server stops answering in RRI form, this fails rather than the suite
    // silently testing the URL-form path. This is a direct realm-state
    // probe, so it stays an in-process fetch (using the profile the CLI
    // authenticated against).
    let response = await reloadProfile(home).authedRealmFetch(
      `${realmUrl}_atomic`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Accept: 'application/vnd.api+json',
        },
        body: JSON.stringify({
          'atomic:operations': [
            {
              op: 'add',
              href: `${realmUrl}precondition-check.txt`,
              data: {
                type: 'source',
                attributes: { content: 'x\n' },
                meta: {},
              },
            },
          ],
        }),
      },
    );
    expect(response.status).toBe(201);
    let body = (await response.json()) as {
      'atomic:results': Array<{ data?: { id?: string } }>;
    };
    expect(body['atomic:results'][0]?.data?.id).toMatch(
      new RegExp(`^${REALM_PREFIX.replace(/[@/]/g, '\\$&')}`),
    );
  });

  it('pushes files and records the manifest by relative path', async () => {
    let localDir = makeLocalDir();
    writeLocalFile(localDir, 'hello.txt', 'hello\n');
    writeLocalFile(localDir, 'nested/card.gts', 'export const x = 1;\n');

    let res = await runBoxel(['realm', 'push', localDir, realmUrl], { home });
    expect(res.ok, res.stderr).toBe(true);

    let manifest = readManifest(localDir);
    expect(manifest.realmUrl).toBe(realmUrl);
    expect(Object.keys(manifest.files).sort()).toEqual([
      'hello.txt',
      'nested/card.gts',
    ]);
    // Hashes only get recorded when the succeeded list maps back to real
    // local paths — the exact step that crashed on RRI-form ids.
    for (let hash of Object.values(manifest.files)) {
      expect(hash).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});
