import {
  RUN_STATE_PATH,
  RUN_STATE_POLL_MS,
} from '@cardstack/runtime-common/automation-run-command';

// What an automation run's script is stopped with when its run stops running
// under it: a person canceled the run, a pause or remove canceled it, it
// ended at a cap, or a newer attempt took it over.
export class AutomationRunStoppedError extends Error {
  constructor() {
    super('The automation run stopped running, so its script was stopped');
    this.name = 'AutomationRunStoppedError';
  }
}

// Asks the run's realm, every `RUN_STATE_POLL_MS`, whether the run is still
// running (`RUN_STATE_PATH`, with the run's token), and aborts `signal` with
// an `AutomationRunStoppedError` once the realm answers 401: the realm admits
// a run's calls only while its row says it is running under this attempt, so
// a 401 means the run can make no more calls and its script is stopped. A
// script that makes no calls of its own is stopped this way too.
//
// Any other answer, a request that fails, or one that doesn't answer within
// the interval is not a stop: the next ask goes as usual, and the run's time
// limit still bounds the script. One ask is in flight at a time.
export class RunStateWatch {
  #controller = new AbortController();
  #timer: ReturnType<typeof setTimeout> | undefined;
  #asking: AbortController | undefined;
  #stopped = false;
  #url: string;
  #runToken: string;
  #fetch: typeof globalThis.fetch;
  #intervalMs: number;

  constructor({
    realmURL,
    runToken,
    fetch = globalThis.fetch.bind(globalThis),
    intervalMs = RUN_STATE_POLL_MS,
  }: {
    realmURL: string;
    runToken: string;
    fetch?: typeof globalThis.fetch;
    intervalMs?: number;
  }) {
    this.#url = new URL(
      RUN_STATE_PATH.replace(/^\//, ''),
      realmURL.endsWith('/') ? realmURL : `${realmURL}/`,
    ).href;
    this.#runToken = runToken;
    this.#fetch = fetch;
    this.#intervalMs = intervalMs;
  }

  // Aborts once the run stops running; pass it to the script's run.
  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  start(): void {
    if (this.#stopped || this.#timer || this.#asking) {
      return;
    }
    this.#schedule();
  }

  // Stops asking. The signal stays as it is.
  stop(): void {
    this.#stopped = true;
    clearTimeout(this.#timer);
    this.#timer = undefined;
    this.#asking?.abort();
  }

  #schedule(): void {
    if (this.#stopped || this.#controller.signal.aborted) {
      return;
    }
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#ask().finally(() => this.#schedule());
    }, this.#intervalMs);
  }

  async #ask(): Promise<void> {
    let asking = new AbortController();
    this.#asking = asking;
    let timeout = setTimeout(() => asking.abort(), this.#intervalMs);
    try {
      let response = await this.#fetch(this.#url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.api+json',
          Authorization: `Bearer ${this.#runToken}`,
        },
        signal: asking.signal,
      });
      if (response.status === 401 && !this.#stopped) {
        this.#controller.abort(new AutomationRunStoppedError());
      }
    } catch {
      // Not a stop: the next ask goes as usual.
    } finally {
      clearTimeout(timeout);
      this.#asking = undefined;
    }
  }
}
