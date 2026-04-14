import { BoxelCLIClient } from '@cardstack/boxel-cli/src/lib/boxel-cli-client';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

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
  let createRealmResult = await (actions?.createRealm ?? createRealm)(
    resolution,
  );

  return {
    ...resolution,
    url: createRealmResult.url,
    createdRealm: createRealmResult.createdRealm,
    authorization: createRealmResult.authorization,
  };
}

async function createRealm(
  resolution: FactoryTargetRealmResolution,
): Promise<CreateRealmResult> {
  let endpoint = extractEndpointFromRealmUrl(resolution.url);

  let client = new BoxelCLIClient();
  let result = await client.createRealm({ endpoint, name: endpoint });

  return {
    createdRealm: result.created,
    url: result.realmUrl,
    authorization: result.authorization,
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

const DEFAULT_REALM_SERVER_URL = 'http://localhost:4201/';

function resolveRealmServerUrl(
  explicitRealmServerUrl: string | null,
  _targetRealmUrl: string,
): string {
  if (explicitRealmServerUrl) {
    return normalizeUrl(explicitRealmServerUrl, '--realm-server-url');
  }

  return DEFAULT_REALM_SERVER_URL;
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
