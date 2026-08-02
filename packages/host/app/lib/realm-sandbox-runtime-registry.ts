import type RealmCompartmentModuleRuntime from '@cardstack/host/lib/realm-compartment-module-runtime';

type RuntimeFactory = (principal: string) => RealmCompartmentModuleRuntime;
type RuntimeEvicted = (principal: string) => void;

// Owns the lifetime of canonical per-principal SES runtimes. The Ember service
// remains responsible for policy and template caches; this registry only
// answers when a runtime is shared, retained, or safe to destroy.
export default class RealmSandboxRuntimeRegistry {
  private runtimes = new Map<string, RealmCompartmentModuleRuntime>();
  private consumers = new Map<string, number>();
  private evictionTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private createRuntime: RuntimeFactory,
    private onEvicted: RuntimeEvicted,
    private idleTTL = 60_000,
  ) {}

  get size() {
    return this.runtimes.size;
  }

  values() {
    return this.runtimes.values();
  }

  runtimeFor(principal: string): RealmCompartmentModuleRuntime {
    let runtime = this.runtimes.get(principal);
    if (!runtime) {
      runtime = this.createRuntime(principal);
      this.runtimes.set(principal, runtime);
    }
    return runtime;
  }

  retain(principal: string): () => void {
    let timer = this.evictionTimers.get(principal);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(principal);
    }
    this.consumers.set(principal, (this.consumers.get(principal) ?? 0) + 1);

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      let remaining = Math.max(0, (this.consumers.get(principal) ?? 1) - 1);
      if (remaining > 0) {
        this.consumers.set(principal, remaining);
        return;
      }
      this.consumers.delete(principal);
      this.evictionTimers.set(
        principal,
        setTimeout(() => this.evict(principal), this.idleTTL),
      );
    };
  }

  evictIdle() {
    for (let principal of [...this.runtimes.keys()]) {
      if ((this.consumers.get(principal) ?? 0) > 0) {
        continue;
      }
      this.evict(principal);
    }
  }

  destroy() {
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

  private evict(principal: string) {
    let timer = this.evictionTimers.get(principal);
    if (timer) {
      clearTimeout(timer);
      this.evictionTimers.delete(principal);
    }
    if ((this.consumers.get(principal) ?? 0) > 0) {
      return;
    }
    let runtime = this.runtimes.get(principal);
    if (!runtime) {
      return;
    }
    runtime.destroy();
    this.runtimes.delete(principal);
    this.onEvicted(principal);
  }
}
