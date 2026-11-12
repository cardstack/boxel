// A counting semaphore. The recorders of one task share one, so at most its
// number of permits do I/O at once, however many realms are active. Permits
// are granted in the order they were asked for.

export class Semaphore {
  #available: number;
  #waiting: (() => void)[] = [];

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new Error(`a semaphore needs at least one permit, not ${permits}`);
    }
    this.#available = permits;
  }

  // Resolves with the function that gives the permit back. Calling it twice
  // gives back one permit, not two.
  async acquire(): Promise<() => void> {
    if (this.#available > 0) {
      this.#available--;
    } else {
      await new Promise<void>((resolve) => this.#waiting.push(resolve));
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      let next = this.#waiting.shift();
      if (next) {
        next();
      } else {
        this.#available++;
      }
    };
  }
}
