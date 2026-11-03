import { ProfileManager } from './profile-manager.ts';
import { browse, hostAppUrlForProfile } from '../commands/browse.ts';
import { MatrixAuthError, requestLoginToken } from './auth.ts';
import type { MatrixAuth } from './auth.ts';
import { browserLogin, DEFAULT_TIMEOUT_MS } from './sso-login.ts';
import { profileSignInPresets } from '../commands/profile.ts';
import { randomUUID } from 'node:crypto';

export interface StoredProfileSummary {
  id: string;
  displayName: string;
  matrixUserId: string | null;
  canSignIn: boolean;
  matrixUrl: string;
  realmServerUrl: string;
  hostUrl: string;
  active: boolean;
}

export interface StoredProfileBrowserLogin {
  url: string;
  expiresAt: number | null;
}

export interface ProfileSignInTarget {
  id: string;
  name: string;
  matrixUrl: string;
  realmServerUrl: string;
  hostUrl: string;
}

export interface ProfileSignInView {
  id: string;
  targetId: string;
  state: 'waiting' | 'confirming' | 'saved' | 'failed' | 'cancelled';
  account: { userId: string; displayName: string } | null;
  message: string | null;
}

interface PendingSignIn {
  view: ProfileSignInView;
  controller: AbortController;
  auth: MatrixAuth | null;
  realmServerUrl: string;
}

const desktopFetch: typeof fetch = (input, init) =>
  fetch(input, {
    ...init,
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
  });

export function profileSignInTargets(): ProfileSignInTarget[] {
  return [
    {
      id: 'local',
      name: 'This computer',
      matrixUrl: 'http://matrix.default.boxel.localhost:4242/',
      realmServerUrl: 'http://realm.default.boxel.localhost:4242/',
      hostUrl: 'http://app.default.boxel.localhost:4242/',
    },
    ...profileSignInPresets().map((target) => ({
      ...target,
      name: target.id === 'production' ? 'Boxel' : 'Boxel staging',
    })),
  ];
}

export function createDesktopProfilesService(options: {
  openBrowser(url: string, browserId: string): Promise<boolean>;
  onActivityChanged(active: boolean): void;
  manager?: () => ProfileManager;
  login?: typeof browserLogin;
}) {
  const manager = options.manager ?? (() => new ProfileManager());
  let flow: PendingSignIn | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (flow) flow.auth = null;
    options.onActivityChanged(false);
  };
  const current = (id: string) => {
    if (!flow || flow.view.id !== id)
      throw new Error('This sign-in is no longer active. Start again.');
    return flow;
  };
  return {
    list() {
      return listStoredProfiles(manager());
    },
    targets: profileSignInTargets,
    currentSignIn() {
      return flow?.view ?? null;
    },
    async browserLogin(profileId: string) {
      return createStoredProfileBrowserLogin(profileId, manager());
    },
    async remove(profileId: string) {
      const pm = manager();
      if (!listStoredProfiles(pm).some((profile) => profile.id === profileId))
        throw new Error('Choose a saved profile.');
      if (!(await pm.removeProfile(profileId)))
        throw new Error('This saved profile was already removed.');
      return listStoredProfiles(manager());
    },
    select(profileId: string) {
      const pm = manager();
      if (!listStoredProfiles(pm).some((profile) => profile.id === profileId))
        throw new Error('Choose a saved profile.');
      if (!pm.switchProfile(profileId))
        throw new Error('Choose a saved profile.');
      return listStoredProfiles(manager());
    },
    start(targetId: string, browserId: string): ProfileSignInView {
      if (flow && ['waiting', 'confirming'].includes(flow.view.state))
        throw new Error('Finish or cancel the current browser sign-in first.');
      const target = profileSignInTargets().find(
        (candidate) => candidate.id === targetId,
      );
      if (!target) throw new Error('Choose a Boxel server.');
      const active: PendingSignIn = {
        view: {
          id: randomUUID(),
          targetId,
          state: 'waiting',
          account: null,
          message: null,
        },
        controller: new AbortController(),
        auth: null,
        realmServerUrl: target.realmServerUrl,
      };
      flow = active;
      options.onActivityChanged(true);
      timer = setTimeout(() => {
        active.controller.abort();
        active.view = {
          ...active.view,
          state: 'failed',
          message: 'Sign-in expired. Try again.',
        };
        finish();
      }, DEFAULT_TIMEOUT_MS);
      void (options.login ?? browserLogin)({
        matrixUrl: target.matrixUrl,
        hostUrl: target.hostUrl,
        signal: active.controller.signal,
        fetchFn: (input, init) =>
          fetch(input, {
            ...init,
            redirect: 'error',
            signal: AbortSignal.any([
              active.controller.signal,
              AbortSignal.timeout(15_000),
            ]),
          }),
        log: () => {},
        openBrowserFn: async (url) => {
          if (!(await options.openBrowser(url, browserId)))
            throw new Error('Could not open the selected browser');
          return true;
        },
      })
        .then((auth) => {
          if (active.controller.signal.aborted || flow !== active) return;
          active.auth = auth;
          active.view = {
            ...active.view,
            state: 'confirming',
            account: { userId: auth.userId, displayName: auth.userId },
            message: null,
          };
        })
        .catch(() => {
          if (active.controller.signal.aborted || flow !== active) return;
          active.view = {
            ...active.view,
            state: 'failed',
            message:
              'Could not finish browser sign-in. Check the browser and try again.',
          };
          finish();
        });
      return active.view;
    },
    status(id: string) {
      return current(id).view;
    },
    async save(id: string) {
      const active = current(id);
      if (active.view.state !== 'confirming' || !active.auth)
        throw new Error('Finish signing in through the browser first.');
      const pm = manager();
      listStoredProfiles(pm);
      await pm.addProfileWithAuth(
        active.auth.userId,
        active.auth,
        pm.getProfile(active.auth.userId)?.displayName,
        active.realmServerUrl,
      );
      active.view = { ...active.view, state: 'saved', message: null };
      finish();
      return active.view;
    },
    cancel(id: string) {
      const active = current(id);
      active.controller.abort();
      active.view = { ...active.view, state: 'cancelled', message: null };
      finish();
      return active.view;
    },
    dispose() {
      flow?.controller.abort();
      finish();
      flow = null;
    },
  };
}

function safeOrigin(value: string): string {
  const url = new URL(value);
  const local =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname.endsWith('.localhost');
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('Invalid saved profile server');
  return url.href;
}

export function listStoredProfiles(
  manager = new ProfileManager(),
): StoredProfileSummary[] {
  if (manager.getLoadError())
    throw new Error(
      'Saved Boxel CLI profiles could not be read. Check them with boxel profile list.',
    );
  return manager.listProfiles().map((id) => {
    const profile = manager.getProfile(id);
    if (
      !profile ||
      typeof profile.displayName !== 'string' ||
      typeof profile.matrixUrl !== 'string' ||
      typeof profile.realmServerUrl !== 'string'
    )
      throw new Error(
        'A saved Boxel CLI profile is invalid. Check it with boxel profile list.',
      );
    return {
      id,
      displayName: profile.displayName,
      matrixUserId:
        typeof profile.matrixUserId === 'string' ? profile.matrixUserId : null,
      canSignIn:
        typeof profile.matrixUserId === 'string' &&
        typeof profile.matrixAccessToken === 'string' &&
        profile.matrixAccessToken.length > 0 &&
        typeof profile.matrixDeviceId === 'string' &&
        profile.matrixDeviceId.length > 0,
      matrixUrl: safeOrigin(profile.matrixUrl),
      realmServerUrl: safeOrigin(profile.realmServerUrl),
      hostUrl: safeOrigin(hostAppUrlForProfile(profile)),
      active: manager.getActiveProfileId() === id,
    };
  });
}

export async function createStoredProfileBrowserLogin(
  profileId: string,
  manager = new ProfileManager(),
): Promise<StoredProfileBrowserLogin> {
  const profile = listStoredProfiles(manager).find(
    (candidate) => candidate.id === profileId,
  );
  if (!profile) throw new Error('Choose a saved Boxel CLI profile.');
  if (!profile.canSignIn)
    throw new Error(
      'Sign in through your browser to refresh this saved profile first.',
    );
  let result: StoredProfileBrowserLogin | null = null;
  let expiresAt: number | null = null;
  try {
    await browse(undefined, {
      profile: profileId,
      profileManager: manager,
      hostUrl: profile.hostUrl,
      requestLoginToken: async (auth) => {
        const token = await requestLoginToken(
          auth,
          desktopFetch,
          profile.realmServerUrl,
        );
        expiresAt =
          token.expiresInMs === undefined
            ? null
            : Date.now() + token.expiresInMs;
        return token;
      },
      log: () => {},
      isInteractive: () => false,
      openBrowserFn: async (url) => {
        result = { url, expiresAt };
        return true;
      },
    });
  } catch (error) {
    if (error instanceof MatrixAuthError)
      throw new Error(
        'This saved sign-in has expired. Sign in again with boxel profile add.',
      );
    throw new Error(
      'Could not prepare sign-in. Check the saved profile and its server, or try again shortly if it was rate-limited.',
    );
  }
  if (!result) throw new Error('Could not prepare browser sign-in.');
  return result;
}
