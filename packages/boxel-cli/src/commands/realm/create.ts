import type { Command } from 'commander';
import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager.ts';
import { FG_GREEN, FG_CYAN, RESET } from '../../lib/colors.ts';

const REALM_NAME_PATTERN = /^[a-z0-9-]+$/;

export function registerCreateCommand(realm: Command): void {
  realm
    .command('create')
    .description('Create a new realm on the realm server')
    .argument('<realm-name>', 'realm name (lowercase, numbers, hyphens only)')
    .argument('<display-name>', 'display name for the realm')
    .option('--background <url>', 'background image URL')
    .option('--icon <url>', 'icon image URL')
    .action(
      async (
        realmName: string,
        displayName: string,
        options: CreateCommandOptions,
      ) => {
        await executeCreateRealmCommand(realmName, displayName, options);
      },
    );
}

export interface CreateOptions {
  background?: string;
  icon?: string;
  profileManager?: ProfileManager;
  /** Wait for the realm to pass its readiness check (default: false). */
  waitForReady?: boolean;
}

interface CreateCommandOptions {
  background?: string;
  icon?: string;
}

export interface CreateRealmResult {
  realmUrl: string;
  created: boolean;
  realmToken?: string;
}

/**
 * Core realm creation logic. Returns result on success, throws on failure.
 * No console output or process.exit — suitable for programmatic use.
 *
 * Handles "already exists" gracefully by returning `created: false`
 * with an authorization token for the existing realm.
 */
export async function createRealm(
  realmName: string,
  displayName: string,
  options: CreateOptions = {},
): Promise<CreateRealmResult> {
  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    throw new Error(
      'No active profile. Run `boxel profile add` to create one.',
    );
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');

  let attributes: Record<string, string | undefined> = {
    endpoint: realmName,
    name: displayName,
    backgroundURL: options.background ?? getRandomBackgroundURL(),
    iconURL: options.icon ?? iconURLFor(displayName) ?? iconURLFor(realmName),
  };

  let response = await pm.authedRealmServerFetch(
    `${realmServerUrl}/_create-realm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: JSON.stringify({
        data: { type: 'realm', attributes },
      }),
    },
  );

  if (!response.ok) {
    let errorBody: string;
    try {
      errorBody = await response.text();
    } catch {
      errorBody = 'server returned a non-serialized object body';
    }
    if (errorBody.includes('[object Object]')) {
      errorBody = 'server returned a non-serialized object body';
    }

    if (errorBody.includes('already exists')) {
      let realmUrl = extractRealmUrlFromError(
        errorBody,
        realmServerUrl,
        realmName,
      );
      let realmToken = await fetchRealmToken(pm, realmUrl);

      try {
        await pm.addToUserRealms(realmUrl);
      } catch {
        // Non-critical
      }

      return { realmUrl, created: false, realmToken };
    }

    throw new Error(`Realm server returned ${response.status}: ${errorBody}`);
  }

  let result = await response.json();
  let rawRealmUrl = result?.data?.id;
  if (typeof rawRealmUrl !== 'string' || rawRealmUrl.trim() === '') {
    throw new Error(
      `Realm server response did not include a realm URL (data.id) for "${realmName}".`,
    );
  }
  let realmUrl = ensureTrailingSlash(rawRealmUrl);

  let realmToken = await fetchRealmToken(pm, realmUrl);

  try {
    await pm.addToUserRealms(realmUrl);
  } catch {
    // Non-critical — realm still works without dashboard registration
  }

  if (options.waitForReady && realmToken) {
    await waitForRealmReady(realmUrl, realmToken);
  }

  return {
    realmUrl,
    created: true,
    realmToken,
  };
}

async function fetchRealmToken(
  pm: ProfileManager,
  realmUrl: string,
): Promise<string | undefined> {
  try {
    let serverToken = await pm.getOrRefreshServerToken();
    return await pm.fetchAndStoreRealmToken(realmUrl, serverToken);
  } catch {
    return undefined;
  }
}

async function waitForRealmReady(
  realmUrl: string,
  authorization: string,
): Promise<void> {
  let readinessUrl = new URL('_readiness-check', realmUrl).href;
  let timeoutMs = 15_000;
  let retryDelayMs = 250;
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

      if (response.ok) {
        return;
      }

      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }

  throw new Error(
    `Timed out waiting for realm ${realmUrl} to become ready${
      lastError ? `: ${lastError}` : ''
    }`,
  );
}

/**
 * CLI entry point for `boxel realm create`. Validates input, calls createRealm,
 * formats output, and exits on error.
 */
async function executeCreateRealmCommand(
  realmName: string,
  displayName: string,
  options: CreateCommandOptions,
): Promise<void> {
  if (!REALM_NAME_PATTERN.test(realmName)) {
    console.error(
      'Error: realm name must contain only lowercase letters, numbers, and hyphens',
    );
    process.exit(1);
  }

  try {
    let result = await createRealm(realmName, displayName, options);
    let verb = result.created ? 'created' : 'already exists';
    console.log(
      `${FG_GREEN}Realm ${verb}:${RESET} ${FG_CYAN}${result.realmUrl}${RESET}`,
    );
  } catch (e: unknown) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}

function extractRealmUrlFromError(
  errorBody: string,
  realmServerUrl: string,
  endpoint: string,
): string {
  let urlMatch = errorBody.match(/'(https?:\/\/[^']+)'/);
  if (urlMatch) {
    return ensureTrailingSlash(urlMatch[1]);
  }
  throw new Error(
    `Could not determine realm URL from server error response for endpoint "${endpoint}" on "${realmServerUrl}". The response did not include an explicit realm URL.`,
  );
}
