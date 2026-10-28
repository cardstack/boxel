import type Koa from 'koa';
import type { VirtualNetwork } from '@cardstack/runtime-common';
import { setContextResponse } from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import {
  listOwnShares,
  listRealmShareNotices,
  listRealmShares,
  resumeShare,
  shareKey,
  suspendShare,
  swapKeyIntoShare,
  unshareKey,
  type KeyShare,
  type KeyShareNotice,
} from '../lib/key-shares.ts';
import { UserKeyError } from '../lib/user-keys.ts';
import { secretsKeyring } from '../lib/secrets-at-rest/index.ts';
import { secureSessionClient } from '../lib/secure-session.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import {
  keysHandler,
  mayMintKeyWriteTicket,
  ownerOf,
  readJSON,
  sendJSON,
  ticketOf,
} from './handle-user-keys.ts';

// The shares API: sharing the signed-in user's keys into realms, and what a
// realm's direct writers do with its shares. Who may do what is set out in
// `lib/key-shares.ts`. Sharing, swapping and resuming each take a key write
// ticket in `meta`, so, as for the keys API, nothing here logs a body and the request
// log keeps only the method and path of these routes.

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

function serialize(share: KeyShare) {
  let { id, ...attributes } = share;
  return { type: 'key-share', id, attributes };
}

// A realm's listing names each binding's type and card in RRI form, as the
// bindings API does.
function serializeWithOperations(network: VirtualNetwork, share: KeyShare) {
  let serialized = serialize(share);
  if (!share.operations) {
    return serialized;
  }
  return {
    ...serialized,
    attributes: {
      ...serialized.attributes,
      operations: share.operations.map(({ type, instance, ...rest }) => ({
        ...rest,
        type: { ...type, module: network.unresolveURL(type.module) },
        instance: instance === null ? null : network.unresolveURL(instance),
      })),
    },
  };
}

function serializeNotice(notice: KeyShareNotice) {
  let { id, ...attributes } = notice;
  return { type: 'key-share-notice', id, attributes };
}

async function readShareBody(
  ctxt: Koa.Context,
  allowed: Set<string>,
): Promise<{ attributes: Record<string, unknown>; ticket: unknown }> {
  let body = await readJSON(ctxt);
  let data = body.data as
    | { type?: unknown; attributes?: Record<string, unknown> }
    | undefined;
  if (!data || typeof data !== 'object' || data.type !== 'key-share') {
    throw new UserKeyError(400, `the resource type is 'key-share'`);
  }
  let attributes = data.attributes ?? {};
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new UserKeyError(400, 'attributes must be an object');
  }
  for (let name of Object.keys(attributes)) {
    if (!allowed.has(name)) {
      throw new UserKeyError(400, `'${name}' can't be set here`);
    }
  }
  return { attributes, ticket: ticketOf(body) };
}

const SHARE_ATTRIBUTES = new Set(['realm', 'keyId', 'label']);
const SWAP_ATTRIBUTES = new Set(['keyId']);

// `GET /_key-shares` lists the user's own shares, in every realm; with
// `?key=<id>`, only those holding that key, which deleting it would suspend.
// `GET /_key-shares?realm=<url>` lists a realm's shares, for one of its
// direct writers.
export function handleListKeyShares({
  dbAdapter,
  virtualNetwork,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    let realm = ctxt.URL.searchParams.get('realm');
    let keyId = ctxt.URL.searchParams.get('key');
    if (realm !== null && keyId !== null) {
      throw new UserKeyError(400, 'list by realm or by key, not both');
    }
    let shares =
      realm !== null
        ? await listRealmShares(dbAdapter, user, realm)
        : await listOwnShares(dbAdapter, user, {
            keyId: keyId ?? undefined,
          });
    await sendJSON(ctxt, 200, {
      data: shares.map((share) =>
        serializeWithOperations(virtualNetwork, share),
      ),
    });
  });
}

export function handleListKeyShareNotices({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    let notices = await listRealmShareNotices(
      dbAdapter,
      user,
      ctxt.URL.searchParams.get('realm'),
    );
    await sendJSON(ctxt, 200, { data: notices.map(serializeNotice) });
  });
}

export function handleShareKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let owner = ownerOf(ctxt);
    let { attributes, ticket } = await readShareBody(ctxt, SHARE_ATTRIBUTES);
    let share = await shareKey(dbAdapter, {
      owner,
      realm: attributes.realm,
      keyId: attributes.keyId,
      label: attributes.label,
      ticket,
    });
    await sendJSON(ctxt, 201, { data: serialize(share) });
  });
}

export function handleUnshareKey({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    await unshareKey(dbAdapter, { user, shareId: ctxt.params.shareId });
    await setContextResponse(ctxt, new Response(null, { status: 204 }));
  });
}

export function handleSuspendKeyShare({
  dbAdapter,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    let share = await suspendShare(dbAdapter, {
      user,
      shareId: ctxt.params.shareId,
    });
    await sendJSON(ctxt, 200, { data: serialize(share) });
  });
}

export function handleResumeKeyShare({ dbAdapter }: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    let body = await readJSON(ctxt);
    let share = await resumeShare(dbAdapter, {
      user,
      shareId: ctxt.params.shareId,
      ticket: ticketOf(body),
    });
    await sendJSON(ctxt, 200, { data: serialize(share) });
  });
}

// A swap into a share with approved operations grants the new key their
// destinations, so it needs the session a grant does (see
// `handle-user-key-grants.ts`); one into a share with none takes the ticket
// alone. The answer lists the bindings it moved to the new key.
export function handleSwapKeyIntoShare({
  dbAdapter,
  secureOriginURL,
}: CreateRoutesArgs): Handler {
  return keysHandler(async (ctxt) => {
    let user = ownerOf(ctxt);
    let { attributes, ticket } = await readShareBody(ctxt, SWAP_ATTRIBUTES);
    let via = mayMintKeyWriteTicket(ctxt, secureOriginURL)
      ? await secureSessionClient(
          dbAdapter,
          ctxt.state.token as RealmServerTokenClaim | undefined,
        )
      : undefined;
    let { share, reapprovedBindings } = await swapKeyIntoShare(
      dbAdapter,
      secretsKeyring(),
      {
        user,
        shareId: ctxt.params.shareId,
        keyId: attributes.keyId,
        ticket,
        via,
      },
    );
    await sendJSON(ctxt, 200, {
      data: serialize(share),
      meta: { reapprovedBindings },
    });
  });
}
