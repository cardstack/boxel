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
      : getOptionalActiveProfile(resourceUrl);

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

function getOptionalActiveProfile(
  resourceUrl: string,
): ActiveBoxelProfile | undefined {
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

  return buildEnvProfile(resourceUrl);
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
      }. Fix or remove the file, or provide auth via environment variables.`,
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

function buildEnvProfile(resourceUrl: string): ActiveBoxelProfile | undefined {
  let matrixUrl = normalizeOptionalString(process.env.MATRIX_URL);
  let username = normalizeOptionalString(process.env.MATRIX_USERNAME);
  let password = normalizeOptionalString(process.env.MATRIX_PASSWORD);
  let realmServerUrl = normalizeOptionalString(process.env.REALM_SERVER_URL);

  if (!matrixUrl) {
    return undefined;
  }

  let normalizedMatrixUrl = normalizeProfileUrl(matrixUrl, 'MATRIX_URL');
  let normalizedRealmServerUrl = realmServerUrl
    ? normalizeProfileUrl(realmServerUrl, 'REALM_SERVER_URL')
    : normalizeProfileUrl(new URL('/', resourceUrl).href, 'resourceUrl origin');

  if (!username || !password) {
    return undefined;
  }

  return {
    profileId: null,
    username: getMatrixUsername(username),
    matrixUrl: normalizedMatrixUrl,
    realmServerUrl: normalizedRealmServerUrl,
    password,
  };
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
