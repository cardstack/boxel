import { Deferred, logger } from '@cardstack/runtime-common';

// Logs on the `queue` channel, shared with pg-queue, so one LOG_LEVELS entry
// covers both loops.
const log = logger('queue');

// Tracks a task that should loop with a timeout and an interruptible sleep.
export class WorkLoop {
  private internalWaker: Deferred<void> | undefined;
  private timeout: NodeJS.Timeout | undefined;
  private _shuttingDown = false;
  private runnerPromise: Promise<void> | undefined;
  private label: string;
  private pollInterval: number;

  constructor(label: string, pollInterval: number) {
    this.label = label;
    this.pollInterval = pollInterval;
  }

  // 1. Your fn should loop until workLoop.shuttingDown is true.
  // 2. When it has no work to do, it should await workLoop.sleep().
  // 3. It can be awoke with workLoop.wake().
  // 4. Remember to await workLoop.shutdown() when you're done.
  //
  // This is separate from the constructor so you can store your WorkLoop first,
  // *before* the runner starts doing things.
  run(fn: (loop: WorkLoop) => Promise<void>) {
    this.runnerPromise = fn(this);
  }

  async shutDown(): Promise<void> {
    log.debug(`[workloop %s] shutting down`, this.label);
    this._shuttingDown = true;
    this.wake();
    await this.runnerPromise;
    log.debug(`[workloop %s] completed shutdown`, this.label);
  }

  get shuttingDown(): boolean {
    return this._shuttingDown;
  }

  private get waker() {
    if (!this.internalWaker) {
      this.internalWaker = new Deferred();
    }
    return this.internalWaker;
  }

  wake() {
    log.debug(`[workloop %s] waking up`, this.label);
    this.waker.fulfill();
  }

  async sleep() {
    if (this.shuttingDown) {
      return;
    }
    let timerPromise = new Promise((resolve) => {
      this.timeout = setTimeout(resolve, this.pollInterval).unref();
    });
    log.debug(`[workloop %s] entering promise race`, this.label);
    await Promise.race([this.waker.promise, timerPromise]);
    log.debug(`[workloop %s] leaving promise race`, this.label);
    if (this.timeout != null) {
      clearTimeout(this.timeout);
    }
    this.internalWaker = undefined;
  }
}
