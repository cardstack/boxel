// A wave's completed candidates share a bounded publication tick. Computation
// never waits for an individual item's tick; the wave drains before releasing
// its lease. Only the supplied flush callback can publish data.
export class LatticeCommitTick<T> {
  #pending: T[] = [];
  #timer?: ReturnType<typeof setTimeout>;
  #tail: Promise<void> = Promise.resolve();
  #failure: unknown;
  #failed = false;
  #closed = false;

  private flush: (items: T[]) => Promise<void>;
  private delayMs: number;
  private maxItems: number;

  constructor(
    flush: (items: T[]) => Promise<void>,
    delayMs = 400,
    maxItems = 8,
  ) {
    this.flush = flush;
    this.delayMs = delayMs;
    this.maxItems = maxItems;
    if (
      !(
        Number.isFinite(delayMs) &&
        delayMs >= 0 &&
        Number.isInteger(maxItems) &&
        maxItems > 0
      )
    )
      throw new Error('Invalid Lattice commit tick');
  }

  add(item: T): void {
    if (this.#closed) throw new Error('Lattice commit tick is closed');
    if (this.#failed) throw this.#failure;
    this.#pending.push(item);
    if (this.#pending.length >= this.maxItems) this.#flush();
    else if (!this.#timer)
      this.#timer = setTimeout(() => this.#flush(), this.delayMs);
  }

  #flush(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#pending.length) return;
    const items = this.#pending;
    this.#pending = [];
    this.#tail = this.#tail
      .then(async () => {
        if (!this.#failed) await this.flush(items);
      })
      .catch((error: unknown) => {
        this.#failed = true;
        this.#failure = error;
      });
  }

  async finish(): Promise<void> {
    this.#closed = true;
    this.#flush();
    await this.#tail;
    if (this.#failed) throw this.#failure;
  }
}
