import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { cancelIndexing } from '../../src/commands/realm/cancel-indexing.ts';
import type { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  TEST_REALM_SERVER_URL,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// Drives `boxel realm cancel-indexing --realm <url>` as a subprocess. The
// command POSTs `{ cancelPending }` to `<realm>/_cancel-indexing-job`
// (running-only by default; `--cancel-pending` also drains the queue) and
// exits 0 on the server's 2xx, 1 with the reason on stderr otherwise.
// Because the request body isn't observable across the process boundary,
// the two flag forms are exercised end-to-end (each hits a distinct server
// branch) rather than asserted on the wire.

let home: string;
let cleanupProfile: () => void;
let realmUrl: string;
// Retained for the one white-box case below (mocking a non-2xx realm
// response) — impossible to reproduce across the subprocess boundary, so
// it stays an in-process call against the command function.
let profileManager: ProfileManager;

beforeAll(async () => {
  await startTestRealmServer();
  realmUrl = `${TEST_REALM_SERVER_URL}/test/`;
  let testHome = createTestHome();
  home = testHome.home;
  cleanupProfile = testHome.cleanup;
  profileManager = testHome.profileManager;
  await setupTestProfile(profileManager);
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('realm cancel-indexing (integration)', () => {
  it('cancels indexing on a running realm and returns ok', async () => {
    let res = await runBoxel(
      ['realm', 'cancel-indexing', '--realm', realmUrl],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
  });

  it('returns error for an unreachable realm', async () => {
    let res = await runBoxel(
      ['realm', 'cancel-indexing', '--realm', 'http://127.0.0.1:1/fake/'],
      { home },
    );
    expect(res.exitCode).toBe(1);
    expect(res.stderr).not.toBe('');
  });

  it('cancels running-only by default (no --cancel-pending)', async () => {
    let res = await runBoxel(
      ['realm', 'cancel-indexing', '--realm', realmUrl],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
  });

  it('cancels running and pending jobs when --cancel-pending is set', async () => {
    let res = await runBoxel(
      ['realm', 'cancel-indexing', '--realm', realmUrl, '--cancel-pending'],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
  });

  it('returns an error with HTTP status when the realm responds non-2xx', async () => {
    // White-box: a deterministic non-2xx response can't be produced
    // black-box (an unknown/unauthorized realm makes authedRealmFetch
    // throw, not return a status), so this stays an in-process call with
    // a mocked fetch to cover the error-formatting path.
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmFetch')
      .mockResolvedValueOnce(
        new Response('forbidden', {
          status: 403,
          statusText: 'Forbidden',
        }),
      );
    try {
      let result = await cancelIndexing(realmUrl, { profileManager });
      expect(result.ok).toBe(false);
      expect(result.error).toContain('HTTP 403');
      expect(result.error).toContain('forbidden');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns error result when no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    try {
      let res = await runBoxel(
        ['realm', 'cancel-indexing', '--realm', realmUrl],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });
});
