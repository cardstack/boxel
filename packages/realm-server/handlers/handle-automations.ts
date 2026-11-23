import type Koa from 'koa';
import {
  DAYS_PER_AVERAGE_MONTH,
  getAutomationRun,
  getAutomationStorage,
  isAutomationRunId,
  isDirectWriter,
  isRealmArchived,
  logger,
  now,
  param,
  query,
  RealmPaths,
  ri,
  SupportedMimeType,
  type AutomationRun,
  type DBAdapter,
  type RealmIdentifier,
  type RealmResourceIdentifier,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import {
  cancelAutomationRunFor,
  getAutomation,
  pauseAutomation,
  removeAutomation,
  resumeAutomation,
  switchOnAutomation,
  type AutomationActorOptions,
  type AutomationChange,
  type AutomationRow,
} from '@cardstack/runtime-common/automations';
import {
  readAutomationPreviewFile,
  readAutomationRunSummary,
  startAutomationPreview,
  startAutomationRunNow,
  type ManualRunStart,
} from '@cardstack/runtime-common/automation-manual-runs';
import { BYTES_PER_GB } from '@cardstack/runtime-common/metered-charges';
import {
  shownIdentity,
  withHiddenIdentities,
} from '@cardstack/runtime-common/automation-identities';
import { readRunDeclaration } from '@cardstack/runtime-common/automation-run-limits';
import {
  readRunLogPage,
  RUN_LOG_LEVELS,
  type RunLogLevel,
} from '@cardstack/runtime-common/automation-run-log';
import { switchOnNotices } from '@cardstack/runtime-common/automation-webhooks';
import { admitPayer } from '@cardstack/runtime-common/automation-admission';
import {
  KEY_APPROVAL_REFUSAL_REASONS,
  type AutomationKeyApprovals,
} from '@cardstack/runtime-common/automation-key-approval';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  AUTOMATION_ESTIMATE_RESOURCE_TYPE,
  AUTOMATION_RESOURCE_TYPE,
  AUTOMATION_ROUTE_AUTOMATION_PARAM,
  AUTOMATION_ROUTE_PATH_PARAM,
  AUTOMATION_ROUTE_REALM_PARAM,
  AUTOMATION_ROUTE_RUN_PARAM,
  AUTOMATION_RUN_LOG_AFTER_PARAM,
  AUTOMATION_RUN_LOG_DEFAULT_LIMIT,
  AUTOMATION_RUN_LOG_LEVEL_PARAM,
  AUTOMATION_RUN_LOG_LIMIT_PARAM,
  AUTOMATION_RUN_LOG_MAX_LIMIT,
  AUTOMATION_RUN_LOG_RESOURCE_TYPE,
  AUTOMATION_RUN_LOG_RUN_PARAM,
  AUTOMATION_RUN_REPORT_RESOURCE_TYPE,
  AUTOMATION_RUN_RESOURCE_TYPE,
  AUTOMATION_STORAGE_RESOURCE_TYPE,
  type AutomationRunLogDocument,
} from '@cardstack/runtime-common/automation-routes';
import {
  sendResponseForError,
  setContextResponse,
} from '../middleware/index.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import type { RealmServerTokenClaim } from '../utils/jwt.ts';
import {
  estimateAutomationCost,
  type AutomationEstimate,
} from '../lib/automation-estimate.ts';
import { buildAdmitPayerSpending } from '../lib/automation-spending.ts';
import { findOrMountRealm } from '../lib/realm-routing.ts';
import { followAutomationKeyApprovals } from '../lib/automation-key-approvals.ts';
import { exactMeteredCredits } from '../lib/metered-charge.ts';
import { currentPricing } from '../lib/pricing.ts';
import {
  realmServerAutomationChangeReporter,
  realmServerRunChangeReporter,
} from '../lib/run-change-reporter.ts';

// The routes a direct writer drives an automation with (see
// `automation-routes.ts` in runtime-common for their paths and bodies). Each
// acts as the user of the session the request carries, through the
// lifecycle functions in `automations.ts` and `automation-manual-runs.ts`,
// which check direct write again under their own locks. Nothing here acts as
// a user a header names (ADR 006).

type Handler = (ctxt: Koa.Context, next: Koa.Next) => Promise<void>;

const log = logger('realm-server:automations');

// The most a request body may hold, in bytes. Every body is a small JSON
// document.
const MAX_BODY_BYTES = 16 * 1024;

class AutomationRouteError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Entity',
  503: 'Service Unavailable',
};

function automationHandler(fn: (ctxt: Koa.Context) => Promise<void>): Handler {
  return async function (ctxt: Koa.Context, _next: Koa.Next) {
    try {
      await fn(ctxt);
    } catch (e: any) {
      if (e instanceof AutomationRouteError) {
        await sendResponseForError(
          ctxt,
          e.status,
          STATUS_TEXT[e.status] ?? 'Error',
          e.message,
        );
        return;
      }
      log.error(
        `${ctxt.method} ${ctxt.path} failed: ${e?.name ?? 'Error'}: ${e?.message ?? e}`,
      );
      await sendResponseForError(
        ctxt,
        500,
        'System Error',
        'Internal server error',
      );
    }
  };
}

// The person the request acts as: the session's own user. A
// realm-authority session is a realm acting on its own authority and a
// delegated session reads one realm for its user; neither is that person
// switching on, running or paying for an automation.
function callerOf(ctxt: Koa.Context): string {
  let token = ctxt.state.token as RealmServerTokenClaim | undefined;
  if (!token?.user) {
    throw new AutomationRouteError(
      403,
      'automations are driven by a signed-in user',
    );
  }
  if (token.realmAuthority || token.delegated) {
    throw new AutomationRouteError(
      403,
      'automations are driven only in their user’s own session',
    );
  }
  return token.user;
}

async function sendJSON(ctxt: Koa.Context, status: number, body: unknown) {
  await setContextResponse(
    ctxt,
    new Response(JSON.stringify(body), {
      status,
      headers: {
        'content-type': SupportedMimeType.JSONAPI,
        // An automation's row and runs change with every run, pause and
        // resume.
        'cache-control': 'no-store',
      },
    }),
  );
}

interface RequestedResource {
  id: string;
  attributes: Record<string, unknown>;
}

// Reads the body, refusing one larger than `MAX_BODY_BYTES` as soon as its
// declared length or the bytes received so far pass it, so an oversized body
// is never held whole. Any signed-in session reaches this before the
// direct-writer check, which needs the realm the body names.
async function readBody(ctxt: Koa.Context): Promise<string> {
  let declared = Number(ctxt.get('Content-Length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new AutomationRouteError(413, 'the request body is too large');
  }
  let chunks: Buffer[] = [];
  let received = 0;
  for await (let chunk of ctxt.req) {
    let buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    received += buffer.length;
    if (received > MAX_BODY_BYTES) {
      throw new AutomationRouteError(413, 'the request body is too large');
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readResource(
  ctxt: Koa.Context,
  type: string,
): Promise<RequestedResource> {
  let text = await readBody(ctxt);
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AutomationRouteError(400, 'the request body is not valid JSON');
  }
  let data = json?.data;
  if (
    !data ||
    typeof data !== 'object' ||
    data.type !== type ||
    typeof data.id !== 'string' ||
    data.id.length === 0
  ) {
    throw new AutomationRouteError(
      400,
      `the request body must be { data: { type: "${type}", id, attributes: { realm } } }`,
    );
  }
  let attributes = data.attributes ?? {};
  if (typeof attributes !== 'object' || Array.isArray(attributes)) {
    throw new AutomationRouteError(400, 'attributes must be an object');
  }
  return { id: data.id, attributes };
}

function urlOf(value: unknown, what: string): URL {
  if (typeof value !== 'string') {
    throw new AutomationRouteError(400, `name the ${what} by its URL`);
  }
  try {
    return new URL(value);
  } catch {
    throw new AutomationRouteError(400, `${value} is not a URL`);
  }
}

// The realm the request names, once the caller is known to directly write
// it. Checked before anything about the realm's automations is read, so a
// caller who isn't a direct writer is refused the same way whether or not
// the automation or run exists.
async function directlyWrittenRealm(
  dbAdapter: DBAdapter,
  matrixServerName: string,
  caller: string,
  realm: unknown,
): Promise<URL> {
  let realmURL = urlOf(realm, 'realm');
  if (!realmURL.href.endsWith('/')) {
    realmURL = new URL(`${realmURL.href}/`);
  }
  if (!(await isDirectWriter(dbAdapter, realmURL, caller, matrixServerName))) {
    throw new AutomationRouteError(
      403,
      `only a direct writer of ${realmURL.href} can drive its automations`,
    );
  }
  return realmURL;
}

function automationIn(
  realmURL: URL,
  automation: unknown,
  virtualNetwork: VirtualNetwork,
): RealmResourceIdentifier {
  let url = urlOf(automation, 'automation card');
  if (!new RealmPaths(realmURL).inRealm(url)) {
    throw new AutomationRouteError(
      400,
      `${url.href} is not in ${realmURL.href}`,
    );
  }
  return virtualNetwork.unresolveURL(url.href);
}

// The automation's card as indexed, read as a declaration. A card that isn't
// indexed, failed to index, or doesn't read as an automation can't be
// switched on or run. The card's own realm, as its index row records it, must
// be the realm the request names: `automationIn` checks only that the card's
// URL falls under the realm's, which a realm mounted under another realm's
// path would also satisfy, and the row's realm is what every later
// direct-writer check asks about.
async function declarationOf(
  { dbAdapter, definitionLookup, virtualNetwork }: CreateRoutesArgs,
  automationId: RealmResourceIdentifier,
  realmURL: URL,
): Promise<AutomationDeclaration> {
  let read = await readRunDeclaration({
    dbAdapter,
    definitionLookup,
    virtualNetwork,
    automationId,
  });
  if (!read.ok) {
    throw new AutomationRouteError(422, read.message);
  }
  if (virtualNetwork.toURLHref(read.declaration.realmURL) !== realmURL.href) {
    throw new AutomationRouteError(
      400,
      `the automation card is in ${read.declaration.realmURL}, not ${realmURL.href}`,
    );
  }
  return read.declaration;
}

// The automation's key approvals with `payer` as its payer (ADR 039),
// checked in its realm: each declared operation approved, or missing with who
// can approve it, and the version an approval of it names. Undefined when
// the realm can't check, which leaves the automation to its runs'
// admission.
async function keyApprovalsOf(
  args: CreateRoutesArgs,
  realmURL: URL,
  automationId: RealmResourceIdentifier,
  declaration: AutomationDeclaration,
  payer: string,
): Promise<AutomationKeyApprovals | undefined> {
  let realm = await findOrMountRealm(realmURL, args);
  return realm?.url === realmURL.href
    ? await realm.checkAutomationKeyApprovals({
        automationId,
        declaration,
        payer,
      })
    : undefined;
}

// Key approvals as a route answers them: whether every one is there, the
// version (`versionKey`) a confirmation approving the rest names, and each
// operation's state.
function serializeKeyApprovals(approvals: AutomationKeyApprovals) {
  return {
    approved: approvals.approved,
    version: approvals.version.versionKey,
    operations: approvals.operations,
  };
}

// Preview and Run now start a run whether or not the automation is switched
// on, so archiving a realm, which stops its switched-on automations, has no
// row of theirs to pause. Switch-on and resume make this check themselves,
// in the transaction that writes the row (see `switchOnAutomation`).
async function refuseOnArchivedRealm(
  dbAdapter: DBAdapter,
  realmURL: URL,
): Promise<void> {
  if (await isRealmArchived(dbAdapter, realmURL)) {
    throw new AutomationRouteError(
      409,
      `${realmURL.href} is archived, so its automations stay off until it is restored`,
    );
  }
}

// The monthly credit cap the caller agrees to, which must be the card's own.
// The caps snapshot is taken from the card, so a cap that differs from the
// card's means the card changed since the caller read it.
function agreedMonthlyCap(
  attributes: Record<string, unknown>,
  declaration: AutomationDeclaration,
): number {
  let agreed = attributes.monthlyCredits;
  if (typeof agreed !== 'number' || !Number.isInteger(agreed) || agreed < 0) {
    throw new AutomationRouteError(
      400,
      'name the monthly credit cap you agree to pay up to in attributes.monthlyCredits, a whole number of credits',
    );
  }
  let card = declaration.caps.monthlyCredits;
  if (typeof card !== 'number') {
    throw new AutomationRouteError(
      422,
      'the automation card sets no monthly credit cap (caps.monthlyCredits); set one on the card before switching it on',
    );
  }
  if (agreed !== card) {
    throw new AutomationRouteError(
      409,
      `the automation card's monthly credit cap is ${card}, not ${agreed}; read its estimate again and agree to the cap it sets`,
    );
  }
  return agreed;
}

function actorOptions(args: CreateRoutesArgs): AutomationActorOptions {
  return {
    matrixServerName: args.matrixClient.serverName,
    virtualNetwork: args.virtualNetwork,
    reportRunChange: realmServerRunChangeReporter(args),
    reportAutomationChange: realmServerAutomationChangeReporter(args),
  };
}

function iso(unixSeconds: number | null): string | null {
  return unixSeconds === null
    ? null
    : new Date(unixSeconds * 1000).toISOString();
}

function serializeAutomation(
  args: CreateRoutesArgs,
  row: AutomationRow,
  caller: string,
) {
  return {
    type: AUTOMATION_RESOURCE_TYPE,
    id: args.virtualNetwork.toURLHref(row.automationId),
    attributes: {
      state: row.state,
      pauseReason: row.pauseReason,
      viewerIsPayer: row.payer === caller,
      nextRun: iso(row.nextRun),
      scheduledSince: iso(row.scheduledSince),
      capsSnapshot: row.capsSnapshot,
      switchedOnAt: row.switchedOnAt,
    },
  };
}

function serializeRun(args: CreateRoutesArgs, run: AutomationRun) {
  return {
    type: AUTOMATION_RUN_RESOURCE_TYPE,
    id: run.id,
    attributes: {
      automation: args.virtualNetwork.toURLHref(run.automationId),
      trigger: run.trigger,
      dryRun: run.dryRun,
      state: run.state,
      errorReason: run.errorReason,
      canceledBy: run.canceledBy,
      createdAt: run.createdAt,
      finishedAt: run.finishedAt,
    },
  };
}

// The status a lifecycle refusal answers with. `outside-realm` and
// `other-card` can't come from these routes, which check the automation is
// in the realm and read the declaration from its own card, but are answered
// all the same.
function refusalStatus(reason: string): number {
  switch (reason) {
    case 'not-a-direct-writer':
      return 403;
    case 'missing':
      return 404;
    case 'outside-realm':
      return 400;
    default:
      return 409;
  }
}

const REFUSAL_MESSAGES: Record<string, string> = {
  'not-a-direct-writer':
    'only a direct writer of the automation’s realm can drive it',
  missing: 'the automation is not switched on',
  'outside-realm': 'the automation is not in the realm named',
  'other-card': 'the declaration read is another card’s',
  'already-switched-on': 'the automation is already switched on',
  'not-paused': 'the automation is not paused',
  'not-pausable': 'the automation is already paused',
  'click-reused':
    'this click already started a run for someone else, or a run of the other kind; send a fresh click id',
  'realm-archived':
    'the automation’s realm is archived, so its automations stay off until it is restored',
  'not-cancelable':
    'the run already ended, or its commit was claimed and is landing',
};

function refuse(reason: string): never {
  throw new AutomationRouteError(
    refusalStatus(reason),
    REFUSAL_MESSAGES[reason] ?? reason,
  );
}

async function answerChange(
  ctxt: Koa.Context,
  args: CreateRoutesArgs,
  change: AutomationChange,
  caller: string,
  status = 200,
  meta?: Record<string, unknown>,
) {
  if (!change.ok) {
    if (change.reason === 'unusable-webhook') {
      throw new AutomationRouteError(
        422,
        change.problems.map(({ message }) => message).join('; '),
      );
    }
    if (change.reason === 'not-admitted') {
      await sendJSON(ctxt, 422, {
        errors: [change.refusal.message],
        meta: { code: change.refusal.reason },
      });
      return;
    }
    refuse(change.reason);
  }
  await sendJSON(ctxt, status, {
    data: serializeAutomation(args, change.automation, caller),
    ...(meta ? { meta } : {}),
  });
}

// Credits the caller's latest finished Preview of the automation cost, or
// undefined when they have none. Read through the runs'
// `(automation_id, created_at)` index and the ledger's `run_id` index.
async function recentPreviewCredits(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  caller: string,
): Promise<number | undefined> {
  let [row] = await query(dbAdapter, [
    'SELECT r.id, COALESCE(-SUM(l.credit_amount), 0) AS credits FROM (SELECT id FROM automation_runs WHERE automation_id =',
    param(automationId),
    'AND acts_as =',
    param(caller),
    'AND dry_run AND finished_at IS NOT NULL ORDER BY created_at DESC LIMIT 1) r LEFT JOIN credits_ledger l ON l.run_id = r.id GROUP BY r.id',
  ]);
  return row ? Number(row.credits) : undefined;
}

async function estimateFor(
  args: CreateRoutesArgs,
  declaration: AutomationDeclaration,
  automationId: RealmResourceIdentifier,
  caller: string,
  row: AutomationRow | undefined,
): Promise<AutomationEstimate | undefined> {
  let pricing = currentPricing();
  if (!pricing) {
    return undefined;
  }
  let recent = await recentPreviewCredits(args.dbAdapter, automationId, caller);
  return estimateAutomationCost({
    triggers: declaration.triggers,
    caps: declaration.caps,
    pricing,
    now: Math.floor(now() / 1000),
    ...(row ? { since: row.scheduledSince, runState: row.triggerRuns } : {}),
    ...(recent !== undefined ? { recentPreviewCredits: recent } : {}),
  });
}

// `GET /_automation-switch-on?realm=<realm URL>&automation=<card URL>`: what
// switching the automation on is likely to cost a month, the monthly credit
// cap the card sets, which a switch-on agrees to, and its key approvals
// (`keyApprovals`): with its payer as payer once it is switched on, and with
// the caller before. 503 while this process has no prices.
export function handleAutomationEstimate(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let caller = callerOf(ctxt);
    let realmURL = await directlyWrittenRealm(
      args.dbAdapter,
      args.matrixClient.serverName,
      caller,
      ctxt.URL.searchParams.get(AUTOMATION_ROUTE_REALM_PARAM),
    );
    let automationId = automationIn(
      realmURL,
      ctxt.URL.searchParams.get(AUTOMATION_ROUTE_AUTOMATION_PARAM),
      args.virtualNetwork,
    );
    let declaration = await declarationOf(args, automationId, realmURL);
    let row = await getAutomation(args.dbAdapter, automationId);
    let estimate = await estimateFor(
      args,
      declaration,
      automationId,
      caller,
      row,
    );
    if (!estimate) {
      throw new AutomationRouteError(
        503,
        'this server has no prices, so it can neither estimate nor admit automation runs until its pricing is fixed',
      );
    }
    let keyApprovals = await keyApprovalsOf(
      args,
      realmURL,
      automationId,
      declaration,
      row?.payer ?? caller,
    );
    await sendJSON(ctxt, 200, {
      data: {
        type: AUTOMATION_ESTIMATE_RESOURCE_TYPE,
        id: args.virtualNetwork.toURLHref(automationId),
        attributes: {
          switchedOn: row !== undefined,
          monthlyCredits: declaration.caps.monthlyCredits,
          estimate,
          notices: switchOnNotices(declaration),
          ...(keyApprovals
            ? { keyApprovals: serializeKeyApprovals(keyApprovals) }
            : {}),
        },
      },
    });
  });
}

// `POST /_automation-switch-on`: switches the automation on for the caller,
// who becomes its payer, with the card's caps as the snapshot. The body's
// `monthlyCredits` must be the card's monthly credit cap. Every declared
// operation is checked for its key approvals first, with the caller as the
// payer: when one is missing, the automation switches on *waiting for key
// approval*, with no next run, and runs once the last approval lands. The
// answer's `meta.keyApprovals` says, for each operation, whether it is
// approved or who can approve it, and names the version a confirmation
// approving the rest names.
export function handleAutomationSwitchOn(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let caller = callerOf(ctxt);
    let { id, attributes } = await readResource(ctxt, AUTOMATION_RESOURCE_TYPE);
    let realmURL = await directlyWrittenRealm(
      args.dbAdapter,
      args.matrixClient.serverName,
      caller,
      attributes.realm,
    );
    let automationId = automationIn(realmURL, id, args.virtualNetwork);
    let declaration = await declarationOf(args, automationId, realmURL);
    agreedMonthlyCap(attributes, declaration);
    let keyApprovals = await keyApprovalsOf(
      args,
      realmURL,
      automationId,
      declaration,
      caller,
    );
    let change = await switchOnAutomation(
      args.dbAdapter,
      {
        automationId,
        realm: ri(args.virtualNetwork.unresolveURL(realmURL.href)),
        user: caller,
        declaration,
        keyApproved: keyApprovals?.approved ?? true,
      },
      actorOptions(args),
    );
    if (change.ok && change.automation.state === 'waiting-for-key-approval') {
      // An approval that landed between the check and the row's insert found
      // no row to move, so the new row is checked once more.
      let followed = (
        await followAutomationKeyApprovals(args, realmURL, [automationId])
      ).get(automationId);
      if (followed) {
        change = { ok: true, automation: followed.automation };
      }
    }
    let estimate = change.ok
      ? await estimateFor(
          args,
          declaration,
          automationId,
          caller,
          change.automation,
        )
      : undefined;
    await answerChange(ctxt, args, change, caller, 201, {
      ...(estimate ? { estimate } : {}),
      notices: switchOnNotices(declaration),
      ...(keyApprovals
        ? { keyApprovals: serializeKeyApprovals(keyApprovals) }
        : {}),
    });
  });
}

function manualRunHandler(
  args: CreateRoutesArgs,
  start: typeof startAutomationPreview | typeof startAutomationRunNow,
): Handler {
  return automationHandler(async (ctxt) => {
    let caller = callerOf(ctxt);
    let { id, attributes } = await readResource(ctxt, AUTOMATION_RESOURCE_TYPE);
    let realmURL = await directlyWrittenRealm(
      args.dbAdapter,
      args.matrixClient.serverName,
      caller,
      attributes.realm,
    );
    let automationId = automationIn(realmURL, id, args.virtualNetwork);
    let click = attributes.click;
    if (typeof click !== 'string' || click.length === 0 || click.length > 200) {
      throw new AutomationRouteError(
        400,
        'name the click in attributes.click: a fresh id per click',
      );
    }
    await refuseOnArchivedRealm(args.dbAdapter, realmURL);
    let declaration = await declarationOf(args, automationId, realmURL);
    let started: ManualRunStart = await start(
      { dbAdapter: args.dbAdapter, queue: args.queue },
      {
        automationId,
        realm: ri(args.virtualNetwork.unresolveURL(realmURL.href)),
        user: caller,
        click,
        declaration,
      },
      actorOptions(args),
    );
    if (!started.ok) {
      refuse(started.reason);
    }
    await sendJSON(ctxt, 202, { data: serializeRun(args, started.run) });
  });
}

// `POST /_automation-preview`: starts a Preview of the automation, acting
// as and charged to the caller, whether or not the automation is switched
// on. It stages the script's writes and stops before the commit.
export function handleAutomationPreview(args: CreateRoutesArgs): Handler {
  return manualRunHandler(args, startAutomationPreview);
}

// `POST /_automation-run-now`: starts a run of the automation that commits,
// acting as and charged to the caller, whether or not the automation is
// switched on.
export function handleAutomationRunNow(args: CreateRoutesArgs): Handler {
  return manualRunHandler(args, startAutomationRunNow);
}

async function automationRequest(
  ctxt: Koa.Context,
  args: CreateRoutesArgs,
): Promise<{
  caller: string;
  realmURL: URL;
  automationId: RealmResourceIdentifier;
  attributes: Record<string, unknown>;
}> {
  let caller = callerOf(ctxt);
  let { id, attributes } = await readResource(ctxt, AUTOMATION_RESOURCE_TYPE);
  let realmURL = await directlyWrittenRealm(
    args.dbAdapter,
    args.matrixClient.serverName,
    caller,
    attributes.realm,
  );
  let automationId = automationIn(realmURL, id, args.virtualNetwork);
  return { caller, realmURL, automationId, attributes };
}

// `POST /_automation-pause`: pauses the automation and cancels its pending
// and running runs.
export function handleAutomationPause(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let { caller, automationId } = await automationRequest(ctxt, args);
    let change = await pauseAutomation(
      args.dbAdapter,
      { automationId, user: caller },
      actorOptions(args),
    );
    await answerChange(ctxt, args, change, caller);
  });
}

// `POST /_automation-resume`: resumes a paused automation, whatever paused
// it. The caller becomes its payer, with a new snapshot of the card's caps,
// so the body's `monthlyCredits` must be the card's monthly credit cap, as
// at switch-on. The caller is admitted as the payer first, as the
// automation's next run would admit them (`admitPayer`): a refusal answers
// 422 with the run's refusal code in `meta.code`, and the automation stays
// paused. A key approval the caller as payer would need doesn't refuse the
// resume: as at switch-on, the automation resumes *waiting for key approval*
// until it lands, and `meta.keyApprovals` says what is missing.
export function handleAutomationResume(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let { caller, realmURL, automationId, attributes } =
      await automationRequest(ctxt, args);
    let declaration = await declarationOf(args, automationId, realmURL);
    agreedMonthlyCap(attributes, declaration);
    let admitSpending = buildAdmitPayerSpending({ dbAdapter: args.dbAdapter });
    let keyApprovals: AutomationKeyApprovals | undefined;
    let change = await resumeAutomation(
      args.dbAdapter,
      {
        automationId,
        user: caller,
        declaration,
        admit: (payer, firstRun) =>
          admitPayer(
            {
              accountStanding: args.automationAccountStanding,
              admitInRealm: async (payer) => {
                // A realm no request has reached since this process started
                // isn't mounted yet; mounting it is what serving its first
                // request would do.
                let realm = await findOrMountRealm(realmURL, args);
                let refusal =
                  realm?.url === realmURL.href
                    ? await realm.admitAutomationPayer({ declaration, payer })
                    : {
                        reason: 'run-admission-unavailable',
                        message: `${realmURL.href} isn't served here, so its automation's operations can't be checked`,
                      };
                // A missing key approval makes the automation wait instead
                // (`keyApproved`).
                return refusal &&
                  (KEY_APPROVAL_REFUSAL_REASONS as readonly string[]).includes(
                    refusal.reason,
                  )
                  ? undefined
                  : refusal;
              },
              admitSpending: (payer) =>
                admitSpending({
                  payer,
                  automationId,
                  caps: declaration.caps,
                  firstRunAt: firstRun.at,
                }),
            },
            payer,
          ),
        keyApproved: async (payer) => {
          keyApprovals = await keyApprovalsOf(
            args,
            realmURL,
            automationId,
            declaration,
            payer,
          );
          return keyApprovals?.approved ?? true;
        },
      },
      actorOptions(args),
    );
    await answerChange(ctxt, args, change, caller, 200, {
      notices: switchOnNotices(declaration),
      ...(keyApprovals
        ? { keyApprovals: serializeKeyApprovals(keyApprovals) }
        : {}),
    });
  });
}

// `POST /_automation-remove`: switches the automation off, deleting its row
// and canceling its pending and running runs. The card and its script stay.
// Answers the row as it was.
export function handleAutomationRemove(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let { caller, automationId } = await automationRequest(ctxt, args);
    let change = await removeAutomation(
      args.dbAdapter,
      { automationId, user: caller },
      actorOptions(args),
    );
    await answerChange(ctxt, args, change, caller);
  });
}

// `GET /_automation-run-log?realm=<realm>&run=<id>`: one page of the run's
// log, for the console. The caller's direct write on the realm is checked
// before the run is looked up, so a caller who isn't a direct writer is
// refused the same way whether or not the run exists, and a run of another
// realm is no run of this one. The query's `after`, `limit` and `level`
// choose the page (see `automation-routes.ts`).
export function handleAutomationRunLog(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let caller = callerOf(ctxt);
    let params = ctxt.URL.searchParams;
    let realmURL = await directlyWrittenRealm(
      args.dbAdapter,
      args.matrixClient.serverName,
      caller,
      params.get(AUTOMATION_ROUTE_REALM_PARAM),
    );
    let runId = params.get(AUTOMATION_RUN_LOG_RUN_PARAM) ?? '';
    let after = integerParam(params, AUTOMATION_RUN_LOG_AFTER_PARAM, -1, -1);
    let limit = integerParam(
      params,
      AUTOMATION_RUN_LOG_LIMIT_PARAM,
      AUTOMATION_RUN_LOG_DEFAULT_LIMIT,
      1,
    );
    if (limit > AUTOMATION_RUN_LOG_MAX_LIMIT) {
      throw new AutomationRouteError(
        400,
        `"${AUTOMATION_RUN_LOG_LIMIT_PARAM}" is at most ${AUTOMATION_RUN_LOG_MAX_LIMIT}`,
      );
    }
    let levels = levelsParam(params.get(AUTOMATION_RUN_LOG_LEVEL_PARAM));
    let seen = isAutomationRunId(runId)
      ? await getAutomationRun(args.dbAdapter, runId)
      : undefined;
    if (!seen || args.virtualNetwork.toURLHref(seen.realm) !== realmURL.href) {
      throw new AutomationRouteError(
        404,
        `no run ${runId} in ${realmURL.href}`,
      );
    }
    let page = await readRunLogPage(args.dbAdapter, runId, {
      after,
      limit,
      levels,
    });
    if (!page) {
      throw new AutomationRouteError(
        404,
        `no run ${runId} in ${realmURL.href}`,
      );
    }
    let document: AutomationRunLogDocument = {
      data: {
        type: AUTOMATION_RUN_LOG_RESOURCE_TYPE,
        id: runId,
        attributes: {
          state:
            page.state as AutomationRunLogDocument['data']['attributes']['state'],
          lines: page.lines,
          next: page.next,
          more: page.more,
          total: page.total,
          dropped: page.dropped,
        },
      },
    };
    await sendJSON(ctxt, 200, document);
  });
}

// The largest `seq` a run's log holds, Postgres's `integer`.
const MAX_SEQ = 2 ** 31 - 1;

// An integer query parameter, `fallback` when absent, refused when it isn't
// a whole number from `min` to `MAX_SEQ`.
function integerParam(
  params: URLSearchParams,
  name: string,
  fallback: number,
  min: number,
): number {
  let value = params.get(name);
  if (value === null || value === '') {
    return fallback;
  }
  let number = Number(value);
  if (!Number.isInteger(number) || number < min || number > MAX_SEQ) {
    throw new AutomationRouteError(
      400,
      `"${name}" must be a whole number from ${min} to ${MAX_SEQ}`,
    );
  }
  return number;
}

// The `level` query parameter: the levels to keep, comma-separated, or
// every level when absent.
function levelsParam(value: string | null): RunLogLevel[] | undefined {
  if (value === null || value === '') {
    return undefined;
  }
  let levels: RunLogLevel[] = [];
  for (let name of value.split(',')) {
    let level = RUN_LOG_LEVELS.find((l) => l === name.trim());
    if (!level) {
      throw new AutomationRouteError(
        400,
        `"${AUTOMATION_RUN_LOG_LEVEL_PARAM}" takes ${RUN_LOG_LEVELS.join(', ')}, comma-separated, not "${name}"`,
      );
    }
    if (!levels.includes(level)) {
      levels.push(level);
    }
  }
  return levels;
}

// `POST /_automation-run-cancel`: cancels one of the realm's pending or
// running runs, whatever started it. The automation's own state doesn't
// change.
export function handleAutomationRunCancel(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let caller = callerOf(ctxt);
    let { id, attributes } = await readResource(
      ctxt,
      AUTOMATION_RUN_RESOURCE_TYPE,
    );
    let realmURL = await directlyWrittenRealm(
      args.dbAdapter,
      args.matrixClient.serverName,
      caller,
      attributes.realm,
    );
    let seen = isAutomationRunId(id)
      ? await getAutomationRun(args.dbAdapter, id)
      : undefined;
    if (!seen || args.virtualNetwork.toURLHref(seen.realm) !== realmURL.href) {
      throw new AutomationRouteError(404, `no run ${id} in ${realmURL.href}`);
    }
    let { matrixServerName, virtualNetwork, reportRunChange } =
      actorOptions(args);
    let canceled = await cancelAutomationRunFor(
      args.dbAdapter,
      { runId: id, user: caller },
      { matrixServerName, virtualNetwork, reportRunChange },
    );
    if (!canceled.ok) {
      refuse(canceled.reason);
    }
    await sendJSON(ctxt, 200, { data: serializeRun(args, canceled.run) });
  });
}

// The longest realm-local path a staged-file read may name.
const MAX_PATH_CHARS = 4096;

// How many of the automation's storage charges the storage view lists, newest
// first.
const STORAGE_CHARGES_LISTED = 30;

// The run a console read names, in the realm it names, once the caller is
// known to directly write that realm. A run of another realm answers as no
// run, so the read learns nothing about realms the caller doesn't write.
async function requestedRun(
  ctxt: Koa.Context,
  args: CreateRoutesArgs,
): Promise<{ caller: string; realmURL: URL; run: AutomationRun }> {
  let caller = callerOf(ctxt);
  let realmURL = await directlyWrittenRealm(
    args.dbAdapter,
    args.matrixClient.serverName,
    caller,
    ctxt.URL.searchParams.get(AUTOMATION_ROUTE_REALM_PARAM),
  );
  let runId = ctxt.URL.searchParams.get(AUTOMATION_ROUTE_RUN_PARAM) ?? '';
  let run = isAutomationRunId(runId)
    ? await getAutomationRun(args.dbAdapter, runId)
    : undefined;
  if (!run || args.virtualNetwork.toURLHref(run.realm) !== realmURL.href) {
    throw new AutomationRouteError(404, `no run ${runId} in ${realmURL.href}`);
  }
  return { caller, realmURL, run };
}

// A console read the lifecycle functions refused, after `requestedRun`
// found the run in a realm the caller directly writes: the run or the
// caller's write went in between.
function refuseRead(
  reason: 'missing' | 'not-a-direct-writer',
  message: string,
): never {
  throw new AutomationRouteError(
    reason === 'missing' ? 404 : 403,
    reason === 'missing'
      ? message
      : 'only a direct writer of the automation’s realm can read its runs',
  );
}

// `GET /_automation-run-report?realm=<realm URL>&run=<run id>`: the run as
// the console's timeline shows it. Who the run acts as and who canceled it
// follow ADR 011 (see `shownIdentity`); `viewerIsActsAs`, `viewerCanceled`
// and `canceledByAPerson` say as much as the viewer may know when the ids
// are hidden.
export function handleAutomationRunReport(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let { caller, realmURL, run: requested } = await requestedRun(ctxt, args);
    let read = await readAutomationRunSummary(
      args.dbAdapter,
      { runId: requested.id, user: caller },
      {
        matrixServerName: args.matrixClient.serverName,
        virtualNetwork: args.virtualNetwork,
      },
    );
    if (!read.ok) {
      refuseRead(read.reason, `no run ${requested.id} in ${realmURL.href}`);
    }
    let { summary } = read;
    let { run } = summary;
    let [actsAs, canceledBy, errorMessage] = await Promise.all([
      shownIdentity(args.dbAdapter, caller, run.actsAs),
      shownIdentity(args.dbAdapter, caller, run.canceledBy),
      withHiddenIdentities(args.dbAdapter, caller, run.errorMessage),
    ]);
    await sendJSON(ctxt, 200, {
      data: {
        type: AUTOMATION_RUN_REPORT_RESOURCE_TYPE,
        id: run.id,
        attributes: {
          automation: args.virtualNetwork.toURLHref(run.automationId),
          trigger: run.trigger,
          dryRun: run.dryRun,
          state: run.state,
          errorReason: run.errorReason,
          errorMessage,
          credentialRefusal: run.credentialRefusal,
          actsAs,
          viewerIsActsAs: run.actsAs === caller,
          canceledBy,
          canceledByAPerson: run.canceledBy !== null,
          viewerCanceled: run.canceledBy === caller,
          timings: summary.timings,
          milestones: summary.milestones,
          log: summary.log,
          callApiCalls: summary.callApiCalls,
          resolveCalls: summary.resolveCalls,
          writes: {
            count: run.writes,
            ...(summary.stagedFiles ? { staged: summary.stagedFiles } : {}),
            ...(summary.stagedFilesReplacedBy
              ? { stagedReplacedBy: summary.stagedFilesReplacedBy }
              : {}),
            ...(summary.committedPaths
              ? { committed: summary.committedPaths }
              : {}),
          },
          cost: summary.cost,
        },
      },
    });
  });
}

// `GET /_automation-preview-file?realm=<realm URL>&run=<run id>&path=<path>`:
// the bytes of one file a complete Preview staged, at its realm-local path.
// The script chose the bytes, so they are always served as
// `application/octet-stream` and never sniffed: the console decides how to
// show them from the path.
export function handleAutomationPreviewFile(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let { caller, realmURL, run } = await requestedRun(ctxt, args);
    let path = ctxt.URL.searchParams.get(AUTOMATION_ROUTE_PATH_PARAM);
    if (!path || path.length > MAX_PATH_CHARS) {
      throw new AutomationRouteError(
        400,
        `name the staged file by its realm-local path in the "${AUTOMATION_ROUTE_PATH_PARAM}" query parameter`,
      );
    }
    let read = await readAutomationPreviewFile(
      args.dbAdapter,
      { runId: run.id, path, user: caller },
      {
        matrixServerName: args.matrixClient.serverName,
        virtualNetwork: args.virtualNetwork,
      },
    );
    if (!read.ok) {
      refuseRead(
        read.reason,
        `run ${run.id} in ${realmURL.href} kept no staged file at ${path}`,
      );
    }
    await setContextResponse(
      ctxt,
      new Response(Buffer.from(read.content), {
        status: 200,
        headers: {
          'content-type': 'application/octet-stream',
          'x-content-type-options': 'nosniff',
          // A later Preview by the same person drops this one's batch.
          'cache-control': 'no-store',
        },
      }),
    );
  });
}

// The automation's storage charges in its realm's ledger rows, newest first:
// each covers the days since the one before, and is written once those days
// cost a whole credit (see `automation-storage-charge.ts`). A charge drawn
// from more than one of the payer's credit buckets is one ledger row per
// bucket, all naming the same day, so a charge is the sum of its day's rows.
async function storageCharges(
  dbAdapter: DBAdapter,
  automationId: RealmResourceIdentifier,
  realm: RealmIdentifier,
): Promise<{ day: string; credits: number }[]> {
  let rows = await query(dbAdapter, [
    `SELECT to_char(charge_day, 'YYYY-MM-DD') AS day, -SUM(credit_amount) AS credits
     FROM credits_ledger
     WHERE charge_kind = 'storage' AND run_id IS NULL AND batch_id IS NULL
       AND automation_id =`,
    param(automationId),
    'AND realm =',
    param(realm),
    'GROUP BY charge_day ORDER BY charge_day DESC LIMIT',
    param(STORAGE_CHARGES_LISTED),
  ]);
  return rows.map((row) => ({
    day: String(row.day),
    credits: Number(row.credits),
  }));
}

// `GET /_automation-storage?realm=<realm URL>&automation=<card URL>`: every
// file the automation's runs created that still exists, with its bytes on
// disk and in the index, and the daily charge: what a day of that storage
// costs at this server's prices (`dailyCredits`, before rounding, or null
// without prices) and the storage charges written so far. A switched-on
// automation's payer pays the charge, and is shown under ADR 011 (see
// `shownIdentity`).
export function handleAutomationStorage(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let caller = callerOf(ctxt);
    let realmURL = await directlyWrittenRealm(
      args.dbAdapter,
      args.matrixClient.serverName,
      caller,
      ctxt.URL.searchParams.get(AUTOMATION_ROUTE_REALM_PARAM),
    );
    let automationId = automationIn(
      realmURL,
      ctxt.URL.searchParams.get(AUTOMATION_ROUTE_AUTOMATION_PARAM),
      args.virtualNetwork,
    );
    // The automation's data is read by its id and kept only where it records
    // the realm the caller writes: a card URL under this realm's URL can
    // belong to another realm mounted beneath it.
    let realm = ri(args.virtualNetwork.unresolveURL(realmURL.href));
    let inRealm = (recorded: string) =>
      args.virtualNetwork.toURLHref(recorded) === realmURL.href;
    let [allStorage, automationRow, charges] = await Promise.all([
      getAutomationStorage(args.dbAdapter, automationId),
      getAutomation(args.dbAdapter, automationId),
      storageCharges(args.dbAdapter, automationId, realm),
    ]);
    let row =
      automationRow && inRealm(automationRow.realm) ? automationRow : undefined;
    let files = allStorage.files.filter((file) => inRealm(file.realmURL));
    let storage = {
      files,
      fileBytes: files.reduce((sum, file) => sum + file.fileBytes, 0),
      indexBytes: files.reduce((sum, file) => sum + file.indexBytes, 0),
    };
    let payer = row
      ? await shownIdentity(args.dbAdapter, caller, row.payer)
      : null;
    let pricing = currentPricing();
    let dailyCredits = pricing
      ? exactMeteredCredits(
          {
            file_storage_gb_months:
              storage.fileBytes / BYTES_PER_GB / DAYS_PER_AVERAGE_MONTH,
            database_storage_gb_months:
              storage.indexBytes / BYTES_PER_GB / DAYS_PER_AVERAGE_MONTH,
          },
          pricing,
        )
      : null;
    await sendJSON(ctxt, 200, {
      data: {
        type: AUTOMATION_STORAGE_RESOURCE_TYPE,
        id: args.virtualNetwork.toURLHref(automationId),
        attributes: {
          switchedOn: row !== undefined,
          payer,
          viewerIsPayer: row?.payer === caller,
          files: storage.files.map((file) => ({
            path: file.path,
            run: file.runId,
            createdAt: file.createdAt,
            fileBytes: file.fileBytes,
            indexBytes: file.indexBytes,
          })),
          fileBytes: storage.fileBytes,
          indexBytes: storage.indexBytes,
          dailyCredits,
          pricingVersion: pricing?.version ?? null,
          charges,
        },
      },
    });
  });
}
