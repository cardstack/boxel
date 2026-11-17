// Which incoming webhooks an automation's webhook triggers may name.
//
// An incoming webhook (`incoming_webhooks`) belongs to the person who made
// it, not to a realm. A realm can use a webhook when the webhook's owner is a
// direct writer of the realm: a person whose own permission row grants write
// (`isDirectWriter`). Direct writers administer a realm and are who switch its
// automations on and pay for them, so a webhook any of them made is one of
// the realm's. A webhook made by anyone else is foreign to the realm, and a
// trigger naming it is refused, so an outsider who holds a webhook's signing
// secret can never start runs that a realm's payer pays for.
//
// Switch-on and resume check every webhook trigger with
// `unusableWebhookProblems` before they take the payer on. The automation
// card's editor lists the webhooks a realm can use through the realm's
// `_automation-webhooks` route (`answerAutomationWebhooks`), so a trigger is
// picked from that list rather than typed.

import type {
  AutomationDeclaration,
  AutomationProblem,
} from './automation-declaration.ts';
import type { DBAdapter } from './db.ts';
import {
  fetchDirectWriters,
  isDirectWriter,
  isDirectWriterLocked,
} from './db-queries/realm-permission-queries.ts';
import {
  addExplicitParens,
  param,
  query,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';

export const AUTOMATION_WEBHOOKS_PATH = '_automation-webhooks';
export const AUTOMATION_WEBHOOK_TYPE = 'automation-webhook';

// A code for a notice the switch-on routes attach while webhook deliveries
// start no automation runs: the receiver matches a delivery only against
// `webhook_commands`, so a webhook trigger never fires and is never spent.
export const WEBHOOK_TRIGGERS_START_NO_RUNS = 'webhook-triggers-start-no-runs';
export const WEBHOOK_TRIGGERS_START_NO_RUNS_MESSAGE =
  'Boxel starts no automation runs from webhook deliveries yet, so the webhook triggers on this automation never fire. A schedule or a one-time trigger still runs the automation.';

export interface AutomationNotice {
  code: typeof WEBHOOK_TRIGGERS_START_NO_RUNS;
  message: string;
}

// The notices switching the automation on carries, for a declaration with a
// webhook trigger.
export function switchOnNotices(
  declaration: Pick<AutomationDeclaration, 'triggers'>,
): AutomationNotice[] {
  return declaration.triggers.some((trigger) => trigger.kind === 'webhook')
    ? [
        {
          code: WEBHOOK_TRIGGERS_START_NO_RUNS,
          message: WEBHOOK_TRIGGERS_START_NO_RUNS_MESSAGE,
        },
      ]
    : [];
}

// The webhook paths a declaration's webhook triggers name, each once, in
// order. The caps snapshot keeps them, so a switched-on automation that comes
// to name another webhook pauses until its payer confirms.
export function declaredWebhookPaths(
  declaration: Pick<AutomationDeclaration, 'triggers'>,
): string[] {
  let paths = new Set<string>();
  for (let trigger of declaration.triggers) {
    if (trigger.kind === 'webhook') {
      paths.add(trigger.webhookPath);
    }
  }
  return [...paths].sort();
}

// A problem for each webhook trigger whose webhook the realm at `realmURL`
// (the served URL its permission rows are keyed by) can't use: no incoming
// webhook has the trigger's path, or the webhook's owner isn't a direct
// writer of the realm. Asked inside the caller's transaction, with each
// owner's permission row locked until it ends, so an owner who loses write
// meanwhile waits for the caller's change to commit and then counts.
export async function unusableWebhookProblems(
  txQuery: Querier,
  realmURL: URL,
  declaration: Pick<AutomationDeclaration, 'triggers'>,
  matrixServerName: string,
): Promise<AutomationProblem[]> {
  let problems: AutomationProblem[] = [];
  for (let [index, trigger] of declaration.triggers.entries()) {
    if (trigger.kind !== 'webhook') {
      continue;
    }
    let path = `triggers.${index}.webhookPath`;
    let [row] = (await txQuery([
      'SELECT username FROM incoming_webhooks WHERE webhook_path =',
      param(trigger.webhookPath),
    ])) as { username: string }[];
    if (!row) {
      problems.push({
        code: 'unknown-webhook',
        path,
        message: `Boxel has no incoming webhook at "${trigger.webhookPath}". Pick one of the workspace’s webhooks for the "${trigger.label}" trigger`,
      });
      continue;
    }
    if (
      !(await isDirectWriterLocked(
        txQuery,
        realmURL,
        row.username,
        matrixServerName,
      ))
    ) {
      problems.push({
        code: 'foreign-webhook',
        path,
        message: `The incoming webhook "${trigger.webhookPath}" belongs to someone the workspace doesn’t name as an editor. Pick one of the workspace’s webhooks for the "${trigger.label}" trigger`,
      });
    }
  }
  return problems;
}

export interface AutomationWebhook {
  webhookPath: string;
  // The Matrix id of the direct writer who made the webhook. The viewer is a
  // direct writer of the same realm, so the two share a realm grant and the
  // id may be shown (ADR 011 §1.2).
  owner: string;
  verificationType: string;
  createdAt: string;
}

export interface AutomationWebhooksDocument {
  data: {
    type: typeof AUTOMATION_WEBHOOK_TYPE;
    id: string;
    attributes: AutomationWebhook;
  }[];
}

export type AutomationWebhooksAnswer =
  | { status: 200; document: AutomationWebhooksDocument }
  | { status: 403; message: string };

// Answers `GET <realm>/_automation-webhooks` for `viewer`: every incoming
// webhook the realm can use, oldest first. Only a direct writer of the realm
// gets an answer, since only direct writers edit an automation card. A
// webhook's signing secret is never part of the answer; its path alone lets
// no one send a delivery that verifies.
export async function answerAutomationWebhooks({
  dbAdapter,
  realmURL,
  matrixServerName,
  viewer,
}: {
  dbAdapter: DBAdapter;
  realmURL: URL;
  matrixServerName: string;
  // The Matrix id the request was authenticated as, if any.
  viewer: string | undefined;
}): Promise<AutomationWebhooksAnswer> {
  if (
    !viewer ||
    !(await isDirectWriter(dbAdapter, realmURL, viewer, matrixServerName))
  ) {
    return {
      status: 403,
      message: `only a direct writer of ${realmURL.href} can list the incoming webhooks its automations may use`,
    };
  }
  let writers = await fetchDirectWriters(dbAdapter, realmURL, matrixServerName);
  let rows = writers.length
    ? ((await query(dbAdapter, [
        'SELECT webhook_path, username, verification_type, created_at FROM incoming_webhooks WHERE username IN',
        ...addExplicitParens(
          separatedByCommas(writers.map((writer) => [param(writer)])),
        ),
        'ORDER BY created_at, webhook_path',
      ] as Expression)) as {
        webhook_path: string;
        username: string;
        verification_type: string;
        created_at: string | Date;
      }[])
    : [];
  return {
    status: 200,
    document: {
      data: rows.map((row) => ({
        type: AUTOMATION_WEBHOOK_TYPE,
        id: row.webhook_path,
        attributes: {
          webhookPath: row.webhook_path,
          owner: row.username,
          verificationType: row.verification_type,
          createdAt: new Date(row.created_at).toISOString(),
        },
      })),
    },
  };
}
