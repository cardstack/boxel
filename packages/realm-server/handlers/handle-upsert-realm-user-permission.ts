import type Koa from 'koa';
import {
  insertPermissions,
  type RealmAction,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { sendResponseForBadRequest, setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

export default function handleUpsertRealmUserPermission({
  dbAdapter,
}: CreateRoutesArgs): (ctxt: Koa.Context, next: Koa.Next) => Promise<void> {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    let realm = ctxt.URL.searchParams.get('realm');
    if (!realm) {
      await sendResponseForBadRequest(ctxt, `realm param must be specified`);
      return;
    }
    let user = ctxt.URL.searchParams.get('user');
    if (!user) {
      await sendResponseForBadRequest(ctxt, `user param must be specified`);
      return;
    }

    let realmURL: URL;
    try {
      realmURL = new URL(realm);
    } catch {
      await sendResponseForBadRequest(ctxt, `realm "${realm}" is not a URL`);
      return;
    }

    let read = ctxt.URL.searchParams.get('read') === 'true';
    let write = ctxt.URL.searchParams.get('write') === 'true';
    if (!read && !write) {
      await sendResponseForBadRequest(
        ctxt,
        `at least one of read or write must be true (use the realm-permissions delete flow to revoke)`,
      );
      return;
    }
    if (write && !read) {
      await sendResponseForBadRequest(
        ctxt,
        `write permission requires read permission`,
      );
      return;
    }

    let actions: RealmAction[] = [];
    if (read) {
      actions.push('read');
    }
    if (write) {
      actions.push('write');
    }
    await insertPermissions(dbAdapter, realmURL, { [user]: actions });

    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          message: `Set ${actions.join('+')} on ${realmURL.href} for user "${user}"`,
        }),
        {
          headers: { 'content-type': SupportedMimeType.JSON },
        },
      ),
    );
  };
}
