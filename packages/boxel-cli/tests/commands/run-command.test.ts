import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProfileManager } from '../../src/lib/profile-manager.js';
import { runCommand, type RunCommandResult } from '../../src/commands/run-command.js';

function makeJsonApiResponse(
  status: string,
  cardResultString?: string | null,
  error?: string | null,
) {
  return {
    data: {
      type: 'run-command-result',
      attributes: {
        status,
        cardResultString: cardResultString ?? null,
        error: error ?? null,
      },
    },
  };
}

function mockResponse(
  body: unknown,
  httpStatus = 200,
  ok = true,
): Response {
  return {
    ok,
    status: httpStatus,
    statusText: ok ? 'OK' : 'Error',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
    redirected: false,
    type: 'basic',
    url: '',
    clone: () => mockResponse(body, httpStatus, ok),
    body: null,
    bodyUsed: false,
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
    bytes: async () => new Uint8Array(),
  } as Response;
}

describe('runCommand', () => {
  let tmpDir: string;
  let profileManager: ProfileManager;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-runcmd-test-'));
    profileManager = new ProfileManager(tmpDir);

    // Add a profile manually to avoid real Matrix login
    let configPath = path.join(tmpDir, 'profiles.json');
    let config = {
      activeProfile: '@testuser:stack.cards',
      profiles: {
        '@testuser:stack.cards': {
          displayName: 'Test User',
          password: 'pass',
          matrixUrl: 'https://matrix-staging.stack.cards',
          realmServerUrl: 'https://realms-staging.stack.cards/',
          realmServerToken: 'mock-server-token',
          realmTokens: {},
        },
      },
    };
    fs.writeFileSync(configPath, JSON.stringify(config));
    profileManager = new ProfileManager(tmpDir);

    fetchSpy = vi.fn();
    profileManager.authedRealmServerFetch = fetchSpy;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('sends correct JSON:API request and returns ready result', async () => {
    let resultPayload = makeJsonApiResponse(
      'ready',
      '{"schema": {"type": "object"}}',
    );
    fetchSpy.mockResolvedValue(mockResponse(resultPayload));

    let result = await runCommand(
      '@cardstack/boxel-host/commands/get-card-type-schema/default',
      'http://localhost:4201/test/',
      {
        input: { cardURL: 'http://localhost:4201/test/MyCard' },
        profileManager,
      },
    );

    expect(result).toEqual({
      status: 'ready',
      result: '{"schema": {"type": "object"}}',
      error: null,
    });

    // Verify the request shape
    expect(fetchSpy).toHaveBeenCalledOnce();
    let [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://realms-staging.stack.cards/_run-command');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/vnd.api+json');
    expect(init.headers['Accept']).toBe('application/vnd.api+json');

    let body = JSON.parse(init.body);
    expect(body).toEqual({
      data: {
        type: 'run-command',
        attributes: {
          realmURL: 'http://localhost:4201/test/',
          command:
            '@cardstack/boxel-host/commands/get-card-type-schema/default',
          commandInput: { cardURL: 'http://localhost:4201/test/MyCard' },
        },
      },
    });
  });

  it('sends null commandInput when no input provided', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(makeJsonApiResponse('ready')),
    );

    await runCommand('some-command', 'http://localhost:4201/test/', {
      profileManager,
    });

    let body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data.attributes.commandInput).toBeNull();
  });

  it('returns error result when command returns error status', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(makeJsonApiResponse('error', null, 'Command failed: timeout')),
    );

    let result = await runCommand('some-command', 'http://localhost:4201/test/', {
      profileManager,
    });

    expect(result).toEqual({
      status: 'error',
      result: null,
      error: 'Command failed: timeout',
    });
  });

  it('returns unusable status', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(makeJsonApiResponse('unusable', null, 'Prerenderer unavailable')),
    );

    let result = await runCommand('some-command', 'http://localhost:4201/test/', {
      profileManager,
    });

    expect(result.status).toBe('unusable');
    expect(result.error).toBe('Prerenderer unavailable');
  });

  it('handles HTTP error responses gracefully', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse('Internal Server Error', 500, false),
    );

    let result = await runCommand('some-command', 'http://localhost:4201/test/', {
      profileManager,
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('run-command HTTP 500');
  });

  it('handles network failure gracefully', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    let result = await runCommand('some-command', 'http://localhost:4201/test/', {
      profileManager,
    });

    expect(result.status).toBe('error');
    expect(result.error).toContain('run-command fetch failed');
    expect(result.error).toContain('ECONNREFUSED');
  });

  it('throws when no active profile', async () => {
    let emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-empty-'));
    let emptyManager = new ProfileManager(emptyDir);

    await expect(
      runCommand('some-command', 'http://localhost:4201/test/', {
        profileManager: emptyManager,
      }),
    ).rejects.toThrow('No active profile');

    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('strips trailing slash from realm server URL before appending endpoint', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse(makeJsonApiResponse('ready')),
    );

    await runCommand('some-command', 'http://localhost:4201/test/', {
      profileManager,
    });

    let [url] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://realms-staging.stack.cards/_run-command');
    expect(url).not.toContain('//_run-command');
  });

  it('handles malformed JSON response gracefully', async () => {
    fetchSpy.mockResolvedValue(
      mockResponse({}), // empty JSON, no data.attributes
    );

    let result = await runCommand('some-command', 'http://localhost:4201/test/', {
      profileManager,
    });

    expect(result.status).toBe('error');
    expect(result.result).toBeNull();
  });
});
