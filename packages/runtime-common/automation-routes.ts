// The realm server's routes for a direct writer to switch an automation on,
// start a Preview or a Run now, pause, resume or remove it, cancel one of its
// runs, read a run's log, and read what the console shows: a run's report, a
// Preview's staged file and the automation's storage. Each is an
// authenticated realm-server route: it acts as the
// session's own user, never as a user a header names (ADR 006), and answers
// only a direct writer of the realm the request names.
//
// Every request names the realm and the automation card (or the run), and
// the route checks the caller's direct write on that realm before it reads
// anything else, so a caller who isn't a direct writer learns nothing about
// the realm's automations or runs.

import type { StoredRunLogLine } from './automation-run-log.ts';

export const AUTOMATION_SWITCH_ON_PATH = '/_automation-switch-on';
export const AUTOMATION_PREVIEW_PATH = '/_automation-preview';
export const AUTOMATION_RUN_NOW_PATH = '/_automation-run-now';
export const AUTOMATION_PAUSE_PATH = '/_automation-pause';
export const AUTOMATION_RESUME_PATH = '/_automation-resume';
export const AUTOMATION_REMOVE_PATH = '/_automation-remove';
export const AUTOMATION_RUN_CANCEL_PATH = '/_automation-run-cancel';
export const AUTOMATION_RUN_LOG_PATH = '/_automation-run-log';

// What the console reads, each a GET a direct writer of the realm makes:
//
// - `/_automation-run-report?realm=&run=`: one run's timings, milestones, a
//   count of its log's lines, its `callApi` and `resolve` calls, the files
//   it staged or saved, and its cost by kind. The log's lines themselves are
//   read from `/_automation-run-log`.
// - `/_automation-preview-file?realm=&run=&path=`: the bytes of one file a
//   complete Preview staged, by its realm-local path.
// - `/_automation-storage?realm=&automation=`: every file the automation's
//   runs created that still exists, its size on disk and in the index, what
//   a day of that storage costs, and the storage charges written so far.
//
// A person's Matrix id in an answer (who a run acts as, who canceled it, who
// pays) is shown only to that person, or to a viewer who shares a named realm
// grant with them (ADR 011 §1.2). Anyone else sees null.
export const AUTOMATION_RUN_REPORT_PATH = '/_automation-run-report';
export const AUTOMATION_PREVIEW_FILE_PATH = '/_automation-preview-file';
export const AUTOMATION_STORAGE_PATH = '/_automation-storage';

// `GET /_automation-notices`: every automation notice for the session's own
// user, across the realms the user writes directly, for the app's badges.
// Each resource's `id` is the automation card's URL, and its attributes are
// the realm's URL (`realm`) and the notice (`AutomationNotice` in
// `automation-notices.ts`). Only notices the user is someone they are for
// are listed; `meta.total` counts them.
export const AUTOMATION_NOTICES_PATH = '/_automation-notices';

// The query parameters of the GET routes: `GET /_automation-switch-on`, which
// answers the estimate the switch-on screen shows, and the console's reads.
export const AUTOMATION_ROUTE_REALM_PARAM = 'realm';
export const AUTOMATION_ROUTE_AUTOMATION_PARAM = 'automation';
export const AUTOMATION_ROUTE_RUN_PARAM = 'run';
export const AUTOMATION_ROUTE_PATH_PARAM = 'path';

export const AUTOMATION_RESOURCE_TYPE = 'automation';
export const AUTOMATION_RUN_RESOURCE_TYPE = 'automation-run';
export const AUTOMATION_ESTIMATE_RESOURCE_TYPE = 'automation-estimate';
export const AUTOMATION_RUN_REPORT_RESOURCE_TYPE = 'automation-run-report';
export const AUTOMATION_STORAGE_RESOURCE_TYPE = 'automation-storage';
export const AUTOMATION_RUN_LOG_RESOURCE_TYPE = 'automation-run-log';
export const AUTOMATION_NOTICE_RESOURCE_TYPE = 'automation-notice';

// The query parameters of `GET /_automation-run-log`, besides `realm`:
//
// - `run`: the run's id.
// - `after`: the `seq` the page starts past; absent or -1 reads from the
//   start. A page's `next` is the `after` that reads on from it.
// - `limit`: the most lines a page holds, `AUTOMATION_RUN_LOG_DEFAULT_LIMIT`
//   when absent, and at most `AUTOMATION_RUN_LOG_MAX_LIMIT`.
// - `level`: the levels to keep, comma-separated (`log`, `info`, `warn`,
//   `error`); absent keeps every line. A line with no level is `info` here.
export const AUTOMATION_RUN_LOG_RUN_PARAM = 'run';
export const AUTOMATION_RUN_LOG_AFTER_PARAM = 'after';
export const AUTOMATION_RUN_LOG_LIMIT_PARAM = 'limit';
export const AUTOMATION_RUN_LOG_LEVEL_PARAM = 'level';
export const AUTOMATION_RUN_LOG_DEFAULT_LIMIT = 500;
export const AUTOMATION_RUN_LOG_MAX_LIMIT = 1000;

// The body of a request about an automation: the card by its URL, in the
// realm named by `attributes.realm`.
//
// - switch-on and resume: `monthlyCredits` is the monthly credit cap the
//   caller agrees to pay up to. It must be the card's own
//   `caps.monthlyCredits`, so the monthly cap the caller confirmed is the one
//   the automation's caps snapshot holds. A card whose monthly cap changed
//   since the caller read it is refused, and the caller reads the estimate
//   again. Only the monthly cap is compared: the rest of the snapshot (the
//   triggers' timing, the per-run and daily caps, `batchedAI`) is taken from
//   the card as it is when the route reads it, and spending stays within the
//   confirmed monthly cap whatever they say.
// - Preview and Run now: `click` is a fresh id per click. Sending the same
//   click again answers the run it started rather than starting another.
export interface AutomationRequestBody {
  data: {
    type: typeof AUTOMATION_RESOURCE_TYPE;
    id: string;
    attributes: {
      realm: string;
      monthlyCredits?: number;
      click?: string;
    };
  };
}

// The body of a request to cancel a run: the run by its id, in the realm
// named by `attributes.realm`.
export interface AutomationRunCancelBody {
  data: {
    type: typeof AUTOMATION_RUN_RESOURCE_TYPE;
    id: string;
    attributes: { realm: string };
  };
}

// The answer to `GET /_automation-run-log`: one page of a run's log, with the
// run's state as the page was read. `dropped` counts the lines the run's cap
// refused, which the console shows beside the log; no line of the page
// stands for them.
export interface AutomationRunLogDocument {
  data: {
    type: typeof AUTOMATION_RUN_LOG_RESOURCE_TYPE;
    id: string;
    attributes: {
      state: 'pending' | 'running' | 'complete' | 'error' | 'canceled';
      lines: AutomationRunLogLine[];
      next: number;
      more: boolean;
      total: number;
      dropped: number;
    };
  };
}

export type AutomationRunLogLine = StoredRunLogLine;
