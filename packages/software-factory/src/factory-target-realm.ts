import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import { SupportedMimeType } from '@cardstack/runtime-common/router';

import {
  getActiveProfile,
  getRealmServerToken,
  matrixLogin,
  type ActiveBoxelProfile,
} from '../scripts/lib/boxel';
import { FactoryEntrypointUsageError } from './factory-entrypoint-errors';

export interface ResolveFactoryTargetRealmOptions {
  targetRealmUrl: string | null;
  realmServerUrl: string | null;
}

export interface FactoryTargetRealmResolution {
  url: string;
  serverUrl: string;
  ownerUsername: string;
}

export interface FactoryTargetRealmBootstrapResult extends FactoryTargetRealmResolution {
  createdRealm: boolean;
}

export interface FactoryTargetRealmBootstrapActions {
  createRealm?: (resolution: FactoryTargetRealmResolution) => Promise<boolean>;
  fetch?: typeof globalThis.fetch;
}

export function resolveFactoryTargetRealm(
  options: ResolveFactoryTargetRealmOptions,
): FactoryTargetRealmResolution {
  let url = resolveTargetRealmUrl(options.targetRealmUrl);
  let serverUrl = resolveRealmServerUrl(options.realmServerUrl, url);
  let ownerUsername = resolveTargetRealmOwner();

  return {
    url,
    serverUrl,
    ownerUsername,
  };
}

export async function bootstrapFactoryTargetRealm(
  resolution: FactoryTargetRealmResolution,
  actions?: FactoryTargetRealmBootstrapActions,
): Promise<FactoryTargetRealmBootstrapResult> {
  let createdRealm = await (
    actions?.createRealm ??
    ((targetRealm) =>
      createRealm(targetRealm, {
        fetch: actions?.fetch,
      }))
  )(resolution);

  return {
    ...resolution,
    createdRealm,
  };
}

async function createRealm(
  resolution: FactoryTargetRealmResolution,
  dependencies?: { fetch?: typeof globalThis.fetch },
): Promise<boolean> {
  let fetchImpl = dependencies?.fetch ?? globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Global fetch is not available');
  }

  let endpoint = extractEndpointFromRealmUrl(resolution.url);
  let profile = resolveRealmServerProfile(
    resolution.ownerUsername,
    resolution.serverUrl,
  );
  let matrixAuth = await matrixLogin(profile);
  let serverToken = await getRealmServerToken(matrixAuth);

  let response = await fetchImpl(
    new URL('_create-realm', resolution.serverUrl),
    {
      method: 'POST',
      headers: {
        Accept: SupportedMimeType.JSONAPI,
        'Content-Type': 'application/json',
        Authorization: serverToken,
      },
      body: JSON.stringify({
        data: {
          type: 'realm',
          attributes: {
            endpoint,
            name: endpoint,
          },
        },
      }),
    },
  );

  if (response.ok) {
    return true;
  }

  let text = await response.text();

  if (response.status === 400 && /already exists on this server/.test(text)) {
    return false;
  }

  throw new Error(
    `Failed to create target realm ${resolution.url}: HTTP ${response.status} ${text}`.trim(),
  );
}

function resolveRealmServerProfile(
  ownerUsername: string,
  serverUrl: string,
): ActiveBoxelProfile {
  let envProfile = buildEnvRealmServerProfile(ownerUsername, serverUrl);
  if (envProfile) {
    return envProfile;
  }

  let profile: ActiveBoxelProfile;

  try {
    profile = getActiveProfile();
  } catch {
    throw new FactoryEntrypointUsageError(
      `Target realm bootstrap needs Matrix auth for ${serverUrl}. Configure MATRIX_URL, MATRIX_USERNAME, and MATRIX_PASSWORD or use a matching active Boxel profile.`,
    );
  }

  if (getMatrixUsername(profile.username) !== ownerUsername) {
    throw new FactoryEntrypointUsageError(
      `Active Boxel profile user "${getMatrixUsername(profile.username)}" does not match MATRIX_USERNAME "${ownerUsername}"`,
    );
  }

  if (ensureTrailingSlash(profile.realmServerUrl) !== serverUrl) {
    throw new FactoryEntrypointUsageError(
      `Active Boxel profile realm server "${ensureTrailingSlash(
        profile.realmServerUrl,
      )}" does not match target realm server "${serverUrl}"`,
    );
  }

  return profile;
}

function buildEnvRealmServerProfile(
  ownerUsername: string,
  serverUrl: string,
): ActiveBoxelProfile | undefined {
  let matrixUrl = normalizeOptionalString(process.env.MATRIX_URL);
  let envUsername = normalizeOptionalString(process.env.MATRIX_USERNAME);
  let matrixPassword = normalizeOptionalString(process.env.MATRIX_PASSWORD);
  let envRealmServerUrl = normalizeOptionalString(process.env.REALM_SERVER_URL);

  if (!matrixUrl && !matrixPassword) {
    return undefined;
  }

  if (!matrixUrl) {
    throw new FactoryEntrypointUsageError(
      'MATRIX_URL is required for target realm creation when using environment auth',
    );
  }

  if (!envUsername) {
    throw new FactoryEntrypointUsageError(
      'MATRIX_USERNAME is required for target realm creation when using environment auth',
    );
  }

  let normalizedUsername = getMatrixUsername(envUsername);

  if (normalizedUsername !== ownerUsername) {
    throw new FactoryEntrypointUsageError(
      `MATRIX_USERNAME "${normalizedUsername}" does not match target realm owner "${ownerUsername}"`,
    );
  }

  let normalizedServerUrl = ensureTrailingSlash(envRealmServerUrl ?? serverUrl);

  if (normalizedServerUrl !== serverUrl) {
    throw new FactoryEntrypointUsageError(
      `REALM_SERVER_URL "${normalizedServerUrl}" does not match target realm server "${serverUrl}"`,
    );
  }

  if (!matrixPassword) {
    throw new FactoryEntrypointUsageError(
      'Target realm creation needs MATRIX_PASSWORD',
    );
  }

  return {
    profileId: null,
    username: normalizedUsername,
    matrixUrl: ensureTrailingSlash(matrixUrl),
    realmServerUrl: normalizedServerUrl,
    password: matrixPassword,
  };
}

function resolveTargetRealmOwner(): string {
  let envUsername = normalizeOptionalString(process.env.MATRIX_USERNAME);

  if (!envUsername) {
    throw new FactoryEntrypointUsageError(
      'Cannot determine the target realm owner. Set MATRIX_USERNAME before running factory:go.',
    );
  }

  return getMatrixUsername(envUsername);
}

function resolveTargetRealmUrl(explicitTargetRealmUrl: string | null): string {
  if (!explicitTargetRealmUrl) {
    throw new FactoryEntrypointUsageError(
      'Missing required --target-realm-url',
    );
  }

  return normalizeUrl(explicitTargetRealmUrl, '--target-realm-url');
}

function resolveRealmServerUrl(
  explicitRealmServerUrl: string | null,
  targetRealmUrl: string,
): string {
  if (explicitRealmServerUrl) {
    return normalizeUrl(explicitRealmServerUrl, '--realm-server-url');
  }

  let parsedTargetRealmUrl = new URL(targetRealmUrl);
  let pathSegments = parsedTargetRealmUrl.pathname.split('/').filter(Boolean);

  if (pathSegments.length < 2) {
    throw new FactoryEntrypointUsageError(
      `Target realm URL "${targetRealmUrl}" is missing an owner or endpoint segment`,
    );
  }

  let serverPath = pathSegments.slice(0, -2).join('/');

  return ensureTrailingSlash(
    `${parsedTargetRealmUrl.origin}/${serverPath === '' ? '' : `${serverPath}/`}`,
  );
}

function extractEndpointFromRealmUrl(targetRealmUrl: string): string {
  let segments = new URL(targetRealmUrl).pathname.split('/').filter(Boolean);
  let endpoint = segments.at(-1);

  if (!endpoint) {
    throw new FactoryEntrypointUsageError(
      `Target realm URL "${targetRealmUrl}" is missing an endpoint segment`,
    );
  }

  return endpoint;
}

function normalizeUrl(url: string, label: string): string {
  try {
    return ensureTrailingSlash(new URL(url).href);
  } catch (error) {
    throw new FactoryEntrypointUsageError(
      `Invalid ${label} "${url}": ${
        error instanceof Error ? error.message : String(error)
      }`,
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
