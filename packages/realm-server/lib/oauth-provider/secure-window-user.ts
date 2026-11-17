// The check every route the secure origin's own pages call is behind: consent
// (`consent.ts`) and Connected apps (`connections.ts`). Card code on the app's
// origin can't reach the secure window's session, so it can neither decide a
// flow nor see or end a user's connections.

import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import { AuthenticationError } from '@cardstack/runtime-common/router';
import { secureSessionClient } from '../secure-session.ts';
import { retrieveUserSessionClaim } from '../../utils/jwt.ts';

export interface SecureWindowDeps {
  dbAdapter: DBAdapter;
  secureOriginURL: URL;
  realmSecretSeed: string;
}

// The secure window's user (their Matrix ID), or undefined once the request
// has been answered. Only the secure origin's pages are answered: a browser
// always sends `Origin` on these requests, and page script can't change it.
// Only the secure window's own session is accepted, never the app's session,
// and never the CLI's, whose requests can claim any `Origin`.
export async function secureWindowUser(
  ctxt: Koa.Context,
  { dbAdapter, secureOriginURL, realmSecretSeed }: SecureWindowDeps,
): Promise<string | undefined> {
  if (ctxt.get('Origin') !== secureOriginURL.origin) {
    respond(ctxt, 403, { error: 'forbidden' });
    return undefined;
  }
  let authorization = ctxt.get('Authorization');
  if (authorization) {
    try {
      let token = await retrieveUserSessionClaim(
        authorization,
        realmSecretSeed,
        dbAdapter,
      );
      if ((await secureSessionClient(dbAdapter, token)) === 'window') {
        return token.user;
      }
    } catch (error) {
      if (!(error instanceof AuthenticationError)) {
        throw error;
      }
    }
  }
  respond(ctxt, 401, { error: 'signed-out' });
  return undefined;
}

// Answers a JSON body, never cached: each answer is one user's.
export function respond(
  ctxt: Koa.Context,
  status: number,
  body: object | undefined,
) {
  ctxt.status = status;
  ctxt.set('Cache-Control', 'no-store');
  if (body !== undefined) {
    ctxt.body = body;
  }
}
