import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  ProfileManager,
  getEnvironmentFromMatrixId,
  getUsernameFromMatrixId,
  getDomainFromMatrixId,
  getEnvironmentLabel,
  type ProfileManagerDeps,
} from '../../src/lib/profile-manager.js';
import { MatrixAuthError, type MatrixAuth } from '../../src/lib/auth.js';

// A fake MatrixAuth shaped like what `matrixLogin` would return — used to
// drive the dependency-injection seam without touching a real Matrix server.
function fakeAuth(matrixId: string, matrixUrl: string): MatrixAuth {
  return {
    accessToken: `token-for-${matrixId}`,
    userId: matrixId,
    deviceId: `DEVICE_${matrixId.replace(/[^A-Za-z0-9]/g, '_')}`,
    matrixUrl,
  };
}

function stubLogin(): ProfileManagerDeps {
  return {
    matrixLogin: vi.fn(async (matrixUrl: string, username: string) =>
      fakeAuth(
        `@${username}:${new URL(matrixUrl).hostname.replace(/^matrix[-.]/, '')}`,
        matrixUrl,
      ),
    ),
  };
}

describe('ProfileManager', () => {
  let tmpDir: string;
  let manager: ProfileManager;
  let loginStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-test-'));
    loginStub = vi.fn(async (matrixUrl: string, username: string) =>
      fakeAuth(`@${username}:stack.cards`, matrixUrl),
    );
    manager = new ProfileManager(tmpDir, { matrixLogin: loginStub });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('starts with no profiles', () => {
    expect(manager.listProfiles()).toEqual([]);
    expect(manager.getActiveProfileId()).toBeNull();
    expect(manager.getActiveProfile()).toBeNull();
  });

  it('addProfile logs in once and stores tokens (not password)', async () => {
    await manager.addProfile(
      '@testuser:stack.cards',
      'password123',
      'Test User',
    );

    expect(loginStub).toHaveBeenCalledOnce();
    expect(loginStub).toHaveBeenCalledWith(
      'https://matrix-staging.stack.cards',
      'testuser',
      'password123',
    );

    const profile = manager.getProfile('@testuser:stack.cards')!;
    expect(profile.displayName).toBe('Test User');
    expect(profile.matrixAccessToken).toBe('token-for-@testuser:stack.cards');
    expect(profile.matrixUserId).toBe('@testuser:stack.cards');
    expect(profile.matrixDeviceId).toBe('DEVICE__testuser_stack_cards');
    expect(profile.matrixUrl).toBe('https://matrix-staging.stack.cards');
    expect(profile.realmServerUrl).toBe('https://realms-staging.stack.cards/');
    // The password must never end up on the persisted Profile.
    expect((profile as { password?: string }).password).toBeUndefined();

    const onDisk = JSON.parse(
      fs.readFileSync(path.join(tmpDir, 'profiles.json'), 'utf-8'),
    );
    expect(onDisk.profiles['@testuser:stack.cards'].password).toBeUndefined();
    expect(onDisk.profiles['@testuser:stack.cards'].matrixAccessToken).toBe(
      'token-for-@testuser:stack.cards',
    );
  });

  it('addProfile rejects when Matrix returns a different userId than the matrixId', async () => {
    loginStub.mockResolvedValueOnce({
      accessToken: 't',
      deviceId: 'd',
      userId: '@someoneelse:stack.cards',
      matrixUrl: 'https://matrix-staging.stack.cards',
    });

    await expect(
      manager.addProfile('@testuser:stack.cards', 'pw'),
    ).rejects.toThrow(/Matrix returned userId.*@someoneelse/);
  });

  it('addProfileWithAuth persists tokens without invoking matrixLogin', async () => {
    await manager.addProfileWithAuth(
      '@bob:stack.cards',
      fakeAuth('@bob:stack.cards', 'https://matrix-staging.stack.cards'),
      'Bob',
    );
    expect(loginStub).not.toHaveBeenCalled();
    const profile = manager.getProfile('@bob:stack.cards')!;
    expect(profile.matrixAccessToken).toBe('token-for-@bob:stack.cards');
    expect(profile.matrixUserId).toBe('@bob:stack.cards');
    expect(profile.matrixDeviceId).toBe('DEVICE__bob_stack_cards');
  });

  it('addProfileWithAuth preserves cached realm tokens when re-adding a profile', async () => {
    await manager.addProfileWithAuth(
      '@bob:stack.cards',
      fakeAuth('@bob:stack.cards', 'https://matrix-staging.stack.cards'),
    );
    manager.setRealmServerToken('cached-server-token');
    manager.setRealmToken('https://realms-staging.stack.cards/r/', 'realm-jwt');

    await manager.addProfileWithAuth('@bob:stack.cards', {
      ...fakeAuth('@bob:stack.cards', 'https://matrix-staging.stack.cards'),
      accessToken: 'new-token',
    });

    expect(manager.getRealmServerToken()).toBe('cached-server-token');
    expect(manager.getRealmToken('https://realms-staging.stack.cards/r/')).toBe(
      'realm-jwt',
    );
    const profile = manager.getProfile('@bob:stack.cards')!;
    expect(profile.matrixAccessToken).toBe('new-token');
  });

  it('addProfileWithAuth clears cached realm tokens when matrixUrl changes', async () => {
    await manager.addProfileWithAuth(
      '@bob:stack.cards',
      fakeAuth('@bob:stack.cards', 'https://matrix-staging.stack.cards'),
    );
    manager.setRealmServerToken('cached-server-token');
    manager.setRealmToken('https://realms-staging.stack.cards/r/', 'realm-jwt');

    await manager.addProfileWithAuth('@bob:stack.cards', {
      ...fakeAuth('@bob:stack.cards', 'https://matrix.new-host.example'),
      matrixUrl: 'https://matrix.new-host.example',
    });

    const profile = manager.getProfile('@bob:stack.cards')!;
    expect(profile.matrixUrl).toBe('https://matrix.new-host.example');
    expect(profile.realmTokens).toBeUndefined();
    expect(profile.realmServerToken).toBeUndefined();
  });

  it('addProfileWithAuth clears cached realm tokens when realmServerUrl changes', async () => {
    await manager.addProfileWithAuth(
      '@bob:stack.cards',
      fakeAuth('@bob:stack.cards', 'https://matrix-staging.stack.cards'),
    );
    manager.setRealmServerToken('cached-server-token');
    manager.setRealmToken('https://realms-staging.stack.cards/r/', 'realm-jwt');

    await manager.addProfileWithAuth(
      '@bob:stack.cards',
      fakeAuth('@bob:stack.cards', 'https://matrix-staging.stack.cards'),
      undefined,
      'https://realms.new-host.example/',
    );

    const profile = manager.getProfile('@bob:stack.cards')!;
    expect(profile.realmServerUrl).toBe('https://realms.new-host.example/');
    expect(profile.realmTokens).toBeUndefined();
    expect(profile.realmServerToken).toBeUndefined();
  });

  it('addProfile preserves the stored displayName when called without one on re-auth', async () => {
    await manager.addProfile('@testuser:stack.cards', 'pass1', 'Custom Name');

    await manager.addProfile('@testuser:stack.cards', 'pass2');

    const profile = manager.getProfile('@testuser:stack.cards')!;
    expect(profile.displayName).toBe('Custom Name');
  });

  it('addProfile preserves the stored URLs when re-auth omits URL args', async () => {
    loginStub.mockImplementation(async (matrixUrl: string) =>
      fakeAuth('@alice:custom.domain', matrixUrl),
    );
    await manager.addProfile(
      '@alice:custom.domain',
      'pass1',
      undefined,
      'https://matrix.custom.domain',
      'https://app.custom.domain/',
    );

    await manager.addProfile('@alice:custom.domain', 'pass2');

    const profile = manager.getProfile('@alice:custom.domain')!;
    expect(profile.matrixUrl).toBe('https://matrix.custom.domain');
    expect(profile.realmServerUrl).toBe('https://app.custom.domain/');
  });

  it('uses localhost defaults for @user:localhost', async () => {
    loginStub.mockImplementationOnce(async (matrixUrl: string) =>
      fakeAuth('@dev:localhost', matrixUrl),
    );
    await manager.addProfile('@dev:localhost', 'password123');

    expect(loginStub).toHaveBeenCalledWith(
      'http://localhost:8008',
      'dev',
      'password123',
    );
    const profile = manager.getProfile('@dev:localhost')!;
    expect(profile.matrixUrl).toBe('http://localhost:8008');
    expect(profile.realmServerUrl).toBe('http://localhost:4201/');
  });

  it('adds a production profile with correct defaults', async () => {
    loginStub.mockImplementation(async (matrixUrl: string, username: string) =>
      fakeAuth(`@${username}:boxel.ai`, matrixUrl),
    );
    await manager.addProfile('@testuser:boxel.ai', 'password123');

    const profile = manager.getProfile('@testuser:boxel.ai')!;
    expect(profile.matrixUrl).toBe('https://matrix.boxel.ai');
    expect(profile.realmServerUrl).toBe('https://app.boxel.ai/');
    expect(profile.displayName).toBe('testuser · boxel.ai');
  });

  it('does not change active profile when adding a second profile', async () => {
    await manager.addProfile('@first:stack.cards', 'pass1');
    await manager.addProfile('@second:stack.cards', 'pass2');

    expect(manager.getActiveProfileId()).toBe('@first:stack.cards');
    expect(manager.listProfiles()).toHaveLength(2);
  });

  it('switches active profile', async () => {
    await manager.addProfile('@first:stack.cards', 'pass1');
    await manager.addProfile('@second:stack.cards', 'pass2');

    expect(manager.switchProfile('@second:stack.cards')).toBe(true);
    expect(manager.getActiveProfileId()).toBe('@second:stack.cards');
  });

  it('returns false when switching to nonexistent profile', () => {
    expect(manager.switchProfile('@nonexistent:stack.cards')).toBe(false);
  });

  it('removes a profile', async () => {
    await manager.addProfile('@testuser:stack.cards', 'password123');

    expect(await manager.removeProfile('@testuser:stack.cards')).toBe(true);
    expect(manager.listProfiles()).toEqual([]);
    expect(manager.getActiveProfileId()).toBeNull();
  });

  it('reassigns active profile after removing the active one', async () => {
    await manager.addProfile('@first:stack.cards', 'pass1');
    await manager.addProfile('@second:stack.cards', 'pass2');
    manager.switchProfile('@first:stack.cards');

    await manager.removeProfile('@first:stack.cards');

    expect(manager.getActiveProfileId()).toBe('@second:stack.cards');
  });

  it('returns false when removing nonexistent profile', async () => {
    expect(await manager.removeProfile('@nonexistent:stack.cards')).toBe(false);
  });

  it('persists profiles to disk', async () => {
    await manager.addProfile(
      '@testuser:stack.cards',
      'password123',
      'Test User',
    );

    const manager2 = new ProfileManager(tmpDir);
    expect(manager2.listProfiles()).toEqual(['@testuser:stack.cards']);
    expect(manager2.getActiveProfileId()).toBe('@testuser:stack.cards');

    const profile = manager2.getProfile('@testuser:stack.cards')!;
    expect(profile.matrixAccessToken).toBe('token-for-@testuser:stack.cards');
  });

  it.skipIf(process.platform === 'win32')(
    'sets file permissions to 0600',
    async () => {
      await manager.addProfile('@testuser:stack.cards', 'password123');

      const profilesFile = path.join(tmpDir, 'profiles.json');
      const stats = fs.statSync(profilesFile);
      const mode = stats.mode & 0o777;
      expect(mode).toBe(0o600);
    },
  );

  it('updates display name for existing profile', async () => {
    await manager.addProfile('@testuser:stack.cards', 'pass', 'Old Name');

    expect(manager.updateDisplayName('@testuser:stack.cards', 'New Name')).toBe(
      true,
    );

    const profile = manager.getProfile('@testuser:stack.cards');
    expect(profile!.displayName).toBe('New Name');
  });

  it('updateUrls replaces stored URLs and clears cached tokens', async () => {
    await manager.addProfileWithAuth(
      '@testuser:my.server',
      fakeAuth('@testuser:my.server', 'https://matrix.old.server'),
      undefined,
      'https://realms.old.server/',
    );
    manager.setRealmServerToken('cached-server-token');
    manager.setRealmToken('https://realms.old.server/r/', 'cached-realm-token');

    const changed = manager.updateUrls('@testuser:my.server', {
      matrixUrl: 'https://matrix.new.server',
      realmServerUrl: 'https://realms.new.server/',
    });

    expect(changed).toBe(true);
    const profile = manager.getProfile('@testuser:my.server')!;
    expect(profile.matrixUrl).toBe('https://matrix.new.server');
    expect(profile.realmServerUrl).toBe('https://realms.new.server/');
    expect(profile.realmTokens).toBeUndefined();
    expect(profile.realmServerToken).toBeUndefined();
  });

  it('handles corrupted config file gracefully', async () => {
    const profilesFile = path.join(tmpDir, 'profiles.json');
    fs.writeFileSync(profilesFile, 'not valid json{{{');

    const freshManager = new ProfileManager(tmpDir);
    expect(freshManager.listProfiles()).toEqual([]);
  });

  it('handles valid JSON with invalid shape gracefully', () => {
    const profilesFile = path.join(tmpDir, 'profiles.json');
    fs.writeFileSync(profilesFile, JSON.stringify({ foo: 'bar' }));

    const freshManager = new ProfileManager(tmpDir);
    expect(freshManager.listProfiles()).toEqual([]);
  });

  it('rejects unknown domains without explicit URLs', async () => {
    await expect(
      manager.addProfile('@alice:custom.domain', 'password123'),
    ).rejects.toThrow(/Unknown domain/);
  });

  it('allows unknown domains with explicit URLs', async () => {
    loginStub.mockImplementationOnce(async (matrixUrl: string) =>
      fakeAuth('@alice:custom.domain', matrixUrl),
    );
    await manager.addProfile(
      '@alice:custom.domain',
      'password123',
      undefined,
      'https://matrix.custom.domain',
      'https://app.custom.domain/',
    );

    const profile = manager.getProfile('@alice:custom.domain');
    expect(profile).toBeDefined();
    expect(profile!.matrixUrl).toBe('https://matrix.custom.domain');
    expect(profile!.realmServerUrl).toBe('https://app.custom.domain/');
  });
});

describe('getStoredMatrixAuth', () => {
  let tmpDir: string;
  let manager: ProfileManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-test-'));
    manager = new ProfileManager(tmpDir, stubLogin());
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns the stored MatrixAuth for the active profile', async () => {
    await manager.addProfileWithAuth(
      '@user:stack.cards',
      fakeAuth('@user:stack.cards', 'https://matrix-staging.stack.cards'),
    );

    const auth = manager.getStoredMatrixAuth();
    expect(auth.accessToken).toBe('token-for-@user:stack.cards');
    expect(auth.userId).toBe('@user:stack.cards');
    expect(auth.deviceId).toBe('DEVICE__user_stack_cards');
    expect(auth.matrixUrl).toBe('https://matrix-staging.stack.cards');
  });

  it('returns the stored MatrixAuth for an explicit profileId', async () => {
    await manager.addProfileWithAuth(
      '@first:stack.cards',
      fakeAuth('@first:stack.cards', 'https://matrix-staging.stack.cards'),
    );
    await manager.addProfileWithAuth(
      '@second:stack.cards',
      fakeAuth('@second:stack.cards', 'https://matrix-staging.stack.cards'),
    );

    const auth = manager.getStoredMatrixAuth('@second:stack.cards');
    expect(auth.userId).toBe('@second:stack.cards');
  });

  it('throws when no profile is active', () => {
    expect(() => manager.getStoredMatrixAuth()).toThrow(/No active profile/);
  });

  it('throws a "re-authenticate" error for a profile with no stored access token', () => {
    // A pre-CS-10725 profile on disk: matrix URL set but no access token.
    fs.writeFileSync(
      path.join(tmpDir, 'profiles.json'),
      JSON.stringify(
        {
          activeProfile: '@legacy:stack.cards',
          profiles: {
            '@legacy:stack.cards': {
              displayName: 'Legacy',
              matrixUrl: 'https://matrix-staging.stack.cards',
              realmServerUrl: 'https://realms-staging.stack.cards/',
              password: 'old-password',
            },
          },
        },
        null,
        2,
      ),
    );
    const freshManager = new ProfileManager(tmpDir);
    expect(() => freshManager.getStoredMatrixAuth()).toThrow(
      /no stored Matrix access token.*boxel profile add.*re-authenticate/,
    );
  });
});

describe('reAuthenticate', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('throws a clear error when stdin is not a TTY', async () => {
    const manager = new ProfileManager(tmpDir, {
      ...stubLogin(),
      isTty: () => false,
    });
    await manager.addProfileWithAuth(
      '@user:stack.cards',
      fakeAuth('@user:stack.cards', 'https://matrix-staging.stack.cards'),
    );

    await expect(manager.reAuthenticate()).rejects.toThrow(
      /no longer valid.*boxel profile add/,
    );
  });

  it('prompts for password, re-runs matrixLogin, and writes new tokens on TTY', async () => {
    const loginStub = vi.fn(async () => ({
      accessToken: 'fresh-token',
      userId: '@user:stack.cards',
      deviceId: 'FRESH_DEVICE',
      matrixUrl: 'https://matrix-staging.stack.cards',
    }));
    const promptStub = vi.fn(async () => 'typed-password');
    const manager = new ProfileManager(tmpDir, {
      matrixLogin: loginStub,
      promptPassword: promptStub,
      isTty: () => true,
    });
    await manager.addProfileWithAuth(
      '@user:stack.cards',
      fakeAuth('@user:stack.cards', 'https://matrix-staging.stack.cards'),
    );

    const fresh = await manager.reAuthenticate();

    expect(promptStub).toHaveBeenCalledOnce();
    expect(loginStub).toHaveBeenCalledWith(
      'https://matrix-staging.stack.cards',
      'user',
      'typed-password',
    );
    expect(fresh.accessToken).toBe('fresh-token');
    expect(manager.getProfile('@user:stack.cards')!.matrixAccessToken).toBe(
      'fresh-token',
    );
  });

  it('refreshServerToken recovers from a 401 by re-authenticating once', async () => {
    let loginCount = 0;
    const loginStub = vi.fn(async () => {
      loginCount += 1;
      return {
        accessToken: `token-v${loginCount}`,
        userId: '@user:stack.cards',
        deviceId: `DEV${loginCount}`,
        matrixUrl: 'https://matrix-staging.stack.cards',
      };
    });
    const promptStub = vi.fn(async () => 'typed-password');
    const manager = new ProfileManager(tmpDir, {
      matrixLogin: loginStub,
      promptPassword: promptStub,
      isTty: () => true,
    });
    await manager.addProfileWithAuth(
      '@user:stack.cards',
      fakeAuth('@user:stack.cards', 'https://matrix-staging.stack.cards'),
    );

    // Stub global fetch: first call to OpenID returns 401, after re-auth it
    // succeeds; subsequent /_server-session returns a JWT in the
    // Authorization header.
    let openIdCount = 0;
    const fetchStub = vi.fn(async (input: any) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.includes('/openid/request_token')) {
        openIdCount += 1;
        if (openIdCount === 1) {
          return new Response('expired', { status: 401 });
        }
        return new Response(JSON.stringify({ token: 'oid' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/_server-session')) {
        return new Response('{}', {
          status: 200,
          headers: { Authorization: 'realm-jwt' },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchStub);
    try {
      const token = await manager.refreshServerToken();
      expect(token).toBe('realm-jwt');
      // Should have re-authed exactly once.
      expect(promptStub).toHaveBeenCalledOnce();
      expect(manager.getProfile('@user:stack.cards')!.matrixAccessToken).toBe(
        'token-v1',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('removeFromUserRealms recovers from a 401 on the PUT by re-authenticating once', async () => {
    // The PUT to /account_data/.../m.boxel.realms used to throw a generic
    // Error on 401/403, so withMatrixAuthRecovery couldn't recover. After
    // the fix it throws MatrixAuthError and the operation retries against
    // freshly-minted credentials.
    let loginCount = 0;
    const loginStub = vi.fn(async () => {
      loginCount += 1;
      return {
        accessToken: `token-v${loginCount}`,
        userId: '@user:stack.cards',
        deviceId: `DEV${loginCount}`,
        matrixUrl: 'https://matrix-staging.stack.cards',
      };
    });
    const promptStub = vi.fn(async () => 'typed-password');
    const manager = new ProfileManager(tmpDir, {
      matrixLogin: loginStub,
      promptPassword: promptStub,
      isTty: () => true,
    });
    await manager.addProfileWithAuth(
      '@user:stack.cards',
      fakeAuth('@user:stack.cards', 'https://matrix-staging.stack.cards'),
    );

    const realmToRemove = 'https://realms.example/my-realm/';
    let putCount = 0;
    const fetchStub = vi.fn(async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const method = init?.method ?? 'GET';
      if (url.includes('/account_data/') && method === 'GET') {
        return new Response(JSON.stringify({ realms: [realmToRemove] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/account_data/') && method === 'PUT') {
        putCount += 1;
        if (putCount === 1) {
          return new Response('expired', { status: 401 });
        }
        return new Response('', { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${method} ${url}`);
    });
    vi.stubGlobal('fetch', fetchStub);
    try {
      const removed = await manager.removeFromUserRealms(realmToRemove);
      expect(removed).toBe(true);
      expect(promptStub).toHaveBeenCalledOnce();
      expect(putCount).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('token storage', () => {
  let tmpDir: string;
  let manager: ProfileManager;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boxel-profile-test-'));
    manager = new ProfileManager(tmpDir, stubLogin());
    await manager.addProfileWithAuth(
      '@test:localhost',
      fakeAuth('@test:localhost', 'http://localhost:8008'),
      'Test',
      'http://localhost:4201/',
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('stores and retrieves a realm token', () => {
    manager.setRealmToken('http://localhost:4201/my-realm/', 'jwt-123');
    expect(manager.getRealmToken('http://localhost:4201/my-realm/')).toBe(
      'jwt-123',
    );
  });

  it('stores and retrieves a realm server token', () => {
    manager.setRealmServerToken('server-jwt-456');
    expect(manager.getRealmServerToken()).toBe('server-jwt-456');
  });

  it('persists realm tokens to disk', () => {
    manager.setRealmToken('http://localhost:4201/my-realm/', 'jwt-123');

    let manager2 = new ProfileManager(tmpDir);
    expect(manager2.getRealmToken('http://localhost:4201/my-realm/')).toBe(
      'jwt-123',
    );
  });

  it('persists realm server token to disk', () => {
    manager.setRealmServerToken('server-jwt-456');

    let manager2 = new ProfileManager(tmpDir);
    expect(manager2.getRealmServerToken()).toBe('server-jwt-456');
  });

  it('returns undefined for unknown realm token', () => {
    expect(
      manager.getRealmToken('http://localhost:4201/nonexistent/'),
    ).toBeUndefined();
  });

  it('returns undefined for realm server token when not set', () => {
    expect(manager.getRealmServerToken()).toBeUndefined();
  });
});

describe('environment helpers', () => {
  it('detects staging environment', () => {
    expect(getEnvironmentFromMatrixId('@user:stack.cards')).toBe('staging');
  });

  it('detects production environment', () => {
    expect(getEnvironmentFromMatrixId('@user:boxel.ai')).toBe('production');
  });

  it('detects unknown environment', () => {
    expect(getEnvironmentFromMatrixId('@user:other.domain')).toBe('unknown');
  });

  it('extracts username from matrix ID', () => {
    expect(getUsernameFromMatrixId('@ctse:stack.cards')).toBe('ctse');
    expect(getUsernameFromMatrixId('@aallen90:boxel.ai')).toBe('aallen90');
  });

  it('extracts domain from matrix ID', () => {
    expect(getDomainFromMatrixId('@user:stack.cards')).toBe('stack.cards');
    expect(getDomainFromMatrixId('@user:boxel.ai')).toBe('boxel.ai');
  });

  it('returns correct short labels', () => {
    expect(getEnvironmentLabel('staging')).toBe('stack.cards');
    expect(getEnvironmentLabel('production')).toBe('boxel.ai');
    expect(getEnvironmentLabel('unknown')).toBe('unknown');
  });
});

describe('MatrixAuthError integration', () => {
  it('is throwable and identifiable via instanceof', () => {
    const err = new MatrixAuthError(401, 'rejected');
    expect(err).toBeInstanceOf(MatrixAuthError);
    expect(err.status).toBe(401);
  });
});
