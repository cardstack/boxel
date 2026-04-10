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

  let attributes: Record<string, string | undefined> = {
    endpoint: realmName,
    name: displayName,
    backgroundURL: options.background ?? getRandomBackgroundURL(),
    iconURL:
      options.icon ?? iconURLFor(displayName) ?? iconURLFor(realmName),
  };

  let response: Response;
  try {
    response = await pm.authedFetch(`${realmServerUrl}/_create-realm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.api+json' },
      body: JSON.stringify({
        data: { type: 'realm', attributes },
      }),
    });
  } catch (e: unknown) {
    console.error(`Error: failed to connect to realm server`);
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
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

  if (normalizedRealmUrl) {
    try {
      let serverToken = await pm.getOrRefreshServerToken();
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
