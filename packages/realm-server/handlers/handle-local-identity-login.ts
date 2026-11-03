import type Koa from 'koa';
import type { CreateRoutesArgs } from '../routes.ts';
import { LocalHostedLoginError } from '../lib/local-hosted-login.ts';
import { SignInLimiter } from '../lib/sign-in-limiter.ts';

export default function handleLocalIdentityLogin({
  localHostedLogin,
  secureOriginURL,
}: Pick<CreateRoutesArgs, 'localHostedLogin' | 'secureOriginURL'>) {
  const limiter = new SignInLimiter();
  return async (ctxt: Koa.Context) => {
    ctxt.set('Cache-Control', 'no-store');
    ctxt.type = 'application/json';
    if (!localHostedLogin) {
      ctxt.status = 404;
      ctxt.body = {
        errcode: 'M_NOT_FOUND',
        error: 'Hosted sign-in is not configured',
      };
      return;
    }
    if (!secureOriginURL || ctxt.get('Origin') !== secureOriginURL.origin) {
      ctxt.status = 403;
      ctxt.body = {
        errcode: 'M_FORBIDDEN',
        error: 'Use the protected sign-in form',
      };
      return;
    }
    let account: string | undefined;
    let failed = false;
    try {
      if (!ctxt.is('application/json')) throw new LocalHostedLoginError(400);
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of ctxt.req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > 32768) throw new LocalHostedLoginError(400);
        chunks.push(buffer);
      }
      let value: unknown;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        throw new LocalHostedLoginError(400);
      }
      if (
        !value ||
        typeof value !== 'object' ||
        Array.isArray(value) ||
        Object.keys(value).length !== 2 ||
        !('username' in value) ||
        typeof value.username !== 'string' ||
        !value.username.trim() ||
        value.username.length > 512 ||
        !('password' in value) ||
        typeof value.password !== 'string' ||
        !value.password ||
        value.password.length > 8192
      )
        throw new LocalHostedLoginError(400);
      const identity = value.username.trim().toLowerCase();
      const check = limiter.start(identity);
      if (!check.allowed)
        throw new LocalHostedLoginError(429, check.retryAfterMs ?? null);
      account = identity;
      const result = await localHostedLogin({
        username: value.username,
        password: value.password,
      });
      ctxt.status = 200;
      ctxt.body = result.auth;
    } catch (error) {
      const failure =
        error instanceof LocalHostedLoginError
          ? error
          : new LocalHostedLoginError(503);
      failed = failure.status === 401;
      ctxt.status = failure.status;
      ctxt.body = {
        errcode:
          failure.status === 429
            ? 'M_LIMIT_EXCEEDED'
            : failure.status === 400
              ? 'M_BAD_JSON'
              : failure.status === 401
                ? 'M_FORBIDDEN'
                : 'M_UNAVAILABLE',
        error: failure.message,
        ...(failure.retryAfterMs === null
          ? {}
          : { retry_after_ms: failure.retryAfterMs }),
      };
      if (failure.retryAfterMs !== null)
        ctxt.set('Retry-After', String(Math.ceil(failure.retryAfterMs / 1000)));
    } finally {
      if (account !== undefined) limiter.finish(account, { failed });
    }
  };
}
