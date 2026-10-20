import * as fs from 'fs';
import * as os from 'os';
import { join } from 'path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import { keysSignOut } from '../../src/commands/keys/index.ts';

describe('boxel keys sign-out', () => {
  let configDir: string;
  let manager: ProfileManager;
  let secureSession = {
    token: 'secure-session-jwt',
    userId: '@bob:stack.cards',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };

  beforeEach(async () => {
    configDir = fs.mkdtempSync(join(os.tmpdir(), 'boxel-cli-keys-sign-out-'));
    manager = new ProfileManager(configDir);
    await manager.addProfileWithAuth('@bob:stack.cards', {
      accessToken: 'matrix-token',
      deviceId: 'DEVICE',
      userId: '@bob:stack.cards',
      matrixUrl: 'https://matrix-staging.stack.cards',
    });
    manager.setSecureSession(secureSession);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('keeps the session when the server could not end it, so it can be tried again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 })),
    );
    await expect(keysSignOut({ profileManager: manager })).rejects.toThrow(
      /503/,
    );
    expect(manager.getSecureSession()).toEqual(secureSession);
  });

  it('forgets the session once the server has ended it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    await keysSignOut({ profileManager: manager });
    expect(manager.getSecureSession()).toBeUndefined();
  });

  it('forgets a session the server already considers ended', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 401 })),
    );
    await keysSignOut({ profileManager: manager });
    expect(manager.getSecureSession()).toBeUndefined();
  });
});
