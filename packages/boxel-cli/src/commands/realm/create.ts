import type { Command } from 'commander';
import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';
import {
  getProfileManager,
  getUsernameFromMatrixId,
} from '../../lib/profile-manager';
import {
  matrixLogin,
  getRealmServerToken,
  getRealmTokens,
  addRealmToMatrixAccountData,
} from '../../lib/auth';
import { FG_GREEN, FG_CYAN, DIM, RESET } from '../../lib/colors';

const ENDPOINT_PATTERN = /^[a-z0-9-]+$/;

export function registerCreateCommand(realm: Command): void {
  realm
    .command('create')
    .description('Create a new realm on the realm server')
    .argument('<endpoint>', 'realm endpoint (lowercase, numbers, hyphens only)')
    .argument('<name>', 'display name for the realm')
    .option('--background <url>', 'background image URL')
    .option('--icon <url>', 'icon image URL')
    .action(async (endpoint: string, name: string, options: CreateOptions) => {
      await createRealm(endpoint, name, options);
    });
}

interface CreateOptions {
  background?: string;
  icon?: string;
}

export async function createRealm(
  endpoint: string,
  name: string,
  options: CreateOptions,
): Promise<void> {
  if (!ENDPOINT_PATTERN.test(endpoint)) {
    console.error(
      'Error: endpoint must contain only lowercase letters, numbers, and hyphens',
    );
    process.exit(1);
  }

  let pm = getProfileManager();
  let active = pm.getActiveProfile();
  if (!active) {
    console.error(
      'Error: no active profile. Run `boxel profile add` to create one.',
    );
    process.exit(1);
  }

  let { id: profileId, profile } = active;
  let username = getUsernameFromMatrixId(profileId);
  let realmServerUrl = profile.realmServerUrl.replace(/\/$/, '');

  // Try cached server token first, fall back to full Matrix auth
  let serverToken = pm.getRealmServerToken();
  let matrixAuth;

  if (!serverToken) {
    try {
      matrixAuth = await matrixLogin(
        profile.matrixUrl,
        username,
        profile.password,
      );
    } catch (e: unknown) {
      console.error(
        `Error: Matrix login failed for ${profileId}`,
      );
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }

    try {
      serverToken = await getRealmServerToken(matrixAuth, realmServerUrl);
      pm.setRealmServerToken(serverToken);
    } catch (e: unknown) {
      console.error('Error: failed to obtain realm server token');
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    }
  }

  // Build request attributes with default icon/background
  let attributes: Record<string, string> = { endpoint, name };
  attributes.backgroundURL = options.background ?? getRandomBackgroundURL();
  attributes.iconURL = options.icon ?? iconURLFor(name) ?? iconURLFor(endpoint) ?? '';

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
  if (response.status === 401 && !matrixAuth) {
    try {
      matrixAuth = await matrixLogin(
        profile.matrixUrl,
        username,
        profile.password,
      );
      serverToken = await getRealmServerToken(matrixAuth, realmServerUrl);
      pm.setRealmServerToken(serverToken);
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
      let realmTokenMap = await getRealmTokens(realmServerUrl, serverToken);
      let realmJwt = realmTokenMap[normalizedRealmUrl];
      if (realmJwt) {
        pm.setRealmToken(normalizedRealmUrl, realmJwt);
      }
    } catch {
      // Non-fatal — realm was created but we couldn't persist the token
      console.error(
        `${DIM}Warning: realm created but could not obtain realm JWT. Run a command against the realm to re-authenticate.${RESET}`,
      );
    }

    // Register realm in Matrix account data so it appears in the Boxel dashboard
    try {
      if (!matrixAuth) {
        matrixAuth = await matrixLogin(
          profile.matrixUrl,
          username,
          profile.password,
        );
      }
      await addRealmToMatrixAccountData(matrixAuth, normalizedRealmUrl);
    } catch {
      // Non-fatal — realm was created but won't appear in dashboard until next login
      console.error(
        `${DIM}Warning: could not register realm in dashboard. It may not appear until next login.${RESET}`,
      );
    }
  }

  console.log(
    `${FG_GREEN}Realm created:${RESET} ${FG_CYAN}${realmUrl ?? endpoint}${RESET}`,
  );
}

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
