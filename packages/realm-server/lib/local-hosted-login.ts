import { createHash, randomBytes } from 'node:crypto';
import jsonwebtoken from 'jsonwebtoken';
import { createHostedIdentityVerifier } from './hosted-identity.ts';
import type { LocalIdentityStore } from './local-identity-store.ts';
import type { LocalIdentityBinding } from './local-identity-grant.ts';
import { runAsGuardedCall } from './outbound/guarded-call-context.ts';

export interface LinkedLocalLogin {
  binding: LocalIdentityBinding;
  auth: { user_id: string; access_token: string; device_id: string };
}

export class LocalHostedLoginError extends Error {
  readonly status: 400 | 401 | 429 | 503;
  readonly retryAfterMs: number | null;
  constructor(
    status: LocalHostedLoginError['status'],
    retryAfterMs: number | null = null,
  ) {
    super(
      status === 401
        ? 'That account and password do not match'
        : status === 429
          ? 'Too many sign-in attempts'
          : 'Local sign-in is unavailable',
    );
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function loginResponse(value: unknown) {
  if (
    !record(value) ||
    typeof value.user_id !== 'string' ||
    value.user_id.length > 255 ||
    !/^@[^:\s]+:[^\s/]+$/.test(value.user_id) ||
    typeof value.access_token !== 'string' ||
    !value.access_token ||
    value.access_token.length > 8192 ||
    typeof value.device_id !== 'string' ||
    !value.device_id ||
    value.device_id.length > 255
  )
    throw new LocalHostedLoginError(503);
  return {
    user_id: value.user_id,
    access_token: value.access_token,
    device_id: value.device_id,
  };
}

export function createLocalHostedLogin(
  options: {
    store: LocalIdentityStore;
    hostedIssuers: Record<string, string>;
    matrixURL: string;
    matrixServerName: string;
    matrixJwtSecret: string;
  },
  env: NodeJS.ProcessEnv = process.env,
) {
  const { store, matrixServerName, matrixJwtSecret } = options;
  createHostedIdentityVerifier({
    NODE_ENV: env.NODE_ENV,
    BOXEL_HOSTED_IDENTITY_ISSUERS: JSON.stringify(options.hostedIssuers),
  });
  const issuers = new Map(
    Object.entries(options.hostedIssuers).map(([name, endpoint]) => {
      const url = new URL(endpoint);
      if (!url.pathname.endsWith('/')) url.pathname += '/';
      return [name, url] as const;
    }),
  );
  let matrixURL: URL;
  try {
    matrixURL = new URL(options.matrixURL);
  } catch {
    throw new Error('Invalid native Matrix login configuration');
  }
  if (
    matrixURL.protocol !== 'http:' ||
    !['127.0.0.1', '[::1]'].includes(matrixURL.hostname) ||
    matrixURL.pathname !== '/' ||
    matrixURL.username ||
    matrixURL.password ||
    matrixURL.search ||
    matrixURL.hash ||
    !/^[A-Za-z0-9.-]+(?::[0-9]+)?$/.test(matrixServerName) ||
    !/^[a-f0-9]{64}$/.test(matrixJwtSecret)
  )
    throw new Error('Invalid native Matrix login configuration');

  async function exchange(
    base: URL,
    route: string,
    body: object | null,
    accessToken: string | null,
    method = 'POST',
  ) {
    const response = await fetch(new URL(route, base), {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: body === null ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.body) return { status: response.status, body: null };
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 65536) {
        await reader.cancel();
        throw new LocalHostedLoginError(503);
      }
      chunks.push(value);
    }
    let value: unknown;
    try {
      value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      value = null;
    }
    return { status: response.status, body: value };
  }

  return async (request: unknown, now: number): Promise<LinkedLocalLogin> => {
    if (
      !record(request) ||
      Object.keys(request).length !== 2 ||
      typeof request.username !== 'string' ||
      !request.username.trim() ||
      request.username.length > 512 ||
      typeof request.password !== 'string' ||
      !request.password ||
      request.password.length > 8192 ||
      !Number.isSafeInteger(now) ||
      now <= 0
    )
      throw new LocalHostedLoginError(400);
    const username = request.username.trim();
    const password = request.password;
    const serverName = username.startsWith('@')
      ? username.slice(username.indexOf(':') + 1)
      : 'boxel.ai';
    const issuer = issuers.get(serverName);
    if (!issuer) throw new LocalHostedLoginError(401);
    return runAsGuardedCall(async () => {
      let hostedAccessToken: string | undefined;
      let localAuth: LinkedLocalLogin['auth'] | undefined;
      let succeeded = false;
      try {
        const deviceId = `boxel-local-proof-${randomBytes(16).toString('hex')}`;
        let login = await exchange(
          issuer,
          '_matrix/client/v3/login',
          {
            type: 'm.login.password',
            identifier: { type: 'm.id.user', user: username },
            password,
            device_id: deviceId,
          },
          null,
        );
        if (login.status === 429) {
          const retry =
            record(login.body) &&
            typeof login.body.retry_after_ms === 'number' &&
            Number.isFinite(login.body.retry_after_ms) &&
            login.body.retry_after_ms >= 0
              ? Math.ceil(login.body.retry_after_ms)
              : null;
          throw new LocalHostedLoginError(429, retry);
        }
        if (
          login.status !== 200 &&
          username.includes('@') &&
          !username.startsWith('@')
        ) {
          login = await exchange(
            issuer,
            '_matrix/client/v3/login',
            {
              type: 'm.login.password',
              identifier: {
                type: 'm.id.thirdparty',
                medium: 'email',
                address: username,
              },
              password,
              device_id: deviceId,
            },
            null,
          );
        }
        if (login.status === 429) throw new LocalHostedLoginError(429);
        if (login.status !== 200) throw new LocalHostedLoginError(401);
        const hostedAuth = loginResponse(login.body);
        hostedAccessToken = hostedAuth.access_token;
        if (
          hostedAuth.user_id.slice(hostedAuth.user_id.indexOf(':') + 1) !==
          serverName
        )
          throw new LocalHostedLoginError(401);
        const proof = await exchange(
          issuer,
          `_matrix/client/v3/user/${encodeURIComponent(hostedAuth.user_id)}/openid/request_token`,
          {},
          hostedAccessToken,
        );
        if (
          proof.status !== 200 ||
          !record(proof.body) ||
          proof.body.matrix_server_name !== serverName ||
          typeof proof.body.access_token !== 'string' ||
          !proof.body.access_token ||
          proof.body.access_token.length > 8192
        )
          throw new LocalHostedLoginError(401);
        const localpart = `boxel_${createHash('sha256').update(hostedAuth.user_id).digest('hex')}`;
        const binding = {
          hostedUserId: hostedAuth.user_id,
          localUserId: `@${localpart}:${matrixServerName}`,
        };
        const existing = await exchange(
          matrixURL,
          `_matrix/client/v3/profile/${encodeURIComponent(binding.localUserId)}`,
          null,
          null,
          'GET',
        );
        if (
          (existing.status !== 200 && existing.status !== 404) ||
          (existing.status === 200 &&
            !(await store.isLinked(binding.localUserId)))
        )
          throw new LocalHostedLoginError(503);
        await store.link(
          binding,
          {
            matrixServerName: serverName,
            openIdToken: proof.body.access_token,
          },
          now,
        );
        const token = jsonwebtoken.sign({ sub: localpart }, matrixJwtSecret, {
          algorithm: 'HS256',
          issuer: 'boxel-local',
          audience: 'boxel-local-matrix',
          expiresIn: 300,
        });
        const result = await exchange(
          matrixURL,
          '_matrix/client/v3/login',
          { type: 'org.matrix.login.jwt', token },
          null,
        );
        if (result.status !== 200) throw new LocalHostedLoginError(503);
        localAuth = loginResponse(result.body);
        if (localAuth.user_id !== binding.localUserId)
          throw new LocalHostedLoginError(503);
        const metadata = await exchange(
          matrixURL,
          `_matrix/client/v3/user/${encodeURIComponent(binding.localUserId)}/account_data/app.boxel.hosted-identity`,
          { hostedUserId: binding.hostedUserId },
          localAuth.access_token,
          'PUT',
        );
        if (metadata.status !== 200) throw new LocalHostedLoginError(503);
        succeeded = true;
        return { binding, auth: localAuth };
      } catch (error) {
        if (error instanceof LocalHostedLoginError) throw error;
        throw new LocalHostedLoginError(503);
      } finally {
        if (hostedAccessToken)
          await exchange(
            issuer,
            '_matrix/client/v3/logout',
            {},
            hostedAccessToken,
          ).catch(() => {});
        if (localAuth && !succeeded)
          await exchange(
            matrixURL,
            '_matrix/client/v3/logout',
            {},
            localAuth.access_token,
          ).catch(() => {});
      }
    });
  };
}
