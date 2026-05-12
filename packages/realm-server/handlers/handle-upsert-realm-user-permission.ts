import type Koa from 'koa';
import {
  ensureTrailingSlash,
  insertPermissions,
  type RealmAction,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import { sendResponseForBadRequest, setContextResponse } from '../middleware';
import type { CreateRoutesArgs } from '../routes';

function parseBoolFlag(
  raw: string | null,
  name: string,
): { ok: true; value: boolean } | { ok: false; error: string } {
  if (raw === 'true') {
    return { ok: true, value: true };
  }
  if (raw === 'false') {
    return { ok: true, value: false };
  }
  if (raw == null) {
    return { ok: false, error: `${name} param must be specified` };
  }
  return {
    ok: false,
    error: `${name} param must be "true" or "false" (got "${raw}")`,
  };
}

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
    // realm_user_permissions is keyed by exact `realm_url` string. Normalise
    // to the canonical realm-root form (no querystring or fragment, single
    // trailing slash) so a caller passing `https://h/r` and another passing
    // `https://h/r/?token=...` write to the same row instead of a stray
    // permission whose URL the realm runtime never consults.
    realmURL.search = '';
    realmURL.hash = '';
    let normalizedRealmHref = ensureTrailingSlash(realmURL.href);

    let readResult = parseBoolFlag(ctxt.URL.searchParams.get('read'), 'read');
    if (!readResult.ok) {
      await sendResponseForBadRequest(ctxt, readResult.error);
      return;
    }
    let writeResult = parseBoolFlag(
      ctxt.URL.searchParams.get('write'),
      'write',
    );
    if (!writeResult.ok) {
      await sendResponseForBadRequest(ctxt, writeResult.error);
      return;
    }
    let read = readResult.value;
    let write = writeResult.value;
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
    await insertPermissions(dbAdapter, new URL(normalizedRealmHref), {
      [user]: actions,
    });

    return setContextResponse(
      ctxt,
      new Response(
        JSON.stringify({
          message: `Set ${actions.join('+')} on ${normalizedRealmHref} for user "${user}"`,
        }),
        {
          headers: { 'content-type': SupportedMimeType.JSON },
        },
      ),
    );
  };
}
