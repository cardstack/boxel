import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';
import { getProfileManager, type ProfileManager } from './profile-manager';

const REALM_NAME_PATTERN = /^[a-z0-9-]+$/;

export interface CreateRealmOptions {
  realmName: string;
  displayName: string;
  background?: string;
  icon?: string;
  /** Defaults to the active profile via getProfileManager(). */
  profileManager?: ProfileManager;
  /** When true, polls _readiness-check until it returns 2xx (or times out). */
  waitForReady?: boolean;
  readinessTimeoutMs?: number;
  readinessRetryDelayMs?: number;
  /**
   * Whether to register the new realm in the user's Matrix account data so
   * it appears in the Boxel dashboard. Defaults to true. Failure here is
   * non-fatal and is silently swallowed — the realm is still created.
   */
  registerInDashboard?: boolean;
}

export interface CreateRealmResult {
  url: string;
}

/**
 * Thrown when `_create-realm` rejects because a realm with the same name
 * already exists on the realm server. Callers expecting idempotent behavior
 * can catch this and proceed against the existing realm.
 */
export class RealmAlreadyExistsError extends Error {
  readonly code = 'realm_already_exists' as const;
  readonly realmName: string;
  readonly realmServerUrl: string;
  constructor(realmName: string, realmServerUrl: string) {
    super(`Realm "${realmName}" already exists on ${realmServerUrl}`);
    this.realmName = realmName;
    this.realmServerUrl = realmServerUrl;
  }
}

export async function createRealm(
  options: CreateRealmOptions,
): Promise<CreateRealmResult> {
  if (!REALM_NAME_PATTERN.test(options.realmName)) {
    throw new Error(
      'realm name must contain only lowercase letters, numbers, and hyphens',
    );
  }

  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(
      'no active profile. Run `boxel profile add` to create one.',
    );
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');

  let attributes: Record<string, string | undefined> = {
    endpoint: options.realmName,
    name: options.displayName,
    backgroundURL: options.background ?? getRandomBackgroundURL(),
    iconURL:
      options.icon ??
      iconURLFor(options.displayName) ??
      iconURLFor(options.realmName),
  };

  let response: Response;
  try {
    response = await pm.authedFetch(`${realmServerUrl}/_create-realm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: JSON.stringify({ data: { type: 'realm', attributes } }),
    });
  } catch (e: unknown) {
    throw new Error(
      `failed to connect to realm server: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!response.ok) {
    let errorBody = await response.text();
    if (errorBody.includes('already exists on this server')) {
      throw new RealmAlreadyExistsError(options.realmName, realmServerUrl);
    }
    throw new Error(
      `realm server returned ${response.status}${errorBody ? `: ${errorBody}` : ''}`,
    );
  }

  let result = (await response.json()) as { data?: { id?: string } };
  let realmUrl = result?.data?.id;
  if (!realmUrl) {
    throw new Error('realm server response did not include data.id');
  }
  let normalizedRealmUrl = ensureTrailingSlash(realmUrl);

  let serverToken = await pm.getOrRefreshServerToken();
  let token = await pm.fetchAndStoreRealmToken(normalizedRealmUrl, serverToken);
  if (!token) {
    throw new Error(
      `realm ${normalizedRealmUrl} was created but no JWT was returned from _realm-auth`,
    );
  }

  if (options.waitForReady) {
    await waitForRealmReady(normalizedRealmUrl, token, {
      timeoutMs: options.readinessTimeoutMs,
      retryDelayMs: options.readinessRetryDelayMs,
    });
  }

  if (options.registerInDashboard !== false) {
    try {
      await pm.addToUserRealms(normalizedRealmUrl);
    } catch {
      // best-effort — realm exists; dashboard registration failure is non-fatal
    }
  }

  return { url: normalizedRealmUrl };
}

async function waitForRealmReady(
  realmUrl: string,
  authorization: string,
  options: { timeoutMs?: number; retryDelayMs?: number } = {},
): Promise<void> {
  let timeoutMs = options.timeoutMs ?? 15_000;
  let retryDelayMs = options.retryDelayMs ?? 250;
  let readinessUrl = new URL('_readiness-check', realmUrl).href;
  let startedAt = Date.now();
  let lastError: string | undefined;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      let response = await fetch(readinessUrl, {
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: authorization,
        },
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (e: unknown) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  throw new Error(
    `Timed out waiting for realm ${realmUrl} to become ready${lastError ? `: ${lastError}` : ''}`,
  );
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
