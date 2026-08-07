import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  assertBoxelExecutionTransportVersion,
  type BoxelDescription,
  type BoxelInstanceHandle,
  type BoxelRenderRecord,
  type BoxelRuntimeRequest,
  type BoxelRuntimeResponse,
  type BoxelTypeHandle,
  type CodeRef,
  type JSONValue,
  type LooseCardResource,
  type LooseSingleCardDocument,
  type RealmResourceIdentifier,
  type ResolvedField,
  type RuntimeHandle,
} from '@cardstack/runtime-common';

import type { BoxelRuntime, MaterializationPurpose } from './boxel-runtime';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
}

// RP-15.3: any Sandbox RPC (not only `render`) can wedge — e.g. a purpose
// (`createFromSerialized`'s `interactive-edit`) that stalls acquiring a
// module or capability the child never actually grants. Left unbounded, that
// hang never resolves `BoxelExecutionSession.update()`, so the session never
// reaches `error` and the caller (`boxel-execution-renderer.gts`) is left
// showing its last placeholder forever with no failure ever surfacing. Every
// request gets the same bounded fail-closed timeout `SandboxRenderClient`
// uses for the render RPC.
export const defaultSandboxRuntimeRequestTimeoutMs = 10_000;

/**
 * Parent-side semantic adapter for an origin-isolated Boxel Sandbox.
 *
 * The transferred port is the only authority this class receives. It has no
 * reference to the child window and never sends requests over `window`
 * messaging after bootstrap.
 */
export default class SandboxBoxelRuntimeClient implements BoxelRuntime {
  readonly mode = 'sandbox' as const;

  private nextRequest = 0;
  private pending = new Map<string, PendingRequest>();
  private closed = false;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly port: MessagePort,
    requestTimeoutMs = defaultSandboxRuntimeRequestTimeoutMs,
  ) {
    this.requestTimeoutMs = requestTimeoutMs;
    this.port.addEventListener('message', this.onMessage);
    this.port.start();
  }

  loadBoxel(ref: CodeRef): Promise<BoxelTypeHandle> {
    return this.request('loadBoxel', [ref as unknown as JSONValue]);
  }

  createFromSerialized(
    resource: LooseCardResource,
    document: LooseSingleCardDocument,
    relativeTo: RealmResourceIdentifier | undefined,
    purpose: MaterializationPurpose,
  ): Promise<BoxelInstanceHandle> {
    return this.request('createFromSerialized', [
      resource as unknown as JSONValue,
      document as unknown as JSONValue,
      (relativeTo ?? null) as JSONValue,
      purpose,
    ]);
  }

  describeBoxel(boxel: BoxelTypeHandle): Promise<BoxelDescription> {
    return this.request('describeBoxel', [boxel]);
  }

  getFields(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
  ): Promise<ResolvedField[]> {
    return this.request('getFields', [boxel]);
  }

  getField(
    boxel: BoxelTypeHandle | BoxelInstanceHandle,
    fieldName: string,
  ): Promise<ResolvedField | undefined> {
    return this.request('getField', [boxel, fieldName]);
  }

  buildRenderRecord(card: BoxelInstanceHandle): Promise<BoxelRenderRecord> {
    return this.request('buildRenderRecord', [card]);
  }

  serializeCard(card: BoxelInstanceHandle): Promise<LooseSingleCardDocument> {
    return this.request('serializeCard', [card]);
  }

  async dispose(handle: RuntimeHandle): Promise<void> {
    await this.request('dispose', [handle]);
  }

  /**
   * Fails every in-flight request without waiting out its timeout.
   *
   * Used when the owning `SandboxRuntimeProcess` learns, from an out-of-band
   * signal (a child-reported runtime error), that this process can never
   * complete a pending operation.
   */
  failPending(error: Error): void {
    for (let [requestId, pending] of this.pending) {
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
      this.pending.delete(requestId);
    }
  }

  destroy(reason = 'Sandbox runtime client was destroyed'): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.onMessage);
    this.port.close();
    for (let pending of this.pending.values()) {
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private request<T = JSONValue>(
    operation: BoxelRuntimeRequest['operation'],
    args: JSONValue[],
  ): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error('Sandbox runtime client is closed'));
    }
    let requestId = `sandbox:${++this.nextRequest}`;
    let request: BoxelRuntimeRequest = {
      kind: 'boxel-runtime-request',
      transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
      requestId,
      operation,
      args,
    };
    return new Promise<T>((resolve, reject) => {
      let timeout =
        this.requestTimeoutMs > 0
          ? setTimeout(() => {
              if (!this.pending.delete(requestId)) {
                return;
              }
              reject(
                new Error(
                  `Sandbox ${operation} timed out after ${this.requestTimeoutMs}ms waiting for the child to respond`,
                ),
              );
            }, this.requestTimeoutMs)
          : undefined;
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
      try {
        this.port.postMessage(request);
      } catch (error) {
        if (this.pending.delete(requestId) && timeout !== undefined) {
          clearTimeout(timeout);
        }
        reject(error);
      }
    });
  }

  private onMessage = (event: MessageEvent<unknown>) => {
    let response = event.data;
    if (!isBoxelRuntimeResponse(response)) {
      return;
    }
    try {
      assertBoxelExecutionTransportVersion(response.transportVersion);
    } catch (error) {
      this.failAll(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    let pending = this.pending.get(response.requestId);
    if (!pending) {
      return;
    }
    this.pending.delete(response.requestId);
    if (pending.timeout !== undefined) {
      clearTimeout(pending.timeout);
    }
    if (response.ok) {
      pending.resolve(response.value);
    } else {
      let error = new Error(
        response.error?.message ?? 'Sandbox runtime failed',
      );
      error.name = response.error?.name ?? 'SandboxRuntimeError';
      if (response.error?.stack) {
        error.stack = response.error.stack;
      }
      pending.reject(error);
    }
  };

  private failAll(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.onMessage);
    this.port.close();
    for (let pending of this.pending.values()) {
      if (pending.timeout !== undefined) {
        clearTimeout(pending.timeout);
      }
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function isBoxelRuntimeResponse(value: unknown): value is BoxelRuntimeResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'boxel-runtime-response' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    'transportVersion' in value &&
    typeof value.transportVersion === 'number' &&
    'ok' in value &&
    typeof value.ok === 'boolean' &&
    (value.ok
      ? 'value' in value
      : 'error' in value &&
        typeof value.error === 'object' &&
        value.error !== null &&
        'name' in value.error &&
        typeof value.error.name === 'string' &&
        'message' in value.error &&
        typeof value.error.message === 'string' &&
        (!('stack' in value.error) || typeof value.error.stack === 'string'))
  );
}
