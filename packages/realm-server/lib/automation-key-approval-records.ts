import { param, type Querier } from '@cardstack/runtime-common';
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
// for.
export async function endAutomationKeyApprovalsIn(
  txQuery: Querier,
  bindingIds: string[],
): Promise<void> {
  if (bindingIds.length === 0) {
    return;
  }
  await txQuery([
    'DELETE FROM automation_key_approvals WHERE binding_id IN (',
    ...bindingIds.flatMap((id, i) => [
      ...(i ? [','] : []),
      param(id),
      '::uuid',
    ]),
    ')',
  ]);
}
