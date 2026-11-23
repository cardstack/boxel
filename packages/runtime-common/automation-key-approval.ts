// An automation's key approvals (ADR 039): what a key's owner approved when
// they let one automation use one of their bindings, and how a later version
// of the automation is compared with it.
//
// An automation's *version* is what the key's owner can judge: who pays, the
// operations it declares, its script, its triggers (each one's label and
// timing), its params, and its `callApiCalls` cap. An approval *matches* the
// automation when every part but the cap is the same, and the cap is no
// higher than the approved one: a lower cap spends less, so it asks nothing
// again. A version that changes back to the approved one matches again.
//
// The records live beside the bindings, in `automation_key_approvals`, which
// the realm server writes and reads (`lib/automation-key-approvals.ts`). This
// module holds what both the realm server and the worker compute.

import { Sha256 } from '@aws-crypto/sha256-js';

import type {
  AutomationDeclaration,
  AutomationTriggerDeclaration,
} from './automation-declaration.ts';
import { param, type Querier } from './expression.ts';

export interface AutomationVersion {
  // The Matrix user id of the automation's payer, whom its runs act as.
  payer: string;
  // Each declared operation as `<module>#<name>/<operation>`, sorted.
  operations: string[];
  // The SHA-256 of the script file's content, in hex.
  scriptHash: string;
  // Each trigger's label and timing (`triggerTiming`), sorted by label.
  triggers: { label: string; timing: string }[];
  params: Record<string, string>;
  callApiCalls: number;
}

// A version as an approval records it, and as one is compared with it:
// `versionKey` is the SHA-256 of everything but the cap.
export interface AutomationVersionKey {
  versionKey: string;
  callApiCalls: number;
}

// Who can give an approval an automation is missing:
//
// - `payer`: the automation's payer, for a `{{userKey}}` slot (their own
//   key), or an `{{apiKey}}` slot filled from a share whose key they own.
// - `another-key-owner`: the owner of the key a share in the realm holds,
//   who is not the payer.
// - `nobody-yet`: an `{{apiKey}}` slot with no share in the realm. A direct
//   writer of the realm shares a key first.
export type KeyApprover = 'payer' | 'another-key-owner' | 'nobody-yet';

// One declared operation's approval state, as switch-on answers it:
//
// - `approved`: every credential slot it sends a key in has a binding and an
//   approval that matches the automation's version. An operation with no
//   credential slot is approved.
// - `missing`: at least one slot lacks either; `missing` names each one and
//   who can approve it.
// - `unavailable`: the operation can't be read in the realm (it isn't a
//   `callApi` operation there, or doesn't lower), so no key approval applies.
//   Its run's admission refuses it with `refusal.code`.
export interface OperationKeyApproval {
  operation: string;
  targetType: { module: string; name: string };
  state: 'approved' | 'missing' | 'unavailable';
  missing?: { slot: string; canApprove: KeyApprover }[];
  refusal?: { code: string; detail: string };
}

// An automation's approvals, checked against its version.
export interface AutomationKeyApprovals {
  // Every operation is `approved` or `unavailable`.
  approved: boolean;
  version: AutomationVersionKey;
  operations: OperationKeyApproval[];
}

// Checks an automation's approvals against its version: `declaration` and
// `script`, the card and script as read now, with `payer` as its payer.
export type CheckAutomationKeyApprovals = (args: {
  automationId: string;
  declaration: AutomationDeclaration;
  payer: string;
  script: string;
}) => Promise<AutomationKeyApprovals>;

// The refusal codes that mean a run of the automation's triggers lacks a key
// approval it needs: the automation is waiting for one, an approval it had
// ended or stopped matching, or a binding a slot needs is missing, changed or
// suspended. None is the script's fault, so none counts toward the failures
// that pause an automation; a run refused with one moves its automation to
// waiting for key approval instead.
export const KEY_APPROVAL_REFUSAL_REASONS = [
  'waiting-for-key-approval',
  'key-approval-ended',
  'binding-not-approved',
  'binding-needs-reapproval',
  'share-suspended',
] as const;

// The fields that decide when a trigger fires, as one string to compare:
// its kind, and its expression, time zone, `at` and `until`. `count` isn't
// timing; it is compared with the trigger's run count as it stands.
export function triggerTiming(trigger: AutomationTriggerDeclaration): string {
  switch (trigger.kind) {
    case 'cron':
      return JSON.stringify([
        'cron',
        trigger.expression,
        trigger.timeZone,
        trigger.until ?? null,
      ]);
    case 'once':
      return JSON.stringify(['once', trigger.at]);
    case 'webhook':
      return JSON.stringify(['webhook']);
  }
}

export function operationKeyOf(operation: {
  targetType: { module: string; name: string };
  operation: string;
}): string {
  return `${operation.targetType.module}#${operation.targetType.name}/${operation.operation}`;
}

export async function automationVersion(
  declaration: Pick<
    AutomationDeclaration,
    'operations' | 'triggers' | 'params' | 'caps'
  >,
  { payer, script }: { payer: string; script: string },
): Promise<AutomationVersion> {
  return {
    payer,
    operations: [...new Set(declaration.operations.map(operationKeyOf))].sort(),
    scriptHash: await sha256Hex(script),
    triggers: declaration.triggers
      .map((trigger) => ({
        label: trigger.label,
        timing: triggerTiming(trigger),
      }))
      .sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0)),
    params: Object.fromEntries(
      Object.entries(declaration.params).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      ),
    ),
    callApiCalls: declaration.caps.callApiCalls,
  };
}

export async function versionKeyOf(
  version: AutomationVersion,
): Promise<AutomationVersionKey> {
  let { callApiCalls, ...rest } = version;
  return {
    versionKey: await sha256Hex(
      JSON.stringify([
        rest.payer,
        rest.operations,
        rest.scriptHash,
        rest.triggers,
        rest.params,
      ]),
    ),
    callApiCalls,
  };
}

// Whether an approval of `approved` matches the automation at `current`.
export function approvalMatches(
  approved: AutomationVersionKey,
  current: AutomationVersionKey,
): boolean {
  return (
    approved.versionKey === current.versionKey &&
    current.callApiCalls <= approved.callApiCalls
  );
}

// The versions the automation's approvals record, one per binding it uses.
export async function readApprovedVersions(
  querier: Querier,
  automationId: string,
): Promise<AutomationVersionKey[]> {
  let rows = await querier([
    'SELECT version_key, call_api_calls FROM automation_key_approvals WHERE automation_id =',
    param(automationId),
  ]);
  return rows.map((row) => ({
    versionKey: String(row.version_key),
    callApiCalls: Number(row.call_api_calls),
  }));
}

// Whether every approval the automation has still matches it, where
// `declaration` and `script` are its card and script as read now and
// `payer` its payer. False when one doesn't; undefined when it has no
// approval to compare, which says nothing about whether it needs one.
// `readScript` is asked only when there is an approval, and its undefined
// (the script can't be read) matches no approval.
export async function approvalsStillMatch(
  querier: Querier,
  {
    automationId,
    declaration,
    payer,
    readScript,
  }: {
    automationId: string;
    declaration: Pick<
      AutomationDeclaration,
      'operations' | 'triggers' | 'params' | 'caps'
    >;
    payer: string;
    readScript: () => Promise<string | undefined>;
  },
): Promise<boolean | undefined> {
  let approved = await readApprovedVersions(querier, automationId);
  if (approved.length === 0) {
    return undefined;
  }
  let script = await readScript();
  if (script === undefined) {
    return false;
  }
  let current = await versionKeyOf(
    await automationVersion(declaration, { payer, script }),
  );
  return approved.every((version) => approvalMatches(version, current));
}

async function sha256Hex(text: string): Promise<string> {
  let hash = new Sha256();
  hash.update(new TextEncoder().encode(text));
  return Array.from(await hash.digest())
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
