// An automation's runs, newest first, a page at a time, for the realm's
// direct writers: what the Automation card's isolated view lists under Runs.
// A run is listed from the moment a trigger, a Preview or a Run now makes
// the run, while the run waits in the queue, runs, and once the run has
// ended. Each run says what
// started it (one of the card's triggers, a Preview or a Run now), where it
// is, how it ended and why, who canceled it, and which later trigger slots
// joined it while it waited (the slots the tick reports as skipped).
//
// Who a run acts as and who canceled it are Matrix ids, so they follow ADR 011
// §1.2 like the payer on `_automation-status` (see `automation-identities.ts`).

import { MANUAL_RUN_TRIGGER } from './automation-declaration.ts';
import {
  shownIdentity,
  withHiddenIdentities,
} from './automation-identities.ts';
import { scriptErrorLine } from './automation-run-command.ts';
import {
  automationRunStep,
  type AutomationRunStep,
} from './automation-run-events.ts';
import {
  readRunMilestonesFor,
  type RunMilestones,
} from './automation-run-milestones.ts';
import {
  capInErrorText,
  HIT_A_CAP_REASON,
  listActiveRuns,
  listAutomationRuns,
  type AutomationRun,
  type AutomationRunState,
} from './automation-runs.ts';
import type { DBAdapter } from './db.ts';
import { isDirectWriter } from './db-queries/realm-permission-queries.ts';
import {
  addExplicitParens,
  dbAdapterQuerier,
  param,
  separatedByCommas,
  type Expression,
  type Querier,
} from './expression.ts';
import { RealmPaths } from './paths.ts';
import type { VirtualNetwork } from './virtual-network.ts';

export const AUTOMATION_RUN_LIST_PATH = '_automation-runs';
export const AUTOMATION_RUN_LIST_AUTOMATION_PARAM = 'automation';
export const AUTOMATION_RUN_LIST_PAGE_PARAM = 'page';
export const AUTOMATION_RUN_LIST_LIMIT_PARAM = 'limit';
export const AUTOMATION_RUN_LIST_ITEM_TYPE = 'automation-run-item';

// The runs a page holds when the caller names no limit, and the most it may
// ask for.
export const AUTOMATION_RUN_LIST_DEFAULT_LIMIT = 20;
export const AUTOMATION_RUN_LIST_MAX_LIMIT = 100;

// A later slot of one of the card's schedules that joined a pending
// scheduled run, rather than starting a run of its own. The tick joins any
// due trigger's slot to the automation's latest pending scheduled run from an
// earlier instant, so the slot's trigger can differ from the run's.
export interface AutomationRunJoinedSlot {
  trigger: string;
  // The slot's scheduled instant, as an ISO time.
  slot: string;
  // When the tick joined it, as an ISO time.
  at: string;
}

export interface AutomationRunItemAttributes {
  // What started the run: one of the card's triggers, or a direct writer's
  // Preview or Run now.
  startedBy: 'trigger' | 'preview' | 'run-now';
  // The label of the trigger that started the run; null for a Preview or Run
  // now. A trigger the card no longer declares keeps the label it had.
  trigger: string | null;
  // The slot the trigger fired for: a cron or one-time trigger's scheduled
  // instant as an ISO time, or a webhook delivery's id. Null for a Preview or
  // Run now.
  slot: string | null;
  state: AutomationRunState;
  // The step the run is in, or for an ended run the step it got to: an error
  // at `admission` is a run that never started its script. Null for a run
  // no attempt has started: one still waiting, or one that ended before any
  // attempt started it, such as one a pause canceled.
  step: AutomationRunStep | null;
  // For an error, its code (`script-error`, `timed-out`, `hit-a-cap`, an
  // admission refusal such as `insufficient-credits`, …). For a run a pause
  // canceled without a person asking, the pause's reason.
  errorReason: string | null;
  // The error's detail, with any Matrix id the viewer may not see replaced by
  // "someone". For a `script-error`, the script's own message without its
  // line, which `scriptLine` holds.
  errorMessage: string | null;
  // The line of the script a `script-error` points at, when known.
  scriptLine: number | null;
  // The cap a `hit-a-cap` run reached, by the caps' own names (`writes`,
  // `aiCredits`, …), read from the message `capErrorText` wrote.
  cap: string | null;
  // Who canceled the run, when a person did and the viewer may see who;
  // `canceledByAPerson` and `viewerCanceled` say as much as the viewer may
  // know when the id is hidden.
  canceledBy: string | null;
  canceledByAPerson: boolean;
  viewerCanceled: boolean;
  // Who the run acts as, when the viewer may see who.
  actsAs: string | null;
  viewerIsActsAs: boolean;
  // ISO times: when the run was made, first started, and ended.
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  // The later slots that joined the run, in the order they joined, each
  // naming its own trigger.
  joined: AutomationRunJoinedSlot[];
  // The milestones the run's script planned and reached: the one a running
  // run is in, and the one a failed run failed in (see
  // `automation-run-milestones.ts`).
  milestones: RunMilestones | null;
  // For a run still waiting for its first attempt, what the run waits for:
  // the automation's running run, since an automation's runs go one at a
  // time, or, with none running, a worker to start the run. Null for a run
  // that isn't waiting.
  waitingFor: AutomationRunWaitingFor | null;
}

export type AutomationRunWaitingFor =
  | {
      kind: 'run';
      // The automation's running run, as the list names a run.
      runId: string;
      startedBy: AutomationRunItemAttributes['startedBy'];
      trigger: string | null;
      slot: string | null;
      state: 'running';
    }
  | { kind: 'worker' };

export interface AutomationRunItem {
  type: typeof AUTOMATION_RUN_LIST_ITEM_TYPE;
  // The run's id.
  id: string;
  attributes: AutomationRunItemAttributes;
}

export interface AutomationRunListDocument {
  data: AutomationRunItem[];
  meta: {
    directWriter: true;
    // The page this is, counting from 1; how many pages the runs fill (at
    // least 1, so an automation with no runs has one empty page); and how
    // many runs there are in all.
    page: number;
    pages: number;
    total: number;
  };
}

export interface AutomationRunListNotDirectWriterDocument {
  data: [];
  meta: { directWriter: false };
}

export type AutomationRunListAnswer =
  | {
      status: 200;
      document:
        | AutomationRunListDocument
        | AutomationRunListNotDirectWriterDocument;
    }
  | { status: 400; message: string };

// Answers `GET <realm>/_automation-runs?automation=<card URL>` for `viewer`,
// one page at a time (`page`, `limit`). Only a direct writer of the realm is
// listed the runs, as only a direct writer is shown the automation's row. Any
// other caller the realm ACL lets read is told it isn't a direct writer and
// listed nothing, rather than refused, for the reason `answerAutomationStatus`
// gives: a 401 or 403 back through `authedFetch` fails the loads in flight
// wherever an auth-error guard listens. A caller only a policy grant admits
// gets the ACL's refusal, since the route is `ACL_ONLY`.
export async function answerAutomationRunList({
  dbAdapter,
  realmURL,
  matrixServerName,
  virtualNetwork,
  viewer,
  automation,
  page,
  limit,
}: {
  dbAdapter: DBAdapter;
  realmURL: URL;
  matrixServerName: string;
  virtualNetwork: VirtualNetwork;
  // The Matrix id the request was authenticated as, if any.
  viewer: string | undefined;
  // The query parameters.
  automation: string | null;
  page: string | null;
  limit: string | null;
}): Promise<AutomationRunListAnswer> {
  if (
    !viewer ||
    !(await isDirectWriter(dbAdapter, realmURL, viewer, matrixServerName))
  ) {
    return {
      status: 200,
      document: { data: [], meta: { directWriter: false } },
    };
  }
  let url: URL;
  try {
    url = new URL(automation ?? '');
  } catch {
    return {
      status: 400,
      message: `name the automation card by its URL in the "${AUTOMATION_RUN_LIST_AUTOMATION_PARAM}" query parameter`,
    };
  }
  if (!new RealmPaths(realmURL).inRealm(url)) {
    return { status: 400, message: `${url.href} is not in ${realmURL.href}` };
  }
  let pageSize = AUTOMATION_RUN_LIST_DEFAULT_LIMIT;
  if (limit !== null) {
    pageSize = Number(limit);
    if (
      !/^\d+$/.test(limit) ||
      pageSize < 1 ||
      pageSize > AUTOMATION_RUN_LIST_MAX_LIMIT
    ) {
      return {
        status: 400,
        message: `"${AUTOMATION_RUN_LIST_LIMIT_PARAM}" must be a whole number from 1 to ${AUTOMATION_RUN_LIST_MAX_LIMIT}`,
      };
    }
  }

  let pageNumber = 1;
  if (page !== null) {
    pageNumber = Number(page);
    if (
      !/^\d+$/.test(page) ||
      pageNumber < 1 ||
      !Number.isSafeInteger((pageNumber - 1) * pageSize)
    ) {
      return {
        status: 400,
        message: `"${AUTOMATION_RUN_LIST_PAGE_PARAM}" must be a whole number from 1`,
      };
    }
  }

  let querier = dbAdapterQuerier(dbAdapter);
  let { runs, total } = await listAutomationRuns(
    querier,
    virtualNetwork.unresolveURL(url.href),
    { page: pageNumber, limit: pageSize },
  );
  let joined = await readJoinedSlots(
    querier,
    runs.map((run) => run.id),
  );
  let milestones = await readRunMilestonesFor(
    dbAdapter,
    runs.map((run) => run.id),
  );
  let running = runs.some((run) => run.state === 'pending')
    ? (await listActiveRuns(querier, runs[0].automationId)).find(
        (run) => run.state === 'running',
      )
    : undefined;
  // Each person a page names is looked up once, however many runs name them.
  let shown = new Map<string, Promise<string | null>>();
  let show = (person: string | null) => {
    if (person === null) {
      return Promise.resolve(null);
    }
    let known = shown.get(person);
    if (!known) {
      known = shownIdentity(dbAdapter, viewer, person);
      shown.set(person, known);
    }
    return known;
  };
  let data = await Promise.all(
    runs.map(
      async (run): Promise<AutomationRunItem> => ({
        type: AUTOMATION_RUN_LIST_ITEM_TYPE,
        id: run.id,
        attributes: {
          ...startedBy(run),
          state: run.state,
          step: automationRunStep(run),
          errorReason: run.errorReason,
          ...(await shownError(dbAdapter, viewer, run, show)),
          canceledBy: await show(run.canceledBy),
          canceledByAPerson: run.canceledBy !== null,
          viewerCanceled: run.canceledBy === viewer,
          actsAs: await show(run.actsAs),
          viewerIsActsAs: run.actsAs === viewer,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
          joined: joined.get(run.id) ?? [],
          milestones: milestones.get(run.id) ?? null,
          waitingFor: waitingFor(run, running),
        },
      }),
    ),
  );
  return {
    status: 200,
    document: {
      data,
      meta: {
        directWriter: true,
        page: pageNumber,
        pages: Math.max(1, Math.ceil(total / pageSize)),
        total,
      },
    },
  };
}

function startedBy(
  run: AutomationRun,
): Pick<AutomationRunItemAttributes, 'startedBy' | 'trigger' | 'slot'> {
  if (run.trigger === MANUAL_RUN_TRIGGER) {
    // A Preview's or Run now's slot is the click's id, which means nothing
    // to a person.
    return {
      startedBy: run.dryRun ? 'preview' : 'run-now',
      trigger: null,
      slot: null,
    };
  }
  return { startedBy: 'trigger', trigger: run.trigger, slot: run.slot };
}

async function shownError(
  dbAdapter: DBAdapter,
  viewer: string,
  run: AutomationRun,
  show: (person: string) => Promise<string | null>,
): Promise<
  Pick<AutomationRunItemAttributes, 'errorMessage' | 'scriptLine' | 'cap'>
> {
  let message = await withHiddenIdentities(
    dbAdapter,
    viewer,
    run.errorMessage,
    show,
  );
  if (message === null) {
    return { errorMessage: null, scriptLine: null, cap: null };
  }
  switch (run.errorReason) {
    case 'script-error': {
      let { line, message: text } = scriptErrorLine(message);
      return { errorMessage: text, scriptLine: line ?? null, cap: null };
    }
    case HIT_A_CAP_REASON:
      return {
        errorMessage: message,
        scriptLine: null,
        cap: capInErrorText(message),
      };
    default:
      return { errorMessage: message, scriptLine: null, cap: null };
  }
}

function iso(value: unknown): string {
  let date = value instanceof Date ? value : new Date(String(value));
  return date.toISOString();
}

// The slots that joined each run, from the `trigger` lines the tick writes on
// a pending run when a later slot of any trigger joins it (`data.skipped`).
// A line the log's cap refused leaves its slot out.
async function readJoinedSlots(
  querier: Querier,
  runIds: string[],
): Promise<Map<string, AutomationRunJoinedSlot[]>> {
  let joined = new Map<string, AutomationRunJoinedSlot[]>();
  if (runIds.length === 0) {
    return joined;
  }
  let rows = (await querier([
    'SELECT run_id, at, data FROM automation_run_log WHERE run_id IN',
    ...(addExplicitParens(
      separatedByCommas(runIds.map((id) => [param(id)])),
    ) as Expression),
    "AND kind = 'trigger' ORDER BY run_id, seq",
  ] as Expression)) as { run_id: string; at: unknown; data: unknown }[];
  for (let row of rows) {
    let data = (
      typeof row.data === 'string' ? JSON.parse(row.data) : row.data
    ) as Record<string, unknown> | null;
    if (
      data?.skipped !== true ||
      typeof data.trigger !== 'string' ||
      typeof data.slot !== 'string'
    ) {
      continue;
    }
    let list = joined.get(row.run_id) ?? [];
    list.push({ trigger: data.trigger, slot: data.slot, at: iso(row.at) });
    joined.set(row.run_id, list);
  }
  return joined;
}

// What a waiting run waits for: the automation's running run, since an
// automation's runs go one at a time, or, with none running, a Boxel worker.
// The queue orders an automation's waiting runs by their jobs, which a
// re-queued job can put behind newer runs, so only the running run is named.
function waitingFor(
  run: AutomationRun,
  running: AutomationRun | undefined,
): AutomationRunWaitingFor | null {
  if (run.state !== 'pending') {
    return null;
  }
  if (!running) {
    return { kind: 'worker' };
  }
  return {
    kind: 'run',
    runId: running.id,
    ...startedBy(running),
    state: 'running',
  };
}
