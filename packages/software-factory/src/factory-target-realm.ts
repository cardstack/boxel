import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';
import { SupportedMimeType } from '@cardstack/runtime-common/supported-mime-type';

import {
  getAccessibleRealmTokens,
  getActiveProfile,
  getRealmServerToken,
  matrixLogin,
  type ActiveBoxelProfile,
  type MatrixAuth,
} from './boxel';
import { createRealm as createRealmViaApi } from './realm-operations';
import { formatErrorResponse, formatUnknownError } from './error-format';
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
  authorization: string;
}

interface CreateRealmResult {
  createdRealm: boolean;
  url: string;
  authorization: string;
}

export interface FactoryTargetRealmBootstrapActions {
  createRealm?: (
    resolution: FactoryTargetRealmResolution,
  ) => Promise<CreateRealmResult>;
  fetch?: typeof globalThis.fetch;
  waitForRealmReady?: (
    realmUrl: string,
    authorization: string,
    fetchImpl: typeof globalThis.fetch,
  ) => Promise<void>;
}

export function resolveFactoryTargetRealm(
  options: ResolveFactoryTargetRealmOptions,
): FactoryTargetRealmResolution {
  let url = resolveTargetRealmUrl(options.targetRealmUrl);
  let serverUrl = resolveRealmServerUrl(options.realmServerUrl, url);
  let ownerUsername = resolveTargetRealmOwner();

  let targetOrigin = new URL(url).origin;
  let serverOrigin = new URL(serverUrl).origin;
  if (targetOrigin !== serverOrigin) {
    let profile = getActiveProfile();
    throw new FactoryEntrypointUsageError(
      `Target realm URL "${url}" (origin: ${targetOrigin}) does not match the realm server "${serverUrl}" (origin: ${serverOrigin}).\n` +
        `Your active Boxel profile "${profile.profileId}" points to ${ensureTrailingSlash(profile.realmServerUrl)}.\n` +
        `Either switch to a profile that matches the target realm (boxel profile switch), or pass --realm-server-url explicitly.`,
    );
  }

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
  let createRealmResult = await (
    actions?.createRealm ??
    ((targetRealm) =>
      createRealm(targetRealm, {
        fetch: actions?.fetch,
        waitForRealmReady: actions?.waitForRealmReady,
      }))
  )(resolution);

  return {
    ...resolution,
    url: createRealmResult.url,
    createdRealm: createRealmResult.createdRealm,
    authorization: createRealmResult.authorization,
  };
}

async function createRealm(
  resolution: FactoryTargetRealmResolution,
  dependencies?: {
    fetch?: typeof globalThis.fetch;
    waitForRealmReady?: FactoryTargetRealmBootstrapActions['waitForRealmReady'];
  },
): Promise<CreateRealmResult> {
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

  let createResult = await createRealmViaApi(resolution.serverUrl, {
    name: endpoint,
    endpoint,
    iconURL: iconURLFor(endpoint),
    backgroundURL: getRandomBackgroundURL(),
    authorization: serverToken,
    fetch: fetchImpl,
    matrixAuth: {
      userId: matrixAuth.userId,
      accessToken: matrixAuth.accessToken,
      matrixUrl: matrixAuth.credentials.matrixUrl,
    },
  });

  if (createResult.created) {
    let canonicalRealmUrl = normalizeCreatedRealmUrl(
      createResult.realmUrl,
      resolution.url,
    );

    let authorization = await getRealmAuthorization(
      matrixAuth,
      canonicalRealmUrl,
    );
    await (dependencies?.waitForRealmReady ?? waitForRealmReady)(
      canonicalRealmUrl,
      authorization,
      fetchImpl,
    );

    return {
      createdRealm: true,
      url: canonicalRealmUrl,
      authorization,
    };
  }

  if (createResult.error?.includes('already exists on this server')) {
    let authorization = await getRealmAuthorization(matrixAuth, resolution.url);
    return {
      createdRealm: false,
      url: resolution.url,
      authorization,
    };
  }

  throw new Error(
    `Failed to create target realm ${resolution.url}: ${createResult.error}`.trim(),
  );
}

async function waitForRealmReady(
  realmUrl: string,
  authorization: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  let readinessUrl = new URL('_readiness-check', realmUrl).href;
  let timeoutMs = 15_000;
  let retryDelayMs = 250;
  let startedAt = Date.now();
  let lastError: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetchImpl(readinessUrl, {
        headers: {
          Accept: SupportedMimeType.RealmInfo,
          Authorization: authorization,
        },
      });

      if (response.ok) {
        return;
      }

      lastError = `HTTP ${response.status} ${await formatErrorResponse(
        response,
      )}`.trim();
    } catch (error) {
      lastError = formatUnknownError(error);
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  throw new Error(
    `Timed out waiting for target realm ${realmUrl} to become ready${
      lastError ? `: ${lastError}` : ''
    }`,
  );
}

async function getRealmAuthorization(
  matrixAuth: MatrixAuth,
  realmUrl: string,
): Promise<string> {
  let realmTokens = await getAccessibleRealmTokens(matrixAuth);
  let authorization = realmTokens[ensureTrailingSlash(realmUrl)];

  if (!authorization) {
    throw new Error(
      `Realm auth lookup did not include ${ensureTrailingSlash(realmUrl)}`,
    );
  }

  return authorization;
}

function resolveRealmServerProfile(
  ownerUsername: string,
  serverUrl: string,
): ActiveBoxelProfile {
  let profile: ActiveBoxelProfile;

  try {
    profile = getActiveProfile();
  } catch {
    throw new FactoryEntrypointUsageError(
      `Target realm bootstrap needs Matrix auth for ${serverUrl}. Run \`boxel profile add\` to configure a profile.`,
    );
  }

  if (getMatrixUsername(profile.username) !== ownerUsername) {
    throw new FactoryEntrypointUsageError(
      `Active Boxel profile user "${getMatrixUsername(profile.username)}" does not match target realm owner "${ownerUsername}"`,
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

function resolveTargetRealmOwner(): string {
  try {
    let profile = getActiveProfile();
    return getMatrixUsername(profile.username);
  } catch {
    throw new FactoryEntrypointUsageError(
      'Cannot determine the target realm owner. Run `boxel profile add` to configure a profile.',
    );
  }
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
  _targetRealmUrl: string,
): string {
  if (explicitRealmServerUrl) {
    return normalizeUrl(explicitRealmServerUrl, '--realm-server-url');
  }

  try {
    let profile = getActiveProfile();
    return ensureTrailingSlash(profile.realmServerUrl);
  } catch {
    // No profile — fall through to error
  }

  throw new FactoryEntrypointUsageError(
    'No active Boxel profile found. Run `boxel profile add` to configure one, or pass --realm-server-url explicitly.',
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

function normalizeCreatedRealmUrl(
  createdRealmId: unknown,
  fallbackTargetRealmUrl: string,
): string {
  if (typeof createdRealmId !== 'string' || createdRealmId.trim() === '') {
    throw new Error(
      `Realm server returned an invalid realm id for ${fallbackTargetRealmUrl}`,
    );
  }

  return normalizeUrl(createdRealmId, 'realm server response data.id');
}
