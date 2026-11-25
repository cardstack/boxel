// An automation's key approvals (ADR 039): what a key's owner approved when
// they let one automation use one of their bindings, and how a later version
// of the automation is compared with it.
//
// An automation's *version* is what the key's owner can judge: who pays, the
// operations it declares, its script, its triggers (each one's label,
// timing, run count and webhook), its params, and its `callApiCalls` cap. An approval *matches* the
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
  // Each trigger's label, timing (`triggerTiming`), run count (null when
  // unbounded) and webhook (null for a scheduled trigger), sorted by label.
  // A changed count asks again, even a lower one: the count is part of what
  // the key's owner judged, unlike the cap, which only ever bounds a run.
  triggers: {
    label: string;
    timing: string;
    count: number | null;
    webhookPath: string | null;
  }[];
  params: Record<string, string>;
  callApiCalls: number;
}

// A version as an approval records it, and as one is compared with it:
// `versionKey` is the SHA-256 of everything but the cap.
export interface AutomationVersionKey {
  versionKey: string;
  callApiCalls: number;
}

// What a confirmation names as the version its approver was shown: the
// version and the cap together, so a confirmation is refused when either has
// changed since, and never records a cap its approver didn't see.
export function confirmationOf(version: AutomationVersionKey): string {
  return `${version.versionKey}.${version.callApiCalls}`;
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
  missing?: MissingKeyApproval[];
  refusal?: { code: string; detail: string };
}

// One credential slot an operation lacks an approval for, and who can give
// it. For an `{{apiKey}}` slot, `shares` names the realm's shares that can
// fill it: the one its binding sends, or, with no binding, each active share
// the approver named by `canApprove` owns. A share's `owner` is the Matrix id
// of the key's owner, whom a route shows only as ADR 011 lets its caller see
// them (null otherwise).
export interface MissingKeyApproval {
  slot: string;
  canApprove: KeyApprover;
  shares?: { id: string; label: string; owner: string | null }[];
}

// A person other than the payer whom an automation's missing approval waits
// on, for one operation: the key approval notice the realm server keeps for
// them (`automation_key_approval_notices`).
//
// - `approve`: the recipient's key serves the operation's slot, through a
//   share in the realm or a binding they approved, and their approval of the
//   automation is missing or no longer matches.
// - `share-a-key`: no share in the realm has a key for the operation's
//   `{{apiKey}}` slot, so the recipient, a direct writer of the realm, is
//   asked to share one.
export interface AwaitedKeyApproval {
  recipient: string;
  ask: 'approve' | 'share-a-key';
  operation: string;
  targetType: { module: string; name: string };
  // The origin and path the operation sends to.
  destination: string;
}

// An automation's approvals, checked against its version.
export interface AutomationKeyApprovals {
  // Every operation is `approved` or `unavailable`.
  approved: boolean;
  version: AutomationVersionKey;
  operations: OperationKeyApproval[];
  // Whom each missing approval waits on, besides the payer, for the key
  // approval notices. Kept on the realm server: a route that answers the
  // approvals leaves it out.
  awaiting?: AwaitedKeyApproval[];
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
        count:
          'count' in trigger && typeof trigger.count === 'number'
            ? trigger.count
            : null,
        webhookPath: trigger.kind === 'webhook' ? trigger.webhookPath : null,
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

// The versions recorded by the automation's approvals of the bindings its
// declaration could use now: a binding in the automation's realm for one of
// the operations it declares, either a share's or one of `payer`'s own keys.
// An approval of any other binding (one a former payer approved with their
// own key, or one for an operation the card no longer declares) serves none
// of its runs, so it says nothing about whether the automation is approved.
// `modules` are the declared operations' modules as bindings spell them: the
// served URL with no executable extension.
export async function readApprovedVersions(
  querier: Querier,
  {
    automationId,
    realmURL,
    payer,
    operations,
  }: {
    automationId: string;
    realmURL: string;
    payer: string;
    operations: { module: string; name: string; operation: string }[];
  },
): Promise<AutomationVersionKey[]> {
  if (operations.length === 0) {
    return [];
  }
  let rows = await querier([
    'SELECT a.version_key, a.call_api_calls FROM automation_key_approvals a JOIN key_bindings b ON b.id = a.binding_id WHERE a.automation_id =',
    param(automationId),
    'AND b.realm_url =',
    param(realmURL),
    'AND (b.key_id IS NULL OR b.approved_by =',
    param(payer),
    ') AND (',
    ...operations.flatMap(({ module, name, operation }, i) => [
      ...(i ? ['OR'] : []),
      '(b.definition_url =',
      param(module),
      'AND b.export_name =',
      param(name),
      'AND b.operation_name =',
      param(operation),
      ')',
    ]),
    ')',
  ]);
  return rows.map((row) => ({
    versionKey: String(row.version_key),
    callApiCalls: Number(row.call_api_calls),
  }));
}

// Whether every approval the automation's declaration could use
// (`readApprovedVersions`) still matches it, where `declaration` and `script`
// are its card and script as read now and `payer` its payer. False when one
// doesn't. Undefined when there is no such approval to compare, which says
// nothing about whether the automation needs one, or when the script can't be
// read, which a run's admission refuses on its own (`missing-script`).
// `readScript` is asked only when there is an approval.
export async function approvalsStillMatch(
  querier: Querier,
  {
    automationId,
    realmURL,
    declaration,
    payer,
    moduleOf,
    readScript,
  }: {
    automationId: string;
    realmURL: string;
    declaration: Pick<
      AutomationDeclaration,
      'operations' | 'triggers' | 'params' | 'caps'
    >;
    payer: string;
    // A declared operation's module as bindings spell it.
    moduleOf: (module: string) => string;
    readScript: () => Promise<string | undefined>;
  },
): Promise<boolean | undefined> {
  let approved = await readApprovedVersions(querier, {
    automationId,
    realmURL,
    payer,
    operations: declaration.operations.map(({ targetType, operation }) => ({
      module: moduleOf(String(targetType.module)),
      name: targetType.name,
      operation,
    })),
  });
  if (approved.length === 0) {
    return undefined;
  }
  let script = await readScript();
  if (script === undefined) {
    return undefined;
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
