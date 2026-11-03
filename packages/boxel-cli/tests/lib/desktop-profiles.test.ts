import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDesktopProfilesService,
  listStoredProfiles,
} from '../../src/lib/desktop-profiles.ts';
import { ProfileManager } from '../../src/lib/profile-manager.ts';
import type { browserLogin } from '../../src/lib/sso-login.ts';
import type { MatrixAuth } from '../../src/lib/auth.ts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture(login?: typeof browserLogin) {
  const directory = mkdtempSync(path.join(tmpdir(), 'boxel-studio-profiles-'));
  cleanups.push(() => rmSync(directory, { recursive: true, force: true }));
  const manager = () => new ProfileManager(directory);
  const activity: boolean[] = [];
  const service = createDesktopProfilesService({
    manager,
    login,
    openBrowser: async () => true,
    onActivityChanged: (active) => activity.push(active),
  });
  cleanups.push(() => service.dispose());
  return { directory, manager, service, activity };
}

const auth = {
  userId: '@alice:example.com',
  deviceId: 'fixture-device',
  accessToken: 'fixture-access-token',
  matrixUrl: 'https://matrix.example.com/',
};

describe('Studio CLI profile bridge', () => {
  it('lists legacy metadata without inventing an account identity or minting a login', async () => {
    const { directory, manager, service } = fixture();
    writeFileSync(path.join(directory, 'profiles.json'), JSON.stringify({ profiles: { old: { displayName: 'Older account', matrixUrl: 'https://matrix.example.com/', realmServerUrl: 'https://app.example.com/' } }, activeProfile: 'old' }));
    expect(service.list()).toMatchObject([{ id: 'old', displayName: 'Older account', matrixUserId: null, canSignIn: false }]);
    await expect(service.browserLogin('old')).rejects.toThrow('refresh this saved profile');
    expect(manager().getActiveProfileId()).toBe('old');
  });
  it('reads current CLI state on every action and exposes only account metadata', async () => {
    const { manager, service } = fixture();
    await manager().addProfileWithAuth(
      auth.userId,
      auth,
      'Alice',
      'https://app.example.com/',
    );
    const [profile] = service.list();
    expect(profile).toEqual({
      id: auth.userId,
      displayName: 'Alice',
      matrixUserId: auth.userId,
      canSignIn: true,
      matrixUrl: auth.matrixUrl,
      realmServerUrl: 'https://app.example.com/',
      hostUrl: 'https://app.example.com/',
      active: true,
    });
    expect(JSON.stringify(profile)).not.toContain(auth.accessToken);
    const second = {
      ...auth,
      userId: '@bob:example.com',
      accessToken: 'fixture-second-token',
    };
    await manager().addProfileWithAuth(
      second.userId,
      second,
      'Bob',
      'https://app.example.com/',
    );
    service.select(second.userId);
    expect(manager().getActiveProfileId()).toBe(second.userId);
    await service.remove(auth.userId);
    expect(manager().listProfiles()).toEqual([second.userId]);
    expect(manager().getProfile(second.userId)?.matrixAccessToken).toBe(
      second.accessToken,
    );
  });

  it('does not turn an unreadable store into an empty profile list or overwrite it', async () => {
    const { directory, manager, service } = fixture();
    const filename = path.join(directory, 'profiles.json');
    writeFileSync(filename, '{not valid');
    expect(() => listStoredProfiles(manager())).toThrow('could not be read');
    await expect(service.remove(auth.userId)).rejects.toThrow(
      'could not be read',
    );
    expect(readFileSync(filename, 'utf8')).toBe('{not valid');
  });

  it('requires account confirmation before persisting a browser sign-in', async () => {
    let complete: (result: MatrixAuth) => void = () => {};
    const result = new Promise<MatrixAuth>((resolve) => {
      complete = resolve;
    });
    const { manager, service, activity } = fixture(async () => result);
    const flow = service.start('production', 'default');
    expect(service.status(flow.id).state).toBe('waiting');
    complete(auth);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.status(flow.id)).toMatchObject({
      state: 'confirming',
      account: { userId: auth.userId },
    });
    expect(manager().listProfiles()).toEqual([]);
    await service.save(flow.id);
    expect(manager().getProfile(auth.userId)?.matrixAccessToken).toBe(
      auth.accessToken,
    );
    expect(service.status(flow.id).state).toBe('saved');
    expect(activity).toEqual([true, false]);
  });

  it('discards a late browser result after cancellation and releases its worker lease', async () => {
    let complete: (result: MatrixAuth) => void = () => {};
    const result = new Promise<MatrixAuth>((resolve) => {
      complete = resolve;
    });
    const { manager, service, activity } = fixture(async () => result);
    const flow = service.start('staging', 'default');
    service.cancel(flow.id);
    complete(auth);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(service.status(flow.id).state).toBe('cancelled');
    expect(manager().listProfiles()).toEqual([]);
    expect(activity).toEqual([true, false]);
    await expect(service.save(flow.id)).rejects.toThrow('through the browser');
  });
});
