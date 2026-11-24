import {
  param,
  type ChangedAutomation,
  type Expression,
  type Querier,
  type RealmIdentifier,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';
import {
  versionKeyOf,
  type AutomationVersion,
} from '@cardstack/runtime-common/automation-key-approval';

// Writing and ending automation approvals (`automation-key-approvals.ts`),
// kept apart so the bindings module, whose approving and key moves write and
// end them in their own transactions, needn't import the check, which reads
// bindings.

// Records `approver`'s approval of the automation, at `version`, to use each
// of `bindingIds`, in the approving confirmation's transaction. An approval
// already there for a binding moves to this version.
export async function writeAutomationKeyApprovalsIn(
  txQuery: Querier,
  {
    automationId,
    bindingIds,
    approver,
    version,
  }: {
    automationId: string;
    bindingIds: string[];
    approver: string;
    version: AutomationVersion;
  },
): Promise<void> {
  let key = await versionKeyOf(version);
  for (let bindingId of bindingIds) {
    await txQuery([
      'INSERT INTO automation_key_approvals (automation_id, binding_id, approved_by, version, version_key, call_api_calls) VALUES (',
      param(automationId),
      ',',
      param(bindingId),
      '::uuid,',
      param(approver),
      ',',
      param(JSON.stringify(version)),
      '::jsonb,',
      param(key.versionKey),
      ',',
      param(key.callApiCalls),
      ') ON CONFLICT (automation_id, binding_id) DO UPDATE SET approved_by = EXCLUDED.approved_by, version = EXCLUDED.version, version_key = EXCLUDED.version_key, call_api_calls = EXCLUDED.call_api_calls, updated_at = now()',
    ]);
  }
}

// Ends every automation approval of the bindings `bindingIds`: each binding
// came to send another share or key than the one its approvals were given
// for (`waitForKeyApprovalOfBindingsIn` moves their automations first).
// Returns the automations it moved to waiting for key approval.
export async function endAutomationKeyApprovalsIn(
  txQuery: Querier,
  bindingIds: string[],
): Promise<ChangedAutomation[]> {
  if (bindingIds.length === 0) {
    return [];
  }
  let selected = bindingIdList(bindingIds);
  let waiting = await waitForKeyApprovalOfBindingsIn(txQuery, selected);
  await txQuery([
    'DELETE FROM automation_key_approvals WHERE binding_id IN (',
    ...selected,
    ')',
  ]);
  return waiting;
}

// Moves each automation an approval of the bindings `bindings` selects
// (an expression yielding binding ids) serves to *waiting for key approval*,
// with no next run, when it is active, *done* or waiting for credits: the
// approval is about to end. Only an approval the automation can use counts,
// as `readApprovedVersions` reads them: a share's binding, or one its payer
// approved with their own key. An approval a former payer gave with their
// own key is kept but serves nothing, so ending it moves nothing. The
// bindings are read as they are before the change that ends the approval. Every such automation's row is locked first,
// whatever its state and in `automation_id` order, so a re-check of its
// approvals that holds the row commits before this reads it, and one that
// comes later reads the approval as gone. A pending run of a moved
// automation is refused at admission (`waiting-for-key-approval`).
//
// Returns the automations it moved, in `automation_id` order, for the caller
// to report to their realms' direct writers once its transaction commits.
export async function waitForKeyApprovalOfBindingsIn(
  txQuery: Querier,
  bindings: Expression,
): Promise<ChangedAutomation[]> {
  let served: Expression = [
    'SELECT a.automation_id FROM automation_key_approvals a JOIN key_bindings b ON b.id = a.binding_id JOIN automations au ON au.automation_id = a.automation_id WHERE a.binding_id IN (',
    ...bindings,
    ') AND (b.key_id IS NULL OR b.approved_by = au.payer)',
  ];
  await txQuery([
    'SELECT automation_id FROM automations WHERE automation_id IN (',
    ...served,
    ') ORDER BY automation_id FOR UPDATE',
  ]);
  let moved = await txQuery([
    "UPDATE automations SET state = 'waiting-for-key-approval', next_run = NULL, updated_at = now() WHERE state IN ('active', 'done', 'waiting-for-credits') AND automation_id IN (",
    ...served,
    ') RETURNING automation_id, realm',
  ]);
  return moved
    .map((row) => ({
      automationId: row.automation_id as RealmResourceIdentifier,
      realm: row.realm as RealmIdentifier,
    }))
    .sort((a, b) => a.automationId.localeCompare(b.automationId));
}

function bindingIdList(bindingIds: string[]): Expression {
  return bindingIds.flatMap((id, i) => [
    ...(i ? [','] : []),
    param(id),
    '::uuid',
  ]);
}
