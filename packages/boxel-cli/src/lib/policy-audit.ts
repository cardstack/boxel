import {
  POLICY_AUDIT_CONFIRMATION_HEADER,
  policyShareAuditFromErrorBody,
  type PolicyShareAudit,
} from '@cardstack/runtime-common/policy-share-audit';
import { DIM, FG_YELLOW, RESET } from './colors.ts';
import { prompt } from './prompt.ts';

// A write the realm refuses because it saves a policy change that lets people
// who aren't signed in make calls with keys shared into a workspace. The
// refusal lists those shares; the write goes through once it is sent again
// with that list's confirmation. Which keys visitors would start using, and
// which would refuse them until their owners allow it, is shown first, and
// the keys' owners are told once it lands.

// Whether to send the write again with the confirmation of `audit`.
export type ConfirmPolicyAudit = (audit: PolicyShareAudit) => Promise<boolean>;

// Sends a write, and once more with the confirmation when the realm refuses it
// for want of one and `confirmAudit` agrees. Without `confirmAudit`, or when
// it declines, the refusal is the answer.
export async function sendConfirmingPolicyAudit(
  send: (headers: Record<string, string>) => Promise<Response>,
  confirmAudit: ConfirmPolicyAudit | undefined,
): Promise<Response> {
  let response = await send({});
  if (response.status !== 409 || !confirmAudit) {
    return response;
  }
  let audit = policyShareAuditFromErrorBody(
    await response
      .clone()
      .json()
      .catch(() => undefined),
  );
  if (!audit || !(await confirmAudit(audit))) {
    return response;
  }
  return await send({ [POLICY_AUDIT_CONFIRMATION_HEADER]: audit.confirmation });
}

// The list, as the terminal shows it before asking.
export function describePolicyAudit(audit: PolicyShareAudit): string[] {
  let lines = [
    `${FG_YELLOW}This change lets people who aren't signed in make calls that send a key shared into a workspace.${RESET}`,
  ];
  let starting = audit.entries.filter((entry) => entry.keyAllowsAnonymous);
  let refusing = audit.entries.filter((entry) => !entry.keyAllowsAnonymous);
  let entryLines = (entries: PolicyShareAudit['entries']) =>
    entries.flatMap((entry) => [
      entry.label === null
        ? `  A key shared into ${entry.realm} ${DIM}(only that workspace's writers can see which)${RESET}`
        : `  ${entry.label} ${DIM}(${entry.realm}, shared by ${entry.owner})${RESET}`,
      ...entry.operations.map((operation) => `    ${DIM}${operation}${RESET}`),
    ]);
  if (starting.length) {
    lines.push('They will start using:', ...entryLines(starting));
  }
  if (refusing.length) {
    lines.push(
      'These keys will refuse them until their owners allow it:',
      ...entryLines(refusing),
    );
  }
  lines.push("Each key's owner is told once the change is saved.");
  return lines;
}

// How a command confirms: `--confirm-shared-keys` agrees after showing the
// list; otherwise a terminal is asked, and anything else is refused with a
// pointer to the flag.
export function confirmPolicyAuditFor({
  confirmed,
  print = (line) => process.stderr.write(`${line}\n`),
  isTTY = Boolean(process.stdin.isTTY),
  ask = prompt,
}: {
  confirmed?: boolean;
  print?: (line: string) => void;
  isTTY?: boolean;
  ask?: (question: string) => Promise<string>;
}): ConfirmPolicyAudit {
  return async (audit) => {
    for (let line of describePolicyAudit(audit)) {
      print(line);
    }
    if (confirmed) {
      return true;
    }
    if (!isTTY) {
      print(
        'Not saved: stdin is not a TTY. Pass --confirm-shared-keys to save it.',
      );
      return false;
    }
    return /^y(es)?$/i.test((await ask('Save it? [y/N] ')).trim());
  };
}
