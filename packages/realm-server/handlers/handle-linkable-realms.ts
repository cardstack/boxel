import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  ensureTrailingSlash,
  fetchUserPermissions,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
  sendResponseForForbiddenRequest,
  setContextResponse,
} from '../middleware/index.ts';
import {
  getMultiRealmAuthorization,
  getSearchRequestPayload,
} from '../middleware/multi-realm-authorization.ts';
import { fetchLinkableRealms } from '../utils/realm-readability.ts';

export interface LinkableRealmsDocument {
  data: {
    type: 'linkable-realms';
    id: string;
    attributes: { realms: string[] };
  };
}

// Which of the caller's realms a card stored in `consumingRealm` can link to.
// A realm resolves its cards' links under its own owner's identity, so a link
// whose target sits in a realm that owner cannot read is unfetchable no matter
// who authored it — the card errors when the realm assembles it. Card pickers
// call this to scope their search to realms whose cards will still resolve
// once linked.
//
// `realms` carries the candidate list and is authorized against the caller by
// `multiRealmAuthorization`, so the answer is always a subset of what the
// caller can already read. Read alone is not enough to ask, though: the answer
// describes the consuming realm owner's access, which is a third party's when
// the caller is not that owner. Requiring write on `consumingRealm` keeps the
// question to realms the caller can actually author into — otherwise anyone
// could name a realm they merely read (a catalog realm, say) and probe its
// owner's membership in every private realm the caller can see.
// `consumingRealm` must be one of `realms`.
export default function handleLinkableRealms({
  dbAdapter,
}: {
  dbAdapter: DBAdapter;
}): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let { realmList, userId } = getMultiRealmAuthorization(ctxt);
    let payload = getSearchRequestPayload(ctxt) as
      | { consumingRealm?: unknown }
      | undefined;
    let rawConsumingRealm = payload?.consumingRealm;
    if (typeof rawConsumingRealm !== 'string' || !rawConsumingRealm.trim()) {
      await sendResponseForBadRequest(
        ctxt,
        'consumingRealm must be supplied in request body',
      );
      return;
    }
    let consumingRealm = ensureTrailingSlash(rawConsumingRealm.trim());
    if (!realmList.includes(consumingRealm)) {
      await sendResponseForBadRequest(
        ctxt,
        `consumingRealm ${consumingRealm} must be included in realms`,
      );
      return;
    }

    let callerPermissions = userId
      ? await fetchUserPermissions(dbAdapter, { userId, onlyOwnRealms: false })
      : {};
    let canWriteConsumingRealm = Object.entries(callerPermissions).some(
      ([realmURL, actions]) =>
        ensureTrailingSlash(realmURL) === consumingRealm &&
        actions.includes('write'),
    );
    if (!canWriteConsumingRealm) {
      await sendResponseForForbiddenRequest(
        ctxt,
        `Insufficient permissions to write realm: ${consumingRealm}`,
      );
      return;
    }

    let realms = await fetchLinkableRealms(
      dbAdapter,
      consumingRealm,
      realmList,
    );

    let doc: LinkableRealmsDocument = {
      data: {
        type: 'linkable-realms',
        id: consumingRealm,
        attributes: { realms },
      },
    };
    await setContextResponse(
      ctxt,
      new Response(JSON.stringify(doc, null, 2), {
        headers: { 'content-type': SupportedMimeType.JSONAPI },
      }),
    );
  };
}
