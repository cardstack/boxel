import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import jwt from 'jsonwebtoken';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  reloadProfile,
  setupTestProfile,
  uniqueRealmName,
  TEST_REALM_SERVER_URL,
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

describe('realm create --profile (integration)', () => {
  // The profiles file holds an active profile for one account and a second
  // profile for the account that should own the realm. `--profile` makes
  // the command act as the second, for that command only.
  const DECOY = '@cli-decoy:localhost';
  let profileHome: string;
  let cleanupProfileHome: () => void;
  let ownerId: string;

  beforeAll(async () => {
    let testHome = createTestHome();
    profileHome = testHome.home;
    cleanupProfileHome = testHome.cleanup;
    // Added first, so it is the active profile. Its Matrix token is never
    // valid, so a request made as it would fail.
    await testHome.profileManager.addProfileWithAuth(
      DECOY,
      {
        accessToken: 'decoy-access-token',
        userId: DECOY,
        deviceId: 'DECOY_DEVICE',
        matrixUrl: 'http://localhost:8008',
      },
      'Decoy',
      `${TEST_REALM_SERVER_URL}/`,
    );
    ownerId = await setupTestProfile(testHome.profileManager);
  });

  afterAll(() => {
    cleanupProfileHome?.();
  });

  it('creates the realm as the named profile and leaves the active profile alone', async () => {
    let realmName = uniqueRealmName();

    let res = await runBoxel(
      ['realm', 'create', realmName, `Test ${realmName}`, '--profile', ownerId],
      { home: profileHome },
    );
    expect(res.ok, res.stderr).toBe(true);

    let pm = reloadProfile(profileHome);
    expect(pm.getActiveProfileId()).toBe(DECOY);

    let realmToken = Object.entries(
      pm.getProfile(ownerId)!.realmTokens ?? {},
    ).find(([url]) => url.includes(realmName))?.[1];
    expect(realmToken).toBeDefined();
    let claims = jwt.decode(realmToken!.replace(/^Bearer\s+/i, '')) as {
      user: string;
      permissions: string[];
    };
    expect(claims.user).toBe(ownerId);
    expect(claims.permissions).toContain('realm-owner');

    let decoy = pm.getProfile(DECOY)!;
    expect(decoy.realmTokens).toBeUndefined();
    expect(decoy.realmServerToken).toBeUndefined();
  });
});
