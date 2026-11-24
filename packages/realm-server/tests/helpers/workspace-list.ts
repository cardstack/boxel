import { v4 as uuidv4 } from 'uuid';
import { APP_BOXEL_REALMS_EVENT_TYPE } from '@cardstack/runtime-common/matrix-constants';
import { fetchAccountData, registerUser } from '../../synapse.ts';
import { matrixRegistrationSecret, matrixURL } from './index.ts';

export interface ListUser {
  userId: string;
  displayName: string;
  // The user's own Matrix token, so a test reads and seeds their workspace
  // list without going through the server under test.
  accessToken: string;
}

// A new user of the test homeserver.
export async function registerListUser(prefix: string): Promise<ListUser> {
  let localpart = `${prefix}-${uuidv4().slice(0, 8)}`;
  let displayName = `List ${localpart}`;
  let { userId, accessToken } = await registerUser({
    matrixURL,
    displayname: displayName,
    username: localpart,
    password: 'password',
    registrationSecret: matrixRegistrationSecret,
  });
  return { userId, displayName, accessToken };
}

// The user's `app.boxel.realms` list as Matrix holds it.
export async function workspaceListOf(user: ListUser): Promise<unknown> {
  let { realms } = await fetchAccountData(
    matrixURL,
    user.userId,
    user.accessToken,
    APP_BOXEL_REALMS_EVENT_TYPE,
  );
  return realms;
}

export async function setWorkspaceListOf(user: ListUser, realms: string[]) {
  let response = await fetch(
    `${matrixURL.href}_matrix/client/v3/user/${encodeURIComponent(
      user.userId,
    )}/account_data/${APP_BOXEL_REALMS_EVENT_TYPE}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${user.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ realms }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `could not set ${user.userId}'s workspace list: HTTP ${response.status}`,
    );
  }
}
