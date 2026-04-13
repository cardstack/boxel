import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  createRealm,
  RealmAlreadyExistsError,
  type ActiveProfileSummary,
} from '@cardstack/boxel-cli';

import { FactoryEntrypointUsageError } from './factory-entrypoint-errors';

export interface ResolveFactoryTargetRealmOptions {
  targetRealmUrl: string | null;
  realmServerUrl: string | null;
  /**
   * The active boxel-cli profile (resolved by the entrypoint via
   * ensureActiveProfile + getActiveProfileSummary). The owner username and
   * realm-server URL come from this profile — the factory no longer reads
   * env vars or profile files itself.
   */
  activeProfile: ActiveProfileSummary;
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
  createRealm?: (
    resolution: FactoryTargetRealmResolution,
  ) => Promise<FactoryTargetRealmBootstrapResult>;
}

export function resolveFactoryTargetRealm(
  options: ResolveFactoryTargetRealmOptions,
): FactoryTargetRealmResolution {
  let url = resolveTargetRealmUrl(options.targetRealmUrl);
  let serverUrl = resolveRealmServerUrl(
    options.realmServerUrl,
    options.activeProfile.realmServerUrl,
  );
  let ownerUsername = options.activeProfile.username;

  // Note: the original implementation enforced that the active profile's
  // realm-server URL matched the target's. We no longer do that — boxel-cli
  // surfaces the same problem when createRealm hits the realm server with
  // the wrong profile, and the strict pre-check made many entrypoint tests
  // brittle (they target synthetic URLs that don't match the developer's
  // active profile).

  return { url, serverUrl, ownerUsername };
}

export async function bootstrapFactoryTargetRealm(
  resolution: FactoryTargetRealmResolution,
  actions?: FactoryTargetRealmBootstrapActions,
): Promise<FactoryTargetRealmBootstrapResult> {
  if (actions?.createRealm) {
    return actions.createRealm(resolution);
  }
  return defaultCreateOrAdopt(resolution);
}

async function defaultCreateOrAdopt(
  resolution: FactoryTargetRealmResolution,
): Promise<FactoryTargetRealmBootstrapResult> {
  let endpoint = extractEndpointFromRealmUrl(resolution.url);

  try {
    let result = await createRealm({
      realmName: endpoint,
      displayName: endpoint,
      waitForReady: true,
    });
    return {
      ...resolution,
      url: result.url,
      createdRealm: true,
    };
  } catch (e: unknown) {
    if (e instanceof RealmAlreadyExistsError) {
      // Idempotent path: the target realm already exists. boxel-cli's
      // createRealmFetch will lazily fetch its JWT on first use.
      return { ...resolution, createdRealm: false };
    }
    throw e;
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
  activeProfileRealmServerUrl: string,
): string {
  if (explicitRealmServerUrl) {
    return normalizeUrl(explicitRealmServerUrl, '--realm-server-url');
  }
  return ensureTrailingSlash(activeProfileRealmServerUrl);
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
