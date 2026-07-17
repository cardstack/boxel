import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel realm list [--all-accessible|--hidden] [--include-archived]`
// prints its structured result as JSON with `--json`, so we drive the
// installed binary and assert on `res.json()`. Account-data seeding (which
// realm appears in the UI list) stays in-process via `addToUserRealms` —
// it writes to the same server-side Matrix account data the subprocess
// reads back.

let home: string;
let profileManager: ProfileManager;
let cleanupProfile: () => void;

const visibleUrl = `${TEST_REALM_SERVER_URL}/visible/`;
const hiddenUrl = `${TEST_REALM_SERVER_URL}/hidden/`;
const pendingUrl = `${TEST_REALM_SERVER_URL}/pending/`;

interface ListResult {
  realms: { url: string; hidden: boolean; archived: boolean }[];
  error?: string;
}

beforeAll(async () => {
  await startTestRealmServer({
    realms: [
      {
        realmURL: new URL(visibleUrl),
        permissions: { '*': ['read', 'write'] },
      },
      {
        realmURL: new URL(hiddenUrl),
        permissions: { '*': ['read', 'write'] },
      },
      {
        realmURL: new URL(pendingUrl),
        permissions: { '*': ['read', 'write'] },
      },
    ],
  });
  let testHome = createTestHome();
  home = testHome.home;
  profileManager = testHome.profileManager;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(profileManager);

  // Seed only `visibleUrl` into the user's app.boxel.realms account data so
  // the suite starts with a mixed visible/hidden state.
  await profileManager.addToUserRealms(visibleUrl);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm list (integration)', () => {
  it('--all-accessible returns every realm with the correct hidden flag', async () => {
    let res = await runBoxel(['realm', 'list', '--json', '--all-accessible'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<ListResult>();
    expect(result.error).toBeUndefined();
    expect(result.realms).toHaveLength(3);
    let byUrl = new Map(result.realms.map((r) => [r.url, r]));
    expect(byUrl.get(visibleUrl)).toEqual({
      url: visibleUrl,
      hidden: false,
      archived: false,
    });
    expect(byUrl.get(hiddenUrl)).toEqual({
      url: hiddenUrl,
      hidden: true,
      archived: false,
    });
    expect(byUrl.get(pendingUrl)).toEqual({
      url: pendingUrl,
      hidden: true,
      archived: false,
    });
  });

  it('returns an error when --all-accessible and --hidden are both set', async () => {
    let res = await runBoxel(
      ['realm', 'list', '--json', '--all-accessible', '--hidden'],
      { home },
    );
    expect(res.exitCode).toBe(1);
    let result = res.json<ListResult>();
    expect(result.realms).toEqual([]);
    expect(result.error).toContain('mutually exclusive');
  });

  it('default mode lists only the realm in account data', async () => {
    let res = await runBoxel(['realm', 'list', '--json'], { home });
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<ListResult>();
    expect(result.error).toBeUndefined();
    expect(result.realms).toEqual([
      { url: visibleUrl, hidden: false, archived: false },
    ]);
  });

  it('--hidden lists only realms missing from account data', async () => {
    let res = await runBoxel(['realm', 'list', '--json', '--hidden'], { home });
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<ListResult>();
    expect(result.error).toBeUndefined();
    let urls = result.realms.map((r) => r.url).sort();
    expect(urls).toEqual([hiddenUrl, pendingUrl].sort());
    expect(result.realms.every((r) => r.hidden)).toBe(true);
    expect(urls).not.toContain(visibleUrl);
  });

  it('addToUserRealms moves a realm from hidden to visible', async () => {
    await profileManager.addToUserRealms(pendingUrl);

    let visibleRes = await runBoxel(['realm', 'list', '--json'], { home });
    expect(visibleRes.ok, visibleRes.stderr).toBe(true);
    let visible = visibleRes.json<ListResult>();
    expect(visible.error).toBeUndefined();
    let visibleUrls = visible.realms.map((r) => r.url).sort();
    expect(visibleUrls).toEqual([visibleUrl, pendingUrl].sort());
    expect(visible.realms.every((r) => !r.hidden)).toBe(true);

    let hiddenRes = await runBoxel(['realm', 'list', '--json', '--hidden'], {
      home,
    });
    expect(hiddenRes.ok, hiddenRes.stderr).toBe(true);
    let hidden = hiddenRes.json<ListResult>();
    expect(hidden.error).toBeUndefined();
    expect(hidden.realms).toEqual([
      { url: hiddenUrl, hidden: true, archived: false },
    ]);
  });

  it('returns an error when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    // Materialize an empty profile store so the CLI reaches the
    // no-active-profile guard rather than any first-run bootstrapping.
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(['realm', 'list', '--json'], {
        home: emptyHome,
      });
      expect(res.exitCode).toBe(1);
      let result = res.json<ListResult>();
      expect(result.realms).toEqual([]);
      expect(result.error).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
