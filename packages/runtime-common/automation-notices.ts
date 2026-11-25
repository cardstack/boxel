// Automation notices: what tells a realm's direct writers that an automation
// stopped doing its job, and what fixes it. A notice is read from the facts the
// automation's row and runs already record, never stored, so it stands once
// per problem however many runs the problem refuses, and it ends the moment its
// problem is fixed: the row leaves the state that raised it, or a later run of
// the automation's own gets past it.
//
// Each automation has at most one notice. The first of these that applies is
// the notice:
//
// 1. The row is paused for a reason a person has to act on (`repeated-failures`,
//    `payer-lost-access`, `caps-raised`, `batched-ai-enabled`,
//    `webhook-changed`, `webhook-owner-lost-access`, `invalid-declaration`). A
//    pause a direct writer asked for, or the realm's archiving, raises none:
//    the person who did it already knows.
// 2. The row waits for key approval. When the automation's latest run of its
//    own was refused at admission for a key approval (`binding-not-approved`,
//    `binding-needs-reapproval`, `share-suspended`, `key-approval-ended`), the
//    notice carries that code and the operation refused, so it can link to the
//    secure window's approve or review-changes page for that operation.
//    Otherwise the automation waits from its switch-on, or from an edit to its
//    script, triggers, params or operations.
// 3. The row waits for credits.
// 4. The automation's latest run of its own ended on a rejected credential and
//    the credential is still broken (`CredentialNotices`, which asks the key,
//    its OAuth client and the share as they are now).
//
// A notice is for some of the realm's direct writers, never anyone else (ADR
// 011): the payer for most, the realm's other direct writers when the payer
// lost access (someone else must resume the automation and become the payer),
// every direct writer for a webhook whose owner lost access and for a broken
// share, and the OAuth client's owner for a broken client, when that owner
// writes the realm directly. `forViewer` says whether the viewer is one of
// them; the console and the badges count only those.

import {
  readAutomationFailures,
  type AutomationPauseReason,
  type AutomationRow,
} from './automations.ts';
import {
  getAutomationRun,
  CREDENTIAL_REJECTED_REASON,
  type AutomationRun,
} from './automation-runs.ts';
import type { DBAdapter } from './db.ts';
import {
  addExplicitParens,
  dbAdapterQuerier,
  param,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';
import type { RealmResourceIdentifier } from './realm-identifiers.ts';

// The key approval refusals a notice names, with the operation refused. A
// run refused `waiting-for-key-approval` was only enqueued before the wait
// began, so it says nothing the wait doesn't.
export const KEY_APPROVAL_NOTICE_REASONS = [
  'binding-not-approved',
  'binding-needs-reapproval',
  'share-suspended',
  'key-approval-ended',
] as const;

// The pauses a person has to act on.
export const NOTICE_PAUSE_REASONS = [
  'repeated-failures',
  'payer-lost-access',
  'caps-raised',
  'batched-ai-enabled',
  'webhook-changed',
  'webhook-owner-lost-access',
  'invalid-declaration',
] as const satisfies readonly AutomationPauseReason[];

export type AutomationNoticeReason =
  | (typeof NOTICE_PAUSE_REASONS)[number]
  | 'waiting-for-key-approval'
  | (typeof KEY_APPROVAL_NOTICE_REASONS)[number]
  | 'waiting-for-credits'
  | typeof CREDENTIAL_REJECTED_REASON;

// Who a notice is for, among the realm's direct writers.
export type AutomationNoticeAudience =
  | 'payer'
  | 'other-direct-writers'
  | 'direct-writers'
  | 'client-owner';

// What fixes a credential a run ended on, as the realm server reads the key,
// its OAuth client and the share now:
//
// - `reconnect`: the vendor no longer accepts the payer's OAuth connection.
//   The payer signs in again from the secure window (`#reconnect=<keyId>`).
// - `connect-again`: the client the payer's connection signed in through was
//   deleted, so the payer connects through a client that exists.
// - `fix-client`: the OAuth client the credential mints through is broken,
//   and its owner replaces the client's secret.
// - `fix-share`: the realm's share is broken, and a direct writer resumes it
//   or swaps a working key into it.
export type AutomationCredentialFix =
  | { kind: 'reconnect'; keyId: string }
  | { kind: 'connect-again'; keyId: string }
  | { kind: 'fix-client'; clientKeyId: string }
  | { kind: 'fix-share'; shareId: string };

// Who is told about a run that ended on a refused credential, and what each
// fixes. A notice stands only while what it reports does: an empty list means
// someone has fixed the credential.
export type AutomationCredentialNotice = AutomationCredentialFix & {
  recipients: string[];
};

// Reads the credential notices of a run that ended `credential-rejected`. Only
// a realm server can: the key, its client and its share are server-only rows.
export type CredentialNotices = (
  run: AutomationRun,
) => Promise<AutomationCredentialNotice[]>;

// The operation a run's admission refused, and the card type it is declared
// on, as the run's `admission` log line records them.
export interface AutomationNoticeOperation {
  name: string;
  module: string;
  typeName: string;
}

// The run a notice is about: the run refused or failed.
export interface AutomationNoticeRun {
  runId: string;
  // The run's error code and detail.
  reason: string | null;
  message: string | null;
  finishedAt: string | null;
}

export interface AutomationNotice {
  reason: AutomationNoticeReason;
  audience: AutomationNoticeAudience;
  // Whether the viewer is someone the notice is for.
  forViewer: boolean;
  run: AutomationNoticeRun | null;
  operation: AutomationNoticeOperation | null;
  // What fixes the credential the automation's latest run ended on, when it
  // ended on one that is still broken. A notice for a repeated-failures pause
  // carries it too when the runs fail on the credential.
  credential: AutomationCredentialFix | null;
}

// The notice for each automation in `rows` that has one, as `viewer`, a direct
// writer of the automations' realm, reads it. `credentialNotices` is left out
// where no realm server answers (a published realm), and then a rejected
// credential raises no notice of its own.
export async function automationNotices(
  dbAdapter: DBAdapter,
  rows: AutomationRow[],
  {
    viewer,
    credentialNotices,
  }: { viewer: string; credentialNotices?: CredentialNotices },
): Promise<Map<RealmResourceIdentifier, AutomationNotice>> {
  let notices = new Map<RealmResourceIdentifier, AutomationNotice>();
  if (rows.length === 0) {
    return notices;
  }
  let querier = dbAdapterQuerier(dbAdapter);
  let latest = await readLatestOwnRuns(
    querier,
    rows.map((row) => row.automationId),
  );
  for (let row of rows) {
    let notice = await noticeFor(dbAdapter, querier, row, latest, {
      viewer,
      credentialNotices,
    });
    if (notice) {
      notices.set(row.automationId, notice);
    }
  }
  return notices;
}

async function noticeFor(
  dbAdapter: DBAdapter,
  querier: Querier,
  row: AutomationRow,
  latest: Map<string, LatestRun>,
  {
    viewer,
    credentialNotices,
  }: { viewer: string; credentialNotices?: CredentialNotices },
): Promise<AutomationNotice | undefined> {
  let last = latest.get(row.automationId);
  let credential = async () =>
    last?.reason === CREDENTIAL_REJECTED_REASON && credentialNotices
      ? await credentialNoticeOf(dbAdapter, last.runId, credentialNotices)
      : undefined;
  let forPayer = viewer === row.payer;
  if (row.state === 'paused') {
    let reason = row.pauseReason;
    if (!reason || !isNoticePause(reason)) {
      return undefined;
    }
    switch (reason) {
      case 'repeated-failures': {
        let { last: failure } = await readAutomationFailures(
          querier,
          row.automationId,
        );
        let fix =
          failure?.runId === last?.runId ? await credential() : undefined;
        return {
          reason,
          audience: 'payer',
          forViewer: forPayer,
          run: failure
            ? {
                runId: failure.runId,
                reason: failure.reason,
                message: failure.message,
                finishedAt: failure.finishedAt,
              }
            : null,
          operation: null,
          credential: fix?.fix ?? null,
        };
      }
      case 'payer-lost-access':
        return paused(reason, 'other-direct-writers', !forPayer);
      case 'webhook-owner-lost-access':
        return paused(reason, 'direct-writers', true);
      default:
        return paused(reason, 'payer', forPayer);
    }
  }
  if (row.state === 'waiting-for-key-approval') {
    let refused =
      last && isKeyApprovalNoticeReason(last.reason) ? last : undefined;
    let reason: AutomationNoticeReason = refused
      ? (refused.reason as AutomationNoticeReason)
      : 'waiting-for-key-approval';
    // A suspended share is the realm's to fix, so every direct writer hears.
    let audience: AutomationNoticeAudience =
      reason === 'share-suspended' ? 'direct-writers' : 'payer';
    return {
      reason,
      audience,
      forViewer: audience === 'direct-writers' || forPayer,
      run: refused ? runOf(refused) : null,
      operation: refused?.operation ?? null,
      credential: null,
    };
  }
  if (row.state === 'waiting-for-credits') {
    return {
      reason: 'waiting-for-credits',
      audience: 'payer',
      forViewer: forPayer,
      run: last?.reason === 'insufficient-credits' ? runOf(last) : null,
      operation: null,
      credential: null,
    };
  }
  let rejected = await credential();
  if (!rejected || !last) {
    return undefined;
  }
  return {
    reason: CREDENTIAL_REJECTED_REASON,
    audience: rejected.audience,
    forViewer: rejected.recipients.includes(viewer),
    run: runOf(last),
    operation: last.operation,
    credential: rejected.fix,
  };
}

function paused(
  reason: AutomationNoticeReason,
  audience: AutomationNoticeAudience,
  forViewer: boolean,
): AutomationNotice {
  return {
    reason,
    audience,
    forViewer,
    run: null,
    operation: null,
    credential: null,
  };
}

function isNoticePause(
  reason: AutomationPauseReason,
): reason is (typeof NOTICE_PAUSE_REASONS)[number] {
  return (NOTICE_PAUSE_REASONS as readonly string[]).includes(reason);
}

function isKeyApprovalNoticeReason(reason: string | null): boolean {
  return (
    reason !== null &&
    (KEY_APPROVAL_NOTICE_REASONS as readonly string[]).includes(reason)
  );
}

function runOf(run: LatestRun): AutomationNoticeRun {
  return {
    runId: run.runId,
    reason: run.reason,
    message: run.message,
    finishedAt: run.finishedAt,
  };
}

// The credential notice a run's refused credential raises, read as the key,
// its client and its share are now, or undefined once someone fixed it. A run
// raises one notice per credential: the first the realm server answers.
async function credentialNoticeOf(
  dbAdapter: DBAdapter,
  runId: string,
  credentialNotices: CredentialNotices,
): Promise<
  | {
      fix: AutomationCredentialFix;
      audience: AutomationNoticeAudience;
      recipients: string[];
    }
  | undefined
> {
  let run = await getAutomationRun(dbAdapter, runId);
  if (!run) {
    return undefined;
  }
  let [notice] = await credentialNotices(run);
  if (!notice) {
    return undefined;
  }
  let { recipients, ...fix } = notice;
  let audience: AutomationNoticeAudience =
    fix.kind === 'fix-share'
      ? 'direct-writers'
      : fix.kind === 'fix-client'
        ? 'client-owner'
        : 'payer';
  return { fix: fix as AutomationCredentialFix, audience, recipients };
}

interface LatestRun {
  runId: string;
  state: 'complete' | 'error';
  reason: string | null;
  message: string | null;
  finishedAt: string | null;
  operation: AutomationNoticeOperation | null;
}

// Each automation's latest run of its own that ended complete or as an error:
// a run its triggers started or a batch's follow-up, never a Preview or a Run
// now, which act as the person who clicked. A canceled run is left out, since
// a pause cancels the runs after the one that tells why it paused. Each comes
// with the operation its admission refused, when its `admission` log line
// names one. One query for every automation, through the runs'
// `(automation_id, finished_at)` index.
async function readLatestOwnRuns(
  querier: Querier,
  ids: string[],
): Promise<Map<string, LatestRun>> {
  let latest = new Map<string, LatestRun>();
  let values = separatedByCommas(
    ids.map((id) => addExplicitParens([param(id)]) as Expression),
  );
  let rows = (await querier([
    'SELECT ids.automation_id, r.id, r.state, r.error_reason, r.error_message,',
    'r.finished_at, l.data AS admission FROM (VALUES',
    ...values,
    ') AS ids(automation_id) CROSS JOIN LATERAL (',
    'SELECT id, state, error_reason, error_message, finished_at',
    'FROM automation_runs WHERE automation_id = ids.automation_id',
    "AND finished_at IS NOT NULL AND state IN ('complete', 'error')",
    "AND NOT dry_run AND trigger <> 'manual'",
    'ORDER BY finished_at DESC, id LIMIT 1',
    ') r LEFT JOIN LATERAL (',
    'SELECT data FROM automation_run_log',
    "WHERE run_id = r.id AND kind = 'admission'",
    'ORDER BY seq DESC LIMIT 1',
    ') l ON TRUE',
  ] as Expression)) as {
    automation_id: string;
    id: string;
    state: 'complete' | 'error';
    error_reason: string | null;
    error_message: string | null;
    finished_at: unknown;
    admission: unknown;
  }[];
  for (let row of rows) {
    latest.set(row.automation_id, {
      runId: row.id,
      state: row.state,
      reason: row.state === 'error' ? row.error_reason : null,
      message: row.state === 'error' ? row.error_message : null,
      finishedAt: iso(row.finished_at),
      operation: refusedOperation(row.admission),
    });
  }
  return latest;
}

// The operation an `admission` log line says was refused, from its `data`:
// `operation`, and the type it is declared on, `targetModule` and
// `targetName`.
function refusedOperation(data: unknown): AutomationNoticeOperation | null {
  let parsed = typeof data === 'string' ? safeParse(data) : data;
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }
  let { operation, targetModule, targetName } = parsed as Record<
    string,
    unknown
  >;
  if (
    typeof operation !== 'string' ||
    typeof targetModule !== 'string' ||
    typeof targetName !== 'string'
  ) {
    return null;
  }
  return { name: operation, module: targetModule, typeName: targetName };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function iso(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  let date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
