import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  uniqueRealmName,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel realm create <realm-name> <display-name>` creates a realm on the
// realm server and stores its JWT in the profile on disk. We drive the
// installed binary and read the resulting profile back with
// `reloadProfile(home)` — the seeded manager's in-memory copy is stale once
// the subprocess has written.

let home: string;
let cleanup: () => void;

beforeAll(async () => {
  await startTestRealmServer();

  let testHome = createTestHome();
  home = testHome.home;
  cleanup = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanup?.();
  await stopTestRealmServer();
});

describe('realm create (integration)', () => {
  it('creates a realm and stores the JWT in the profile', async () => {
    let realmName = uniqueRealmName();

    let res = await runBoxel(
      ['realm', 'create', realmName, `Test ${realmName}`],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);

    let pm = reloadProfile(home);
    let active = pm.getActiveProfile()!;
    let realmTokens = active.profile.realmTokens ?? {};
    let storedToken = Object.entries(realmTokens).find(([url]) =>
      url.includes(realmName),
    )?.[1];

    expect(storedToken).toBeDefined();
    expect(storedToken!.length).toBeGreaterThan(0);
    expect(pm.getRealmServerToken()).toBeDefined();
  });

  it('creates another realm reusing the cached server token', async () => {
    let cachedToken = reloadProfile(home).getRealmServerToken();
    expect(cachedToken).toBeDefined();

    let realmName = uniqueRealmName();

    let res = await runBoxel(
      ['realm', 'create', realmName, `Test ${realmName}`],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);

    let pm = reloadProfile(home);
    // Server token was reused (still valid on disk), not re-fetched.
    expect(pm.getRealmServerToken()).toBe(cachedToken);

    let active = pm.getActiveProfile()!;
    let realmTokens = active.profile.realmTokens ?? {};
    let storedToken = Object.entries(realmTokens).find(([url]) =>
      url.includes(realmName),
    )?.[1];
    expect(storedToken).toBeDefined();
  });
});
