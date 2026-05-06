import { BoxelCLIClient } from '@cardstack/boxel-cli/api';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import { FactoryEntrypointUsageError } from './factory-entrypoint-errors';

export interface ResolveFactoryTargetRealmOptions {
  targetRealm: string | null;
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

interface CreateRealmResult {
  createdRealm: boolean;
  url: string;
}

export interface FactoryTargetRealmBootstrapActions {
  createRealm?: (
    resolution: FactoryTargetRealmResolution,
  ) => Promise<CreateRealmResult>;
}

export function resolveFactoryTargetRealm(
  options: ResolveFactoryTargetRealmOptions,
): FactoryTargetRealmResolution {
  let url = resolveTargetRealm(options.targetRealm);
  let serverUrl = resolveRealmServerUrl(options.realmServerUrl, url);
  let ownerUsername = resolveTargetRealmOwner();

  let targetOrigin = new URL(url).origin;
  let serverOrigin = new URL(serverUrl).origin;
  if (targetOrigin !== serverOrigin) {
    let client = new BoxelCLIClient();
    let active = client.getActiveProfile();
    let profileLabel = active
      ? `Your active Boxel profile "${active.matrixId}" points to ${ensureTrailingSlash(active.realmServerUrl)}.`
      : 'No active Boxel profile is configured.';
    throw new FactoryEntrypointUsageError(
      `Target realm URL "${url}" (origin: ${targetOrigin}) does not match the realm server "${serverUrl}" (origin: ${serverOrigin}).\n` +
        `${profileLabel}\n` +
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
  let createRealmResult = await (actions?.createRealm ?? createRealm)(
    resolution,
  );

  return {
    ...resolution,
    url: createRealmResult.url,
    createdRealm: createRealmResult.createdRealm,
  };
}

async function createRealm(
  resolution: FactoryTargetRealmResolution,
): Promise<CreateRealmResult> {
  let realmName = extractEndpointFromRealmUrl(resolution.url);

  let client = new BoxelCLIClient();
  let active = client.getActiveProfile();
  if (active) {
    let activeServerUrl = ensureTrailingSlash(active.realmServerUrl);
    if (activeServerUrl !== resolution.serverUrl) {
      throw new FactoryEntrypointUsageError(
        `Active Boxel profile realm server "${activeServerUrl}" does not match target realm server "${resolution.serverUrl}"`,
      );
    }
    let activeUsername = getMatrixUsername(active.matrixId);
    if (activeUsername !== resolution.ownerUsername) {
      throw new FactoryEntrypointUsageError(
        `Active Boxel profile user "${activeUsername}" does not match target realm owner "${resolution.ownerUsername}"`,
      );
    }
  }

  let result = await client.createRealm({ realmName, displayName: realmName });

  return {
    createdRealm: result.created,
    url: result.realmUrl,
  };
}

function resolveTargetRealmOwner(): string {
  let client = new BoxelCLIClient();
  let active = client.getActiveProfile();
  if (active) {
    return getMatrixUsername(active.matrixId);
  }

  throw new FactoryEntrypointUsageError(
    'Cannot determine the target realm owner. Run `boxel profile add` to configure a profile.',
  );
}

function resolveTargetRealm(explicitTargetRealm: string | null): string {
  if (!explicitTargetRealm) {
    throw new FactoryEntrypointUsageError('Missing required --target-realm');
  }

  return normalizeUrl(explicitTargetRealm, '--target-realm');
}

function resolveRealmServerUrl(
  explicitRealmServerUrl: string | null,
  _targetRealm: string,
): string {
  if (explicitRealmServerUrl) {
    return normalizeUrl(explicitRealmServerUrl, '--realm-server-url');
  }

  let client = new BoxelCLIClient();
  let active = client.getActiveProfile();
  if (active) {
    return ensureTrailingSlash(active.realmServerUrl);
  }

  throw new FactoryEntrypointUsageError(
    'No active Boxel profile found. Run `boxel profile add` to configure one, or pass --realm-server-url explicitly.',
  );
}

function extractEndpointFromRealmUrl(targetRealm: string): string {
  let segments = new URL(targetRealm).pathname.split('/').filter(Boolean);
  let endpoint = segments.at(-1);

  if (!endpoint) {
    throw new FactoryEntrypointUsageError(
      `Target realm URL "${targetRealm}" is missing an endpoint segment`,
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
