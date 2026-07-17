import '../helpers/setup-realm-server.ts';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runCommand,
  type RunCommandResult,
} from '../../src/commands/run-command.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import {
  startTestRealmServer,
  stopTestRealmServer,
  createTestHome,
  setupTestProfile,
  createTestRealmViaCli,
} from '../helpers/integration.ts';
import { runBoxel } from '../helpers/run-boxel.ts';

// `boxel run-command <command-specifier> --realm <url> [--input <json>]
// [--json]` executes a host command on the realm server. We drive the
// installed binary for the observable behaviors (a ready result,
// no-profile). The remaining assertions inspect the exact JSON:API
// request the command function builds or force HTTP/transport failures
// via a fetch mock — surfaces only reachable in-process — so they stay
// as in-process spies on the command function.

let home: string;
let profileManager: ProfileManager;
let cleanupProfile: () => void;
let realmUrl: string;

beforeAll(async () => {
  await startTestRealmServer();

  let testHome = createTestHome();
  home = testHome.home;
  profileManager = testHome.profileManager;
  cleanupProfile = testHome.cleanup;
  await setupTestProfile(profileManager);

  ({ realmUrl } = await createTestRealmViaCli(home));
});

afterAll(async () => {
  cleanupProfile?.();
  await stopTestRealmServer();
});

describe('run-command (integration)', () => {
  it('executes a command and returns a ready result', async () => {
    let res = await runBoxel(
      [
        'run-command',
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        '--realm',
        realmUrl,
        '--json',
      ],
      { home },
    );
    expect(res.ok, res.stderr).toBe(true);
    let result = res.json<RunCommandResult>();
    expect(result.status).toBe('ready');
  });

  it('sends correct JSON:API request shape', async () => {
    // White-box: the outgoing request body isn't observable across the
    // subprocess boundary, so this stays an in-process spy on the
    // command function.
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmServerFetch');
    try {
      await runCommand(
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        realmUrl,
        {
          input: { cardURL: `${realmUrl}MyCard` },
          profileManager,
        },
      );

      expect(fetchSpy).toHaveBeenCalledOnce();
      let [url, init] = fetchSpy.mock.calls[0];
      expect(url).toContain('/_run-command');
      expect(init!.method).toBe('POST');
      let headers = init!.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/vnd.api+json');
      expect(headers['Accept']).toBe('application/vnd.api+json');

      let body = JSON.parse(init!.body as string);
      expect(body).toEqual({
        data: {
          type: 'run-command',
          attributes: {
            realmURL: realmUrl,
            command:
              '@cardstack/boxel-host/commands/get-card-type-schema/default',
            commandInput: { cardURL: `${realmUrl}MyCard` },
          },
        },
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('sends null commandInput when no input provided', async () => {
    // White-box: see note on request-shape test above.
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmServerFetch');
    try {
      await runCommand(
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        realmUrl,
        { profileManager },
      );

      let body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
      expect(body.data.attributes.commandInput).toBeNull();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('exits non-zero with a clear error when there is no active profile', async () => {
    let emptyHome = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    // Materialize an empty profile store so the CLI reaches the
    // no-active-profile guard rather than any first-run bootstrapping.
    new ProfileManager(path.join(emptyHome, '.boxel-cli'));
    try {
      let res = await runBoxel(
        [
          'run-command',
          '@cardstack/boxel-host/commands/get-card-type-schema/default',
          '--realm',
          realmUrl,
        ],
        { home: emptyHome },
      );
      expect(res.exitCode).toBe(1);
      expect(res.stderr).toContain('No active profile');
    } finally {
      fs.rmSync(emptyHome, { recursive: true, force: true });
    }
  });

  it('returns error status on non-2xx HTTP response', async () => {
    // White-box: mocks the transport to a controlled HTTP failure, only
    // possible in-process.
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmServerFetch')
      .mockResolvedValueOnce(new Response('Not Found', { status: 404 }));
    try {
      let result = await runCommand('some/command', realmUrl, {
        profileManager,
      });
      expect(result.status).toBe('error');
      expect(result.error).toContain('404');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns error status when response body is not valid JSON', async () => {
    // White-box: mocks the transport, only possible in-process.
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmServerFetch')
      .mockResolvedValueOnce(new Response('not json', { status: 200 }));
    try {
      let result = await runCommand('some/command', realmUrl, {
        profileManager,
      });
      expect(result.status).toBe('error');
      expect(result.error).toContain('not valid JSON');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('returns error status when fetch throws', async () => {
    // White-box: forces the transport to reject, only possible
    // in-process.
    let fetchSpy = vi
      .spyOn(profileManager, 'authedRealmServerFetch')
      .mockRejectedValueOnce(new Error('network failure'));
    try {
      let result = await runCommand('some/command', realmUrl, {
        profileManager,
      });
      expect(result.status).toBe('error');
      expect(result.error).toContain('network failure');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('strips trailing slash from realm server URL before appending endpoint', async () => {
    // White-box: inspects the URL the command function builds, only
    // observable in-process.
    let fetchSpy = vi.spyOn(profileManager, 'authedRealmServerFetch');
    try {
      await runCommand(
        '@cardstack/boxel-host/commands/get-card-type-schema/default',
        realmUrl,
        { profileManager },
      );

      let [url] = fetchSpy.mock.calls[0];
      expect(url).toContain('/_run-command');
      expect(url).not.toContain('//_run-command');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
