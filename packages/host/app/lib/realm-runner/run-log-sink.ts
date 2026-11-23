import {
  RUN_LOG_MAX_BATCH_LINES,
  RUN_LOG_MAX_REQUEST_BYTES,
  RUN_LOG_PATH,
} from '@cardstack/runtime-common/automation-run-log';

import type { FlushableRunProgressSink, RunProgressEvent } from './automation';

// How long a recorded event waits before it is sent with the events after it.
export const RUN_LOG_FLUSH_INTERVAL_MS = 1000;

// How long one send may take before it is given up on.
export const RUN_LOG_SEND_TIMEOUT_MS = 10_000;

// Events waiting to be sent at most, besides the batch in flight. Past it,
// the oldest waiting are dropped and the next batch says how many: a realm
// server that answers slowly must not fill a tab other runs share.
export const RUN_LOG_MAX_PENDING = 5000;

// The most encoded bytes of events one batch carries. The realm refuses a
// request body past `RUN_LOG_MAX_REQUEST_BYTES`, which counts bytes, so text
// outside ASCII fills a batch before its line count does. The headroom covers
// the body's envelope and the dropped-lines line.
export const RUN_LOG_MAX_BATCH_BYTES = RUN_LOG_MAX_REQUEST_BYTES - 4096;

const encoder = new TextEncoder();

// An event's share of a batch's body: its JSON and the comma after it.
function encodedSize(event: RunProgressEvent): number {
  return encoder.encode(JSON.stringify(event)).length + 1;
}

// Sends an automation run's progress to its run log: the realm's
// `RUN_LOG_PATH`, with the run's token, in batches of at most
// `RUN_LOG_MAX_BATCH_LINES` events and `RUN_LOG_MAX_BATCH_BYTES` encoded
// bytes. A batch goes once either is reached or `RUN_LOG_FLUSH_INTERVAL_MS`
// after the first of its events, so the console shows a run's lines while it
// runs. An event bigger than a batch on its own goes alone. One batch is sent at a time, in order,
// and each send is given up on after `RUN_LOG_SEND_TIMEOUT_MS`.
//
// The log never fails or stalls the run: a batch the realm refuses (the run
// has stopped running, say), can't be reached for, or doesn't answer in time
// is reported to `onError` and dropped, so `flush` always settles. The events
// reaching it are already redacted by `runAutomationScript`, and the realm
// server redacts them again.
export class RunLogSink implements FlushableRunProgressSink {
  #pending: { event: RunProgressEvent; bytes: number }[] = [];
  #pendingBytes = 0;
  #dropped = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  // The send in flight, if any.
  #sending: Promise<void> | undefined;
  #url: string;
  #runToken: string;
  #fetch: typeof globalThis.fetch;
  #onError: (message: string) => void;
  #timeoutMs: number;
  // The realm refused a batch that carried tasks as a body it can't read: a
  // realm server that predates tasks, reached while a deploy rolls out. The
  // run's later batches leave their tasks out, so the rest of the log lands.
  #tasksRefused = false;

  constructor({
    realmURL,
    runToken,
    fetch = globalThis.fetch.bind(globalThis),
    onError = (message) => console.warn(message),
    timeoutMs = RUN_LOG_SEND_TIMEOUT_MS,
  }: {
    realmURL: string;
    runToken: string;
    fetch?: typeof globalThis.fetch;
    onError?: (message: string) => void;
    timeoutMs?: number;
  }) {
    this.#url = new URL(
      RUN_LOG_PATH.replace(/^\//, ''),
      realmURL.endsWith('/') ? realmURL : `${realmURL}/`,
    ).href;
    this.#runToken = runToken;
    this.#fetch = fetch;
    this.#onError = onError;
    this.#timeoutMs = timeoutMs;
  }

  record(event: RunProgressEvent): void {
    let bytes = encodedSize(event);
    this.#pending.push({ event, bytes });
    this.#pendingBytes += bytes;
    if (this.#pending.length > RUN_LOG_MAX_PENDING) {
      this.#pendingBytes -= this.#pending.shift()!.bytes;
      this.#dropped++;
    }
    if (this.#batchIsFull()) {
      this.#sendNext();
    } else if (!this.#timer && !this.#sending) {
      this.#timer = setTimeout(
        () => this.#sendNext(),
        RUN_LOG_FLUSH_INTERVAL_MS,
      );
    }
  }

  // Resolves once every event recorded so far has been sent or given up on.
  async flush(): Promise<void> {
    while (this.#sending || this.#pending.length > 0 || this.#dropped > 0) {
      this.#sendNext();
      await this.#sending;
    }
  }

  #batchIsFull(): boolean {
    return (
      this.#pending.length >= RUN_LOG_MAX_BATCH_LINES ||
      this.#pendingBytes >= RUN_LOG_MAX_BATCH_BYTES
    );
  }

  // The waiting events that fit the next batch, oldest first, taken off the
  // queue. At least one, when any wait.
  #takeBatch(): RunProgressEvent[] {
    let count = 0;
    let bytes = 0;
    while (
      count < this.#pending.length &&
      count < RUN_LOG_MAX_BATCH_LINES &&
      (count === 0 ||
        bytes + this.#pending[count].bytes <= RUN_LOG_MAX_BATCH_BYTES)
    ) {
      bytes += this.#pending[count].bytes;
      count++;
    }
    this.#pendingBytes -= bytes;
    return this.#pending.splice(0, count).map(({ event }) => event);
  }

  // Starts the next batch unless one is in flight; the in-flight batch
  // starts the next when it settles.
  #sendNext(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    if (this.#sending) {
      return;
    }
    let events = this.#takeBatch();
    if (
      this.#dropped > 0 &&
      events.length < RUN_LOG_MAX_BATCH_LINES &&
      this.#pending.length === 0
    ) {
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
    this.#sending = this.#post(events).finally(() => {
      this.#sending = undefined;
      if (this.#batchIsFull()) {
        this.#sendNext();
      } else if (
        (this.#pending.length > 0 || this.#dropped > 0) &&
        !this.#timer
      ) {
        this.#timer = setTimeout(
          () => this.#sendNext(),
          RUN_LOG_FLUSH_INTERVAL_MS,
        );
      }
    });
  }

  async #post(batch: RunProgressEvent[]): Promise<void> {
    let events = this.#tasksRefused
      ? batch.filter((event) => event.kind !== 'task')
      : batch;
    if (events.length === 0) {
      return;
    }
    let controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    try {
      let send = (body: RunProgressEvent[]) =>
        this.#fetch(this.#url, {
          method: 'POST',
          headers: {
            Accept: 'application/vnd.api+json',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.#runToken}`,
          },
          body: JSON.stringify({ events: body }),
          signal: controller.signal,
        });
      let response = await send(events);
      if (
        response.status === 400 &&
        events.some((event) => event.kind === 'task')
      ) {
        this.#tasksRefused = true;
        events = events.filter((event) => event.kind !== 'task');
        if (events.length === 0) {
          return;
        }
        response = await send(events);
      }
      if (!response.ok) {
        this.#onError(
          `The run's log refused ${events.length} lines (${response.status}): ${await response.text().catch(() => '')}`,
        );
      }
    } catch (error) {
      this.#onError(
        controller.signal.aborted
          ? `${events.length} lines were given up on: the run's log did not answer within ${this.#timeoutMs} ms`
          : `${events.length} lines could not reach the run's log: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
