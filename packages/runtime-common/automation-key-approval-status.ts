// An automation's key approvals as the `_automation-status` route shows them
// to one of the realm's direct writers: each declared operation, each
// credential slot it sends a key in, where that slot stands
// (`SlotKeyApprovalState`), and who acts to fix it.
//
// A slot the viewer can fix names the secure window page that fixes it
// (`fix`). A slot someone else must fix says who (`actor`): the key's owner,
// or a realm administrator. The key's owner is named by Matrix id only as
// ADR 011 lets the viewer see them: a share's owner when a permission row of
// the automation's realm names both of them, as the realm's key-share
// listings name a share's owner; a personal key's owner, who is the payer, as
// the route names the payer (`shownIdentity`). Every viewer of the route is a
// realm administrator, so a fix any realm administrator can make is always
// the viewer's.

import type {
  AutomationKeyApprovals,
  OperationKeyApproval,
  SlotKeyApproval,
  SlotKeyApprovalState,
} from './automation-key-approval.ts';
import { shownIdentity } from './automation-identities.ts';
import type { DBAdapter } from './db.ts';
import { param, query } from './expression.ts';

// The secure window page that fixes a slot:
//
// - `approve`: the key's owner approves the automation's use of the key.
// - `review-changes`: the key's owner reviews what changed in the
//   operation's request and approves it again.
// - `replace-key`: the key's owner replaces the key the service refused, or
//   signs in to the service again for a connection.
// - `swap-key`: a realm administrator puts one of their own keys into the
//   suspended share.
// - `share-key`: a realm administrator shares a key into the realm.
export type KeyApprovalFix =
  | 'approve'
  | 'review-changes'
  | 'replace-key'
  | 'swap-key'
  | 'share-key';

// Who fixes a slot the viewer can't: the owner of the key the slot sends
// (`key-owner`), or any realm administrator (`realm-administrator`).
export type KeyApprovalActor = 'key-owner' | 'realm-administrator';

export interface SlotKeyApprovalStatus {
  slot: string;
  kind: 'userKey' | 'apiKey';
  state: SlotKeyApprovalState;
  // The share the slot sends, by its label, which every realm administrator
  // sees.
  share?: { id: string; label: string };
  // The personal key the slot sends, by its name, shown only to the key's
  // owner.
  key?: { name: string };
  // Whether the viewer owns the key the slot sends.
  viewerIsKeyOwner: boolean;
  // The key owner's Matrix id, as ADR 011 lets the viewer see it; null when
  // the viewer may not see who owns the key, or no one person owns it.
  keyOwner: string | null;
  // ISO time the key's owner approved the automation's current version.
  approvedAt?: string;
  // The page that fixes the slot, when the viewer can fix it.
  fix?: KeyApprovalFix;
  // Who fixes the slot, when the viewer can't.
  actor?: KeyApprovalActor;
}

export interface OperationKeyApprovalStatus {
  operation: string;
  targetType: { module: string; name: string };
  state: OperationKeyApproval['state'];
  // Why a run can't invoke the operation at all, for an `unavailable` one.
  refusal?: { code: string; detail: string };
  slots: SlotKeyApprovalStatus[];
}

export interface AutomationKeyApprovalStatus {
  // Every operation is approved, or needs no key approval.
  approved: boolean;
  operations: OperationKeyApprovalStatus[];
}

// The automation's key approvals as `viewer`, a direct writer of the realm at
// `realmURL`, may see them.
export async function keyApprovalStatus(
  dbAdapter: DBAdapter,
  {
    viewer,
    realmURL,
    approvals,
  }: {
    viewer: string;
    realmURL: string;
    approvals: AutomationKeyApprovals;
  },
): Promise<AutomationKeyApprovalStatus> {
  let shown = new Map<string, Promise<string | null>>();
  let show = (person: string, { share }: { share: boolean }) => {
    let key = `${share}\n${person}`;
    let known = shown.get(key);
    if (!known) {
      known = share
        ? namedInRealm(dbAdapter, realmURL, viewer, person)
        : shownIdentity(dbAdapter, viewer, person);
      shown.set(key, known);
    }
    return known;
  };
  let viewerShares: Promise<boolean> | undefined;
  let viewerOwnsAShare = () =>
    (viewerShares ??= ownsAShare(dbAdapter, realmURL, viewer));
  let operations: OperationKeyApprovalStatus[] = [];
  for (let operation of approvals.operations) {
    let slots: SlotKeyApprovalStatus[] = [];
    for (let slot of operation.slots ?? []) {
      slots.push(await slotStatus(slot, { viewer, show, viewerOwnsAShare }));
    }
    operations.push({
      operation: operation.operation,
      targetType: operation.targetType,
      state: operation.state,
      ...(operation.refusal ? { refusal: operation.refusal } : {}),
      slots,
    });
  }
  return { approved: approvals.approved, operations };
}

async function slotStatus(
  slot: SlotKeyApproval,
  {
    viewer,
    show,
    viewerOwnsAShare,
  }: {
    viewer: string;
    show: (person: string, kind: { share: boolean }) => Promise<string | null>;
    viewerOwnsAShare: () => Promise<boolean>;
  },
): Promise<SlotKeyApprovalStatus> {
  let viewerIsKeyOwner = slot.keyOwner === viewer;
  let status: SlotKeyApprovalStatus = {
    slot: slot.slot,
    kind: slot.kind,
    state: slot.state,
    ...(slot.share
      ? { share: { id: slot.share.id, label: slot.share.label } }
      : {}),
    ...(slot.key && viewerIsKeyOwner ? { key: { name: slot.key.name } } : {}),
    viewerIsKeyOwner,
    keyOwner: slot.keyOwner
      ? await show(slot.keyOwner, { share: slot.kind === 'apiKey' })
      : null,
    ...(slot.approvedAt ? { approvedAt: slot.approvedAt } : {}),
  };
  let byKeyOwner = (fix: KeyApprovalFix): SlotKeyApprovalStatus =>
    viewerIsKeyOwner ? { ...status, fix } : { ...status, actor: 'key-owner' };
  switch (slot.state) {
    case 'approved':
      return status;
    case 'waiting':
      // An `{{apiKey}}` slot no share fills yet is approved with a share by
      // the owner of its key, so any viewer who owns a share in the realm
      // can approve it.
      if (slot.keyOwner === null) {
        return (await viewerOwnsAShare())
          ? { ...status, fix: 'approve' }
          : { ...status, actor: 'key-owner' };
      }
      return byKeyOwner('approve');
    case 'needs-reapproval':
      return byKeyOwner('review-changes');
    case 'key-rejected':
      return byKeyOwner('replace-key');
    case 'share-suspended':
      return { ...status, fix: 'swap-key' };
    case 'no-share':
      return { ...status, fix: 'share-key' };
  }
}

// `person` as `viewer` may see them in the realm at `realmURL`: the viewer
// themselves, or a person whom a permission row of the realm names beside a
// row naming the viewer (ADR 011 §1.1, §1.2).
async function namedInRealm(
  dbAdapter: DBAdapter,
  realmURL: string,
  viewer: string,
  person: string,
): Promise<string | null> {
  if (person === viewer) {
    return person;
  }
  let rows = await query(dbAdapter, [
    'SELECT DISTINCT username FROM realm_user_permissions WHERE realm_url =',
    param(realmURL),
    'AND username IN (',
    param(viewer),
    ',',
    param(person),
    ')',
  ]);
  return rows.length === 2 ? person : null;
}

async function ownsAShare(
  dbAdapter: DBAdapter,
  realmURL: string,
  viewer: string,
): Promise<boolean> {
  let rows = await query(dbAdapter, [
    'SELECT 1 FROM key_shares WHERE realm_url =',
    param(realmURL),
    'AND owner =',
    param(viewer),
    "AND state = 'active' AND key_id IS NOT NULL LIMIT 1",
  ]);
  return rows.length > 0;
}
