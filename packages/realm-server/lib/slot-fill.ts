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
// good at `apiHosts` (`apiHostList`), can fill a slot in every one of
// `sends`. One choice of key fills a slot token in every operation that sends
// it, so the key must fit each of them: it is of a kind the slot takes there
// (`slotKeyKinds`), and its credential is good where that request sends
// (`apiHostsServe`). A key of a kind no slot takes fills nothing.
//
// This is the one rule for which keys fill a slot: the approval batch names
// the keys and shares it offers for each slot by it, and the key page lists
// the cards a key can be approved for by it.
export function keyFillsSlot(
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
