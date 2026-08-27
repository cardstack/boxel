import type {
  BoxelInstanceHandle,
  BoxelTypeHandle,
  RuntimeHandle,
} from '@cardstack/runtime-common/boxel-execution-protocol';

/**
 * Runtime-local names for objects that never leave their runtime.
 *
 * A handle is a string, so it is cloneable and crosses freely; the loaded class
 * or materialized instance it names does not. That asymmetry is the whole
 * point — an operation can take and return an identity without the object
 * behind it ever being reachable from the other side.
 *
 * A handle is an identifier, NOT a capability, and this registry does not
 * pretend otherwise: ids are sequential and any holder of a well-formed one
 * resolves it. Scoping a handle to the peer it was issued to is the issuing
 * *channel's* job, and a channel that accepts a handle from across a boundary
 * has to check that the peer sending it was the peer it went to. Making the
 * ids unguessable here would only obscure that, by making a missing check look
 * like a safe one.
 *
 * Every `add` mints a fresh handle, including for an object this registry
 * already names. Deduplicating by object would make two independent holders
 * share one handle, and then the first `dispose` would revoke the second
 * holder's name for an object it is still using. Two names for one class cost
 * a map entry; a revoked name costs a render.
 */
export class RuntimeHandleRegistry<T extends object> {
  private nextId = 0;
  private values = new Map<RuntimeHandle, T>();

  constructor(private readonly prefix: string) {}

  add(value: T): RuntimeHandle {
    let handle = `${this.prefix}:${++this.nextId}` as RuntimeHandle;
    this.values.set(handle, value);
    return handle;
  }

  has(handle: RuntimeHandle): boolean {
    return this.values.has(handle);
  }

  /**
   * Resolves a handle, or throws naming it.
   *
   * An unknown handle is a real fault rather than a case to answer `undefined`
   * for: the caller either kept a name past the `dispose` that released it or
   * is using another registry's name, and both produce a wrong render quietly
   * if this hands back nothing.
   */
  get(handle: RuntimeHandle): T {
    let value = this.values.get(handle);
    if (!value) {
      throw new Error(`Unknown or released ${this.prefix} handle '${handle}'`);
    }
    return value;
  }

  release(handle: RuntimeHandle): void {
    this.values.delete(handle);
  }

  get size(): number {
    return this.values.size;
  }
}

export function asBoxelTypeHandle(handle: RuntimeHandle): BoxelTypeHandle {
  return handle as BoxelTypeHandle;
}

export function asBoxelInstanceHandle(
  handle: RuntimeHandle,
): BoxelInstanceHandle {
  return handle as BoxelInstanceHandle;
}
