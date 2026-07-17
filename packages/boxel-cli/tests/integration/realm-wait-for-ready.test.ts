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

// Drives `boxel realm wait-for-ready --realm <url>` as a subprocess. The
// command polls the realm's `_readiness-check` endpoint until it responds
// OK or the `--timeout` elapses, exiting 0 when ready and 1 (with the
// reason on stderr) otherwise.

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;

beforeAll(async () => {
  await startTestRealmServer();
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(testHome.profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm wait-for-ready (integration)', () => {
  it('returns ready for a running realm', async () => {
    let res = await runBoxel(
      ['realm', 'wait-for-ready', '--realm', realmUrl, '--timeout', '5000'],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
  });

  it('returns not ready when realm URL is unreachable', async () => {
    let res = await runBoxel(
      [
        'realm',
        'wait-for-ready',
        '--realm',
        'http://127.0.0.1:1/fake/',
        '--timeout',
        '500',
      ],
      { home },
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).toContain('not ready after');
  });

  it('returns an error when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    // Materialize an empty profile store so the CLI reaches the
    // no-active-profile guard rather than any first-run bootstrapping.
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        ['realm', 'wait-for-ready', '--realm', realmUrl],
        {
          home: emptyHome,
        },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
