// An automation run's admission (ADR 026 §1.5): the checks the worker makes
// before a run costs anything. Every attempt is admitted again before it runs
// the script, since what admitted an earlier attempt can have changed.
//
// In order:
//
// 1. The automation's row. A run of one of the card's own triggers (cron,
//    one-time, webhook) is refused when the automation was removed
//    (`not-switched-on`) or is paused (`automation-paused`), so a run enqueued
//    before a pause or a remove doesn't start. A run someone started by hand
//    (Preview, Run now) needs no row. A `waiting-for-credits` row is
//    admitted here and left to the billing check, and a `done` row is
//    admitted, since the run of its last slot is enqueued before it is done.
// 2. The run's identity: the person the run acts as (the payer, or whoever
//    clicked).
//    - They are still a direct writer of the realm (`not-a-direct-writer`).
//      When they are the automation's payer, the automation is paused with
//      `payer-lost-access` too (`checkAutomationPayer`).
//    - Their sessions weren't revoked since the run was given their
//      authority (`session-revoked`): since they switched the automation on
//      or last resumed it, for a run of its triggers, or since they started
//      the run, for one started by hand.
//    - Their account can still sign in (`account-deactivated`): the Matrix
//      server, which alone knows, says it isn't deactivated or locked. A
//      worker that can't ask refuses the run (`account-unverifiable`).
// 3. The script parses (`script-error`). The card and the script file are
//    read before this, by the attempt.
// 4. Every operation the card declares passes `automationAdmission` as the
//    run's identity. The worker asks the automation's realm with the run's
//    token (`RUN_ADMISSION_PATH`), since only a realm can check an operation
//    the way its call would be checked: with its own operation core, which
//    resolves the declared type and reads its definition as the realm does.
//    A refusal ends the run with its code, such as `binding-not-approved`,
//    `share-suspended`, `binding-needs-reapproval` or `credential-rejected`;
//    a realm that can't be asked refuses it (`run-admission-failed`). The
//    refusals a person fixes in the secure window also leave that person a
//    notice (`automation-notices.ts`).
// 5. The run's spending: `AutomationAdmissionChecks.admitSpending`, which
//    checks the balance and the monthly cap where one is configured.
//
// A refused run finishes as an error whose `error_reason` is the refusal's
// code. An admitted run records `admitted_at`. Either way the run's log gets
// one `admission` line saying which.

import {
  RUN_ADMISSION_PATH,
  type RunAdmissionAnswer,
} from './automation-admission-route.ts';
import {
  recordAutomationNotice,
  isNoticedAdmissionRefusal,
} from './automation-notices.ts';
import type { AutomationRun } from './automation-runs.ts';
import {
  checkAutomationPayer,
  getAutomation,
  type AutomationRow,
} from './automations.ts';
import type { DBAdapter } from './db.ts';
import { isDirectWriter } from './db-queries/realm-permission-queries.ts';
import { isSessionRevoked } from './db-queries/user-queries.ts';
import { wrapRealmRunnerScript } from './realm-runner-script.ts';
import type { VirtualNetwork } from './virtual-network.ts';

// What the Matrix server says of an account: it can sign in, it was
// deactivated, it is locked, or there is no such account.
export type AccountStanding = 'usable' | 'deactivated' | 'locked' | 'missing';

// What admission asks of the realm server's side of the worker, which holds
// what this package can't: the Matrix server's admin API, and the run's
// spending.
export interface AutomationAdmissionChecks {
  // Asks the Matrix server about `user`'s account. Throws when it can't be
  // asked.
  accountStanding(user: string): Promise<AccountStanding>;
  // The run's balance and the automation's monthly cap. Undefined admits
  // every run.
  admitSpending?(args: {
    run: AutomationRun;
    automation: AutomationRow | undefined;
  }): Promise<AdmissionRefusal | undefined>;
}

export interface AdmissionRefusal {
  reason: string;
  message: string;
}

export interface AdmissionContext {
  dbAdapter: DBAdapter;
  virtualNetwork: VirtualNetwork;
  matrixServerName: string | undefined;
  checks: AutomationAdmissionChecks | undefined;
}

// The checks on the automation's row and the run's identity (steps 1 and 2),
// made before the run's token is minted. `manual` is whether someone started
// the run by hand rather than one of the card's triggers.
export async function admitRunIdentity(
  ctx: AdmissionContext,
  run: AutomationRun,
  { manual }: { manual: boolean },
): Promise<
  | { ok: true; automation: AutomationRow | undefined }
  | ({ ok: false } & AdmissionRefusal)
> {
  let { dbAdapter, virtualNetwork, matrixServerName } = ctx;
  let automation = await getAutomation(dbAdapter, run.automationId);
  if (!manual) {
    if (!automation) {
      return refuse(
        'not-switched-on',
        `The automation ${run.automationId} isn't switched on, so its scheduled run doesn't start`,
      );
    }
    if (automation.state === 'paused') {
      return refuse(
        'automation-paused',
        `The automation is paused (${automation.pauseReason}), so its scheduled run doesn't start`,
      );
    }
  }

  let actsAs = run.actsAs;
  if (!matrixServerName) {
    return refuse(
      'account-unverifiable',
      'This worker has no Matrix server name, so it cannot tell a direct writer from a bot account',
    );
  }
  let realmURL = virtualNetwork.toURL(run.realm);
  if (!(await isDirectWriter(dbAdapter, realmURL, actsAs, matrixServerName))) {
    if (!manual && automation?.payer === actsAs) {
      await checkAutomationPayer(dbAdapter, run.automationId, {
        matrixServerName,
        virtualNetwork,
      });
    }
    return refuse(
      'not-a-direct-writer',
      `${actsAs}, whom the run acts as, is no longer a direct writer of ${run.realm}`,
    );
  }

  // The moment the run was given its identity's authority: the click, for a
  // run started by hand; the switch-on or last resume (when the payer was
  // set), for a run of the card's triggers.
  let authorizedAt =
    manual || !automation
      ? Math.floor(Date.parse(run.createdAt) / 1000)
      : automation.scheduledSince;
  if (await isSessionRevoked(dbAdapter, actsAs, authorizedAt)) {
    return refuse(
      'session-revoked',
      `The sessions of ${actsAs}, whom the run acts as, were revoked after the run was given their authority`,
    );
  }

  if (!ctx.checks) {
    return refuse(
      'account-unverifiable',
      `This worker can't ask the Matrix server whether ${actsAs}'s account can still sign in`,
    );
  }
  let standing: AccountStanding;
  try {
    standing = await ctx.checks.accountStanding(actsAs);
  } catch (e: any) {
    return refuse(
      'account-unverifiable',
      `The Matrix server couldn't be asked whether ${actsAs}'s account can still sign in: ${e?.message ?? e}`,
    );
  }
  if (standing !== 'usable') {
    return refuse(
      'account-deactivated',
      standing === 'missing'
        ? `${actsAs}, whom the run acts as, has no account on the Matrix server`
        : `The account of ${actsAs}, whom the run acts as, is ${standing}`,
    );
  }
  return { ok: true, automation };
}

// Whether the script parses as the Realm Runner wraps it (step 3). It is
// compiled and never called, so none of it runs here.
export function scriptParseError(code: string): string | undefined {
  try {
    new Function(`return ${wrapRealmRunnerScript(code)}`);
    return undefined;
  } catch (e: any) {
    return e instanceof SyntaxError ? e.message : String(e?.message ?? e);
  }
}

// The checks on the card's declared operations and the run's spending (steps
// 4 and 5), made with the run's token once the script has been read. A
// refusal of an operation that a person fixes in the secure window records
// them a notice.
export async function admitRunOperations(
  ctx: AdmissionContext,
  run: AutomationRun,
  {
    automation,
    realmURL,
    token,
  }: {
    automation: AutomationRow | undefined;
    // The URL the automation's realm is served at.
    realmURL: string;
    token: string;
  },
): Promise<
  { ok: true; operations: number } | ({ ok: false } & AdmissionRefusal)
> {
  let asked = await askRealm(ctx, realmURL, token);
  if ('failure' in asked) {
    return refuse(
      'run-admission-failed',
      `The realm couldn't be asked about the automation's operations: ${asked.failure}`,
    );
  }
  let { refusal } = asked.answer;
  if (refusal) {
    if (isNoticedAdmissionRefusal(refusal.code)) {
      await recordAutomationNotice(ctx.dbAdapter, {
        recipient: run.actsAs,
        automationId: run.automationId,
        realm: run.realm,
        runId: run.id,
        reason: refusal.code,
        ...(refusal.operation && refusal.targetType
          ? {
              operation: {
                operation: refusal.operation,
                targetType: refusal.targetType,
              },
            }
          : {}),
        detail: refusal.detail,
      });
    }
    return refuse(
      refusal.code,
      refusal.operation
        ? `The declared operation "${refusal.operation}"${refusal.targetType ? ` on ${refusal.targetType.name}` : ''} was refused: ${refusal.detail}`
        : refusal.detail,
    );
  }
  let spending = await ctx.checks?.admitSpending?.({ run, automation });
  if (spending) {
    return { ok: false, ...spending };
  }
  return { ok: true, operations: asked.answer.operations ?? 0 };
}

async function askRealm(
  ctx: AdmissionContext,
  realmURL: string,
  token: string,
): Promise<{ answer: RunAdmissionAnswer } | { failure: string }> {
  let url = new URL(RUN_ADMISSION_PATH.replace(/^\//, ''), realmURL).href;
  let redact = (text: string) => text.split(token).join('[REDACTED]');
  try {
    let response = await ctx.virtualNetwork.fetch(url, {
      headers: {
        Accept: 'application/vnd.api+json',
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      return {
        failure: redact(
          `${response.status} ${(await response.text()).slice(0, 500)}`,
        ),
      };
    }
    let body = (await response.json()) as {
      data?: { attributes?: RunAdmissionAnswer };
    };
    let answer = body.data?.attributes;
    if (!answer || !('refusal' in answer)) {
      return { failure: 'the realm answered no admission' };
    }
    return { answer };
  } catch (e: any) {
    return { failure: redact(String(e?.message ?? e)) };
  }
}

function refuse(
  reason: string,
  message: string,
): { ok: false } & AdmissionRefusal {
  return { ok: false, reason, message };
}
