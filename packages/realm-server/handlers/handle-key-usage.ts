import type Koa from 'koa';
import type { CreateRoutesArgs } from '../routes.ts';
import { shareUsage, userKeyUsage, type KeyUsage } from '../lib/key-uses.ts';
import { keysHandler, ownerOf, sendJSON } from './handle-user-keys.ts';

// A share's or a personal key's usage: what it has spent against its budgets
// this UTC day and month, the last use and by whom, the top callers, refusals
// by code, the vendor's answers by status, the key's grants with which of them
// the vendor rejected, and whether the asker may change its limits. See
// `lib/key-uses.ts`.
//
// A share's usage is for the direct writers of its realm; a personal key's for
// its owner. Anyone else is answered 404, as for a share or key that doesn't
// exist. Reading it changes nothing, so the app's session may: only changing a
// limit takes a session signed in on the secure origin.

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

function serialize(id: string, usage: KeyUsage) {
  return { type: 'key-usage', id, attributes: usage };
}

export function handleKeyShareUsage({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    let shareId = ctxt.params.shareId;
    let usage = await shareUsage(dbAdapter, { user, shareId });
    await sendJSON(ctxt, 200, { data: serialize(shareId, usage) });
  });
}

export function handleUserKeyUsage({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let keyId = ctxt.params.keyId;
    let usage = await userKeyUsage(dbAdapter, { owner, keyId });
    await sendJSON(ctxt, 200, { data: serialize(keyId, usage) });
  });
}
