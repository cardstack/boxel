import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRealm } from '../../src/commands/realm/create.js';

let mockProfile = {
  displayName: 'Test User',
  matrixUrl: 'https://matrix.example.com',
  realmServerUrl: 'https://realm.example.com',
  password: 'test-password',
};

let mockSetRealmToken = vi.fn();
let mockSetRealmServerToken = vi.fn();
let mockGetRealmServerToken = vi.fn().mockReturnValue(undefined);

vi.mock('../../src/lib/profile-manager.js', () => ({
  getProfileManager: () => ({
    getActiveProfile: () => ({
      id: '@testuser:example.com',
      profile: mockProfile,
    }),
    setRealmToken: mockSetRealmToken,
    setRealmServerToken: mockSetRealmServerToken,
    getRealmServerToken: (...args: unknown[]) => mockGetRealmServerToken(...args),
  }),
  getUsernameFromMatrixId: (id: string) => {
    let match = id.match(/^@([^:]+):/);
    return match ? match[1] : id;
  },
}));

let mockMatrixLogin = vi.fn();
let mockAuthGetRealmServerToken = vi.fn();
let mockGetRealmTokens = vi.fn();
let mockAddRealmToMatrixAccountData = vi.fn();

vi.mock('../../src/lib/auth.js', () => ({
  matrixLogin: (...args: unknown[]) => mockMatrixLogin(...args),
  getRealmServerToken: (...args: unknown[]) => mockAuthGetRealmServerToken(...args),
  getRealmTokens: (...args: unknown[]) => mockGetRealmTokens(...args),
  addRealmToMatrixAccountData: (...args: unknown[]) =>
    mockAddRealmToMatrixAccountData(...args),
}));

vi.mock('@cardstack/runtime-common/realm-display-defaults', () => ({
  iconURLFor: (word: string) =>
    word
      ? `https://boxel-images.boxel.ai/icons/Letter-${word.charAt(0).toLowerCase()}.png`
      : undefined,
  getRandomBackgroundURL: () =>
    'https://boxel-images.boxel.ai/background-images/4k-desert-dunes.jpg',
}));

describe('realm create', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitSpy: any;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  let matrixAuth = {
    accessToken: 'matrix-access-token',
    deviceId: 'device-1',
    userId: '@testuser:example.com',
    matrixUrl: 'https://matrix.example.com',
  };

  beforeEach(() => {
    fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {
        throw new Error('process.exit');
      }) as () => never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    mockMatrixLogin.mockResolvedValue(matrixAuth);
    mockAuthGetRealmServerToken.mockResolvedValue('Bearer server-jwt-token');
    mockGetRealmTokens.mockResolvedValue({
      'https://realm.example.com/my-realm/': 'Bearer realm-jwt-token',
    });
    mockAddRealmToMatrixAccountData.mockResolvedValue(undefined);
    mockSetRealmToken.mockClear();
    mockSetRealmServerToken.mockClear();
    mockGetRealmServerToken.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a realm via POST to /_create-realm with full auth flow', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          type: 'realm',
          id: 'https://realm.example.com/my-realm/',
          attributes: { endpoint: 'my-realm', name: 'My Realm' },
        },
      }),
    });

    await createRealm('my-realm', 'My Realm', {});

    // Verify Matrix login was called with profile credentials
    expect(mockMatrixLogin).toHaveBeenCalledWith(
      'https://matrix.example.com',
      'testuser',
      'test-password',
    );

    // Verify realm server token was obtained
    expect(mockAuthGetRealmServerToken).toHaveBeenCalledWith(
      matrixAuth,
      'https://realm.example.com',
    );

    // Verify the create-realm POST
    expect(fetchSpy).toHaveBeenCalledOnce();
    let [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://realm.example.com/_create-realm');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/vnd.api+json');
    expect(init.headers['Authorization']).toBe('Bearer server-jwt-token');

    let body = JSON.parse(init.body);
    expect(body.data.attributes.endpoint).toBe('my-realm');
    expect(body.data.attributes.name).toBe('My Realm');
  });

  it('uses server token (not profile token) for authentication', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/ws/' },
      }),
    });

    await createRealm('ws', 'Workspace', {});

    let [, init] = fetchSpy.mock.calls[0];
    expect(init.headers['Authorization']).toBe('Bearer server-jwt-token');
  });

  it('stores the new realm JWT into the profile store', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/my-realm/' },
      }),
    });

    mockGetRealmTokens.mockResolvedValue({
      'https://realm.example.com/my-realm/': 'Bearer realm-jwt-123',
    });

    await createRealm('my-realm', 'Test', {});

    expect(mockGetRealmTokens).toHaveBeenCalledWith(
      'https://realm.example.com',
      'Bearer server-jwt-token',
    );
    expect(mockSetRealmToken).toHaveBeenCalledWith(
      'https://realm.example.com/my-realm/',
      'Bearer realm-jwt-123',
    );
  });

  it('registers the realm in Matrix account data', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/my-realm/' },
      }),
    });

    await createRealm('my-realm', 'Test', {});

    expect(mockAddRealmToMatrixAccountData).toHaveBeenCalledWith(
      matrixAuth,
      'https://realm.example.com/my-realm/',
    );
  });

  it('passes --background and --icon options as backgroundURL and iconURL', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/ws/' },
      }),
    });

    await createRealm('ws', 'Workspace', {
      background: 'https://img.example.com/bg.png',
      icon: 'https://img.example.com/icon.png',
    });

    let body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data.attributes.backgroundURL).toBe(
      'https://img.example.com/bg.png',
    );
    expect(body.data.attributes.iconURL).toBe(
      'https://img.example.com/icon.png',
    );
  });

  it('uses random background and name-based icon when not provided', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/ws/' },
      }),
    });

    await createRealm('ws', 'Workspace', {});

    let body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.data.attributes.backgroundURL).toBe(
      'https://boxel-images.boxel.ai/background-images/4k-desert-dunes.jpg',
    );
    expect(body.data.attributes.iconURL).toBe(
      'https://boxel-images.boxel.ai/icons/Letter-w.png',
    );
  });

  it('rejects endpoints with uppercase letters', async () => {
    await expect(createRealm('MyRealm', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: endpoint must contain only lowercase letters, numbers, and hyphens',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects endpoints with spaces', async () => {
    await expect(createRealm('my realm', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects endpoints with special characters', async () => {
    await expect(createRealm('my_realm!', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts valid endpoints with numbers and hyphens', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          type: 'realm',
          id: 'https://realm.example.com/my-realm-123/',
        },
      }),
    });

    mockGetRealmTokens.mockResolvedValue({
      'https://realm.example.com/my-realm-123/': 'Bearer token-123',
    });

    await createRealm('my-realm-123', 'Test', {});

    expect(fetchSpy).toHaveBeenCalledOnce();
  });

  it('handles auth failure (401)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(createRealm('test', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: realm server returned 401',
    );
  });

  it('handles server error (500)', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    });

    await expect(createRealm('test', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: realm server returned 500',
    );
  });

  it('handles network errors', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'));

    await expect(createRealm('test', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: failed to connect to realm server at https://realm.example.com/_create-realm',
    );
  });

  it('strips trailing slash from realm server URL', async () => {
    mockProfile = {
      displayName: 'Test User',
      matrixUrl: 'https://matrix.example.com',
      realmServerUrl: 'https://realm.example.com/',
      password: 'test-password',
    };

    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/ws/' },
      }),
    });

    await createRealm('ws', 'Test', {});

    expect(fetchSpy.mock.calls[0][0]).toBe(
      'https://realm.example.com/_create-realm',
    );
  });

  it('handles Matrix login failure', async () => {
    mockMatrixLogin.mockRejectedValue(
      new Error('Matrix login failed: 401 {"errcode":"M_FORBIDDEN"}'),
    );

    await expect(createRealm('test', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: Matrix login failed for @testuser:example.com',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('handles realm server token failure', async () => {
    mockAuthGetRealmServerToken.mockRejectedValue(
      new Error('Realm server session failed: 500'),
    );

    await expect(createRealm('test', 'Test', {})).rejects.toThrow(
      'process.exit',
    );

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(
      'Error: failed to obtain realm server token',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still succeeds when realm token fetch fails (non-fatal)', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/ws/' },
      }),
    });

    mockGetRealmTokens.mockRejectedValue(new Error('token fetch failed'));

    await createRealm('ws', 'Test', {});

    // Realm was created successfully
    expect(logSpy).toHaveBeenCalled();
    // But token wasn't stored
    expect(mockSetRealmToken).not.toHaveBeenCalled();
  });

  it('ensures trailing slash on realm URL for token storage', async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { type: 'realm', id: 'https://realm.example.com/ws' },
      }),
    });

    mockGetRealmTokens.mockResolvedValue({
      'https://realm.example.com/ws/': 'Bearer ws-token',
    });

    await createRealm('ws', 'Test', {});

    expect(mockSetRealmToken).toHaveBeenCalledWith(
      'https://realm.example.com/ws/',
      'Bearer ws-token',
    );
  });
});
