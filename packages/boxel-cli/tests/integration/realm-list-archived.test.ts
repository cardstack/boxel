import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  createTestRealmViaCli,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// Exercises how `boxel realm list` treats archived realms: hidden by
// default, surfaced with `--include-archived`. We create realms and
// archive them through the installed binary, then read the list back with
// `--json`.

let home: string;
let cleanupProfile: () => void;

interface ListResult {
  realms: { url: string; hidden: boolean; archived: boolean }[];
  error?: string;
}

async function listCli(flags: string[] = []): Promise<ListResult> {
  let res = await runBoxel(['realm', 'list', '--json', ...flags], { home });
  expect(res.ok, res.stderr).toBe(true);
  return res.json<ListResult>();
}

async function archiveCli(realmUrl: string): Promise<void> {
  let res = await runBoxel(['realm', 'archive', realmUrl, '--yes'], { home });
  expect(res.ok, res.stderr).toBe(true);
}

beforeAll(async () => {
  await startTestRealmServer();
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm list with archived realms (integration)', () => {
  it('hides archived realms by default', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);

    let beforeArchive = await listCli();
    expect(beforeArchive.error).toBeUndefined();
    expect(beforeArchive.realms.map((r) => r.url)).toContain(realmUrl);

    await archiveCli(realmUrl);

    let afterArchive = await listCli();
    expect(afterArchive.error).toBeUndefined();
    expect(afterArchive.realms.map((r) => r.url)).not.toContain(realmUrl);

    let allAccessible = await listCli(['--all-accessible']);
    expect(allAccessible.error).toBeUndefined();
    expect(allAccessible.realms.map((r) => r.url)).not.toContain(realmUrl);
  });

  it('--include-archived surfaces archived realms with an archived marker', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    await archiveCli(realmUrl);

    let result = await listCli(['--include-archived']);
    expect(result.error).toBeUndefined();
    let entry = result.realms.find((r) => r.url === realmUrl);
    expect(entry).toBeDefined();
    expect(entry?.archived).toBe(true);
  });

  it('lists multiple archived realms together when --include-archived is set', async () => {
    let { realmUrl: urlA } = await createTestRealmViaCli(home);
    let { realmUrl: urlB } = await createTestRealmViaCli(home);
    await archiveCli(urlA);
    await archiveCli(urlB);

    let result = await listCli(['--include-archived']);
    expect(result.error).toBeUndefined();
    let archivedUrls = result.realms
      .filter((r) => r.archived)
      .map((r) => r.url);
    expect(archivedUrls).toEqual(expect.arrayContaining([urlA, urlB]));
  });
});
