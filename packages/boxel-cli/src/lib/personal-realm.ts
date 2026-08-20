import {
  iconURLFor,
  getRandomBackgroundURL,
} from '@cardstack/runtime-common/realm-display-defaults';
import { ensureTrailingSlash } from '@cardstack/runtime-common/paths';

import {
  addRealmToMatrixAccountData,
  getRealmServerToken,
  getUserRealmsFromMatrixAccountData,
  type MatrixAuth,
} from './auth.ts';

// The web app's signup flow ends by creating this realm for the new account
// (see MatrixService.initializeNewUser in the host); these values mirror it so
// an account bootstrapped from the CLI is indistinguishable from one
// bootstrapped from the web.
const PERSONAL_REALM_ENDPOINT = 'personal';

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
// that flow. Synapse mints such accounts itself when a Google sign-in's
// verified email matches nothing (see boxel_oidc_mapping_provider.py), so a
// brand-new user can finish `boxel profile add` without any Boxel code having
// run in their browser.
//
// "Has none" is judged from the account's realm list in Matrix account data —
// the same list the web app assembles a session from — so accounts that
// already have realms, however they got them, are left alone.
export async function ensurePersonalRealm(
  auth: MatrixAuth,
  realmServerUrl: string,
): Promise<EnsurePersonalRealmResult> {
  let realms = await getUserRealmsFromMatrixAccountData(auth);
  if (realms.length > 0) {
    return { outcome: 'has-realms' };
  }

  let displayName =
    (await fetchMatrixDisplayName(auth)) ?? localpart(auth.userId);
  let name = `${displayName}'s Workspace`;

  let serverToken = await getRealmServerToken(auth, realmServerUrl);
  let response = await fetch(
    `${realmServerUrl.replace(/\/$/, '')}/_create-realm`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/vnd.api+json',
        Authorization: serverToken,
      },
      body: JSON.stringify({
        data: {
          type: 'realm',
          attributes: {
            endpoint: PERSONAL_REALM_ENDPOINT,
            name,
            iconURL: iconURLFor(displayName),
            backgroundURL: getRandomBackgroundURL(),
          },
        },
      }),
    },
  );

  if (!response.ok) {
    let errorBody = await response.text();
    // The realm exists but the account's realm list doesn't mention it (the
    // list read above was empty). Re-link it instead of failing: the point of
    // this bootstrap is an account whose realm list names a realm it can use.
    if (errorBody.includes('already exists')) {
      let realmUrl = errorBody.match(/'(https?:\/\/[^']+)'/)?.[1];
      if (realmUrl) {
        realmUrl = ensureTrailingSlash(realmUrl);
        await addRealmToMatrixAccountData(auth, realmUrl);
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
  await addRealmToMatrixAccountData(auth, realmUrl);
  return { outcome: 'created', realmUrl };
}

function localpart(userId: string): string {
  return userId.replace(/^@/, '').split(':')[0];
}

// The account's Matrix display name, which for a Google-provisioned account
// Synapse set from the Google profile's name — the closest thing such an
// account has to the display name the web signup form would have collected.
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
