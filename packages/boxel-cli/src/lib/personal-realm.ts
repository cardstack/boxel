import {
  iconURLFor,
  getRandomBackgroundURL,
  PERSONAL_REALM_ENDPOINT,
} from '@cardstack/runtime-common/realm-display-defaults';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import {
  addRealmToMatrixAccountData,
  getRealmServerToken,
  requireUserRealmsFromMatrixAccountData,
  type MatrixAuth,
} from './auth.ts';

export type EnsurePersonalRealmResult =
  // The account already has at least one realm; nothing was done.
  | { outcome: 'has-realms' }
  // A personal realm was created and recorded in the account's realm list.
  | { outcome: 'created'; realmUrl: string }
  // The personal realm already existed on the server but was missing from the
  // account's realm list; it was re-linked rather than created.
  | { outcome: 'linked'; realmUrl: string };

// Give an account its personal realm if it has none — the account-level
// bootstrap the web app runs at signup, for accounts that never went through
// that flow, such as one made on the Matrix server directly, so a brand-new
// user can finish `boxel profile add` without any Boxel code having run in
// their browser.
//
// "Has none" is judged from the account's realm list in Matrix account data —
// the same list the web app assembles a session from — so accounts that
// already have realms, however they got them, are left alone. The read is
// strict (confirmed answer or throw): this gate triggers an automatic
// mutation, so a failed read must surface as "couldn't determine" — which the
// caller turns into a warning — rather than read as "has no realms" and mint
// a realm for an account that already has them.
export async function ensurePersonalRealm(
  auth: MatrixAuth,
  realmServerUrl: string,
): Promise<EnsurePersonalRealmResult> {
  return bootstrapPersonalRealm({
    readRealms: () => requireUserRealmsFromMatrixAccountData(auth),
    displayName: async () =>
      (await fetchMatrixDisplayName(auth)) ?? localpart(auth.userId),
    createRealm: async (init) => {
      let serverToken = await getRealmServerToken(auth, realmServerUrl);
      let headers = new Headers(init.headers);
      headers.set('Authorization', serverToken);
      return fetch(createRealmUrl(realmServerUrl), { ...init, headers });
    },
    addToList: (realmUrl) => addRealmToMatrixAccountData(auth, realmUrl),
  });
}

// The same bootstrap for a profile signed in with OAuth, with the access
// token its sign-in just got. The realm server keeps the account's realm
// list for an OAuth caller: `/_user-realms` reads it, and `/_create-realm`
// adds the realm it creates, or re-links one of the caller's own that
// already exists while still answering "already exists".
export async function ensurePersonalRealmWithOAuth(
  {
    accessToken,
    userId,
    displayName,
  }: { accessToken: string; userId: string; displayName?: string },
  realmServerUrl: string,
  fetchFn: typeof fetch = fetch,
): Promise<EnsurePersonalRealmResult> {
  let authorization = `Bearer ${accessToken}`;
  return bootstrapPersonalRealm({
    readRealms: () =>
      fetchWorkspaceList(realmServerUrl, authorization, fetchFn),
    displayName: async () => displayName?.trim() || localpart(userId),
    createRealm: (init) => {
      let headers = new Headers(init.headers);
      headers.set('Authorization', authorization);
      return fetchFn(createRealmUrl(realmServerUrl), { ...init, headers });
    },
  });
}

// The account's realm list as the realm server reads it for the token's
// user (`GET /_user-realms`). Throws rather than answer an empty list it
// couldn't confirm: the server answers 404 when it keeps no account for the
// user, and 503 when it can't read the list.
export async function fetchWorkspaceList(
  realmServerUrl: string,
  authorization: string,
  fetchFn: typeof fetch = fetch,
): Promise<string[]> {
  let response = await fetchFn(
    `${realmServerUrl.replace(/\/$/, '')}/_user-realms`,
    {
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: authorization,
      },
    },
  );
  return readWorkspaceListResponse(response);
}

// Reads a `GET /_user-realms` response, throwing on anything but a list.
export async function readWorkspaceListResponse(
  response: Response,
): Promise<string[]> {
  if (!response.ok) {
    let body = await response.text().catch(() => '');
    throw new Error(
      `The realm server couldn't read your workspace list: ${response.status}${body ? ` ${body.slice(0, 200)}` : ''}`,
    );
  }
  let json = (await response.json()) as {
    data?: { attributes?: { realms?: unknown } };
  };
  let realms = json?.data?.attributes?.realms;
  if (
    !Array.isArray(realms) ||
    !realms.every((realm) => typeof realm === 'string')
  ) {
    throw new Error(
      "The realm server's workspace list response did not include a list of realms",
    );
  }
  return realms;
}

interface PersonalRealmAccess {
  // The account's realm list, confirmed: throws when it can't be read.
  readRealms(): Promise<string[]>;
  displayName(): Promise<string>;
  // POSTs to `/_create-realm` with the account's credential.
  createRealm(init: RequestInit): Promise<Response>;
  // Records a realm in the account's realm list. Absent where the realm
  // server records it itself.
  addToList?(realmUrl: string): Promise<void>;
}

function createRealmUrl(realmServerUrl: string): string {
  return `${realmServerUrl.replace(/\/$/, '')}/_create-realm`;
}

async function bootstrapPersonalRealm(
  access: PersonalRealmAccess,
): Promise<EnsurePersonalRealmResult> {
  let realms = await access.readRealms();
  if (realms.length > 0) {
    return { outcome: 'has-realms' };
  }

  let displayName = await access.displayName();
  let name = `${displayName}'s Workspace`;

  let response = await access.createRealm({
    method: 'POST',
    headers: { 'Content-Type': 'application/vnd.api+json' },
    body: JSON.stringify({
      data: {
        type: 'realm',
        // These attributes mirror a first sign-in on the secure origin (see
        // `setUpFirstSignIn` in the realm server's `lib/secure-session.ts`)
        // so an account bootstrapped from the CLI is indistinguishable from
        // one bootstrapped there.
        attributes: {
          endpoint: PERSONAL_REALM_ENDPOINT,
          name,
          iconURL: iconURLFor(displayName),
          backgroundURL: getRandomBackgroundURL(),
        },
      },
    }),
  });

  if (!response.ok) {
    let errorBody = await response.text();
    // The realm exists but the account's realm list doesn't mention it (the
    // list read above was empty). Re-link it instead of failing: the point of
    // this bootstrap is an account whose realm list names a realm it can use.
    if (errorBody.includes('already exists')) {
      let realmUrl = errorBody.match(/'(https?:\/\/[^']+)'/)?.[1];
      if (realmUrl) {
        realmUrl = ensureTrailingSlash(realmUrl);
        await access.addToList?.(realmUrl);
        return { outcome: 'linked', realmUrl };
      }
    }
    throw new Error(
      `Could not create the personal realm: realm server returned ${response.status}: ${errorBody}`,
    );
  }

  let result = (await response.json()) as { data?: { id?: unknown } };
  let rawRealmUrl = result?.data?.id;
  if (typeof rawRealmUrl !== 'string' || rawRealmUrl.trim() === '') {
    throw new Error(
      'Could not create the personal realm: realm server response did not include a realm URL (data.id)',
    );
  }
  let realmUrl = ensureTrailingSlash(rawRealmUrl);
  await access.addToList?.(realmUrl);
  return { outcome: 'created', realmUrl };
}

function localpart(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0];
}

// The account's Matrix display name, which for a Google-provisioned account
// is the Google profile's name — the closest thing such an account has to the
// display name a registration form would have collected.
async function fetchMatrixDisplayName(
  auth: MatrixAuth,
): Promise<string | undefined> {
  let response: Response;
  try {
    response = await fetch(
      new URL(
        `_matrix/client/v3/profile/${encodeURIComponent(auth.userId)}/displayname`,
        auth.matrixUrl,
      ).href,
      { headers: { Authorization: `Bearer ${auth.accessToken}` } },
    );
  } catch {
    return undefined;
  }
  if (!response.ok) {
    return undefined;
  }
  try {
    let { displayname } = (await response.json()) as {
      displayname?: unknown;
    };
    return typeof displayname === 'string' && displayname.trim()
      ? displayname.trim()
      : undefined;
  } catch {
    return undefined;
  }
}
