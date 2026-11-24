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
  type OperationKeyApproval,
} from '@cardstack/runtime-common/automation-key-approval';
import { bindingType, checkSlots, slotToken } from './key-bindings.ts';
import { lookupGrantOperation } from './user-key-grants.ts';
import { DEFAULT_PROBE_INTERVAL_MS } from './key-grant-rejection.ts';

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
    let missing: NonNullable<OperationKeyApproval['missing']> = [];
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
      let { binding } = check;
      if (!binding) {
        missing.push({
          slot,
          canApprove:
            check.slot.key === 'userKey'
              ? 'payer'
              : await shareApprover(dbAdapter, realmURL.href, payer),
        });
        continue;
      }
      let owner: KeyApprover =
        binding.approved_by === payer ? 'payer' : 'another-key-owner';
      if (
        check.refused === 'binding-not-approved' ||
        check.refused === 'binding-needs-reapproval' ||
        check.refused === 'share-suspended'
      ) {
        missing.push({ slot, canApprove: owner });
        continue;
      }
      let approved = approvals.get(binding.id);
      if (!approved || !approvalMatches(approved, version)) {
        missing.push({ slot, canApprove: owner });
      }
    }
    operations.push({
      operation: declared.operation,
      targetType,
      state: missing.length ? 'missing' : 'approved',
      ...(missing.length ? { missing } : {}),
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
// writers of each automation's realm that the automations in `waiting` moved
// to waiting for key approval (the change answers which it moved), then
// checks each again: when the approval that ended was for an operation its
// card no longer declares, nothing is missing, and it runs again rather than
// waiting for an approval no one can give.
export async function followEndedKeyApprovals(
  args: CreateRoutesArgs,
  waiting: readonly ChangedAutomation[],
): Promise<void> {
  await reportAutomationChanges(
    realmServerAutomationChangeReporter(args),
    waiting,
  );
  let byRealm = new Map<string, RealmResourceIdentifier[]>();
  for (let { automationId, realm } of waiting) {
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

async function approvalsOf(
  dbAdapter: DBAdapter,
  automationId: string,
): Promise<Map<string, AutomationVersionKey>> {
  let rows = await query(dbAdapter, [
    'SELECT binding_id, version_key, call_api_calls FROM automation_key_approvals WHERE automation_id =',
    param(automationId),
  ]);
  return new Map(
    rows.map((row) => [
      String(row.binding_id),
      {
        versionKey: String(row.version_key),
        callApiCalls: Number(row.call_api_calls),
      },
    ]),
  );
}

// Who can approve an `{{apiKey}}` slot no share fills yet: the payer, when a
// share in the realm holds a key they own; the owner of another share's key;
// or nobody yet, when the realm has no share with a key.
async function shareApprover(
  dbAdapter: DBAdapter,
  realmURL: string,
  payer: string,
): Promise<KeyApprover> {
  let rows = await query(dbAdapter, [
    'SELECT owner FROM key_shares WHERE realm_url = ',
    param(realmURL),
    " AND state = 'active' AND key_id IS NOT NULL",
  ]);
  if (rows.some((row) => row.owner === payer)) {
    return 'payer';
  }
  return rows.length ? 'another-key-owner' : 'nobody-yet';
}
