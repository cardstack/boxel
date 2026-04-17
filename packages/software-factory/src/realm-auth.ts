import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { authorizationMiddleware } from '@cardstack/runtime-common/authorization-middleware';
import { fetcher } from '@cardstack/runtime-common/fetcher';
import {
  getMatrixUsername,
  MatrixClient,
} from '@cardstack/runtime-common/matrix-client';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { RealmAuthDataSource } from '@cardstack/runtime-common/realm-auth-data-source';

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
  primeRealmURL?: string;
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
  let authedFetch = fetcher(fetchImpl, [
    authorizationMiddleware(realmAuthDataSource),
  ]);
  let primedRealmURL = normalizeOptionalString(options?.primeRealmURL);
  let primeRequest =
    primedRealmURL != null
      ? realmAuthDataSource.reauthenticate(
          ensureTrailingSlash(
            normalizeProfileUrl(primedRealmURL, 'primeRealmURL'),
          ),
        )
      : undefined;

  if (!primeRequest) {
    return authedFetch;
  }

  return async (input, init) => {
    await primeRequest;
    return await authedFetch(input, init);
  };
}

function getOptionalActiveProfile(): ActiveBoxelProfile | undefined {
  let config = parseProfilesConfig();

  if (config.activeProfile && config.profiles[config.activeProfile]) {
    let profile = config.profiles[config.activeProfile];

    return {
      profileId: config.activeProfile,
      username: getMatrixUsername(config.activeProfile),
      matrixUrl: normalizeProfileUrl(profile.matrixUrl, 'matrixUrl'),
      realmServerUrl: normalizeProfileUrl(
        profile.realmServerUrl,
        'realmServerUrl',
      ),
      password: profile.password,
    };
  }

  return undefined;
}

function parseProfilesConfig(): BoxelProfilesConfig {
  let profilesFile = getProfilesFile();

  if (!existsSync(profilesFile)) {
    return { profiles: {}, activeProfile: null };
  }

  try {
    return JSON.parse(
      readFileSync(profilesFile, 'utf8'),
    ) as BoxelProfilesConfig;
  } catch (error) {
    throw new Error(
      `Failed to parse Boxel profiles config at ${profilesFile}: ${
        error instanceof Error ? error.message : String(error)
      }. Fix or remove the file.`,
    );
  }
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

function getProfilesFile(): string {
  return join(homedir(), '.boxel-cli', 'profiles.json');
}

function normalizeProfileUrl(value: string, label: string): string {
  try {
    return ensureTrailingSlash(new URL(value).href);
  } catch (error) {
    throw new Error(
      `Invalid ${label} in Boxel auth configuration: "${value}". Expected an absolute URL.`,
    );
  }
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
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch (error) {
    throw new Error(
      `Invalid URL while setting up realm auth for ${left}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
