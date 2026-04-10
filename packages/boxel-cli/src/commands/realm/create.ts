import type { Command } from 'commander';
import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';
import {
  getProfileManager,
  type ProfileManager,
} from '../../lib/profile-manager';
import { FG_GREEN, FG_CYAN, DIM, RESET } from '../../lib/colors';

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
        options: CreateOptions,
      ) => {
        await createRealm(realmName, displayName, options);
      },
    );
}

export interface CreateOptions {
  background?: string;
  icon?: string;
  profileManager?: ProfileManager;
}

export async function createRealm(
  realmName: string,
  displayName: string,
  options: CreateOptions,
): Promise<void> {
  if (!REALM_NAME_PATTERN.test(realmName)) {
    console.error(
      'Error: realm name must contain only lowercase letters, numbers, and hyphens',
    );
    process.exit(1);
  }

  let pm = options.profileManager ?? getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    console.error(
      'Error: no active profile. Run `boxel profile add` to create one.',
    );
    process.exit(1);
  }

  let realmServerUrl = active.profile.realmServerUrl.replace(/\/$/, '');

  let serverToken: string;
  try {
    serverToken = await pm.getOrRefreshServerToken();
  } catch (e: unknown) {
    console.error('Error: authentication failed');
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // Build request attributes with default icon/background
  let attributes: Record<string, string> = {
    endpoint: realmName,
    name: displayName,
  };
  attributes.backgroundURL = options.background ?? getRandomBackgroundURL();
  attributes.iconURL =
    options.icon ?? iconURLFor(displayName) ?? iconURLFor(realmName) ?? '';

  let url = `${realmServerUrl}/_create-realm`;
  let body = JSON.stringify({
    data: {
      type: 'realm',
      attributes,
    },
  });

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Authorization: serverToken,
      },
      body,
    });
  } catch (e: unknown) {
    console.error(`Error: failed to connect to realm server at ${url}`);
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }

  // Cached token may be expired — re-auth and retry once
  if (response.status === 401) {
    try {
      serverToken = await pm.refreshServerToken();
    } catch (e: unknown) {
      console.error('Error: re-authentication failed');
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }

    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.api+json',
          Authorization: serverToken,
        },
        body,
      });
    } catch (e: unknown) {
      console.error(`Error: failed to connect to realm server at ${url}`);
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  if (!response.ok) {
    let errorBody = await response.text();
    console.error(`Error: realm server returned ${response.status}`);
    if (errorBody) {
      console.error(errorBody);
    }
    process.exit(1);
  }

  let result = await response.json();
  let realmUrl = result?.data?.id;
  let normalizedRealmUrl = realmUrl ? ensureTrailingSlash(realmUrl) : undefined;

  // Obtain and store the realm JWT
  if (normalizedRealmUrl) {
    try {
      let tokens = await pm.fetchAndStoreRealmTokens(serverToken);
      if (!tokens[normalizedRealmUrl]) {
        console.error(
          `${DIM}Warning: realm created but JWT not found in auth response.${RESET}`,
        );
      }
    } catch {
      console.error(
        `${DIM}Warning: realm created but could not obtain realm JWT.${RESET}`,
      );
    }

    // Register realm in Matrix account data so it appears in the Boxel dashboard
    try {
      await pm.registerRealmInDashboard(normalizedRealmUrl);
    } catch {
      console.error(
        `${DIM}Warning: could not register realm in dashboard. It may not appear until next login.${RESET}`,
      );
    }
  }

  console.log(
    `${FG_GREEN}Realm created:${RESET} ${FG_CYAN}${realmUrl ?? realmName}${RESET}`,
  );
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
