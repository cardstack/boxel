// Dedicated OAuth deployment of the same provider the RealmServer embeds.
// It shares Boxel identity/permission data, but serves no cards or host code.
import Koa from 'koa';
import { mkdirSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { PgAdapter } from '@cardstack/postgres';
import { MatrixClient } from '@cardstack/runtime-common/matrix-client';
import { createSecureOrigin } from './lib/secure-origin.ts';
import {
  createBoxelOAuthProvider,
  boxelOAuthConfigFromEnv,
} from './lib/oauth/provider.ts';
import { startSecretsAtRest } from './lib/secrets-at-rest/index.ts';
import {
  handlePasswordSignIn,
  handleGoogleSignIn,
  handleGoogleSignInStart,
  handleEndSecureSession,
} from './handlers/handle-secure-session.ts';
import { retrieveUserSessionClaim } from './utils/jwt.ts';

async function main() {
  let required = (key: string) => {
    let value = process.env[key];
    if (!value) {
      throw new Error(`Required setting is absent: ${key}`);
    }
    return value;
  };
  let secureOriginURL = new URL(required('BOXEL_OAUTH_ORIGIN'));
  if (
    secureOriginURL.protocol !== 'https:' ||
    secureOriginURL.pathname !== '/'
  ) {
    throw new Error('OAuth origin must be an HTTPS origin');
  }
  let realmSecretSeed = required('BOXEL_OAUTH_SESSION_SECRET');
  let config = boxelOAuthConfigFromEnv();
  if (!config) {
    throw new Error('Boxel OAuth is not configured');
  }
  await startSecretsAtRest({ deployed: process.env.NODE_ENV === 'production' });
  if (process.env.BOXEL_OAUTH_MIGRATE === 'true') {
    // Apply only additive auth migrations. Never migrate an older demo's
    // realm/index schema as a side effect of deploying this separate service.
    let directory = '/tmp/boxel-oauth-migrations';
    mkdirSync(directory, { recursive: true });
    for (let name of [
      '1792107467874_add-secure-sessions.js',
      '1792450059514_add-boxel-oauth-provider.js',
    ]) {
      copyFileSync(
        join(import.meta.dirname, '../postgres/migrations', name),
        join(directory, name),
      );
    }
    let require = createRequire(
      new URL('../postgres/package.json', import.meta.url),
    );
    let imported = require('node-pg-migrate');
    let migrate = imported.default ?? imported;
    await migrate({
      databaseUrl: {
        host: required('PGHOST'),
        port: Number(required('PGPORT')),
        user: required('PGUSER'),
        password: required('PGPASSWORD'),
        database: required('PGDATABASE'),
      },
      dir: directory,
      migrationsTable: 'boxel_oauth_migrations',
      direction: 'up',
      checkOrder: true,
      log: () => {},
    });
  }
  let dbAdapter = new PgAdapter({ autoMigrate: false });
  let matrixClient = new MatrixClient({
    matrixURL: new URL(required('MATRIX_URL')),
    username: required('MATRIX_ADMIN_USERNAME'),
    password: required('MATRIX_ADMIN_PASSWORD'),
  });
  let args = {
    dbAdapter,
    matrixClient,
    realmSecretSeed,
    secureOriginURL,
    matrixAdminUsername: required('MATRIX_ADMIN_USERNAME'),
    matrixAdminPassword: required('MATRIX_ADMIN_PASSWORD'),
  };
  let oauth = createBoxelOAuthProvider(config, args);
  // Log protocol outcomes only, never authorization codes or token values.
  oauth.provider.on('grant.success', (ctx) => {
    let response = ctx.body as
      | { expires_in?: number; refresh_token?: string }
      | undefined;
    console.info(
      '[boxel-oauth] token issued',
      JSON.stringify({
        grantType: ctx.oidc.params?.grant_type,
        clientId: ctx.oidc.client?.clientId,
        expiresIn: response?.expires_in,
        refreshTokenIssued: typeof response?.refresh_token === 'string',
      }),
    );
  });
  let authRoutes = new Map<string, Koa.Middleware>();
  authRoutes.set('POST /_secure-session', handlePasswordSignIn(args));
  authRoutes.set('GET /_secure-session/google', handleGoogleSignInStart(args));
  authRoutes.set('POST /_secure-session/google', handleGoogleSignIn(args));
  authRoutes.set('DELETE /_secure-session', async (ctx, next) => {
    ctx.state.token = await retrieveUserSessionClaim(
      ctx.get('Authorization'),
      realmSecretSeed,
      dbAdapter,
    );
    await handleEndSecureSession(args)(ctx, next);
  });
  let origin = createSecureOrigin(
    secureOriginURL,
    undefined,
    { realmServerURL: secureOriginURL },
    async (ctx) => {
      if (ctx.path === '/health') {
        ctx.body = 'Boxel OAuth ready';
        return true;
      }
      if (
        ctx.path === '/_secure-session' ||
        ctx.path.startsWith('/_secure-session/')
      ) {
        let route = authRoutes.get(`${ctx.method} ${ctx.path}`);
        if (!route) {
          ctx.status = 405;
          return true;
        }
        await route(ctx, async () => {});
        return true;
      }
      return await oauth.handle(ctx);
    },
  );
  let app = new Koa().use(async (ctx) => {
    if (!origin.matches(ctx)) {
      ctx.status = 404;
      return;
    }
    await origin.handle(ctx);
  });
  let server = app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0', () =>
    console.log('Boxel OAuth is listening'),
  );
  for (let signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () =>
      server.close(() => {
        dbAdapter.close().finally(() => process.exit(0));
      }),
    );
  }
}
main().catch(() => {
  console.error(
    'Boxel OAuth startup failed; check required configuration and database connectivity',
  );
  process.exitCode = 1;
});
