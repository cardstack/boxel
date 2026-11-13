import {
  RUN_LOG_MAX_BATCH_LINES,
  RUN_LOG_PATH,
} from '@cardstack/runtime-common/automation-run-log';

import type { FlushableRunProgressSink, RunProgressEvent } from './automation';

// How long a recorded event waits before it is sent with the events after it.
export const RUN_LOG_FLUSH_INTERVAL_MS = 1000;

// Events that wait for the next send at most. Past it, the oldest are dropped
// and the next send says how many: a realm server that stops answering must
// not fill a tab other runs share.
export const RUN_LOG_MAX_PENDING = 5000;

// Sends an automation run's progress to its run log: the realm's
// `RUN_LOG_PATH`, with the run's token, in batches of at most
// `RUN_LOG_MAX_BATCH_LINES` events. A batch goes once that many are waiting
// or `RUN_LOG_FLUSH_INTERVAL_MS` after the first of them, so the console
// shows a run's lines while it runs. Batches are sent one at a time, in
// order.
//
// The log never fails the run: a batch the realm refuses (the run has
// stopped running, say) or can't be reached for is reported to `onError` and
// dropped. The events reaching it are already redacted by
// `runAutomationScript`, and the realm server redacts them again.
export class RunLogSink implements FlushableRunProgressSink {
  #pending: RunProgressEvent[] = [];
  #dropped = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #sending: Promise<void> = Promise.resolve();
  #url: string;
  #runToken: string;
  #fetch: typeof globalThis.fetch;
  #onError: (message: string) => void;

  constructor({
    realmURL,
    runToken,
    fetch = globalThis.fetch.bind(globalThis),
    onError = (message) => console.warn(message),
  }: {
    realmURL: string;
    runToken: string;
    fetch?: typeof globalThis.fetch;
    onError?: (message: string) => void;
  }) {
    this.#url = new URL(
      RUN_LOG_PATH.replace(/^\//, ''),
      realmURL.endsWith('/') ? realmURL : `${realmURL}/`,
    ).href;
    this.#runToken = runToken;
    this.#fetch = fetch;
    this.#onError = onError;
  }

  record(event: RunProgressEvent): void {
    this.#pending.push(event);
    if (this.#pending.length > RUN_LOG_MAX_PENDING) {
      this.#pending.shift();
      this.#dropped++;
    }
    if (this.#pending.length >= RUN_LOG_MAX_BATCH_LINES) {
      this.#send();
    } else if (!this.#timer) {
      this.#timer = setTimeout(() => this.#send(), RUN_LOG_FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    while (this.#pending.length > 0 || this.#dropped > 0) {
      this.#send();
    }
    await this.#sending;
  }

  #send(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    let events = this.#pending.splice(0, RUN_LOG_MAX_BATCH_LINES);
    if (this.#dropped > 0 && events.length < RUN_LOG_MAX_BATCH_LINES) {
      events.push({
        kind: 'console',
        at: Date.now(),
        level: 'warn',
        message: `${this.#dropped} log lines were dropped while the run's log could not keep up`,
      });
      this.#dropped = 0;
    }
    if (events.length === 0) {
      return;
    }
    this.#sending = this.#sending.then(() => this.#post(events));
  }

  async #post(events: RunProgressEvent[]): Promise<void> {
    try {
      let response = await this.#fetch(this.#url, {
        method: 'POST',
        headers: {
          Accept: 'application/vnd.api+json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#runToken}`,
        },
        body: JSON.stringify({ events }),
      });
      if (!response.ok) {
        this.#onError(
          `The run's log refused ${events.length} lines (${response.status}): ${await response.text().catch(() => '')}`,
        );
      }
    } catch (error) {
      this.#onError(
        `${events.length} lines could not reach the run's log: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
