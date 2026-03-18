import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { authorizationMiddleware } from '@cardstack/runtime-common/authorization-middleware';
import { fetcher } from '@cardstack/runtime-common/fetcher';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { RealmAuthDataSource } from '@cardstack/runtime-common/realm-auth-data-source';

const profilesFile = join(homedir(), '.boxel-cli', 'profiles.json');

interface BoxelStoredProfile {
  matrixUrl: string;
  realmServerUrl: string;
  password: string;
}

interface BoxelProfilesConfig {
  profiles: {
    [profileId: string]: BoxelStoredProfile;
  };
  activeProfile: string | null;
}

export interface ActiveBoxelProfile {
  profileId: string | null;
  username: string;
  matrixUrl: string;
  realmServerUrl: string;
  password: string;
}

export interface CreateBoxelRealmFetchOptions {
  authorization?: string;
  fetch?: typeof globalThis.fetch;
  profile?: ActiveBoxelProfile | null;
}

export function createBoxelRealmFetch(
  resourceUrl: string,
  options?: CreateBoxelRealmFetchOptions,
): typeof globalThis.fetch {
  let fetchImpl = options?.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available');
  }

  let explicitAuthorization = normalizeOptionalString(options?.authorization);

  if (explicitAuthorization) {
    return withAuthorization(fetchImpl, explicitAuthorization);
  }

  let profile =
    options && 'profile' in options
      ? (options.profile ?? undefined)
      : getOptionalActiveProfile();

  if (!profile || !sharesOrigin(resourceUrl, profile.realmServerUrl)) {
    return fetchImpl;
  }

  let matrixClient = new MatrixClient({
    matrixURL: new URL(profile.matrixUrl),
    username: profile.username,
    password: profile.password,
  });
  let realmAuthDataSource = new RealmAuthDataSource(
    matrixClient,
    () => fetchImpl,
  );

  return fetcher(fetchImpl, [authorizationMiddleware(realmAuthDataSource)]);
}

function getOptionalActiveProfile(): ActiveBoxelProfile | undefined {
  let config = parseProfilesConfig();

  if (config.activeProfile && config.profiles[config.activeProfile]) {
    let profile = config.profiles[config.activeProfile];

    return {
      profileId: config.activeProfile,
      username: config.activeProfile.replace(/^@/, '').replace(/:.*$/, ''),
      matrixUrl: profile.matrixUrl,
      realmServerUrl: ensureTrailingSlash(profile.realmServerUrl),
      password: profile.password,
    };
  }

  let matrixUrl = normalizeOptionalString(process.env.MATRIX_URL);
  let username = normalizeOptionalString(process.env.MATRIX_USERNAME);
  let password = normalizeOptionalString(process.env.MATRIX_PASSWORD);
  let realmServerUrl = normalizeOptionalString(process.env.REALM_SERVER_URL);

  if (!matrixUrl || !username || !password || !realmServerUrl) {
    return undefined;
  }

  return {
    profileId: null,
    username,
    matrixUrl,
    realmServerUrl: ensureTrailingSlash(realmServerUrl),
    password,
  };
}

function parseProfilesConfig(): BoxelProfilesConfig {
  if (!existsSync(profilesFile)) {
    return { profiles: {}, activeProfile: null };
  }

  return JSON.parse(readFileSync(profilesFile, 'utf8')) as BoxelProfilesConfig;
}

function withAuthorization(
  fetchImpl: typeof globalThis.fetch,
  authorization: string,
): typeof globalThis.fetch {
  return async (input, init) => {
    if (input instanceof Request) {
      let request = new Request(input, init);

      if (!request.headers.has('Authorization')) {
        request.headers.set('Authorization', authorization);
      }

      return await fetchImpl(request);
    }

    let headers = new Headers(init?.headers);

    if (!headers.has('Authorization')) {
      headers.set('Authorization', authorization);
    }

    return await fetchImpl(input, {
      ...init,
      headers,
    });
  };
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  let trimmed = value.trim();

  return trimmed === '' ? undefined : trimmed;
}

function sharesOrigin(left: string, right: string): boolean {
  return new URL(left).origin === new URL(right).origin;
}
