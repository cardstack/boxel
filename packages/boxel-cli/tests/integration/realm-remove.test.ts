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
  reloadProfile,
  setupTestProfile,
  createTestRealmViaCli,
  uniqueRealmName,
  registerUser,
  matrixURL,
  matrixRegistrationSecret,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel realm remove <url> --yes` hard-deletes the realm server-side and
// unlinks it from the user's app.boxel.realms account data. The command
// prints a "N -> M" count line and a "Removed:" confirmation; failures go
// to stderr with a non-zero exit. We drive the installed binary and verify
// the account-data membership in-process via `reloadProfile(home)`, whose
// `getUserRealms` reads the same server-side Matrix account data.

let home: string;
let profileManager: ProfileManager;
let cleanupProfile: () => void;

beforeAll(async () => {
  await startTestRealmServer();
  let testHome = createTestHome();
  home = testHome.home;
  profileManager = testHome.profileManager;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm remove (integration)', () => {
  it('hard-deletes the realm on the server and unlinks from Matrix', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let before = await reloadProfile(home).getUserRealms();

    let res = await runBoxel(['realm', 'remove', realmUrl, '--yes'], { home });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain('Removed:');
    expect(res.stdout).toContain(realmUrl);
    // previousCount -> nextCount, where nextCount == previousCount - 1.
    expect(res.stdout).toContain(
      `app.boxel.realms: ${before.length} -> ${before.length - 1}`,
    );

    let userRealms = await reloadProfile(home).getUserRealms();
    expect(userRealms).not.toContain(realmUrl);
  });

  it('frees the realm name so it can be recreated', async () => {
    let name = uniqueRealmName();
    let first = await createTestRealmViaCli(home, name);

    let removed = await runBoxel(['realm', 'remove', first.realmUrl, '--yes'], {
      home,
    });
    expect(removed.ok, removed.stderr).toBe(true);

    let recreate = await runBoxel(['realm', 'create', name, `Test ${name}`], {
      home,
    });
    expect(recreate.ok, recreate.stderr).toBe(true);
    expect(recreate.stdout).toContain('Realm created');

    let realmTokens =
      reloadProfile(home).getActiveProfile()?.profile.realmTokens ?? {};
    let secondUrl = Object.keys(realmTokens).find((url) => url.includes(name));
    expect(secondUrl).toBe(first.realmUrl);

    await runBoxel(['realm', 'remove', first.realmUrl, '--yes'], { home });
  });

  it('reports notInList when the URL is not in the user list', async () => {
    let res = await runBoxel(
      [
        'realm',
        'remove',
        `${TEST_REALM_SERVER_URL}/never-added-${Date.now()}/`,
        '--yes',
      ],
      { home },
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('Nothing to remove');
  });

  it('dry-run does not hit the server or modify Matrix', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let before = await reloadProfile(home).getUserRealms();

    let res = await runBoxel(['realm', 'remove', realmUrl, '--dry-run'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain('[DRY RUN]');
    expect(res.stdout).toContain(
      `app.boxel.realms: ${before.length} -> ${before.length - 1}`,
    );

    let after = await reloadProfile(home).getUserRealms();
    expect(after).toContain(realmUrl);

    // A real remove afterwards still succeeds.
    let stillThere = await runBoxel(['realm', 'remove', realmUrl, '--yes'], {
      home,
    });
    expect(stillThere.ok, stillThere.stderr).toBe(true);
    expect(stillThere.stdout).toContain('Removed:');
  });

  it('normalizes trailing-slash on input', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);

    let withoutSlash = realmUrl.replace(/\/$/, '');
    let res = await runBoxel(['realm', 'remove', withoutSlash, '--yes'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain('Removed:');
    expect(res.stdout).toContain(realmUrl);

    let after = await reloadProfile(home).getUserRealms();
    expect(after).not.toContain(realmUrl);
  });

  it('removes legacy duplicate entries (with and without trailing slash)', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let withoutSlash = realmUrl.replace(/\/$/, '');

    // createRealm adds the trailing-slash form. Inject the trailing-slash-less
    // form directly so the list looks like a legacy account_data with both
    // shapes for the same realm.
    await profileManager.addToUserRealms(withoutSlash);
    let beforeRemove = await reloadProfile(home).getUserRealms();
    expect(beforeRemove).toContain(realmUrl);
    expect(beforeRemove).toContain(withoutSlash);

    let res = await runBoxel(['realm', 'remove', realmUrl, '--yes'], { home });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain('Removed:');
    // Both duplicate entries are removed: previousCount - nextCount == 2.
    expect(res.stdout).toContain(
      `app.boxel.realms: ${beforeRemove.length} -> ${beforeRemove.length - 2}`,
    );

    let after = await reloadProfile(home).getUserRealms();
    expect(after).not.toContain(realmUrl);
    expect(after).not.toContain(withoutSlash);
  });

  it('fails with a 403 error when the caller does not own the realm', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);

    let userBSuffix = `userb-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)}`;
    let userBUsername = `cli-test-${userBSuffix}`;
    let userBPassword = 'test-password-userb';
    await registerUser({
      matrixURL,
      displayname: 'CLI Test User B',
      username: userBUsername,
      password: userBPassword,
      registrationSecret: matrixRegistrationSecret,
    });

    let userBHome = createTestHome();
    try {
      await userBHome.profileManager.addProfile(
        `@${userBUsername}:localhost`,
        userBPassword,
        'CLI Test User B',
        matrixURL.href,
        `${TEST_REALM_SERVER_URL}/`,
      );
      await userBHome.profileManager.addToUserRealms(realmUrl);

      let res = await runBoxel(['realm', 'remove', realmUrl, '--yes'], {
        home: userBHome.home,
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/403/);
      expect(res.stderr).toMatch(/do not own this realm/);

      let listAfter = await reloadProfile(home).getUserRealms();
      expect(listAfter).toContain(realmUrl);
    } finally {
      userBHome.cleanup();
    }

    let cleanup = await runBoxel(['realm', 'remove', realmUrl, '--yes'], {
      home,
    });
    expect(cleanup.ok, cleanup.stderr).toBe(true);
  });

  it('returns an error when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        ['realm', 'remove', `${TEST_REALM_SERVER_URL}/anything/`, '--yes'],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
