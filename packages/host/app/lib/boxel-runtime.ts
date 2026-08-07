import type {
  BoxelDescription,
  BoxelRenderRecord,
  CodeRef,
  LooseCardResource,
  LooseSingleCardDocument,
  RealmResourceIdentifier,
  ResolvedField,
  BoxelInstanceHandle,
  BoxelTypeHandle,
  RuntimeHandle,
} from '@cardstack/runtime-common';

export type BoxelExecutionMode = 'direct' | 'capsule' | 'sandbox';

export type { BoxelInstanceHandle, BoxelTypeHandle, RuntimeHandle };

export type MaterializationPurpose =
  | 'host-display'
  | 'code-preview'
  | 'interactive-edit'
  | 'command-validation'
  | 'indexing';

export interface BoxelRuntime {
  readonly mode: BoxelExecutionMode;

  loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle>;

  createFromSerialized(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
    purpose: MaterializationPurpose,
  ): Promise<BoxelInstanceHandle>;

  describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription>;

  getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]>;

  getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined>;

  buildRenderRecord(card: BoxelInstanceHandle): Promise<BoxelRenderRecord>;

  serializeCard(card: BoxelInstanceHandle): Promise<LooseSingleCardDocument>;

  dispose(handle: RuntimeHandle): Promise<void>;
}

/**
 * Runtime-local object identities. Handles are unguessable within a runtime,
 * have deterministic ownership, and are removed as soon as their consumer is
 * released. Live classes and instances never leave the runtime through them.
 */
export class RuntimeHandleRegistry<T extends object> {
  private nextHandle = 0;
  private values = new Map<RuntimeHandle, T>();
  private handles = new WeakMap<T, RuntimeHandle>();

  constructor(private readonly prefix: string) {}

  add(value: T): RuntimeHandle {
    let existing = this.handles.get(value);
    if (existing) {
      return existing;
    }
    let handle = `${this.prefix}:${++this.nextHandle}` as RuntimeHandle;
    this.values.set(handle, value);
    this.handles.set(value, handle);
    return handle;
  }

  /**
   * Register a distinct lease for an object that may already have another
   * live handle. This is used when multiple mounted Direct surfaces retain the
   * same canonical Store instance and must be released independently.
   */
  addDistinct(value: T): RuntimeHandle {
    let handle = `${this.prefix}:${++this.nextHandle}` as RuntimeHandle;
    this.values.set(handle, value);
    return handle;
  }

  /**
   * Sandbox HMR: rebinds an already-issued handle to a new value, in place.
   * Every consumer still holding this handle (the parent's session, an
   * in-flight RPC) keeps working unchanged after this call — only what the
   * handle resolves to changes. Used when a module invalidation means the
   * old value's class identity is stale but its handle must survive (see
   * `DirectBoxelRuntime.redeserialize`). Throws for an unknown handle: a
   * caller old enough to still hold a handle this registry never issued (or
   * already released) has a real bug, not a case to silently no-op.
   */
  replace(handle: RuntimeHandle, value: T): void {
    let previous = this.values.get(handle);
    if (!previous) {
      throw new Error(`Unknown or released ${this.prefix} handle '${handle}'`);
    }
    this.handles.delete(previous);
    this.values.set(handle, value);
    this.handles.set(value, handle);
  }

  get(handle: RuntimeHandle): T {
    let value = this.values.get(handle);
    if (!value) {
      throw new Error(`Unknown or released ${this.prefix} handle '${handle}'`);
    }
    return value;
  }

  release(handle: RuntimeHandle): void {
    let value = this.values.get(handle);
    if (value) {
      this.handles.delete(value);
      this.values.delete(handle);
    }
  }

  clear(): void {
    this.values.clear();
    this.handles = new WeakMap();
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
