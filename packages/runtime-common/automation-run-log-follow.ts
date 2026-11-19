// Follows an automation run's log the way the console shows it, through the
// realm server's `GET /_automation-run-log`.
//
// The live lines are polled, not streamed. The `job` realm event says when a
// run starts, reaches a milestone and ends, and never carries log text, so it
// is the cue to start following and to read at once (`wake`). Between events
// the follower asks for the lines past the last page every `intervalMs` while
// the run is pending or running, and reads on at once while a page says the
// log holds more. The realm server writes the run's `finish` line just after
// the run's row ends, so once a page finds the run ended with nothing more to
// read, the follower reads once more an interval later, and then stops. A
// finished run's log is read the same way.

import {
  AUTOMATION_ROUTE_REALM_PARAM,
  AUTOMATION_RUN_LOG_AFTER_PARAM,
  AUTOMATION_RUN_LOG_LEVEL_PARAM,
  AUTOMATION_RUN_LOG_LIMIT_PARAM,
  AUTOMATION_RUN_LOG_PATH,
  AUTOMATION_RUN_LOG_RUN_PARAM,
  type AutomationRunLogDocument,
} from './automation-routes.ts';

// How often a follower asks for new lines while its run is pending or
// running and no `job` event wakes it sooner.
export const AUTOMATION_RUN_LOG_FOLLOW_INTERVAL_MS = 2000;

export type AutomationRunLogPage =
  AutomationRunLogDocument['data']['attributes'];

export class AutomationRunLogReadError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface AutomationRunLogFollower {
  // Reads at once, rather than at the next interval, while the run is pending
  // or running. Call it on each `job` realm event for the run. Once a page
  // finds the run ended, the last read waits its interval regardless.
  wake(): void;
  // Stops following. A page or failure of a read already in flight is not
  // handed on.
  stop(): void;
  // Settles once the follower stops: the run ended and its log was read to
  // the end, `stop` was called, or a read was refused (`onError` has the
  // refusal).
  done: Promise<void>;
}

// Builds the URL of one page of a run's log.
export function automationRunLogURL({
  realmServerURL,
  realm,
  runId,
  after,
  limit,
  levels,
}: {
  realmServerURL: string;
  realm: string;
  runId: string;
  after?: number;
  limit?: number;
  levels?: readonly string[];
}): string {
  let url = new URL(
    AUTOMATION_RUN_LOG_PATH.slice(1),
    ensureSlash(realmServerURL),
  );
  url.searchParams.set(AUTOMATION_ROUTE_REALM_PARAM, realm);
  url.searchParams.set(AUTOMATION_RUN_LOG_RUN_PARAM, runId);
  if (after !== undefined) {
    url.searchParams.set(AUTOMATION_RUN_LOG_AFTER_PARAM, String(after));
  }
  if (limit !== undefined) {
    url.searchParams.set(AUTOMATION_RUN_LOG_LIMIT_PARAM, String(limit));
  }
  if (levels && levels.length > 0) {
    url.searchParams.set(AUTOMATION_RUN_LOG_LEVEL_PARAM, levels.join(','));
  }
  return url.href;
}

export function followAutomationRunLog({
  fetch,
  realmServerURL,
  realm,
  runId,
  levels,
  limit,
  intervalMs = AUTOMATION_RUN_LOG_FOLLOW_INTERVAL_MS,
  onPage,
  onError,
}: {
  // A fetch that carries the viewer's realm-server session.
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  realmServerURL: string;
  realm: string;
  runId: string;
  levels?: readonly string[];
  limit?: number;
  intervalMs?: number;
  // Each page read, in order, including one with no lines (it carries the
  // run's state).
  onPage: (page: AutomationRunLogPage) => void;
  // A read that failed. A refusal (a 4xx) stops the follower; any other
  // failure is tried again at the next interval.
  onError?: (error: Error) => void;
}): AutomationRunLogFollower {
  let after = -1;
  let stopped = false;
  let endedReads = 0;
  // Ends the wait in progress early: `wake` sets it for a wait a wake may
  // end, `stop` for any wait.
  let wakeUp: (() => void) | undefined;
  let cancelWait: (() => void) | undefined;
  // A wake that came while no wait was in progress, which the next wait a
  // wake may end takes up at once.
  let woken = false;

  // Waits an interval. `wakeable` lets a wake end it early; the wait after
  // the run has ended is not wakeable, so the realm server has the interval
  // to write the run's last lines.
  let wait = (wakeable: boolean) =>
    new Promise<void>((resolve) => {
      if (stopped || (wakeable && woken)) {
        woken = false;
        resolve();
        return;
      }
      let timer = setTimeout(finish, intervalMs);
      function finish() {
        clearTimeout(timer);
        wakeUp = undefined;
        cancelWait = undefined;
        if (wakeable) {
          woken = false;
        }
        resolve();
      }
      cancelWait = finish;
      wakeUp = wakeable ? finish : undefined;
    });

  let readPage = async (): Promise<AutomationRunLogPage> => {
    let response = await fetch(
      automationRunLogURL({
        realmServerURL,
        realm,
        runId,
        after,
        limit,
        levels,
      }),
      { headers: { Accept: 'application/vnd.api+json' } },
    );
    let text = await response.text();
    if (!response.ok) {
      throw new AutomationRunLogReadError(
        response.status,
        `reading run ${runId}'s log answered ${response.status}: ${text}`,
      );
    }
    return (JSON.parse(text) as AutomationRunLogDocument).data.attributes;
  };

  let loop = async () => {
    while (!stopped) {
      let page: AutomationRunLogPage;
      try {
        page = await readPage();
      } catch (error) {
        if (stopped) {
          return;
        }
        let failure = error instanceof Error ? error : new Error(String(error));
        onError?.(failure);
        if (
          failure instanceof AutomationRunLogReadError &&
          failure.status >= 400 &&
          failure.status < 500
        ) {
          return;
        }
        await wait(true);
        continue;
      }
      if (stopped) {
        return;
      }
      after = page.next;
      onPage(page);
      if (page.more) {
        continue;
      }
      let ended = page.state !== 'pending' && page.state !== 'running';
      if (ended) {
        endedReads++;
        if (endedReads > 1) {
          return;
        }
      }
      await wait(!ended);
    }
  };

  let done = loop();
  return {
    wake() {
      if (wakeUp) {
        wakeUp();
      } else {
        woken = true;
      }
    },
    stop() {
      stopped = true;
      cancelWait?.();
    },
    done,
  };
}

function ensureSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}
