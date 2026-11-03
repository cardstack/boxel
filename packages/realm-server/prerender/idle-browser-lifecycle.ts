export function browserIdleTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const value = env.PRERENDER_BROWSER_IDLE_TIMEOUT_MS;
  if (value === undefined) return 0;
  const timeout = Number(value);
  if (
    !value.trim() ||
    !Number.isSafeInteger(timeout) ||
    timeout < 0 ||
    timeout > 2_147_483_647
  ) {
    throw new Error(
      'PRERENDER_BROWSER_IDLE_TIMEOUT_MS must be an integer from 0 to 2147483647',
    );
  }
  return timeout;
}

export class IdleBrowserLifecycle {
  #active = 0;
  #timer: NodeJS.Timeout | undefined;
  #closing: Promise<void> | undefined;
  #sleeping = false;
  #stopped = false;
  #timeoutMs: number;
  #release: () => Promise<void>;
  #onError: (error: unknown) => void;

  constructor(options: {
    timeoutMs: number;
    release: () => Promise<void>;
    onError: (error: unknown) => void;
  }) {
    this.#timeoutMs = options.timeoutMs;
    this.#release = options.release;
    this.#onError = options.onError;
  }

  get suspended(): boolean {
    return this.#sleeping || this.#closing !== undefined;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.#stopped)
      throw new Error('Prerenderer has been stopped and cannot be used');
    this.#active++;
    this.#clearTimer();
    try {
      await this.#closing;
      if (this.#stopped)
        throw new Error('Prerenderer has been stopped and cannot be used');
      this.#sleeping = false;
      return await work();
    } finally {
      this.#active--;
      this.#schedule();
    }
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#clearTimer();
    await this.#closing;
  }

  #clearTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #schedule(): void {
    if (
      this.#stopped ||
      this.#active !== 0 ||
      this.#timeoutMs === 0 ||
      this.#sleeping ||
      this.#closing
    )
      return;
    this.#clearTimer();
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#closing = Promise.resolve()
        .then(async () => {
          await this.#release();
          this.#sleeping = true;
        })
        .catch(this.#onError)
        .finally(() => {
          this.#closing = undefined;
          this.#schedule();
        });
    }, this.#timeoutMs);
    this.#timer.unref();
  }
}
