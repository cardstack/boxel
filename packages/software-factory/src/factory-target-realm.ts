import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';
import { SupportedMimeType } from '@cardstack/runtime-common/router';

import {
  getAccessibleRealmTokens,
  getActiveProfile,
  getRealmServerToken,
  matrixLogin,
  type ActiveBoxelProfile,
  type MatrixAuth,
} from '../scripts/lib/boxel';
import { createRealm as createRealmViaApi } from '../scripts/lib/realm-operations';
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
  });

  if (createResult.created) {
    let canonicalRealmUrl = normalizeCreatedRealmUrl(
      createResult.realmUrl,
      resolution.url,
    );

    await appendRealmToMatrixAccountData(
      matrixAuth,
      canonicalRealmUrl,
      fetchImpl,
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

async function appendRealmToMatrixAccountData(
  matrixAuth: MatrixAuth,
  realmUrl: string,
  fetchImpl: typeof globalThis.fetch,
): Promise<void> {
  let accountDataUrl = new URL(
    `_matrix/client/v3/user/${encodeURIComponent(matrixAuth.userId)}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
    matrixAuth.credentials.matrixUrl,
  ).href;

  let existingRealms: string[] = [];

  let getResponse = await fetchImpl(accountDataUrl, {
    headers: { Authorization: `Bearer ${matrixAuth.accessToken}` },
  });
  if (getResponse.ok) {
    let data = (await getResponse.json()) as { realms?: string[] };
    existingRealms = Array.isArray(data.realms) ? [...data.realms] : [];
  }

  if (!existingRealms.includes(realmUrl)) {
    existingRealms.push(realmUrl);
  }

  let putResponse = await fetchImpl(accountDataUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${matrixAuth.accessToken}`,
    },
    body: JSON.stringify({ realms: existingRealms }),
  });

  if (!putResponse.ok) {
    let text = await formatErrorResponse(putResponse);
    throw new Error(
      `Failed to update Matrix account data with realm ${realmUrl}: HTTP ${putResponse.status} ${text}`.trim(),
    );
  }
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

  if (!matrixPassword) {
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

function normalizeOptionalString(
  value: string | undefined,
): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  let trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}
