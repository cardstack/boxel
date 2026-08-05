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
  type PatchData,
  type RealmResourceIdentifier,
  type ResolvedField,
  type RuntimeHandle,
} from '@cardstack/runtime-common';

import type { BoxelRuntime, MaterializationPurpose } from './boxel-runtime';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

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

  constructor(private readonly port: MessagePort) {
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

  serializeCardPatch(
    card: BoxelInstanceHandle,
    changes: Record<string, JSONValue>,
  ): Promise<PatchData> {
    return this.request('serializeCardPatch', [card, changes]);
  }

  async dispose(handle: RuntimeHandle): Promise<void> {
    await this.request('dispose', [handle]);
  }

  destroy(reason = 'Sandbox runtime client was destroyed'): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.onMessage);
    this.port.close();
    for (let pending of this.pending.values()) {
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
      this.pending.set(requestId, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      try {
        this.port.postMessage(request);
      } catch (error) {
        this.pending.delete(requestId);
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
    if (response.ok) {
      pending.resolve(response.value);
    } else {
      let error = new Error(
        response.error?.message ?? 'Sandbox runtime failed',
      );
      error.name = response.error?.name ?? 'SandboxRuntimeError';
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
        typeof value.error.message === 'string')
  );
}
