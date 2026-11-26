import {
  param,
  query,
  reportAutomationChanges,
  rri,
  type ChangedAutomation,
  type DBAdapter,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import type { KeyApprovalFollow } from '@cardstack/runtime-common/automations';
import type { CreateRoutesArgs } from '../routes.ts';
import { findOrMountRealm } from './realm-routing.ts';
import { realmServerAutomationChangeReporter } from './run-change-reporter.ts';
import type { OperationCore } from '@cardstack/runtime-common/card-operations';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  approvalMatches,
  automationVersion,
  versionKeyOf,
  type AutomationKeyApprovals,
  type AutomationVersionKey,
  type KeyApprover,
  type MissingKeyApproval,
  type OperationKeyApproval,
  type SlotKeyApproval,
} from '@cardstack/runtime-common/automation-key-approval';
import {
  bindingType,
  checkSlots,
  slotToken,
  type SlotCheck,
} from './key-bindings.ts';
import { lookupGrantOperation } from './user-key-grants.ts';
import { DEFAULT_PROBE_INTERVAL_MS } from './key-grant-rejection.ts';
import { apiHostList, apiHostsOfKeySql, sendableKeySql } from './oauth.ts';
import { keyOfferedForSlot, type SlotSend } from './slot-fill.ts';

// Automation approvals (ADR 039 §1.2): a key owner's approval for one
// automation, named by its card, to use one of their bindings, as the
// automation was when they approved it (its version). One row per binding the
// automation uses, in `automation_key_approvals`, beside the bindings: it
// goes with its binding (revoking or removing the binding removes it, and a
// binding that comes to send another share or key ends it) and with its
// automation (removing the automation, or deleting its card, removes it).
//
// A run of the automation's triggers needs, for each credential slot of each
// operation it declares, the binding a call would fill the slot from, and an
// approval of that binding for this automation that matches its version.
// Switch-on, resume and an approval landing check that here; a run's
// admission checks it again in the realm.

type Core = Pick<
  OperationCore,
  'resolveCodeRef' | 'definitionLookup' | 'readsRealmOf'
>;

// Checks each operation `declaration` declares for the approvals a run of
// the automation's triggers needs, with `payer` as its payer and `script` as
// its script, and says, of each one missing, who can give it.
export async function checkAutomationKeyApprovals(
  dbAdapter: DBAdapter,
  {
    core,
    realmURL,
    automationId,
    declaration,
    payer,
    script,
    probeIntervalMs = DEFAULT_PROBE_INTERVAL_MS,
  }: {
    core: Core;
    realmURL: URL;
    automationId: string;
    declaration: AutomationDeclaration;
    payer: string;
    script: string;
    probeIntervalMs?: number;
  },
): Promise<AutomationKeyApprovals> {
  let version = await versionKeyOf(
    await automationVersion(declaration, { payer, script }),
  );
  let approvals = await approvalsOf(dbAdapter, automationId);
  let operations: OperationKeyApproval[] = [];
  for (let declared of declaration.operations) {
    let targetType = {
      module: String(declared.targetType.module),
      name: declared.targetType.name,
    };
    let unavailable = (code: string, detail: string): OperationKeyApproval => ({
      operation: declared.operation,
      targetType,
      state: 'unavailable',
      refusal: { code, detail },
    });
    let type = bindingType(core, declared.targetType, realmURL);
    let definition = type
      ? await lookupGrantOperation(
          core,
          realmURL,
          { module: rri(type.module), name: type.name },
          declared.operation,
          payer,
        )
      : undefined;
    if (!type || !definition?.callApi || definition.base !== 'callApi') {
      operations.push(
        unavailable(
          'target-not-found',
          `no callApi operation "${declared.operation}" on ${targetType.name} in realm ${realmURL.href}`,
        ),
      );
      continue;
    }
    if (definition.invalid) {
      operations.push(
        unavailable(
          'invalid-operation',
          `operation "${declared.operation}" is declared but could not be lowered to a runnable form`,
        ),
      );
      continue;
    }
    let request = definition.callApi;
    if (request.perInstance) {
      // An automation invokes its operations on their type, which an
      // operation approved per card never serves.
      operations.push(
        unavailable(
          'binding-not-approved',
          `operation "${declared.operation}" is approved per card, so an automation can't invoke it on its type`,
        ),
      );
      continue;
    }
    let missing: MissingKeyApproval[] = [];
    let slots: SlotKeyApproval[] = [];
    for (let check of await checkSlots(
      dbAdapter,
      {
        realmURL: realmURL.href,
        type,
        operation: declared.operation,
        instance: null,
        caller: payer,
        mode: 'automation',
        request,
      },
      { probeIntervalMs },
    )) {
      let slot = slotToken(check.slot);
      slots.push(
        await slotKeyApproval(dbAdapter, {
          check,
          send: { slot: check.slot, callApi: request },
          realmURL: realmURL.href,
          approvals,
          version,
          payer,
        }),
      );
      let { binding } = check;
      if (!binding) {
        if (check.slot.key === 'userKey') {
          missing.push({ slot, canApprove: 'payer' });
          continue;
        }
        let { canApprove, shares } = await shareApprover(
          dbAdapter,
          realmURL.href,
          payer,
          { slot: check.slot, callApi: request },
        );
        missing.push({
          slot,
          canApprove,
          ...(shares.length ? { shares } : {}),
        });
        continue;
      }
      let owner: KeyApprover =
        binding.approved_by === payer ? 'payer' : 'another-key-owner';
      let bound: MissingKeyApproval = {
        slot,
        canApprove: owner,
        ...(binding.share_id
          ? {
              shares: await shareNamed(dbAdapter, binding.share_id),
            }
          : {}),
      };
      if (
        check.refused === 'binding-not-approved' ||
        check.refused === 'binding-needs-reapproval' ||
        check.refused === 'share-suspended'
      ) {
        missing.push(bound);
        continue;
      }
      let approved = approvals.get(binding.id);
      if (!approved || !approvalMatches(approved, version)) {
        missing.push(bound);
      }
    }
    operations.push({
      operation: declared.operation,
      targetType,
      state: missing.length ? 'missing' : 'approved',
      ...(missing.length ? { missing } : {}),
      slots,
    });
  }
  return {
    approved: operations.every(({ state }) => state !== 'missing'),
    version,
    operations,
  };
}

// Brings each automation's state in step with its key approvals, checked in
// the realm served at `realmURL` (`Realm.followAutomationKeyApprovals`).
// Returns what each did, keyed by automation id.
export async function followAutomationKeyApprovals(
  args: CreateRoutesArgs,
  realmURL: URL,
  automationIds: RealmResourceIdentifier[],
): Promise<Map<string, KeyApprovalFollow>> {
  if (automationIds.length === 0) {
    return new Map();
  }
  let realm = await findOrMountRealm(realmURL, args);
  if (realm?.url !== realmURL.href) {
    return new Map();
  }
  return await realm.followAutomationKeyApprovals(automationIds);
}

// Every switched-on automation in the realm served at `realmURL` that is
// waiting for key approval, as an approval landing there re-checks them.
export async function automationsWaitingForKeyApproval(
  dbAdapter: DBAdapter,
  realmURL: URL,
  args: Pick<CreateRoutesArgs, 'virtualNetwork'>,
): Promise<RealmResourceIdentifier[]> {
  let rows = await query(dbAdapter, [
    'SELECT automation_id FROM automations WHERE realm =',
    param(args.virtualNetwork.unresolveURL(realmURL.href)),
    "AND state = 'waiting-for-key-approval' ORDER BY automation_id",
  ]);
  return rows.map((row) => row.automation_id as RealmResourceIdentifier);
}

// Once a change that ended key approvals has committed, tells the direct
// writers of each automation's realm that the approvals of the automations in
// `affected` (the ones the ended approvals served, as the change answers
// them) changed, then checks each again. The change moved each that was
// running to waiting for key approval; when the approval that ended was for
// an operation its card no longer declares, nothing is missing, and it runs
// again rather than waiting for an approval no one can give.
export async function followEndedKeyApprovals(
  args: CreateRoutesArgs,
  affected: readonly ChangedAutomation[],
): Promise<void> {
  await reportAutomationChanges(
    realmServerAutomationChangeReporter(args),
    affected,
  );
  let byRealm = new Map<string, RealmResourceIdentifier[]>();
  for (let { automationId, realm } of affected) {
    byRealm.set(realm, [...(byRealm.get(realm) ?? []), automationId]);
  }
  for (let [realm, automationIds] of byRealm) {
    await followAutomationKeyApprovals(
      args,
      args.virtualNetwork.toURL(realm),
      automationIds,
    );
  }
}

// The automation's approvals, by binding: the version each approved and
// when its key's owner approved that version.
type RecordedApproval = AutomationVersionKey & { approvedAt: string };

async function approvalsOf(
  dbAdapter: DBAdapter,
  automationId: string,
): Promise<Map<string, RecordedApproval>> {
  let rows = await query(dbAdapter, [
    'SELECT binding_id, version_key, call_api_calls, updated_at FROM automation_key_approvals WHERE automation_id =',
    param(automationId),
  ]);
  return new Map(
    rows.map((row) => [
      String(row.binding_id),
      {
        versionKey: String(row.version_key),
        callApiCalls: Number(row.call_api_calls),
        approvedAt: new Date(row.updated_at as string | Date).toISOString(),
      },
    ]),
  );
}

// Where one checked credential slot stands for the automation
// (`SlotKeyApproval`), with what its binding sends and who owns that key.
async function slotKeyApproval(
  dbAdapter: DBAdapter,
  {
    check,
    send,
    realmURL,
    approvals,
    version,
    payer,
  }: {
    check: SlotCheck;
    // The slot as the operation declares it, and where its request sends.
    send: SlotSend;
    realmURL: string;
    approvals: Map<string, RecordedApproval>;
    version: AutomationVersionKey;
    payer: string;
  },
): Promise<SlotKeyApproval> {
  let slot = slotToken(check.slot);
  let kind: SlotKeyApproval['kind'] =
    check.slot.key === 'userKey' ? 'userKey' : 'apiKey';
  let { binding } = check;
  if (!binding) {
    if (kind === 'userKey') {
      return { slot, kind, state: 'waiting', keyOwner: payer };
    }
    // The owner of a share's key approves the slot with that share, and
    // only a share the approve page offers for the slot counts
    // (`sharesFittingSlot`). When every such share holds one person's key,
    // that person is the one who acts.
    let owners = [
      ...new Set(
        (await sharesFittingSlot(dbAdapter, realmURL, send)).map(
          ({ owner }) => owner,
        ),
      ),
    ];
    if (owners.length === 0) {
      return { slot, kind, state: 'no-share', keyOwner: null };
    }
    return {
      slot,
      kind,
      state: 'waiting',
      keyOwner: owners.length === 1 ? owners[0] : null,
      shareOwners: owners,
    };
  }
  let keyOwner = binding.share_id
    ? (binding.share_owner ?? binding.approved_by)
    : binding.approved_by;
  let sent: Pick<SlotKeyApproval, 'share' | 'key'> = {};
  if (binding.share_id) {
    let [share] = await query(dbAdapter, [
      'SELECT id, label, state, suspension_reason, suspended_by FROM key_shares WHERE id = ',
      param(binding.share_id),
    ]);
    if (share) {
      sent.share = {
        id: String(share.id),
        label: String(share.label),
        state: String(share.state),
        ...(share.suspension_reason
          ? { suspensionReason: String(share.suspension_reason) }
          : {}),
        ...(share.suspended_by
          ? { suspendedBy: String(share.suspended_by) }
          : {}),
      };
    }
  } else if (binding.key_id) {
    let [key] = await query(dbAdapter, [
      'SELECT id, name FROM user_keys WHERE id = ',
      param(binding.key_id),
    ]);
    if (key) {
      sent.key = { id: String(key.id), name: String(key.name) };
    }
  }
  let approval = approvals.get(binding.id);
  let matches = approval !== undefined && approvalMatches(approval, version);
  let state: SlotKeyApproval['state'];
  switch (check.refused) {
    case 'share-suspended':
    case 'binding-needs-reapproval':
      state =
        check.refused === 'share-suspended'
          ? 'share-suspended'
          : 'needs-reapproval';
      break;
    case 'credential-rejected':
    case 'key-rejected':
      state = 'key-rejected';
      break;
    case 'binding-not-approved':
      state = 'waiting';
      break;
    default:
      state = matches ? 'approved' : 'waiting';
  }
  return {
    slot,
    kind,
    state,
    keyOwner,
    ...sent,
    ...(matches && (state === 'approved' || state === 'key-rejected')
      ? { approvedAt: approval!.approvedAt }
      : {}),
  };
}

// Who can approve an `{{apiKey}}` slot no share fills yet: the payer, when a
// share in the realm holds a key they own; the owner of another share's key;
// or nobody yet, when the realm has no share with a key.
async function shareApprover(
  dbAdapter: DBAdapter,
  realmURL: string,
  payer: string,
  send: SlotSend,
): Promise<{ canApprove: KeyApprover; shares: MissingShare[] }> {
  let rows = await sharesFittingSlot(dbAdapter, realmURL, send);
  let own = rows.filter((row) => row.owner === payer);
  if (own.length) {
    return { canApprove: 'payer', shares: own.map(shareOf) };
  }
  return rows.length
    ? { canApprove: 'another-key-owner', shares: rows.map(shareOf) }
    : { canApprove: 'nobody-yet', shares: [] };
}

type MissingShare = NonNullable<MissingKeyApproval['shares']>[number];

// The realm's shares the approval batch offers for one slot: active, holding
// a key a call can send (`sendableKeySql`; a share of a sign-in app is never
// one), whose key fits the slot where its request sends (`keyOfferedForSlot`:
// a kind the slot takes, good at the request's host). Ordered by label.
async function sharesFittingSlot(
  dbAdapter: DBAdapter,
  realmURL: string,
  send: SlotSend,
): Promise<ShareRow[]> {
  let rows = (await query(dbAdapter, [
    `SELECT s.id, s.label, s.owner, s.state, k.kind AS key_kind, ${apiHostsOfKeySql('s.key_id')} AS api_hosts FROM key_shares s JOIN user_keys k ON k.id = s.key_id WHERE s.realm_url = `,
    param(realmURL),
    ` AND s.state = 'active' AND ${sendableKeySql('s.key_id')} ORDER BY s.label, s.id`,
  ])) as unknown as (ShareRow & { key_kind: string; api_hosts: unknown })[];
  return rows
    .filter((row) =>
      keyOfferedForSlot(
        { kind: row.key_kind, apiHosts: apiHostList(row.api_hosts) },
        [send],
      ),
    )
    .map(({ id, label, owner, state }) => ({ id, label, owner, state }));
}

interface ShareRow {
  id: string;
  label: string;
  owner: string;
  state: string;
}

function shareOf(row: ShareRow): MissingShare {
  return {
    id: row.id,
    label: row.label,
    owner: row.owner,
    ...(row.state !== 'active' ? { suspended: true as const } : {}),
  };
}

// The share `id` names, as a missing approval names it.
async function shareNamed(
  dbAdapter: DBAdapter,
  id: string,
): Promise<MissingShare[]> {
  let rows = (await query(dbAdapter, [
    'SELECT id, label, owner, state FROM key_shares WHERE id = ',
    param(id),
  ])) as unknown as ShareRow[];
  return rows.map(shareOf);
}

// Tells the realm's direct writers that the key approvals of the automations
// in the realms at `realmURLs` may have changed although no automation's
// state moved: a share was added or suspended, a key was replaced or
// reconnected, or a binding was approved. The Automation card's key
// approvals section re-reads its status on the `automation` event, so the
// change shows without a reload. `except` names automations already
// reported for the same change.
export async function reportKeyApprovalChanges(
  args: Pick<CreateRoutesArgs, 'dbAdapter' | 'virtualNetwork'> &
    Parameters<typeof realmServerAutomationChangeReporter>[0],
  realmURLs: readonly string[],
  except: ReadonlySet<string> = new Set(),
): Promise<void> {
  let realms = [...new Set(realmURLs)].map((url) =>
    args.virtualNetwork.unresolveURL(url),
  );
  if (realms.length === 0) {
    return;
  }
  let rows = await query(args.dbAdapter, [
    'SELECT automation_id, realm FROM automations WHERE realm IN (',
    ...realms.flatMap((realm, i) => [...(i ? [','] : []), param(realm)]),
    ') ORDER BY automation_id',
  ]);
  await reportAutomationChanges(
    realmServerAutomationChangeReporter(args),
    rows
      .filter((row) => !except.has(String(row.automation_id)))
      .map((row) => ({
        automationId: row.automation_id as RealmResourceIdentifier,
        realm: row.realm as ChangedAutomation['realm'],
      })),
  );
}

// The realms whose bindings send the key `keyId`, directly or through a
// share that holds it.
export async function realmsBoundToKey(
  dbAdapter: DBAdapter,
  keyId: string,
): Promise<string[]> {
  let rows = await query(dbAdapter, [
    'SELECT DISTINCT b.realm_url FROM key_bindings b LEFT JOIN key_shares s ON s.id = b.share_id WHERE b.key_id = ',
    param(keyId),
    ' OR s.key_id = ',
    param(keyId),
  ]);
  return rows.map((row) => String(row.realm_url));
}

// The realm's shares the approval batch offers for one slot: active, holding
// a key a call can send (`sendableKeySql`; a share of a sign-in app is never
// one), whose key fits the slot where its request sends (`keyOfferedForSlot`:
// a kind the slot takes, good at the request's host). Ordered by label.
async function sharesFittingSlot(
  dbAdapter: DBAdapter,
  realmURL: string,
  send: SlotSend,
): Promise<ShareRow[]> {
  let rows = (await query(dbAdapter, [
    `SELECT s.id, s.label, s.owner, s.state, k.kind AS key_kind, ${apiHostsOfKeySql('s.key_id')} AS api_hosts FROM key_shares s JOIN user_keys k ON k.id = s.key_id WHERE s.realm_url = `,
    param(realmURL),
    ` AND s.state = 'active' AND ${sendableKeySql('s.key_id')} ORDER BY s.label, s.id`,
  ])) as unknown as (ShareRow & { key_kind: string; api_hosts: unknown })[];
  return rows
    .filter((row) =>
      keyOfferedForSlot(
        { kind: row.key_kind, apiHosts: apiHostList(row.api_hosts) },
        [send],
      ),
    )
    .map(({ id, label, owner, state }) => ({ id, label, owner, state }));
}
