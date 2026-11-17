import type Koa from 'koa';
import {
  getAutomationRun,
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
  startAutomationPreview,
  startAutomationRunNow,
  type ManualRunStart,
} from '@cardstack/runtime-common/automation-manual-runs';
import { readRunDeclaration } from '@cardstack/runtime-common/automation-run-limits';
import type { AutomationDeclaration } from '@cardstack/runtime-common/automation-declaration';
import {
  AUTOMATION_ESTIMATE_RESOURCE_TYPE,
  AUTOMATION_RESOURCE_TYPE,
  AUTOMATION_ROUTE_AUTOMATION_PARAM,
  AUTOMATION_ROUTE_REALM_PARAM,
  AUTOMATION_RUN_RESOURCE_TYPE,
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

// A run's id, a UUID. Anything else names no run.
const RUN_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
// switching the automation on is likely to cost a month, and the monthly
// credit cap the card sets, which a switch-on agrees to. 503 while this
// process has no prices.
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
    await sendJSON(ctxt, 200, {
      data: {
        type: AUTOMATION_ESTIMATE_RESOURCE_TYPE,
        id: args.virtualNetwork.toURLHref(automationId),
        attributes: {
          switchedOn: row !== undefined,
          monthlyCredits: declaration.caps.monthlyCredits,
          estimate,
        },
      },
    });
  });
}

// `POST /_automation-switch-on`: switches the automation on for the caller,
// who becomes its payer, with the card's caps as the snapshot. The body's
// `monthlyCredits` must be the card's monthly credit cap.
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
    let change = await switchOnAutomation(
      args.dbAdapter,
      {
        automationId,
        realm: ri(args.virtualNetwork.unresolveURL(realmURL.href)),
        user: caller,
        declaration,
      },
      actorOptions(args),
    );
    let estimate = change.ok
      ? await estimateFor(
          args,
          declaration,
          automationId,
          caller,
          change.automation,
        )
      : undefined;
    await answerChange(
      ctxt,
      args,
      change,
      caller,
      201,
      estimate ? { estimate } : undefined,
    );
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
// at switch-on.
export function handleAutomationResume(args: CreateRoutesArgs): Handler {
  return automationHandler(async (ctxt) => {
    let { caller, realmURL, automationId, attributes } =
      await automationRequest(ctxt, args);
    let declaration = await declarationOf(args, automationId, realmURL);
    agreedMonthlyCap(attributes, declaration);
    let change = await resumeAutomation(
      args.dbAdapter,
      { automationId, user: caller, declaration },
      actorOptions(args),
    );
    await answerChange(ctxt, args, change, caller);
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
    let seen = RUN_ID.test(id)
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
