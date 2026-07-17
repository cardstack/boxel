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
  createTestRealmViaCli,
  registerUser,
  matrixURL,
  matrixRegistrationSecret,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel realm archive <url> --yes` and `boxel realm restore <url>` are
// owner-only mutations that print a human confirmation line and exit
// non-zero on failure. We drive the installed binary and verify the
// resulting archived/restored state via `realm list --json`.

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

describe('realm archive (integration)', () => {
  it('archives a realm for the owner', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);

    let res = await runBoxel(['realm', 'archive', realmUrl, '--yes'], { home });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain('Archived:');
    expect(res.stdout).toContain(realmUrl);

    let listed = await listCli(['--include-archived']);
    let entry = listed.realms.find((r) => r.url === realmUrl);
    expect(entry?.archived).toBe(true);
  });

  it('normalizes a trailing-slash-less input', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);

    let withoutSlash = realmUrl.replace(/\/$/, '');
    let res = await runBoxel(['realm', 'archive', withoutSlash, '--yes'], {
      home,
    });
    expect(res.ok, res.stderr).toBe(true);
    // The command normalizes and echoes the trailing-slash form.
    expect(res.stdout).toContain(realmUrl);

    let listed = await listCli(['--include-archived']);
    let entry = listed.realms.find((r) => r.url === realmUrl);
    expect(entry?.archived).toBe(true);
  });

  it('returns a 403 error when the caller does not own the realm', async () => {
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

      let res = await runBoxel(['realm', 'archive', realmUrl, '--yes'], {
        home: userBHome.home,
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/403/);
      expect(res.stderr).toMatch(/do not own this realm/);
    } finally {
      userBHome.cleanup();
    }
  });

  it('returns an error when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        ['realm', 'archive', `${TEST_REALM_SERVER_URL}/anything/`, '--yes'],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});

describe('realm restore (integration)', () => {
  it('restores a previously archived realm for the owner', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let archive = await runBoxel(['realm', 'archive', realmUrl, '--yes'], {
      home,
    });
    expect(archive.ok, archive.stderr).toBe(true);

    let res = await runBoxel(['realm', 'restore', realmUrl], { home });
    expect(res.ok, res.stderr).toBe(true);
    expect(res.stdout).toContain('Restored:');
    expect(res.stdout).toContain(realmUrl);

    // A restored realm is no longer archived and reappears in the default
    // (non-archived) list.
    let listed = await listCli();
    expect(listed.realms.map((r) => r.url)).toContain(realmUrl);
  });

  it('returns a 403 error when the caller does not own the realm', async () => {
    let { realmUrl } = await createTestRealmViaCli(home);
    let archive = await runBoxel(['realm', 'archive', realmUrl, '--yes'], {
      home,
    });
    expect(archive.ok, archive.stderr).toBe(true);

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

      let res = await runBoxel(['realm', 'restore', realmUrl], {
        home: userBHome.home,
      });

      expect(res.exitCode).toBe(1);
      expect(res.stderr).toMatch(/403/);
      expect(res.stderr).toMatch(/do not own this realm/);
    } finally {
      userBHome.cleanup();
    }

    // Cleanup: restore the realm so it doesn't leak into other tests.
    await runBoxel(['realm', 'restore', realmUrl], { home });
  });

  it('returns an error when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        ['realm', 'restore', `${TEST_REALM_SERVER_URL}/anything/`],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
