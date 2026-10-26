import type Koa from 'koa';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import { isSecureSession } from '../lib/secure-session.ts';
import {
  secureWindowContext,
  validateContextRequest,
} from '../lib/secure-window.ts';
import { UserKeyError } from '../lib/user-keys.ts';
import {
  keysHandler,
  ownerOf,
  readJSON,
  sendJSON,
} from './handle-user-keys.ts';

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

// `POST /_secure-window/context`: what the secure window was opened for — a
// realm, a card or type, an operation on it — described from the server's own
// records (`lib/secure-window.ts`). Asked with the window's own session, as
// every request the window makes is.
export function handleSecureWindowContext({
  dbAdapter,
  realms,
  definitionLookup,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    if (
      !(await isSecureSession(
        dbAdapter,
        ctxt.state.token as RealmServerTokenClaim | undefined,
      ))
    ) {
      throw new UserKeyError(
        403,
        'the secure window asks this with its own session',
      );
    }
    let body = await readJSON(ctxt);
    let data = body.data as
      | { type?: unknown; attributes?: Record<string, unknown> }
      | undefined;
    if (
      !data ||
      typeof data !== 'object' ||
      data.type !== 'secure-window-context'
    ) {
      throw new UserKeyError(
        400,
        `the resource type is 'secure-window-context'`,
      );
    }
    let attributes = data.attributes ?? {};
    if (typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new UserKeyError(400, 'attributes must be an object');
    }
    let context = await secureWindowContext(
      { dbAdapter, realms, definitionLookup },
      user,
      validateContextRequest(attributes),
    );
    await sendJSON(ctxt, 200, {
      data: { type: 'secure-window-context', attributes: context },
    });
  });
}
