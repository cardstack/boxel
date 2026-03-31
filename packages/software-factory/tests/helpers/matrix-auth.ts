import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

import { SupportedMimeType } from '../../src/mime-types';

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
  if (!nonceResponse.ok) {
    let text = await nonceResponse.text();
    throw new Error(
      `Failed to fetch registration nonce from ${registerUrl}: HTTP ${nonceResponse.status} ${text}`,
    );
  }
  let { nonce } = (await nonceResponse.json()) as { nonce: string };

  let mac = createHmac('sha1', registrationSecret)
    .update(`${nonce}\0${username}\0${password}\0notadmin`)
    .digest('hex');

  let registerResponse = await fetch(registerUrl, {
    method: 'POST',
    headers: { 'Content-Type': SupportedMimeType.JSON },
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
    headers: { 'Content-Type': SupportedMimeType.JSON },
    body: JSON.stringify({
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: username },
      password,
    }),
  });
  if (!loginResponse.ok) {
    let text = await loginResponse.text();
    throw new Error(
      `Failed to login to Matrix as ${username}: HTTP ${loginResponse.status} ${text}`,
    );
  }
  let { access_token, user_id } = (await loginResponse.json()) as {
    access_token: string;
    user_id: string;
  };

  let openIdResponse = await fetch(
    `${baseUrl}_matrix/client/v3/user/${encodeURIComponent(user_id)}/openid/request_token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': SupportedMimeType.JSON,
        Authorization: `Bearer ${access_token}`,
      },
      body: '{}',
    },
  );
  if (!openIdResponse.ok) {
    let text = await openIdResponse.text();
    throw new Error(
      `Failed to get OpenID token for ${user_id}: HTTP ${openIdResponse.status} ${text}`,
    );
  }
  let openId = (await openIdResponse.json()) as { access_token: string };

  let sessionUrl = new URL('_session', realmUrl).href;
  let sessionResponse = await fetch(sessionUrl, {
    method: 'POST',
    headers: { 'Content-Type': SupportedMimeType.JSON },
    body: JSON.stringify({ access_token: openId.access_token }),
  });
  if (!sessionResponse.ok) {
    let text = await sessionResponse.text();
    throw new Error(
      `Failed to create realm session at ${sessionUrl}: HTTP ${sessionResponse.status} ${text}`,
    );
  }

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
