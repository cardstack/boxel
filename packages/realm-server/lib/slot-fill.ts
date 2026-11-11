import { slotKindOfKey } from '@cardstack/runtime-common';
import {
  slotKeyKinds,
  type CallApiSlot,
  type OperationCallApi,
} from '@cardstack/runtime-common/card-operations';
import { apiHostsServe } from './oauth.ts';

// One operation's use of a credential slot: the slot as that operation
// declares it, and where its request sends.
export interface SlotSend {
  slot: CallApiSlot;
  callApi: Pick<OperationCallApi, 'destination'>;
}

// Whether a stored key of `kind` (a `user_keys.kind`), whose credential is
// good at `apiHosts` (`apiHostList`), is offered for a slot in every one of
// `sends`. One choice of key fills a slot token in every operation that sends
// it, so the key must fit each of them: it is of a kind the slot takes there
// (`slotKeyKinds`), and its credential is good where that request sends
// (`apiHostsServe`). A key of a kind no slot takes is never offered.
//
// This decides what is offered, not what may be approved: approving and
// sending hold a key only to the slot's declared kind (`keyFitsSlot`). The
// approval batch names the keys and shares it offers for each slot by it,
// the key page lists the cards a key can be approved for by it, and key
// readiness counts only a key it offers.
export function keyOfferedForSlot(
  key: { kind: string; apiHosts: string[] | null },
  sends: SlotSend[],
): boolean {
  let kind = slotKindOfKey(key.kind);
  return (
    kind !== undefined &&
    sends.every(
      ({ slot, callApi }) =>
        slotKeyKinds(slot, callApi).includes(kind) &&
        apiHostsServe(key.apiHosts, callApi.destination),
    )
  );
}
