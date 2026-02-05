import * as childProcess from 'child_process';

import { loginUser } from '../docker/synapse';

const matrixURL = process.env.MATRIX_URL || 'http://localhost:8008';
const realmServerURL = process.env.REALM_SERVER_URL || 'http://localhost:4201';
const username = process.env.MATRIX_USERNAME || 'submissionbot';
const password = process.env.MATRIX_PASSWORD || 'password';
const isAdmin = process.env.MATRIX_IS_ADMIN === 'TRUE';
const registrationToken = process.env.REALM_REGISTRATION_TOKEN ?? null;

function toLocalpart(value: string): string {
  let trimmed = value.startsWith('@') ? value.slice(1) : value;
  let colonIndex = trimmed.indexOf(':');
  return colonIndex === -1 ? trimmed : trimmed.slice(0, colonIndex);
}

async function ensureMatrixUser(): Promise<void> {
  const localpart = toLocalpart(username);
  const command = `docker exec boxel-synapse register_new_matrix_user http://localhost:8008 -c /data/homeserver.yaml -u ${localpart} -p ${password} ${
    isAdmin ? `--admin` : `--no-admin`
  }`;

  await new Promise<void>((resolve, reject) => {
    childProcess.exec(command, async (err, stdout) => {
      if (err) {
        if (stdout.includes('User ID already taken')) {
          let cred = await loginUser(localpart, password, matrixURL);
          if (!cred.userId) {
            reject(
              new Error(
                `User ${localpart} already exists in matrix, but the password does not match`,
              ),
            );
            return;
          }
          console.log(
            `User ${localpart} already exists in matrix and the password matches`,
          );
          resolve();
          return;
        }
        reject(err);
        return;
      }
      console.log(stdout.trim());
      resolve();
    });
  });
}

async function getOpenIdToken(
  userId: string,
  accessToken: string,
): Promise<string> {
  const url = `${matrixURL}/_matrix/client/v3/user/${encodeURIComponent(userId)}/openid/request_token`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  const text = await response.text();
  let json: { access_token?: string };
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `OpenID token response was not JSON: ${text || response.statusText}`,
    );
  }

  if (!response.ok || !json.access_token) {
    throw new Error(
      `OpenID token request failed: ${response.status} ${response.statusText}`,
    );
  }

  return json.access_token;
}

async function createServerSession(openIdToken: string): Promise<string> {
  const response = await fetch(`${realmServerURL}/_server-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: openIdToken }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `Failed to create realm session: ${response.status} ${text}`,
    );
  }

  const jwt = response.headers.get('Authorization');
  if (!jwt) {
    throw new Error('Realm session response missing Authorization header');
  }

  return jwt;
}

async function createRealmUser(jwt: string) {
  const response = await fetch(`${realmServerURL}/_user`, {
    method: 'POST',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'user',
        attributes: {
          registrationToken,
        },
      },
    }),
  });

  if (response.ok) {
    return;
  }

  const text = await response.text();
  if (response.status === 422 && text.includes('User already exists')) {
    console.log('Realm user already exists');
    return;
  }

  throw new Error(`Failed to create realm user: ${response.status} ${text}`);
}

async function registerBot(jwt: string, matrixUserId: string) {
  const response = await fetch(`${realmServerURL}/_bot-registration`, {
    method: 'POST',
    headers: {
      Authorization: jwt,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        type: 'bot-registration',
        attributes: {
          username: matrixUserId,
        },
      },
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to register bot: ${response.status} ${text}`);
  }
}

(async () => {
  await ensureMatrixUser();
  const localpart = toLocalpart(username);
  const { userId, accessToken } = await loginUser(
    localpart,
    password,
    matrixURL,
  );
  if (!userId || !accessToken) {
    throw new Error('Matrix login failed: missing userId or accessToken');
  }

  const openIdToken = await getOpenIdToken(userId, accessToken);
  const jwt = await createServerSession(openIdToken);
  await createRealmUser(jwt);
  await registerBot(jwt, userId);

  console.log(`Registered bot runner user ${userId}`);
})().catch((error) => {
  console.error('register-bot-runner failed', error);
  process.exit(1);
});
