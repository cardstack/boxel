// An automation run's admission (ADR 026 §1.5): the checks the worker makes
// before a run costs anything. Every attempt is admitted again before it runs
// the script, since what admitted an earlier attempt can have changed.
//
// In order:
//
// 1. The automation's row. A run of one of the card's own triggers (cron,
//    one-time, webhook) or a batch's follow-up is refused when the
//    automation was removed (`not-switched-on`), and a trigger's run when it
//    is paused (`automation-paused`) or waiting for key approval
//    (`waiting-for-key-approval`), so a run enqueued before a pause, a
//    remove or the wait doesn't start. A batch's follow-up is held instead
//    while its automation is paused or waiting for key approval (ADR 030
//    §1.5): the refusal carries `hold`, and the attempt puts the run back to
//    pending rather than ending it (`holdAutomationFollowUpRun`), so it
//    starts again once the automation is resumed or active again. A
//    follow-up whose batch a resume gave another identity than its row's is
//    held too (`follow-up-identity-changed`): a job enqueued before the
//    pause took it before the resume reached it, and it starts again acting
//    as whoever resumed. A
//    trigger's run that no longer acts as the payer
//    (a resume made someone else the payer) is refused (`payer-changed`). A
//    run someone started by hand (Preview, Run now) needs no row. A
//    `waiting-for-credits` row is admitted here and left to the spending
//    check, and a `done` row is admitted, since the run of its last slot is
//    enqueued before it is done.
// 2. The run's identity: the person the run acts as (the payer, or whoever
//    clicked).
//    - They are still a direct writer of the realm (`not-a-direct-writer`).
//    - Their sessions weren't revoked since the run was given their
//      authority (`session-revoked`): since they switched the automation on
//      or last resumed it, for a run of its triggers; since the submitting
//      run started, for a batch's follow-up, or since the resume that made
//      them its identity, for one a pause held; or since they started the
//      run, for one started by hand.
//    - Their account can still sign in (`account-deactivated`): the Matrix
//      server, which alone knows, says it isn't deactivated or locked. A
//      worker that can't ask refuses the run (`account-unverifiable`).
//    When the run acts as the automation's payer, losing direct write, a
//    revocation and an account that can't sign in also pause the automation
//    with `payer-lost-access`, so its later slots don't each fail the same
//    way. A direct writer resumes it and becomes the payer.
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
//    attempt records the automation's version as it read the card and the
//    script (`recordAutomationRunVersion`) before it asks, and the realm holds
//    each slot to the run as the run's calls are held (ADR 039 §1.7): for any
//    run but a Preview or a Run now (as the run's row says), a binding needs
//    an automation approval matching that version, or the run is refused
//    `key-approval-ended`; a Preview or a Run now needs a key its identity
//    owns, an interactive binding, or such an approval with its identity as
//    payer. When a run that acts as the payer is
//    refused for a key approval (`KEY_APPROVAL_REFUSAL_REASONS`), the
//    automation moves to *waiting for key approval*: an approval it was
//    switched on with ended or stopped matching after switch-on.
// 5. The run's spending: `AutomationAdmissionChecks.admitSpending`, which
//    checks the automation's daily and monthly credit caps and its
//    identity's balance under their cost lock, and holds the most the run
//    can cost against that balance while it is in flight. A refusal is one
//    of `SPENDING_REFUSAL_REASONS`. When a run that acts as the automation's
//    payer is refused for its balance (`insufficient-credits`), the
//    automation moves to *waiting for credits*; the tick still enqueues its
//    due runs, and the first one whose balance passes (admitted, or refused
//    only for a credit cap) moves it back to active, so it continues at its
//    next due time once the balance recovers.
//
// A refused run finishes as an error whose `error_reason` is the refusal's
// code. An admitted run records `admitted_at`. Either way the run's log gets
// one `admission` line saying which.

import {
  RUN_ADMISSION_PATH,
  type RunAdmissionAnswer,
} from './automation-admission-route.ts';
import {
  runActsAsDirectWriter,
  type AutomationRun,
} from './automation-runs.ts';
import type { AutomationCaps } from './automation-declaration.ts';
import { KEY_APPROVAL_REFUSAL_REASONS } from './automation-key-approval.ts';
import {
  checkAutomationPayer,
  getAutomation,
  pauseForPayerLostAccess,
  setAutomationWaitingForCredits,
  waitForKeyApproval,
  SPENDING_REFUSAL_REASONS,
  type AutomationRow,
  type SpendingRefusalReason,
} from './automations.ts';
import type { ReportAutomationChange } from './automation-change-events.ts';
import type { ReportRunChange } from './automation-run-events.ts';
import type { DBAdapter } from './db.ts';
import { isSessionRevoked } from './db-queries/user-queries.ts';
import { param, query } from './expression.ts';
import { logger } from './log.ts';
import { MAX_AUTOMATION_SCRIPT_CHARS } from './automation-run-command.ts';
import { wrapRealmRunnerScript } from './realm-runner-script.ts';
import type { VirtualNetwork } from './virtual-network.ts';

const log = logger('automation-admission');

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
  // The automation's credit caps and the run's identity's balance (step 5).
  // An admitted run's cost ceiling is held against the balance, so the
  // check and the hold happen together under the identity's cost lock.
  // Undefined admits every run.
  admitSpending?(args: {
    run: AutomationRun;
    automation: AutomationRow | undefined;
    // The run's caps: the card's, held to the automation's caps snapshot.
    caps: AutomationCaps;
    kind: AdmittedRunKind;
  }): Promise<AdmissionRefusal | undefined>;
}

export interface AdmissionRefusal {
  reason: string;
  message: string;
}

// The codes the spending check refuses a run with, kept in `automations.ts`,
// whose failure streak leaves them out. None of them is the
// script's fault, and each clears without anyone changing the automation:
// the balance recovers, the day or month turns, or the worker gets its
// prices back.
//
// - `insufficient-credits`: the run's identity holds less than the run's
//   minimum balance, after what their other runs in flight and their
//   unsettled batches hold.
// - `daily-credit-cap-reached`, `monthly-credit-cap-reached`: what the
//   automation was charged this UTC day or month, plus what its other runs
//   in flight and its unsettled batches hold, has reached the cap.
// - `pricing-unavailable`: the worker's pricing check failed, so it admits
//   no run (ADR 029 §1.3).
export { SPENDING_REFUSAL_REASONS, type SpendingRefusalReason };

const CREDIT_CAP_REASONS: ReadonlySet<string> = new Set<SpendingRefusalReason>([
  'daily-credit-cap-reached',
  'monthly-credit-cap-reached',
]);

export interface AdmissionContext {
  dbAdapter: DBAdapter;
  virtualNetwork: VirtualNetwork;
  matrixServerName: string | undefined;
  checks: AutomationAdmissionChecks | undefined;
  // Told of each run a pause the admission makes cancels.
  reportRunChange?: ReportRunChange;
  // Told of the automation when the admission pauses it, or moves it into or
  // out of waiting for credits.
  reportAutomationChange?: ReportAutomationChange;
}

// How a run was started: by hand (Preview, Run now), by a batch's follow-up,
// or by one of the card's own triggers. The job says which: a run no trigger
// on the card names carries `triggerKind`; a run without one is a trigger's,
// whatever the card says now, so a trigger renamed or removed after its run
// was enqueued doesn't make that run a manual one.
export type AdmittedRunKind = 'manual' | 'batch' | 'trigger';

// The checks on the automation's row and the run's identity (steps 1 and 2),
// made before the run's token is minted.
export async function admitRunIdentity(
  ctx: AdmissionContext,
  run: AutomationRun,
  { kind }: { kind: AdmittedRunKind },
): Promise<
  | { ok: true; automation: AutomationRow | undefined }
  | ({
      ok: false;
      pause?: () => Promise<unknown>;
      // The run is a batch's follow-up its automation holds: the attempt
      // puts it back to pending rather than ending it.
      hold?: true;
    } & AdmissionRefusal)
> {
  let {
    dbAdapter,
    virtualNetwork,
    matrixServerName,
    reportRunChange,
    reportAutomationChange,
  } = ctx;
  let automation = await getAutomation(dbAdapter, run.automationId);
  let actsAs = run.actsAs;
  if (kind !== 'manual') {
    if (!automation) {
      return refuse(
        'not-switched-on',
        `The automation ${run.automationId} isn't switched on, so its scheduled run doesn't start`,
      );
    }
    if (automation.state === 'paused') {
      return kind === 'batch'
        ? {
            ...refuse(
              'automation-paused',
              `The automation is paused (${automation.pauseReason}), so its batch's follow-up is held until it is resumed`,
            ),
            hold: true,
          }
        : refuse(
            'automation-paused',
            `The automation is paused (${automation.pauseReason}), so its scheduled run doesn't start`,
          );
    }
    // A resume made someone else the follow-up's identity after this run row
    // was read for its job: it is held, and starts again acting as them.
    if (kind === 'batch') {
      let identity = await followUpIdentity(dbAdapter, run);
      if (identity.actsAs !== undefined && identity.actsAs !== actsAs) {
        return {
          ...refuse(
            'follow-up-identity-changed',
            `A resume made ${identity.actsAs} the identity of this batch's follow-up, so it starts again acting as them`,
          ),
          hold: true,
        };
      }
    }
    if (automation.state === 'waiting-for-key-approval') {
      return kind === 'batch'
        ? {
            ...refuse(
              'waiting-for-key-approval',
              "The automation is waiting for a key approval one of its operations needs, so its batch's follow-up is held until it is active again",
            ),
            hold: true,
          }
        : refuse(
            'waiting-for-key-approval',
            "The automation is waiting for a key approval one of its operations needs, so its scheduled run doesn't start",
          );
    }
    // A trigger's run acts as the payer (ADR 026 §1.1). One enqueued before
    // a resume made someone else the payer doesn't start as the old one; the
    // automation's next run acts as the new payer. A batch's follow-up acts
    // as whoever its submitting run acted as, or, once a resume came after
    // the batch was submitted, as whoever resumed.
    if (kind === 'trigger' && automation.payer !== actsAs) {
      return refuse(
        'payer-changed',
        `The run acts as ${actsAs}, but the automation's payer is now ${automation.payer}`,
      );
    }
  }
  // Whether a refusal of the identity is the payer losing access, which
  // pauses the automation too. The refusal carries the pause for the attempt
  // to make once the run has ended: a pause cancels the automation's
  // unfinished runs, and the refused run ends with its refusal's code, not
  // as canceled.
  let isPayer = kind !== 'manual' && automation?.payer === actsAs;
  let payerLostAccess = (refusal: { ok: false } & AdmissionRefusal) =>
    isPayer
      ? {
          ...refusal,
          pause: () =>
            pauseForPayerLostAccess(dbAdapter, run.automationId, actsAs, {
              reportRunChange,
              reportAutomationChange,
            }),
        }
      : refusal;

  if (!matrixServerName) {
    return refuse(
      'account-unverifiable',
      'This worker has no Matrix server name, so it cannot tell a direct writer from a bot account',
    );
  }
  if (
    !(await runActsAsDirectWriter(
      { dbAdapter, virtualNetwork, matrixServerName },
      { realm: run.realm, actsAs },
    ))
  ) {
    let refusal = refuse(
      'not-a-direct-writer',
      `${actsAs}, whom the run acts as, is no longer a direct writer of ${run.realm}`,
    );
    return isPayer
      ? {
          ...refusal,
          pause: () =>
            checkAutomationPayer(dbAdapter, run.automationId, {
              matrixServerName,
              virtualNetwork,
              reportRunChange,
              reportAutomationChange,
            }),
        }
      : refusal;
  }

  // The moment the run was given its identity's authority: the payer's
  // switch-on or last resume (when the payer was set), for a trigger's run;
  // for a batch's follow-up, the submitting run's start, or the resume that
  // made the run's identity the follow-up's (`followUpAuthorizedAt`); the
  // run's own start, for a run started by hand.
  let authorizedAt =
    kind === 'trigger' && automation
      ? automation.scheduledSince
      : kind === 'batch'
        ? await followUpAuthorizedAt(dbAdapter, run)
        : Math.floor(Date.parse(run.createdAt) / 1000);
  if (await isSessionRevoked(dbAdapter, actsAs, authorizedAt)) {
    return payerLostAccess(
      refuse(
        'session-revoked',
        `The sessions of ${actsAs}, whom the run acts as, were revoked after the run was given their authority`,
      ),
    );
  }

  if (!ctx.checks) {
    return refuse(
      'account-unverifiable',
      `This worker can't ask the Matrix server whether ${actsAs}'s account can still sign in`,
    );
  }
  let standing = await askAccountStanding(
    ctx.checks.accountStanding,
    actsAs,
    `run ${run.id}`,
  );
  if (standing === 'unverifiable') {
    return refuse(
      'account-unverifiable',
      `The Matrix server couldn't be asked whether ${actsAs}'s account can still sign in`,
    );
  }
  if (standing !== 'usable') {
    return payerLostAccess(
      refuse(
        'account-deactivated',
        standing === 'missing'
          ? `${actsAs}, whom the run acts as, has no account on the Matrix server`
          : `The account of ${actsAs}, whom the run acts as, is ${standing}`,
      ),
    );
  }
  return { ok: true, automation };
}

// Why the script at `scriptURL`, whose text is `code`, can't run (step 3):
// it is empty, longer than `MAX_AUTOMATION_SCRIPT_CHARS`, or doesn't parse.
// Undefined when it can.
export function scriptRefusal(
  code: string,
  scriptURL: string,
): AdmissionRefusal | undefined {
  if (!code.trim() || code.length > MAX_AUTOMATION_SCRIPT_CHARS) {
    return {
      reason: 'script-error',
      message: `The script ${scriptURL} must be between 1 and ${MAX_AUTOMATION_SCRIPT_CHARS} characters`,
    };
  }
  let parseError = scriptParseError(code);
  if (parseError) {
    return {
      reason: 'script-error',
      message: `The script ${scriptURL} doesn't parse: ${parseError}`,
    };
  }
  return undefined;
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
// 4 and 5), made with the run's token once the script has been read.
export async function admitRunOperations(
  ctx: AdmissionContext,
  run: AutomationRun,
  {
    automation,
    caps,
    kind,
    realmURL,
    token,
  }: {
    automation: AutomationRow | undefined;
    caps: AutomationCaps;
    kind: AdmittedRunKind;
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
    if (
      kind !== 'manual' &&
      automation?.payer === run.actsAs &&
      (KEY_APPROVAL_REFUSAL_REASONS as readonly string[]).includes(refusal.code)
    ) {
      await keyApprovalEnded(ctx, run);
    }
    return refuse(refusal.code, operationRefusalMessage(refusal));
  }
  let spending = await ctx.checks?.admitSpending?.({
    run,
    automation,
    caps,
    kind,
  });
  // Only a run that acts as the payer speaks for the automation's balance: a
  // Preview or a Run now is charged to whoever clicked.
  let payersRun =
    kind !== 'manual' &&
    automation !== undefined &&
    automation.payer === run.actsAs;
  if (payersRun) {
    // The spending check reads the balance before the caps, so a run it
    // admits, or refuses for a cap, had balance enough: the automation is no
    // longer waiting for credits.
    if (spending?.reason === 'insufficient-credits') {
      await waitingForCredits(ctx, run, true);
    } else if (
      automation!.state === 'waiting-for-credits' &&
      (!spending || CREDIT_CAP_REASONS.has(spending.reason))
    ) {
      await waitingForCredits(ctx, run, false);
    }
  }
  if (spending) {
    return { ok: false, ...spending };
  }
  return { ok: true, operations: asked.answer.operations ?? 0 };
}

// What a resume's admission asks, for the person who would become the
// automation's payer (see `admitPayer`).
export interface PayerAdmissionChecks {
  // Asks the Matrix server about the person's account, as
  // `AutomationAdmissionChecks.accountStanding` does. Undefined when it
  // can't be asked.
  accountStanding?(user: string): Promise<AccountStanding>;
  // The automation's realm checks the script and every declared operation
  // as the person, as it checks them for a run (`Realm.admitAutomationPayer`).
  admitInRealm(payer: string): Promise<AdmissionRefusal | undefined>;
  // The person's spending, as their first run's spending check would find
  // it: their balance against one run's minimum balance, and what the
  // automation was charged this UTC day and month against the caps they
  // would agree to. Undefined admits every payer.
  admitSpending?(payer: string): Promise<AdmissionRefusal | undefined>;
}

// Admits `payer`, who resuming the automation would make its payer, the way
// a run of its triggers is admitted, so the automation never goes active
// under a payer whose first run would be refused. The checks follow a run's
// order: the account can sign in (`account-deactivated`, or
// `account-unverifiable` when the Matrix server can't be asked), the script
// reads and parses and every declared operation passes as them (a
// `{{userKey}}` slot fills from their own key bindings), and their spending
// passes. Answers the first refusal, with the code a run would get, or
// undefined.
//
// Direct write is the resume's own check, made under its locks, and the
// person's sessions are checked when their request is accepted. Each run is
// still admitted on its own, since anything here can change after the
// resume.
export async function admitPayer(
  checks: PayerAdmissionChecks,
  payer: string,
): Promise<AdmissionRefusal | undefined> {
  if (!checks.accountStanding) {
    return {
      reason: 'account-unverifiable',
      message: `This server can't ask the Matrix server whether ${payer}'s account can still sign in`,
    };
  }
  let standing = await askAccountStanding(
    checks.accountStanding,
    payer,
    `resume as ${payer}`,
  );
  if (standing === 'unverifiable') {
    return {
      reason: 'account-unverifiable',
      message: `The Matrix server couldn't be asked whether ${payer}'s account can still sign in`,
    };
  }
  if (standing !== 'usable') {
    return {
      reason: 'account-deactivated',
      message:
        standing === 'missing'
          ? `${payer} has no account on the Matrix server`
          : `The account of ${payer} is ${standing}`,
    };
  }
  return (
    (await checks.admitInRealm(payer)) ?? (await checks.admitSpending?.(payer))
  );
}

// What a run, or a resume, is told of the realm's refusal of a declared
// operation.
export function operationRefusalMessage(
  refusal: NonNullable<RunAdmissionAnswer['refusal']>,
): string {
  return refusal.operation
    ? `The declared operation "${refusal.operation}"${refusal.targetType ? ` on ${refusal.targetType.name}` : ''} was refused: ${refusal.detail}`
    : refusal.detail;
}

// Moves the run's automation into or out of *waiting for credits*, telling
// `reportAutomationChange` when it moved. The run's own outcome doesn't depend
// on it, so a failure is logged and the next run's admission moves it.
async function waitingForCredits(
  ctx: AdmissionContext,
  run: AutomationRun,
  waiting: boolean,
): Promise<void> {
  try {
    let moved = await setAutomationWaitingForCredits(
      ctx.dbAdapter,
      run.automationId,
      { payer: run.actsAs, waiting },
      { reportAutomationChange: ctx.reportAutomationChange },
    );
    if (moved) {
      log.info(
        `run ${run.id}: automation ${run.automationId} is ${waiting ? 'waiting for credits' : 'active again'}`,
      );
    }
  } catch (e: any) {
    log.error(
      `run ${run.id}: couldn't move automation ${run.automationId} ${waiting ? 'to' : 'out of'} waiting for credits: ${e?.message ?? e}`,
    );
  }
}

// Moves the run's automation to *waiting for key approval*, telling
// `reportAutomationChange` when it moved. The run's own outcome doesn't
// depend on it, so a failure is logged and the next run's admission moves it.
async function keyApprovalEnded(
  ctx: AdmissionContext,
  run: AutomationRun,
): Promise<void> {
  try {
    let moved = await waitForKeyApproval(
      ctx.dbAdapter,
      run.automationId,
      { payer: run.actsAs },
      {
        reportRunChange: ctx.reportRunChange,
        reportAutomationChange: ctx.reportAutomationChange,
      },
    );
    if (moved) {
      log.info(
        `run ${run.id}: automation ${run.automationId} is waiting for key approval`,
      );
    }
  } catch (e: any) {
    log.error(
      `run ${run.id}: couldn't move automation ${run.automationId} to waiting for key approval: ${e?.message ?? e}`,
    );
  }
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

// What the Matrix server says of `user`'s account, or `unverifiable` when it
// can't be asked. The failure can name the platform's Matrix admin account,
// so it goes to the server's log, tagged `tag`, and never to a run or an
// answer, which the realm's writers read.
async function askAccountStanding(
  accountStanding: (user: string) => Promise<AccountStanding>,
  user: string,
  tag: string,
): Promise<AccountStanding | 'unverifiable'> {
  try {
    return await accountStanding(user);
  } catch (e: any) {
    log.warn(
      `${tag}: couldn't ask the Matrix server about ${user}'s account: ${e?.message ?? e}`,
    );
    return 'unverifiable';
  }
}

// Unix seconds: when a batch's follow-up was given its identity's
// authority. The follow-up's slot is the batch's id. One that acts as whoever
// resumed the automation after the batch was submitted dates from that
// resume (`follow_up_resumed_at`); any other dates from the start of the run
// that submitted the batch. A follow-up whose batch isn't found falls back
// to its own start.
async function followUpAuthorizedAt(
  dbAdapter: DBAdapter,
  run: AutomationRun,
): Promise<number> {
  let identity = await followUpIdentity(dbAdapter, run);
  let since =
    identity.resumedAt !== undefined && identity.actsAs === run.actsAs
      ? identity.resumedAt
      : (identity.submittedBy ?? run.createdAt);
  return Math.floor(new Date(since).getTime() / 1000);
}

// What the follow-up's batch (its slot) says of its identity: whom a resume
// made it act as and when (`follow_up_acts_as`, `follow_up_resumed_at`), and
// when the run that submitted the batch started. Each is undefined when the
// batch, or the value, isn't there.
async function followUpIdentity(
  dbAdapter: DBAdapter,
  run: AutomationRun,
): Promise<{ actsAs?: string; resumedAt?: string; submittedBy?: string }> {
  let [row] = await query(dbAdapter, [
    'SELECT b.follow_up_acts_as, b.follow_up_resumed_at, r.created_at FROM ai_batches b LEFT JOIN automation_runs r ON r.id = b.run_id WHERE b.batch_id =',
    param(run.slot),
    'AND b.automation_id =',
    param(run.automationId),
  ]);
  let iso = (value: unknown) =>
    value == null ? undefined : new Date(value as string).toISOString();
  return {
    actsAs:
      row?.follow_up_acts_as == null
        ? undefined
        : String(row.follow_up_acts_as),
    resumedAt: iso(row?.follow_up_resumed_at),
    submittedBy: iso(row?.created_at),
  };
}

function refuse(
  reason: string,
  message: string,
): { ok: false } & AdmissionRefusal {
  return { ok: false, reason, message };
}
