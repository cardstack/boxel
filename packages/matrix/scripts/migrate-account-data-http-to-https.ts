// One-off migration: rewrite `app.boxel.realms` account_data entries
// that reference `http://localhost:42XX/...` to the new canonical
// `https://` scheme — or the reverse if `--reverse` is passed.
// Companion to the `1779100257124_canonical-url-http-to-https`
// postgres migration — that one rewrites the realm-server DB; this
// one rewrites the per-user state synapse holds for every Boxel user
// (the list of workspaces the host bundle reads via
// `getAccountDataFromServer` on app boot). Without this migration, a
// logged-in user's app keeps fetching the http:// realm URLs, the
// realm-server's dispatcher 301-redirects every request to https://,
// and the browser blocks the CORS preflight ("Redirect is not allowed
// for a preflight request").
//
// The script logs in as the local synapse admin user, lists every
// user, admin-impersonates each one to get an access token (the
// standard account_data endpoint requires the user's own token —
// synapse admin can read but not write other users' account_data),
// reads `app.boxel.realms`, rewrites any matching URLs in-place, and
// PUTs the updated list back.
//
// Safe to re-run: rows already in the target scheme are left
// untouched, and the PUT only fires when at least one URL changed.

import { getSynapseURL } from '../helpers/environment-config';

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'password';
const ACCOUNT_DATA_TYPE = 'app.boxel.realms';

// Default direction is http → https (forward). `--reverse` flips it to
// https → http, e.g. for `pnpm migrate down` on the postgres migration.
const REVERSE = process.argv.includes('--reverse');
const FROM_SCHEME = REVERSE ? 'https' : 'http';
const TO_SCHEME = REVERSE ? 'http' : 'https';

// Match the local realm-server canonicals — both the standard-mode
// `localhost:42XX` ports (mirrors the postgres migration
// `1779100257124_canonical-url-http-to-https.js`, which covers :4201,
// :4202, and :4205) and the env-mode Traefik hostnames under
// `*.localhost` (e.g. `realm-server.<slug>.localhost`,
// `icons.<slug>.localhost`). Production / staging realm URLs are real
// hostnames and would never appear in a local synapse, so the
// `.localhost` tail keeps the touch-set scoped to local dev data.
const STANDARD_MODE_PORTS = new Set(['4201', '4202', '4205']);

function shouldFlipScheme(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== `${FROM_SCHEME}:`) return false;
  if (parsed.hostname === 'localhost') {
    return STANDARD_MODE_PORTS.has(parsed.port);
  }
  // Env-mode Traefik hostnames: any `<...>.localhost`. RFC 6761
  // reserves `.localhost` as loopback, so this can't false-match a
  // real production hostname.
  return parsed.hostname.endsWith('.localhost');
}

interface LoginResponse {
  access_token: string;
  user_id: string;
}

async function loginAsAdmin(synapseURL: string): Promise<string> {
  let response = await fetch(`${synapseURL}/_matrix/client/r0/login`, {
    method: 'POST',
    body: JSON.stringify({
      type: 'm.login.password',
      user: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to log in as admin: HTTP ${response.status} ${await response.text()}`,
    );
  }
  let body = (await response.json()) as LoginResponse;
  return body.access_token;
}

async function listAllUsers(
  synapseURL: string,
  adminToken: string,
): Promise<string[]> {
  let userIds: string[] = [];
  let from: string | undefined;
  // Paginate via `next_token`.
  for (;;) {
    let url = new URL(`${synapseURL}/_synapse/admin/v2/users`);
    url.searchParams.set('limit', '100');
    url.searchParams.set('guests', 'false');
    url.searchParams.set('deactivated', 'false');
    if (from) url.searchParams.set('from', from);
    let response = await fetch(url, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!response.ok) {
      throw new Error(
        `Failed to list users: HTTP ${response.status} ${await response.text()}`,
      );
    }
    let body = (await response.json()) as {
      users: Array<{ name: string }>;
      next_token?: string;
    };
    for (let u of body.users) userIds.push(u.name);
    if (!body.next_token) break;
    from = body.next_token;
  }
  return userIds;
}

async function impersonate(
  synapseURL: string,
  adminToken: string,
  userId: string,
): Promise<string> {
  // Synapse admin endpoint that returns an access token for any user.
  let response = await fetch(
    `${synapseURL}/_synapse/admin/v1/users/${encodeURIComponent(
      userId,
    )}/login`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to impersonate ${userId}: HTTP ${response.status} ${await response.text()}`,
    );
  }
  let body = (await response.json()) as { access_token: string };
  return body.access_token;
}

async function getRealmsAccountData(
  synapseURL: string,
  userId: string,
  userToken: string,
): Promise<{ realms?: string[] } | null> {
  let response = await fetch(
    `${synapseURL}/_matrix/client/v3/user/${encodeURIComponent(
      userId,
    )}/account_data/${ACCOUNT_DATA_TYPE}`,
    { headers: { Authorization: `Bearer ${userToken}` } },
  );
  if (response.status === 404) {
    // User has no `app.boxel.realms` yet — nothing to migrate.
    return null;
  }
  if (!response.ok) {
    throw new Error(
      `Failed to GET ${ACCOUNT_DATA_TYPE} for ${userId}: HTTP ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as { realms?: string[] };
}

async function putRealmsAccountData(
  synapseURL: string,
  userId: string,
  userToken: string,
  content: unknown,
): Promise<void> {
  let response = await fetch(
    `${synapseURL}/_matrix/client/v3/user/${encodeURIComponent(
      userId,
    )}/account_data/${ACCOUNT_DATA_TYPE}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(content),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Failed to PUT ${ACCOUNT_DATA_TYPE} for ${userId}: HTTP ${response.status} ${await response.text()}`,
    );
  }
}

function rewriteURLs(urls: string[]): { urls: string[]; changedCount: number } {
  let changedCount = 0;
  let rewritten = urls.map((url) => {
    if (shouldFlipScheme(url)) {
      changedCount++;
      return `${TO_SCHEME}://${url.slice(`${FROM_SCHEME}://`.length)}`;
    }
    return url;
  });
  return { urls: rewritten, changedCount };
}

async function main(): Promise<void> {
  let synapseURL = getSynapseURL();
  console.log(
    `[migrate-account-data] Connecting to ${synapseURL} (${FROM_SCHEME} → ${TO_SCHEME})`,
  );

  let adminToken = await loginAsAdmin(synapseURL);
  let userIds = await listAllUsers(synapseURL, adminToken);
  console.log(`[migrate-account-data] Found ${userIds.length} users`);

  let migratedUsers = 0;
  let totalURLsChanged = 0;
  let skippedNoData = 0;
  let skippedAlreadyOnTargetScheme = 0;

  for (let userId of userIds) {
    // The admin can't impersonate itself ("Cannot use admin API to login
    // as self"). It also has no realm list of its own, so skip it.
    if (userId === `@${ADMIN_USERNAME}:localhost`) {
      continue;
    }
    let userToken: string;
    try {
      userToken = await impersonate(synapseURL, adminToken, userId);
    } catch (e) {
      console.warn(
        `[migrate-account-data] Skipping ${userId}: ${(e as Error).message}`,
      );
      continue;
    }

    let data = await getRealmsAccountData(synapseURL, userId, userToken);
    if (!data || !Array.isArray(data.realms) || data.realms.length === 0) {
      skippedNoData++;
      continue;
    }

    let { urls: rewritten, changedCount } = rewriteURLs(data.realms);
    if (changedCount === 0) {
      skippedAlreadyOnTargetScheme++;
      continue;
    }

    await putRealmsAccountData(synapseURL, userId, userToken, {
      ...data,
      realms: rewritten,
    });
    migratedUsers++;
    totalURLsChanged += changedCount;
    console.log(
      `[migrate-account-data] ${userId}: rewrote ${changedCount} URL${changedCount === 1 ? '' : 's'}`,
    );
  }

  console.log(`[migrate-account-data] Done.`);
  console.log(`  Users migrated:       ${migratedUsers}`);
  console.log(`  URLs rewritten:       ${totalURLsChanged}`);
  console.log(`  Skipped (no data):    ${skippedNoData}`);
  console.log(`  Skipped (${TO_SCHEME.padEnd(5)}):${' '.repeat(8 - TO_SCHEME.length)}${skippedAlreadyOnTargetScheme}`);
}

main().catch((err) => {
  console.error('[migrate-account-data] FAILED:', err);
  process.exit(1);
});
