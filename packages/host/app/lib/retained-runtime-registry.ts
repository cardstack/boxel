export interface DestroyableRuntime {
  destroy(): void;
}

type RuntimeFactory<T> = (identity: string) => T;
type RuntimeEvicted = (identity: string) => void;

/**
 * Reference-counted runtime lifetime with bounded warm retention.
 *
 * Capsule uses a principal identity. Sandbox uses a mounted-surface identity.
 * Direct is a Host singleton and does not need this registry.
 */
export default class RetainedRuntimeRegistry<T extends DestroyableRuntime> {
  private runtimes = new Map<string, T>();
  private consumers = new Map<string, number>();
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private createRuntime: RuntimeFactory<T>,
    private onEvicted: RuntimeEvicted = () => undefined,
    private idleTTL = 90_000,
  ) {}

  get size(): number {
    return this.runtimes.size;
  }

  values(): IterableIterator<T> {
    return this.runtimes.values();
  }

  runtimeFor(identity: string): T {
    let runtime = this.runtimes.get(identity);
    if (!runtime) {
      runtime = this.createRuntime(identity);
      this.runtimes.set(identity, runtime);
    }
    return runtime;
  }

  retain(identity: string): () => void {
    let timer = this.evictionTimers.get(identity);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(identity);
    }
    this.consumers.set(identity, (this.consumers.get(identity) ?? 0) + 1);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      let remaining = Math.max(0, (this.consumers.get(identity) ?? 1) - 1);
      if (remaining > 0) {
        this.consumers.set(identity, remaining);
        return;
      }
      this.consumers.delete(identity);
      this.evictionTimers.set(
        identity,
        setTimeout(() => this.evict(identity), this.idleTTL),
      );
    };
  }

  evictIdle(): void {
    for (let identity of this.runtimes.keys()) {
      if ((this.consumers.get(identity) ?? 0) === 0) {
        this.evict(identity);
      }
    }
  }

  destroy(): void {
    for (let timer of this.evictionTimers.values()) {
      clearTimeout(timer);
    }
    this.evictionTimers.clear();
    this.consumers.clear();
    for (let runtime of this.runtimes.values()) {
      runtime.destroy();
    }
    this.runtimes.clear();
  }

  private evict(identity: string): void {
    let timer = this.evictionTimers.get(identity);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(identity);
    }
    if ((this.consumers.get(identity) ?? 0) > 0) {
      return;
    }
    let runtime = this.runtimes.get(identity);
    if (!runtime) {
      return;
    }
    runtime.destroy();
    this.runtimes.delete(identity);
    this.onEvicted(identity);
  }
}
