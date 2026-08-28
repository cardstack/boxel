import type Koa from 'koa';
import type { DBAdapter } from '@cardstack/runtime-common';
import {
  ensureTrailingSlash,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  sendResponseForBadRequest,
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
// caller can already read: it never enumerates the owner's other realms.
// `consumingRealm` must be one of them.
export default function handleLinkableRealms({
  dbAdapter,
}: {
  dbAdapter: DBAdapter;
}): (ctxt: Koa.Context) => Promise<void> {
  return async function (ctxt: Koa.Context) {
    let { realmList } = getMultiRealmAuthorization(ctxt);
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
