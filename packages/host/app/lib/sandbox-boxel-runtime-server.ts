import {
  BOXEL_EXECUTION_TRANSPORT_VERSION,
  assertBoxelExecutionTransportVersion,
  type BoxelInstanceHandle,
  type BoxelRuntimeRequest,
  type BoxelRuntimeResponse,
  type BoxelTypeHandle,
  type JSONValue,
  type RealmResourceIdentifier,
  type RuntimeHandle,
} from '@cardstack/runtime-common';

import type { BoxelRuntime, MaterializationPurpose } from './boxel-runtime';

/** Child-side dispatcher for the private Sandbox MessageChannel. */
export default class SandboxBoxelRuntimeServer {
  private closed = false;

  constructor(
    private readonly port: MessagePort,
    private readonly runtime: BoxelRuntime,
  ) {
    this.port.addEventListener('message', this.onMessage);
    this.port.start();
  }

  destroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.port.removeEventListener('message', this.onMessage);
    this.port.close();
  }

  private onMessage = async (event: MessageEvent<unknown>) => {
    let request = event.data;
    if (!isBoxelRuntimeRequest(request)) {
      return;
    }
    // Breadcrumb 5/7: an RPC request arrived. `loadBoxel`/`createFromSerialized`
    // are what actually trigger module fetch + evaluation (including the
    // authored card's own module and its dependency graph) — if the child
    // stalls fetching or evaluating a module, this logs but the matching
    // "RPC completed/failed" below never does, pinpointing the stall to
    // "module import begun" without needing a separate breadcrumb inside the
    // Loader itself (shared, non-sandbox-owned code).
    let startedAt = Date.now();
    console.debug('[sandbox-child] RPC request received', {
      operation: request.operation,
      requestId: request.requestId,
    });
    let response: BoxelRuntimeResponse;
    try {
      assertBoxelExecutionTransportVersion(request.transportVersion);
      let value = (await this.dispatch(request)) as JSONValue;
      response = {
        kind: 'boxel-runtime-response',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId: request.requestId,
        ok: true,
        value,
      };
      console.debug('[sandbox-child] RPC request completed', {
        operation: request.operation,
        requestId: request.requestId,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      response = {
        kind: 'boxel-runtime-response',
        transportVersion: BOXEL_EXECUTION_TRANSPORT_VERSION,
        requestId: request.requestId,
        ok: false,
        error: projectedError(error),
      };
      console.warn('[sandbox-child] RPC request failed', {
        operation: request.operation,
        requestId: request.requestId,
        durationMs: Date.now() - startedAt,
        error: response.error,
      });
    }
    if (!this.closed) {
      this.port.postMessage(response);
    }
  };

  private async dispatch(request: BoxelRuntimeRequest): Promise<unknown> {
    let args = request.args;
    switch (request.operation) {
      case 'loadBoxel':
        return this.runtime.loadBoxel(args[0] as never);
      case 'createFromSerialized':
        return this.runtime.createFromSerialized(
          args[0] as never,
          args[1] as never,
          (args[2] === null ? undefined : args[2]) as
            | RealmResourceIdentifier
            | undefined,
          args[3] as MaterializationPurpose,
        );
      case 'describeBoxel':
        return this.runtime.describeBoxel(args[0] as BoxelTypeHandle);
      case 'getFields':
        return this.runtime.getFields(
          args[0] as BoxelTypeHandle | BoxelInstanceHandle,
        );
      case 'getField': {
        let field = await this.runtime.getField(
          args[0] as BoxelTypeHandle | BoxelInstanceHandle,
          args[1] as string,
        );
        return field === undefined ? null : (field as unknown as JSONValue);
      }
      case 'buildRenderRecord':
        return this.runtime.buildRenderRecord(args[0] as BoxelInstanceHandle);
      case 'serializeCard':
        return this.runtime.serializeCard(args[0] as BoxelInstanceHandle);
      case 'dispose':
        await this.runtime.dispose(args[0] as RuntimeHandle);
        return null;
    }
  }
}

const runtimeOperations = new Set<BoxelRuntimeRequest['operation']>([
  'loadBoxel',
  'createFromSerialized',
  'describeBoxel',
  'getFields',
  'getField',
  'buildRenderRecord',
  'serializeCard',
  'dispose',
]);

function isBoxelRuntimeRequest(value: unknown): value is BoxelRuntimeRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'boxel-runtime-request' &&
    'transportVersion' in value &&
    typeof value.transportVersion === 'number' &&
    'requestId' in value &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    value.requestId.length <= 256 &&
    'operation' in value &&
    typeof value.operation === 'string' &&
    runtimeOperations.has(
      value.operation as BoxelRuntimeRequest['operation'],
    ) &&
    'args' in value &&
    Array.isArray(value.args)
  );
}

function projectedError(error: unknown): {
  name: string;
  message: string;
  code?: string;
  stack?: string;
} {
  if (error instanceof Error) {
    let code = (error as Error & { code?: unknown }).code;
    return {
      name: error.name,
      message: error.message,
      ...(typeof code === 'string' ? { code } : {}),
      ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    };
  }
  return {
    name: 'SandboxRuntimeError',
    message: String(error),
  };
}
