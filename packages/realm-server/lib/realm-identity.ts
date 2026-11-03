import type {
  MatrixRealmIdentityResolver,
  MatrixOpenIdTokenVerifier,
} from '@cardstack/runtime-common/matrix-backend-authentication';
import { createLocalIdentityVerifier } from './hosted-identity.ts';
import { getMatrixUsername } from '@cardstack/runtime-common/matrix-client';
import { createHash } from 'node:crypto';
import {
  LocalHostedLoginError,
  type LinkedLocalLogin,
} from './local-hosted-login.ts';
import { runAsGuardedCall } from './outbound/guarded-call-context.ts';

async function readIdentityJSON(
  response: Response,
  maxBytes: number,
): Promise<unknown> {
  if (!response.body) throw new Error('Invalid identity response');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error('Invalid identity response');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function validUserId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 255 &&
    /^@[^:\s]+:[^\s/]+$/.test(value)
  );
}

function nativeBrokerConfiguration(
  env: NodeJS.ProcessEnv,
): { url: URL; secret: string } | undefined {
  const endpoint = env.BOXEL_LOCAL_IDENTITY_BROKER_URL;
  const secret = env.BOXEL_LOCAL_IDENTITY_BROKER_SECRET;
  if (endpoint === undefined && secret === undefined) return undefined;
  let url: URL;
  try {
    url = new URL(endpoint ?? '');
  } catch {
    throw new Error('Invalid native identity broker configuration');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !secret ||
    !/^[a-f0-9]{64}$/.test(secret)
  )
    throw new Error('Invalid native identity broker configuration');
  return { url, secret };
}

export function createRealmOwnerNamespace(
  env: NodeJS.ProcessEnv = process.env,
): (ownerUserId: string) => string {
  if (!nativeBrokerConfiguration(env)) return getMatrixUsername;
  const localServer = env.MATRIX_SERVER_NAME;
  if (!localServer || !/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(localServer))
    throw new Error(
      'Native realm ownership requires the configured Matrix server name',
    );
  return (ownerUserId) => {
    if (!validUserId(ownerUserId))
      throw new Error('Invalid realm owner identity');
    const separator = ownerUserId.indexOf(':');
    const localpart = ownerUserId.slice(1, separator);
    const serverName = ownerUserId.slice(separator + 1);
    if (serverName === '.' || serverName === '..')
      throw new Error('Invalid realm owner server name');
    if (
      serverName === localServer &&
      localpart !== 'matrix' &&
      /^[a-z0-9][a-z0-9._-]*$/.test(localpart)
    )
      return localpart;
    return `matrix/${encodeURIComponent(serverName)}/${createHash('sha256').update(ownerUserId).digest('hex')}`;
  };
}

export function createMatrixOpenIdTokenVerifier(
  env: NodeJS.ProcessEnv = process.env,
): MatrixOpenIdTokenVerifier {
  if (!nativeBrokerConfiguration(env))
    return (client, token, matrixServerName) =>
      client.verifyOpenIdToken(token, matrixServerName);
  const verifier = createLocalIdentityVerifier({
    matrixURL: env.MATRIX_URL ?? '',
    matrixServerName: env.MATRIX_SERVER_NAME ?? '',
  });
  return (_client, token) => verifier.identify(token);
}

export function createLocalHostedLoginClient(
  env: NodeJS.ProcessEnv = process.env,
): ((request: unknown) => Promise<LinkedLocalLogin>) | null {
  const configuration = nativeBrokerConfiguration(env);
  if (!configuration) return null;
  const localServer = env.MATRIX_SERVER_NAME;
  if (!localServer)
    throw new Error(
      'Native sign-in requires the configured Matrix server name',
    );
  const { url, secret } = configuration;
  return (request) =>
    runAsGuardedCall(async () => {
      try {
        const response = await fetch(new URL('v1/login-hosted', url), {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${secret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(request),
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
        });
        const value = await readIdentityJSON(response, 32768);
        if (!response.ok) {
          const retryAfterMs =
            value &&
            typeof value === 'object' &&
            'retryAfterMs' in value &&
            typeof value.retryAfterMs === 'number' &&
            Number.isFinite(value.retryAfterMs) &&
            value.retryAfterMs >= 0
              ? Math.ceil(value.retryAfterMs)
              : null;
          throw new LocalHostedLoginError(
            response.status === 400
              ? 400
              : response.status === 401
                ? 401
                : response.status === 429
                  ? 429
                  : 503,
            retryAfterMs,
          );
        }
        if (
          !value ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.keys(value).length !== 2 ||
          !('auth' in value) ||
          !value.auth ||
          typeof value.auth !== 'object' ||
          Array.isArray(value.auth) ||
          !('binding' in value) ||
          !value.binding ||
          typeof value.binding !== 'object' ||
          Array.isArray(value.binding) ||
          Object.keys(value.binding).length !== 2 ||
          !('hostedUserId' in value.binding) ||
          !validUserId(value.binding.hostedUserId) ||
          !('localUserId' in value.binding) ||
          !validUserId(value.binding.localUserId) ||
          value.binding.localUserId.slice(
            value.binding.localUserId.indexOf(':') + 1,
          ) !== localServer ||
          value.binding.hostedUserId.slice(
            value.binding.hostedUserId.indexOf(':') + 1,
          ) === localServer ||
          Object.keys(value.auth).length !== 3 ||
          !('user_id' in value.auth) ||
          value.auth.user_id !== value.binding.localUserId ||
          !('access_token' in value.auth) ||
          typeof value.auth.access_token !== 'string' ||
          !value.auth.access_token ||
          value.auth.access_token.length > 8192 ||
          !('device_id' in value.auth) ||
          typeof value.auth.device_id !== 'string' ||
          !value.auth.device_id ||
          value.auth.device_id.length > 255
        )
          throw new LocalHostedLoginError(503);
        return {
          binding: {
            hostedUserId: value.binding.hostedUserId,
            localUserId: value.binding.localUserId,
          },
          auth: {
            user_id: value.auth.user_id,
            access_token: value.auth.access_token,
            device_id: value.auth.device_id,
          },
        };
      } catch (error) {
        if (error instanceof LocalHostedLoginError) throw error;
        throw new LocalHostedLoginError(503);
      }
    });
}

export function createRealmIdentityResolver(
  env: NodeJS.ProcessEnv = process.env,
): MatrixRealmIdentityResolver {
  const configuration = nativeBrokerConfiguration(env);
  if (!configuration)
    return async (matrixUser) => ({ user: matrixUser, matrixUser });
  const { url, secret } = configuration;
  const resolveURL = new URL('v1/resolve-verified', url);
  return async (matrixUser) => {
    if (!validUserId(matrixUser))
      throw new Error('Invalid verified Matrix identity');
    try {
      const response = await fetch(resolveURL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ localUserId: matrixUser }),
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('Identity resolution unavailable');
      }
      const value = await readIdentityJSON(response, 4096);
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        !('kind' in value) ||
        Object.keys(value).length !== 2
      )
        throw new Error('Invalid identity resolution');
      if (
        value.kind === 'unlinked' &&
        'localUserId' in value &&
        value.localUserId === matrixUser
      )
        return { user: matrixUser, matrixUser };
      if (
        value.kind === 'requires-verification' &&
        'localUserId' in value &&
        value.localUserId === matrixUser
      )
        return undefined;
      if (
        value.kind === 'verified' &&
        'binding' in value &&
        value.binding &&
        typeof value.binding === 'object' &&
        !Array.isArray(value.binding) &&
        Object.keys(value.binding).length === 2 &&
        'localUserId' in value.binding &&
        value.binding.localUserId === matrixUser &&
        'hostedUserId' in value.binding &&
        validUserId(value.binding.hostedUserId) &&
        value.binding.hostedUserId.slice(
          value.binding.hostedUserId.indexOf(':') + 1,
        ) !== matrixUser.slice(matrixUser.indexOf(':') + 1)
      )
        return { user: value.binding.hostedUserId, matrixUser };
      throw new Error('Invalid identity resolution');
    } catch {
      throw new Error('Native identity resolution unavailable');
    }
  };
}
