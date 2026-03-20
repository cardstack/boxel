import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { defaultSupportMetadataFile } from '../../src/runtime-metadata';

export interface SupportMetadata {
  matrixURL: string;
  matrixRegistrationSecret: string;
}

export function readSupportMetadata(): SupportMetadata {
  if (!existsSync(defaultSupportMetadataFile)) {
    throw new Error(
      `Support metadata not found at ${defaultSupportMetadataFile}. Run pnpm cache:prepare first.`,
    );
  }

  let raw = readFileSync(defaultSupportMetadataFile, 'utf8');
  let parsed = JSON.parse(raw) as {
    context?: {
      matrixURL?: string;
      matrixRegistrationSecret?: string;
    };
  };

  let matrixURL = parsed.context?.matrixURL;
  let matrixRegistrationSecret = parsed.context?.matrixRegistrationSecret;

  if (!matrixURL || !matrixRegistrationSecret) {
    throw new Error(
      'Support metadata is missing matrixURL or matrixRegistrationSecret',
    );
  }

  return { matrixURL, matrixRegistrationSecret };
}

export async function registerMatrixUser(
  matrixURL: string,
  registrationSecret: string,
  username: string,
  password: string,
): Promise<void> {
  let baseUrl = matrixURL.endsWith('/') ? matrixURL : `${matrixURL}/`;
  let registerUrl = `${baseUrl}_synapse/admin/v1/register`;

  let nonceResponse = await fetch(registerUrl, { method: 'GET' });
  let { nonce } = (await nonceResponse.json()) as { nonce: string };

  let mac = createHmac('sha1', registrationSecret)
    .update(`${nonce}\0${username}\0${password}\0notadmin`)
    .digest('hex');

  let registerResponse = await fetch(registerUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nonce,
      username,
      password,
      mac,
      admin: false,
    }),
  });

  if (!registerResponse.ok) {
    let text = await registerResponse.text();
    throw new Error(
      `Failed to register Matrix user ${username}: HTTP ${registerResponse.status} ${text}`,
    );
  }
}

export async function getRealmToken(
  matrixURL: string,
  username: string,
  password: string,
  realmUrl: string,
): Promise<string> {
  let baseUrl = matrixURL.endsWith('/') ? matrixURL : `${matrixURL}/`;

  let loginResponse = await fetch(`${baseUrl}_matrix/client/v3/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });
  let { access_token, user_id } = (await loginResponse.json()) as {
    access_token: string;
    user_id: string;
  };

  let openIdResponse = await fetch(
    `${baseUrl}_matrix/client/v3/user/${encodeURIComponent(user_id)}/openid/request_token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${access_token}`,
      },
      body: '{}',
    },
  );
  let openId = (await openIdResponse.json()) as { access_token: string };

  let sessionResponse = await fetch(new URL('_session', realmUrl).href, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ access_token: openId.access_token }),
  });

  let realmToken = sessionResponse.headers.get('Authorization');
  if (!realmToken) {
    throw new Error('Failed to get realm session token');
  }
  return realmToken;
}

export function buildAuthenticatedFetch(
  bearerToken: string,
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    let headers = new Headers(init?.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${bearerToken}`);
    }
    return baseFetch(input, { ...init, headers });
  };
}
